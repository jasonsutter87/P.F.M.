# PFM Skills for Claude Code

Drop-in skills that integrate PFM into your Claude Code workflow.

## Installation

Copy any skill folder into your Claude Code skills directory:

```bash
# Install capture skill
cp -r skills/capture ~/.claude/skills/capture

# Install recall skill
cp -r skills/recall ~/.claude/skills/recall
```

Or install all at once:

```bash
cp -r skills/* ~/.claude/skills/
```

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed
- `pfm` CLI installed globally: `npm install -g get-pfm`

## Available Skills

### `/capture` — Save insights as .pfm files

Quick-save findings mid-session before context compaction destroys them.

| Command | What it does |
|---------|-------------|
| `/capture "text"` | Save a specific insight |
| `/capture` | Auto-detect the most recent finding |
| `/capture start "label"` | Start recording a conversation span |
| `/capture end` | Merge recorded exchanges into one .pfm |
| `/capture compact` | Mid-span checkpoint (keeps recording) |
| `/capture list` | Show all captures |
| `/capture search <term>` | Search across captures |

Supports `-l <path>` flag to override the output location.

### `/recall` — Load .pfm captures into memory

Bring captured insights back into Claude Code's auto-memory for future sessions.

| Command | What it does |
|---------|-------------|
| `/recall <file.pfm>` | Load a capture into memory |
| `/recall <file.pfm> preview` | Dry run — show what would be added |
| `/recall <directory>` | Load all captures from a directory |
| `/recall last` | Load the most recent capture |

## The Capture-Recall Loop

```
conversation → /capture → .pfm file → /recall → memory → future conversations
```

Captures preserve the full context (transcripts, reasoning chains). Recall distills the key insight into memory. The .pfm files remain as the detailed archive.
