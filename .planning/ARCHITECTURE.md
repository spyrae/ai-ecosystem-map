# AI Environment Manager — Architecture

## Product Vision

Visual control plane for AI development environments. Manage skills, agents, MCP servers across projects, AI tools, and machines — without touching config files.

```
"Portainer for AI Development"
```

---

## Core Concepts

| Concept | Definition | Example |
|---------|-----------|---------|
| **Asset** | Any managed unit: skill, agent, MCP server, rule, instruction | `humanizer-ru.md`, `supabase` MCP |
| **Provider** | AI coding tool that consumes assets | Claude, Codex, Gemini, Cursor |
| **Workspace** | A project directory with AI configs | `~/Projects/JourneyBay/` |
| **Environment** | A machine (local or remote) with workspaces | MacBook, NUE-01 VPS |
| **Connection** | Link between asset and provider (symlink/JSON/copy) | `humanizer-ru` → Codex via symlink |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Web UI (React)                        │
│                                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │
│  │ Ecosystem│ │ Projects │ │Providers │ │   Servers     │  │
│  │   Map    │ │   View   │ │   View   │ │    View       │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────────┘  │
│  ┌──────────────────────┐ ┌──────────────────────────────┐  │
│  │   Drag & Drop Engine │ │    Search / Filter / Diff    │  │
│  └──────────────────────┘ └──────────────────────────────┘  │
└──────────────────────┬──────────────────────────────────────┘
                       │ WebSocket + REST API
┌──────────────────────┴──────────────────────────────────────┐
│                     Agent (Node.js)                          │
│                                                              │
│  ┌───────────┐ ┌───────────┐ ┌────────────┐ ┌───────────┐  │
│  │  Scanner  │ │ Connector │ │ SSH Manager│ │  Watcher  │  │
│  │           │ │           │ │            │ │           │  │
│  │ Discovers │ │ Symlinks  │ │ Remote env │ │ FS events │  │
│  │ all assets│ │ JSON edit │ │ tunneling  │ │ live sync │  │
│  └───────────┘ └───────────┘ └────────────┘ └───────────┘  │
│  ┌───────────┐ ┌───────────┐ ┌────────────────────────────┐│
│  │  Parser   │ │  Config   │ │     State Store (SQLite)   ││
│  │           │ │  Manager  │ │                            ││
│  │ Frontmatter│ │ Read/Write│ │  Projects, connections,   ││
│  │ YAML/JSON │ │ all formats│ │  server creds, history    ││
│  └───────────┘ └───────────┘ └────────────────────────────┘│
└──────────────────────┬──────────────────────────────────────┘
                       │ File System / SSH
┌──────────────────────┴──────────────────────────────────────┐
│                    Config Layer                               │
│                                                              │
│  Local:                          Remote (via SSH):           │
│  ~/.claude/commands/             user@vps:~/.claude/         │
│  ~/.claude/agents/               user@vps:~/.codex/          │
│  ~/.claude/.mcp.json             user@vps:~/.mcp.json        │
│  ~/.codex/skills/                                            │
│  ~/.gemini/                                                  │
│  .cursor/rules/                                              │
│  .windsurf/rules/                                            │
│  AGENTS.md, GEMINI.md                                        │
└──────────────────────────────────────────────────────────────┘
```

---

## Component Details

### 1. Agent (core — Node.js)

Single long-running process. Handles all file system and network operations.

```
agent/
├── server.js          # HTTP + WebSocket server
├── scanner/
│   ├── index.js       # Orchestrates scan across all providers
│   ├── claude.js      # Claude-specific scanning
│   ├── codex.js       # Codex-specific scanning
│   ├── gemini.js      # ...
│   ├── cursor.js
│   ├── windsurf.js
│   └── mcp.js         # Universal MCP config scanner
├── connector/
│   ├── index.js       # Connect/disconnect orchestrator
│   ├── symlink.js     # Symlink strategy (skills, agents)
│   ├── json-edit.js   # JSON config editing (MCP servers)
│   └── copy.js        # File copy fallback (Windows)
├── watcher/
│   ├── index.js       # fs.watch on all config dirs
│   └── debounce.js    # Batch FS events
├── ssh/
│   ├── manager.js     # SSH connection pool
│   ├── tunnel.js      # Port forwarding for remote agents
│   └── remote-scan.js # Scan remote environment via SSH
├── store/
│   ├── db.js          # SQLite (better-sqlite3)
│   ├── projects.js    # Project CRUD
│   ├── servers.js     # Server/environment CRUD
│   └── history.js     # Action history (undo support)
└── parser/
    ├── frontmatter.js # YAML frontmatter (exists)
    ├── mcp-json.js    # .mcp.json variants
    └── agents-md.js   # AGENTS.md, GEMINI.md
