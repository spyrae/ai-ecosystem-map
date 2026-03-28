# AI Environment Manager — Roadmap

## Phase Overview

```
Phase 1: Foundation         [2 weeks]   CLI agent + static UI refactor
Phase 2: Web UI             [2 weeks]   React SPA, live scanning, DnD
Phase 3: Project Management [1 week]    Multi-project, project-centric view
Phase 4: Remote Servers     [2 weeks]   SSH, remote scanning, diff
Phase 5: Polish & Launch    [1 week]    Packaging, docs, GitHub launch
───────────────────────────────────────
Total: ~8 weeks to v1.0
```

---

## Phase 1: Foundation — Agent Refactor

**Goal:** Transform current CLI into a proper agent with persistent state and real-time capabilities.

### Tasks

1.1 **Project restructure**
- Reorganize from flat `src/` to `agent/` + `ui/` monorepo
- Keep current CLI working as `aem scan` (backward compat)
- Add `aem` command that starts agent + serves UI

1.2 **SQLite state store**
- Add `better-sqlite3` (single native dep, prebuilt binaries)
- Create schema: projects, environments, assets, connections, history
- Migrate scanner output from in-memory → persistent store
- Auto-rescan on startup, incremental updates after

1.3 **File watcher**
- Watch all known config directories (`~/.claude/`, `~/.codex/`, etc.)
- Debounce events (500ms), trigger incremental rescan
- Push updates via WebSocket

1.4 **REST API**
- Proper Express-like router (or native http, zero deps)
- All endpoints from ARCHITECTURE.md
- JSON responses with consistent error handling

1.5 **WebSocket server**
- Real-time events: asset updates, scan progress
- Connection management (multiple UI tabs)

### Success Criteria
- [ ] `aem` starts agent on port 3000, serves current HTML UI
- [ ] `aem scan` still works as before (backward compat)
- [ ] File changes in `~/.claude/commands/` trigger live UI update
- [ ] SQLite stores scan results persistently
- [ ] REST API returns all assets with filtering

### Dependencies
- `better-sqlite3` — SQLite binding (prebuilt, no compile needed)

---

## Phase 2: Web UI — React SPA

**Goal:** Replace static HTML with interactive React UI. Drag-and-drop, real-time updates, multi-view.

### Tasks

2.1 **UI scaffold**
- Vite + React + TypeScript + Tailwind
- Dark theme matching current design
- Sidebar navigation: Map / Projects / Providers / Servers

2.2 **Ecosystem Map view**
- Port current HTML map to React components
- AssetCard component with provider badges
- Category grouping, collapsible sections
- Sticky search with fuzzy matching

2.3 **Connect modal (React)**
- Port current connect modal
- Real provider logos
- Live status update after connect/disconnect

2.4 **Drag & Drop**
- @dnd-kit integration
- Drag asset cards between categories
- Drag to provider panel = connect
- Drag between project panels = move/copy
- Visual feedback: drop zones highlight

2.5 **Real-time sync**
- WebSocket hook: `useAgent()`
- Auto-refresh on `assets:updated` events
- Optimistic UI for connect/disconnect

2.6 **Bundle UI into agent**
- Build UI → `ui/dist/`
- Agent serves static files from dist
- Single `aem` command = everything

### Success Criteria
- [ ] React UI fully replaces static HTML
- [ ] Drag asset to provider = connects it
- [ ] File change on disk → UI updates in <1s
- [ ] Search finds assets by name, description, tags
- [ ] Single binary experience: `aem` opens full UI

---

## Phase 3: Project Management

**Goal:** Multi-project awareness. See what each project uses, move assets between projects.

### Tasks

3.1 **Project discovery**
- Scan known project directories (configurable)
- Auto-detect projects with `.claude/`, `.cursor/`, etc.
- Manual "Add project" by path

3.2 **Projects view**
- Grid of project cards with asset counts
- Click project → see all its assets
- Per-project provider breakdown

3.3 **Project-level configs**
- Scan project-local `.claude/commands/` (not just global)
- Scan project-local `.mcp.json`, `.cursorrules`, etc.
- Distinguish global vs project-level assets

3.4 **Move/Copy between projects**
- Drag asset from project A to project B
- Choose: symlink (shared) or copy (independent)
- Update connections accordingly

### Success Criteria
- [ ] Projects view shows all detected projects
- [ ] Each project shows its local + global assets
- [ ] Can drag skill from Project A to Project B
- [ ] Global vs project-local assets visually distinct

---

## Phase 4: Remote Servers

**Goal:** SSH into VPS, scan remote AI configs, compare with local, sync.

### Tasks

4.1 **SSH connection manager**
- Add/remove remote servers (name, host, user, key)
- Connection pool with keepalive
- Test connection on add

4.2 **Remote scanning**
- Run scanner logic via SSH commands
- `ssh user@vps 'cat ~/.claude/.mcp.json'` etc.
- Parse remote configs same as local

4.3 **Servers view**
- List of environments (local + remote)
- Click server → see its assets
- Connection status indicator (green/red)

4.4 **Diff view**
- Compare local vs remote environment
- Show: only local, only remote, different versions
- One-click sync: push local → remote or pull remote → local

4.5 **Sync operations**
- SCP-based file transfer for skills/agents
- JSON merge for MCP configs
- Conflict resolution UI

### Success Criteria
- [ ] Can add VPS via SSH credentials
- [ ] Remote scan discovers assets on VPS
- [ ] Diff shows what's different local vs remote
- [ ] Can push a skill from local to VPS with one click

---

## Phase 5: Polish & Launch

**Goal:** Production-ready packaging, documentation, community launch.

### Tasks

5.1 **Packaging**
- npm publish as `ai-ecosystem-map`
- Homebrew formula
- Standalone binaries (esbuild + pkg)
- Docker image for VPS

5.2 **Documentation**
- README with screenshots/GIFs
- Quick start guide
- Provider compatibility matrix
- API documentation

5.3 **GitHub Launch**
- Proper README with visuals
- GitHub Actions CI (lint, test, build)
- Release workflow with changelog
- Topics and description for discoverability

5.4 **Community**
- Post on: HN, Reddit (r/programming, r/ClaudeAI), Twitter/X
- Product Hunt launch
- Discord/Discussions for feedback

### Success Criteria
- [ ] `npx ai-ecosystem-map` works out of the box
- [ ] README has screenshot/GIF showing key features
- [ ] Published on npm
- [ ] 50+ GitHub stars in first week

---

## Future (v2+)

**Team features:**
- Shared skill libraries (Git-backed)
- Team dashboard: who uses what
- Notifications: "teammate added new MCP server"

**Marketplace integration:**
- Browse community skills from SkillsMP
- One-click install from marketplace
- Publish your skills to marketplace

**AI-powered features:**
- "Suggest skills for this project" based on tech stack
- "Find similar skills" semantic search
- Auto-categorization improvement via embeddings

**Desktop app:**
- Tauri wrapper for native experience
- System tray icon
- Keyboard shortcuts
