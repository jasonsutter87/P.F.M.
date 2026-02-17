# APT Simulation Report - Specter (Round 2)

**Date:** 2026-02-16
**Project:** PFM (Pure Fucking Magic) - AI Agent Output Container Format
**Scope:** `/Users/jasonsutter/Documents/Companies/pfm` (local code analysis only)
**Threat Model:** Nation-State Actor (Simulated Analysis)
**Analyst:** Specter APT Simulator (Opus 4.6)
**Classification:** SIMULATION ONLY -- No actual attacks executed
**Prior Assessment:** Round 1 (same date) -- many findings were fixed between assessments

## Scope Verification

- [x] Within allowed project boundary (`/Users/jasonsutter/Documents/Companies/pfm`)
- [x] Simulation only -- no actual attacks executed
- [x] No external network connections made
- [x] No files modified except this report

---

## Context: What Changed Since Round 1

Round 1 identified critical issues including section marker injection, setattr abuse, missing index bounds checks, checksum bypass on missing checksums, TOCTOU race conditions, CLI path traversal, HMAC signing weaknesses, and AES-GCM without AAD. The codebase has since undergone significant hardening:

**FIXED since Round 1:**
- Content escaping implemented (`escape_content` / `unescape_content` in `spec.py`)
- Meta parsing now uses a strict `META_ALLOWLIST` frozenset (no longer `hasattr()`)
- Index bounds validation added (`0 <= off and off + ln <= self._file_size`)
- Checksum validation now fail-closed (`return False` when no checksum present)
- Stream recovery uses `rfind()` instead of `index()` for trailing marker search
- Stream recovery now uses file locking (`fcntl.flock()`) to prevent TOCTOU
- Stream recovery creates backup files before modification
- CLI `--file` flag now validates paths against CWD with `resolve()` and `relative_to()`
- HMAC signing uses length-prefixed encoding (struct.pack `>I`) instead of null-byte delimiters
- HMAC signing now includes `format_version` and preserves section ordering
- AES-GCM now uses AAD (`_AES_AAD = b"PFM-ENC/1.0"`)
- Format version validation enforces `SUPPORTED_FORMAT_VERSIONS` frozenset
- Fingerprint length increased to 32 hex characters (128-bit collision resistance)
- Section count limits enforced (`MAX_SECTIONS = 10_000`)
- Meta field count limits enforced (`MAX_META_FIELDS = 100`)
- Section name validation (lowercase alphanumeric + hyphens + underscores, max 64 chars)
- File permissions set explicitly (0o644)
- Prototype pollution prevention in all JS parsers (reject `__proto__`, `constructor`, `prototype`)
- Web server binds localhost only with security headers and CSP nonces
- VS Code webview uses nonce CSP, HTML escaping, empty `localResourceRoots`
- Timing-safe comparison (`hmac.compare_digest`) used for checksum validation in reader and security module
- HTML generator escapes `</` and `<!--` for safe script embedding
- Chrome extension validates sender ID on all message handlers

This Round 2 assessment focuses on **residual risks, new attack surfaces, and APT-level threats that persist despite the hardening**.

---

## Executive Summary

The PFM project has been substantially hardened since Round 1. The most egregious vulnerabilities (marker injection, arbitrary setattr, missing bounds checks, fail-open checksums, TOCTOU races) are now addressed. However, from a nation-state APT perspective, several real and exploitable attack surfaces remain:

1. **The Chrome extension is an intelligence goldmine** -- it captures full AI conversations from ChatGPT, Claude, and Gemini with minimal permissions, and a supply chain compromise would create an automated surveillance tool
2. **Custom meta fields provide a steganographic covert channel** that bypasses both checksum validation (which covers only section content) and casual inspection (values are truncated in display)
3. **The HMAC signature and content checksum are independent systems** -- validating one does not validate the other, and most consumers only check the checksum
4. **Stream recovery creates persistent .bak files** containing sensitive data that are never cleaned up
5. **The generated HTML viewer has a CSP inconsistency** with inline onclick handlers that may not execute under the nonce-based policy

**Overall APT Exploitability Rating: MEDIUM-HIGH** (reduced from HIGH in Round 1 due to extensive hardening)

---

## Kill Chain Analysis

### Phase 1: Attack Surface Map

