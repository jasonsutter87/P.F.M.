---
name: capture
description: Quick-save insights mid-session as .pfm files. Dogfoods PFM as a real-world container for AI agent output. Each capture gets its own UUID, timestamp, and checksum.
allowed-tools: Bash, Glob, Grep, Read
---

# /capture - Quick-Save Insights as PFM Files

Save findings, reasoning chains, and insights that would otherwise be lost to context compaction. Each capture becomes a standalone `.pfm` file in `{project_root}/captures/`.

## Usage

```
/capture "insight text"          # Save a specific insight
/capture                         # Auto-detect most recent significant finding
/capture start "label"           # Start recording — every exchange gets saved to disk
/capture end                     # Merge all recorded exchanges into one .pfm
/capture compact                 # Mid-span checkpoint — merge what we have so far, keep recording
/capture list                    # Show all captures for current project
/capture search <term>           # Grep across all .pfm files for a keyword
```

### Global flag: `-l <path>` (location override)

Any command accepts `-l <path>` to override where `captures/` lives:
```
/capture -l /path/to/project "insight text"
/capture -l ~/other-project start "label"
/capture -l ~/other-project list
```

When `-l` is provided, ALL paths use `<path>/captures/` instead of `{cwd}/captures/`.
When omitted, defaults to the current working directory.

**How to parse:** If the arguments contain `-l`, extract the next token as `CAPTURE_BASE` and remove both from the argument string. Then use `${CAPTURE_BASE}/captures/` for all file operations in that invocation. For span operations (`start`, per-exchange auto-save, `compact`, `end`), store the base path in `.capture-pending` on a second line so subsequent calls know where to write:
```
line 1: label text
line 2: /absolute/path/to/base (or empty = cwd)
```

## Behavior

### `/capture "insight text"`

1. Use the quoted text as the insight.
2. Review the last 2-4 conversation exchanges. Summarize the reasoning chain that led to this insight as bullet points.
3. Generate a slug from the insight: 3-5 lowercase words, hyphenated. Strip filler words.
4. Generate 2-4 tags relevant to the insight content.
5. Identify any related files, endpoints, or artifacts mentioned in recent context.
6. Build the capture content as markdown with these sections:
   ```
   ## Insight
   The finding in 1-3 sentences

   ## Context
   - User asked/noted: ...
   - Investigation showed: ...
   - This led to: ...

   ## Tags
   tag1, tag2, tag3

   ## Related
   - path/to/file or endpoint or artifact
   ```
7. Get the current timestamp in `YYYY-MM-DD-HHMMSS` format.
8. Run ONE chained Bash command:
   ```bash
   mkdir -p captures && \
   [ -f captures/.gitignore ] || echo '*' > captures/.gitignore
   ```
   Then ONE more Bash command to create the file:
   ```bash
   pfm create -a "claude-code" -m "claude-opus-4-6" \
     -c $'## Insight\n...\n\n## Context\n...\n\n## Tags\n...\n\n## Related\n...' \
     -o captures/YYYY-MM-DD-HHMMSS-slug.pfm
   ```
   Use `$'...'` quoting for the `-c` argument so `\n` produces actual newlines.
   Escape any single quotes in the content by ending the `$'` string, inserting `\'`, and resuming.
9. Print ONE confirmation line: `Captured: filename.pfm` — then stop. Do not elaborate.

### `/capture` (no args)

1. Scan the last 5-10 conversation exchanges for the most significant finding — a discovery, confirmation, dead end, or breakthrough.
2. Compose the insight text from that finding.
3. Follow the same steps as `/capture "text"` above.

### `/capture start "label"`

1. Note the label text (e.g., `"recovery key investigation"`, `"oracle PATCH testing"`).
2. Run ONE Bash command to set up the span:
   ```bash
   mkdir -p captures/.span && \
   [ -f captures/.gitignore ] || echo '*' > captures/.gitignore && \
   echo "LABEL" > captures/.capture-pending && \
   echo "0" > captures/.span/.counter
   ```
   This creates:
   - `captures/.capture-pending` — stores the label, signals a span is open
   - `captures/.span/` — folder for per-exchange files
   - `captures/.span/.counter` — tracks the next exchange number
3. Print ONE confirmation line: `Capture started: "label" — exchanges will auto-save to .span/` — then stop.

### Per-exchange auto-save (CRITICAL)

**After `/capture start` has been called, Claude MUST do this after EVERY response:**

1. Check: does `captures/.capture-pending` exist? (You already know if you ran `/capture start` this session — no need to check the file every time. Just remember.)
2. If a span is open, run ONE Bash command to save the exchange:
   ```bash
   N=$(cat captures/.span/.counter) && \
   printf '%03d' "$N" | read PAD && \
   cat > captures/.span/${PAD}.md <<'EXCHANGE_EOF'
   **User:** <what the user just said — preserve their words, condense if very long>
   **Claude:** <what you just responded — condense to key points, 2-4 sentences max>
   EXCHANGE_EOF
   echo $((N + 1)) > captures/.span/.counter
   ```