```

**Key decisions:**
- **SQLite** for state (projects, servers, history) — zero setup, ships with the app
- **fs.watch** for live reload — changes in config files reflect instantly in UI
- **SSH via `ssh2` npm** — no native deps, pure JS SSH client
- **WebSocket** for real-time UI updates from watcher

### 2. Web UI (React + Tailwind)

SPA that connects to local agent. Can be served by the agent itself or run standalone.

```
ui/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   └── page.tsx           # Dashboard / Ecosystem Map
│   ├── views/
│   │   ├── ecosystem-map/     # Current HTML map, React version
│   │   ├── projects/          # Project-centric view
│   │   ├── providers/         # IDE-centric view
│   │   ├── servers/           # Remote environment management
│   │   └── diff/              # Compare configs between envs
│   ├── components/
│   │   ├── asset-card/        # Skill/agent/MCP card
│   │   ├── provider-badge/    # AI tool icon badge
│   │   ├── connect-modal/     # Connect/disconnect dialog
│   │   ├── drag-drop/         # DnD context and handlers
│   │   ├── search/            # Global search
│   │   └── sidebar/           # Navigation
│   ├── hooks/
│   │   ├── useAgent.ts        # WebSocket connection to agent
│   │   ├── useAssets.ts       # Assets state
│   │   └── useProjects.ts     # Projects state
│   └── lib/
│       ├── api.ts             # REST client
│       └── ws.ts              # WebSocket client
├── package.json
└── vite.config.ts
```

**Key decisions:**
- **Vite + React** (not Next.js) — SPA, no SSR needed, lighter build
- **Tailwind** for styling — dark theme, consistent with current design
- **@dnd-kit** for drag-and-drop — best React DnD library
- **Bundled inside agent** — `aem` command serves both API and UI

### 3. CLI (preserved)

Current CLI stays as lightweight entry point. Same binary, different modes:

```bash
aem                    # Start agent + open UI in browser
aem --headless         # Agent only (for remote/VPS)
aem scan               # One-shot scan, print to stdout (current behavior)
aem scan -o file.html  # Generate static HTML (current behavior)
aem connect <skill> <tool>  # CLI connect
aem remote add <name> <ssh-string>  # Add remote server
```

---

## Data Model

```sql
-- Projects (workspaces)
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  last_scanned_at INTEGER
);

-- Environments (machines)
CREATE TABLE environments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,  -- 'local' | 'remote'
  ssh_host TEXT,       -- user@host for remote
  ssh_port INTEGER DEFAULT 22,
  ssh_key_path TEXT,
  is_active INTEGER DEFAULT 1
);

-- Assets (skills, agents, MCP, rules, instructions)
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,  -- 'skill' | 'agent' | 'mcp' | 'rule' | 'instruction'
  description TEXT,
  file_path TEXT,      -- source file path
  environment_id TEXT REFERENCES environments(id),
  project_id TEXT REFERENCES projects(id),
  category TEXT,
  is_orchestrator INTEGER DEFAULT 0,
  tags TEXT,           -- JSON array
  providers TEXT,      -- JSON array of connected providers
  raw_config TEXT,     -- JSON, for MCP servers
  discovered_at INTEGER,
  UNIQUE(name, type, environment_id)
);

-- Connections (asset ↔ provider links)
CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  asset_id TEXT REFERENCES assets(id),
  provider TEXT NOT NULL,
  method TEXT NOT NULL,  -- 'symlink' | 'copy' | 'json_entry'
  target_path TEXT,
  created_at INTEGER
);

-- Action history (for undo)
CREATE TABLE history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,  -- 'connect' | 'disconnect' | 'move' | 'sync'
  asset_id TEXT,
  details TEXT,          -- JSON
  created_at INTEGER,
  reverted INTEGER DEFAULT 0
);
```

---

## API Design

### REST Endpoints

```
GET    /api/assets                    # List all assets (with filters)
GET    /api/assets/:id                # Asset detail
GET    /api/assets/:id/connections    # Asset connections

POST   /api/connect                   # Connect asset to provider
POST   /api/disconnect                # Disconnect asset from provider
POST   /api/move                      # Move asset between projects

GET    /api/projects                  # List projects
POST   /api/projects                  # Add project (by path)
DELETE /api/projects/:id              # Remove project
POST   /api/projects/:id/scan        # Rescan project

GET    /api/providers                 # List installed providers
GET    /api/providers/:name/assets    # Assets for a provider

GET    /api/environments              # List environments
POST   /api/environments              # Add remote environment
DELETE /api/environments/:id          # Remove environment
POST   /api/environments/:id/scan    # Scan remote environment
GET    /api/environments/:id/diff     # Diff with local

POST   /api/rescan                    # Full rescan all environments
POST   /api/undo                      # Undo last action
```

### WebSocket Events

```
agent → ui:
  assets:updated     # After scan or connection change
  scan:progress      # Scanning status
  watcher:changed    # File system change detected
  ssh:connected      # Remote env connected
  ssh:error          # SSH error

ui → agent:
  scan:start         # Trigger rescan
  watcher:subscribe  # Watch specific paths
```

---

## Packaging & Distribution

```
npm package: ai-ecosystem-map
├── bin/aem            # CLI entry point
├── agent/             # Node.js agent (bundled)
├── ui/dist/           # Pre-built React UI (bundled)
└── package.json

Installation:
  npm install -g ai-ecosystem-map

Usage:
  aem                  # Full UI mode
  aem scan             # CLI-only scan
  aem --headless       # Agent API only (for VPS)
```

**Distribution channels:**
1. **npm** — primary, `npx ai-ecosystem-map`
2. **Homebrew** — `brew install ai-ecosystem-map`
3. **GitHub Releases** — standalone binaries via pkg/esbuild
4. **Docker** — for VPS deployment

---

## Security Considerations

- SSH keys stored in system keychain (macOS) or encrypted file
- No cloud storage of configs — everything local or direct SSH
- Agent binds to localhost by default
- `--headless` mode requires auth token for remote access
- No telemetry unless explicitly opted in
