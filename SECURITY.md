# Security Policy

[![Security: A+](https://img.shields.io/badge/security-A%2B-brightgreen.svg)]()

## Go ahead. Break it.

PFM has survived 5 independent security assessments, including red-team pentests, chaos engineering, APT simulation, and financial attack modeling. The parser has been hardened against injection, the crypto uses AES-256-GCM with PBKDF2 (600k iterations), and integrity checks use HMAC-SHA256 with constant-time comparison.

We're not hiding behind obscurity. The code is MIT-licensed, the format spec is public, and we *want* you to try to break it. If you find something, you get credit and we get stronger.

---

## Open Challenges

Three layers of security. Three challenges. Beat any of them and you're in the Hall of Fame.

### Challenge 1: Crack the Vault

**Target:** `pfm/security.py` — AES-256-GCM encryption layer

Encrypted `.pfm` files use AES-256-GCM with PBKDF2 key derivation (600,000 iterations), random 16-byte salts, random 12-byte nonces, and AAD binding. Decrypt a `.pfm.enc` file without the password. Recover plaintext, forge a valid ciphertext, or find a weakness in how the encryption is composed.

Here's exactly what you're up against:

```
Key derivation:  PBKDF2-SHA256, 600k iterations, 16-byte random salt
Encryption:      AES-256-GCM, 12-byte random nonce
Auth data:       AAD bound to "PFM-ENC/1.0"
Output format:   salt (16) + nonce (12) + ciphertext + GCM tag (16)
```

The code is ~50 lines. No custom crypto. No tricks. Just standard primitives. Prove they're composed wrong.

### Challenge 2: Forge a Document

**Target:** `pfm/security.py` — HMAC-SHA256 signing + SHA-256 checksum verification

Every PFM document has two integrity layers: a SHA-256 content checksum and an optional HMAC-SHA256 signature over the entire document (meta + section order + contents) using length-prefixed canonical encoding. Both use constant-time comparison.

Modify the content of a signed, checksummed `.pfm` file and make it pass both `verify()` and `verify_integrity()`. Swap sections, inject fields, strip the signature, exploit the canonical encoding — whatever it takes.

```
Checksum:   SHA-256 over all section contents (fail-closed, no checksum = fail)
Signature:  HMAC-SHA256, length-prefixed encoding, section-order-sensitive
Comparison: hmac.compare_digest() (constant-time)
```

The signing message construction is in `_build_signing_message()`. Read it. Find the flaw.

### Challenge 3: Smuggle a Section

**Target:** `pfm/reader.py` + `pfm/spec.py` — the parser itself

PFM uses `#@` markers to delimit sections and `#!` for the magic line / end marker. Content containing these patterns is escaped on write and unescaped on read. The parser enforces strict limits: 100 MB max file size, 10,000 max sections, 100 max meta fields, 64-char section names, regex-validated names (`[a-z0-9_-]+`), and reserved name blocking.

Craft a `.pfm` file that tricks the parser into misinterpreting content as structure. Spoof a section boundary, inject a phantom section, confuse the index, or get the escaping to round-trip incorrectly. Anything that makes the parser see something different from what the writer wrote.

```
Section markers:  #@sectionname
Escaping:         Lines starting with #@ or #! get prefixed with \
Unescaping:       Leading \ before #@ or #! is stripped on read
Nested escaping:  Handles \\#@, \\\#@, etc. (tested extensively)
```

The escaping logic is in `pfm/spec.py`. The parser is in `pfm/reader.py`. Both are under 250 lines. Simple format, simple code — but can you break the contract between writer and reader?

---

## Reporting a Vulnerability

**Email:** [jasonsutter87@gmail.com](mailto:jasonsutter87@gmail.com)

If you find a security vulnerability, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities
2. Email the address above with:
   - Description of the vulnerability
   - Steps to reproduce
   - Affected component(s) (`pfm/`, `pfm-js/`, `pfm-chrome/`, spec)
   - Severity estimate (Critical / High / Medium / Low)
   - Proof of concept if you have one
3. You'll get an acknowledgment within **48 hours**
4. We aim to patch confirmed vulnerabilities within **7 days** for critical/high, **30 days** for medium/low

## What's in Scope

| Target | Description |
|--------|-------------|
| `pfm/` | Python parser, writer, crypto, streaming, CLI |
| `pfm-js/` | JavaScript/TypeScript parser and writer |
| `pfm-chrome/` | Chrome extension |
| `pfm-vscode/` | VS Code extension |
| Format spec | The .pfm format itself (v1.0) |
| [getpfm.io](https://getpfm.io/) | Web viewer and converter |

## What We Care About Most

- Parser exploits (injection, section spoofing, malformed input)
- Crypto weaknesses (key derivation, encryption composition, integrity bypass)
- Denial of service via crafted `.pfm` files (memory, CPU, disk)
- Path traversal or arbitrary file access
- Supply chain issues in published packages (PyPI, npm)
- XSS or code execution via the web viewer, Chrome extension, or VS Code extension

## What's Out of Scope

- Social engineering or phishing
- Denial of service against infrastructure (don't DDoS the site)
- Vulnerabilities in dependencies we don't control (report those upstream)
- Issues already documented in `security_tests/`

## Hall of Fame

Found something real? You get listed here.

| Researcher | Finding | Date |
|------------|---------|------|
| *Your name here* | *Be the first* | |

## Security Assessments

PFM has been through the following assessments (reports in `security_tests/`):

| Assessment | Focus |
|------------|-------|
| Black-Team Pentest | Full source code penetration test |
| BURN1T Chaos Assessment | Chaos engineering and fault injection |
| CASHOUT Financial Assessment | Financial and economic attack vectors |
| Hacking Summit Report | Comprehensive vulnerability analysis |
| SPECTER APT Assessment | Advanced persistent threat simulation |

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.2.x | Yes |
| < 0.2.0 | No |

## Crypto Overview

For those going after the crypto layer:

- **Encryption:** AES-256-GCM
- **Key derivation:** PBKDF2 with 600,000 iterations
- **Integrity:** HMAC-SHA256, constant-time comparison
- **Checksums:** SHA-256 content verification

The crypto module lives in `pfm/security.py`. Have at it.