| Surface | Entry Points | Trust Boundary |
|---------|-------------|----------------|
| Python reader (`pfm/reader.py`) | `.pfm` file input (file, bytes, stream) | Untrusted files from any source |
| Python CLI (`pfm/cli.py`) | Command-line arguments, stdin, `--file` flag | User shell, pipes |
| Python web server (`pfm/web/server.py`) | HTTP GET on localhost | Local network (127.0.0.1) |
| Python converters (`pfm/converters.py`) | JSON, CSV, Markdown, TXT input | Untrusted file formats |
| JS/TS parser (`pfm-js/src/parser.ts`) | String input from any JS context | npm package consumers |
| Chrome extension (`pfm-chrome/`) | AI chat platform DOMs (ChatGPT, Claude, Gemini) | Web page content |
| VS Code extension (`pfm-vscode/`) | `.pfm` files opened in editor | Workspace files |
| HTML generator (`pfm/web/generator.py`) | PFM content embedded in HTML | Browser rendering context |

### Phase 2: Persistence Opportunity Analysis

| Vector | Survivability | Stealth Level |
|--------|-------------|---------------|
| Chrome extension `chrome.storage.local` | Survives browser restart | HIGH |
| VS Code extension activation on `.pfm` open | Survives editor restart | MEDIUM |
| `.pfm` file on disk | Survives system restart | HIGH -- looks like data file |
| Custom meta fields in `.pfm` | Survives read/write cycles | HIGH -- unlimited key names |
| Stream mode `.pfm.bak` files | Created during recovery, never cleaned up | HIGH |

### Phase 3: Lateral Movement Paths

| From | To | Mechanism |
|------|-----|-----------|
| Crafted `.pfm` file | VS Code webview | Preview panel renders content |
| Crafted `.pfm` file | Web browser | `pfm view --web` serves HTML |
| Chrome extension | AI platform session | Content script DOM access |
| JSON converter input | PFM document | `from_json()` creates arbitrary sections |

### Phase 4: Data Targets

| Target | Location | Value |
|--------|----------|-------|
| AI conversation histories | Chrome extension scraper output | HIGH -- proprietary prompts |
| Encryption passwords | `security.py` (in-memory) | CRITICAL |
| HMAC signing secrets | `security.py` (in-memory) | CRITICAL |
| User AI platform sessions | Chrome content script DOM | HIGH |
| Source URLs of conversations | Meta `source_url` field | MEDIUM -- browsing history |

---

## Findings

### FINDING SPT-001: Chrome Extension as Pre-Built AI Surveillance Infrastructure

**Severity:** HIGH
**Category:** Data Exfiltration Vector / Supply Chain Risk
**Affected Files:**
- `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/content/scraper-chatgpt.js`
- `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/content/scraper-claude.js`
- `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/content/scraper-gemini.js`
- `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/content/content-main.js`
- `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/manifest.json`

**Analysis:**

The Chrome extension injects content scripts into three major AI platforms. These scripts have full DOM read access and capture complete conversation histories:

```javascript
// scraper-chatgpt.js lines 76-80
if (userEl) {
  text = userEl.innerText.trim();
  role = 'user';
} else if (assistantEl) {
  text = assistantEl.innerText.trim();
```

The captured data includes: full message text, user/assistant roles, page URL (with conversation IDs), conversation title, and model name. The meta section records `source_url` (line 118 of content-main.js).

The manifest requests `scripting`, `activeTab`, and `storage` permissions. Content scripts can make arbitrary `fetch()` calls -- the manifest's `content_security_policy` only restricts extension pages, NOT content scripts.

**APT Exploitation (APT29 - Cozy Bear):**
A supply chain compromise of the Chrome Web Store publisher account would give an attacker a turnkey AI conversation surveillance tool. The attacker would modify `handleCapture()` to add a single `fetch()` to a C2 before the download, or add a `MutationObserver` for passive real-time collection without requiring user clicks. The extension already has all the permissions needed. No behavioral change would be visible to the user.

The `chrome.storage.local` persistence (used for theme preference at viewer.js line 272) could store C2 configuration that survives extension updates.

**Evidence in Code:**
```javascript
// manifest.json lines 46-50
"permissions": [
  "activeTab",
  "scripting",
  "storage"
]
```

The extension's CSP restricts extension pages (`script-src 'self'`) but does NOT restrict content script network access:
```json
// manifest.json lines 51-53
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'none';"
}
```

