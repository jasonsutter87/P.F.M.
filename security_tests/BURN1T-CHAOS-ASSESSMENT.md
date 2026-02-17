# Chaos Assessment - Burn1t (Round 2)
**Date:** 2026-02-16
**Project:** PFM (Pure Fucking Magic) - Custom file format with multi-platform implementations
**Scope:** /Users/jasonsutter/Documents/Companies/pfm (EXACT path, analysis only)
**Assessor:** Burn1t Chaos Agent (Opus 4.6)

## Scope Verification
- [x] Within allowed project boundary
- [x] Analysis only - NO destructive actions taken
- [x] All findings verified against actual source code line-by-line

---

## Status of Prior Findings

The previous Burn1t assessment identified 14 vectors. The codebase has since been hardened through multiple rounds of fixes. Here is the current status:

| Prior Finding | Status | Evidence |
|--------------|--------|----------|
| Memory Bomb (no file size limit) | **FIXED** -- `MAX_FILE_SIZE = 500MB` enforced in `read()` and `open()` | `reader.py` L94-102, L207-214 |
| Recovery data destruction (no backup) | **FIXED** -- backup created before truncation, `rfind` used for markers | `stream.py` L257-258, L311 |
| Section injection (no escaping) | **FIXED** -- `escape_content`/`unescape_content` implemented | `spec.py` L104-146 |
| Index poisoning (no bounds check) | **FIXED** -- bounds validation: `0 <= off and off + ln <= self._file_size` | `reader.py` L295-296 |
| Checksum bypass (missing = valid) | **FIXED** -- `return False` when no checksum present (fail-closed) | `reader.py` L381, `security.py` L251 |
| Signature stripping | **MITIGATED** -- `verify()` has `require=True` parameter | `security.py` L60-75 |
| Encryption bit-flip | **ACKNOWLEDGED** -- inherent to AES-GCM, not a bug |
| PBKDF2 CPU burn | **ACKNOWLEDGED** -- by-design, 600K iterations per OWASP | `security.py` L131 |
| Stream writer no limits | **FIXED** -- `MAX_FILE_SIZE`, `MAX_SECTIONS`, name validation enforced | `stream.py` L130-164 |
| Race condition (no locking) | **FIXED** -- file locking via `fcntl.flock` in recovery | `stream.py` L321-328 |
| setattr injection | **FIXED** -- strict `META_ALLOWLIST` with custom_meta overflow | `reader.py` L162-175 |
| CLI path traversal | **FIXED** -- `..` rejected, path must be under cwd | `cli.py` L35-45 |
| UTF-8 decode bomb | **MITIGATED** -- generic exception handler in CLI validate | `cli.py` L131-134 |
| Newline round-trip | **ACKNOWLEDGED** -- consistent strip-one-add-one protocol |

**The codebase is substantially hardened.** The findings below represent the REMAINING attack surface after all prior fixes.

---

## Executive Summary

PFM has solid defensive fundamentals -- file size limits, section count caps, meta field limits, prototype pollution guards, CSP headers with nonces, content escaping, index bounds validation, and fail-closed checksum verification. This round focuses on what a chaos actor can STILL do: **denial-of-service through parsing cost amplification**, **cross-implementation inconsistency as a trust-destruction vector**, **the Chrome extension as a privileged blast radius amplifier**, and **CSV formula injection on export**.

---

## NIGHTMARE SCENARIOS

### Nightmare 1: "The 500MB Bomb" -- Full-Parse Memory Amplification

**Severity:** HIGH
**Trigger:** Attacker crafts a file at the 500MB `MAX_FILE_SIZE` limit.

The Python `PFMReader.parse()` at `/Users/jasonsutter/Documents/Companies/pfm/pfm/reader.py` lines 108-110 does:
```python
text = data.decode("utf-8")
lines = text.split("\n")
```
This creates: (1) raw bytes in memory (~500MB), (2) decoded string (~500MB-1GB depending on content), (3) the split list of lines (another copy plus list overhead). A single 500MB file causes **1.5-2.5GB of peak memory allocation**.

The `PFMReader.open()` lazy path (`PFMReaderHandle`) is safe -- it only reads the header. But `PFMReader.read()` and `PFMReader.parse()` load everything. The stream `_recover()` at `/Users/jasonsutter/Documents/Companies/pfm/pfm/stream.py` line 260 also reads the entire file into memory.

