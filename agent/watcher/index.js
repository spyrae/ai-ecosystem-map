'use strict';

const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || process.env.USERPROFILE || '';

/**
 * Watch config directories for changes. Triggers callback on any change.
 * Uses debouncing to batch rapid file system events.
 */
function createWatcher(claudeDir, projectRoot, onChange) {
  const watchers = [];
  let debounceTimer = null;

  function debouncedOnChange() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try { onChange(); } catch (e) {
        console.error('  Watcher rescan error:', e.message);
      }
    }, 500);
  }

  // Directories to watch
  const watchPaths = [
    path.join(claudeDir, 'commands'),
    path.join(claudeDir, 'agents'),
    path.join(claudeDir, '.mcp.json'),
    path.join(HOME, '.codex'),
    path.join(HOME, '.gemini'),
  ];

  // Project-level paths
  if (projectRoot) {
    watchPaths.push(
      path.join(projectRoot, '.cursor', 'rules'),
      path.join(projectRoot, '.windsurf', 'rules'),
      path.join(projectRoot, '.mcp.json'),
    );
  }

  for (const watchPath of watchPaths) {
    if (!fs.existsSync(watchPath)) continue;

    try {
      const stat = fs.statSync(watchPath);
      const opts = stat.isDirectory() ? { recursive: true } : {};

      const w = fs.watch(watchPath, opts, (eventType, filename) => {
        // Skip temp files, .DS_Store, etc.
        if (filename && (filename.startsWith('.') || filename.endsWith('~') || filename.endsWith('.swp'))) return;
        debouncedOnChange();
      });

      w.on('error', () => { /* ignore watch errors */ });
      watchers.push(w);
    } catch {
      // Can't watch this path, skip
    }
  }

  return {
    close() {
      for (const w of watchers) {
        try { w.close(); } catch { /* ignore */ }
      }
      if (debounceTimer) clearTimeout(debounceTimer);
    },
    watcherCount: watchers.length,
  };
}

module.exports = { createWatcher };
