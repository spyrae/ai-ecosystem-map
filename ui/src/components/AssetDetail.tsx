import { useEffect, useState } from 'react';
import {
  CAPABILITY_STATE_LABELS,
  assetCanDelete,
  assetCanEdit,
  capabilitySummaryItems,
  type Asset,
  type DriftGroup,
  type McpRuntimeCheck,
  type RemediationSuggestion,
  type TopologyGraph,
} from '../types';
import { connectAsset, fetchAssetContent, fetchAssetRemediations, updateAssetContent, deleteAsset, fetchMcpConfig } from '../lib/api';
import { ProviderBadge } from './ProviderBadge';

const TYPE_STYLES: Record<string, string> = {
  skill: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  agent: 'bg-violet-500/15 text-violet-400 border-violet-500/20',
  mcp: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  instruction: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20',
  rule: 'bg-teal-500/15 text-teal-400 border-teal-500/20',
};

const CAPABILITY_STYLES: Record<string, string> = {
  active: 'border-blue/30 bg-blue/10 text-blue-300',
  configured: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  available: 'border-border bg-[hsl(240,4%,13%)] text-accent-fg',
  missing: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  unsupported: 'border-border bg-[hsl(240,4%,13%)] text-muted',
  invalid: 'border-red/30 bg-red/10 text-red',
};


interface AssetDetailProps {
  asset: Asset;
  topology?: TopologyGraph | null;
  driftGroup?: DriftGroup | null;
  onClose: () => void;
  onDeleted: () => void;
  onConnect: (asset: Asset) => void;
  onUpdated?: () => void | Promise<void>;
  onMakeSourceOfTruth?: (groupKey: string, assetId: string) => void | Promise<void>;
  onOpenProject?: (projectId: string) => void;
  onOpenServer?: (serverId: string) => void;
  readOnly?: boolean;
}