**Blast Radius:** CLI commands `pfm validate`, `pfm inspect`, `pfm convert`, `pfm read` (when using full parse), the web generator, any pipeline calling `PFMReader.read()`. On a constrained system (CI runner, Docker container with memory limits), this is an OOM kill.

**Why 500MB is too high:** Agent conversations almost never exceed 10MB. The default limit is 50x what any realistic use case requires.

**Affected Files:**
- `/Users/jasonsutter/Documents/Companies/pfm/pfm/reader.py` lines 94-105 (`read()` full parse path)
- `/Users/jasonsutter/Documents/Companies/pfm/pfm/reader.py` lines 108-110 (`parse()` memory amplification)
- `/Users/jasonsutter/Documents/Companies/pfm/pfm/stream.py` lines 250-261 (`_recover()` full file read)
- `/Users/jasonsutter/Documents/Companies/pfm/pfm/spec.py` line 65 (`MAX_FILE_SIZE = 500 * 1024 * 1024`)

---

### Nightmare 2: "The Checksum Gap" -- Default Read Path Skips Integrity Verification

**Severity:** CRITICAL (for trust model)
**Trigger:** Modify section content in a .pfm file, leave the stale checksum in meta.

`PFMReader.read()` at `/Users/jasonsutter/Documents/Companies/pfm/pfm/reader.py` lines 93-105 returns a `PFMDocument` without validating the checksum. The document's `checksum` field contains the OLD value from the meta section, but the content has been tampered with. Any consumer that trusts the document without explicitly calling `verify_integrity()` gets silently corrupted data.

The CLI `pfm read` command at `/Users/jasonsutter/Documents/Companies/pfm/pfm/cli.py` lines 94-104 does NOT validate the checksum -- it reads and prints. The CLI `pfm convert` at lines 137-170 also does not validate. Only `pfm validate` explicitly checks.

The Chrome extension viewer computes the checksum asynchronously at `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/viewer/viewer.js` lines 57-63:
```javascript
PFMParser.checksum(doc.sections).then(computed => {
    state.checksumValid = (computed === (doc.meta.checksum || ''));
    renderChecksumBadge();
});
showViewer();
render(); // User sees content BEFORE checksum resolves
```
A user could export (JSON, MD, CSV, TXT) before the async checksum check completes.

**Blast Radius:** If PFM files are used as evidence of agent output (the stated use case), tampered files with valid-looking checksums destroy the entire trust model. The `pfm read` and `pfm convert` commands are the most common consumer paths and neither validates.

**Affected Files:**
- `/Users/jasonsutter/Documents/Companies/pfm/pfm/reader.py` lines 93-105
- `/Users/jasonsutter/Documents/Companies/pfm/pfm/cli.py` lines 94-104, 137-170
- `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/viewer/viewer.js` lines 57-64

---

### Nightmare 3: "Chrome Extension Blast Radius" -- Total AI Conversation Exfiltration

**Severity:** CRITICAL (blast radius, not current vulnerability)
**Trigger:** Supply-chain attack on the Chrome extension (compromised update push).

The Chrome extension manifest at `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/manifest.json` declares content scripts that run on:
```json
"matches": [
    "https://chat.openai.com/*",
    "https://chatgpt.com/*",
    "https://claude.ai/*",
    "https://gemini.google.com/*"
]
```

These content scripts have **full DOM access** on those pages. A compromised extension could:
1. Exfiltrate every AI conversation (past, present, future) from all three platforms
2. Inject content into conversations (modify what the user sees the AI saying)
3. Read session tokens accessible to content scripts
4. Use `chrome.storage` (permitted) as an exfiltration staging area
5. Modify captured conversation data before serialization to .pfm

The permissions (`activeTab`, `scripting`, `storage`) are individually reasonable, but content script injection on AI platforms means a compromised extension has **total access to the user's AI interaction history across all three major platforms**.

**Blast Radius:** Every user who installs the extension. All their conversations on ChatGPT, Claude, and Gemini. Their session tokens on those platforms.

**Recovery Time:** Users must uninstall, rotate all sessions on affected platforms, treat all captured .pfm files as potentially tampered.

