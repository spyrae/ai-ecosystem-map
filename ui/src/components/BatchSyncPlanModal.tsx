import type { BatchSyncPreview } from '../types';

function issueTone(level: 'warning' | 'blocking') {
  return level === 'blocking'
    ? 'border-red/40 bg-red/10 text-red'
    : 'border-orange/40 bg-orange/10 text-orange';
}

export function BatchSyncPlanModal({
  preview,
  applying,
  loading,
  title,
  onApply,
  onClose,
  readOnly = false,
  readOnlyReason,
}: {
  preview: BatchSyncPreview | null;
  applying: boolean;
  loading: boolean;
  title: string;
  onApply: () => void;
  onClose: () => void;
  readOnly?: boolean;
  readOnlyReason?: string;
}) {
  if (loading || !preview) {
    return (
      <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
        <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_16px_60px_rgba(0,0,0,.45)]">
          <div className="border-b border-border px-5 py-4">
            <div className="text-base font-semibold text-text">{title}</div>
            <div className="mt-1 text-xs text-muted">Preparing batch sync preview…</div>
          </div>
          <div className="p-5 text-sm text-muted">Collecting source and target state for the selected assets.</div>
        </div>
      </div>
    );
  }

  const blockingCount = preview.results.reduce((count, entry) => {
    const planBlocking = entry.plan?.issues.some((issue) => issue.level === 'blocking') ? 1 : 0;
    return count + (!entry.ok ? 1 : 0) + planBlocking;
  }, 0);

  const canApply = preview.readyCount > 0 && preview.hasChangesCount > 0 && blockingCount === 0;

  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
      <div className="flex max-h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_16px_60px_rgba(0,0,0,.45)]">
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-base font-semibold text-text">{title}</div>
              <div className="mt-1 text-xs text-muted">
                {preview.total} assets · {preview.readyCount} ready · {preview.blockedCount} blocked · {preview.operationCount} operations
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-muted transition-colors hover:text-text"
              aria-label="Close batch sync preview"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <SummaryPill label="Ready" value={preview.readyCount} tone="text-green" />
            <SummaryPill label="Blocked" value={preview.blockedCount} tone="text-red" />
            <SummaryPill label="With Changes" value={preview.hasChangesCount} tone="text-accent" />
            <SummaryPill label="Operations" value={preview.operationCount} tone="text-orange" />
          </div>

          {readOnly && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
              {readOnlyReason || 'Read-only audit mode is enabled. Applying batch sync is disabled.'}
            </div>
          )}

          <div className="space-y-3">
            {preview.results.map((entry) => (
              <div key={entry.id} className="rounded-xl border border-border bg-bg/40">
                <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-text">{entry.name}</div>
                    <div className="mt-0.5 text-[11px] text-muted">
                      {entry.ok
                        ? `${entry.plan?.operations.length ?? 0} operations · ${entry.plan?.issues.length ?? 0} issues`
                        : 'Preview failed'}
                    </div>
                  </div>
                  <div className={`text-xs font-medium uppercase tracking-wide ${entry.ok ? 'text-accent' : 'text-red'}`}>
                    {entry.ok ? (entry.plan?.hasChanges ? 'changes' : 'up to date') : 'error'}
                  </div>
                </div>

                <div className="space-y-3 px-4 py-3">
                  {!entry.ok && entry.error && (
                    <div className="rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
                      {entry.error}
                    </div>
                  )}

                  {entry.plan?.target?.git && (
                    <div className={`rounded-lg border px-3 py-2 text-sm ${
                      entry.plan.target.git.conflictedCount > 0
                        ? 'border-red/40 bg-red/10 text-red'
                        : entry.plan.target.git.dirty
                          ? 'border-orange/40 bg-orange/10 text-orange'
                          : 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                    }`}>
                      <div className="font-medium">Git Target</div>
                      <div className="mt-0.5">{entry.plan.target.git.summary}</div>
                    </div>
                  )}

                  {entry.plan?.issues.length ? (
                    <div className="space-y-2">
                      {entry.plan.issues.map((issue) => (
                        <div key={`${entry.id}-${issue.level}-${issue.code}`} className={`rounded-lg border px-3 py-2 text-sm ${issueTone(issue.level)}`}>
                          <div className="font-medium">{issue.level === 'blocking' ? 'Blocking' : 'Warning'}</div>
                          <div className="mt-0.5">{issue.message}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {entry.plan?.operations.length ? (
                    <div className="space-y-2">
                      {entry.plan.operations.map((operation) => (
                        <div key={operation.id} className="rounded-lg border border-border bg-surface px-3 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm text-text">{operation.summary}</div>
                            <div className="text-[11px] uppercase tracking-wide text-muted">{operation.action}</div>
                          </div>
                          {operation.targetPath && (
                            <div className="mt-1 break-all font-mono text-[11px] text-muted">{operation.targetPath}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    entry.ok && (
                      <div className="text-sm text-muted">No operations generated for this asset.</div>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
          <div className="text-xs text-muted">
            {canApply
              ? 'Batch sync will be applied through the unified sync engine.'
              : 'Resolve blocking issues or select assets with pending changes before applying.'}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-muted transition-colors hover:text-text"
            >
              Cancel
            </button>
            <button
              onClick={onApply}
              disabled={readOnly || applying || !canApply}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg transition-colors hover:bg-accent/90 disabled:opacity-40"
            >
              {applying ? 'Applying...' : 'Apply Batch Sync'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryPill({
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
