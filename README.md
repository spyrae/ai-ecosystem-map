# claude-ecosystem-map

Interactive visual map of your Claude Code ecosystem. Auto-discovers skills, agents, and MCP servers from your `.claude/` configuration.

![Screenshot](https://raw.githubusercontent.com/rbelov/claude-ecosystem-map/main/screenshot.png)

## Features

- **Auto-discovery** — scans `~/.claude/commands/`, `~/.claude/agents/`, `~/.claude/.mcp.json`
- **Smart search** — describe your task, find the right tool
- **Dependency graph** — see what orchestrators use and what's used by whom
- **Auto-categorization** — groups by Development, DevOps, Security, Content, SEO, etc.
- **Orchestrator detection** — highlights multi-agent pipelines
- **Zero dependencies** — pure Node.js, nothing to install
- **Cross-platform** — macOS, Linux (VPS), Windows

## Quick Start

```bash
npx claude-ecosystem-map
```

That's it. Opens an interactive HTML map in your browser.

## Install Globally

```bash
npm install -g claude-ecosystem-map

# Then use anywhere:
cem
```

## Options

```
cem                          # Scan ~/.claude/, open in browser
cem -d ./project/.claude     # Scan project-local config
cem -o ecosystem.html        # Save to file
cem -s 8080                  # Serve on localhost:8080 (great for VPS)
cem --no-open                # Don't auto-open browser (VPS/headless)
```

### VPS Usage

On a headless server, use `--serve` to start a local HTTP server:

```bash
cem -s 3000 --no-open
# Then open http://your-server:3000 in your browser
```

Or generate a file and download it:

```bash
cem -o /tmp/ecosystem.html --no-open
# Then scp/download the file
```

## What It Scans

| Source | Location | What |
|--------|----------|------|
| **Skills** | `~/.claude/commands/*.md` | Slash commands (including subdirectories) |
| **Agents** | `~/.claude/agents/*.md` | Custom agent definitions |
| **MCP Servers** | `~/.claude/.mcp.json` | Model Context Protocol servers |

### Frontmatter Support

Skills and agents with YAML frontmatter get richer cards:

```markdown
---
name: my-skill
description: "Does something amazing. Use when X happens."
---

# My Skill
...
```

## How It Works

1. **Scan** — reads `.claude/` directory structure
2. **Parse** — extracts frontmatter (name, description) from `.md` files
3. **Categorize** — auto-assigns categories based on keywords in name/description
4. **Detect orchestrators** — identifies multi-agent pipelines
5. **Build dependency graph** — links "uses" and "used by" relationships
6. **Generate** — creates self-contained HTML with embedded data
7. **Serve** — opens in browser or starts HTTP server

## Requirements

- Node.js >= 18
- A `.claude/` directory with some skills, agents, or MCP config

## License

MIT
