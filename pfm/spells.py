"""
PFM Spells - Aliased API with Harry Potter spell names.

    polyjuice()        → Convert between formats (it literally transforms the data)
    fidelius()         → Encrypt (hides info, only the Secret Keeper can access)
    revelio()          → Decrypt (reveals hidden content)
    prior_incantato()  → Validate checksums/integrity (shows the last spells cast)
    accio()            → Read/summon a specific section by name
    unbreakable_vow()  → Sign (cryptographic oath that content is untampered)

Usage:
    from pfm.spells import accio, polyjuice, fidelius, revelio, unbreakable_vow

    content = accio("report.pfm", "content")
    json_str = polyjuice(doc, "json")
    encrypted = fidelius(doc, "password")
    decrypted = revelio(encrypted, "password")
    unbreakable_vow(doc, "secret-key")
    assert prior_incantato(doc)
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pfm.document import PFMDocument


# =============================================================================
# accio - Summon a section from a .pfm file
# =============================================================================

def accio(path: str, section: str) -> str | None:
    """
    Summon a section from a .pfm file by name.

    Uses indexed O(1) access — doesn't parse the whole file.

        content = accio("report.pfm", "content")
        chain = accio("report.pfm", "chain")
    """
    from pfm.reader import PFMReader

    with PFMReader.open(path) as reader:
        return reader.get_section(section)


# =============================================================================
# polyjuice - Transform between formats
# =============================================================================

def polyjuice(source: "PFMDocument | str", target_fmt: str, **kwargs) -> "str | PFMDocument":
    """
    Transform data between formats.

    PFMDocument → string:
        json_str = polyjuice(doc, "json")
        md_str = polyjuice(doc, "md")

    string → PFMDocument:
        doc = polyjuice(json_str, "pfm", source_fmt="json")
    """
    from pfm.document import PFMDocument
    from pfm.converters import convert_to, convert_from

    if isinstance(source, PFMDocument):
        return convert_to(source, target_fmt)
    else:
        source_fmt = kwargs.get("source_fmt", target_fmt)
        return convert_from(source, source_fmt, **{k: v for k, v in kwargs.items() if k != "source_fmt"})


# =============================================================================
# fidelius - Encrypt a document (the Fidelius Charm)
# =============================================================================

def fidelius(doc: "PFMDocument", password: str) -> bytes:
    """
    Cast the Fidelius Charm — hide a document's contents.
    Only the Secret Keeper (password holder) can reveal it.

        encrypted = fidelius(doc, "my-secret")
        with open("hidden.pfm.enc", "wb") as f:
            f.write(encrypted)
    """
    from pfm.security import encrypt_document
    return encrypt_document(doc, password)


# =============================================================================
# revelio - Decrypt a document
# =============================================================================

def revelio(data: bytes, password: str) -> "PFMDocument":
    """
    Cast Revelio — reveal a hidden document's true contents.

        data = open("hidden.pfm.enc", "rb").read()
        doc = revelio(data, "my-secret")
        print(doc.content)
    """
    from pfm.security import decrypt_document
    return decrypt_document(data, password)


# =============================================================================
# prior_incantato - Validate integrity and provenance
# =============================================================================

def prior_incantato(doc: "PFMDocument") -> dict:
    """
    Cast Prior Incantato — reveal the history and integrity of a document.
    Returns a dict with validation results.

        result = prior_incantato(doc)
        assert result["integrity"]  # checksum valid
        assert result["signed"]     # has signature
    """
    from pfm.security import verify_integrity, fingerprint

    return {
        "integrity": verify_integrity(doc),
        "checksum": doc.checksum or None,
        "computed_checksum": doc.compute_checksum(),
        "signed": bool(doc.custom_meta.get("signature")),
        "sig_algo": doc.custom_meta.get("sig_algo"),
        "fingerprint": fingerprint(doc),
        "agent": doc.agent,
        "model": doc.model,
        "created": doc.created,
        "id": doc.id,
    }


# =============================================================================
# unbreakable_vow - Sign a document
# =============================================================================

def unbreakable_vow(doc: "PFMDocument", secret: str | bytes) -> str:
    """
    Make an Unbreakable Vow — cryptographically bind the document's integrity.
    Tampering with a signed document breaks the vow.

        unbreakable_vow(doc, "signing-key")
        doc.write("sworn.pfm")
    """
    from pfm.security import sign
    return sign(doc, secret)


def vow_kept(doc: "PFMDocument", secret: str | bytes) -> bool:
    """
    Check if the Unbreakable Vow holds — verify the signature.

        assert vow_kept(doc, "signing-key")  # True if untampered
    """
    from pfm.security import verify
    return verify(doc, secret)
