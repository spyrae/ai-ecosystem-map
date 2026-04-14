import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Policy, PolicyEvaluation, PolicyRule, PolicySelectors } from '../types';
import { createPolicy, deletePolicy, fetchPolicies, fetchPolicyEvaluation, updatePolicy } from '../lib/api';

const EMPTY_SELECTORS: PolicySelectors = {};
const DEFAULT_RULES: PolicyRule[] = [
  {
    mode: 'required',
    assetType: 'instruction',
    scope: 'project',
    namePattern: 'CLAUDE*',
    note: 'Project-level instruction must exist',
  },
];

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function formatTimestamp(value?: number) {
  if (!value) return 'Never';
  const timestamp = value > 1_000_000_000_000 ? value : value * 1000;
  return new Date(timestamp).toLocaleString();
}

function collectImpactedSubjects(evaluation: PolicyEvaluation | null, policyId: string) {
  if (!evaluation) return [];
  return [...evaluation.projects, ...evaluation.environments]
    .filter((subject) => subject.matchedPolicyIds.includes(policyId) && subject.violationCount > 0)
    .sort((a, b) => {
      if (a.blockingCount !== b.blockingCount) return b.blockingCount - a.blockingCount;
      return b.warningCount - a.warningCount;
    });
}

function PolicyEditorModal({
  policy,
  saving,
  onClose,
  onSave,
}: {
  policy: Policy | null;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: {
    name: string;
    description: string;
    enabled: boolean;
    severity: Policy['severity'];
    selectors: PolicySelectors;
    rules: PolicyRule[];
  }) => Promise<void>;
}) {
  const [name, setName] = useState(policy?.name || '');
  const [description, setDescription] = useState(policy?.description || '');
  const [enabled, setEnabled] = useState(policy?.enabled ?? true);
  const [severity, setSeverity] = useState<Policy['severity']>(policy?.severity || 'warning');
  const [selectorsText, setSelectorsText] = useState(prettyJson(policy?.selectors || EMPTY_SELECTORS));
  const [rulesText, setRulesText] = useState(prettyJson(policy?.rules || DEFAULT_RULES));
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    try {
      const selectors = JSON.parse(selectorsText) as PolicySelectors;
      const rules = JSON.parse(rulesText) as PolicyRule[];
      setError(null);
      await onSave({
        name: name.trim(),
        description: description.trim(),
        enabled,
        severity,
        selectors,
        rules,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  return (
    <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_16px_60px_rgba(0,0,0,.45)]">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <div className="text-base font-semibold text-text">{policy ? 'Edit Policy' : 'Create Policy'}</div>
            <div className="mt-1 text-xs text-muted">Rules that automatically detect missing, forbidden, or recommended harness assets.</div>
          </div>
          <button onClick={onClose} className="text-muted transition-colors hover:text-text" aria-label="Close policy editor">✕</button>
        </div>

        <div className="grid flex-1 gap-0 overflow-hidden lg:grid-cols-[300px_minmax(0,1fr)]">
          <div className="space-y-4 border-r border-border p-5">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-[0.18em] text-muted">Name</label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Production MCP Baseline"
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-[0.18em] text-muted">Description</label>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
                placeholder="Checks production projects for required MCP and instructions."
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="rounded-xl border border-border bg-bg/40 px-3 py-2 text-sm text-text">
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">Severity</div>
                <select
                  value={severity}
                  onChange={(event) => setSeverity(event.target.value as Policy['severity'])}
                  className="mt-2 w-full bg-transparent text-sm text-text focus:outline-none"
                >
                  <option value="warning">Warning</option>
                  <option value="blocking">Blocking</option>
                </select>
              </label>
              <label className="rounded-xl border border-border bg-bg/40 px-3 py-2 text-sm text-text">
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">Status</div>
                <div className="mt-3 flex items-center gap-2">
                  <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
                  <span>{enabled ? 'Enabled' : 'Disabled'}</span>
                </div>
              </label>
            </div>
            <div className="rounded-xl border border-border bg-bg/40 p-4 text-xs text-muted">
              Leave selectors empty to apply everywhere. Rules must include `mode`, `assetType`, `scope`, and either `name` or `namePattern`.
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto p-5">
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-[0.18em] text-muted">Selectors JSON</label>
                <textarea
                  value={selectorsText}
                  onChange={(event) => setSelectorsText(event.target.value)}
                  rows={10}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-text focus:border-accent focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-[0.18em] text-muted">Rules JSON</label>
                <textarea
                  value={rulesText}
                  onChange={(event) => setRulesText(event.target.value)}
                  rows={14}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-text focus:border-accent focus:outline-none"
                />
              </div>
              {error && (
                <div className="rounded-lg border border-red/30 bg-red/10 px-3 py-2 text-xs text-red">
                  {error}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <button onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-sm text-muted transition-colors hover:text-text hover:border-accent/50">
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving || !name.trim()}
            className="rounded-lg border border-accent/40 bg-accent/15 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
          >
            {saving ? 'Saving...' : policy ? 'Save Policy' : 'Create Policy'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PoliciesView() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [evaluation, setEvaluation] = useState<PolicyEvaluation | null>(null);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<Policy | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [policyRes, evaluationRes] = await Promise.all([fetchPolicies(), fetchPolicyEvaluation()]);
      setPolicies(policyRes.data);
      setEvaluation(evaluationRes.data);
      setSelectedPolicyId((current) => current && policyRes.data.some((policy) => policy.id === current) ? current : policyRes.data[0]?.id || null);
    } catch (err) {
      console.error('Failed to load policies:', err);
      showToast('Failed to load policies');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const selectedPolicy = useMemo(
    () => policies.find((policy) => policy.id === selectedPolicyId) || null,
    [policies, selectedPolicyId]
  );

  const impactedSubjects = useMemo(
    () => selectedPolicy ? collectImpactedSubjects(evaluation, selectedPolicy.id) : [],
    [evaluation, selectedPolicy]
  );

  const handleSave = async (payload: {
    name: string;
    description: string;
    enabled: boolean;
    severity: Policy['severity'];
    selectors: PolicySelectors;
    rules: PolicyRule[];
  }) => {
    setSaving(true);
    try {
      if (editingPolicy) {
        await updatePolicy(editingPolicy.id, payload);
        showToast('Policy updated');
      } else {
        await createPolicy(payload);
        showToast('Policy created');
      }
      setShowEditor(false);
      setEditingPolicy(null);
      await loadData();
    } catch (err) {
      console.error('Failed to save policy:', err);
      showToast('Failed to save policy');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (policy: Policy) => {
    if (!window.confirm(`Delete policy "${policy.name}"?`)) return;
    try {
      await deletePolicy(policy.id);
      showToast('Policy deleted');
      await loadData();
    } catch (err) {
      console.error('Failed to delete policy:', err);
      showToast('Failed to delete policy');
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-text">Policies</h2>
          <p className="mt-1 text-sm text-muted">Required, forbidden, and recommended harness rules by project type and environment.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void loadData()}
            className="rounded-lg border border-border px-3 py-2 text-sm text-muted transition-colors hover:text-text hover:border-accent/50"
          >
            Run Checks
          </button>
          <button
            onClick={() => {
              setEditingPolicy(null);
              setShowEditor(true);
            }}
            className="rounded-lg border border-accent/40 bg-accent/15 px-3 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/20"
          >
            + Create Policy
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-muted">Loading policies...</div>
      ) : (
        <>
          <div className="mb-6 grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-muted">Policies</div>
              <div className="mt-2 text-2xl font-semibold text-text">{evaluation?.summary.policyCount ?? policies.length}</div>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-muted">Violating Projects</div>
              <div className="mt-2 text-2xl font-semibold text-text">{evaluation?.summary.violatingProjectCount ?? 0}</div>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-muted">Violating Environments</div>
              <div className="mt-2 text-2xl font-semibold text-text">{evaluation?.summary.violatingEnvironmentCount ?? 0}</div>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-muted">Blocking / Warning</div>
              <div className="mt-2 text-2xl font-semibold text-text">
                {evaluation?.summary.blockingCount ?? 0}
                <span className="mx-1 text-muted">/</span>
                {evaluation?.summary.warningCount ?? 0}
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
            <div className="space-y-3">
              {policies.length === 0 ? (
                <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
                  No policies yet. Create the first baseline for projects or servers.
                </div>
              ) : (
                policies.map((policy) => {
                  const impacted = collectImpactedSubjects(evaluation, policy.id);
                  const blockingCount = impacted.reduce((sum, subject) => sum + subject.blockingCount, 0);
                  const warningCount = impacted.reduce((sum, subject) => sum + subject.warningCount, 0);
                  return (
                    <button
                      key={policy.id}
                      onClick={() => setSelectedPolicyId(policy.id)}
                      className={`w-full rounded-xl border p-4 text-left transition-colors ${
                        selectedPolicyId === policy.id
                          ? 'border-accent bg-accent/10'
                          : 'border-border bg-surface hover:border-accent/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium text-text">{policy.name}</span>
                            <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
                              policy.enabled
                                ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
                                : 'border-border bg-bg text-muted'
                            }`}>
                              {policy.enabled ? 'enabled' : 'disabled'}
                            </span>
                            <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
                              policy.severity === 'blocking'
                                ? 'border-red/30 bg-red/10 text-red'
                                : 'border-amber-400/30 bg-amber-400/10 text-amber-200'
                            }`}>
                              {policy.severity}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-muted">{policy.description || 'No description'}</div>
                        </div>
                        <div className="text-right text-[11px] text-muted">
                          <div>{policy.rules.length} rules</div>
                          <div>{impacted.length} violations</div>
                        </div>
                      </div>
                      {(blockingCount > 0 || warningCount > 0) && (
                        <div className="mt-3 flex gap-2 text-[11px]">
                          {blockingCount > 0 && (
                            <span className="rounded-md border border-red/30 bg-red/10 px-2 py-1 text-red">{blockingCount} blocking</span>
                          )}
                          {warningCount > 0 && (
                            <span className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-amber-200">{warningCount} warning</span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            <div className="rounded-xl border border-border bg-surface p-5">
              {selectedPolicy ? (
                <div className="space-y-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold text-text">{selectedPolicy.name}</h3>
                        <span className={`rounded-md border px-2 py-0.5 text-xs ${
                          selectedPolicy.severity === 'blocking'
                            ? 'border-red/30 bg-red/10 text-red'
                            : 'border-amber-400/30 bg-amber-400/10 text-amber-200'
                        }`}>
                          {selectedPolicy.severity}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-muted">{selectedPolicy.description || 'No description'}</p>
                      <p className="mt-1 text-xs text-muted">Updated {formatTimestamp(selectedPolicy.updated_at)}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setEditingPolicy(selectedPolicy);
                          setShowEditor(true);
                        }}
                        className="rounded-lg border border-border px-3 py-2 text-sm text-muted transition-colors hover:text-text hover:border-accent/50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => void handleDelete(selectedPolicy)}
                        className="rounded-lg border border-red/30 bg-red/10 px-3 py-2 text-sm text-red transition-colors hover:bg-red/15"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                      <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-muted">Selectors</div>
                      <pre className="overflow-x-auto rounded-lg border border-border bg-bg px-3 py-3 text-xs text-text">{prettyJson(selectedPolicy.selectors)}</pre>
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-muted">Rules</div>
                      <div className="space-y-2">
                        {selectedPolicy.rules.map((rule, index) => (
                          <div key={`${rule.mode}:${rule.assetType}:${rule.name || rule.namePattern || index}`} className="rounded-lg border border-border bg-bg px-3 py-3 text-xs text-text">
                            <div className="font-medium">
                              {rule.mode} {rule.assetType}
                              <span className="mx-1 text-muted">·</span>
                              {rule.scope}
                            </div>
                            <div className="mt-1 text-muted">
                              {rule.name || rule.namePattern}
                              {rule.provider ? ` · ${rule.provider}` : ''}
                            </div>
                            {rule.note && <div className="mt-1 text-muted">{rule.note}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-muted">Current Violations</div>
                    {impactedSubjects.length === 0 ? (
                      <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 py-3 text-sm text-emerald-200">
                        No current violations for this policy.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {impactedSubjects.map((subject) => (
                          <div key={subject.subjectId} className="rounded-lg border border-border bg-bg px-3 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="font-medium text-text">{subject.name}</div>
                                <div className="mt-1 text-xs text-muted">
                                  {subject.kind === 'project' ? subject.path : subject.environmentName || subject.environmentType || 'environment'}
                                </div>
                              </div>
                              <div className="flex gap-2 text-[11px]">
                                {subject.blockingCount > 0 && (
                                  <span className="rounded-md border border-red/30 bg-red/10 px-2 py-1 text-red">{subject.blockingCount} blocking</span>
                                )}
                                {subject.warningCount > 0 && (
                                  <span className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-amber-200">{subject.warningCount} warning</span>
                                )}
                              </div>
                            </div>
                            <div className="mt-2 space-y-1">
                              {subject.violations
                                .filter((violation) => violation.policyId === selectedPolicy.id)
                                .map((violation) => (
                                  <div key={violation.id} className="rounded-md border border-border/70 bg-surface px-2.5 py-2 text-[11px] text-muted">
                                    {violation.message}
                                  </div>
                                ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="py-12 text-center text-muted">Select a policy to inspect details.</div>
              )}
            </div>
          </div>
        </>
      )}

      {showEditor && (
        <PolicyEditorModal
          policy={editingPolicy}
          saving={saving}
          onClose={() => {
            if (saving) return;
            setShowEditor(false);
            setEditingPolicy(null);
          }}
          onSave={handleSave}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[300] -translate-x-1/2 rounded-lg border border-accent bg-surface px-5 py-2.5 text-[13px] text-accent shadow-[0_4px_16px_rgba(0,0,0,.3)]">
          {toast}
        </div>
      )}
    </div>
  );
}
