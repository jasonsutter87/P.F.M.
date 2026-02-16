"""
Spell Tests - Verify all aliased magic functions work.
"""

import tempfile
from pathlib import Path

import pytest

from pfm.document import PFMDocument
from pfm.spells import (
    accio,
    polyjuice,
    fidelius,
    revelio,
    prior_incantato,
    unbreakable_vow,
    vow_kept,
)


@pytest.fixture
def doc():
    d = PFMDocument.create(agent="wizard", model="elder-wand")
    d.add_section("content", "mischief managed")
    d.add_section("chain", "i solemnly swear")
    return d


@pytest.fixture
def pfm_file(doc):
    with tempfile.NamedTemporaryFile(suffix=".pfm", delete=False) as f:
        path = f.name
    doc.write(path)
    yield path
    Path(path).unlink()


class TestAccio:

    def test_summon_content(self, pfm_file):
        result = accio(pfm_file, "content")
        assert "mischief managed" in result

    def test_summon_chain(self, pfm_file):
        result = accio(pfm_file, "chain")
        assert "i solemnly swear" in result

    def test_summon_nonexistent(self, pfm_file):
        result = accio(pfm_file, "horcrux")
        assert result is None


class TestPolyjuice:

    def test_transform_to_json(self, doc):
        json_str = polyjuice(doc, "json")
        assert "mischief managed" in json_str
        assert "wizard" in json_str

    def test_transform_to_markdown(self, doc):
        md = polyjuice(doc, "md")
        assert "## content" in md
        assert "mischief managed" in md

    def test_transform_to_csv(self, doc):
        csv_str = polyjuice(doc, "csv")
        assert "mischief managed" in csv_str

    def test_transform_to_txt(self, doc):
        txt = polyjuice(doc, "txt")
        assert "mischief managed" in txt

    def test_transform_from_json(self, doc):
        json_str = polyjuice(doc, "json")
        restored = polyjuice(json_str, "pfm", source_fmt="json")
        assert restored.content == "mischief managed"
        assert restored.agent == "wizard"


class TestFideliusAndRevelio:

    @pytest.fixture(autouse=True)
    def check_cryptography(self):
        try:
            import cryptography
        except ImportError:
            pytest.skip("cryptography package not installed")

    def test_encrypt_decrypt(self, doc):
        encrypted = fidelius(doc, "alohomora")
        assert b"mischief managed" not in encrypted

        revealed = revelio(encrypted, "alohomora")
        assert revealed.content == "mischief managed"
        assert revealed.agent == "wizard"

    def test_wrong_password(self, doc):
        encrypted = fidelius(doc, "alohomora")
        with pytest.raises(Exception):
            revelio(encrypted, "colloportus")


class TestPriorIncantato:

    def test_valid_document(self, doc):
        doc.checksum = doc.compute_checksum()
        result = prior_incantato(doc)

        assert result["integrity"] is True
        assert result["agent"] == "wizard"
        assert result["model"] == "elder-wand"
        assert result["fingerprint"]
        assert result["signed"] is False

    def test_signed_document(self, doc):
        unbreakable_vow(doc, "secret")
        result = prior_incantato(doc)

        assert result["signed"] is True
        assert result["sig_algo"] == "hmac-sha256"


class TestUnbreakableVow:

    def test_sign_and_verify(self, doc):
        sig = unbreakable_vow(doc, "expecto-patronum")
        assert sig
        assert vow_kept(doc, "expecto-patronum") is True

    def test_broken_vow(self, doc):
        unbreakable_vow(doc, "expecto-patronum")
        doc.sections[0].content = "tampered by voldemort"
        assert vow_kept(doc, "expecto-patronum") is False

    def test_wrong_key(self, doc):
        unbreakable_vow(doc, "expecto-patronum")
        assert vow_kept(doc, "avada-kedavra") is False
