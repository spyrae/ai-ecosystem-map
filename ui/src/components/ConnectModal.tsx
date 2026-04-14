import { useEffect, useState, useCallback } from 'react';
import type { Asset, ConnectionInfo, Provider } from '../types';
import { CAPABILITY_STATE_LABELS, PROVIDER_LABELS } from '../types';
import { fetchConnections, connectAsset, disconnectAsset } from '../lib/api';

interface ConnectModalProps {
  asset: Asset | null;
  onClose: () => void;
  readOnly?: boolean;
}

type ConnectionState = Record<string, ConnectionInfo & { loading?: boolean }>;

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

export function ConnectModal({ asset, onClose, readOnly = false }: ConnectModalProps) {
  const [connections, setConnections] = useState<ConnectionState>({});
  const [toast, setToast] = useState<string | null>(null);
  const hasLoadedConnections = Object.keys(connections).length > 0;

  const loadConnections = useCallback(async () => {
    if (!asset) return;
    try {
      const data = await fetchConnections(asset.id, asset.type);
      setConnections(data);
    } catch (err) {
      console.error('Failed to load connections:', err);
    }
  }, [asset]);

  useEffect(() => {
    if (!asset) return;

    let cancelled = false;

    const run = async () => {
      try {
        const data = await fetchConnections(asset.id, asset.type);
        if (!cancelled) setConnections(data);
      } catch (err) {
        console.error('Failed to load connections:', err);
      }
    };

    void run();
    return () => { cancelled = true; };
  }, [asset]);

  if (!asset) return null;

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleToggle = async (tool: string) => {
    const conn = connections[tool];
    if (!conn || conn.loading || conn.isSource) return;

    setConnections((prev) => ({ ...prev, [tool]: { ...prev[tool], loading: true } }));

    try {
      if (conn.connected) {
        await disconnectAsset(asset.id, tool, asset.type);
        showToast(`Disconnected ${asset.name} from ${PROVIDER_LABELS[tool as Provider] || tool}`);
      } else {
        await connectAsset(asset.id, tool, asset.type);
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

          {readOnly && (
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-300">
              Global read-only audit mode is enabled. Connection changes are disabled.
            </div>
          )}

          {/* Tool list */}
          <div className="space-y-1.5">
            {!hasLoadedConnections && (
              <div className="rounded-lg border border-border bg-bg px-3 py-3 text-[13px] text-muted">
                Loading provider targets...
              </div>
            )}
            {hasLoadedConnections && (
              <>
            {TOOL_ORDER.map((tool) => {
              const conn = connections[tool] ?? { tool, connected: false, installed: false, supported: false };
              const capability = asset.capabilities?.providers.find((entry) => entry.provider === tool);
              const isSource = conn.isSource === true;
              const isUnavailable = isSource || conn.supported === false || conn.installed === false || capability?.state === 'invalid';
              const buttonLabel = isSource
                ? 'Source'
                : capability?.state === 'invalid'
                  ? CAPABILITY_STATE_LABELS.invalid
                  : conn.installed === false
                    ? 'Missing'
                    : conn.supported === false
                      ? 'Unsupported'
                      : conn.connected
                        ? 'Disconnect'
                        : 'Connect';
              const detail = isSource
                ? 'Source (original file)'
                : conn.connected
                  ? `Connected via ${conn.isSymlink ? 'symlink' : 'copy'}`
                  : capability?.detail || (conn.installed === false
                    ? 'Provider is not installed on this machine'
                    : conn.supported === false
                      ? 'This provider does not support the asset in this context'
                      : 'Not connected');

              const stateLabel = capability ? CAPABILITY_STATE_LABELS[capability.state] : null;

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
                      <div className="text-[11px] text-muted">{detail}</div>
                      {stateLabel && <div className="text-[10px] mt-1 text-muted uppercase tracking-wider">{stateLabel}</div>}
                    </div>
                  </div>

                  {isSource ? (
                    <span className="px-3.5 py-1.5 rounded-md border border-accent/30 text-accent text-xs font-medium">
                      Source
                    </span>
                  ) : (
                    <button
                      onClick={() => handleToggle(tool)}
                      disabled={readOnly || conn.loading || isUnavailable}
                      className={`px-3.5 py-1.5 rounded-md border text-xs font-medium transition-all ${
                        conn.connected
                          ? 'border-green text-green hover:border-red hover:text-red'
                          : isUnavailable
                            ? 'border-border text-muted'
                            : 'border-border text-text hover:border-accent hover:text-accent'
                      } ${conn.loading || isUnavailable ? 'opacity-40 cursor-default' : ''}`}
                    >
                      {conn.loading ? '...' : buttonLabel}
                    </button>
                  )}
                </div>
              );
            })}
              </>
            )}
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
