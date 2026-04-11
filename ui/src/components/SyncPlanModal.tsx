import type { SyncPlan } from '../types';

function issueTone(level: 'warning' | 'blocking') {
  return level === 'blocking'
    ? 'border-red/40 bg-red/10 text-red'
    : 'border-orange/40 bg-orange/10 text-orange';
}

function actionTone(action: 'create' | 'update' | 'noop') {
  if (action === 'create') return 'text-green';
  if (action === 'update') return 'text-orange';
  return 'text-muted';
}

export function SyncPlanModal({
  plan,
  applying,
  title,
  onApply,
  onClose,
}: {
  plan: SyncPlan | null;
  applying: boolean;
  title: string;
  onApply: () => void;
  onClose: () => void;
}) {
  if (!plan) {
    return (
      <div className="fixed inset-0 z-[250] bg-black/55 backdrop-blur-[2px] flex items-center justify-center p-4">
        <div className="w-full max-w-xl bg-surface border border-border rounded-2xl shadow-[0_16px_60px_rgba(0,0,0,.45)] overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-base font-semibold text-text">{title}</div>
                <div className="text-xs text-muted mt-1">Preparing preview plan…</div>
              </div>
            </div>
          </div>
          <div className="p-5 text-sm text-muted">Collecting source/target state and computing operations.</div>
        </div>
      </div>
    );
  }

  const blockingIssues = plan.issues.filter((entry) => entry.level === 'blocking');

  return (
    <div className="fixed inset-0 z-[250] bg-black/55 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-surface border border-border rounded-2xl shadow-[0_16px_60px_rgba(0,0,0,.45)] overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-base font-semibold text-text">{title}</div>
              <div className="text-xs text-muted mt-1">
                {plan.source?.name} ({plan.source?.type}) → {plan.target?.label}
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-muted hover:text-text transition-colors"
              aria-label="Close sync preview"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {plan.issues.length > 0 && (
            <div className="space-y-2">
              {plan.issues.map((entry) => (
                <div key={`${entry.level}-${entry.code}`} className={`rounded-lg border px-3 py-2 text-sm ${issueTone(entry.level)}`}>
                  <div className="font-medium">{entry.level === 'blocking' ? 'Blocking' : 'Warning'}</div>
                  <div className="mt-0.5">{entry.message}</div>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-xl border border-border bg-bg/40">
            <div className="px-4 py-3 border-b border-border text-xs uppercase tracking-[0.18em] text-muted">
              Operations
            </div>
            <div className="divide-y divide-border">
              {plan.operations.length === 0 ? (
                <div className="px-4 py-4 text-sm text-muted">No operations generated.</div>
              ) : (
                plan.operations.map((op) => (
                  <div key={op.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm text-text">{op.summary}</div>
                      <div className={`text-xs font-medium uppercase tracking-wide ${actionTone(op.action)}`}>{op.action}</div>
                    </div>
                    {op.targetPath && (
                      <div className="mt-1 text-[11px] font-mono text-muted break-all">{op.targetPath}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-border flex items-center justify-between gap-3">
          <div className="text-xs text-muted">
            {plan.hasChanges ? 'Changes will be applied through the unified sync engine.' : 'Target is already up to date.'}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-muted hover:text-text transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onApply}
              disabled={applying || !plan.canApply || !plan.hasChanges || blockingIssues.length > 0}
              className="px-4 py-2 text-sm font-medium bg-accent text-bg rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-40"
            >
              {applying ? 'Applying...' : 'Apply Sync'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
