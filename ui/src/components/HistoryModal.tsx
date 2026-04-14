import type { HistoryDetails, HistoryEntry } from '../types';

type Props = {
  entries: HistoryEntry[];
  loading: boolean;
  busyId: number | 'latest' | null;
  onClose: () => void;
  onUndoLatest: () => void;
  onRollback: (historyId: number) => void;
  readOnly?: boolean;
};

function formatTimestamp(value: number) {
  const ms = value > 1_000_000_000_000 ? value : value * 1000;
  return new Date(ms).toLocaleString();
}

function formatActor(details?: HistoryDetails | null) {
  const actor = details?.actor;
  if (!actor) return null;
  const parts = [actor.user, actor.host].filter(Boolean);
  const base = parts.length > 0 ? parts.join(' @ ') : actor.kind;
  return actor.client ? `${base} via ${actor.client}` : base;
}

function formatEffect(details?: HistoryDetails | null) {
  const effect = details?.effect;
  if (!effect) return null;
  const parts = [
    typeof effect.applied === 'number' ? `${effect.applied} applied` : null,
    typeof effect.skipped === 'number' ? `${effect.skipped} skipped` : null,
    typeof effect.restored === 'number' ? `${effect.restored} restored` : null,
    typeof effect.operationCount === 'number' ? `${effect.operationCount} operations` : null,
    typeof effect.total === 'number' ? `${effect.total} total` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function HistoryModal({ entries, loading, busyId, onClose, onUndoLatest, onRollback, readOnly = false }: Props) {
  const undoableCount = entries.filter((entry) => entry.can_rollback).length;

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/55 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-[760px] max-w-[92vw] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_24px_80px_rgba(0,0,0,.55)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-text">History & Rollback</h2>
            <p className="mt-1 text-xs text-muted">Recent write operations with reversible snapshots.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onUndoLatest}
              disabled={readOnly || busyId !== null || undoableCount === 0}
              className="rounded-lg border border-accent/20 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/15 transition-colors disabled:opacity-40"
            >
              {busyId === 'latest' ? 'Undoing…' : 'Undo Last'}
            </button>
            <button
              onClick={onClose}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-[hsl(240,4%,13%)] transition-colors"
            >
              Close
            </button>
          </div>
        </div>

        {readOnly && (
          <div className="border-b border-border bg-amber-500/10 px-5 py-3 text-xs text-amber-300">
            Global read-only audit mode is enabled. Undo and rollback are disabled.
          </div>
        )}

        <div className="overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="py-12 text-center text-sm text-muted">Loading history…</div>
          ) : entries.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted">No write history yet.</div>
          ) : (
            <div className="space-y-3">
              {entries.map((entry) => (
                <div key={entry.id} className="rounded-xl border border-border bg-bg/40 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-text">{entry.action}</span>
                        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                          #{entry.id}
                        </span>
                        {entry.rolled_back_at ? (
                          <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-400">
                            Rolled back
                          </span>
                        ) : entry.can_rollback ? (
                          <span className="rounded-full border border-accent/25 bg-accent/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-accent">
                            Undo available
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-sm text-text">{entry.details_json?.summary || entry.asset_name}</div>
                      <div className="mt-1 text-[11px] text-muted">{formatTimestamp(entry.created_at)}</div>
                      {(entry.details_json?.target?.label || formatActor(entry.details_json) || formatEffect(entry.details_json)) && (
                        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                          {entry.details_json?.target?.label && (
                            <span className="rounded-full border border-border px-2 py-1 text-muted">
                              Target: {entry.details_json.target.label}
                            </span>
                          )}
                          {formatActor(entry.details_json) && (
                            <span className="rounded-full border border-border px-2 py-1 text-muted">
                              {formatActor(entry.details_json)}
                            </span>
                          )}
                          {formatEffect(entry.details_json) && (
                            <span className="rounded-full border border-border px-2 py-1 text-muted">
                              {formatEffect(entry.details_json)}
                            </span>
                          )}
                        </div>
                      )}
                      {entry.details_json?.approval && (
                        <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                          entry.details_json.approval.confirmed
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                            : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                        }`}>
                          <div className="font-medium">
                            {entry.details_json.approval.confirmed ? 'Approval recorded' : 'Approval required'}
                          </div>
                          {entry.details_json.approval.reason && (
                            <div className="mt-1">{entry.details_json.approval.reason}</div>
                          )}
                          {entry.details_json.approval.note && (
                            <div className="mt-1 text-[11px] text-muted">Note: {entry.details_json.approval.note}</div>
                          )}
                        </div>
                      )}
                      {(entry.details_json?.metadata || (!entry.details_json && entry.details)) && (
                        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg border border-border bg-surface px-3 py-2 text-[11px] text-muted">
                          {entry.details_json?.metadata
                            ? JSON.stringify(entry.details_json.metadata, null, 2)
                            : entry.details}
                        </pre>
                      )}
                    </div>
                    <button
                      onClick={() => onRollback(entry.id)}
                      disabled={readOnly || busyId !== null || !entry.can_rollback}
                      className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-[hsl(240,4%,13%)] transition-colors disabled:opacity-40"
                    >
                      {busyId === entry.id ? 'Rolling back…' : 'Rollback'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
