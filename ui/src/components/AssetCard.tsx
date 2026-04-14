import { useDraggable } from '@dnd-kit/core';
import type { Asset } from '../types';
import { assetCanConnect } from '../types';

const TYPE_INLINE: Record<string, { bg: string; text: string; border: string }> = {
  skill:       { bg: '#0d3320', text: '#34d399', border: '#155e3b' },
  agent:       { bg: '#2a1754', text: '#a78bfa', border: '#3b1f7a' },
  mcp:         { bg: '#3b1a0a', text: '#fb923c', border: '#5c2a10' },
  instruction: { bg: '#083344', text: '#22d3ee', border: '#0e4d5e' },
  rule:        { bg: '#0d3330', text: '#2dd4bf', border: '#155e55' },
};

const PROVIDER_COLORS: Record<string, string> = {
  claude: '#fbbf24',
  codex: '#34d399',
  gemini: '#38bdf8',
  cursor: '#a78bfa',
  windsurf: '#60a5fa',
  copilot: '#a1a1aa',
  continue_dev: '#fb923c',
};

const PROVIDER_SHORT: Record<string, string> = {
  claude: 'Claude', codex: 'Codex', gemini: 'Gemini', cursor: 'Cursor',
  windsurf: 'Windsurf', copilot: 'Copilot', continue_dev: 'Continue',
};

function ProviderText({ provider }: { provider: string }) {
  return (
    <span className="text-[10px] font-medium" style={{ color: PROVIDER_COLORS[provider] || '#a1a1aa' }}>
      {PROVIDER_SHORT[provider] || provider}
    </span>
  );
}

interface AssetCardProps {
  asset: Asset;
  usedBy?: string[];
  onConnect?: (asset: Asset) => void;
  onNavigate?: (name: string) => void;
  onClick?: (asset: Asset) => void;
  highlight?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelection?: (asset: Asset) => void;
}

export function AssetCard({
  asset,
  onConnect,
  onClick,
  highlight,
  selectionMode = false,
  selected = false,
  onToggleSelection,
}: AssetCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `asset-${asset.id}`,
    data: { asset },
    disabled: selectionMode,
  });

  const typeInline = asset.isOrchestrator
    ? TYPE_INLINE.agent
    : TYPE_INLINE[asset.type] || TYPE_INLINE.skill;
  const badgeLabel = asset.isOrchestrator ? 'orchestrator' : asset.type;

  return (
    <div
      ref={setNodeRef}
      {...(selectionMode ? {} : listeners)}
      {...(selectionMode ? {} : attributes)}
      id={`card-${asset.name}`}
      onClick={() => {
        if (selectionMode) onToggleSelection?.(asset);
        else onClick?.(asset);
      }}
      className={`card-glow group relative flex h-[200px] cursor-pointer flex-col rounded-xl border border-[hsl(240,5%,16%)] p-4 transition-all ${
        asset.isOrchestrator ? 'border-l-2 border-l-[hsl(263,70%,58%)]' : ''
      } ${highlight ? 'shadow-[0_0_0_1px_rgba(59,130,246,0.3)]' : ''} ${isDragging ? 'opacity-30' : ''} ${
        selected ? 'ring-2 ring-accent/70 border-accent/60' : ''
      }`}
      style={{
        backgroundImage: 'linear-gradient(180deg, hsl(240 5% 9%) 0%, hsl(240 5% 7.5%) 100%)',
        boxShadow: highlight
          ? '0 0 0 1px rgba(59,130,246,0.3), inset 0 1px 0 0 rgba(255,255,255,0.03)'
          : 'inset 0 1px 0 0 rgba(255,255,255,0.03)',
      }}
    >
      {selectionMode && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSelection?.(asset); }}
          className={`absolute left-3 top-3 flex h-7 w-7 items-center justify-center rounded-full border transition-colors ${
            selected ? 'border-accent bg-accent/15 text-accent' : 'border-border bg-transparent text-muted hover:border-accent/50 hover:text-text'
          }`}
          aria-label={selected ? `Deselect ${asset.name}` : `Select ${asset.name}`}
        >
          {selected ? '✓' : ''}
        </button>
      )}

      {/* Connect button — appears on hover */}
      {onConnect && assetCanConnect(asset) && !selectionMode && (
        <button
          onClick={(e) => { e.stopPropagation(); onConnect(asset); }}
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-transparent opacity-0 transition-all hover:bg-[hsl(240,4%,13%)] group-hover:opacity-100"
        >
          <svg className="h-3.5 w-3.5 text-[hsl(240,5%,65%)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      )}

      {/* Header: name + type badge */}
      <div className={`flex items-start gap-2 ${selectionMode ? 'pl-10' : 'pr-8'}`}>
        <span className="min-w-0 truncate font-mono text-sm font-medium text-[hsl(217,91%,60%)]">/{asset.name}</span>
        <span
          className="shrink-0 inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider"
          style={{ backgroundColor: typeInline.bg, color: typeInline.text, borderWidth: '1px', borderColor: typeInline.border }}
        >
          {badgeLabel}
        </span>
      </div>

      {/* Description — fills available space */}
      {asset.desc && (
        <p className="mt-2 flex-1 overflow-hidden text-[12px] leading-relaxed text-[hsl(240,5%,40%)]">
          <span className="line-clamp-4">{asset.desc}</span>
        </p>
      )}
      {!asset.desc && <div className="flex-1" />}

      {/* Connected to — providers at bottom */}
      {asset.providers.length > 0 && (
        <div className="mt-auto pt-3">
          <div className="text-[10px] font-medium text-muted mb-1">Connected to</div>
          <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
            {asset.providers.map((p) => (
              <ProviderText key={p} provider={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
