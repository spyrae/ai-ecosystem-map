import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import type { BatchSyncPreview, Project, ProjectAsset, Provider, SyncPlan, SyncRequest, TopologyGraph } from '../types';
import { PROVIDER_LABELS, TYPE_LABELS, capabilitySummaryItems } from '../types';
import { fetchProjects, discoverProjects, fetchProjectAssetsById, fetchTopology, applySync, previewSync, previewBatchSync, applyBatchSync } from '../lib/api';
import { getProjectTopologyNode } from '../lib/topology';
import { ProviderBadge } from './ProviderBadge';
import { SyncPlanModal } from './SyncPlanModal';
import { BatchSyncPlanModal } from './BatchSyncPlanModal';

const TYPE_ICONS: Record<string, string> = {
  skill: '⚡',
  agent: '🤖',
  mcp: '🔌',
  instruction: '📋',
  rule: '📏',
};

// Draggable asset row inside expanded project
function DraggableAssetRow({
  asset,
  dragDisabled = false,
  selectionMode = false,
  selected = false,
  onToggleSelection,
}: {
  asset: ProjectAsset;
  dragDisabled?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelection?: (asset: ProjectAsset) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `project-asset-${asset.type}-${asset.name}-${asset.projectPath}`,
    data: { projectAsset: asset },
    disabled: selectionMode || dragDisabled,
  });
  const capabilityItems = capabilitySummaryItems(asset.capabilities).slice(0, 2);

  return (
    <div
      ref={setNodeRef}
      {...(selectionMode ? {} : listeners)}
      {...(selectionMode ? {} : attributes)}
      onClick={() => {
        if (selectionMode) onToggleSelection?.(asset);
      }}
      className={`flex items-center gap-2 px-2 py-1.5 rounded bg-surface2 text-xs transition-opacity ${
        selectionMode
          ? 'cursor-pointer ring-1 ring-inset'
          : dragDisabled
            ? 'cursor-default'
            : 'cursor-grab active:cursor-grabbing'
      } ${
        isDragging ? 'opacity-30' : ''
      } ${
        selectionMode && selected ? 'ring-accent bg-accent/10' : 'ring-transparent'
      }`}
    >
      {selectionMode && (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelection?.(asset);
          }}
          className={`flex h-5 w-5 items-center justify-center rounded-full border text-[11px] transition-colors ${
            selected
              ? 'border-accent bg-accent/15 text-accent'
              : 'border-border text-muted hover:border-accent/50 hover:text-text'
          }`}
          aria-label={selected ? `Deselect ${asset.name}` : `Select ${asset.name}`}
        >
          {selected ? '✓' : ''}
        </button>
      )}
      {asset.health?.status && asset.health.status !== 'ok' && (
        <span
          className={asset.health.status === 'broken' ? 'text-red' : 'text-amber-300'}
          title={asset.health.summary}
        >
          {asset.health.status === 'broken' ? '●' : '▲'}
        </span>
      )}
      <span className="font-mono text-accent truncate">{asset.name}</span>
      <span className="text-muted truncate flex-1">{asset.desc}</span>
      {capabilityItems.length > 0 && (
        <span className="text-[10px] text-muted shrink-0">
          {capabilityItems.join(' · ')}
        </span>
      )}
      <div className="flex gap-0.5 shrink-0">
        {asset.providers.map((p) => (
          <ProviderBadge key={p} provider={p} />
        ))}
      </div>
    </div>
  );
}

