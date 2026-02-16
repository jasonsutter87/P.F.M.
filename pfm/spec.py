"""
PFM Format Specification v1.0
==============================

Layout:
    #!PFM/1.0                    <- Magic line (file identification, instant)
    #@meta                       <- Metadata section header
    id: <uuid>                   <- Unique document ID
    agent: <name>                <- Agent that generated this
    model: <model-id>            <- Model used
    created: <iso-8601>          <- Timestamp
    checksum: <sha256>           <- SHA-256 of all content sections combined
    #@index                      <- Index section (byte offsets for O(1) jumps)
    <name> <offset> <length>     <- Section name, byte offset from file start, byte length
    <name> <offset> <length>
    ...
    #@<section_name>             <- Content sections
    <content>
    #@<section_name>
    <content>
    #!END                        <- EOF marker

Design Decisions:
    - #! prefix for file boundaries (like shebang - instant identification)
    - #@ prefix for section markers (fast single-char scan after #)
    - Index uses fixed-width-friendly format: name<space>offset<space>length
    - All UTF-8, no binary blobs (human readable)
    - Sections are arbitrary - format doesn't dictate what you store
    - Byte offsets in index point to first byte AFTER the section header line

Priority: Speed > Indexing > Human Readability > AI Usefulness
"""

# Magic bytes - first line of every .pfm file
MAGIC = "#!PFM"
EOF_MARKER = "#!END"
SECTION_PREFIX = "#@"

# Format version
FORMAT_VERSION = "1.0"

# Reserved section names (users can define custom ones too)
SECTION_TYPES = {
    "meta": "File metadata (id, agent, model, timestamps)",
    "index": "Byte offset index for O(1) section access",
    "content": "Primary output content from the agent",
    "chain": "Prompt chain / conversation that produced this output",
    "tools": "Tool calls made during generation",
    "artifacts": "Generated code, files, or structured data",
    "reasoning": "Agent reasoning / chain-of-thought",
    "context": "Context window snapshot at generation time",
    "errors": "Errors encountered during generation",
    "metrics": "Performance metrics (tokens, latency, cost)",
}

# Meta field names
META_FIELDS = {
    "id": "Unique document identifier (UUID v4)",
    "agent": "Name/identifier of the generating agent",
    "model": "Model ID used for generation",
    "created": "ISO-8601 creation timestamp",
    "checksum": "SHA-256 hash of all content sections",
    "parent": "ID of parent .pfm document (for chains)",
    "tags": "Comma-separated tags",
    "version": "Document version (user-defined)",
}

# File extension
EXTENSION = ".pfm"

# Max magic line scan (for fast identification - don't read more than this)
MAX_MAGIC_SCAN_BYTES = 64