---

### FINDING SPT-002: Custom Meta Fields as Steganographic Covert Channel

**Severity:** MEDIUM-HIGH
**Category:** Stealth Data Exfiltration / Covert Channel
**Affected Files:**
- `/Users/jasonsutter/Documents/Companies/pfm/pfm/reader.py` (lines 163-175)
- `/Users/jasonsutter/Documents/Companies/pfm/pfm/document.py` (line 51, lines 134-142)
- `/Users/jasonsutter/Documents/Companies/pfm/pfm/spec.py` (line 67)

**Analysis:**

The format allows up to 100 custom meta fields with arbitrary key names and arbitrary-length string values. The ONLY constraints are:
1. Key must not be in `META_ALLOWLIST` (standard field names) -- goes to `custom_meta` dict instead
2. Total count capped at 100
3. No per-field size limit
4. No key name format validation in the reader's custom meta path

```python
# reader.py lines 170-175
else:
    if len(doc.custom_meta) >= MAX_META_FIELDS:
        raise ValueError(...)
    doc.custom_meta[key] = val
```

**Critical Gap: Checksum Does Not Cover Meta Fields.**

```python
# document.py lines 127-132
def compute_checksum(self) -> str:
    h = hashlib.sha256()
    for section in self.sections:
        h.update(section.content.encode("utf-8"))
    return h.hexdigest()
```

The `compute_checksum()` method hashes ONLY section content. Custom meta fields are entirely outside the checksum scope. This means:
- An attacker can add, modify, or remove custom meta fields
- The checksum will still validate as VALID
- `pfm validate` reports "OK" because it only checks the checksum

The HMAC signature DOES cover meta fields (via `get_meta_dict()` in `_build_signing_message()`), but:
1. Most consumers call `validate_checksum()`, not `verify()` (which requires a shared secret)
2. The CLI `pfm validate` only checks the checksum, not the HMAC signature
3. There is no CLI command to verify HMAC signatures at all

**Covert Channel Construction:**
An attacker embeds base64-encoded exfiltration data in custom meta fields with innocuous names (`opt_hint_42`, `trace_correlation`, `cache_epoch`). The `pfm inspect` command truncates values at 72 characters (cli.py line 77: `display = val if len(val) <= 72 else val[:69] + "..."`), so long encoded payloads are hidden from casual inspection.

Estimated capacity: 100 fields x ~100KB per field (no hard limit) = ~10MB of covert data per `.pfm` file that passes all standard validation.

---

### FINDING SPT-003: HMAC Signature and Content Checksum are Independent -- Validation Gap

**Severity:** MEDIUM-HIGH
**Category:** Integrity Bypass
**Affected Files:**
- `/Users/jasonsutter/Documents/Companies/pfm/pfm/security.py` (lines 95-122, 244-253)
- `/Users/jasonsutter/Documents/Companies/pfm/pfm/document.py` (lines 127-132)
- `/Users/jasonsutter/Documents/Companies/pfm/pfm/cli.py` (lines 107-134)

**Analysis:**

PFM has two integrity mechanisms:
1. **Content checksum** (SHA-256 of section contents) -- verified by `validate_checksum()` and `verify_integrity()`
2. **HMAC signature** (HMAC-SHA256 of format version + sorted meta + section names/contents) -- verified by `verify()`

These are completely independent:
- The checksum covers ONLY section content (not meta, not format version, not section names)
- The HMAC covers everything (meta, format version, section names AND content)
- The checksum is always present (computed on write)
- The HMAC is optional (only present if explicitly signed)

The CLI `pfm validate` command (lines 107-134) ONLY checks the checksum. There is no CLI command to verify HMAC signatures. This means:

**Attack: Meta Modification Without Detection**
1. Create a `.pfm` file with valid content and checksum
2. Add or modify custom meta fields (covert data, tracking IDs, etc.)
3. Run `pfm validate` -- reports "OK: valid PFM"
4. The meta modification is invisible to standard validation

**Attack: Section Name Modification Without Checksum Detection**
1. The checksum covers section CONTENT but not section NAMES
2. Rename a section (e.g., "content" to "reasoning") -- the checksum is unchanged
3. Downstream consumers see a "reasoning" section where there should be "content"
4. Only the HMAC signature (if present and verified) would catch this

---

### FINDING SPT-004: Stream Recovery Creates Persistent Backup Files

