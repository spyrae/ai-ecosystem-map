import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Asset, AssetType, AuditMode, BatchSyncPreview, DiffPair, DiffResult, Environment, Provider, RemediationSuggestion, SyncPlan, SyncRequest, TopologyGraph } from '../types';
import { PROVIDER_LABELS, TYPE_LABELS, policySummaryItems } from '../types';
import { fetchServers, fetchTopology, addServer, testServer, scanServer, diffServer, fetchServerRemediations, previewSync, applySync, previewBatchSync, applyBatchSync, discoverRemoteProjects, setServerReadOnly, applyServerRemediation } from '../lib/api';
import { getEnvironmentTopologyNode } from '../lib/topology';
import { SyncPlanModal } from './SyncPlanModal';
import { BatchSyncPlanModal } from './BatchSyncPlanModal';

export function ServersView({
  auditMode,
  onAuditModeChange,
  focusServerId,
  onFocusConsumed,
}: {
  auditMode: AuditMode | null;
  onAuditModeChange: (mode: AuditMode | null) => void;
  focusServerId?: string | null;
  onFocusConsumed?: () => void;
}) {
  const buildApproval = useCallback((note?: string | null) => ({
    confirmed: true,
    note: note ?? null,
    source: 'web',
  }), []);
  const [servers, setServers] = useState<Environment[]>([]);
  const [topology, setTopology] = useState<TopologyGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', ssh_host: '', ssh_user: '', ssh_port: '22', ssh_key_path: '' });
  const [adding, setAdding] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [scanResults, setScanResults] = useState<Record<string, number>>({});
  const [scanning, setScanning] = useState<Record<string, boolean>>({});
  const [discoveringProjects, setDiscoveringProjects] = useState<Record<string, boolean>>({});
  const [diffData, setDiffData] = useState<Record<string, DiffResult>>({});
  const [expandedServer, setExpandedServer] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [syncRequest, setSyncRequest] = useState<SyncRequest | null>(null);
  const [syncPlan, setSyncPlan] = useState<SyncPlan | null>(null);
  const [syncTitle, setSyncTitle] = useState('');
  const [syncLoading, setSyncLoading] = useState(false);
  const [applyingSync, setApplyingSync] = useState(false);
  const [batchPreview, setBatchPreview] = useState<BatchSyncPreview | null>(null);
  const [batchRequests, setBatchRequests] = useState<SyncRequest[] | null>(null);
  const [batchTitle, setBatchTitle] = useState('');
  const [batchLoading, setBatchLoading] = useState(false);
  const [applyingBatchSync, setApplyingBatchSync] = useState(false);
  const [readOnlyUpdating, setReadOnlyUpdating] = useState<Record<string, boolean>>({});
  const [serverRemediations, setServerRemediations] = useState<Record<string, RemediationSuggestion[]>>({});
  const [serverRemediationLoading, setServerRemediationLoading] = useState<Record<string, boolean>>({});
  const [applyingServerRemediationId, setApplyingServerRemediationId] = useState<string | null>(null);
  const globalReadOnly = auditMode?.global_read_only === true;

  const loadServers = async () => {
    try {
      const [res, topologyRes] = await Promise.all([fetchServers(), fetchTopology()]);
      setServers(res.data);
      setTopology(topologyRes.data);
    } catch (err) {
      console.error('Failed to load servers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadServers(); }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const isServerReadOnly = (server: Environment) =>
    globalReadOnly || auditMode?.environments.some((entry) => entry.environment_id === server.id && entry.read_only) === true;

  const serverReadOnlyReason = (server: Environment) =>
    globalReadOnly
      ? 'Global read-only audit mode is enabled.'
      : `${server.name} is in read-only audit mode.`;

  const handleAdd = async () => {
    if (!form.name || !form.ssh_host || !form.ssh_user) return;
    setAdding(true);
    try {
      await addServer({
        name: form.name,
        ssh_host: form.ssh_host,
        ssh_user: form.ssh_user,
        ssh_port: parseInt(form.ssh_port) || 22,
        ssh_key_path: form.ssh_key_path || undefined,
      });
      setForm({ name: '', ssh_host: '', ssh_user: '', ssh_port: '22', ssh_key_path: '' });
      setShowAdd(false);
      await loadServers();
      showToast('Server added');
    } catch (err) {
      console.error('Failed to add server:', err);
    } finally {
      setAdding(false);
    }
  };

  const handleTest = async (id: string) => {
    setTestResults((prev) => ({ ...prev, [id]: { ok: false, msg: 'Testing...' } }));
    try {
      const res = await testServer(id);
      setTestResults((prev) => ({
        ...prev,
        [id]: res.ok
          ? { ok: true, msg: `Connected: ${res.hostname}` }
          : { ok: false, msg: res.error || 'Failed' },
      }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [id]: { ok: false, msg: err instanceof Error ? err.message : 'Error' },
      }));
    }
  };

  const handleScan = async (id: string) => {
    setScanning((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await scanServer(id);
      setScanResults((prev) => ({ ...prev, [id]: res.count }));
      showToast(`Found ${res.count} assets on remote`);
    } catch (err) {
      console.error('Scan failed:', err);
      showToast('Scan failed: ' + (err instanceof Error ? err.message : 'Error'));
    } finally {
      setScanning((prev) => ({ ...prev, [id]: false }));
    }
  };

  const openServerPanel = useCallback(async (id: string) => {
    setExpandedServer(id);
    setServerRemediationLoading((prev) => ({ ...prev, [id]: true }));
    try {
      const [res, remediationRes] = await Promise.all([
        diffServer(id),
        fetchServerRemediations(id).catch(() => ({ data: [] as RemediationSuggestion[] })),
      ]);
      setDiffData((prev) => ({ ...prev, [id]: res.data }));
      setServerRemediations((prev) => ({ ...prev, [id]: remediationRes.data || [] }));
    } catch (err) {
      console.error('Diff failed:', err);
      showToast('Failed to load diff');
    } finally {
      setServerRemediationLoading((prev) => ({ ...prev, [id]: false }));
    }
  }, [showToast]);

  const handleDiff = async (id: string) => {
    if (expandedServer === id) {
      setExpandedServer(null);
      return;
    }
    await openServerPanel(id);
  };

  const handleDiscoverProjects = async (id: string) => {
    setDiscoveringProjects((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await discoverRemoteProjects(id);
      showToast(
        res.data.length > 0
          ? `Discovered ${res.data.length} remote projects`
          : 'No remote projects with AI tooling found'
      );
    } catch (err) {
      console.error('Remote project discovery failed:', err);
      showToast('Remote project discovery failed');
    } finally {
      setDiscoveringProjects((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleToggleServerReadOnly = async (server: Environment) => {
    if (globalReadOnly) {
      showToast('Disable global read-only audit mode before changing server policy');
      return;
    }
    setReadOnlyUpdating((prev) => ({ ...prev, [server.id]: true }));
    try {
      const res = await setServerReadOnly(server.id, !isServerReadOnly(server));
      onAuditModeChange(res.data);
      showToast(`${server.name} ${isServerReadOnly(server) ? 'write access restored' : 'set to read-only audit mode'}`);
    } catch (err) {
      console.error('Failed to update read-only policy:', err);
      showToast('Failed to update read-only policy');
    } finally {
      setReadOnlyUpdating((prev) => ({ ...prev, [server.id]: false }));
    }
  };

  const openSyncPreview = async (request: SyncRequest, title: string) => {
    setSyncLoading(true);
    try {
      const res = await previewSync(request);
      setSyncRequest(request);
      setSyncPlan(res.plan);
      setSyncTitle(title);
    } catch (err) {
      console.error('Sync preview failed:', err);
      showToast('Sync preview failed: ' + (err instanceof Error ? err.message : 'Error'));
    } finally {
      setSyncLoading(false);
    }
  };

  const openBatchSyncPreview = async (requests: SyncRequest[], title: string) => {
    setBatchLoading(true);
    try {
      const result = await previewBatchSync(requests);
      setBatchRequests(requests);
      setBatchPreview(result);
      setBatchTitle(title);
    } catch (err) {
      console.error('Batch sync preview failed:', err);
      showToast('Batch sync preview failed');
    } finally {
      setBatchLoading(false);
    }
  };

  const refreshExpandedServerDiff = async () => {
    if (!expandedServer) return;
    try {
      const [res, remediationRes] = await Promise.all([
        diffServer(expandedServer),
        fetchServerRemediations(expandedServer).catch(() => ({ data: [] as RemediationSuggestion[] })),
      ]);
      setDiffData((prev) => ({ ...prev, [expandedServer]: res.data }));
      setServerRemediations((prev) => ({ ...prev, [expandedServer]: remediationRes.data || [] }));
    } catch (err) {
      console.error('Failed to refresh diff:', err);
    }
  };

  const handleApplyServerRemediation = async (server: Environment, suggestion: RemediationSuggestion) => {
    if (!suggestion.canApply || isServerReadOnly(server)) return;
    if (suggestion.risky && !window.confirm(`${suggestion.title}\n\n${suggestion.summary}\n\nThis remediation will overwrite existing server configuration. Continue?`)) {
      return;
    }
    setApplyingServerRemediationId(suggestion.id);
    try {
      const res = await applyServerRemediation(server.id, suggestion.id, {
        confirmRisk: suggestion.risky,
        approval: buildApproval(suggestion.risky ? `Approved risky remediation for ${server.name}` : `Approved remediation for ${server.name}`),
      });
      if (!res.ok) {
        showToast(res.error || 'Failed to apply remediation');
        return;
      }
      showToast('Server remediation applied');
      await refreshExpandedServerDiff();
    } catch (err) {
      console.error('Failed to apply server remediation:', err);
      showToast(err instanceof Error ? err.message : 'Failed to apply remediation');
    } finally {
      setApplyingServerRemediationId(null);
    }
  };

  const handleApplySync = async () => {
    if (!syncRequest) return;
    setApplyingSync(true);
    try {
      const res = await applySync(syncRequest, buildApproval(`Approved server sync for ${syncRequest.source.name}`));
      if (res.ok) {
        showToast(`Applied sync for ${syncRequest.source.name}`);
        setSyncPlan(null);
        setSyncRequest(null);
        await refreshExpandedServerDiff();
      } else {
        showToast(`Sync failed: ${res.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Apply sync failed:', err);
      showToast('Sync apply failed');
    } finally {
      setApplyingSync(false);
    }
  };

  const handleApplyBatchSync = async () => {
    if (!batchRequests) return;
    setApplyingBatchSync(true);
    try {
      const result = await applyBatchSync(batchRequests, buildApproval(`Approved batch sync for ${batchRequests.length} server assets`));
      showToast(`Applied batch sync: ${result.successCount}/${result.total} assets`);
      setBatchPreview(null);
      setBatchRequests(null);
      await refreshExpandedServerDiff();
    } catch (err) {
      console.error('Apply batch sync failed:', err);
      showToast('Batch sync apply failed');
    } finally {
      setApplyingBatchSync(false);
    }
  };

  const handlePush = async (serverId: string, asset: Asset) => {
    await openSyncPreview({
      source: {
        assetId: asset.id,
        name: asset.name,
        type: asset.type,
        filePath: asset.filePath,
        providers: asset.providers,
      },
      target: {
        kind: 'server',
        serverId,
        direction: 'push',
      },
    }, `Push ${asset.name} to remote`);
  };

  const handlePull = async (serverId: string, asset: Asset) => {
    await openSyncPreview({
      source: {
        assetId: asset.id,
        name: asset.name,
        type: asset.type,
        filePath: asset.filePath,
        providers: asset.providers,
      },
      target: {
        kind: 'server',
        serverId,
        direction: 'pull',
      },
    }, `Pull ${asset.name} from remote`);
  };

  const serverById = (serverId?: string | null) =>
    serverId ? servers.find((server) => server.id === serverId) ?? null : null;

  const pendingSyncServer = syncRequest?.target.kind === 'server'
    ? serverById(syncRequest.target.serverId)
    : null;
  const pendingSyncReadOnly = pendingSyncServer ? isServerReadOnly(pendingSyncServer) : globalReadOnly;
  const pendingSyncReadOnlyReason = pendingSyncServer
    ? serverReadOnlyReason(pendingSyncServer)
    : (globalReadOnly ? 'Global read-only audit mode is enabled.' : undefined);

  const pendingBatchServer = batchRequests
    ?.flatMap((request) => {
      if (request.target.kind !== 'server') return [];
      const server = serverById(request.target.serverId);
      return server ? [server] : [];
    })
    .find((server) => isServerReadOnly(server)) ?? null;
  const pendingBatchReadOnly = Boolean(pendingBatchServer ? isServerReadOnly(pendingBatchServer) : globalReadOnly);
  const pendingBatchReadOnlyReason = pendingBatchServer
    ? serverReadOnlyReason(pendingBatchServer)
    : (globalReadOnly ? 'Global read-only audit mode is enabled.' : undefined);

  useEffect(() => {
    if (!focusServerId) return;
    const server = servers.find((entry) => entry.id === focusServerId && entry.type === 'remote');
    if (!server) return;
    if (expandedServer !== server.id) {
      void openServerPanel(server.id);
    }
    onFocusConsumed?.();
  }, [expandedServer, focusServerId, onFocusConsumed, openServerPanel, servers]);

  const remoteServers = servers.filter((s) => s.type === 'remote');
  const localServer = servers.find((s) => s.type === 'local');
  const localTopology = localServer ? getEnvironmentTopologyNode(topology, localServer.id, 'local') : null;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-text">Servers</h2>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="px-3 py-1.5 text-xs font-medium bg-accent/15 text-accent border border-accent/30 rounded-lg hover:bg-accent/25 transition-colors"
        >
          + Add Server
        </button>
      </div>

      {globalReadOnly && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Global read-only audit mode is enabled. Remote server sync actions stay available for preview, but apply actions are disabled.
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <div className="bg-surface border border-border rounded-lg p-4 mb-6 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              placeholder="Name (e.g. NUE-01)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus:border-accent"
            />
            <input
              placeholder="Host (e.g. 2.56.98.78)"
              value={form.ssh_host}
              onChange={(e) => setForm({ ...form, ssh_host: e.target.value })}
              className="bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus:border-accent"
            />
            <input
              placeholder="User (e.g. roman)"
              value={form.ssh_user}
              onChange={(e) => setForm({ ...form, ssh_user: e.target.value })}
              className="bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus:border-accent"
            />
            <input
              placeholder="Port (default: 22)"
              value={form.ssh_port}
              onChange={(e) => setForm({ ...form, ssh_port: e.target.value })}
              className="bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus:border-accent"
            />
            <input
              placeholder="SSH key path (optional, e.g. ~/.ssh/id_ed25519)"
              value={form.ssh_key_path}
              onChange={(e) => setForm({ ...form, ssh_key_path: e.target.value })}
              className="col-span-2 bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={adding || !form.name || !form.ssh_host || !form.ssh_user}
              className="px-4 py-2 text-sm font-medium bg-accent text-bg rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-40"
            >
              {adding ? 'Adding...' : 'Add'}
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="px-4 py-2 text-sm text-muted hover:text-text"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-muted text-center py-12">Loading...</div>
      ) : (
        <div className="space-y-3">
          {/* Local */}
          {localServer && (
            <div className="bg-surface border border-border rounded-lg p-4">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-green shrink-0" />
                <div className="flex-1">
                  <div className="text-sm font-semibold">{localServer.name}</div>
                  <div className="text-[11px] text-muted">Local machine</div>
                  {localTopology?.summary && (
                    <div className="text-[11px] text-muted mt-0.5">
                      {[
                        `${localTopology.summary.projectCount || 0} projects`,
                        `${localTopology.summary.providerCount || 0} providers`,
                        `${localTopology.summary.agentCount || 0} agents`,
                        ...policySummaryItems(localServer.policy),
                      ].join(' · ')}
                    </div>
                  )}
                </div>
                <span className="text-xs text-muted bg-green/15 text-green px-2 py-0.5 rounded">local</span>
              </div>
            </div>
          )}

          {/* Remote servers */}
          {remoteServers.length === 0 && (
            <div className="text-center py-12">
              <span className="text-4xl block mb-3">🖥️</span>
              <p className="text-muted mb-1">No remote servers</p>
              <p className="text-xs text-muted">Add a VPS to scan and sync AI assets remotely</p>
            </div>
          )}

          {remoteServers.map((server) => {
            const serverTopology = getEnvironmentTopologyNode(topology, server.id, 'remote');
            const serverReadOnly = isServerReadOnly(server);
            return (
            <div key={server.id}>
              <div className="bg-surface border border-border rounded-lg p-4">
                <div className="flex items-center gap-3 mb-3">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    testResults[server.id]?.ok ? 'bg-green' : 'bg-muted'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">{server.name}</div>
                    <div className="text-[11px] text-muted font-mono">
                      {server.ssh_user}@{server.ssh_host}:{server.ssh_port || 22}
                    </div>
                    {serverTopology?.summary && (
                      <div className="text-[11px] text-muted mt-0.5">
                        {[
                          `${serverTopology.summary.projectCount || 0} projects`,
                          `${serverTopology.summary.providerCount || 0} providers`,
                          `${serverTopology.summary.agentCount || 0} agents`,
                          ...policySummaryItems(server.policy),
                        ].join(' · ')}
                      </div>
                    )}
                  </div>
                  {scanResults[server.id] !== undefined && (
                    <span className="text-xs text-accent">{scanResults[server.id]} assets</span>
                  )}
                  {serverReadOnly && (
                    <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">
                      read-only
                    </span>
                  )}
                  {server.policy && server.policy.violationCount > 0 && (
                    <span className={`rounded border px-2 py-0.5 text-xs ${
                      server.policy.status === 'broken'
                        ? 'border-red/30 bg-red/10 text-red'
                        : 'border-amber-400/30 bg-amber-400/10 text-amber-200'
                    }`}>
                      {server.policy.blockingCount > 0 ? `${server.policy.blockingCount} blocking` : `${server.policy.warningCount} warning`}
                    </span>
                  )}
                </div>

                {/* Test result */}
                {testResults[server.id] && (
                  <div className={`text-xs mb-3 px-2 py-1 rounded ${
                    testResults[server.id].ok ? 'bg-green/10 text-green' : 'bg-red/10 text-red'
                  }`}>
                    {testResults[server.id].msg}
                  </div>
                )}

                {server.policy && server.policy.violations.length > 0 && (
                  <div className={`mb-3 rounded-lg border px-3 py-2 text-xs ${
                    server.policy.status === 'broken'
                      ? 'border-red/30 bg-red/10 text-red'
                      : 'border-amber-400/30 bg-amber-400/10 text-amber-200'
                  }`}>
                    <div className="font-medium">Policy</div>
                    <div className="mt-0.5">{server.policy.summary}</div>
                  </div>
                )}

                {(serverRemediationLoading[server.id] || (serverRemediations[server.id] || []).length > 0) && (
                  <div className="mb-3 rounded-lg border border-border bg-surface/60 px-3 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                      Suggested Fixes
                    </div>
                    {serverRemediationLoading[server.id] ? (
                      <div className="mt-2 text-[11px] text-muted">Checking available remediations…</div>
                    ) : (
                      <div className="mt-2 space-y-2">
                        {(serverRemediations[server.id] || []).map((suggestion) => (
                          <div key={suggestion.id} className="rounded-md border border-border/70 bg-bg/60 px-2.5 py-2">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-xs font-medium text-text">{suggestion.title}</div>
                                <div className="mt-0.5 text-[11px] text-muted">{suggestion.summary}</div>
                              </div>
                              {suggestion.canApply ? (
                                <button
                                  onClick={() => void handleApplyServerRemediation(server, suggestion)}
                                  disabled={isServerReadOnly(server) || applyingServerRemediationId === suggestion.id}
                                  className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-text transition-colors hover:border-accent/50 hover:text-accent disabled:opacity-40"
                                >
                                  {applyingServerRemediationId === suggestion.id ? 'Applying…' : suggestion.applyLabel || 'Apply'}
                                </button>
                              ) : (
                                <span className="rounded-full bg-[hsl(240,5%,16%)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted">
                                  guided
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleTest(server.id)}
                    className="px-3 py-1.5 text-xs border border-border rounded-lg text-muted hover:text-text hover:border-accent/50 transition-colors"
                  >
                    Test
                  </button>
                  <button
                    onClick={() => handleScan(server.id)}
                    disabled={scanning[server.id]}
                    className="px-3 py-1.5 text-xs border border-border rounded-lg text-muted hover:text-text hover:border-accent/50 transition-colors disabled:opacity-40"
                  >
                    {scanning[server.id] ? 'Scanning...' : 'Scan'}
                  </button>
                  <button
                    onClick={() => handleDiscoverProjects(server.id)}
                    disabled={discoveringProjects[server.id]}
                    className="px-3 py-1.5 text-xs border border-border rounded-lg text-muted hover:text-text hover:border-accent/50 transition-colors disabled:opacity-40"
                  >
                    {discoveringProjects[server.id] ? 'Discovering...' : 'Discover Projects'}
                  </button>
                  <button
                    onClick={() => handleDiff(server.id)}
                    className={`px-3 py-1.5 text-xs border rounded-lg transition-colors ${
                      expandedServer === server.id
                        ? 'border-accent text-accent'
                        : 'border-border text-muted hover:text-text hover:border-accent/50'
                    }`}
                  >
                    Diff
                  </button>
                  <button
                    onClick={() => void handleToggleServerReadOnly(server)}
                    disabled={globalReadOnly || readOnlyUpdating[server.id]}
                    className="px-3 py-1.5 text-xs border border-border rounded-lg text-muted hover:text-text hover:border-accent/50 transition-colors disabled:opacity-40"
                    title={globalReadOnly ? 'Disable global read-only mode first' : undefined}
                  >
                    {readOnlyUpdating[server.id]
                      ? 'Updating...'
                      : serverReadOnly
                        ? 'Enable Writes'
                        : 'Read-Only'}
                  </button>
                </div>
              </div>

              {/* Diff view */}
              {expandedServer === server.id && diffData[server.id] && (
                <DiffView
                  diff={diffData[server.id]}
                  serverId={server.id}
                  readOnly={serverReadOnly}
                  readOnlyReason={serverReadOnlyReason(server)}
                  onPush={handlePush}
                  onPull={handlePull}
                  onBatchSync={openBatchSyncPreview}
                />
              )}
            </div>
          );
          })}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] bg-surface border border-green rounded-lg px-5 py-2.5 text-green text-[13px] shadow-[0_4px_16px_rgba(0,0,0,.3)]">
          {toast}
        </div>
      )}

      {(syncPlan || syncLoading) && (
        <SyncPlanModal
          plan={syncPlan}
          applying={applyingSync || syncLoading}
          title={syncLoading ? 'Building sync preview...' : syncTitle}
          readOnly={pendingSyncReadOnly}
          readOnlyReason={pendingSyncReadOnlyReason}
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
          readOnly={pendingBatchReadOnly}
          readOnlyReason={pendingBatchReadOnlyReason}
          onApply={handleApplyBatchSync}
          onClose={() => {
            if (batchLoading || applyingBatchSync) return;
            setBatchPreview(null);
            setBatchRequests(null);
          }}
        />
      )}
    </div>
  );
}

function DiffView({
  diff,
  serverId,
  readOnly = false,
  readOnlyReason,
  onPush,
  onPull,
  onBatchSync,
}: {
  diff: DiffResult;
  serverId: string;
  readOnly?: boolean;
  readOnlyReason?: string;
  onPush: (id: string, asset: Asset) => void;
  onPull: (id: string, asset: Asset) => void;
  onBatchSync: (requests: SyncRequest[], title: string) => Promise<void>;
}) {
  const syncableTypes = new Set<Asset['type']>(['skill', 'agent', 'instruction', 'rule', 'mcp']);
  const [typeFilter, setTypeFilter] = useState<'all' | AssetType>('all');
  const [providerFilter, setProviderFilter] = useState<'all' | Provider>('all');
  const providers = useMemo(
    () => [...new Set([
      ...diff.onlyLocal.flatMap((asset) => asset.providers),
      ...diff.onlyRemote.flatMap((asset) => asset.providers),
      ...diff.both.flatMap((pair) => pair.local.providers),
    ])].filter(Boolean) as Provider[],
    [diff]
  );

  const assetMatchesFilters = (asset: Asset) => {
    if (typeFilter !== 'all' && asset.type !== typeFilter) return false;
    if (providerFilter !== 'all' && !asset.providers.includes(providerFilter)) return false;
    return true;
  };

  const filteredOnlyLocal = diff.onlyLocal.filter(assetMatchesFilters);
  const filteredOnlyRemote = diff.onlyRemote.filter(assetMatchesFilters);
  const filteredDrifted = diff.both.filter((pair) => pair.status === 'drifted' && assetMatchesFilters(pair.local));
  const filteredSame = diff.both.filter((pair) => pair.status === 'same' && assetMatchesFilters(pair.local));

  const openBatchSync = async (pairs: Asset[] | DiffPair[], direction: 'push' | 'pull', title: string) => {
    const requests: SyncRequest[] = pairs.map((entry) => {
      const asset = 'local' in entry ? (direction === 'push' ? entry.local : entry.remote) : entry;
      return {
        source: {
          assetId: asset.id,
          name: asset.name,
          type: asset.type,
          filePath: asset.filePath,
          providers: asset.providers,
        },
        target: {
          kind: 'server',
          serverId,
          direction,
        },
      };
    });
    await onBatchSync(requests, title);
  };

  return (
    <div className="mt-1 ml-4 border-l-2 border-accent/30 pl-4 py-3 space-y-4">
      {readOnly && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {readOnlyReason || 'Read-only audit mode is enabled for this server.'}
        </div>
      )}
      <div className="flex gap-4 text-xs text-muted">
        <span>Local: <strong className="text-text">{diff.localCount}</strong></span>
        <span>Remote: <strong className="text-text">{diff.remoteCount}</strong></span>
        <span>Only local: <strong className="text-orange">{diff.onlyLocal.length}</strong></span>
        <span>Only remote: <strong className="text-cyan">{diff.onlyRemote.length}</strong></span>
        <span>Same: <strong className="text-green">{diff.sameCount ?? 0}</strong></span>
        <span>Drifted: <strong className="text-amber-300">{diff.driftedCount ?? 0}</strong></span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value as 'all' | AssetType)}
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
          {providers.map((provider) => (
            <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>
          ))}
        </select>
        <button
          onClick={() => void openBatchSync(filteredOnlyLocal, 'push', `Push ${filteredOnlyLocal.length} assets to remote`)}
          disabled={readOnly || filteredOnlyLocal.length === 0}
          className="rounded-lg border border-orange/30 bg-orange/10 px-3 py-1.5 text-xs font-medium text-orange hover:bg-orange/15 transition-colors disabled:opacity-40"
        >
          Push Visible Only-Local
        </button>
        <button
          onClick={() => void openBatchSync(filteredOnlyRemote, 'pull', `Pull ${filteredOnlyRemote.length} assets from remote`)}
          disabled={readOnly || filteredOnlyRemote.length === 0}
          className="rounded-lg border border-cyan/30 bg-cyan/10 px-3 py-1.5 text-xs font-medium text-cyan hover:bg-cyan/15 transition-colors disabled:opacity-40"
        >
          Pull Visible Only-Remote
        </button>
        <button
          onClick={() => void openBatchSync(filteredDrifted, 'push', `Push ${filteredDrifted.length} drifted assets`)}
          disabled={readOnly || filteredDrifted.length === 0}
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/15 transition-colors disabled:opacity-40"
        >
          Push Visible Drifted
        </button>
        <button
          onClick={() => void openBatchSync(filteredDrifted, 'pull', `Pull ${filteredDrifted.length} drifted assets`)}
          disabled={readOnly || filteredDrifted.length === 0}
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/15 transition-colors disabled:opacity-40"
        >
          Pull Visible Drifted
        </button>
      </div>

      {/* Only local — can push */}
      {filteredOnlyLocal.length > 0 && (
        <div>
          <div className="text-[11px] text-orange uppercase tracking-wider mb-1.5">Only Local (can push →)</div>
          <div className="space-y-1">
            {filteredOnlyLocal.map((a) => (
              <div key={`${a.type}-${a.name}`} className="flex items-center gap-2 px-2 py-1.5 rounded bg-surface text-xs">
                <span className="font-mono text-accent truncate flex-1">{a.name}</span>
                <span className="text-muted">{a.type}</span>
                {syncableTypes.has(a.type) && (
                  <button
                    onClick={() => onPush(serverId, a)}
                    disabled={readOnly}
                    className="px-2 py-0.5 rounded border border-orange/50 text-orange hover:bg-orange/15 transition-colors disabled:opacity-40"
                  >
                    Push →
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Only remote — can pull */}
      {filteredOnlyRemote.length > 0 && (
        <div>
          <div className="text-[11px] text-cyan uppercase tracking-wider mb-1.5">Only Remote (← pull)</div>
          <div className="space-y-1">
            {filteredOnlyRemote.map((a) => (
              <div key={`${a.type}-${a.name}`} className="flex items-center gap-2 px-2 py-1.5 rounded bg-surface text-xs">
                <span className="font-mono text-accent truncate flex-1">{a.name}</span>
                <span className="text-muted">{a.type}</span>
                {syncableTypes.has(a.type) && (
                  <button
                    onClick={() => onPull(serverId, a)}
                    disabled={readOnly}
                    className="px-2 py-0.5 rounded border border-cyan/50 text-cyan hover:bg-cyan/15 transition-colors disabled:opacity-40"
                  >
                    ← Pull
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Both */}
      {diff.both.length > 0 && (
        <>
          {filteredDrifted.length > 0 && (
            <div>
              <div className="text-[11px] text-amber-300 uppercase tracking-wider mb-1.5">
                Drifted ({filteredDrifted.length})
              </div>
              <div className="space-y-1">
                {filteredDrifted.map((pair) => (
                  <div key={`${pair.local.type}-${pair.local.name}`} className="rounded bg-surface px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-accent flex-1 truncate">{pair.local.name}</span>
                      <span className="text-muted">{pair.local.type}</span>
                      {syncableTypes.has(pair.local.type) && (
                        <>
                          <button
                            onClick={() => onPush(serverId, pair.local)}
                            disabled={readOnly}
                            className="px-2 py-0.5 rounded border border-orange/50 text-orange hover:bg-orange/15 transition-colors disabled:opacity-40"
                          >
                            Push →
                          </button>
                          <button
                            onClick={() => onPull(serverId, pair.remote)}
                            disabled={readOnly}
                            className="px-2 py-0.5 rounded border border-cyan/50 text-cyan hover:bg-cyan/15 transition-colors disabled:opacity-40"
                          >
                            ← Pull
                          </button>
                        </>
                      )}
                    </div>
                    <div className="mt-1 text-[11px] text-muted">{pair.summary}</div>
                    {pair.reasons.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {pair.reasons.map((reason) => (
                          <span key={reason.code} className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
                            {reason.code.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {filteredSame.length > 0 && (
            <div>
              <div className="text-[11px] text-green uppercase tracking-wider mb-1.5">
                Same on both ({filteredSame.length})
              </div>
              <div className="text-xs text-muted">
                {filteredSame.slice(0, 10).map((pair) => pair.local.name).join(', ')}
                {filteredSame.length > 10 && ` ...and ${filteredSame.length - 10} more`}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
