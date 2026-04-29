# Conversation archival with PFM — tiered storage design

**Status:** Design decision, 2026-04-29. Not yet implemented.

**Origin:** Surfaced while designing the persistence layer for partyparrot
sessions (real-time presence + chat substrate). partyparrot generates live
conversations; PFM is the natural at-rest container. Once you have hundreds
or thousands of `.pfm` files, the question becomes: how do you stop scanning
every file when looking for old conversations?

This doc captures the answer.

---

## TL;DR

Use PFM at every tier — hot, warm, cold. Don't invent a new format for
archives. PFM's indexed sections give O(1) byte-offset access; merging many
small files into one archive (with each conversation as a section) is
exactly what `pfm merge` already does.

```
conversations/
├── hot/          one .pfm per conversation, < ~60 days
│   ├── 01J0VK...pfm
│   └── ...
├── warm/         monthly archives, 60 days – 1 year
│   ├── 2026-02.pfm    ← N conversations as N sections
│   └── 2026-03.pfm
└── cold/         yearly archives, > 1 year
    ├── 2024.pfm
    └── 2025.pfm
```

---

## Why PFM over JSONL (or anything else)

The use case is **archive read** — "find conversation X from 2024" — not
streaming append. PFM is the right tool for that workload. The comparison:

| | PFM | JSONL |
|---|---|---|
| Lookup by id | **O(1)** via byte-offset index | O(N) line scan |
| Tamper-evidence | HMAC + AES-256-GCM built in | Roll your own |
| Multi-conversation in one file | Sections (already supported) | One JSON per line, no index |
| Streaming append | Slower (trailing index post-pass) | **Native** |
| Greppable raw | Mostly | Pure |

JSONL only wins for streaming append (irrelevant — archives are write-once)
or piping to external tools like Spark / BigQuery (also not the use case).
For random-access read of cold conversations, PFM's indexed sections are
strictly better.

---

## Tier shape

### Hot

- One `.pfm` per conversation in `conversations/hot/`.
- Filename = the conversation's ULID + `.pfm`.
- Anything younger than the threshold (default: 60 days).

### Warm

- Monthly archives in `conversations/warm/YYYY-MM.pfm`.
- Each conversation from that month becomes a uniquely-named section in
  the archive. Suggested naming: `chat:<convId>` or `conv:<convId>` so
  there's no collision with PFM's reserved section names.
- Anything 60 days – 1 year old.

### Cold

- Yearly archives in `conversations/cold/YYYY.pfm`. Same internal shape
  as warm, just bigger.
- Anything > 1 year.
- Strong candidate for `fidelius` encryption — at this tier the data is
  rarely read and protecting it at rest matters more than fast access.

---

## Lookup is age-routed via ULID

ULIDs encode the timestamp in their first 10 chars (Crockford base32
decode → milliseconds since epoch). The conversation id *is* the age
check — no separate index needed.

```python
# pseudocode
age = now() - ulid_timestamp_ms(conv_id)

if age < HOT_THRESHOLD:
    path = f"conversations/hot/{conv_id}.pfm"
    return PFMReader.read(path)

elif age < COLD_THRESHOLD:
    bucket = month_bucket(ulid_timestamp_ms(conv_id))
    path = f"conversations/warm/{bucket}.pfm"
    with PFMReader.open(path) as r:
        return r.get_section(f"chat:{conv_id}")  # O(1) byte jump

else:
    bucket = year_bucket(ulid_timestamp_ms(conv_id))
    path = f"conversations/cold/{bucket}.pfm"
    with PFMReader.open(path) as r:
        return r.get_section(f"chat:{conv_id}")
```

partyparrot's `src/ulid.ts` already decodes ULID timestamps; the same
logic in Python is a 5-line function.

---

## Compaction

Two jobs, both periodic, both wrappers around `pfm merge`:

### Daily

For each `.pfm` in `hot/` whose ULID timestamp is older than `HOT_THRESHOLD`:

1. Determine target warm archive: `warm/YYYY-MM.pfm` based on conversation
   timestamp.
2. `pfm merge hot/<convId>.pfm warm/YYYY-MM.pfm -o warm/YYYY-MM.pfm` — but
   with a section-rename step so the source file's `content` / `chain` /
   `tools` sections become `chat:<convId>:content` etc., not colliding
   with sections from other conversations.
3. Verify checksum on the merged archive.
4. Delete the source hot file.

### Annually

On Jan 1, for each `warm/<lastyear>-*.pfm`:

1. Merge into `cold/<lastyear>.pfm` with the same section-rename
   discipline.
2. Verify and delete originals.
3. Optionally `fidelius` the cold archive.

Both jobs are idempotent if interrupted — partial merges leave the source
files in place; rerun resumes.

---

## Open items to verify before building

These were raised in design but not resolved. Check before implementation.

### 1. `MAX_SECTIONS` ceiling

`pfm/spec.py:66` defines `MAX_SECTIONS = 10_000`. A yearly cold archive
of 10K conversations would hit this. Fine for personal scale; bump if
multi-tenant. Worth deciding whether to:
- Bump the constant (simple, but it's there for resource exhaustion
  reasons — review why it was set there originally).
- Shard cold archives (`cold/2024-h1.pfm`, `cold/2024-h2.pfm`) when
  count crosses some threshold.

### 2. `pfm merge` collision behavior

Two source files containing a section called `content` — what does
merge do today? Three plausible behaviors:

- Both kept (PFM's library supports duplicate names — see
  `document.py:125`); reader chooses by index position.
- First wins, second dropped.
- Error.

Need a 30-minute check of the merge implementation, then a thin
wrapper that forces section names to include the source conversation
id (e.g., `chat:01J0VK.../content`). Without that wrapper, archives
will have ambiguous `content` sections that can't be looked up by
conversation id.

### 3. Encrypted cold archive read pattern

If `cold/2024.pfm` is encrypted with `fidelius`, reading one
conversation requires decrypting the whole archive in memory. For
personal scale this is fine (decrypt + cache). At larger scale you'd
want section-level encryption (encrypt each section's body
independently with the same key, keep the index unencrypted), but
that's a PFM library extension, not a usage decision.

### 4. Secondary indexes

PFM indexes by section name. For conversation archives you might also
want lookups by date range, participant, or tag. Three options:

- Just grep — fast enough for small scale.
- Custom `#@conv-index` section in each archive at write time, mapping
  date/participant → conversation id. Read once per archive open.
- External SQLite alongside the archives. Probably overkill; named
  here for completeness.

Don't build until grep proves insufficient.

---

## What this is *not*

- **Not a streaming write design.** Live conversations are partyparrot's
  job; this is what to do with them after they end.
- **Not a search system.** Lookup is by id. Full-text search is a
  separate problem.
- **Not multi-machine.** This is a single-host filesystem layout. Sync
  across machines is out of scope (use git, syncthing, rclone, whatever).

---

## Implementation work

Two pieces, neither in the PFM core library:

1. **Compaction script** (probably belongs in PFM itself, as a CLI
   subcommand: `pfm archive compact ./conversations/`). Wraps `pfm merge`
   with the section-rename rule and the age threshold.
2. **Age-routed lookup wrapper** (belongs in the consuming app — the
   "mini Claude" wrapper, not in PFM and not in partyparrot). The two
   primitives stay clean; the integration logic lives where the use
   case lives.

Estimated total: a day of Python, plus tests.