export function AssetDetail({
  asset,
  topology: _topology,
  driftGroup: _driftGroup,
  onClose,
  onDeleted,
  onConnect: _onConnect,
  onUpdated,
  onMakeSourceOfTruth: _onMakeSourceOfTruth,
  onOpenProject: _onOpenProject,
  onOpenServer: _onOpenServer,
  readOnly = false,
}: AssetDetailProps) {
  /* Reserved for future use
  const buildApproval = (note?: string | null) => ({
    confirmed: true,
    note: note ?? null,
    source: 'web',
  });
  */
  const [content, setContent] = useState<string | null>(null);
  const [filePath, setFilePath] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mcpConfig, setMcpConfig] = useState<Record<string, unknown> | null>(null);
  const [_mcpRuntime, setMcpRuntime] = useState<McpRuntimeCheck | null>(asset.runtime ?? null);
  const [_loadingRuntime, _setLoadingRuntime] = useState(false);
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const [_runtimeError, setRuntimeError] = useState<string | null>(null);
  const [_remediations, setRemediations] = useState<RemediationSuggestion[]>([]);
  const [_loadingRemediations, setLoadingRemediations] = useState(false);
  const [_applyingRemediationId, _setApplyingRemediationId] = useState<string | null>(null);
  const canEdit = assetCanEdit(asset);
  const canDelete = assetCanDelete(asset);
  const readOnlyMessage = 'Global read-only audit mode is enabled.';
  const capabilityItems = capabilitySummaryItems(asset.capabilities);
  const dependency = asset.dependency;

  useEffect(() => {
    setLoading(true);
    setEditing(false);
    setConfirmDelete(false);
    setMcpConfig(null);
    setMcpRuntime(asset.runtime ?? null);
    setRuntimeError(null);

    if (asset.type === 'mcp' && canEdit) {
      fetchMcpConfig(asset.id)
        .then((res) => {
          setMcpConfig(res.config);
          setFilePath(res.source);
          setContent(JSON.stringify(res.config, null, 2));
          setEditContent(JSON.stringify(res.config, null, 2));
        })
        .catch(() => setContent(null))
        .finally(() => setLoading(false));
    } else if (canEdit) {
      fetchAssetContent(asset.id, asset.type)
        .then((res) => {
          setContent(res.content);
          setFilePath(res.filePath);
          setEditContent(res.content);
        })
        .catch(() => setContent(null))
        .finally(() => setLoading(false));
    } else {
      setContent(null);
      setEditContent('');
      setLoading(false);
    }
  }, [asset.id, asset.type, canEdit, asset.runtime]);

  useEffect(() => {
    setLoadingRemediations(true);
    fetchAssetRemediations(asset.id, asset.type)
      .then((res) => setRemediations(res.data || []))
      .catch(() => setRemediations([]))
      .finally(() => setLoadingRemediations(false));
  }, [asset.id, asset.type, asset.health?.summary, asset.runtime?.checkedAt, asset.drift?.groupKey, asset.drift?.status]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await updateAssetContent(asset.id, editContent, asset.type);
      if (res.ok) { setContent(editContent); setEditing(false); showToast('Saved'); }
      else showToast('Error: ' + (res.error || 'Save failed'));
    } catch { showToast('Save failed'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    try {
      const res = await deleteAsset(asset.id, asset.type);
      if (res.ok) { onDeleted(); onClose(); }
      else showToast('Error: ' + (res.error || 'Delete failed'));
    } catch { showToast('Delete failed'); }
  };

  const typeStyle = TYPE_STYLES[asset.type] || TYPE_STYLES.skill;

  return (
    <>
      <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
        <div
          className="relative z-10 w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border border-border p-6"
          onClick={(e) => e.stopPropagation()}
          style={{
            backgroundColor: 'hsl(240 5% 7.5%)',
            boxShadow: 'inset 0 1px 0 0 hsl(0 0% 100% / 0.03)',
          }}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute right-4 top-4 rounded-lg border border-border p-1.5 hover:bg-[hsl(240,4%,13%)] transition-colors"
          >
            <svg className="h-4 w-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Name + type badge */}
          <div className="flex items-center gap-3">
            <h2 className="font-mono text-lg font-semibold text-accent">/{asset.name}</h2>
            <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${typeStyle}`}>
              {asset.type}
            </span>
          </div>

          {/* File path */}
          {filePath && (
            <p className="mt-2 font-mono text-xs text-muted">{filePath}</p>
          )}

          {readOnly && (
            <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              {readOnlyMessage}
            </div>
          )}

          {/* Action buttons */}
          <div className="mt-4 flex gap-2">
            {!editing ? (
              <button
                disabled={readOnly || !canEdit}
                onClick={() => setEditing(true)}
                title={readOnly ? readOnlyMessage : canEdit ? 'Edit asset content' : 'Editing is unavailable for this asset in its current state'}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-[hsl(240,4%,13%)] transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>
                Edit
              </button>
            ) : (
              <>
                <button onClick={handleSave} disabled={readOnly || saving} className="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/15 transition-colors disabled:opacity-40">
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button onClick={() => { setEditing(false); setEditContent(content || ''); }} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-[hsl(240,4%,13%)] transition-colors">
                  Cancel
                </button>
              </>
            )}
            {/* Connect button moved to Capability Matrix inline */}
            {!confirmDelete ? (
              <button
                disabled={readOnly || !canDelete}
                onClick={() => setConfirmDelete(true)}
                title={readOnly ? readOnlyMessage : canDelete ? 'Delete asset' : 'Delete is unavailable because the backing config or file is already missing'}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-[hsl(240,4%,13%)] hover:text-red transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-current"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                Delete
              </button>
            ) : (
              <div className="flex flex-col gap-2">
                {dependency && dependency.consumerCount > 0 && (
                  <div className="max-w-md rounded-lg border border-red/30 bg-red/10 px-3 py-2 text-xs text-red">
                    <div className="font-medium uppercase tracking-wide">Downstream Impact</div>
                    <div className="mt-1">{dependency.summary}</div>
                  </div>
                )}
                <button onClick={handleDelete} className="flex items-center gap-1.5 rounded-lg border border-red/30 bg-red/10 px-3 py-1.5 text-xs font-medium text-red hover:bg-red/15 transition-colors">
                  Confirm Delete
                </button>
              </div>
            )}
            {/* Run Check button — hidden for now */}
          </div>

          {/* Description */}
          <div className="mt-4">
            <p className="text-sm leading-relaxed text-accent-fg">{asset.desc}</p>
          </div>

          {asset.capabilities && (
            <div className="mt-4 rounded-lg border border-border bg-[hsl(240,4%,13%)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                  Capability Matrix
                </div>
                {capabilityItems.length > 0 && (
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {capabilityItems.map((item) => (
                      <span key={item} className="rounded-full bg-[hsl(240,5%,16%)] px-2 py-0.5 text-[10px] text-accent-fg">
                        {item}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-3 space-y-2">
                {asset.capabilities.providers.filter((p) => p.state !== 'unsupported').map((provider) => {
                  const isSource = provider.state === 'active';
                  const isConnected = isSource || provider.state === 'configured';
                  const canAdd = !isConnected && !readOnly && (provider.state === 'available' || provider.state === 'missing');
                  const isConnecting = connectingProvider === provider.provider;
                  const statusLabel = isSource ? 'Connected' : CAPABILITY_STATE_LABELS[provider.state];
                  const statusStyle = isSource ? CAPABILITY_STYLES.configured : (CAPABILITY_STYLES[provider.state] || CAPABILITY_STYLES.available);

                  const handleConnect = async () => {
                    setConnectingProvider(provider.provider);
                    try {
                      await connectAsset(asset.id, provider.provider, asset.type);
                      showToast(`Connected to ${provider.label}`);
                      await onUpdated?.();
                    } catch {
                      showToast('Connection failed');
                    } finally {
                      setConnectingProvider(null);
                    }
                  };

                  return (
                    <div key={provider.provider} className="rounded-lg border border-border bg-[hsl(240,5%,10%)] px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-accent-fg">{provider.label}</span>
                            {isSource && (
                              <span className="inline-flex rounded-full border border-blue/30 bg-blue/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-blue-300">
                                Source
                              </span>
                            )}
                          </div>
                          {provider.targetPath && (
                            <div className="mt-1 font-mono text-[11px] text-muted truncate">{provider.targetPath}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${statusStyle}`}>
                            {statusLabel}
                          </span>
                          {canAdd && (
                            <button
                              onClick={() => void handleConnect()}
                              disabled={isConnecting}
                              className="flex h-6 w-6 items-center justify-center rounded-full border border-border hover:bg-emerald-500/10 hover:border-emerald-500/30 hover:text-emerald-400 transition-colors disabled:opacity-40"
                              title={`Connect to ${provider.label}`}
                            >
                              {isConnecting ? (
                                <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 12a8 8 0 018-8" /></svg>
                              ) : (
                                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Drift Map — hidden for now */}
          {/* Suggested Fixes — hidden for now */}

          {/* Dependency Graph — hidden for now */}

          {/* Topology — hidden for now */}
          {/* Health — hidden for now */}
          {/* Runtime Check — hidden for now */}

          {/* Content */}
          <div className="mt-4">
            {loading ? (
              <div className="text-muted text-center py-4">Loading...</div>
            ) : editing ? (
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full min-h-[300px] rounded-lg border border-border bg-[hsl(240,4%,13%)] p-4 font-mono text-xs leading-relaxed text-accent-fg resize-none focus:outline-none focus:border-accent/40"
                spellCheck={false}
              />
            ) : content ? (
              <div className="rounded-lg border border-border bg-[hsl(240,4%,13%)] p-4">
                <pre className="font-mono text-xs leading-relaxed text-accent-fg whitespace-pre-wrap">{content}</pre>
              </div>
            ) : !canEdit ? (
              <div className="text-muted text-center py-4 text-sm">Content is unavailable until the blocking asset issues are fixed.</div>
            ) : asset.type !== 'mcp' ? (
              <div className="text-muted text-center py-4 text-sm">No file content available</div>
            ) : mcpConfig ? (
              <div className="rounded-lg border border-border bg-[hsl(240,4%,13%)] p-4">
                <pre className="font-mono text-xs leading-relaxed text-accent-fg whitespace-pre-wrap">{JSON.stringify(mcpConfig, null, 2)}</pre>
              </div>
            ) : null}
          </div>

          {/* Providers */}
          <div className="mt-4 flex flex-wrap gap-1.5">
            {asset.providers.map((p) => (
              <ProviderBadge key={p} provider={p} size="md" />
            ))}
          </div>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-5 py-2.5 text-emerald-400 text-[13px] shadow-[0_8px_32px_rgba(0,0,0,.5)]">
          {toast}
        </div>
      )}
    </>
  );
}