**Headline:** "Chrome extension that captures AI conversations caught stealing user data"

The `viewer.html` at `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/viewer/viewer.html` notably has NO Content-Security-Policy meta tag, unlike the web server's generated HTML which has a strict CSP with nonces. If the viewer page could be navigated to from a hostile context, inline scripts would execute without CSP protection.

**Affected Files:**
- `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/manifest.json` lines 22-44
- `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/content/content-main.js` (full DOM access)
- `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/content/scraper-chatgpt.js`
- `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/content/scraper-claude.js`
- `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/content/scraper-gemini.js`
- `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/viewer/viewer.html` (no CSP)

---

### Nightmare 4: "Cross-Implementation Parsing Divergence"

**Severity:** HIGH
**Trigger:** Craft a .pfm file that parses differently across the four implementations.

There are FOUR independent parsers:
1. **Python full:** `/Users/jasonsutter/Documents/Companies/pfm/pfm/reader.py` L108-198
2. **Python lazy:** `/Users/jasonsutter/Documents/Companies/pfm/pfm/reader.py` L241-300
3. **pfm-js:** `/Users/jasonsutter/Documents/Companies/pfm/pfm-js/src/parser.ts` L45-151
4. **Chrome:** `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/shared/pfm-core.js` L19-116
5. **VS Code:** `/Users/jasonsutter/Documents/Companies/pfm/pfm-vscode/src/parser.ts` L71-192

Specific divergence points verified in code:

**Meta field handling:** The Python parser uses `setattr(doc, key, val)` for allowlisted keys at `reader.py` line 168, storing them as dataclass fields. The JS/Chrome/VS Code parsers store ALL meta fields in a flat `doc.meta` object. A meta key like `format_version` (which is on the allowlist as... wait, it is NOT on the allowlist -- checking: `META_ALLOWLIST = frozenset({"id", "agent", "model", "created", "checksum", "parent", "tags", "version"})` at `spec.py` line 62). So `format_version` would go into `custom_meta` in Python but into `meta` in JS. This is actually consistent since the JS parsers also only use the flat object. The divergence is structural: Python separates allowlisted fields as object attributes vs. custom fields as a dict, while JS uses one flat dict. Edge case: a meta key that shadows a built-in PFMDocument field but is not on the allowlist.

**Lazy reader vs. full parser:** The Python `PFMReaderHandle._parse_header()` at `reader.py` lines 241-275 stops at the first content section header. The full parser continues through the entire file. If a file has interleaved meta sections (e.g., `#@meta` appearing again after content sections), the lazy reader would ignore it but the full parser would process it. The lazy reader also applies `MAX_META_FIELDS` differently (line 281: counts unique keys in `self.meta` dict) vs. the full parser (line 171: counts `doc.custom_meta` size). Since allowlisted fields go to dataclass attributes in full parse but to `self.meta` in lazy parse, the counting semantics differ.

**Version validation:** The Python parser at `reader.py` line 127 validates `SUPPORTED_FORMAT_VERSIONS` and raises `ValueError` for unsupported versions. The JS/Chrome/VS Code parsers accept ANY version string without validation. A file with `#!PFM/2.0` would be rejected by Python but parsed successfully by JS.

**Blast Radius:** A file that validates in one implementation but not another, or produces different section content, destroys interoperability trust. An attacker could craft a file that shows benign content in the Chrome viewer but different content in the Python reader.

**Affected Files:**
- `/Users/jasonsutter/Documents/Companies/pfm/pfm/reader.py` lines 127-131 (version validation -- Python only)
- `/Users/jasonsutter/Documents/Companies/pfm/pfm-js/src/parser.ts` lines 64-71 (no version validation)
- `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/shared/pfm-core.js` lines 39-46 (no version validation)
- `/Users/jasonsutter/Documents/Companies/pfm/pfm-vscode/src/parser.ts` lines 94-103 (no version validation)

---

### Nightmare 5: "CSV Formula Injection" -- Exported PFM Runs Code in Spreadsheets

**Severity:** MEDIUM
**Trigger:** Craft section content starting with `=`, `+`, `-`, or `@`, then export to CSV.