**Severity:** MEDIUM
**Category:** Persistence / Information Disclosure
**Affected Files:**
- `/Users/jasonsutter/Documents/Companies/pfm/pfm/stream.py` (lines 257-258)

**Analysis:**

```python
# stream.py lines 257-258
backup_path = path.with_suffix(path.suffix + ".bak")
shutil.copy2(path, backup_path)
```

The stream recovery creates `.pfm.bak` files that are:
1. Never cleaned up after successful recovery
2. Created with the same permissions as the original (via `shutil.copy2`)
3. Contain the FULL content of the original file at the time of the crash
4. Created in the same directory as the original

**APT Exploitation:**
In environments where PFM streaming is used for long agent tasks (the stated use case: "4-hour agent task crashes at hour 3"), each crash-recovery cycle creates a new `.bak` file. These files:
- Persist when originals are encrypted, deleted, or rotated
- Are commonly excluded from security scanning (`.bak` extension)
- Accumulate a complete history of agent outputs
- Could be read by any process with filesystem access

---

### FINDING SPT-005: VS Code Preview Webview Configuration

**Severity:** MEDIUM (LOW residual risk)
**Category:** Extension Privilege Analysis
**Affected Files:**
- `/Users/jasonsutter/Documents/Companies/pfm/pfm-vscode/src/preview/previewPanel.ts` (lines 40-49)

**Analysis:**

```typescript
// previewPanel.ts lines 40-49
const panel = vscode.window.createWebviewPanel(
  PFMPreviewPanel.viewType,
  `Preview: ${uri.path.split('/').pop()}`,
  vscode.ViewColumn.Beside,
  {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [],
  }
);
```

**Mitigations present (strong):**
- `localResourceRoots: []` -- webview cannot access any local files
- CSP: `script-src 'nonce-${nonce}'` -- only nonce-bearing scripts execute
- All content HTML-escaped via `esc()` function (proper entity encoding)
- Nonce generated via `crypto.randomBytes(16).toString('base64')` (cryptographically secure)
- No `postMessage` handler in extension (webview cannot call VS Code APIs)

**Residual risk:** `retainContextWhenHidden: true` means the webview JavaScript context persists when hidden. If a CSP bypass existed in VS Code's webview implementation, persistent execution would result. This would require a zero-day in VS Code/Chromium's CSP enforcement.

**Assessment:** The defense is well-layered. This finding is noted for completeness but the residual risk is LOW.

---

### FINDING SPT-006: HTML Generator Inline Event Handlers Conflict with CSP

**Severity:** MEDIUM
**Category:** CSP Inconsistency / XSS Defense Gap
**Affected Files:**
- `/Users/jasonsutter/Documents/Companies/pfm/pfm/web/generator.py` (template around line 379)

**Analysis:**

