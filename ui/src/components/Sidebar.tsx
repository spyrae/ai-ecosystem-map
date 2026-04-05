import { useDroppable } from '@dnd-kit/core';
import type { AssetType, Provider } from '../types';
import { TYPE_LABELS, PROVIDER_LABELS } from '../types';

interface SidebarProps {
  categories: Record<string, number>;
  activeType: AssetType | null;
  activeProvider: Provider | null;
  activeCategory: string | null;
  onTypeChange: (type: AssetType | null) => void;
  onProviderChange: (provider: Provider | null) => void;
  onCategoryChange: (category: string | null) => void;
}

const allTypes: AssetType[] = ['skill', 'agent', 'mcp', 'rule', 'instruction'];
const allProviders: Provider[] = ['claude', 'codex', 'gemini', 'cursor', 'windsurf', 'copilot', 'continue_dev'];

function DroppableProviderButton({
  provider,
  label,
  isSelected,
  onToggle,
}: {
  provider: string;
  label: string;
  isSelected: boolean;
  onToggle: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `provider-${provider}`,
    data: { provider },
  });

  return (
    <button
      ref={setNodeRef}
      onClick={onToggle}
      className={`rounded-md px-2.5 py-1.5 text-left text-xs font-medium capitalize transition-colors ${
        isOver
          ? 'bg-accent/20 text-accent ring-1 ring-accent/40'
          : isSelected
            ? 'bg-accent/10 text-accent'
            : 'text-accent-fg hover:bg-[hsl(240,4%,13%)]'
      }`}
    >
      {label}
    </button>
  );
}

function FilterSection({ title, items, selected, onToggle, labels }: {
  title: string;
  items: string[];
  selected: string | null;
  onToggle: (v: string) => void;
  labels?: Record<string, string>;
}) {
  return (
    <div className="mb-4">
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h4>
      <div className="flex flex-col gap-1">
        {items.map((item) => (
          <button
            key={item}
            onClick={() => onToggle(item)}
            className={`rounded-md px-2.5 py-1.5 text-left text-xs font-medium capitalize transition-colors ${
              selected === item
                ? 'bg-accent/10 text-accent'
                : 'text-accent-fg hover:bg-[hsl(240,4%,13%)]'
            }`}
          >
            {labels?.[item] || item}
          </button>
        ))}
      </div>
    </div>
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
}: SidebarProps) {
  return (
    <aside className="w-52 shrink-0 overflow-y-auto border-r border-border p-4">
      <FilterSection
        title="Type"
        items={allTypes}
        selected={activeType}
        onToggle={(v) => onTypeChange(activeType === v ? null : v as AssetType)}
        labels={TYPE_LABELS}
      />
      <div className="mb-4">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Provider</h4>
        <div className="flex flex-col gap-1">
          {allProviders.map((p) => (
            <DroppableProviderButton
              key={p}
              provider={p}
              label={PROVIDER_LABELS[p]}
              isSelected={activeProvider === p}
              onToggle={() => onProviderChange(activeProvider === p ? null : p)}
            />
          ))}
        </div>
      </div>
      <FilterSection
        title="Category"
        items={Object.entries(categories).sort(([, a], [, b]) => b - a).map(([cat]) => cat)}
        selected={activeCategory}
        onToggle={(v) => onCategoryChange(activeCategory === v ? null : v)}
      />
    </aside>
  );
}
