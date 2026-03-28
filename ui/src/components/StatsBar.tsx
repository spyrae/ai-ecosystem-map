import type { Stats } from '../types';

interface StatsBarProps {
  stats: Stats | null;
}

export function StatsBar({ stats }: StatsBarProps) {
  if (!stats) return null;

  const items = [
    { label: 'Total', value: stats.total, color: 'text-text' },
    { label: 'Skills', value: stats.skill || 0, color: 'text-emerald-400' },
    { label: 'Agents', value: stats.agent || 0, color: 'text-violet-400' },
    { label: 'MCP Servers', value: stats.mcp || 0, color: 'text-orange-400' },
    { label: 'Orchestrators', value: stats.orchestrator || 0, color: 'text-amber-400' },
  ];

  return (
    <div className="flex gap-6 border-b border-border px-6 py-3 shrink-0">
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline gap-2">
          <span className={`text-lg font-semibold ${item.color}`}>{item.value}</span>
          <span className="text-xs text-muted">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
