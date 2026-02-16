"""
Streaming Writer Tests - Write sections on the fly, trailing index.
"""

import tempfile
from pathlib import Path

import pytest

from pfm.stream import PFMStreamWriter
from pfm.reader import PFMReader


class TestStreamWriter:

    def test_basic_stream_write(self):
        """Write sections one at a time, close, read back."""
        with tempfile.NamedTemporaryFile(suffix=".pfm", delete=False) as f:
            path = f.name

        with PFMStreamWriter(path, agent="stream-agent", model="test-model") as w:
            w.write_section("content", "streamed content")
            w.write_section("chain", "user: hello\nagent: hi")

        assert Path(path).exists()
        raw = Path(path).read_text()
        assert "#!PFM/1.0:STREAM" in raw
        assert "#@content" in raw
        assert "#@chain" in raw
        assert "#@index:trailing" in raw
        assert "#!END:" in raw

        Path(path).unlink()

    def test_stream_read_with_standard_reader(self):
        """Streamed files should be readable by the standard PFMReader."""
        with tempfile.NamedTemporaryFile(suffix=".pfm", delete=False) as f:
            path = f.name

        with PFMStreamWriter(path, agent="compat-test") as w:
            w.write_section("content", "compatibility check")
            w.write_section("tools", "search('query')")

        doc = PFMReader.read(path)
        assert doc.agent == "compat-test"
        assert doc.content == "compatibility check"
        assert doc.get_section("tools").content == "search('query')"

        Path(path).unlink()

    def test_stream_indexed_access(self):
        """Streamed files should support O(1) indexed access via PFMReader.open."""
        with tempfile.NamedTemporaryFile(suffix=".pfm", delete=False) as f:
            path = f.name

        with PFMStreamWriter(path, agent="index-test") as w:
            w.write_section("content", "indexed stream content")
            w.write_section("chain", "the chain data")
            w.write_section("tools", "tool_call()")

        with PFMReader.open(path) as reader:
            assert reader.meta["agent"] == "index-test"
            assert "content" in reader.section_names
            assert "chain" in reader.section_names
            assert "tools" in reader.section_names

            content = reader.get_section("content")
            assert "indexed stream content" in content

            chain = reader.get_section("chain")
            assert "the chain data" in chain

        Path(path).unlink()

    def test_stream_multiline_content(self):
        """Multiline content should survive streaming."""
        with tempfile.NamedTemporaryFile(suffix=".pfm", delete=False) as f:
            path = f.name

        multiline = "line 1\nline 2\nline 3"
        with PFMStreamWriter(path, agent="multiline") as w:
            w.write_section("content", multiline)

        doc = PFMReader.read(path)
        assert doc.content == multiline

        Path(path).unlink()

    def test_stream_incremental_flush(self):
        """Sections should be on disk immediately after write_section."""
        with tempfile.NamedTemporaryFile(suffix=".pfm", delete=False) as f:
            path = f.name

        w = PFMStreamWriter(path, agent="flush-test")
        w.write_section("content", "first section")

        # File should already have content on disk (before close)
        raw = Path(path).read_text()
        assert "first section" in raw

        w.write_section("tools", "second section")
        raw = Path(path).read_text()
        assert "second section" in raw

        w.close()
        Path(path).unlink()

    def test_stream_sections_written_count(self):
        with tempfile.NamedTemporaryFile(suffix=".pfm", delete=False) as f:
            path = f.name

        with PFMStreamWriter(path) as w:
            assert w.sections_written == 0
            w.write_section("content", "a")
            assert w.sections_written == 1
            w.write_section("chain", "b")
            assert w.sections_written == 2

        Path(path).unlink()

    def test_stream_write_after_close_raises(self):
        with tempfile.NamedTemporaryFile(suffix=".pfm", delete=False) as f:
            path = f.name

        w = PFMStreamWriter(path)
        w.write_section("content", "data")
        w.close()

        with pytest.raises(RuntimeError, match="closed"):
            w.write_section("more", "data")

        Path(path).unlink()

    def test_stream_custom_meta(self):
        with tempfile.NamedTemporaryFile(suffix=".pfm", delete=False) as f:
            path = f.name

        with PFMStreamWriter(path, agent="meta-test", project="my-project", team="alpha") as w:
            w.write_section("content", "custom meta test")

        raw = Path(path).read_text()
        assert "project: my-project" in raw
        assert "team: alpha" in raw

        Path(path).unlink()

    def test_stream_large_content(self):
        """Stream a large section without issues."""
        with tempfile.NamedTemporaryFile(suffix=".pfm", delete=False) as f:
            path = f.name

        large = "x" * 500_000
        with PFMStreamWriter(path, agent="large") as w:
            w.write_section("content", large)

        doc = PFMReader.read(path)
        assert doc.content == large

        Path(path).unlink()

    def test_stream_many_sections(self):
        """Stream many sections incrementally."""
        with tempfile.NamedTemporaryFile(suffix=".pfm", delete=False) as f:
            path = f.name

        with PFMStreamWriter(path, agent="many-sections") as w:
            for i in range(50):
                w.write_section(f"chunk_{i}", f"data for chunk {i}")

        doc = PFMReader.read(path)
        assert len(doc.sections) == 50
        assert doc.get_section("chunk_0").content == "data for chunk 0"
        assert doc.get_section("chunk_49").content == "data for chunk 49"

        Path(path).unlink()


class TestStreamRecovery:
    """Test crash recovery — reading partially written stream files."""

    def test_recover_unfinalized_file(self):
        """Simulate a crash: write sections but don't close. Reader should still parse content."""
        with tempfile.NamedTemporaryFile(suffix=".pfm", delete=False) as f:
            path = f.name

        # Write without closing (simulates crash)
        w = PFMStreamWriter(path, agent="crash-test")
        w.write_section("content", "survived the crash")
        w.write_section("chain", "chain data")
        # Don't call w.close() — simulating crash
        w._handle.flush()
        w._handle.close()
        w._closed = True  # Prevent __del__ issues

        # Standard full parse should still recover the content
        doc = PFMReader.read(path)
        assert doc.agent == "crash-test"
        assert doc.content == "survived the crash"
        assert doc.chain == "chain data"

        Path(path).unlink()

    def test_append_after_recovery(self):
        """Write, close, then reopen in append mode and add more sections."""
        with tempfile.NamedTemporaryFile(suffix=".pfm", delete=False) as f:
            path = f.name

        # First session
        with PFMStreamWriter(path, agent="append-test") as w:
            w.write_section("content", "session 1 content")

        # Second session (append)
        with PFMStreamWriter(path, append=True) as w:
            w.write_section("chain", "session 2 chain")

        doc = PFMReader.read(path)
        assert doc.content == "session 1 content"
        assert doc.chain == "session 2 chain"

        Path(path).unlink()
