# ai-ecosystem-map

Interactive visual map of your AI coding ecosystem. Auto-discovers skills, agents, MCP servers, rules, and instructions from **all major AI coding tools**.

## Supported Tools

| Tool | What it scans | Badge |
|------|--------------|-------|
| **Claude Code** | `~/.claude/commands/`, `~/.claude/agents/`, `.mcp.json` | ![C](https://img.shields.io/badge/C-d4a0ff?style=flat-square&logoColor=white) |
| **Codex CLI** | `.codex/`, `AGENTS.md`, shared skills | ![X](https://img.shields.io/badge/X-10a37f?style=flat-square&logoColor=white) |
| **Gemini CLI** | `.gemini/`, `GEMINI.md`, shared skills | ![G](https://img.shields.io/badge/G-4285f4?style=flat-square&logoColor=white) |
| **Cursor** | `.cursor/rules/`, `.cursorrules` | ![U](https://img.shields.io/badge/U-00d4aa?style=flat-square&logoColor=white) |
| **Windsurf** | `.windsurf/rules/`, `.windsurfrules` | ![W](https://img.shields.io/badge/W-06b6d4?style=flat-square&logoColor=white) |
| **Copilot** | `.github/copilot-instructions.md`, `AGENTS.md` | ![P](https://img.shields.io/badge/P-8b949e?style=flat-square&logoColor=white) |
| **Continue** | `.continue/config.json` | ![N](https://img.shields.io/badge/N-f97316?style=flat-square&logoColor=white) |
| **MCP** | `.mcp.json` (universal protocol) | All supporting tools |

## Features

- **Multi-tool discovery** — scans configs from 7 AI coding assistants
- **Provider badges** — colored icons show which AI tools can use each skill
- **Smart search** — describe your task, find the right tool
- **Dependency graph** — "uses" and "used by" relationships
- **Auto-categorization** — groups by Development, DevOps, Security, Content, SEO, etc.
- **Orchestrator detection** — highlights multi-agent pipelines
- **Zero dependencies** — pure Node.js, nothing to install
- **Cross-platform** — macOS, Linux (VPS), Windows

## Quick Start

```bash
npx ai-ecosystem-map
```

That's it. Opens an interactive HTML map in your browser.

## Install Globally

```bash
npm install -g ai-ecosystem-map

# Then use anywhere:
aem
```

## Options

```
aem                          # Scan ~/.claude/, open in browser
aem -d ./project/.claude     # Scan project-local config
aem -o ecosystem.html        # Save to file
aem -s 8080                  # Serve on localhost:8080 (great for VPS)
aem --no-open                # Don't auto-open browser (VPS/headless)
```

### VPS Usage

On a headless server, use `--serve` to start a local HTTP server:

```bash
aem -s 3000 --no-open
# Then open http://your-server:3000 in your browser
```

Or generate a file and download it:

```bash
aem -o /tmp/ecosystem.html --no-open
# Then scp/download the file
```

## What It Discovers

| Type | Source | Description |
|------|--------|-------------|
| **Skills** | `.claude/commands/*.md` | Slash commands with frontmatter |
| **Agents** | `.claude/agents/*.md` | Custom agent definitions |
| **MCP Servers** | `.mcp.json` | Model Context Protocol servers |
| **Instructions** | `AGENTS.md`, `GEMINI.md`, etc. | Cross-IDE instruction files |
| **Rules** | `.cursor/rules/`, `.windsurf/rules/` | IDE-specific rules |

### Provider Detection

Each card shows colored badges for compatible AI tools:

- Skills in `.claude/commands/` → Claude + Codex + Gemini (shared skill format)
- `AGENTS.md` → Codex + Copilot + Cursor + Windsurf
- `.cursor/rules/` → Cursor only
- MCP servers → Claude + Cursor + Continue (MCP protocol)

## How It Works

1. **Scan** — reads config directories for all supported AI tools
2. **Parse** — extracts frontmatter (name, description) from `.md` files
3. **Detect providers** — maps each item to compatible AI tools
4. **Categorize** — auto-assigns categories based on keywords
5. **Build graph** — links "uses" and "used by" dependencies
6. **Generate** — creates self-contained HTML with embedded data
7. **Serve** — opens in browser or starts HTTP server

## Requirements

- Node.js >= 18
- At least one AI coding tool configured (`.claude/`, `.cursor/`, etc.)

## License

MIT
