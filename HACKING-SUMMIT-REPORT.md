# Hacking Summit Certification

**Project:** PFM (Pure Fucking Magic) -- AI Conversation Container Format
**Date:** 2026-02-16
**Rounds:** 2
**Final Grade:** A+

---

## Attack Surface Inventory

| Component | Language | Files | Role |
|-----------|----------|-------|------|
| pfm/ | Python | 12 files | Core library (reader, writer, stream, security, converters, CLI, web, TUI) |
| pfm-js/ | TypeScript | 6 files | npm package (parser, serializer, checksum, converters) |
| pfm-vscode/ | TypeScript | 6 files | VS Code extension (preview, outline, hover, codelens) |
| pfm-chrome/ | JavaScript | 9 files | Chrome extension (scrapers, popup, viewer, service worker) |
| docs/ | HTML/JS | 1 file | Web SPA (viewer/converter) |

---

## Round 1: Black Team Findings (18 total)

| # | Severity | Category | Finding | Component |
|---|----------|----------|---------|-----------|
| 1 | HIGH | Path Traversal | CLI `--file` flag allows reading arbitrary files via absolute paths or symlinks | pfm/cli.py |
| 2 | HIGH | Format Injection | Meta values with newlines could inject fake section headers or EOF markers in all 4 serializers | writer.py, stream.py, serialize.ts, pfm-core.js |
| 3 | MEDIUM | Weak Randomness | Chrome extension UUID uses `Math.random()` instead of CSPRNG | pfm-core.js |
| 4 | MEDIUM | Missing Auth | Chrome service worker `onMessage` missing sender validation | service-worker.js |
| 5 | MEDIUM | Resource Exhaustion | Content scrapers have no size/count limit on extracted data | scraper-*.js |
| 6 | MEDIUM | File Permissions | StreamWriter uses `open()` without explicit mode (inherits umask) | stream.py |
| 7 | MEDIUM | Missing Size Limit | CLI `cmd_convert` reads input files with no size limit | cli.py |
| 8 | MEDIUM | Missing Size Limit | Stream recovery (`_recover`) reads file without size check | stream.py |
| 9 | MEDIUM | Thread Safety | `security.verify()` temporarily mutates document (pop/restore pattern) | security.py |
| 10 | MEDIUM | Sign/Verify Asymmetry | `sign()` includes old sig/algo fields in message; `verify()` excludes them | security.py |
| 11 | MEDIUM | Format Injection | Markdown export YAML frontmatter not escaped for `---` delimiters | 5 files (all implementations) |
| 12 | MEDIUM | Format Injection | Chrome popup does not sanitize `source_url`/`title` in meta | popup.js |
| 13 | MEDIUM | Section Name Injection | Chrome `fromMarkdown` does not normalize section names | pfm-core.js |
| 14 | MEDIUM | Section Name Injection | Chrome `fromJSON` and `fromCSV` do not validate section names | pfm-core.js |
| 15 | MEDIUM | Section Name Injection | Chrome serializer does not validate section names before output | pfm-core.js |
| 16 | LOW | Meta Key Injection | Chrome serializer meta rebuild does not sanitize keys/values | pfm-core.js |
| 17 | LOW | Frontmatter Injection | Web generator HTML template markdown export lacks key sanitization | generator.py |
| 18 | LOW | Frontmatter Injection | Docs SPA markdown export lacks key sanitization | docs/index.html |

---

## Round 1: Red Team Remediation (18/18 fixed)