The Python `to_csv()` at `/Users/jasonsutter/Documents/Companies/pfm/pfm/converters.py` lines 101-119 uses `csv.writer`:
```python
writer.writerow(["section", section.name, section.content])
```
If `section.content` is `=HYPERLINK("http://evil.com","Click")`, the CSV cell is interpreted as a formula by Excel/Google Sheets/LibreOffice. More dangerously, in older Excel versions: `=cmd|'/C calc'!A0`.

The Chrome extension CSV export at `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/viewer/viewer.js` lines 248-255 also has no formula escaping:
```javascript
csv += '"' + s.name.replace(/"/g, '""') + '","' + s.content.replace(/"/g, '""') + '"\n';
```

**Blast Radius:** Any user who exports a PFM document to CSV and opens it in a spreadsheet application. Agent-generated content could naturally contain `=` at line starts (code, math).

**Affected Files:**
- `/Users/jasonsutter/Documents/Companies/pfm/pfm/converters.py` lines 101-119 (`to_csv`)
- `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/viewer/viewer.js` lines 248-255 (`exportCSV`)

---

### Nightmare 6: "Stream Recovery Data Corruption"

**Severity:** HIGH
**Trigger:** Corrupted mid-write file where an escape sequence was partially written.

The `_recover()` function at `/Users/jasonsutter/Documents/Companies/pfm/pfm/stream.py` lines 241-332 scans the raw file text looking for section markers. Line 276 checks:
```python
if line.startswith(SECTION_PREFIX) and not line.startswith("\\#"):
```

This correctly skips escaped lines. But if a crash happened mid-write during an escape sequence -- for example, the writer was writing `\#@index-trailing` as escaped content but crashed after writing `#@index-trailing` (without the leading backslash) -- the recovery function would interpret the partial write as a real section header.

The `rfind` for the trailing index marker at line 311 is correct (searches from end), but the section-boundary scan at lines 271-299 processes linearly from the start, and a partially-written escape could cause it to split a content section at the wrong point.

**Blast Radius:** Silent data loss or section boundary corruption in the specific file being recovered. The backup at line 258 (`shutil.copy2`) mitigates permanent loss.

**Affected Files:**
- `/Users/jasonsutter/Documents/Companies/pfm/pfm/stream.py` lines 241-332

---

### Nightmare 7: "VS Code Preview Keystroke Amplification"

**Severity:** MEDIUM
**Trigger:** Open a large .pfm file in VS Code with the preview panel active.

The preview panel at `/Users/jasonsutter/Documents/Companies/pfm/pfm-vscode/src/preview/previewPanel.ts` lines 23-26:
```typescript
const watcher = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document.uri.toString() === uri.toString()) {
        this.update(e.document.getText()); // Full re-parse + HTML gen on EVERY change
    }
});
```

Every keystroke triggers `parsePFM()` on the entire document text, followed by `getHtml()` which embeds ALL section content via `esc()` calls. For a file with large sections, this causes VS Code to stutter or freeze on every keystroke.

**Blast Radius:** Developer's VS Code instance. Force-close may be needed.

**Affected Files:**
- `/Users/jasonsutter/Documents/Companies/pfm/pfm-vscode/src/preview/previewPanel.ts` lines 23-26

---

## Single Points of Failure

| Component | Failure Impact | Backup Exists? | Recovery Plan? |
|-----------|---------------|----------------|----------------|
| `spec.py` constants (MAGIC, SECTION_PREFIX, escape logic) | All parsers break if changed incompatibly | No -- hardcoded across 4 independent codebases | Manual coordinated update |
| SHA-256 checksum algorithm | All integrity verification breaks | No fallback algorithm | Would require format version bump to 2.0 |
| `MAX_FILE_SIZE` = 500MB default | Memory exhaustion in full-parse mode | No per-section limit exists | Lower default, add `MAX_SECTION_SIZE` |
| `escape_content` / `unescape_content` round-trip | Content corruption or marker injection | No redundant encoding scheme | If broken, section boundaries dissolve |
| Chrome extension signing key | Malicious update to all users | Chrome Web Store review process | Emergency unpublish, user notification |
| PFMWriter index offset convergence loop | Corrupted index if loop does not converge | 3-attempt hard limit | File readable via full parse, index unreliable |
| File lock in `_recover()` | TOCTOU if lock fails to acquire | Lock failure raises RuntimeError (fail-safe) | User must retry after other process releases |
| Stream writer `os.fsync()` on every section | Disk I/O bottleneck, but crash-safe | No async option | Trade-off: safety vs. performance |