3. This is SILENT. Do not print any confirmation. Do not mention it. The user should not notice.
4. This happens on EVERY exchange — technical, casual, jokes, errors, everything. The whole point is completeness.
5. If the Bash call fails or is denied, skip silently. Do not retry or ask about it.

### `/capture end`

1. Check for an open span:
   ```bash
   cat captures/.capture-pending 2>/dev/null
   ```
   If the file doesn't exist, print `No capture in progress. Use /capture start "label" first.` and stop.
2. Read the label from the file.
3. Read ALL exchange files from `.span/`:
   ```bash
   cat captures/.span/[0-9]*.md 2>/dev/null
   ```
   This is the recorded transcript — already on disk, compaction-proof.
4. Also review any conversation exchanges in current context that occurred AFTER the last saved exchange (there may be 1-2 unsaved exchanges from the current turn). Include these too.
5. Build the final capture content with TWO parts:

   **Part 1: Transcript.** Combine all exchange files into one transcript:
   ```
   ## Transcript
   <contents of 000.md>
   <contents of 001.md>
   ...
   <any unsaved exchanges from current context>
   ```

   **Part 2: Synthesis.** After the transcript, add:
   ```
   ## Insight
   The key finding or conclusion from the span (1-3 sentences)

   ## Context
   - Summarize the reasoning chain as 4-8 bullet points

   ## Tags
   tag1, tag2, tag3

   ## Related
   - paths, endpoints, artifacts touched during the span
   ```
6. Generate a slug from the insight (not the label). 3-5 words.
7. Get the current timestamp in `YYYY-MM-DD-HHMMSS` format.
8. Run ONE Bash command to create the `.pfm` and clean up:
   ```bash
   pfm create -a "claude-code" -m "claude-opus-4-6" \
     -c $'...' \
     -o captures/YYYY-MM-DD-HHMMSS-slug.pfm && \
   rm -rf captures/.span captures/.capture-pending
   ```
9. Print ONE confirmation line: `Captured span "label": filename.pfm (N exchanges)` — then stop.

### `/capture compact`

Mid-span checkpoint. Merges everything recorded so far into a `.pfm` WITHOUT closing the span. The span stays open and keeps recording.

1. Check for an open span (same as `/capture end` step 1).
2. Read the label and all exchange files from `.span/`.
3. If `.span/` has 0 exchange files, print `Nothing to compact yet.` and stop.
4. Build the capture content (transcript + synthesis) exactly like `/capture end`.
5. Create the `.pfm`:
   ```bash
   pfm create -a "claude-code" -m "claude-opus-4-6" \
     -c $'...' \
     -o captures/YYYY-MM-DD-HHMMSS-slug.pfm
   ```
6. **Clear the span folder but keep it open:**
   ```bash
   rm captures/.span/[0-9]*.md && \
   echo "0" > captures/.span/.counter
   ```
   The `.capture-pending` file stays. The span continues.
7. Print ONE confirmation line: `Compacted N exchanges: filename.pfm — span still open` — then stop.

Use `/capture compact` when:
- The session is getting long and compaction feels close
- You want to checkpoint progress without ending the span
- Multiple `.pfm` files from the same span is fine — each gets its own UUID

### `/capture list`

Run ONE Bash command:
```bash
ls -1 captures/*.pfm 2>/dev/null | sed 's|captures/||' || echo "No captures yet."
```
Print the output. Nothing else.

### `/capture search <term>`

Run ONE Grep call on path `captures/` with the search term pattern and glob `*.pfm`, output_mode `content`.
Print the matching lines grouped by file. Nothing else.

## Rules

- **Speed over polish.** Each capture command = minimum tool calls (1-2 max).
- **Never ask clarifying questions.** Make your best judgment and capture.
- **Never elaborate after capturing.** One confirmation line, then return to the user's work.
- **Per-exchange auto-save is SILENT.** Never mention it, never print confirmation. It's invisible plumbing.
- **All .pfm creation goes through `pfm create` CLI.** Never use Write tool for `.pfm` files — that would bypass checksums.
- **The `captures/` directory is always gitignored.** Always ensure `.gitignore` exists before first capture.
- **Filenames are the index.** Sorted `ls` gives chronological order. No separate index file needed.
- **`-l` flag overrides base path.** When present, use that path instead of cwd. When reading `.capture-pending` for span operations, check line 2 for the stored base path.
- **Default base = current working directory** for the `captures/` folder, not home directory.
- **Only one span at a time.** If `/capture start` is called while a span is open, print `Span already open: "label". Use /capture end first.` and stop.
- **Span marker is ephemeral.** `.capture-pending` and `.span/` are deleted on `/capture end`. If a session ends without `/capture end`, a new session can run `/capture end` to recover whatever exchanges were saved to `.span/` (the files on disk survive even if context is gone).