// Droppable project card
function DroppableProjectCard({
  project,
  isExpanded,
  dropDisabled = false,
  onExpand,
  children,
  summaryText,
}: {
  project: Project;
  isExpanded: boolean;
  dropDisabled?: boolean;
  onExpand: () => void;
  children?: React.ReactNode;
  summaryText?: string | null;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `project-drop-${project.id}`,
    data: { project },
    disabled: dropDisabled,
  });

  return (
    <div ref={setNodeRef}>
      <button
        onClick={onExpand}
        className={`w-full text-left bg-surface border rounded-lg p-4 hover:border-accent/50 transition-all ${
          isExpanded
            ? 'border-accent'
            : isOver
              ? 'border-emerald-400 bg-emerald-500/5 ring-1 ring-emerald-400/30'
              : 'border-border'
        }`}
      >
        <div className="flex items-center gap-3 mb-2">
          <span className="text-lg">📂</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-text truncate">{project.name}</h3>
              {project.environment_type === 'remote' && (
                <span className="rounded-md border border-sky-400/30 bg-sky-400/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">
                  Remote
                </span>
              )}
              {summaryText && (
                <span className="text-[11px] text-muted">{summaryText}</span>
              )}
            </div>
            <p className="text-[11px] text-muted font-mono truncate">
              {project.path}
              {project.environment_type === 'remote' && project.environment_name ? ` · ${project.environment_name}` : ''}
            </p>
          </div>
          {isOver && !dropDisabled && (
            <span className="text-[10px] text-emerald-400 font-medium shrink-0">Drop here</span>
          )}
          <svg
            className={`w-4 h-4 text-muted transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
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
      {children}
    </div>
  );
}

export function ProjectsView() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [topology, setTopology] = useState<TopologyGraph | null>(null);
  const [discoveredProjects, setDiscoveredProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanDir, setScanDir] = useState('');
  const [scanning, setScanning] = useState(false);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [projectAssets, setProjectAssets] = useState<ProjectAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [draggedAsset, setDraggedAsset] = useState<ProjectAsset | null>(null);
  const [movePrompt, setMovePrompt] = useState<{
    asset: ProjectAsset;
    targetProject: Project;
  } | null>(null);
  const [syncRequest, setSyncRequest] = useState<SyncRequest | null>(null);
  const [syncPlan, setSyncPlan] = useState<SyncPlan | null>(null);
  const [syncTitle, setSyncTitle] = useState('');
  const [syncLoading, setSyncLoading] = useState(false);
  const [applyingSync, setApplyingSync] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedProjectAssetIds, setSelectedProjectAssetIds] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<'all' | ProjectAsset['type']>('all');
  const [providerFilter, setProviderFilter] = useState<'all' | Provider>('all');
  const [batchTargetProjectPath, setBatchTargetProjectPath] = useState('');
  const [batchPreview, setBatchPreview] = useState<BatchSyncPreview | null>(null);
  const [batchRequests, setBatchRequests] = useState<SyncRequest[] | null>(null);
  const [batchTitle, setBatchTitle] = useState('');
  const [batchLoading, setBatchLoading] = useState(false);
  const [applyingBatchSync, setApplyingBatchSync] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadProjects = async () => {
    try {
      const [res, topologyRes] = await Promise.all([fetchProjects(), fetchTopology()]);
      setProjects(res.data);
      setTopology(topologyRes.data);
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

  const displayProjects = discoveredProjects.length > 0 ? discoveredProjects : projects;
  const selectedExpandedProject = useMemo(
    () => displayProjects.find((project) => project.id === expandedProjectId) ?? null,
    [displayProjects, expandedProjectId]
  );
  const selectedProjectIsRemote = selectedExpandedProject?.environment_type === 'remote';

  const handleExpand = async (project: Project) => {
    if (expandedProjectId === project.id) {
      setExpandedProjectId(null);
      setProjectAssets([]);
      setSelectionMode(false);
      setSelectedProjectAssetIds(new Set());
      return;
    }
    setExpandedProjectId(project.id);
    setAssetsLoading(true);
    setSelectionMode(false);
    setSelectedProjectAssetIds(new Set());
    try {
      const res = await fetchProjectAssetsById(project.id);
      setProjectAssets(res.data);
    } catch (err) {
      console.error('Failed to load project assets:', err);
      showToast('Failed to load assets');
    } finally {
      setAssetsLoading(false);
    }
  };

  function handleDragStart(event: DragStartEvent) {
    const asset = event.active.data.current?.projectAsset as ProjectAsset | undefined;
    if (asset) setDraggedAsset(asset);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggedAsset(null);
    const asset = event.active.data.current?.projectAsset as ProjectAsset | undefined;
    const targetProject = event.over?.data.current?.project as Project | undefined;

    if (!asset || !targetProject) return;
    // Don't drop onto the same project
    if (asset.projectPath === targetProject.path) return;
    if (asset.environment_type === 'remote') {
      showToast('Remote project assets are view-only for now');
      return;
    }
    if (targetProject.environment_type === 'remote') {
      showToast('Sync to remote projects is not available yet');
      return;
    }
    if (!['skill', 'agent', 'rule', 'instruction', 'mcp'].includes(asset.type)) {
      showToast(`Cannot move ${asset.type} assets`);
      return;
    }
    if (asset.type !== 'mcp' && !asset.filePath) {
      showToast('Asset has no file path');
      return;
    }

    setMovePrompt({ asset, targetProject });
  }

  async function openSyncPreview(request: SyncRequest, title: string) {
    setSyncLoading(true);
    try {
      const res = await previewSync(request);
      setSyncRequest(request);
      setSyncPlan(res.plan);
      setSyncTitle(title);
    } catch (err) {
      console.error('Failed to preview sync:', err);
      showToast('Failed to preview sync');
    } finally {
      setSyncLoading(false);
    }
  }

  async function executeMoveAsset(method: 'symlink' | 'copy') {
    if (!movePrompt) return;
    const { asset, targetProject } = movePrompt;
    setMovePrompt(null);

    await openSyncPreview({
      source: {
        assetId: asset.id,
        name: asset.name,
        type: asset.type,
        filePath: asset.filePath,
        providers: asset.providers,
        projectPath: asset.projectPath,
      },
      target: {
        kind: 'project',
        projectPath: targetProject.path,
        method,
      },
    }, `${method === 'symlink' ? 'Link' : 'Copy'} ${asset.name} → ${targetProject.name}`);
  }

  async function handleApplySync() {
    if (!syncRequest) return;
    setApplyingSync(true);
    try {
      const res = await applySync(syncRequest);
      if (res.ok) {
        const target = syncRequest.target.kind === 'project' ? syncRequest.target.projectPath : '';
        showToast(`Synced ${syncRequest.source.name}${target ? ` → ${target.split('/').pop()}` : ''}`);
        setSyncPlan(null);
        setSyncRequest(null);
        if (selectedExpandedProject) {
          const refreshed = await fetchProjectAssetsById(selectedExpandedProject.id);
          setProjectAssets(refreshed.data);
        }
        await loadProjects();
      } else {
        showToast(res.error || 'Sync failed');
      }
    } catch (err) {
      console.error('Failed to apply sync:', err);
      showToast('Sync failed');
    } finally {
      setApplyingSync(false);
    }
  }

  const targetProjects = displayProjects.filter(
    (project) => project.id !== expandedProjectId && project.environment_type !== 'remote'
  );
  const projectProviders = useMemo(
    () => [...new Set(projectAssets.flatMap((asset) => asset.providers))].filter(Boolean) as Provider[],
    [projectAssets]
  );
  const filteredProjectAssets = useMemo(() => projectAssets.filter((asset) => {
    if (typeFilter !== 'all' && asset.type !== typeFilter) return false;
    if (providerFilter !== 'all' && !asset.providers.includes(providerFilter)) return false;
    return true;
  }), [projectAssets, providerFilter, typeFilter]);
  const filteredGroupedAssets = useMemo(() => filteredProjectAssets.reduce<Record<string, ProjectAsset[]>>((acc, asset) => {
    if (!acc[asset.type]) acc[asset.type] = [];
    acc[asset.type].push(asset);
    return acc;
  }, {}), [filteredProjectAssets]);
  const selectedProjectAssets = useMemo(
    () => projectAssets.filter((asset) => selectedProjectAssetIds.has(asset.id)),
    [projectAssets, selectedProjectAssetIds]
  );

  useEffect(() => {
    if (!batchTargetProjectPath && targetProjects.length > 0) {
      setBatchTargetProjectPath(targetProjects[0].path);
    }
    if (batchTargetProjectPath && !targetProjects.some((project) => project.path === batchTargetProjectPath)) {
      setBatchTargetProjectPath(targetProjects[0]?.path ?? '');
    }
  }, [batchTargetProjectPath, targetProjects]);

  const toggleProjectAssetSelection = (asset: ProjectAsset) => {
    setSelectedProjectAssetIds((prev) => {
      const next = new Set(prev);
      if (next.has(asset.id)) next.delete(asset.id);
      else next.add(asset.id);
      return next;
    });
  };

  const clearProjectSelection = () => {
    setSelectedProjectAssetIds(new Set());
  };

  const setSelectionEnabled = (enabled: boolean) => {
    if (enabled && selectedProjectIsRemote) return;
    setSelectionMode(enabled);
    if (!enabled) clearProjectSelection();
  };

  const selectVisibleProjectAssets = () => {
    setSelectedProjectAssetIds(new Set(filteredProjectAssets.map((asset) => asset.id)));
  };

  const openBatchSyncPreview = async (requests: SyncRequest[], title: string) => {
    setBatchLoading(true);
    try {
      const result = await previewBatchSync(requests);
      setBatchRequests(requests);
      setBatchPreview(result);
      setBatchTitle(title);
    } catch (err) {
      console.error('Failed to preview batch sync:', err);
      showToast('Failed to preview batch sync');
    } finally {
      setBatchLoading(false);
    }
  };

  const previewBatchMove = async (method: 'copy' | 'symlink') => {
    if (!batchTargetProjectPath || selectedProjectAssets.length === 0) return;
    if (selectedProjectIsRemote) {
      showToast('Remote project assets are view-only for now');
      return;
    }
    const targetProject = targetProjects.find((project) => project.path === batchTargetProjectPath);
    if (!targetProject) {
      showToast('Choose a target project');
      return;
    }

    const requests: SyncRequest[] = selectedProjectAssets.map((asset) => ({
      source: {
        assetId: asset.id,
        name: asset.name,
        type: asset.type,
        filePath: asset.filePath,
        providers: asset.providers,
        projectPath: asset.projectPath,
      },
      target: {
        kind: 'project',
        projectPath: targetProject.path,
        method,
      },
    }));

    await openBatchSyncPreview(
      requests,
      `${method === 'symlink' ? 'Link' : 'Copy'} ${selectedProjectAssets.length} assets → ${targetProject.name}`
    );
  };

  const applyPendingBatchSync = async () => {
    if (!batchRequests) return;
    setApplyingBatchSync(true);
    try {
      const result = await applyBatchSync(batchRequests);
      showToast(`Applied batch sync: ${result.successCount}/${result.total} assets`);
      setBatchPreview(null);
      setBatchRequests(null);
      if (selectedExpandedProject) {
        const refreshed = await fetchProjectAssetsById(selectedExpandedProject.id);
        setProjectAssets(refreshed.data);
      }
      await loadProjects();
    } catch (err) {
      console.error('Failed to apply batch sync:', err);
      showToast('Batch sync failed');
    } finally {
      setApplyingBatchSync(false);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDraggedAsset(null)}
    >
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
            {displayProjects.map((project) => {
              const isExpanded = expandedProjectId === project.id;
              const isRemoteProject = project.environment_type === 'remote';
              const projectTopology = getProjectTopologyNode(topology, project.id);
              const assetCount = projectTopology?.summary?.assetCount ?? project.assetCount;
              const providerCount = projectTopology?.summary?.providerCount;
              const summaryText = [
                assetCount !== undefined ? `${assetCount} assets` : null,
                providerCount ? `${providerCount} providers` : null,
              ].filter(Boolean).join(' · ');
              return (
                <DroppableProjectCard
                  key={project.id}
                  project={project}
                  isExpanded={isExpanded}
                  dropDisabled={isRemoteProject}
                  onExpand={() => void handleExpand(project)}
                  summaryText={summaryText || null}
                >
                  {/* Expanded: project assets */}
                  {isExpanded && (
                    <div className="mt-1 ml-4 border-l-2 border-accent/30 pl-4 py-2">
                      {isRemoteProject && (
                        <div className="mb-3 rounded-lg border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-xs text-sky-200">
                          Remote project detected. Viewing assets is available; project-to-project sync actions stay disabled until remote project sync is implemented.
                        </div>
                      )}
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => setSelectionEnabled(!selectionMode)}
                          disabled={isRemoteProject}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                            selectionMode
                              ? 'border-accent/25 bg-accent/10 text-accent'
                              : 'border-border text-muted hover:text-text hover:border-accent/50'
                          } disabled:opacity-40`}
                        >
                          {selectionMode ? 'Done' : 'Select'}
                        </button>
                        <button
                          onClick={selectVisibleProjectAssets}
                          disabled={!selectionMode || filteredProjectAssets.length === 0}
                          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:text-text hover:border-accent/50 transition-colors disabled:opacity-40"
                        >
                          Select Visible
                        </button>
                        <button
                          onClick={clearProjectSelection}
                          disabled={!selectionMode || selectedProjectAssets.length === 0}
                          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:text-text hover:border-accent/50 transition-colors disabled:opacity-40"
                        >
                          Clear
                        </button>
                        <select
                          value={typeFilter}
                          onChange={(event) => setTypeFilter(event.target.value as 'all' | ProjectAsset['type'])}
                          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text focus:outline-none focus:border-accent"
                        >
                          <option value="all">All types</option>
                          {Object.entries(TYPE_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                        <select
                          value={providerFilter}
                          onChange={(event) => setProviderFilter(event.target.value as 'all' | Provider)}
                          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text focus:outline-none focus:border-accent"
                        >
                          <option value="all">All providers</option>
                          {projectProviders.map((provider) => (
                            <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>
                          ))}
                        </select>
                          {selectionMode && !isRemoteProject && (
                            <>
                            <span className="rounded-lg border border-accent/25 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent">
                              {selectedProjectAssets.length} selected
                            </span>
                            <select
                              value={batchTargetProjectPath}
                              onChange={(event) => setBatchTargetProjectPath(event.target.value)}
                              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text focus:outline-none focus:border-accent"
                            >
                              <option value="">Target project</option>
                              {targetProjects.map((targetProject) => (
                                <option key={targetProject.id} value={targetProject.path}>{targetProject.name}</option>
                              ))}
                            </select>
                            <button
                              onClick={() => void previewBatchMove('symlink')}
                              disabled={selectedProjectAssets.length === 0 || !batchTargetProjectPath}
                              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:text-text hover:border-accent/50 transition-colors disabled:opacity-40"
                            >
                              Link Selected
                            </button>
                            <button
                              onClick={() => void previewBatchMove('copy')}
                              disabled={selectedProjectAssets.length === 0 || !batchTargetProjectPath}
                              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:text-text hover:border-accent/50 transition-colors disabled:opacity-40"
                            >
                              Copy Selected
                            </button>
                          </>
                        )}
                      </div>

                      {assetsLoading ? (
                        <div className="text-xs text-muted py-2">Loading assets...</div>
                      ) : filteredProjectAssets.length === 0 ? (
                        <div className="text-xs text-muted py-2">No assets found in this project</div>
                      ) : (
                        Object.entries(filteredGroupedAssets).map(([type, items]) => (
                          <div key={type} className="mb-3">
                            <div className="text-[11px] text-muted uppercase tracking-wider mb-1.5">
                              {TYPE_ICONS[type] || '📦'} {type}s ({items.length})
                            </div>
                            <div className="space-y-1">
                              {items.map((asset) => (
                                <DraggableAssetRow
                                  key={`${asset.type}-${asset.name}`}
                                  asset={asset}
                                  dragDisabled={isRemoteProject}
                                  selectionMode={selectionMode}
                                  selected={selectedProjectAssetIds.has(asset.id)}
                                  onToggleSelection={toggleProjectAssetSelection}
                                />
                              ))}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </DroppableProjectCard>
              );
            })}
          </div>
        )}
      </div>

      {/* Drag overlay */}
      <DragOverlay dropAnimation={null}>
        {draggedAsset && (
          <div
            className="w-64 rounded-lg border border-accent/30 px-3 py-2 pointer-events-none"
            style={{
              backgroundImage: 'linear-gradient(180deg, hsl(240 5% 9%) 0%, hsl(240 5% 7.5%) 100%)',
              boxShadow: '0 16px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(99,102,241,0.3)',
              opacity: 0.85,
            }}
          >
            <span className="font-mono text-sm text-accent">{draggedAsset.name}</span>
            <span className="ml-2 text-[11px] text-muted">{draggedAsset.type}</span>
          </div>
        )}
      </DragOverlay>

      {/* Move prompt modal */}
      {movePrompt && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-surface border border-border rounded-xl p-6 w-96 shadow-2xl">
            <h3 className="text-sm font-semibold text-text mb-2">
              Move "{movePrompt.asset.name}" to {movePrompt.targetProject.name}?
            </h3>
            <p className="text-xs text-muted mb-5">
              Choose how to place this {movePrompt.asset.type} in the target project:
            </p>
            <div className="space-y-2">
              <button
                onClick={() => executeMoveAsset('symlink')}
                className="w-full text-left px-4 py-3 rounded-lg border border-border hover:border-accent/50 transition-colors"
              >
                <div className="text-sm font-medium text-text">🔗 Symlink (shared)</div>
                <div className="text-[11px] text-muted mt-0.5">Single source of truth — changes reflect in both projects</div>
              </button>
              <button
                onClick={() => executeMoveAsset('copy')}
                className="w-full text-left px-4 py-3 rounded-lg border border-border hover:border-accent/50 transition-colors"
              >
                <div className="text-sm font-medium text-text">📋 Copy (independent)</div>
                <div className="text-[11px] text-muted mt-0.5">Independent copy — can diverge from the original</div>
              </button>
            </div>
            <button
              onClick={() => setMovePrompt(null)}
              className="mt-4 w-full text-center text-xs text-muted hover:text-text transition-colors py-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] bg-surface border border-accent rounded-lg px-5 py-2.5 text-accent text-[13px] shadow-[0_4px_16px_rgba(0,0,0,.3)]">
          {toast}
        </div>
      )}

      {(syncPlan || syncLoading) && (
        <SyncPlanModal
          plan={syncPlan}
          applying={applyingSync || syncLoading}
          title={syncLoading ? 'Building sync preview...' : syncTitle}
          onApply={handleApplySync}
          onClose={() => {
            if (applyingSync || syncLoading) return;
            setSyncPlan(null);
            setSyncRequest(null);
          }}
        />
      )}

      {(batchPreview || batchLoading) && (
        <BatchSyncPlanModal
          preview={batchPreview}
          loading={batchLoading}
          applying={applyingBatchSync}
          title={batchLoading ? 'Building batch sync preview...' : batchTitle}
          onApply={applyPendingBatchSync}
          onClose={() => {
            if (batchLoading || applyingBatchSync) return;
            setBatchPreview(null);
            setBatchRequests(null);
          }}
        />
      )}
    </DndContext>
  );
}
