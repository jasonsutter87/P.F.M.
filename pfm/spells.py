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


# =============================================================================
# geminio - Merge multiple documents into one (Doubling Charm)
# =============================================================================

def geminio(*sources: "PFMDocument | str", agent: str = "", model: str = "") -> "PFMDocument":
    """
    Cast Geminio — merge multiple .pfm documents into one.
    The Doubling Charm combines many into a unified whole,
    preserving lineage via the parent field.

        merged = geminio("part1.pfm", "part2.pfm", "part3.pfm")
        merged = geminio(doc1, doc2, doc3, agent="my-agent")
        merged.write("combined.pfm")

    Args:
        *sources: File paths (str) or PFMDocument objects to merge.
        agent: Agent name for the merged doc (default: inherits from first source).
        model: Model ID for the merged doc (default: inherits from first source).

    Returns:
        A new PFMDocument with all content sections concatenated,
        parent set to comma-separated source IDs,
        and tags merged from all sources.
    """
    from pfm.document import PFMDocument
    from pfm.reader import PFMReader

    if len(sources) < 2:
        raise ValueError("Geminio requires at least 2 sources to merge")

    # Resolve all sources to PFMDocument objects
    docs: list[PFMDocument] = []
    for src in sources:
        if isinstance(src, str):
            docs.append(PFMReader.read(src))
        else:
            docs.append(src)

    # Collect parent IDs and tags
    parent_ids = [d.id for d in docs if d.id]
    all_tags: list[str] = []
    for d in docs:
        if d.tags:
            all_tags.extend(t.strip() for t in d.tags.split(",") if t.strip())
    unique_tags = list(dict.fromkeys(all_tags))  # preserve order, dedupe

    # Create merged doc
    merged = PFMDocument.create(
        agent=agent or docs[0].agent,
        model=model or docs[0].model,
        parent=", ".join(parent_ids),
        tags=", ".join(unique_tags) if unique_tags else "",
    )

    # Merge content sections: concatenate with source headers
    content_parts: list[str] = []
    for i, doc in enumerate(docs):
        for section in doc.sections:
            if section.name == "content":
                source_label = doc.id[:8] if doc.id else f"source-{i}"
                created = doc.created or "unknown"
                content_parts.append(
                    f"--- [{source_label}] {created} ---\n{section.content}"
                )

    if content_parts:
        merged.add_section("content", "\n\n".join(content_parts))

    # Merge any non-content sections (chain, etc.) — append with source prefix
    for i, doc in enumerate(docs):
        for section in doc.sections:
            if section.name != "content":
                source_label = doc.id[:8] if doc.id else f"source-{i}"
                merged.add_section(
                    section.name,
                    f"--- [{source_label}] ---\n{section.content}",
                )

    return merged
