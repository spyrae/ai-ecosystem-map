import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { AssetHealthStatus, AssetType, DriftStatus, Provider } from '../types';
import { TYPE_LABELS, PROVIDER_LABELS } from '../types';

export interface SidebarHidden {
  types: string[];
  providers: Provider[];
  categories: string[];
}

interface SidebarProps {
  categories: Record<string, number>;
  healthCounts: Record<AssetHealthStatus, number>;
  driftCounts: Record<DriftStatus, number>;
  dependencyCounts: Record<'orphaned', number>;
  activeType: AssetType | null;
  activeProvider: Provider | null;
  activeCategory: string | null;
  activeHealth: AssetHealthStatus | null;
  activeDrift: DriftStatus | null;
  activeDependency: 'orphaned' | null;
  onTypeChange: (type: AssetType | null) => void;
  onProviderChange: (provider: Provider | null) => void;
  onCategoryChange: (category: string | null) => void;
  onHealthChange: (health: AssetHealthStatus | null) => void;
  onDriftChange: (status: DriftStatus | null) => void;
  onDependencyChange: (status: 'orphaned' | null) => void;
  hiddenProviders: Provider[];
  onHiddenProvidersChange: (hidden: Provider[]) => void;
  hidden: SidebarHidden;
  onHiddenChange: (hidden: SidebarHidden) => void;
}

const allTypes: AssetType[] = ['skill', 'agent', 'mcp', 'rule'];
const allProviders: Provider[] = ['claude', 'codex', 'gemini', 'cursor', 'windsurf', 'copilot', 'continue_dev'];

const GearIcon = () => (
  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

function CheckboxItem({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
        checked ? 'text-accent-fg hover:bg-[hsl(240,4%,13%)]' : 'text-muted line-through opacity-50 hover:opacity-75'
      }`}
    >
      <span className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border text-[9px] ${
        checked ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border'
      }`}>
        {checked && '✓'}
      </span>
      {label}
    </button>
  );
}

function DroppableProviderButton({ provider, label, isSelected, onToggle }: {
  provider: string; label: string; isSelected: boolean; onToggle: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `provider-${provider}`, data: { provider } });
  return (
    <button
      ref={setNodeRef}
      onClick={onToggle}
      className={`rounded-md px-2.5 py-1.5 text-left text-xs font-medium capitalize transition-colors ${
        isOver ? 'bg-accent/20 text-accent ring-1 ring-accent/40'
          : isSelected ? 'bg-accent/10 text-accent'
          : 'text-accent-fg hover:bg-[hsl(240,4%,13%)]'
      }`}
    >
      {label}
    </button>
  );
}

export function Sidebar({
  categories,
  activeType,
  activeProvider,
  activeCategory,
  onTypeChange,
  onProviderChange,
  onCategoryChange,
  hidden,
  onHiddenChange,
}: SidebarProps) {
  const [configMode, setConfigMode] = useState(false);

  const toggleHidden = (section: keyof SidebarHidden, item: string) => {
    const list = hidden[section] as string[];
    const next = list.includes(item) ? list.filter((i) => i !== item) : [...list, item];
    onHiddenChange({ ...hidden, [section]: next });
    // Clear active filter if hiding the currently selected item
    if (next.includes(item)) {
      if (section === 'types' && activeType === item) onTypeChange(null);
      if (section === 'providers' && activeProvider === item) onProviderChange(null);
      if (section === 'categories' && activeCategory === item) onCategoryChange(null);
    }
  };

  const visibleTypes = allTypes.filter((t) => !hidden.types.includes(t));
  const visibleProviders = allProviders.filter((p) => !hidden.providers.includes(p));
  const categoryList = Object.entries(categories).sort(([, a], [, b]) => b - a).map(([cat]) => cat);
  const visibleCategories = categoryList.filter((c) => !hidden.categories.includes(c));

  return (
    <aside className="w-52 shrink-0 overflow-y-auto border-r border-border p-4">
      {/* Config toggle */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Filters</h3>
        <button
          onClick={() => setConfigMode(!configMode)}
          className={`rounded p-1 transition-colors ${configMode ? 'bg-accent/10 text-accent' : 'text-muted hover:text-accent-fg'}`}
          title={configMode ? 'Done configuring' : 'Configure visible filters'}
        >
          <GearIcon />
        </button>
      </div>

      {/* Type */}
      <div className="mb-4">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Type</h4>
        <div className="flex flex-col gap-1">
          {configMode ? (
            allTypes.map((t) => (
              <CheckboxItem
                key={t}
                label={TYPE_LABELS[t]}
                checked={!hidden.types.includes(t)}
                onToggle={() => toggleHidden('types', t)}
              />
            ))
          ) : (
            visibleTypes.map((t) => (
              <button
                key={t}
                onClick={() => onTypeChange(activeType === t ? null : t)}
                className={`rounded-md px-2.5 py-1.5 text-left text-xs font-medium capitalize transition-colors ${
                  activeType === t ? 'bg-accent/10 text-accent' : 'text-accent-fg hover:bg-[hsl(240,4%,13%)]'
                }`}
              >
                {TYPE_LABELS[t]}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Provider */}
      <div className="mb-4">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Provider</h4>
        <div className="flex flex-col gap-1">
          {configMode ? (
            allProviders.map((p) => (
              <CheckboxItem
                key={p}
                label={PROVIDER_LABELS[p]}
                checked={!hidden.providers.includes(p)}
                onToggle={() => toggleHidden('providers', p)}
              />
            ))
          ) : (
            visibleProviders.map((p) => (
              <DroppableProviderButton
                key={p}
                provider={p}
                label={PROVIDER_LABELS[p]}
                isSelected={activeProvider === p}
                onToggle={() => onProviderChange(activeProvider === p ? null : p)}
              />
            ))
          )}
        </div>
      </div>

      {/* Category */}
      {categoryList.length > 0 && (
        <div className="mb-4">
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Category</h4>
          <div className="flex flex-col gap-1">
            {configMode ? (
              categoryList.map((c) => (
                <CheckboxItem
                  key={c}
                  label={c}
                  checked={!hidden.categories.includes(c)}
                  onToggle={() => toggleHidden('categories', c)}
                />
              ))
            ) : (
              visibleCategories.map((c) => (
                <button
                  key={c}
                  onClick={() => onCategoryChange(activeCategory === c ? null : c)}
                  className={`rounded-md px-2.5 py-1.5 text-left text-xs font-medium capitalize transition-colors ${
                    activeCategory === c ? 'bg-accent/10 text-accent' : 'text-accent-fg hover:bg-[hsl(240,4%,13%)]'
                  }`}
                >
                  {c}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
