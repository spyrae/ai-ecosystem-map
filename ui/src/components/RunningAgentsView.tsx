import { useEffect, useState } from 'react';
import type { RunningAgent, McpTool, TopologyGraph } from '../types';
import { fetchRunningAgents, fetchTopology, addRunningAgent, removeRunningAgent, listAgentTools } from '../lib/api';
import { getRunningAgentEnvironmentNode, getRunningAgentTopologyNode } from '../lib/topology';

export function RunningAgentsView() {
  const [agents, setAgents] = useState<RunningAgent[]>([]);
  const [topology, setTopology] = useState<TopologyGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', url: '', description: '', protocol: 'mcp' });
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Tools per agent
  const [agentTools, setAgentTools] = useState<Record<string, McpTool[]>>({});
  const [loadingTools, setLoadingTools] = useState<Record<string, boolean>>({});
  const [toolsError, setToolsError] = useState<Record<string, string>>({});
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

  useEffect(() => { loadAgents(); }, []);

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

  const handleListTools = async (id: string) => {
    if (expandedAgent === id && agentTools[id]?.length) {
      setExpandedAgent(null);
      return;
    }
    setExpandedAgent(id);
    setLoadingTools((p) => ({ ...p, [id]: true }));
    setToolsError((p) => ({ ...p, [id]: '' }));
    try {
      const res = await listAgentTools(id);
      if (res.ok && res.tools) {
        setAgentTools((p) => ({ ...p, [id]: res.tools! }));
        showToast(`Connected: ${res.tools.length} tools found`);
      } else {
        setToolsError((p) => ({ ...p, [id]: res.error || 'Failed' }));
      }
    } catch (err) {
      setToolsError((p) => ({ ...p, [id]: err instanceof Error ? err.message : 'Error' }));
    } finally {
      setLoadingTools((p) => ({ ...p, [id]: false }));
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-text">Running Agents</h2>
          <p className="text-xs text-muted mt-1">Connect to locally or remotely running AI agents via MCP protocol</p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="px-3 py-1.5 text-xs font-medium bg-accent/15 text-accent border border-accent/30 rounded-lg hover:bg-accent/25 transition-colors"
        >
          + Add Agent
        </button>
      </div>

      {/* Add form */}
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
            <span className="text-[11px] text-muted">HTTP MCP endpoint or compatible remote agent</span>
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
            Add agents running locally (e.g. <code className="text-accent">http://localhost:8080</code>) or remotely.
            Supports MCP protocol — connect to see available tools.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {agents.map((agent) => {
            const topologyNode = getRunningAgentTopologyNode(topology, agent.id);
            const environmentNode = getRunningAgentEnvironmentNode(topology, agent.id);
            return (
            <div key={agent.id}>
              <div className="bg-surface border border-border rounded-lg p-4">
                <div className="flex items-center gap-3 mb-2">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    agentTools[agent.id]?.length ? 'bg-green' : 'bg-muted'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{agent.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple/15 text-purple uppercase">{agent.protocol}</span>
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
                  </div>
                  {agentTools[agent.id] && (
                    <span className="text-xs text-green">{agentTools[agent.id].length} tools</span>
                  )}
                </div>

                {toolsError[agent.id] && (
                  <div className="text-xs text-red mb-2 px-2 py-1 rounded bg-red/10">
                    {toolsError[agent.id]}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => handleListTools(agent.id)}
                    disabled={loadingTools[agent.id]}
                    className={`px-3 py-1.5 text-xs border rounded-lg transition-colors ${
                      expandedAgent === agent.id
                        ? 'border-green text-green'
                        : 'border-border text-muted hover:text-text hover:border-accent/50'
                    } disabled:opacity-40`}
                  >
                    {loadingTools[agent.id] ? '⏳ Connecting...' : '🔌 List Tools'}
                  </button>
                  <button
                    onClick={() => handleRemove(agent.id)}
                    className="px-3 py-1.5 text-xs border border-border text-muted hover:border-red hover:text-red rounded-lg transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>

              {/* Tools list */}
              {expandedAgent === agent.id && agentTools[agent.id]?.length > 0 && (
                <div className="mt-1 ml-4 border-l-2 border-green/30 pl-4 py-2 space-y-1">
                  <div className="text-[11px] text-muted uppercase tracking-wider mb-2">
                    Available Tools ({agentTools[agent.id].length})
                  </div>
                  {agentTools[agent.id].map((tool) => (
                    <div key={tool.name} className="px-3 py-2 rounded-lg bg-surface text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-green font-medium">{tool.name}</span>
                      </div>
                      {tool.description && (
                        <div className="text-muted mt-0.5 line-clamp-2">{tool.description}</div>
                      )}
                    </div>
                  ))}
                </div>
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
    </div>
  );
}
