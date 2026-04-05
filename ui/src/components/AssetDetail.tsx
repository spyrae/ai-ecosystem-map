import { useEffect, useState } from 'react';
import type { Asset, McpTool } from '../types';
import { fetchAssetContent, updateAssetContent, deleteAsset, fetchMcpConfig, listMcpTools } from '../lib/api';
import { ProviderBadge } from './ProviderBadge';

const TYPE_STYLES: Record<string, string> = {
  skill: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  agent: 'bg-violet-500/15 text-violet-400 border-violet-500/20',
  mcp: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  instruction: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20',
  rule: 'bg-teal-500/15 text-teal-400 border-teal-500/20',
};

interface AssetDetailProps {
  asset: Asset;
  onClose: () => void;
  onDeleted: () => void;
  onConnect: (asset: Asset) => void;
}

export function AssetDetail({ asset, onClose, onDeleted, onConnect }: AssetDetailProps) {
  const [content, setContent] = useState<string | null>(null);
  const [filePath, setFilePath] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mcpConfig, setMcpConfig] = useState<Record<string, unknown> | null>(null);
  const [mcpTools, setMcpTools] = useState<McpTool[]>([]);
  const [loadingTools, setLoadingTools] = useState(false);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [toolsLoaded, setToolsLoaded] = useState(false);

  useEffect(() => {
    setLoading(true);
    setEditing(false);
    setConfirmDelete(false);
    setMcpConfig(null);
    setMcpTools([]);
    setToolsLoaded(false);
    setToolsError(null);

    if (asset.type === 'mcp') {
      fetchMcpConfig(asset.name)
        .then((res) => {
          setMcpConfig(res.config);
          setFilePath(res.source);
          setContent(JSON.stringify(res.config, null, 2));
          setEditContent(JSON.stringify(res.config, null, 2));
        })
        .catch(() => setContent(null))
        .finally(() => setLoading(false));
    } else {
      fetchAssetContent(asset.name)
        .then((res) => {
          setContent(res.content);
          setFilePath(res.filePath);
          setEditContent(res.content);
        })
        .catch(() => setContent(null))
        .finally(() => setLoading(false));
    }
  }, [asset.name, asset.type]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await updateAssetContent(asset.name, editContent);
      if (res.ok) { setContent(editContent); setEditing(false); showToast('Saved'); }
      else showToast('Error: ' + (res.error || 'Save failed'));
    } catch { showToast('Save failed'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    try {
      const res = await deleteAsset(asset.name, asset.type);
      if (res.ok) { onDeleted(); onClose(); }
      else showToast('Error: ' + (res.error || 'Delete failed'));
    } catch { showToast('Delete failed'); }
  };

  const handleListTools = async () => {
    setLoadingTools(true);
    setToolsError(null);
    try {
      const res = await listMcpTools(asset.name);
      if (res.ok && res.tools) { setMcpTools(res.tools); setToolsLoaded(true); }
      else setToolsError(res.error || 'Failed');
    } catch (err) { setToolsError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoadingTools(false); }
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

          {/* Action buttons */}
          <div className="mt-4 flex gap-2">
            {!editing ? (
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-[hsl(240,4%,13%)] transition-colors"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>
                Edit
              </button>
            ) : (
              <>
                <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/15 transition-colors disabled:opacity-40">
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button onClick={() => { setEditing(false); setEditContent(content || ''); }} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-[hsl(240,4%,13%)] transition-colors">
                  Cancel
                </button>
              </>
            )}
            <button
              onClick={() => onConnect(asset)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-[hsl(240,4%,13%)] transition-colors"
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" /></svg>
              Connect
            </button>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-[hsl(240,4%,13%)] hover:text-red transition-colors"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                Delete
              </button>
            ) : (
              <button onClick={handleDelete} className="flex items-center gap-1.5 rounded-lg border border-red/30 bg-red/10 px-3 py-1.5 text-xs font-medium text-red hover:bg-red/15 transition-colors">
                Confirm Delete
              </button>
            )}
            {asset.type === 'mcp' && (
              <button
                onClick={handleListTools}
                disabled={loadingTools}
                className="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/15 transition-colors disabled:opacity-40"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" /></svg>
                {loadingTools ? 'Connecting...' : toolsLoaded ? 'Refresh Tools' : 'Test & List Tools'}
              </button>
            )}
          </div>

          {/* Tools error */}
          {toolsError && <div className="mt-3 text-xs text-red">{toolsError}</div>}

          {/* MCP Tools list */}
          {mcpTools.length > 0 && (
            <div className="mt-4 space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-2">{mcpTools.length} tools available</div>
              {mcpTools.map((tool) => (
                <div key={tool.name} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[hsl(240,4%,13%)] text-xs">
                  <span className="font-mono text-emerald-400 font-medium shrink-0">{tool.name}</span>
                  <span className="text-accent-fg">{tool.description}</span>
                </div>
              ))}
            </div>
          )}

          {/* Description */}
          <div className="mt-4">
            <p className="text-sm leading-relaxed text-accent-fg">{asset.desc}</p>
          </div>

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