| # | Fix | Files Modified |
|---|-----|---------------|
| 1 | Added CWD containment check: resolved path must be under `Path.cwd()`. Added file existence check. | `pfm/cli.py` |
| 2 | All 4 serializers now strip control characters (0x00-0x1f, 0x7f) from meta keys and values before writing | `pfm/writer.py`, `pfm/stream.py`, `pfm-js/src/serialize.ts`, `pfm-chrome/shared/pfm-core.js` |
| 3 | Replaced `Math.random()` UUID with `crypto.getRandomValues()` for CSPRNG | `pfm-chrome/shared/pfm-core.js` |
| 4 | Added `sender.id === chrome.runtime.id` check to service worker message handler | `pfm-chrome/background/service-worker.js` |
| 5 | Added `MAX_CONTENT_SIZE` (10 MB) and `MAX_MESSAGES` (5000) limits to all 3 scrapers | `scraper-chatgpt.js`, `scraper-claude.js`, `scraper-gemini.js` |
| 6 | StreamWriter now uses `os.open()` with explicit `0o644` mode, matching PFMWriter | `pfm/stream.py` |
| 7 | Added `MAX_FILE_SIZE` check and file existence check before reading input | `pfm/cli.py` |
| 8 | Added `MAX_FILE_SIZE` check to `_recover()` before reading file into memory | `pfm/stream.py` |
| 9 | Replaced pop/restore pattern with `copy.copy()` + filtered dict (zero mutation) | `pfm/security.py` |
| 10 | `sign()` now also excludes old signature/sig_algo from signing message using copy | `pfm/security.py` |
| 11 | All 5 markdown export functions now escape `---` as `\---` and sanitize keys | `pfm/converters.py`, `pfm/web/generator.py`, `docs/index.html`, `pfm-chrome/viewer/viewer.js`, `pfm-js/src/convert.ts` |
| 12 | Added control character stripping and title truncation (matching content-main.js) | `pfm-chrome/popup/popup.js` |
| 13 | Added section name normalization (lowercase, strip invalid chars, fallback to 'content') | `pfm-chrome/shared/pfm-core.js` |
| 14 | Added section name normalization for JSON and CSV importers | `pfm-chrome/shared/pfm-core.js` |
| 15 | Serializer now validates/normalizes section names before output with regex check | `pfm-chrome/shared/pfm-core.js` |
| 16 | Both serializer passes now sanitize meta keys/values for control characters | `pfm-chrome/shared/pfm-core.js` |
| 17 | Generator markdown export sanitizes keys (alphanumeric only) and escapes `---` | `pfm/web/generator.py` |
| 18 | Docs SPA markdown export sanitizes keys and escapes `---` in values | `docs/index.html` |

---

## Round 2: Black Team Verification

Re-scanned all 36 source files across 5 implementations. Results:

| Check | Result |
|-------|--------|
| Path traversal (CLI --file) | PASS -- CWD containment enforced |
| Format injection (meta newlines) | PASS -- Control chars stripped in all 4 serializers |
| Prototype pollution (JS) | PASS -- `__proto__`, `constructor`, `prototype` blocked in all 6 parsers |
| XSS (HTML output) | PASS -- All user data escaped via `esc()` (DOM textContent method) |
| Script injection (web generator) | PASS -- `ensure_ascii=True` + `</` + `<!--` escaping |
| CSP headers (web server) | PASS -- `default-src 'none'` with minimal allowances |
| CSP headers (Chrome extension) | PASS -- `script-src 'self'; object-src 'none'` in manifest |
| CSP headers (VS Code webview) | PASS -- Nonce-based CSP, empty `localResourceRoots` |
| File size limits | PASS -- 500 MB limit in reader, writer, stream, CLI, recovery |
| Section count limits | PASS -- 10,000 max in all implementations |
| Meta field limits | PASS -- 100 max in all implementations |
| Section name validation | PASS -- Lowercase alphanumeric + hyphens/underscores, 64 char max |
| Checksum validation | PASS -- Fail-closed (no checksum = invalid), timing-safe compare |
| HMAC signing | PASS -- Thread-safe verify, length-prefixed canonical encoding |
| Encryption | PASS -- AES-256-GCM with AAD, PBKDF2 600K iterations, random salt/nonce |
| File permissions | PASS -- Explicit 0o644 in both Writer and StreamWriter |
| File locking | PASS -- `fcntl.flock(LOCK_EX)` on stream recovery |
| Sender validation (Chrome) | PASS -- `sender.id === chrome.runtime.id` in both handlers |
| Content scraping limits | PASS -- 10 MB / 5000 message cap on all 3 scrapers |
| YAML frontmatter injection | PASS -- `---` escaped, keys sanitized in all 5 export paths |
| UUID generation | PASS -- `crypto.getRandomValues()` (CSPRNG) |
| Error information leakage | PASS -- Generic error messages in CLI, no stack traces |
| Escape round-trip | PASS -- `hasMarkerAfterBackslashes()` at all nesting depths |
| Index bounds validation | PASS -- `0 <= offset` and `offset + length <= file_size` |
| Version downgrade | PASS -- `SUPPORTED_FORMAT_VERSIONS` frozenset rejects unknown versions |
| Symlink following | PASS -- Resolved path must be under CWD |
| eval/exec usage | PASS -- None found in production code |
| Pickle/marshal/unsafe YAML | PASS -- None found |
| Math.random for security | PASS -- Replaced with crypto.getRandomValues |
| Sign/verify symmetry | PASS -- Both exclude signature/sig_algo from message |