---

## Destruction Vectors (All Verified in Current Code)

| # | Vector | Method | Impact | Difficulty | Affected File(s) |
|---|--------|--------|--------|------------|-------------------|
| D1 | Memory exhaustion via large file | Submit 499MB file to `PFMReader.read()` or `parse()` | OOM kill, pipeline crash | **Easy** | `pfm/reader.py` L94-110, `pfm/stream.py` L250-261 |
| D2 | Checksum trust bypass | Modify content, leave stale checksum -- readers that skip validation get tampered data | Silent data tampering | **Easy** | `pfm/reader.py` L93-105, `pfm/cli.py` L94-170 |
| D3 | Chrome extension supply chain | Compromise extension, push update | Exfiltrate all AI conversations from all users | **Hard** | `pfm-chrome/manifest.json` |
| D4 | Cross-implementation divergence | File with `#!PFM/2.0` -- Python rejects, JS/Chrome/VSCode accept | Different behavior across implementations | **Medium** | All 4+ parsers |
| D5 | CSV formula injection on export | Section content starting with `=`, `+`, `-`, `@` | Code execution in spreadsheets | **Easy** | `pfm/converters.py` L101-119, `pfm-chrome/viewer/viewer.js` L248-255 |
| D6 | Stream recovery partial-escape | Crash during escape write, recovery misparses | Section boundary corruption (backup exists) | **Hard** | `pfm/stream.py` L241-332 |
| D7 | VS Code preview keystroke storm | Open large .pfm with preview, every keystroke re-parses | VS Code freeze/unresponsive | **Easy** | `pfm-vscode/src/preview/previewPanel.ts` L23-26 |
| D8 | Browser tab DoS via Chrome parser | Load maximum-size content into extension viewer via session storage | Browser tab crash | **Medium** | `pfm-chrome/viewer/viewer.js`, `pfm-chrome/popup/popup.js` L146 |
| D9 | Markdown export injection | Section content with malicious markdown; rendered in unsafe downstream viewer | XSS in downstream renderers | **Medium** | `pfm/converters.py` L198-227, `pfm-js/src/convert.ts` L91-121 |
| D10 | PBKDF2 CPU exhaustion | Submit many .pfm.enc files forcing decryption attempts | CPU burn (0.5-2s per attempt, 600K iterations) | **Medium** | `pfm/security.py` L129-137 |

---

## Resilience Gaps

### 1. No Per-Section Size Limit
The format limits total file size (500MB) and section count (10,000) but has NO per-section content size limit. A single section could contain 499MB. There is no `MAX_SECTION_SIZE` constant in `/Users/jasonsutter/Documents/Companies/pfm/pfm/spec.py`.

### 2. No Default Checksum Enforcement on Read
`PFMReader.read()` returns a document without validating the checksum. The field is populated from meta but never verified unless the caller explicitly calls `verify_integrity()`. The most common consumer paths (CLI `read`, CLI `convert`, library `PFMReader.read()`) are all "fail-open" for integrity.

### 3. No CSP on Chrome Extension Viewer HTML
The viewer HTML at `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/viewer/viewer.html` has no Content-Security-Policy meta tag. The web server's generated HTML (`pfm/web/generator.py`) correctly has CSP with nonces, and the VS Code webview has CSP. The Chrome viewer is the gap.

### 4. No Format Version Validation in JS Implementations
Python rejects unknown format versions (`SUPPORTED_FORMAT_VERSIONS` check at `reader.py` line 127). The three JS-based parsers (pfm-js, Chrome, VS Code) accept any version string without validation. This means a file crafted with a future or fake version number would be rejected by Python but accepted by JS, creating a divergence vector.

### 5. No Debounce on VS Code Preview Updates
The `onDidChangeTextDocument` watcher fires on every keystroke with no throttle or debounce, causing repeated full re-parse and HTML generation.

### 6. No Monitoring or Telemetry
Zero logging of parse failures, checksum mismatches, oversized files, or malformed input. If crafted files are being submitted to a PFM-consuming pipeline, there is no way to detect an attack pattern.

