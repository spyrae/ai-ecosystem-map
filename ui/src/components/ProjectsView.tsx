import { useEffect, useState } from 'react';
import type { Project, ProjectAsset } from '../types';
import { fetchProjects, discoverProjects, fetchProjectAssets } from '../lib/api';
import { ProviderBadge } from './ProviderBadge';

const TYPE_ICONS: Record<string, string> = {
  skill: '⚡',
  agent: '🤖',
  mcp: '🔌',
  instruction: '📋',
  rule: '📏',
};

export function ProjectsView() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [discoveredProjects, setDiscoveredProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanDir, setScanDir] = useState('');
  const [scanning, setScanning] = useState(false);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [projectAssets, setProjectAssets] = useState<ProjectAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadProjects = async () => {
    try {
      const res = await fetchProjects();
      setProjects(res.data);
    } catch (err) {
      console.error('Failed to load projects:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadProjects(); }, []);

  const handleDiscover = async () => {
    if (!scanDir.trim()) return;
    setScanning(true);
    setDiscoveredProjects([]);
    try {
      const res = await discoverProjects([scanDir.trim()]);
      setDiscoveredProjects(res.data);
      if (res.data.length > 0) {
        showToast(`Found ${res.data.length} projects with AI tooling`);
        await loadProjects();
      } else {
        showToast('No projects with AI tooling found in this directory');
      }
    } catch (err) {
      console.error('Discovery failed:', err);
      showToast('Discovery failed: ' + (err instanceof Error ? err.message : 'Error'));
    } finally {
      setScanning(false);
    }
  };

  const handleExpand = async (projectPath: string) => {
    if (expandedProject === projectPath) {
      setExpandedProject(null);
      setProjectAssets([]);
      return;
    }
    setExpandedProject(projectPath);
    setAssetsLoading(true);
    try {
      const res = await fetchProjectAssets(projectPath);
      setProjectAssets(res.data);
    } catch (err) {
      console.error('Failed to load project assets:', err);
      showToast('Failed to load assets');
    } finally {
      setAssetsLoading(false);
    }
  };

  // Group assets by type
  const groupedAssets = projectAssets.reduce<Record<string, ProjectAsset[]>>((acc, a) => {
    if (!acc[a.type]) acc[a.type] = [];
    acc[a.type].push(a);
    return acc;
  }, {});

  // Use discovered projects if available, otherwise stored ones
  const displayProjects = discoveredProjects.length > 0 ? discoveredProjects : projects;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-text">Projects</h2>
      </div>

      {/* Discover bar */}
      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={scanDir}
          onChange={(e) => setScanDir(e.target.value)}
          placeholder="Parent directory to scan, e.g. ~/Projects"
          className="flex-1 bg-surface border border-border rounded-lg px-4 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus:border-accent"
          onKeyDown={(e) => e.key === 'Enter' && handleDiscover()}
        />
        <button
          onClick={handleDiscover}
          disabled={scanning || !scanDir.trim()}
          className="px-4 py-2 text-sm font-medium bg-accent/15 text-accent border border-accent/30 rounded-lg hover:bg-accent/25 transition-colors disabled:opacity-40"
        >
          {scanning ? 'Scanning...' : 'Discover'}
        </button>
      </div>

      {loading ? (
        <div className="text-muted text-center py-12">Loading projects...</div>
      ) : displayProjects.length === 0 ? (
        <div className="text-center py-16">
          <span className="text-4xl block mb-3">📁</span>
          <p className="text-muted mb-1">No projects discovered yet</p>
          <p className="text-xs text-muted">Enter a directory path above to scan for projects with AI tooling</p>
          <p className="text-xs text-muted mt-1">Tip: use full path like <code className="text-accent">/Users/you/Projects</code> or <code className="text-accent">~/Projects</code></p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
          {displayProjects.map((project) => (
            <div key={project.path || project.id}>
              <button
                onClick={() => handleExpand(project.path)}
                className={`w-full text-left bg-surface border rounded-lg p-4 hover:border-accent/50 transition-all ${
                  expandedProject === project.path ? 'border-accent' : 'border-border'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-lg">📂</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-text truncate">{project.name}</h3>
                      {project.assetCount !== undefined && (
                        <span className="text-[11px] text-muted">{project.assetCount} assets</span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted font-mono truncate">{project.path}</p>
                  </div>
                  <svg
                    className={`w-4 h-4 text-muted transition-transform shrink-0 ${expandedProject === project.path ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                {project.providers && project.providers.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {project.providers.map((p) => (
                      <ProviderBadge key={p} provider={p} />
                    ))}
                  </div>
                )}
              </button>

              {/* Expanded: project assets */}
              {expandedProject === project.path && (
                <div className="mt-1 ml-4 border-l-2 border-accent/30 pl-4 py-2">
                  {assetsLoading ? (
                    <div className="text-xs text-muted py-2">Loading assets...</div>
                  ) : projectAssets.length === 0 ? (
                    <div className="text-xs text-muted py-2">No local assets found in this project</div>
                  ) : (
                    Object.entries(groupedAssets).map(([type, items]) => (
                      <div key={type} className="mb-3">
                        <div className="text-[11px] text-muted uppercase tracking-wider mb-1.5">
                          {TYPE_ICONS[type] || '📦'} {type}s ({items.length})
                        </div>
                        <div className="space-y-1">
                          {items.map((asset) => (
                            <div
                              key={`${asset.type}-${asset.name}`}
                              className="flex items-center gap-2 px-2 py-1.5 rounded bg-surface2 text-xs"
                            >
                              <span className="font-mono text-accent truncate">{asset.name}</span>
                              <span className="text-muted truncate flex-1">{asset.desc}</span>
                              <div className="flex gap-0.5 shrink-0">
                                {asset.providers.map((p) => (
                                  <ProviderBadge key={p} provider={p} />
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] bg-surface border border-accent rounded-lg px-5 py-2.5 text-accent text-[13px] shadow-[0_4px_16px_rgba(0,0,0,.3)]">
          {toast}
        </div>
      )}
    </div>
  );
}
