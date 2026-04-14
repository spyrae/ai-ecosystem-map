'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function normalizePath(value) {
  return value.replace(/\\/g, '/');
}

function runGit(args, cwd, { trim = true } = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  const output = result.stdout || '';
  return trim ? output.trim() : output;
}

function resolveGitRoot(inputPath) {
  if (!inputPath) return null;
  let cwd = inputPath;
  try {
    if (fs.existsSync(inputPath) && fs.statSync(inputPath).isFile()) {
      cwd = path.dirname(inputPath);
    } else if (path.extname(inputPath) || path.basename(inputPath).startsWith('.')) {
      cwd = path.dirname(inputPath);
    }
  } catch {
    cwd = path.extname(inputPath) || path.basename(inputPath).startsWith('.') ? path.dirname(inputPath) : inputPath;
  }
  return runGit(['rev-parse', '--show-toplevel'], cwd);
}

function parseStatusEntries(raw) {
  const entries = [];
  if (!raw) return entries;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;

    if (line.startsWith('?? ')) {
      entries.push({
        path: normalizePath(line.slice(3).trim()),
        staged: false,
        modified: false,
        untracked: true,
        conflicted: false,
      });
      continue;
    }

    if (line.length < 4) continue;
    const x = line[0];
    const y = line[1];
    let relativePath = line.slice(3).trim();
    if (relativePath.includes(' -> ')) {
      relativePath = relativePath.split(' -> ').pop() || relativePath;
    }

    const conflicted = ['U', 'A', 'D'].includes(x) && ['U', 'A', 'D'].includes(y);
    entries.push({
      path: normalizePath(relativePath),
      staged: !conflicted && x !== ' ' && x !== '?',
      modified: !conflicted && y !== ' ' && y !== '?',
      untracked: x === '?' && y === '?',
      conflicted,
    });
  }

  return entries;
}

function relevantStatus(entries, repoRoot, focusPath) {
  if (!focusPath) return null;
  const normalizedRoot = fs.existsSync(repoRoot) ? fs.realpathSync.native(repoRoot) : path.resolve(repoRoot);
  const normalizedFocus = fs.existsSync(focusPath) ? fs.realpathSync.native(focusPath) : path.resolve(focusPath);
  const relative = normalizePath(path.relative(normalizedRoot, normalizedFocus));
  const relevant = entries.filter((entry) =>
    entry.path === relative ||
    entry.path.startsWith(`${relative}/`) ||
    relative.startsWith(`${entry.path}/`)
  );

  if (!relevant.length) return 'clean';
  if (relevant.some((entry) => entry.conflicted)) return 'conflicted';
  if (relevant.some((entry) => entry.modified)) return 'modified';
  if (relevant.some((entry) => entry.staged)) return 'staged';
  if (relevant.some((entry) => entry.untracked)) return 'untracked';
  return 'clean';
}

function formatSummary(branch, counts) {
  const parts = [];
  if (branch) parts.push(branch);
  if (counts.conflictedCount) parts.push(`${counts.conflictedCount} conflicts`);
  if (counts.modifiedCount) parts.push(`${counts.modifiedCount} modified`);
  if (counts.stagedCount) parts.push(`${counts.stagedCount} staged`);
  if (counts.untrackedCount) parts.push(`${counts.untrackedCount} untracked`);
  if (parts.length === (branch ? 1 : 0)) parts.push('clean');
  return parts.join(' · ');
}

function inspectGitContext(targetPath, focusPath = null, cache = null) {
  const cacheKey = focusPath ? `${targetPath}::${focusPath}` : targetPath;
  if (cache && cache.has(cacheKey)) return cache.get(cacheKey);

  const repoRoot = resolveGitRoot(targetPath);
  if (!repoRoot) {
    if (cache) cache.set(cacheKey, null);
    return null;
  }

  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot) || 'detached';
  const porcelain = runGit(['status', '--porcelain=v1', '--untracked-files=all'], repoRoot, { trim: false }) || '';
  const entries = parseStatusEntries(porcelain);
  const counts = {
    conflictedCount: entries.filter((entry) => entry.conflicted).length,
    modifiedCount: entries.filter((entry) => entry.modified).length,
    stagedCount: entries.filter((entry) => entry.staged).length,
    untrackedCount: entries.filter((entry) => entry.untracked).length,
  };
  const dirty = Object.values(counts).some((value) => value > 0);
  const context = {
    repoRoot,
    branch,
    dirty,
    ...counts,
    relevantStatus: relevantStatus(entries, repoRoot, focusPath),
    summary: formatSummary(branch, counts),
  };

  if (cache) cache.set(cacheKey, context);
  return context;
}

module.exports = {
  inspectGitContext,
};