### 7. Session Storage Size Limit in Chrome Extension
The Chrome extension stores full .pfm content in `chrome.storage.session` for popup-to-viewer handoff at `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/popup/popup.js` line 146. Session storage has size limits (~10MB). A large file could fail silently. The popup has a 50MB file size check (line 125) but session storage may reject much smaller payloads.

---

## Recommendations for Red Team

### Priority 1: CRITICAL -- Lower Default Memory Budget
1. Reduce `MAX_FILE_SIZE` from 500MB to 50MB (or 100MB). Agent conversations do not reach 500MB.
2. Add `MAX_SECTION_SIZE` constant to `spec.py` (e.g., 50MB per section).
3. The full-parse path should consider incremental parsing or at minimum warn when approaching limits.

**File:** `/Users/jasonsutter/Documents/Companies/pfm/pfm/spec.py` line 65

### Priority 2: CRITICAL -- Default Checksum Validation on Read
4. Add a `validate: bool = True` parameter to `PFMReader.read()`. When True (default), compute the checksum after parsing and raise or warn if it does not match.
5. CLI `pfm read` and `pfm convert` should validate before outputting, with a `--no-validate` opt-out.

**Files:** `/Users/jasonsutter/Documents/Companies/pfm/pfm/reader.py`, `/Users/jasonsutter/Documents/Companies/pfm/pfm/cli.py`

### Priority 3: HIGH -- CSV Formula Injection Protection
6. In `to_csv()`, prefix cell values that start with `=`, `+`, `-`, `@`, `\t`, `\r` with a single quote (`'`) or tab character to prevent formula interpretation.
7. Same fix in Chrome extension `exportCSV()`.

**Files:** `/Users/jasonsutter/Documents/Companies/pfm/pfm/converters.py` L101-119, `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/viewer/viewer.js` L248-255

### Priority 4: HIGH -- Format Version Validation in JS Parsers
8. Add `SUPPORTED_FORMAT_VERSIONS` check to all three JS/TS parsers, matching the Python behavior. Reject or warn on unknown versions.

**Files:** `/Users/jasonsutter/Documents/Companies/pfm/pfm-js/src/parser.ts`, `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/shared/pfm-core.js`, `/Users/jasonsutter/Documents/Companies/pfm/pfm-vscode/src/parser.ts`

### Priority 5: HIGH -- VS Code Preview Debouncing
9. Add a 300-500ms debounce to the `onDidChangeTextDocument` watcher in the preview panel.

**File:** `/Users/jasonsutter/Documents/Companies/pfm/pfm-vscode/src/preview/previewPanel.ts` L23-26

### Priority 6: MEDIUM -- Chrome Extension Viewer CSP
10. Add a `<meta http-equiv="Content-Security-Policy">` tag to `viewer.html` matching the web generator's policy.

**File:** `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/viewer/viewer.html`

### Priority 7: MEDIUM -- Cross-Implementation Conformance Test Suite
11. Create a shared corpus of edge-case .pfm files and verify all implementations produce identical output. Critical cases:
    - `#!PFM/2.0` (unknown version)
    - Content starting with `#@` (must be escaped)
    - Content with `\#@` (double-escape)
    - Files with no EOF marker
    - Files with no checksum
    - Files at the 10,000 section limit
    - Stream-mode files with trailing index
    - Meta fields at the allowlist boundary

---

## What Would Make Headlines

1. **"AI conversation capture extension found stealing user data"** -- Chrome extension compromise (D3)
2. **"PFM files tampered without detection via common read commands"** -- Checksum gap (D2)
3. **"Exported AI logs execute code when opened in Excel"** -- CSV formula injection (D5)
4. **"Opening a .pfm file crashes VS Code"** -- Preview amplification (D7)
5. **"Same .pfm file shows different content in different tools"** -- Cross-impl divergence (D4)

---

## What Is Unrecoverable

1. **Chrome extension data exfiltration** -- Once conversations are stolen, they cannot be un-leaked. The extension has direct DOM access to ChatGPT, Claude, and Gemini conversation pages.
2. **Trust model collapse** -- If PFM files are used as audit evidence and the checksum gap is exploited to tamper with files before the consumer validates, credibility damage is permanent.
3. **AES-GCM encrypted files with lost passwords** -- By design, unrecoverable. No key escrow, no recovery mechanism.
