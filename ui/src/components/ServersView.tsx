import { useEffect, useState } from 'react';
import type { Environment, DiffResult } from '../types';
import { fetchServers, addServer, testServer, scanServer, diffServer, pushToServer } from '../lib/api';

export function ServersView() {
  const [servers, setServers] = useState<Environment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', ssh_host: '', ssh_user: '', ssh_port: '22', ssh_key_path: '' });
  const [adding, setAdding] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [scanResults, setScanResults] = useState<Record<string, number>>({});
  const [scanning, setScanning] = useState<Record<string, boolean>>({});
  const [diffData, setDiffData] = useState<Record<string, DiffResult>>({});
  const [expandedServer, setExpandedServer] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadServers = async () => {
    try {
      const res = await fetchServers();
      setServers(res.data);
    } catch (err) {
      console.error('Failed to load servers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadServers(); }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

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

  const handleDiff = async (id: string) => {
    if (expandedServer === id) {
      setExpandedServer(null);
      return;
    }
    setExpandedServer(id);
    try {
      const res = await diffServer(id);
      setDiffData((prev) => ({ ...prev, [id]: res.data }));
    } catch (err) {
      console.error('Diff failed:', err);
    }
  };

  const handlePush = async (serverId: string, name: string, type: string) => {
    try {
      const res = await pushToServer(serverId, name, type);
      if (res.ok) showToast(`Pushed ${name} to remote`);
      else showToast(`Error: ${res.error}`);
    } catch (err) {
      showToast('Push failed');
    }
  };

  const remoteServers = servers.filter((s) => s.type === 'remote');
  const localServer = servers.find((s) => s.type === 'local');

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

          {remoteServers.map((server) => (
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
                  </div>
                  {scanResults[server.id] !== undefined && (
                    <span className="text-xs text-accent">{scanResults[server.id]} assets</span>
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
                    onClick={() => handleDiff(server.id)}
                    className={`px-3 py-1.5 text-xs border rounded-lg transition-colors ${
                      expandedServer === server.id
                        ? 'border-accent text-accent'
                        : 'border-border text-muted hover:text-text hover:border-accent/50'
                    }`}
                  >
                    Diff
                  </button>
                </div>
              </div>

              {/* Diff view */}
              {expandedServer === server.id && diffData[server.id] && (
                <DiffView
                  diff={diffData[server.id]}
                  serverId={server.id}
                  onPush={handlePush}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] bg-surface border border-green rounded-lg px-5 py-2.5 text-green text-[13px] shadow-[0_4px_16px_rgba(0,0,0,.3)]">
          {toast}
        </div>
      )}
    </div>
  );
}

function DiffView({ diff, serverId, onPush }: { diff: DiffResult; serverId: string; onPush: (id: string, name: string, type: string) => void }) {
  return (
    <div className="mt-1 ml-4 border-l-2 border-accent/30 pl-4 py-3 space-y-4">
      <div className="flex gap-4 text-xs text-muted">
        <span>Local: <strong className="text-text">{diff.localCount}</strong></span>
        <span>Remote: <strong className="text-text">{diff.remoteCount}</strong></span>
        <span>Only local: <strong className="text-orange">{diff.onlyLocal.length}</strong></span>
        <span>Only remote: <strong className="text-cyan">{diff.onlyRemote.length}</strong></span>
        <span>Shared: <strong className="text-green">{diff.both.length}</strong></span>
      </div>

      {/* Only local — can push */}
      {diff.onlyLocal.length > 0 && (
        <div>
          <div className="text-[11px] text-orange uppercase tracking-wider mb-1.5">Only Local (can push →)</div>
          <div className="space-y-1">
            {diff.onlyLocal.map((a) => (
              <div key={`${a.type}-${a.name}`} className="flex items-center gap-2 px-2 py-1.5 rounded bg-surface text-xs">
                <span className="font-mono text-accent truncate flex-1">{a.name}</span>
                <span className="text-muted">{a.type}</span>
                {(a.type === 'skill' || a.type === 'agent') && (
                  <button
                    onClick={() => onPush(serverId, a.name, a.type)}
                    className="px-2 py-0.5 rounded border border-orange/50 text-orange hover:bg-orange/15 transition-colors"
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
      {diff.onlyRemote.length > 0 && (
        <div>
          <div className="text-[11px] text-cyan uppercase tracking-wider mb-1.5">Only Remote (← pull)</div>
          <div className="space-y-1">
            {diff.onlyRemote.map((a) => (
              <div key={`${a.type}-${a.name}`} className="flex items-center gap-2 px-2 py-1.5 rounded bg-surface text-xs">
                <span className="font-mono text-accent truncate flex-1">{a.name}</span>
                <span className="text-muted">{a.type}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Both */}
      {diff.both.length > 0 && (
        <div>
          <div className="text-[11px] text-green uppercase tracking-wider mb-1.5">On both ({diff.both.length})</div>
          <div className="text-xs text-muted">
            {diff.both.slice(0, 10).map((b) => b.local.name).join(', ')}
            {diff.both.length > 10 && ` ...and ${diff.both.length - 10} more`}
          </div>
        </div>
      )}
    </div>
  );
}
