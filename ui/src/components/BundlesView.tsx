import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import type {
  Asset,
  AuditMode,
  Bundle,
  BundleItem,
  BundlePreviewData,
  BundleTarget,
  Environment,
  Project,
  Provider,
  RunningAgent,
  WorkspaceManifest,
  WorkspaceManifestExportOptions,
  WorkspaceManifestImportPreviewData,
} from '../types';
import { PROVIDER_LABELS, TYPE_LABELS } from '../types';
import {
  applyBundle,
  applyImportManifest,
  createBundle,
  deleteBundle,
  exportWorkspaceManifest,
  fetchAssets,
  fetchBundles,
  fetchProjectAssetsById,
  fetchProjects,
  fetchRunningAgents,
  fetchServers,
  previewBundle,
  previewImportManifest,
  updateBundle,
} from '../lib/api';
import { BatchSyncPlanModal } from './BatchSyncPlanModal';

type TargetKind = BundleTarget['kind'];

function bundleItemKey(item: Pick<BundleItem, 'assetId' | 'name' | 'type' | 'projectPath' | 'filePath'>) {
  return item.assetId || `${item.type}:${item.name}:${item.projectPath || ''}:${item.filePath || ''}`;
}

function formatTimestamp(value?: number | null) {
  if (!value) return 'Never';
  const timestamp = value > 1_000_000_000_000 ? value : value * 1000;
  return new Date(timestamp).toLocaleString();
}

function resolveAgentProjectPath(agent: RunningAgent, localProjects: Project[]) {
  const introspection = agent.introspection;
  if (!introspection?.checkedAt) return null;
  const projectPaths = [...new Set((introspection.assets || []).map((asset) => asset.projectPath).filter(Boolean))];
  if (projectPaths.length !== 1) return null;
  const projectPath = projectPaths[0]!;
  const project = localProjects.find((entry) => entry.path === projectPath && entry.environment_type !== 'remote');
  return project ? project.path : null;
}

type BundleEditorCandidate = {
  key: string;
  item: BundleItem;
  found: boolean;
};

function buildEditorCandidates(sourceItems: BundleItem[], initialItems: BundleItem[]) {
  const candidates = new Map<string, BundleEditorCandidate>();

  for (const item of sourceItems) {
    candidates.set(bundleItemKey(item), {
      key: bundleItemKey(item),
      item,
      found: true,
    });
  }

  for (const item of initialItems) {
    const key = bundleItemKey(item);
    if (!candidates.has(key)) {
      candidates.set(key, { key, item, found: false });
    }
  }

  return [...candidates.values()].sort((a, b) => {
    if (a.item.type !== b.item.type) return a.item.type.localeCompare(b.item.type);
    return a.item.name.localeCompare(b.item.name);
  });
}

function buildSourceItems(localEnvironmentId: string | null, assets: Asset[], projectAssets: Array<{
  id: string;
  name: string;
  type: BundleItem['type'];
  filePath?: string;
  providers: string[];
  projectPath: string;
}>) {
  const items: BundleItem[] = [];
  for (const asset of assets) {
    if (!['skill', 'agent', 'mcp', 'instruction', 'rule'].includes(asset.type)) continue;
    if (localEnvironmentId && asset.environment_id && asset.environment_id !== localEnvironmentId) continue;
    items.push({
      assetId: asset.id,
      name: asset.name,
      type: asset.type,
      filePath: asset.filePath || null,
      providers: asset.providers || [],
      scope: asset.environment_id ? 'remote' : 'local',
    });
  }
  for (const asset of projectAssets) {
    items.push({
      assetId: asset.id,
      name: asset.name,
      type: asset.type,
      filePath: asset.filePath || null,
      providers: asset.providers || [],
      projectPath: asset.projectPath,
      scope: 'project',
    });
  }
  return items;
}

