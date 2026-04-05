import { useDraggable } from '@dnd-kit/core';
import type { Asset } from '../types';
import { ProviderBadge } from './ProviderBadge';

// Solid colors for type badges — no opacity tricks
const TYPE_INLINE: Record<string, { bg: string; text: string; border: string }> = {
  skill:       { bg: '#0d3320', text: '#34d399', border: '#155e3b' },
  agent:       { bg: '#2a1754', text: '#a78bfa', border: '#3b1f7a' },
  mcp:         { bg: '#3b1a0a', text: '#fb923c', border: '#5c2a10' },
  instruction: { bg: '#083344', text: '#22d3ee', border: '#0e4d5e' },
  rule:        { bg: '#0d3330', text: '#2dd4bf', border: '#155e55' },
};

interface AssetCardProps {
  asset: Asset;
  usedBy?: string[];
  onConnect?: (asset: Asset) => void;
  onNavigate?: (name: string) => void;
  onClick?: (asset: Asset) => void;
  highlight?: boolean;
}

export function AssetCard({ asset, usedBy = [], onConnect, onNavigate, onClick, highlight }: AssetCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `asset-${asset.type}-${asset.name}`,
    data: { asset },
  });

  const typeInline = asset.isOrchestrator
    ? TYPE_INLINE.agent
    : TYPE_INLINE[asset.type] || TYPE_INLINE.skill;
  const badgeLabel = asset.isOrchestrator ? 'orchestrator' : asset.type;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      id={`card-${asset.name}`}
      onClick={() => onClick?.(asset)}
      className={`card-glow group relative cursor-pointer rounded-xl border border-[hsl(240,5%,16%)] p-5 transition-all ${
        asset.isOrchestrator ? 'border-l-2 border-l-[hsl(263,70%,58%)]' : ''
      } ${highlight ? 'shadow-[0_0_0_1px_rgba(59,130,246,0.3)]' : ''} ${isDragging ? 'opacity-30' : ''}`}
      style={{
        backgroundImage: 'linear-gradient(180deg, hsl(240 5% 9%) 0%, hsl(240 5% 7.5%) 100%)',
        boxShadow: highlight
          ? '0 0 0 1px rgba(59,130,246,0.3), inset 0 1px 0 0 rgba(255,255,255,0.03)'
          : 'inset 0 1px 0 0 rgba(255,255,255,0.03)',
      }}
    >
      {/* Connect button — appears on hover */}
      {onConnect && (
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
      <div className="flex items-start justify-between pr-8">
        <span className="font-mono text-sm font-medium text-[hsl(217,91%,60%)]">
          /{asset.name}
        </span>
        <span
          className="inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider"
          style={{ backgroundColor: typeInline.bg, color: typeInline.text, borderWidth: '1px', borderColor: typeInline.border }}
        >
          {badgeLabel}
        </span>
      </div>

      {/* Description */}
      {asset.desc && (
        <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-[hsl(240,5%,40%)]">{asset.desc}</p>
      )}

      {/* Tags */}
      {asset.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {asset.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="rounded-full px-2.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: '#252530', color: '#b0b0be' }}>
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Deps — uses */}
      {asset.deps.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(240,5%,40%)] mb-1.5">Uses</div>
          <div className="flex flex-wrap gap-1">
            {asset.deps.map((dep) => (
              <button
                key={dep}
                onClick={(e) => { e.stopPropagation(); onNavigate?.(dep); }}
                className="text-[11px] text-violet font-mono hover:underline"
              >
                {dep}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Used by */}
      {usedBy.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-pink mb-1.5">Used by</div>
          <div className="flex flex-wrap gap-1">
            {usedBy.map((name) => (
              <button
                key={name}
                onClick={(e) => { e.stopPropagation(); onNavigate?.(name); }}
                className="text-[11px] text-pink font-mono hover:underline"
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Providers */}
      {asset.providers.length > 0 && (
        <div className="mt-3 flex gap-1.5">
          {asset.providers.map((p) => (
            <ProviderBadge key={p} provider={p} />
          ))}
        </div>
      )}
    </div>
  );
}
