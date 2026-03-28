# Architecture Decisions

## ADR-001: Vite + React SPA over Next.js

**Decision:** Use Vite + React for UI, not Next.js.

**Why:** This is an SPA served by a local agent, not a public website. No SEO needed, no SSR needed. Vite is faster to build, lighter bundle, simpler deployment (just static files served by the agent).

**Trade-off:** No SSR, no API routes from Next.js. But agent already has its own API.

---

## ADR-002: SQLite for state, not filesystem-only

**Decision:** Use SQLite (better-sqlite3) for persistent state.

**Why:**
- Need to track projects, servers, connections, history
- File-based state (JSON files) gets messy with concurrent access
- SQLite is zero-config, ships as single file, perfect for local tools
- `better-sqlite3` has prebuilt binaries for all platforms — no compile step

**Trade-off:** One native dependency. But it's the gold standard for local storage.

---

## ADR-003: WebSocket for real-time, REST for CRUD

**Decision:** Dual protocol — REST API for operations, WebSocket for live events.

**Why:**
- REST is simple and testable for connect/disconnect/scan operations
- WebSocket needed for live file watcher updates (can't poll efficiently)
- Clean separation: UI calls REST → gets result. Agent pushes events via WS.

---

## ADR-004: Agent serves UI (monolith binary)

**Decision:** Bundle pre-built React UI inside the npm package. Single `aem` command.

**Why:**
- Best UX: one command, everything works
- No separate UI install, no CORS issues
- Agent serves `ui/dist/` as static files + API on same port
- Still supports `--headless` for API-only mode (VPS)

**Trade-off:** Larger npm package (~2-5MB for UI bundle). Acceptable.

---

## ADR-005: SSH via `ssh2` npm package

**Decision:** Pure JavaScript SSH client, not shelling out to `ssh` command.

**Why:**
- Cross-platform (Windows doesn't always have ssh CLI)
- Programmatic control over connections, tunneling
- Connection pooling and keepalive
- No dependency on system SSH config

**Trade-off:** `ssh2` is a large dependency. But it's well-maintained and battle-tested.

---

## ADR-006: Symlinks as primary connect method

**Decision:** Symlinks for skills/agents, JSON editing for MCP configs.

**Why:**
- Symlinks: single source of truth, edit once — reflected everywhere
- JSON edit: MCP configs are JSON, can't symlink individual entries
- Copy as fallback: Windows without developer mode can't create symlinks

**Trade-off:** Symlinks can break if source moves. Watcher detects this.

---

## ADR-007: Backward compatibility with current CLI

**Decision:** Keep `aem scan` and `aem -o file.html` working as before.

**Why:**
- Users who installed v1 expect it to keep working
- Static HTML generation is useful for quick one-off views
- CI/CD can use `aem scan --json` for automation

**Approach:**
- `aem` (no args) = full UI mode (new)
- `aem scan` = one-shot scan (existing)
- `aem scan -o file.html` = generate static HTML (existing)
- `aem --headless` = agent API without UI (new)