function BundleEditorModal({
  bundle,
  sourceItems,
  saving,
  onClose,
  onSave,
}: {
  bundle: Bundle | null;
  sourceItems: BundleItem[];
  saving: boolean;
  onClose: () => void;
  onSave: (payload: { name: string; description: string; versionLabel: string; items: BundleItem[] }) => Promise<void>;
}) {
  const [name, setName] = useState(bundle?.name || '');
  const [description, setDescription] = useState(bundle?.description || '');
  const [versionLabel, setVersionLabel] = useState('');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | BundleItem['type']>('all');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    new Set((bundle?.items || []).map((item) => bundleItemKey(item)))
  );

  const candidates = useMemo(
    () => buildEditorCandidates(sourceItems, bundle?.items || []),
    [sourceItems, bundle?.items]
  );

  const filteredCandidates = useMemo(() => {
    return candidates.filter((candidate) => {
      if (typeFilter !== 'all' && candidate.item.type !== typeFilter) return false;
      if (!query) return true;
      const haystack = `${candidate.item.name} ${candidate.item.type} ${(candidate.item.providers || []).join(' ')}`.toLowerCase();
      return haystack.includes(query.toLowerCase());
    });
  }, [candidates, query, typeFilter]);

  const selectedItems = useMemo(
    () => candidates.filter((candidate) => selectedKeys.has(candidate.key)).map((candidate) => candidate.item),
    [candidates, selectedKeys]
  );

  const canSave = name.trim().length > 0 && selectedItems.length > 0 && !saving;

  return (
    <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
      <div className="flex max-h-[84vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_16px_60px_rgba(0,0,0,.45)]">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <div className="text-base font-semibold text-text">{bundle ? 'Edit Bundle' : 'Create Bundle'}</div>
            <div className="mt-1 text-xs text-muted">Reusable harness stack across providers, projects, servers, and running agents.</div>
          </div>
          <button onClick={onClose} className="text-muted transition-colors hover:text-text" aria-label="Close bundle editor">✕</button>
        </div>

        <div className="grid flex-1 gap-0 overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-4 border-r border-border p-5">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-[0.18em] text-muted">Name</label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Research Stack"
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-[0.18em] text-muted">Description</label>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
                placeholder="Shared harness setup for a common workflow."
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-[0.18em] text-muted">Version Label</label>
              <input
                value={versionLabel}
                onChange={(event) => setVersionLabel(event.target.value)}
                placeholder={bundle ? 'What changed in this version?' : 'Initial bundle snapshot'}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
              />
            </div>
            <div className="rounded-xl border border-border bg-bg/40 p-4">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Selected Items</div>
              <div className="mt-2 text-2xl font-semibold text-text">{selectedItems.length}</div>
              <div className="mt-1 text-xs text-muted">Bundle must contain at least one harness asset.</div>
            </div>
          </div>

          <div className="flex min-h-0 flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-4">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter assets…"
                className="min-w-[220px] flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
              />
              <select
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value as 'all' | BundleItem['type'])}
                className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
              >
                <option value="all">All types</option>
                {(['skill', 'agent', 'mcp', 'instruction', 'rule'] as const).map((type) => (
                  <option key={type} value={type}>{TYPE_LABELS[type]}</option>
                ))}
              </select>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="space-y-2">
                {filteredCandidates.map((candidate) => {
                  const selected = selectedKeys.has(candidate.key);
                  return (
                    <button
                      key={candidate.key}
                      type="button"
                      onClick={() => {
                        setSelectedKeys((prev) => {
                          const next = new Set(prev);
                          if (next.has(candidate.key)) next.delete(candidate.key);
                          else next.add(candidate.key);
                          return next;
                        });
                      }}
                      className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                        selected
                          ? 'border-accent bg-accent/10'
                          : 'border-border bg-bg/40 hover:border-accent/40'
                      }`}
                    >
                      <div className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border text-[11px] ${
                        selected ? 'border-accent bg-accent/15 text-accent' : 'border-border text-muted'
                      }`}>
                        {selected ? '✓' : ''}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-text">{candidate.item.name}</span>
                          <span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted">
                            {TYPE_LABELS[candidate.item.type]}
                          </span>
                          {!candidate.found && (
                            <span className="rounded-md border border-orange/30 bg-orange/10 px-1.5 py-0.5 text-[10px] font-medium text-orange">
                              not found locally
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-muted">
                          {(candidate.item.providers || []).map((provider) => PROVIDER_LABELS[provider as Provider] || provider).join(' · ') || 'No providers'}
                        </div>
                        {candidate.item.projectPath && (
                          <div className="mt-1 truncate font-mono text-[11px] text-muted">{candidate.item.projectPath}</div>
                        )}
                      </div>
                    </button>
                  );
                })}
                {filteredCandidates.length === 0 && (
                  <div className="rounded-xl border border-border bg-bg/40 px-4 py-5 text-sm text-muted">
                    No harness assets match the current filter.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
          <div className="text-xs text-muted">
            {bundle ? 'Saving item changes creates a new bundle version when content changes.' : 'Bundle items are snapshots of source assets that can be applied elsewhere.'}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-muted transition-colors hover:text-text">Cancel</button>
            <button
              onClick={() => void onSave({ name: name.trim(), description: description.trim(), versionLabel: versionLabel.trim(), items: selectedItems })}
              disabled={!canSave}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg transition-colors hover:bg-accent/90 disabled:opacity-40"
            >
              {saving ? 'Saving…' : bundle ? 'Save Bundle' : 'Create Bundle'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function manifestIssueTone(level: 'warning' | 'blocking') {
  return level === 'blocking'
    ? 'border-red/40 bg-red/10 text-red'
    : 'border-orange/40 bg-orange/10 text-orange';
}

function ManifestExportModal({
  selection,
  exporting,
  onSelectionChange,
  onClose,
  onExport,
}: {
  selection: WorkspaceManifestExportOptions;
  exporting: boolean;
  onSelectionChange: (selection: WorkspaceManifestExportOptions) => void;
  onClose: () => void;
  onExport: () => void;
}) {
  const selectedCount = Number(selection.includeAssets) + Number(selection.includeBundles) + Number(selection.includePolicies);
  return (
    <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_16px_60px_rgba(0,0,0,.45)]">
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-base font-semibold text-text">Export Workspace Manifest</div>
              <div className="mt-1 text-xs text-muted">Portable snapshot of harness assets, bundles, and policies for another HCP workspace.</div>
            </div>
            <button onClick={onClose} className="text-muted transition-colors hover:text-text" aria-label="Close manifest export">
              ✕
            </button>
          </div>
        </div>

        <div className="space-y-3 px-5 py-4">
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-bg/40 px-4 py-3">
            <input
              type="checkbox"
              checked={selection.includeAssets}
              onChange={(event) => onSelectionChange({ ...selection, includeAssets: event.target.checked })}
              className="mt-0.5"
            />
            <div>
              <div className="font-medium text-text">Assets</div>
              <div className="mt-1 text-xs text-muted">Local and project-level skills, agents, MCP, instructions, and rules.</div>
            </div>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-bg/40 px-4 py-3">
            <input
              type="checkbox"
              checked={selection.includeBundles}
              onChange={(event) => onSelectionChange({ ...selection, includeBundles: event.target.checked })}
              className="mt-0.5"
            />
            <div>
              <div className="font-medium text-text">Bundles</div>
              <div className="mt-1 text-xs text-muted">Reusable harness stacks and saved bundle versions.</div>
            </div>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-bg/40 px-4 py-3">
            <input
              type="checkbox"
              checked={selection.includePolicies}
              onChange={(event) => onSelectionChange({ ...selection, includePolicies: event.target.checked })}
              className="mt-0.5"
            />
            <div>
              <div className="font-medium text-text">Policies</div>
              <div className="mt-1 text-xs text-muted">Governance rules, selectors, severities, and enforcement definitions.</div>
            </div>
          </label>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
          <div className="text-xs text-muted">
            {selectedCount > 0
              ? 'Manifest is exported as sorted JSON and can be previewed before import.'
              : 'Choose at least one scope to export.'}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-muted transition-colors hover:text-text">
              Cancel
            </button>
            <button
              onClick={onExport}
              disabled={exporting || selectedCount === 0}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg transition-colors hover:bg-accent/90 disabled:opacity-40"
            >
              {exporting ? 'Exporting…' : 'Download Manifest'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ManifestSummaryPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg/40 px-4 py-3">
      <div className={`text-lg font-semibold ${tone}`}>{value}</div>
      <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-muted">{label}</div>
    </div>
  );
}

function ManifestImportModal({
  fileName,
  preview,
  loading,
  applying,
  readOnly,
  readOnlyReason,
  onChooseFile,
  onApply,
  onClose,
}: {
  fileName: string;
  preview: WorkspaceManifestImportPreviewData | null;
  loading: boolean;
  applying: boolean;
  readOnly: boolean;
  readOnlyReason?: string;
  onChooseFile: () => void;
  onApply: () => void;
  onClose: () => void;
}) {
  const canApply = !!preview?.canApply && !readOnly;

  return (
    <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
      <div className="flex max-h-[82vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_16px_60px_rgba(0,0,0,.45)]">
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-base font-semibold text-text">Import Workspace Manifest</div>
              <div className="mt-1 text-xs text-muted">Preview writes before importing portable harness state into this workspace.</div>
              <div className="mt-2 text-[11px] text-muted">{fileName || 'Choose a manifest JSON file to begin.'}</div>
            </div>
            <button onClick={onClose} className="text-muted transition-colors hover:text-text" aria-label="Close manifest import">
              ✕
            </button>
          </div>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onChooseFile}
              disabled={loading || applying}
              className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-[hsl(240,4%,13%)] disabled:opacity-40"
            >
              {loading ? 'Reading Manifest…' : (preview ? 'Choose Another File' : 'Choose Manifest File')}
            </button>
            {preview?.manifest.summary && (
              <span className="text-xs text-muted">
                Exported {new Date(preview.manifest.exportedAt).toLocaleString()}
              </span>
            )}
          </div>

          {readOnly && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
              {readOnlyReason || 'Global read-only audit mode is enabled. Import apply is disabled.'}
            </div>
          )}

          {!preview && !loading && (
            <div className="rounded-xl border border-border bg-bg/40 px-4 py-5 text-sm text-muted">
              The manifest preview will show asset writes, bundle updates, policy changes, and any blocking issues before anything is applied.
            </div>
          )}

          {preview && (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <ManifestSummaryPill label="Writes" value={preview.writeCount} tone="text-accent" />
                <ManifestSummaryPill label="Blocked" value={preview.counts.assets.blocked} tone="text-red" />
                <ManifestSummaryPill label="Bundles" value={preview.counts.bundles.create + preview.counts.bundles.update} tone="text-green" />
                <ManifestSummaryPill label="Policies" value={preview.counts.policies.create + preview.counts.policies.update} tone="text-orange" />
              </div>

              {preview.issues.length > 0 && (
                <div className="space-y-2">
                  {preview.issues.map((issue) => (
                    <div key={`${issue.level}-${issue.code}-${issue.message}`} className={`rounded-lg border px-3 py-2 text-sm ${manifestIssueTone(issue.level)}`}>
                      <div className="font-medium">{issue.level === 'blocking' ? 'Blocking' : 'Warning'}</div>
                      <div className="mt-0.5">{issue.message}</div>
                    </div>
                  ))}
                </div>
              )}

              <ManifestImportSection title="Assets" emptyLabel="No assets in manifest.">
                {preview.assets.map((entry) => (
                  <div key={entry.key} className="rounded-lg border border-border bg-bg/40 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-text">{entry.name}</span>
                          <span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted">
                            {TYPE_LABELS[entry.type]}
                          </span>
                          <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
                            entry.action === 'blocked'
                              ? 'border-red/40 bg-red/10 text-red'
                              : entry.action === 'update'
                                ? 'border-orange/40 bg-orange/10 text-orange'
                                : entry.action === 'create'
                                  ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                                  : 'border-border text-muted'
                          }`}>
                            {entry.action}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted">{entry.summary}</div>
                        {(entry.targetPath || entry.projectPath) && (
                          <div className="mt-1 break-all font-mono text-[11px] text-muted">{entry.targetPath || entry.projectPath}</div>
                        )}
                      </div>
                    </div>
                    {entry.issues.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {entry.issues.map((issue) => (
                          <div key={`${entry.key}-${issue.level}-${issue.code}`} className={`rounded-lg border px-3 py-2 text-sm ${manifestIssueTone(issue.level)}`}>
                            {issue.message}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </ManifestImportSection>

              <ManifestImportSection title="Bundles" emptyLabel="No bundles in manifest.">
                {preview.bundles.map((entry) => (
                  <div key={`bundle-${entry.name}`} className="rounded-lg border border-border bg-bg/40 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium text-text">{entry.name}</div>
                        <div className="mt-1 text-xs text-muted">{entry.summary}</div>
                      </div>
                      <span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted">{entry.action}</span>
                    </div>
                  </div>
                ))}
              </ManifestImportSection>

              <ManifestImportSection title="Policies" emptyLabel="No policies in manifest.">
                {preview.policies.map((entry) => (
                  <div key={`policy-${entry.name}`} className="rounded-lg border border-border bg-bg/40 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium text-text">{entry.name}</div>
                        <div className="mt-1 text-xs text-muted">{entry.summary}</div>
                      </div>
                      <span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted">{entry.action}</span>
                    </div>
                  </div>
                ))}
              </ManifestImportSection>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
          <div className="text-xs text-muted">
            {preview
              ? canApply
                ? 'Manifest import will write through the same preview/apply flow used by bundles and sync.'
                : 'Resolve blocking issues or disable read-only mode before applying.'
              : 'Choose a manifest to generate an import preview.'}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-muted transition-colors hover:text-text">
              Cancel
            </button>
            <button
              onClick={onApply}
              disabled={!preview || !canApply || applying}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg transition-colors hover:bg-accent/90 disabled:opacity-40"
            >
              {applying ? 'Applying…' : 'Apply Import'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ManifestImportSection({
  title,
  emptyLabel,
  children,
}: {
  title: string;
  emptyLabel: string;
  children: ReactNode;
}) {
  const content = Array.isArray(children) ? children.filter(Boolean) : children;
  const hasContent = Array.isArray(content) ? content.length > 0 : Boolean(content);
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">{title}</div>
      <div className="space-y-2">
        {hasContent ? content : (
          <div className="rounded-lg border border-border bg-bg/40 px-4 py-3 text-sm text-muted">{emptyLabel}</div>
        )}
      </div>
    </div>
  );
}

export function BundlesView({
  auditMode,
}: {
  auditMode: AuditMode | null;
}) {
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [sourceItems, setSourceItems] = useState<BundleItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [servers, setServers] = useState<Environment[]>([]);
  const [runningAgents, setRunningAgents] = useState<RunningAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBundleId, setSelectedBundleId] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [editingBundle, setEditingBundle] = useState<Bundle | null>(null);
  const [savingBundle, setSavingBundle] = useState(false);
  const [query, setQuery] = useState('');
  const [targetKind, setTargetKind] = useState<TargetKind>('provider');
  const [providerTarget, setProviderTarget] = useState<Provider>('claude');
  const [projectTarget, setProjectTarget] = useState('');
  const [projectMethod, setProjectMethod] = useState<'copy' | 'symlink'>('symlink');
  const [serverTarget, setServerTarget] = useState('');
  const [runningAgentTarget, setRunningAgentTarget] = useState('');
  const [runningAgentMethod, setRunningAgentMethod] = useState<'copy' | 'symlink'>('symlink');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [previewData, setPreviewData] = useState<BundlePreviewData | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [manifestExportSelection, setManifestExportSelection] = useState<WorkspaceManifestExportOptions>({
    includeAssets: true,
    includeBundles: true,
    includePolicies: true,
  });
  const [exportingManifest, setExportingManifest] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [manifestImportFileName, setManifestImportFileName] = useState('');
  const [manifestImportPayload, setManifestImportPayload] = useState<WorkspaceManifest | null>(null);
  const [manifestImportPreview, setManifestImportPreview] = useState<WorkspaceManifestImportPreviewData | null>(null);
  const [manifestPreviewLoading, setManifestPreviewLoading] = useState(false);
  const [manifestApplying, setManifestApplying] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const manifestFileInputRef = useRef<HTMLInputElement | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => current === message ? null : current), 3000);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [bundleRes, assetRes, projectRes, serverRes, agentRes] = await Promise.all([
        fetchBundles(),
        fetchAssets(),
        fetchProjects(),
        fetchServers(),
        fetchRunningAgents(),
      ]);
      const nextBundles = bundleRes.data || [];
      const localProjects = (projectRes.data || []).filter((project) => project.environment_type !== 'remote');
      const localEnvironmentId = (serverRes.data || []).find((server) => server.type === 'local')?.id || null;
      const projectAssets = await Promise.all(localProjects.map(async (project) => {
        const res = await fetchProjectAssetsById(project.id);
        return (res.data || []).map((asset) => ({
          id: asset.id,
          name: asset.name,
          type: asset.type,
          filePath: asset.filePath,
          providers: asset.providers || [],
          projectPath: asset.projectPath,
        }));
      }));
      setBundles(nextBundles);
      setSourceItems(buildSourceItems(localEnvironmentId, assetRes.data || [], projectAssets.flat()));
      setProjects(projectRes.data || []);
      setServers(serverRes.data || []);
      setRunningAgents(agentRes.data || []);
      setSelectedBundleId((current) => {
        if (current && nextBundles.some((bundle) => bundle.id === current)) return current;
        return nextBundles[0]?.id || null;
      });
    } catch (error) {
      console.error('Failed to load bundles view:', error);
      showToast('Failed to load bundles');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const selectedBundle = useMemo(
    () => bundles.find((bundle) => bundle.id === selectedBundleId) || null,
    [bundles, selectedBundleId]
  );

  const filteredBundles = useMemo(() => {
    return bundles.filter((bundle) => {
      if (!query) return true;
      const haystack = `${bundle.name} ${bundle.description}`.toLowerCase();
      return haystack.includes(query.toLowerCase());
    });
  }, [bundles, query]);

  const localProjects = useMemo(
    () => projects.filter((project) => project.environment_type !== 'remote'),
    [projects]
  );

  const remoteServers = useMemo(
    () => servers.filter((server) => server.type === 'remote'),
    [servers]
  );

  const eligibleAgents = useMemo(() => {
    return runningAgents
      .map((agent) => ({
        agent,
        projectPath: resolveAgentProjectPath(agent, localProjects),
      }))
      .filter((entry) => entry.projectPath);
  }, [runningAgents, localProjects]);

  useEffect(() => {
    if (!projectTarget && localProjects[0]) setProjectTarget(localProjects[0].path);
  }, [localProjects, projectTarget]);

  useEffect(() => {
    if (!serverTarget && remoteServers[0]) setServerTarget(remoteServers[0].id);
  }, [remoteServers, serverTarget]);

  useEffect(() => {
    if (!runningAgentTarget && eligibleAgents[0]) setRunningAgentTarget(eligibleAgents[0].agent.id);
  }, [eligibleAgents, runningAgentTarget]);

  const environmentPolicies = useMemo(
    () => new Map((auditMode?.environments || []).map((entry) => [entry.environment_id, entry.read_only])),
    [auditMode]
  );

  const buildTarget = useCallback((): BundleTarget | null => {
    if (targetKind === 'provider') {
      return { kind: 'provider', provider: providerTarget };
    }
    if (targetKind === 'project') {
      if (!projectTarget) return null;
      return { kind: 'project', projectPath: projectTarget, method: projectMethod };
    }
    if (targetKind === 'server') {
      if (!serverTarget) return null;
      return { kind: 'server', serverId: serverTarget };
    }
    if (!runningAgentTarget) return null;
    return { kind: 'running_agent', agentId: runningAgentTarget, method: runningAgentMethod };
  }, [projectMethod, projectTarget, providerTarget, runningAgentMethod, runningAgentTarget, serverTarget, targetKind]);

  const target = buildTarget();
  const selectedServer = remoteServers.find((server) => server.id === serverTarget) || null;
  const selectedAgent = eligibleAgents.find((entry) => entry.agent.id === runningAgentTarget) || null;
  const targetReadOnly = auditMode?.global_read_only === true
    || (targetKind === 'server' && !!selectedServer && environmentPolicies.get(selectedServer.id) === true);
  const targetReadOnlyReason = auditMode?.global_read_only === true
    ? 'Global read-only audit mode is enabled.'
    : targetKind === 'server' && selectedServer && environmentPolicies.get(selectedServer.id) === true
      ? `${selectedServer.name} is in read-only audit mode.`
      : undefined;

  const handleSaveBundle = useCallback(async (payload: { name: string; description: string; versionLabel: string; items: BundleItem[] }) => {
    setSavingBundle(true);
    try {
      if (editingBundle) {
        await updateBundle(editingBundle.id, payload);
        showToast(`Updated bundle ${payload.name}`);
      } else {
        await createBundle(payload);
        showToast(`Created bundle ${payload.name}`);
      }
      setShowEditor(false);
      setEditingBundle(null);
      await loadData();
    } catch (error) {
      console.error('Failed to save bundle:', error);
      showToast(error instanceof Error ? error.message : 'Failed to save bundle');
    } finally {
      setSavingBundle(false);
    }
  }, [editingBundle, loadData, showToast]);

  const handleDeleteBundle = useCallback(async () => {
    if (!selectedBundle) return;
    if (!window.confirm(`Delete bundle "${selectedBundle.name}"? This removes its saved versions and application history.`)) return;
    try {
      await deleteBundle(selectedBundle.id);
      showToast(`Deleted bundle ${selectedBundle.name}`);
      await loadData();
    } catch (error) {
      console.error('Failed to delete bundle:', error);
      showToast(error instanceof Error ? error.message : 'Failed to delete bundle');
    }
  }, [loadData, selectedBundle, showToast]);

  const handlePreview = useCallback(async () => {
    if (!selectedBundle || !target) return;
    setPreviewLoading(true);
    try {
      const res = await previewBundle(selectedBundle.id, target);
      setPreviewData(res.data);
    } catch (error) {
      console.error('Failed to preview bundle:', error);
      showToast(error instanceof Error ? error.message : 'Failed to preview bundle');
    } finally {
      setPreviewLoading(false);
    }
  }, [selectedBundle, showToast, target]);

  const handleApply = useCallback(async () => {
    if (!selectedBundle || !target) return;
    setApplying(true);
    try {
      const res = await applyBundle(selectedBundle.id, target);
      const payload = res.data;
      if (!payload.ok) {
        setPreviewData(payload);
        showToast(payload.error || 'Bundle apply completed with failures');
      } else {
        showToast(`Applied bundle ${selectedBundle.name}`);
        setPreviewData(null);
      }
      await loadData();
    } catch (error) {
      console.error('Failed to apply bundle:', error);
      showToast(error instanceof Error ? error.message : 'Failed to apply bundle');
    } finally {
      setApplying(false);
    }
  }, [loadData, selectedBundle, showToast, target]);

  const resetImportModal = useCallback(() => {
    setShowImportModal(false);
    setManifestImportFileName('');
    setManifestImportPayload(null);
    setManifestImportPreview(null);
  }, []);

  const closeImportModal = useCallback(() => {
    if (manifestPreviewLoading || manifestApplying) return;
    resetImportModal();
  }, [manifestApplying, manifestPreviewLoading, resetImportModal]);

  const handleExportManifest = useCallback(async () => {
    setExportingManifest(true);
    try {
      const res = await exportWorkspaceManifest(manifestExportSelection);
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      anchor.href = url;
      anchor.download = `hcp-workspace-manifest-${timestamp}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setShowExportModal(false);
      showToast('Workspace manifest downloaded');
    } catch (error) {
      console.error('Failed to export workspace manifest:', error);
      showToast(error instanceof Error ? error.message : 'Failed to export workspace manifest');
    } finally {
      setExportingManifest(false);
    }
  }, [manifestExportSelection, showToast]);

  const handleChooseManifestFile = useCallback(() => {
    manifestFileInputRef.current?.click();
  }, []);

  const handleManifestFileSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setShowImportModal(true);
    setManifestImportFileName(file.name);
    setManifestImportPayload(null);
    setManifestImportPreview(null);
    setManifestPreviewLoading(true);
    try {
      const raw = await file.text();
      const manifest = JSON.parse(raw) as WorkspaceManifest;
      const res = await previewImportManifest(manifest);
      setManifestImportPayload(manifest);
      setManifestImportPreview(res.data);
    } catch (error) {
      console.error('Failed to preview workspace manifest import:', error);
      showToast(error instanceof Error ? error.message : 'Failed to preview manifest import');
    } finally {
      setManifestPreviewLoading(false);
    }
  }, [showToast]);

  const handleApplyManifestImport = useCallback(async () => {
    if (!manifestImportPayload) return;
    setManifestApplying(true);
    try {
      const res = await applyImportManifest(
        manifestImportPayload,
        { confirmed: true, note: 'Confirmed workspace manifest import', source: 'web' }
      );
      showToast(`Imported workspace manifest (${res.data.result.writeCount} writes)`);
      resetImportModal();
      await loadData();
    } catch (error) {
      console.error('Failed to apply workspace manifest import:', error);
      showToast(error instanceof Error ? error.message : 'Failed to apply manifest import');
    } finally {
      setManifestApplying(false);
    }
  }, [loadData, manifestImportPayload, resetImportModal, showToast]);

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="flex w-[340px] shrink-0 flex-col border-r border-border">
        <div className="space-y-3 border-b border-border px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold text-text">Bundles</div>
              <div className="text-xs text-muted">Reusable harness stacks for providers, projects, servers, and running agents.</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void loadData()}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-accent-fg transition-colors hover:bg-[hsl(240,4%,13%)]"
              >
                Refresh
              </button>
              <button
                onClick={() => setShowExportModal(true)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-accent-fg transition-colors hover:bg-[hsl(240,4%,13%)]"
              >
                Export
              </button>
              <button
                onClick={() => setShowImportModal(true)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-accent-fg transition-colors hover:bg-[hsl(240,4%,13%)]"
              >
                Import
              </button>
              <button
                onClick={() => { setEditingBundle(null); setShowEditor(true); }}
                className="rounded-lg border border-accent/20 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/15"
              >
                Create
              </button>
            </div>
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search bundles…"
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {loading ? (
            <div className="rounded-xl border border-border bg-bg/40 px-4 py-5 text-sm text-muted">Loading bundles…</div>
          ) : filteredBundles.length === 0 ? (
            <div className="rounded-xl border border-border bg-bg/40 px-4 py-5 text-sm text-muted">No bundles found yet.</div>
          ) : (
            <div className="space-y-2">
              {filteredBundles.map((bundle) => {
                const selected = bundle.id === selectedBundleId;
                return (
                  <button
                    key={bundle.id}
                    onClick={() => setSelectedBundleId(bundle.id)}
                    className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                      selected ? 'border-accent bg-accent/10' : 'border-border bg-bg/40 hover:border-accent/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-text">{bundle.name}</div>
                        <div className="mt-1 line-clamp-2 text-xs text-muted">{bundle.description || 'No description'}</div>
                      </div>
                      {bundle.outdatedApplicationCount > 0 && (
                        <span className="rounded-md border border-orange/30 bg-orange/10 px-1.5 py-0.5 text-[10px] font-medium text-orange">
                          {bundle.outdatedApplicationCount} outdated
                        </span>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted">
                      <span>{bundle.itemCount} items</span>
                      <span>v{bundle.current_version}</span>
                      <span>{bundle.applicationCount} targets</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {!selectedBundle ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted">Select a bundle to inspect or apply it.</div>
        ) : (
          <>
            <div className="border-b border-border px-6 py-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <h2 className="truncate text-xl font-semibold text-text">{selectedBundle.name}</h2>
                    <span className="rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-muted">
                      v{selectedBundle.current_version}
                    </span>
                    {selectedBundle.outdatedApplicationCount > 0 && (
                      <span className="rounded-md border border-orange/30 bg-orange/10 px-2 py-0.5 text-[11px] font-medium text-orange">
                        {selectedBundle.outdatedApplicationCount} outdated targets
                      </span>
                    )}
                  </div>
                  <p className="mt-2 max-w-3xl text-sm text-muted">{selectedBundle.description || 'No description yet.'}</p>
                  <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted">
                    <span>{selectedBundle.itemCount} items</span>
                    <span>{selectedBundle.applicationCount} applications</span>
                    <span>Last applied: {formatTimestamp(selectedBundle.lastAppliedAt)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setEditingBundle(selectedBundle); setShowEditor(true); }}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-accent-fg transition-colors hover:bg-[hsl(240,4%,13%)]"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => void handleDeleteBundle()}
                    className="rounded-lg border border-red/30 bg-red/10 px-3 py-1.5 text-xs font-medium text-red transition-colors hover:bg-red/15"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 gap-0 xl:grid-cols-[minmax(0,1.2fr)_420px]">
              <div className="min-h-0 overflow-y-auto px-6 py-5">
                <div className="space-y-6">
                  <section>
                    <div className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted">Items</div>
                    <div className="space-y-2">
                      {selectedBundle.items.map((item) => (
                        <div key={bundleItemKey(item)} className="rounded-xl border border-border bg-bg/40 px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-text">{item.name}</span>
                            <span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted">
                              {TYPE_LABELS[item.type]}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-muted">
                            {(item.providers || []).map((provider) => PROVIDER_LABELS[provider as Provider] || provider).join(' · ') || 'No providers'}
                          </div>
                          {(item.projectPath || item.filePath) && (
                            <div className="mt-1 break-all font-mono text-[11px] text-muted">
                              {item.projectPath || item.filePath}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>

                  <section>
                    <div className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted">Versions</div>
                    <div className="space-y-2">
                      {selectedBundle.versions.map((version) => (
                        <div key={version.id} className="rounded-xl border border-border bg-bg/40 px-4 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-medium text-text">v{version.version}</div>
                            <div className="text-[11px] text-muted">{formatTimestamp(version.created_at)}</div>
                          </div>
                          <div className="mt-1 text-sm text-muted">{version.label || version.description || 'No version notes'}</div>
                          <div className="mt-2 text-[11px] text-muted">{version.itemCount} items</div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section>
                    <div className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted">Applications</div>
                    {selectedBundle.applications.length === 0 ? (
                      <div className="rounded-xl border border-border bg-bg/40 px-4 py-4 text-sm text-muted">
                        Bundle has not been applied anywhere yet.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {selectedBundle.applications.map((application) => (
                          <div key={application.id} className="rounded-xl border border-border bg-bg/40 px-4 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="font-medium text-text">{application.target_label}</div>
                              <div className="flex items-center gap-2">
                                {application.outdated && (
                                  <span className="rounded-md border border-orange/30 bg-orange/10 px-1.5 py-0.5 text-[10px] font-medium text-orange">
                                    outdated
                                  </span>
                                )}
                                <span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted">
                                  v{application.bundle_version}
                                </span>
                              </div>
                            </div>
                            <div className="mt-1 text-xs text-muted">
                              {application.target_kind.replace('_', ' ')} · {application.last_status || 'unknown'}
                            </div>
                            <div className="mt-1 text-sm text-muted">{application.last_summary || 'No summary'}</div>
                            <div className="mt-2 text-[11px] text-muted">{formatTimestamp(application.applied_at)}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              </div>

              <aside className="border-l border-border px-6 py-5">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Apply Bundle</div>
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium uppercase tracking-[0.18em] text-muted">Target</label>
                    <select
                      value={targetKind}
                      onChange={(event) => setTargetKind(event.target.value as TargetKind)}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
                    >
                      <option value="provider">Provider</option>
                      <option value="project">Project</option>
                      <option value="server">Remote Server</option>
                      <option value="running_agent">Running Agent</option>
                    </select>
                  </div>

                  {targetKind === 'provider' && (
                    <div>
                      <label className="mb-1 block text-xs font-medium uppercase tracking-[0.18em] text-muted">Provider</label>
                      <select
                        value={providerTarget}
                        onChange={(event) => setProviderTarget(event.target.value as Provider)}
                        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
                      >
                        {Object.entries(PROVIDER_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {targetKind === 'project' && (
                    <>
                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-[0.18em] text-muted">Project</label>
                        <select
                          value={projectTarget}
                          onChange={(event) => setProjectTarget(event.target.value)}
                          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
                        >
                          <option value="">Select project…</option>
                          {localProjects.map((project) => (
                            <option key={project.id} value={project.path}>{project.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-[0.18em] text-muted">Method</label>
                        <select
                          value={projectMethod}
                          onChange={(event) => setProjectMethod(event.target.value as 'copy' | 'symlink')}
                          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
                        >
                          <option value="symlink">Symlink</option>
                          <option value="copy">Copy</option>
                        </select>
                      </div>
                    </>
                  )}

                  {targetKind === 'server' && (
                    <div>
                      <label className="mb-1 block text-xs font-medium uppercase tracking-[0.18em] text-muted">Remote Server</label>
                      <select
                        value={serverTarget}
                        onChange={(event) => setServerTarget(event.target.value)}
                        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
                      >
                        <option value="">Select server…</option>
                        {remoteServers.map((server) => (
                          <option key={server.id} value={server.id}>{server.name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {targetKind === 'running_agent' && (
                    <>
                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-[0.18em] text-muted">Running Agent</label>
                        <select
                          value={runningAgentTarget}
                          onChange={(event) => setRunningAgentTarget(event.target.value)}
                          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
                        >
                          <option value="">Select agent…</option>
                          {eligibleAgents.map(({ agent, projectPath }) => (
                            <option key={agent.id} value={agent.id}>
                              {agent.name} · {projectPath}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-[0.18em] text-muted">Method</label>
                        <select
                          value={runningAgentMethod}
                          onChange={(event) => setRunningAgentMethod(event.target.value as 'copy' | 'symlink')}
                          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
                        >
                          <option value="symlink">Symlink</option>
                          <option value="copy">Copy</option>
                        </select>
                      </div>
                    </>
                  )}

                  {targetKind === 'running_agent' && eligibleAgents.length === 0 && (
                    <div className="rounded-lg border border-border bg-bg/40 px-3 py-3 text-sm text-muted">
                      No running agents are currently resolvable to a single local project. Run introspection on an agent first.
                    </div>
                  )}

                  {targetReadOnly && (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-300">
                      {targetReadOnlyReason}
                    </div>
                  )}

                  {targetKind === 'running_agent' && selectedAgent && (
                    <div className="rounded-lg border border-border bg-bg/40 px-3 py-3 text-sm text-muted">
                      Bundle will resolve through {selectedAgent.agent.name} to {selectedAgent.projectPath}.
                    </div>
                  )}

                  <button
                    onClick={() => void handlePreview()}
                    disabled={!selectedBundle || !target || previewLoading}
                    className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg transition-colors hover:bg-accent/90 disabled:opacity-40"
                  >
                    {previewLoading ? 'Preparing Preview…' : 'Preview Apply'}
                  </button>
                </div>
              </aside>
            </div>
          </>
        )}
      </section>

      {showEditor && (
        <BundleEditorModal
          bundle={editingBundle}
          sourceItems={sourceItems}
          saving={savingBundle}
          onClose={() => {
            if (savingBundle) return;
            setShowEditor(false);
            setEditingBundle(null);
          }}
          onSave={handleSaveBundle}
        />
      )}

      <input
        ref={manifestFileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(event) => void handleManifestFileSelected(event)}
      />

      {showExportModal && (
        <ManifestExportModal
          selection={manifestExportSelection}
          exporting={exportingManifest}
          onSelectionChange={setManifestExportSelection}
          onClose={() => {
            if (exportingManifest) return;
            setShowExportModal(false);
          }}
          onExport={() => void handleExportManifest()}
        />
      )}

      {showImportModal && (
        <ManifestImportModal
          fileName={manifestImportFileName}
          preview={manifestImportPreview}
          loading={manifestPreviewLoading}
          applying={manifestApplying}
          readOnly={auditMode?.global_read_only === true}
          readOnlyReason={auditMode?.global_read_only ? 'Global read-only audit mode is enabled.' : undefined}
          onChooseFile={handleChooseManifestFile}
          onApply={() => void handleApplyManifestImport()}
          onClose={closeImportModal}
        />
      )}

      {(previewData || previewLoading) && (
        <BatchSyncPlanModal
          title={selectedBundle ? `Apply Bundle · ${selectedBundle.name}` : 'Apply Bundle'}
          preview={previewData?.preview || null}
          loading={previewLoading}
          applying={applying}
          onApply={() => void handleApply()}
          onClose={() => {
            if (applying) return;
            setPreviewData(null);
          }}
          readOnly={targetReadOnly}
          readOnlyReason={targetReadOnlyReason}
        />
      )}

      {toast && (
        <div className="animate-slide-up fixed bottom-6 left-1/2 z-[300] rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-5 py-2.5 text-emerald-400 text-[13px] shadow-[0_8px_32px_rgba(0,0,0,.5)] backdrop-blur-sm">
          {toast}
        </div>
      )}
    </div>
  );
}
