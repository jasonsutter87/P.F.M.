---
name: recall
description: Load .pfm captures back into Claude Code memory. Closes the loop between /capture (save) and /recall (restore). Turns ephemeral insights into persistent agent knowledge.
allowed-tools: Bash, Read, Edit, Write, Glob, Grep
---

# /recall - Load PFM Captures into Memory

Read `.pfm` files and inject their content into Claude Code's auto-memory system. This closes the capture-recall loop: `/capture` saves insights to disk, `/recall` brings them back into agent context for future sessions.

## Usage

```
/recall <file.pfm>               # Load a single capture into memory
/recall <file.pfm> preview       # Show what would be added (dry run)
/recall <directory>               # Load all .pfm files from a directory
/recall <directory> preview       # Preview all without writing
/recall last                      # Load the most recent capture
/recall last preview              # Preview the most recent capture
```

## Behavior

### `/recall <file.pfm>`

1. Read the `.pfm` file content using Bash:
   ```bash
   pfm read <file.pfm> content
   ```
2. Parse the content for structured sections:
   - `## Insight` — the core finding
   - `## Context` — reasoning chain bullets
   - `## Tags` — comma-separated tags
   - `## Related` — files, endpoints, artifacts
   - `## Transcript` — conversation record (if span capture)
3. Determine the target memory file:
   - Check if the project has a memory directory at `{memory_dir}` (the auto-memory path from Claude Code's config, typically `~/.claude/projects/{project}/memory/`)
   - If `MEMORY.md` exists there, that's the primary target
   - If tags suggest a specific topic file already exists (e.g., tags contain "crypto" and `crypto.md` exists), prefer appending to that topic file
4. Build a memory entry from the capture:
   ```markdown
   ## <Insight title — first 8 words of insight> (from capture YYYY-MM-DD)
   <Insight text>
   - <Context bullet 1>
   - <Context bullet 2>
   ...
   Related: <file1>, <file2>
   ```
   - Do NOT include the full transcript in memory — that's too verbose. Only the insight + context bullets.
   - Do NOT duplicate information already present in the target memory file.
5. Check for duplicates:
   - Read the target memory file
   - If the insight (or a very similar statement) already exists, print `Already in memory: <insight summary>` and stop
6. Append the entry to the target memory file using the Edit tool.
7. Print ONE confirmation line: `Recalled into <filename>: <insight summary>` — then stop.

### `/recall <file.pfm> preview`

1. Same as above through step 4 (build the memory entry).
2. Print the entry that WOULD be added, prefixed with the target file path.
3. Print `(dry run — nothing written)` and stop.

### `/recall <directory>`

1. Find all `.pfm` files in the directory:
   ```bash
   ls -1 <directory>/*.pfm 2>/dev/null
   ```
2. For each file, run the single-file recall logic (steps 1-7 above).
3. Skip duplicates silently (just count them).
4. Print ONE summary line: `Recalled N insights from M files (K duplicates skipped)` — then stop.

### `/recall <directory> preview`

1. Same as directory recall but preview-only for all files.
2. Print each entry that would be added.
3. Print summary: `(dry run — N insights from M files would be added, K duplicates)`.

### `/recall last`

1. Find the most recent `.pfm` file in `captures/`:
   ```bash
   ls -1t captures/*.pfm 2>/dev/null | head -1
   ```
2. If no captures exist, print `No captures found in captures/` and stop.
3. Run single-file recall on that file.

### `/recall last preview`

1. Same as `/recall last` but preview-only.

## Memory File Conventions

- **MEMORY.md** is the catch-all. If no topic file matches, append here.
- **Topic files** are preferred when tags clearly match: e.g., `endpoint-map.md` for endpoint-related captures, `crypto.md` for crypto findings.
- **Keep entries concise.** Memory files have a ~200 line effective limit (after that, lines are truncated from context). Each recalled entry should be 3-8 lines max.
- **Deduplicate aggressively.** If the insight restates something already in memory, skip it. If it REFINES something, update the existing entry instead of appending.

## Rules

- **Speed over polish.** `/recall` should be fast — read pfm, check dupes, append, done.
- **Never include transcripts in memory.** Transcripts are for the `.pfm` archive, not for memory files. Only insight + context bullets go into memory.
- **Never overwrite memory files.** Always append or update in place. Never truncate or replace.
- **Preview is safe.** Always available, shows exactly what would change.
- **One confirmation line.** After recalling, print the result and stop. No elaboration.
- **Respect existing memory structure.** Don't reorganize or restructure the user's memory files. Add to them in the style already present.
