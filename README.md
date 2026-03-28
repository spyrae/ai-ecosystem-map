# AI Ecosystem Map

Interactive visual control plane for your AI coding ecosystem. Auto-discovers skills, agents, MCP servers, rules, and instructions from **all major AI coding tools** — with real-time sync, multi-project management, and remote server support.

<p align="center">
  <strong>Map</strong> · <strong>Connect</strong> · <strong>Sync</strong> — across all your AI tools and servers
</p>

## Supported Tools

| Tool | What it scans |
|------|--------------|
| **Claude Code** | `~/.claude/commands/`, `~/.claude/agents/`, `.mcp.json` |
| **Codex CLI** | `.codex/`, `AGENTS.md`, shared skills |
| **Gemini CLI** | `.gemini/`, `GEMINI.md`, shared skills |
| **Cursor** | `.cursor/rules/`, `.cursorrules` |
| **Windsurf** | `.windsurf/rules/`, `.windsurfrules` |
| **GitHub Copilot** | `.github/copilot-instructions.md`, `AGENTS.md` |
| **Continue** | `.continue/config.json` |

## Features

### Ecosystem Map
- **Multi-tool discovery** — scans configs from 7 AI coding assistants
- **Provider badges** — see which AI tools can use each asset
- **Smart search** — find tools by name, description, or tags
- **Dependency graph** — "uses" and "used by" relationships
- **Auto-categorization** — Development, DevOps, Security, Content, SEO, UX, etc.
- **Connect/Disconnect** — share skills between AI tools via symlinks or config editing

### Project Management
- **Auto-discovery** — scans directories for projects with AI tooling
- **Project-level assets** — sees local `.claude/commands/`, `.cursor/rules/`, project `.mcp.json`
- **Provider detection** — shows which AI tools each project uses

### Remote Servers
- **SSH connection** — add VPS/remote servers by SSH credentials
- **Remote scanning** — discovers AI assets on remote machines
- **Diff view** — compare local vs remote: only local, only remote, shared
- **Push/Pull** — sync skills and agents between local and remote via SCP

### Real-Time
- **File watcher** — detects changes in config directories instantly
- **WebSocket sync** — UI updates live when files change on disk
- **SQLite persistence** — state survives restarts

## Quick Start

```bash
npx ai-ecosystem-map
```

Opens the web UI at `http://localhost:3000` with your full ecosystem map.

## Install Globally

```bash
npm install -g ai-ecosystem-map
aem                    # Start web UI
```

## Usage

```bash
# Web UI (default)
aem                        # Start on port 3000, open browser
aem -p 8080                # Custom port
aem --headless             # API only, no UI (for VPS)
aem --no-open              # Don't auto-open browser

# Static HTML (one-shot)
aem scan                   # Print summary to stdout
aem scan -o map.html       # Generate self-contained HTML file

# Options
aem -d /path/to/.claude    # Custom config directory
```

### VPS / Remote Usage

```bash
# On your VPS:
aem --headless -p 3000

# Access from local machine:
ssh -L 3000:localhost:3000 user@your-vps
open http://localhost:3000
```

Or generate a static file:
```bash
aem scan -o /tmp/ecosystem.html --no-open
```

## What It Discovers

| Type | Source | Description |
|------|--------|-------------|
| **Skills** | `.claude/commands/*.md` | Slash commands with YAML frontmatter |
| **Agents** | `.claude/agents/*.md` | Custom agent definitions |
| **MCP Servers** | `.mcp.json` | Model Context Protocol servers |
| **Instructions** | `AGENTS.md`, `GEMINI.md`, etc. | Cross-IDE instruction files |
| **Rules** | `.cursor/rules/`, `.windsurf/rules/` | IDE-specific rules |

### Provider Detection

Each card shows which AI tools can access it:

- Skills in `.claude/commands/` → Claude + Codex + Gemini (shared format)
- `AGENTS.md` → Codex + Copilot + Cursor + Windsurf
- `.cursor/rules/` → Cursor only
- MCP servers → configured per tool via `.mcp.json`

## Architecture

```
ai-ecosystem-map/
├── bin/cli.js          # CLI entry point (aem command)
├── agent/
│   ├── server.js       # HTTP + WebSocket server
│   ├── router.js       # REST API routes
│   ├── scanner/        # Multi-tool asset discovery
│   ├── categorizer.js  # Keyword-based categorization
│   ├── connector/      # Connect/disconnect between tools
│   ├── projects.js     # Project discovery & scanning
│   ├── remote.js       # SSH connection & remote scanning
│   ├── watcher/        # File system watcher
│   └── store/          # SQLite persistent state
├── ui/                 # React + TypeScript + Tailwind
│   └── dist/           # Built UI (served by agent)
└── template/           # Static HTML fallback
```

### API

All endpoints under `/api/`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/assets` | GET | List assets (filters: type, provider, category, q) |
| `/api/stats` | GET | Summary statistics |
| `/api/providers` | GET | Provider breakdown |
| `/api/categories` | GET | Category counts |
| `/api/connect` | POST | Connect asset to a tool |
| `/api/disconnect` | POST | Disconnect asset from a tool |
| `/api/projects` | GET | List discovered projects |
| `/api/projects/discover` | POST | Scan directories for projects |
| `/api/servers` | GET | List environments (local + remote) |
| `/api/servers/add` | POST | Add remote server |
| `/api/servers/:id/scan` | POST | Scan remote for assets |
| `/api/servers/:id/diff` | GET | Diff local vs remote |
| `/api/servers/:id/push` | POST | Push asset to remote |
| `/api/servers/:id/pull` | POST | Pull asset from remote |
| `/api/rescan` | POST | Trigger full rescan |

WebSocket at `/ws` — pushes `assets:updated` events on file changes.

## Requirements

- Node.js >= 18
- At least one AI coding tool configured
- SSH key for remote server features (optional)

## License

MIT