**Zero exploitable vulnerabilities found.**

---

## Pre-existing Security Features (confirmed intact)

These security measures were already in place and verified working:

1. **Content escaping** -- `hasMarkerAfterBackslashes()` at arbitrary nesting depth
2. **Meta allowlist** -- `frozenset` of 8 permitted keys for `setattr`
3. **Prototype pollution prevention** -- Blocked in all 6 JS/TS parsers
4. **HMAC timing-safe comparison** -- `hmac.compare_digest()` for checksums and signatures
5. **AES-256-GCM with AAD** -- Proper authenticated encryption with domain binding
6. **PBKDF2 key derivation** -- 600,000 iterations (OWASP minimum)
7. **MV3 Chrome extension** -- No `<all_urls>`, session storage handoff, minimal permissions
8. **Content Security Policy** -- Applied in web server, generated HTML, Chrome extension, VS Code
9. **Localhost-only web server** -- Binds to 127.0.0.1, no network exposure
10. **Server version suppression** -- `server_version = "PFM"`, `sys_version = ""`

---

## Final Status

```
+--------------------------------------------------+
|            CERTIFIED                              |
|                                                   |
|  This project has passed Sutter Enterprises       |
|  security certification.                          |
|                                                   |
|  Black Team found 0 exploitable vulnerabilities   |
|  after 18 findings were remediated in Round 1.    |
|                                                   |
|  Grade: A+                                        |
|  Date: 2026-02-16                                 |
+--------------------------------------------------+
```

---

## Files Modified

| File | Changes |
|------|---------|
| `pfm/cli.py` | CWD containment for --file, file size limit for convert |
| `pfm/writer.py` | Meta value sanitization (control char stripping) |
| `pfm/stream.py` | Explicit file permissions, meta sanitization, recovery size limit |
| `pfm/security.py` | Thread-safe verify (copy-based), sign/verify symmetry fix |
| `pfm/converters.py` | Markdown export YAML frontmatter escaping |
| `pfm/web/generator.py` | HTML template markdown export sanitization |
| `pfm-js/src/serialize.ts` | Meta value sanitization |
| `pfm-js/src/convert.ts` | Markdown export YAML frontmatter escaping |
| `pfm-chrome/shared/pfm-core.js` | CSPRNG UUID, section name validation, meta sanitization, section name normalization in converters |
| `pfm-chrome/background/service-worker.js` | Sender origin validation |
| `pfm-chrome/popup/popup.js` | URL/title sanitization |
| `pfm-chrome/content/scraper-chatgpt.js` | Content size and message count limits |
| `pfm-chrome/content/scraper-claude.js` | Content size and message count limits |
| `pfm-chrome/content/scraper-gemini.js` | Content size and message count limits |
| `pfm-chrome/viewer/viewer.js` | Markdown export YAML frontmatter escaping |
| `docs/index.html` | Markdown export YAML frontmatter escaping |
