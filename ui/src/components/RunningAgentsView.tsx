import { useEffect, useMemo, useState } from 'react';
import type { RunningAgent, RunningAgentIntrospection, TopologyGraph } from '../types';
import { fetchRunningAgents, fetchTopology, addRunningAgent, removeRunningAgent, runRunningAgentIntrospection } from '../lib/api';
import { getRunningAgentEnvironmentNode, getRunningAgentTopologyNode } from '../lib/topology';

const STATUS_STYLES: Record<RunningAgentIntrospection['status'], string> = {
  unknown: 'bg-muted/15 text-muted border-border',
  ok: 'bg-green/15 text-green border-green/40',
  warning: 'bg-yellow/15 text-yellow border-yellow/40',
  broken: 'bg-red/15 text-red border-red/40',
};

export function RunningAgentsView() {
  const [agents, setAgents] = useState<RunningAgent[]>([]);
  const [topology, setTopology] = useState<TopologyGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', url: '', description: '', protocol: 'mcp' });
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [checking, setChecking] = useState<Record<string, boolean>>({});
  const [introspectionError, setIntrospectionError] = useState<Record<string, string>>({});
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadAgents = async () => {
    try {
      const [res, topologyRes] = await Promise.all([fetchRunningAgents(), fetchTopology()]);
      setAgents(res.data);
      setTopology(topologyRes.data);
    } catch (err) {
      console.error('Failed to load agents:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAgents();
  }, []);

  const agentsById = useMemo(() => {
    const next = new Map<string, RunningAgent>();
    for (const agent of agents) next.set(agent.id, agent);
    return next;
  }, [agents]);

  const handleAdd = async () => {
    if (!form.name || !form.url) return;
    setAdding(true);
    try {
      await addRunningAgent(form);
      setForm({ name: '', url: '', description: '', protocol: 'mcp' });
      setShowAdd(false);
      await loadAgents();
      showToast('Agent added');
    } catch {
      showToast('Failed to add agent');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (id: string) => {
    await removeRunningAgent(id);
    await loadAgents();
    showToast('Agent removed');
  };

  const handleInspect = async (id: string) => {
    setChecking((current) => ({ ...current, [id]: true }));
    setIntrospectionError((current) => ({ ...current, [id]: '' }));
    try {
      const res = await runRunningAgentIntrospection(id, { force: true });
      if (!res.ok) {
        setIntrospectionError((current) => ({ ...current, [id]: res.error || 'Runtime introspection failed' }));
      } else {
        showToast(res.data.summary);
      }
      setExpandedAgent(id);
      await loadAgents();
    } catch (err) {
      setIntrospectionError((current) => ({ ...current, [id]: err instanceof Error ? err.message : 'Runtime introspection failed' }));
    } finally {
      setChecking((current) => ({ ...current, [id]: false }));
    }
  };

  const toggleExpanded = (id: string) => {
    setExpandedAgent((current) => current === id ? null : id);
  };

  const renderRuntimeDetails = (agent: RunningAgent) => {
    const introspection = agent.introspection;
    if (!introspection) return null;

    const activeAssets = introspection.assets.filter((asset) => asset.state === 'active');
    const loadedAssets = introspection.assets.filter((asset) => asset.state === 'loaded');
    const configuredAssets = introspection.assets.filter((asset) => asset.state === 'configured');

    return (
      <div className="mt-2 ml-4 border-l-2 border-accent/20 pl-4 py-3 space-y-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted">
            <span>Runtime Status</span>
            <span className={`px-2 py-0.5 rounded border ${STATUS_STYLES[introspection.status]}`}>
              {introspection.status}
            </span>
          </div>
          <p className="text-sm text-text">{introspection.summary}</p>
          <div className="text-[11px] text-muted">
            {[
              introspection.checkedAt ? `Checked ${new Date(introspection.checkedAt).toLocaleString()}` : 'Not checked yet',
              introspection.durationMs != null ? `${introspection.durationMs} ms` : null,
              introspection.cached ? (introspection.stale ? 'cached (stale)' : 'cached') : 'fresh',
              introspection.reachable ? 'reachable' : 'unreachable',
            ].filter(Boolean).join(' · ')}
          </div>
          {introspectionError[agent.id] && (
            <div className="text-xs text-red px-2 py-1 rounded bg-red/10">
              {introspectionError[agent.id]}
            </div>
          )}
        </div>

        <div className="grid grid-cols-4 gap-2">
          {[
            ['Configured', introspection.configuredCount],
            ['Loaded', introspection.loadedCount],
            ['Active Assets', introspection.activeCount],
            ['Active Tools', introspection.activeToolCount],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border bg-bg px-3 py-2">
              <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
              <div className="text-lg font-semibold text-text">{value}</div>
            </div>
          ))}
        </div>

        {!!introspection.details.length && (
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted mb-2">Diagnostics</div>
            <ul className="space-y-1 text-xs text-muted">
              {introspection.details.map((detail, index) => (
                <li key={`${agent.id}-detail-${index}`}>{detail}</li>
              ))}
            </ul>
          </div>
        )}

        {!!introspection.activeTools.length && (
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted mb-2">
              Active Tools ({introspection.activeTools.length})
            </div>
            <div className="space-y-2">
              {introspection.activeTools.map((tool) => (
                <div key={`${agent.id}-tool-${tool.name}`} className="rounded-lg bg-surface border border-border px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-accent">{tool.name}</span>
                    <span className={`px-1.5 py-0.5 rounded border ${
                      tool.state === 'matched' ? 'border-green/40 text-green bg-green/10' : 'border-border text-muted bg-bg'
                    }`}>
                      {tool.state}
                    </span>
                  </div>
                  {tool.description && <div className="text-muted mt-1">{tool.description}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {!!loadedAssets.length && (
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted mb-2">
              Loaded Assets ({loadedAssets.length})
            </div>
            <div className="space-y-2">
              {loadedAssets.map((asset) => (
                <div key={asset.assetId} className="rounded-lg bg-surface border border-border px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-text">{asset.name}</span>
                    <span className="px-1.5 py-0.5 rounded border border-accent/40 text-accent bg-accent/10">{asset.type}</span>
                  </div>
                  <div className="text-muted mt-1">{asset.detail}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!!activeAssets.length && (
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted mb-2">
              Active Assets ({activeAssets.length})
            </div>
            <div className="space-y-2">
              {activeAssets.map((asset) => (
                <div key={asset.assetId} className="rounded-lg bg-surface border border-border px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-text">{asset.name}</span>
                    <span className="px-1.5 py-0.5 rounded border border-green/40 text-green bg-green/10">{asset.type}</span>
                  </div>
                  <div className="text-muted mt-1">{asset.detail}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!!configuredAssets.length && (
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted mb-2">
              File-only Assets ({configuredAssets.length})
            </div>
            <div className="space-y-2">
              {configuredAssets.slice(0, 12).map((asset) => (
                <div key={asset.assetId} className="rounded-lg bg-bg border border-border px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-text">{asset.name}</span>
                    <span className="px-1.5 py-0.5 rounded border border-border text-muted">{asset.type}</span>
                    {asset.projectName && <span className="text-muted">· {asset.projectName}</span>}
                  </div>
                  <div className="text-muted mt-1">{asset.detail}</div>
                </div>
              ))}
              {configuredAssets.length > 12 && (
                <div className="text-[11px] text-muted">
                  Showing 12 of {configuredAssets.length} configured-only assets.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-text">Running Agents</h2>
          <p className="text-xs text-muted mt-1">Inspect running MCP-compatible agents and compare file-only, loaded, and active runtime assets.</p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="px-3 py-1.5 text-xs font-medium bg-accent/15 text-accent border border-accent/30 rounded-lg hover:bg-accent/25 transition-colors"
        >
          + Add Agent
        </button>
      </div>

      {showAdd && (
        <div className="bg-surface border border-border rounded-lg p-4 mb-6 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              placeholder="Name (e.g. OpenCoder Agent)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus:border-accent"
            />
            <input
              placeholder="URL (e.g. http://localhost:8080/mcp)"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              className="bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus:border-accent"
            />
            <input
              placeholder="Description (optional)"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="col-span-2 bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted">Protocol:</span>
            <span className="px-2 py-1 rounded text-xs bg-accent/15 text-accent">MCP</span>
            <span className="text-[11px] text-muted">Runtime introspection currently supports MCP-compatible endpoints.</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={adding || !form.name || !form.url}
              className="px-4 py-2 text-sm font-medium bg-accent text-bg rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-40"
            >
              {adding ? 'Adding...' : 'Add'}
            </button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-muted hover:text-text">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-muted text-center py-12">Loading...</div>
      ) : agents.length === 0 ? (
        <div className="text-center py-16">
          <span className="text-4xl block mb-3">🤖</span>
          <p className="text-muted mb-1">No running agents configured</p>
          <p className="text-xs text-muted max-w-md mx-auto">
            Add locally or remotely running MCP endpoints to inspect which assets are only configured in files and which ones are actually active at runtime.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {agents.map((agent) => {
            const topologyNode = getRunningAgentTopologyNode(topology, agent.id);
            const environmentNode = getRunningAgentEnvironmentNode(topology, agent.id);
            const introspection = agent.introspection;
            const status = introspection?.status || 'unknown';
            const summarySegments = [
              introspection?.activeCount ? `${introspection.activeCount} active assets` : null,
              introspection?.loadedCount ? `${introspection.loadedCount} loaded` : null,
              introspection?.configuredCount ? `${introspection.configuredCount} file-only` : null,
              introspection?.activeToolCount ? `${introspection.activeToolCount} tools` : null,
            ].filter(Boolean);

            return (
              <div key={agent.id}>
                <div className="bg-surface border border-border rounded-lg p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                      status === 'ok' ? 'bg-green' : status === 'warning' ? 'bg-yellow' : status === 'broken' ? 'bg-red' : 'bg-muted'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{agent.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent uppercase">{agent.protocol}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${STATUS_STYLES[status]}`}>
                          {status}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted font-mono">{agent.url}</div>
                      {agent.description && <div className="text-xs text-muted mt-0.5">{agent.description}</div>}
                      {(environmentNode || topologyNode?.badges?.length) && (
                        <div className="text-[11px] text-muted mt-0.5">
                          {environmentNode ? `Runs on ${environmentNode.label}` : ''}
                          {environmentNode && topologyNode?.badges?.length ? ' · ' : ''}
                          {topologyNode?.badges?.join(' · ')}
                        </div>
                      )}
                      {introspection && (
                        <div className="text-[11px] text-muted mt-0.5">
                          {summarySegments.length ? summarySegments.join(' · ') : introspection.summary}
                        </div>
                      )}
                    </div>
                  </div>

                  {introspectionError[agent.id] && (
                    <div className="text-xs text-red mb-2 px-2 py-1 rounded bg-red/10">
                      {introspectionError[agent.id]}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => void handleInspect(agent.id)}
                      disabled={checking[agent.id]}
                      className="px-3 py-1.5 text-xs border border-border text-muted hover:text-text hover:border-accent/50 rounded-lg transition-colors disabled:opacity-40"
                    >
                      {checking[agent.id]
                        ? 'Checking...'
                        : introspection?.checkedAt ? 'Refresh Runtime' : 'Run Introspection'}
                    </button>
                    <button
                      onClick={() => toggleExpanded(agent.id)}
                      className={`px-3 py-1.5 text-xs border rounded-lg transition-colors ${
                        expandedAgent === agent.id
                          ? 'border-accent text-accent'
                          : 'border-border text-muted hover:text-text hover:border-accent/50'
                      }`}
                    >
                      {expandedAgent === agent.id ? 'Hide Details' : 'Show Details'}
                    </button>
                    <button
                      onClick={() => void handleRemove(agent.id)}
                      className="px-3 py-1.5 text-xs border border-border text-muted hover:border-red hover:text-red rounded-lg transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {expandedAgent === agent.id && renderRuntimeDetails(agentsById.get(agent.id) || agent)}
              </div>
            );
          })}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] bg-surface border border-green rounded-lg px-5 py-2.5 text-green text-[13px] shadow-[0_4px_16px_rgba(0,0,0,.3)]">
          {toast}
        </div>
      )}
    </div>
  );
}
