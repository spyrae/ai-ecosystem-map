import { useEffect, useState, useCallback } from 'react';
import type { Asset, Provider } from '../types';
import { PROVIDER_LABELS } from '../types';
import { fetchConnections, connectAsset, disconnectAsset } from '../lib/api';

interface ConnectModalProps {
  asset: Asset | null;
  onClose: () => void;
}

type ConnectionState = Record<string, { connected: boolean; method?: string; loading?: boolean }>;

const PROVIDER_COLORS: Record<string, string> = {
  claude: '#f0883e',
  codex: '#3fb950',
  gemini: '#79c0ff',
  cursor: '#d2a8ff',
  windsurf: '#58a6ff',
  copilot: '#8b949e',
  continue_dev: '#f85149',
};

const TOOL_ORDER: Provider[] = ['claude', 'codex', 'gemini', 'cursor', 'windsurf', 'copilot', 'continue_dev'];

export function ConnectModal({ asset, onClose }: ConnectModalProps) {
  const [connections, setConnections] = useState<ConnectionState>({});
  const [toast, setToast] = useState<string | null>(null);

  const loadConnections = useCallback(async () => {
    if (!asset) return;
    try {
      const data = await fetchConnections(asset.name, asset.type);
      setConnections(data);
    } catch (err) {
      console.error('Failed to load connections:', err);
    }
  }, [asset]);

  useEffect(() => {
    if (asset) loadConnections();
  }, [asset, loadConnections]);

  if (!asset) return null;

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleToggle = async (tool: string) => {
    const conn = connections[tool];
    if (!conn || conn.loading) return;

    setConnections((prev) => ({ ...prev, [tool]: { ...prev[tool], loading: true } }));

    try {
      if (conn.connected) {
        await disconnectAsset(asset.name, tool, asset.type);
        showToast(`Disconnected ${asset.name} from ${PROVIDER_LABELS[tool as Provider] || tool}`);
      } else {
        await connectAsset(asset.name, tool, asset.type);
        showToast(`Connected ${asset.name} to ${PROVIDER_LABELS[tool as Provider] || tool}`);
      }
      await loadConnections();
    } catch (err) {
      console.error('Connect/disconnect error:', err);
      showToast('Error: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="animate-fade-in fixed inset-0 z-[200] bg-black/60 flex items-center justify-center"
        onClick={onClose}
      >
        {/* Panel */}
        <div
          className="bg-surface border border-border rounded-2xl p-6 w-[400px] max-w-[90vw] shadow-[0_16px_48px_rgba(0,0,0,.5)]"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="text-base font-semibold">
            Connect <span className="text-accent font-mono">/{asset.name}</span>
          </h3>
          <p className="text-[13px] text-muted mb-4">
            Choose which tools should have access to this {asset.type}
          </p>

          {/* Tool list */}
          <div className="space-y-1.5">
            {TOOL_ORDER.map((tool) => {
              const conn = connections[tool];
              if (!conn) return null; // tool not installed

              return (
                <div
                  key={tool}
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-bg"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                      style={{ backgroundColor: PROVIDER_COLORS[tool] + '30', color: PROVIDER_COLORS[tool] }}
                    >
                      {(PROVIDER_LABELS[tool] || tool).charAt(0)}
                    </div>
                    <div>
                      <div className="text-sm font-medium">{PROVIDER_LABELS[tool] || tool}</div>
                      <div className="text-[11px] text-muted">
                        {conn.connected ? `Connected via ${conn.method || 'symlink'}` : 'Not connected'}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleToggle(tool)}
                    disabled={conn.loading}
                    className={`px-3.5 py-1.5 rounded-md border text-xs font-medium transition-all ${
                      conn.connected
                        ? 'border-green text-green hover:border-red hover:text-red'
                        : 'border-border text-text hover:border-accent hover:text-accent'
                    } ${conn.loading ? 'opacity-40 cursor-default' : ''}`}
                  >
                    {conn.loading ? '...' : conn.connected ? 'Connected' : 'Connect'}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-4 text-center">
            <button onClick={onClose} className="text-[13px] text-muted hover:text-text">
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] bg-surface border border-green rounded-lg px-5 py-2.5 text-green text-[13px] shadow-[0_4px_16px_rgba(0,0,0,.3)]">
          {toast}
        </div>
      )}
    </>
  );
}
