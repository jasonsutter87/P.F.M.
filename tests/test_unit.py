"""
Unit Tests - Test individual components in isolation.
"""

import hashlib
import uuid

import pytest

from pfm.spec import MAGIC, EOF_MARKER, SECTION_PREFIX, FORMAT_VERSION, SECTION_TYPES
from pfm.document import PFMDocument, PFMSection


# =============================================================================
# PFMSection
# =============================================================================

class TestPFMSection:

    def test_create_section(self):
        s = PFMSection(name="content", content="hello world")
        assert s.name == "content"
        assert s.content == "hello world"
        assert s.offset == 0
        assert s.length == 0

    def test_section_with_offset(self):
        s = PFMSection(name="chain", content="data", offset=100, length=4)
        assert s.offset == 100
        assert s.length == 4


# =============================================================================
# PFMDocument
# =============================================================================

class TestPFMDocument:

    def test_create_defaults(self):
        doc = PFMDocument.create(agent="test-agent", model="gpt-4")
        assert doc.agent == "test-agent"
        assert doc.model == "gpt-4"
        assert doc.id  # UUID should be set
        assert doc.created  # Timestamp should be set
        # Validate UUID format
        uuid.UUID(doc.id)

    def test_create_with_custom_meta(self):
        doc = PFMDocument.create(agent="a", model="m", foo="bar", baz="qux")
        assert doc.custom_meta == {"foo": "bar", "baz": "qux"}

    def test_add_section(self):
        doc = PFMDocument.create()
        section = doc.add_section("content", "hello")
        assert isinstance(section, PFMSection)
        assert len(doc.sections) == 1
        assert doc.sections[0].name == "content"
        assert doc.sections[0].content == "hello"

    def test_get_section(self):
        doc = PFMDocument.create()
        doc.add_section("content", "hello")
        doc.add_section("chain", "prompt chain")

        assert doc.get_section("content").content == "hello"
        assert doc.get_section("chain").content == "prompt chain"
        assert doc.get_section("nonexistent") is None

    def test_get_sections_multiple(self):
        doc = PFMDocument.create()
        doc.add_section("artifacts", "file1.py")
        doc.add_section("artifacts", "file2.py")

        results = doc.get_sections("artifacts")
        assert len(results) == 2

    def test_content_shortcut(self):
        doc = PFMDocument.create()
        doc.add_section("content", "the content")
        assert doc.content == "the content"

    def test_content_shortcut_none(self):
        doc = PFMDocument.create()
        assert doc.content is None

    def test_chain_shortcut(self):
        doc = PFMDocument.create()
        doc.add_section("chain", "the chain")
        assert doc.chain == "the chain"

    def test_compute_checksum(self):
        doc = PFMDocument.create()
        doc.add_section("content", "hello")
        doc.add_section("chain", "world")

        checksum = doc.compute_checksum()
        # Should be SHA-256 of "hello" + "world"
        expected = hashlib.sha256(b"helloworld").hexdigest()
        assert checksum == expected

    def test_get_meta_dict(self):
        doc = PFMDocument.create(agent="a", model="m")
        doc.custom_meta["custom_key"] = "custom_val"
        meta = doc.get_meta_dict()

        assert meta["agent"] == "a"
        assert meta["model"] == "m"
        assert meta["custom_key"] == "custom_val"
        assert "id" in meta
        assert "created" in meta

    def test_repr(self):
        doc = PFMDocument.create(agent="test")
        doc.add_section("content", "x")
        r = repr(doc)
        assert "PFMDocument" in r
        assert "test" in r
        assert "content" in r


# =============================================================================
# Spec constants
# =============================================================================

class TestSpec:

    def test_magic(self):
        assert MAGIC == "#!PFM"

    def test_eof_marker(self):
        assert EOF_MARKER == "#!END"

    def test_section_prefix(self):
        assert SECTION_PREFIX == "#@"

    def test_format_version(self):
        assert FORMAT_VERSION == "1.0"

    def test_reserved_sections_exist(self):
        assert "content" in SECTION_TYPES
        assert "chain" in SECTION_TYPES
        assert "tools" in SECTION_TYPES
        assert "meta" in SECTION_TYPES
        assert "index" in SECTION_TYPES


class TestSectionNameValidation:
    """Tests for section name charset enforcement."""

    def test_rejects_uppercase(self):
        doc = PFMDocument.create()
        with pytest.raises(ValueError, match="Invalid section name"):
            doc.add_section("Content", "data")

    def test_rejects_space(self):
        doc = PFMDocument.create()
        with pytest.raises(ValueError, match="Invalid section name"):
            doc.add_section("my section", "data")

    def test_rejects_dot(self):
        doc = PFMDocument.create()
        with pytest.raises(ValueError, match="Invalid section name"):
            doc.add_section("my.section", "data")

    def test_rejects_empty(self):
        doc = PFMDocument.create()
        with pytest.raises(ValueError, match="cannot be empty"):
            doc.add_section("", "data")

    def test_rejects_reserved_meta(self):
        doc = PFMDocument.create()
        with pytest.raises(ValueError, match="Reserved"):
            doc.add_section("meta", "data")

    def test_rejects_reserved_index(self):
        doc = PFMDocument.create()
        with pytest.raises(ValueError, match="Reserved"):
            doc.add_section("index", "data")

    def test_accepts_valid_names(self):
        doc = PFMDocument.create()
        doc.add_section("content", "ok")
        doc.add_section("my-section", "ok")
        doc.add_section("section_2", "ok")
        assert len(doc.sections) == 3


class TestVersionRejection:
    """Tests for unsupported format version rejection."""

    def test_parse_rejects_unknown_version(self):
        from pfm.reader import PFMReader
        data = b"#!PFM/2.0\n#@meta\nagent: test\n#@content\nhello\n#!END\n"
        with pytest.raises(ValueError, match="Unsupported PFM format version"):
            PFMReader.parse(data)

    def test_reader_handle_rejects_unknown_version(self):
        import tempfile
        from pathlib import Path
        from pfm.reader import PFMReader
        data = b"#!PFM/2.0\n#@meta\nagent: test\n#@content\nhello\n#!END\n"
        with tempfile.NamedTemporaryFile(suffix=".pfm", delete=False) as f:
            f.write(data)
            path = f.name
        with pytest.raises(ValueError, match="Unsupported"):
            PFMReader.open(path)
        Path(path).unlink()

    def test_parse_accepts_version_1_0(self):
        from pfm.reader import PFMReader
        data = b"#!PFM/1.0\n#@meta\nagent: test\n#@content\nhello\n#!END\n"
        doc = PFMReader.parse(data)
        assert doc.format_version == "1.0"

    def test_file_size_limit_enforced(self):
        import tempfile
        from pathlib import Path
        from pfm.reader import PFMReader
        data = b"#!PFM/1.0\n#@meta\n" + b"x" * 100
        with tempfile.NamedTemporaryFile(suffix=".pfm", delete=False) as f:
            f.write(data)
            path = f.name
        with pytest.raises(ValueError, match="exceeds maximum"):
            PFMReader.read(path, max_size=50)
        Path(path).unlink()