The generated HTML template includes a nonce-based CSP:
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-__NONCE__'; style-src 'nonce-__NONCE__'; img-src data:;">
```

But the `renderSections` JavaScript function generates inline `onclick` handlers:
```javascript
// generator.py template, approximately line 379
html += '<div class="section-item' + cls + '" onclick="selectSection(' + i + ')">' +
```

Under strict CSP with `script-src 'nonce-...'` (no `'unsafe-inline'`), inline event handlers like `onclick` are blocked by the browser. This means:
1. **In the web server context** (where the CSP is sent as an HTTP header AND meta tag): section clicking may not work in standards-compliant browsers
2. **In the standalone HTML file context**: the meta tag CSP may have different enforcement depending on the browser

The toolbar buttons use `addEventListener` correctly (lines 348-350), but the section list items use inline handlers.

**Assessment:** This is a functional bug that is incidentally security-positive (the CSP correctly blocks potentially dangerous inline handlers). But it indicates an inconsistency in CSP compliance that should be fixed by replacing `onclick` with `addEventListener` in the `renderSections` function. The content itself IS properly escaped (`esc()` uses `textContent`/`innerHTML` for safe encoding), so even if the inline handlers executed, there is no injection vector. But consistent CSP compliance is a best practice.

---

### FINDING SPT-007: Chrome Extension Session Storage Data Leakage

**Severity:** MEDIUM
**Category:** Data Persistence / Information Disclosure
**Affected Files:**
- `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/popup/popup.js` (line 146)
- `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/viewer/viewer.js` (lines 408-416)

**Analysis:**

The popup-to-viewer handoff stores entire file contents in `chrome.storage.session`:

```javascript
// popup.js line 146
await chrome.storage.session.set({ pfm_pending: text, pfm_filename: file.name });
```

The viewer reads and deletes this data:
```javascript
// viewer.js lines 408-413
chrome.storage.session.get(['pfm_pending', 'pfm_filename'], (result) => {
  if (result.pfm_pending) {
    ...
    chrome.storage.session.remove(['pfm_pending', 'pfm_filename']);
```

**Failure scenarios where data persists:**
1. The viewer tab fails to open (e.g., Chrome runs out of memory, tab limit)
2. The `chrome.runtime.sendMessage({ action: 'open_viewer' })` call fails silently
3. The viewer tab opens but crashes before executing the `chrome.storage.session.get` call
4. The `chrome.storage.session.remove` call fails silently

In all these cases, the full `.pfm` content (which may contain AI conversation histories with sensitive prompts) remains in `chrome.storage.session` until the browser session ends (all windows closed). This data is accessible to any JavaScript running in the extension's context.

---

### FINDING SPT-008: Supply Chain Analysis -- Minimal but Unpinned

**Severity:** MEDIUM
**Category:** Supply Chain Integrity
**Affected Files:**
- `/Users/jasonsutter/Documents/Companies/pfm/pyproject.toml`
- `/Users/jasonsutter/Documents/Companies/pfm/pfm-js/package.json`
- `/Users/jasonsutter/Documents/Companies/pfm/pfm-vscode/package.json`

**Analysis:**

**Positive:** Zero runtime dependencies across ALL four implementations. This is exceptional.

**Remaining Risks:**

1. **No committed lock files.** Without `package-lock.json` for `pfm-js/` or `pfm-vscode/`, a compromised npm registry could serve malicious `typescript` during `npm install`. The range `^5.3.0` would accept any 5.x version including a hypothetical backdoored `5.99.0`.

2. **Python build backend unpinned:** `requires = ["setuptools>=68.0", "wheel"]` in `pyproject.toml` accepts any setuptools version >= 68.0.

3. **Optional `cryptography` dependency is runtime-imported without version pin:**
```python
# security.py lines 147-153
try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except ImportError:
    raise ImportError(...)
```
A dependency confusion attack on `cryptography` would compromise all encryption operations.

4. **Chrome extension has zero build dependencies** (all hand-written JS) -- this is a supply chain advantage.

---

### FINDING SPT-009: PFMReader.parse() Has No Size Guard

**Severity:** LOW-MEDIUM
**Category:** Resource Exhaustion / DoS
**Affected Files:**
- `/Users/jasonsutter/Documents/Companies/pfm/pfm/reader.py` (lines 107-198)

**Analysis:**

`PFMReader.read()` (line 94) and `PFMReader.open()` (line 201) both enforce `MAX_FILE_SIZE` (500MB). However, `PFMReader.parse()` (line 108) is a public method that accepts raw `bytes` with NO size check:

```python
@classmethod
def parse(cls, data: bytes) -> PFMDocument:
    text = data.decode("utf-8")
    lines = text.split("\n")
```

A library consumer calling `parse()` directly (which is the expected API for programmatic use) bypasses all size limits. The `data.decode("utf-8")` + `text.split("\n")` creates ~3x memory amplification (bytes + string + list of lines).

**Assessment:** LOW-MEDIUM. The `read()` and `open()` methods are properly guarded. This affects only library consumers who call `parse()` directly. The 500MB default for the file-based methods is itself quite generous.

---

### FINDING SPT-010: Web Server Logging Suppressed

**Severity:** LOW
**Category:** Defense Evasion / Monitoring Gap
**Affected Files:**
- `/Users/jasonsutter/Documents/Companies/pfm/pfm/web/server.py` (line 83)

**Analysis:**

```python
# server.py line 83
def log_message(self, format: str, *args) -> None:
    # Suppress default request logging
    pass
```

The web server explicitly suppresses all HTTP request logging. While this is likely a UX decision (avoid cluttering the terminal), it means:
- There is no record of who accessed the served PFM content
- Port-scan probes to the local server are invisible
- If another local process discovers the port (it is predictable if not 0), it can read the PFM data without any trace

Combined with the fact that the server binds to `127.0.0.1` (not just `localhost`), any local process can access it. The server version is also suppressed (`server_version = "PFM"`, `sys_version = ""`), which is good for information hiding but makes forensic analysis harder.

---

## Attack Scenarios

### Scenario 1: AI Conversation Surveillance via Chrome Extension Supply Chain

**Threat Actor:** APT29 (Cozy Bear)
**Objective:** Mass surveillance of AI conversations across ChatGPT, Claude, and Gemini
**Likelihood:** MEDIUM (requires Chrome Web Store publisher compromise)
**Impact:** CRITICAL -- access to proprietary prompts, trade secrets, internal deliberations

**Kill Chain:**
1. **Initial Access:** Compromise the Chrome Web Store publisher account via phishing, credential stuffing, or insider recruitment.
2. **Weaponization:** Modify `content-main.js` `handleCapture()` to add a `fetch()` call sending `pfmContent` to a C2 endpoint before the local download. Alternatively, inject a silent `MutationObserver` that captures messages in real-time without requiring user interaction.
3. **Persistence:** Store C2 URL in `chrome.storage.local` (already permitted by `storage` permission). Configuration survives extension updates.
4. **Collection:** The existing scrapers extract every message from every AI conversation. No new code needed.
5. **Exfiltration:** Content scripts can `fetch()` to ANY domain. The manifest CSP restricts extension pages only.
6. **Defense Evasion:** Extension continues to function normally. Captured data is saved locally AND exfiltrated. User sees no behavioral change.

**Detection Difficulty:** HIGH -- requires monitoring Chrome extension network requests, which most endpoint security tools do not do for installed extensions.

---

### Scenario 2: Steganographic Data Exfiltration via PFM Custom Meta Fields

**Threat Actor:** APT41 (Double Dragon)
**Objective:** Exfiltrate sensitive data hidden in routine PFM file sharing
**Likelihood:** MEDIUM (requires initial access to a system generating PFM files)
**Impact:** HIGH -- invisible data channel through legitimate-looking files

**Kill Chain:**
1. **Initial Access:** Compromise an AI agent or tool that generates `.pfm` output.
2. **Embedding:** Add custom meta fields with encoded data:
   ```python
   doc.custom_meta["opt_cache_42"] = base64.b64encode(stolen_data).decode()
   doc.custom_meta["trace_hint"] = base64.b64encode(more_data).decode()
   ```
3. **Validation Bypass:** `pfm validate` reports VALID because checksums cover only section content. Meta fields are outside the checksum scope.
4. **Transport:** Files shared through normal workflows (git, APIs, file shares).
5. **Collection:** Attacker-controlled recipient reads custom meta fields.
6. **Defense Evasion:** `pfm inspect` truncates meta values at 72 characters. Long base64 payloads display as `[key]: b3BlcmF0aW9uX2NhY2hl...` -- innocuous.

---

### Scenario 3: Persistent Access via Stream Backup Files

**Threat Actor:** Lazarus Group
**Objective:** Maintain persistent access to agent output data
**Likelihood:** MEDIUM-HIGH (requires read access to filesystem where PFM streaming is used)
**Impact:** MEDIUM -- historical agent output data accessible through backup files

**Kill Chain:**
1. **Initial Access:** Gain read access to a filesystem used by AI agents with PFM streaming.
2. **Collection:** Read `.pfm.bak` files that accumulate from crash-recovery cycles. These contain complete agent output from the time of each crash.
3. **Persistence:** The backups are never cleaned up. Even if the original `.pfm` files are encrypted, rotated, or deleted, the `.bak` files remain.
4. **Defense Evasion:** `.bak` files are commonly excluded from security scanning, backup policies, and audit logging.

---

## Defense Gap Analysis

### What IS Logged/Monitored
- Checksum validation result (VALID/INVALID) via CLI
- Chrome extension install/update events
- Nothing else

### What IS NOT Logged/Monitored
- Which sections were accessed in a `.pfm` file
- Custom meta field additions or modifications
- Failed parse attempts (generic error in CLI)
- Chrome extension data capture events
- VS Code preview panel open/close events
- Web server HTTP requests (explicitly suppressed)
- Stream writer crash recovery events
- Backup file creation (`.pfm.bak`)
- Encryption/decryption operations
- HMAC signing/verification operations

---

## Recommendations (Prioritized)

### Priority 1 -- Critical Path

1. **Chrome Extension Network Restriction:** Add `host_permissions` restrictions or use `declarativeNetRequest` to explicitly block content script network access to domains other than the matched AI platforms. Consider adding a self-integrity check on extension load.

2. **Meta Field Size Limits:** Add a `MAX_META_VALUE_LENGTH` constant to `spec.py` and enforce it in all readers. Suggested: 4096 characters per field.

3. **Include Meta in Checksum:** Modify `compute_checksum()` to hash meta fields (sorted key-value pairs) in addition to section content. This closes the meta tampering gap.

### Priority 2 -- High

4. **Backup File Cleanup:** Add automatic cleanup of `.pfm.bak` files after successful recovery, or add a `--keep-backup` flag for opt-in retention.

5. **Lock Files:** Commit `package-lock.json` for `pfm-js/` and `pfm-vscode/`. Consider `pip-compile` for Python.

6. **Session Storage Cleanup:** Add a timeout in the Chrome extension popup that clears `pfm_pending` from session storage if the viewer does not consume it within 10 seconds.

7. **CLI Signature Verification:** Add a `pfm verify --secret KEY` command so HMAC signatures can be checked from the command line.

### Priority 3 -- Medium

8. **Fix Inline Event Handlers:** Refactor `onclick` in `generator.py`'s HTML template to use `addEventListener` for CSP compliance.

9. **Parse() Size Guard:** Add optional `max_size` parameter to `PFMReader.parse()`.

10. **Strict Validation Mode:** Add `pfm validate --strict` that warns about unrecognized meta fields, large meta values, and non-standard section names.

11. **Web Server Logging:** Add optional request logging (disabled by default, enabled with `--verbose`).

12. **Version Update Procedure:** Document cross-implementation version update procedure for format version changes.

---

## Summary Threat Matrix

| # | Finding | Severity | Category | Exploitable By |
|---|---------|----------|----------|----------------|
| SPT-001 | Chrome Extension Surveillance Infrastructure | HIGH | Supply Chain / Exfil | Publisher account compromise |
| SPT-002 | Custom Meta Fields Covert Channel | MEDIUM-HIGH | Steganography | Agent compromise |
| SPT-003 | Checksum/HMAC Independence Gap | MEDIUM-HIGH | Integrity Bypass | File access |
| SPT-004 | Stream Recovery .bak Persistence | MEDIUM | Info Disclosure | Read access to filesystem |
| SPT-005 | VS Code Webview Config | MEDIUM (LOW residual) | Privilege Escalation | VS Code/Chromium zero-day |
| SPT-006 | HTML Generator CSP Inconsistency | MEDIUM | XSS Defense Gap | Functional, not exploitable |
| SPT-007 | Chrome Session Storage Leakage | MEDIUM | Data Persistence | Extension context access |
| SPT-008 | Unpinned Build Dependencies | MEDIUM | Supply Chain | Registry compromise |
| SPT-009 | parse() No Size Guard | LOW-MEDIUM | DoS | Library consumers |
| SPT-010 | Suppressed Web Server Logging | LOW | Monitoring Gap | Local access |

---

## Comparison: Round 1 vs Round 2

| Round 1 Finding | Status | Notes |
|----------------|--------|-------|
| Section marker injection (CRITICAL) | **FIXED** | Escape/unescape implemented in spec.py |
| setattr meta parsing (HIGH) | **FIXED** | Strict META_ALLOWLIST frozenset |
| Index offset out-of-bounds (CRITICAL) | **FIXED** | Bounds validation added |
| Checksum bypass on missing (HIGH) | **FIXED** | Fail-closed (returns False) |
| Stream TOCTOU race (CRITICAL) | **FIXED** | File locking with fcntl.flock() |
| Stream text.index() first-match (HIGH) | **FIXED** | Uses rfind() now |
| CLI path traversal (HIGH) | **FIXED** | resolve() + relative_to() validation |
| HMAC null-byte delimiter (HIGH) | **FIXED** | Length-prefixed encoding |
| HMAC missing format_version (HIGH) | **FIXED** | Included in signing message |
| AES-GCM no AAD (HIGH) | **FIXED** | AAD = b"PFM-ENC/1.0" |
| Format version not enforced (HIGH) | **FIXED** | SUPPORTED_FORMAT_VERSIONS frozenset |
| Fingerprint truncation (MEDIUM) | **FIXED** | 32 hex chars (128-bit) |
| Timing leak in checksum (LOW) | **FIXED** | hmac.compare_digest() used |
| Custom meta covert channel (MEDIUM) | **PERSISTS** | See SPT-002 |
| Dev dependency pinning (MEDIUM) | **PERSISTS** | See SPT-008 |

**14 of 15 Round 1 findings have been addressed.** The remaining finding (custom meta covert channel) is a design-level issue that requires a specification change to fix properly.

---

## Files Analyzed (32 source files, ~5,200 lines)

### Python Implementation (`pfm/`)
| File | Path |
|------|------|
| Package init | `/Users/jasonsutter/Documents/Companies/pfm/pfm/__init__.py` |
| Format spec | `/Users/jasonsutter/Documents/Companies/pfm/pfm/spec.py` |
| Document model | `/Users/jasonsutter/Documents/Companies/pfm/pfm/document.py` |
| Reader/Parser | `/Users/jasonsutter/Documents/Companies/pfm/pfm/reader.py` |
| Writer | `/Users/jasonsutter/Documents/Companies/pfm/pfm/writer.py` |
| Stream writer | `/Users/jasonsutter/Documents/Companies/pfm/pfm/stream.py` |
| Security (crypto) | `/Users/jasonsutter/Documents/Companies/pfm/pfm/security.py` |
| CLI | `/Users/jasonsutter/Documents/Companies/pfm/pfm/cli.py` |
| Converters | `/Users/jasonsutter/Documents/Companies/pfm/pfm/converters.py` |
| Spells API | `/Users/jasonsutter/Documents/Companies/pfm/pfm/spells.py` |
| Web server | `/Users/jasonsutter/Documents/Companies/pfm/pfm/web/server.py` |
| HTML generator | `/Users/jasonsutter/Documents/Companies/pfm/pfm/web/generator.py` |

### JavaScript Implementation (`pfm-js/src/`)
| File | Path |
|------|------|
| Types | `/Users/jasonsutter/Documents/Companies/pfm/pfm-js/src/types.ts` |
| Parser | `/Users/jasonsutter/Documents/Companies/pfm/pfm-js/src/parser.ts` |
| Serializer | `/Users/jasonsutter/Documents/Companies/pfm/pfm-js/src/serialize.ts` |
| Checksum | `/Users/jasonsutter/Documents/Companies/pfm/pfm-js/src/checksum.ts` |
| Converters | `/Users/jasonsutter/Documents/Companies/pfm/pfm-js/src/convert.ts` |
| Index | `/Users/jasonsutter/Documents/Companies/pfm/pfm-js/src/index.ts` |

### Chrome Extension (`pfm-chrome/`)
| File | Path |
|------|------|
| Manifest | `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/manifest.json` |
| Service worker | `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/background/service-worker.js` |
| Content main | `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/content/content-main.js` |
| ChatGPT scraper | `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/content/scraper-chatgpt.js` |
| Claude scraper | `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/content/scraper-claude.js` |
| Gemini scraper | `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/content/scraper-gemini.js` |
| PFM Core | `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/shared/pfm-core.js` |
| Popup | `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/popup/popup.js` |
| Viewer | `/Users/jasonsutter/Documents/Companies/pfm/pfm-chrome/viewer/viewer.js` |

### VS Code Extension (`pfm-vscode/src/`)
| File | Path |
|------|------|
| Extension entry | `/Users/jasonsutter/Documents/Companies/pfm/pfm-vscode/src/extension.ts` |
| Parser | `/Users/jasonsutter/Documents/Companies/pfm/pfm-vscode/src/parser.ts` |
| Preview panel | `/Users/jasonsutter/Documents/Companies/pfm/pfm-vscode/src/preview/previewPanel.ts` |
| Hover provider | `/Users/jasonsutter/Documents/Companies/pfm/pfm-vscode/src/hover/hoverProvider.ts` |
| Outline provider | `/Users/jasonsutter/Documents/Companies/pfm/pfm-vscode/src/outline/outlineProvider.ts` |
| CodeLens provider | `/Users/jasonsutter/Documents/Companies/pfm/pfm-vscode/src/codelens/codeLensProvider.ts` |

---

*Report generated by Specter APT Simulator. This is a simulation-only analysis. No actual attacks were executed, no external connections were made, and no files were modified except this report.*
