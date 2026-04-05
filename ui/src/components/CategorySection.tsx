import { useState } from 'react';
import type { Asset } from '../types';
import { AssetCard } from './AssetCard';

const CAT_COLORS: Record<string, string> = {
  'Orchestrators': 'text-violet-400',
  'Project Management': 'text-blue-400',
  'Development': 'text-emerald-400',
  'Code Quality': 'text-sky-400',
  'Security & QA': 'text-red-400',
  'DevOps & Infra': 'text-orange-400',
  'Content & Writing': 'text-amber-400',
  'SEO & GEO': 'text-lime-400',
  'UX & Design': 'text-violet-400',
  'Research & Intel': 'text-cyan-400',
  'GSD System': 'text-sky-400',
  'Agents': 'text-violet-400',
  'MCP Servers': 'text-orange-400',
  'Instructions': 'text-cyan-400',
  'Rules': 'text-teal-400',
  'Other': 'text-zinc-400',
};

interface CategorySectionProps {
  category: string;
  assets: Asset[];
  usedByMap: Record<string, string[]>;
  onConnect?: (asset: Asset) => void;
  onNavigate?: (name: string) => void;
  onAssetClick?: (asset: Asset) => void;
  highlightName?: string | null;
}

export function CategorySection({ category, assets, usedByMap, onConnect, onNavigate, onAssetClick, highlightName }: CategorySectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  const colorClass = CAT_COLORS[category] || 'text-zinc-400';

  return (
    <section id={`cat-${category.replace(/\s+/g, '-').toLowerCase()}`} className="mb-6">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="mb-3 flex items-center gap-2 w-full text-left"
      >
        {collapsed ? (
          <svg className="h-4 w-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        ) : (
          <svg className="h-4 w-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
        <span className={`text-sm font-semibold ${colorClass}`}>{category}</span>
        <span className="text-xs text-muted">({assets.length})</span>
        <div className="ml-2 h-px flex-1 bg-border" />
      </button>

      {!collapsed && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {assets.map((asset, i) => (
            <div
              key={`${asset.type}-${asset.name}`}
              className="animate-fade-in-up"
              style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
            >
              <AssetCard
                asset={asset}
                usedBy={usedByMap[asset.name] || []}
                onConnect={onConnect}
                onNavigate={onNavigate}
                onClick={onAssetClick}
                highlight={highlightName === asset.name}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
