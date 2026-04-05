import { useEffect, useRef, useState } from 'react';
import type { Stats } from '../types';

function AnimatedNumber({ value, duration = 600 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const prevRef = useRef(0);

  useEffect(() => {
    const from = prevRef.current;
    const to = value;
    if (from === to) return;

    const start = performance.now();
    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (progress < 1) requestAnimationFrame(tick);
      else prevRef.current = to;
    }
    requestAnimationFrame(tick);
  }, [value, duration]);

  return <>{display}</>;
}

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
          <span className={`text-lg font-semibold tabular-nums ${item.color}`}>
            <AnimatedNumber value={item.value} />
          </span>
          <span className="text-xs text-muted">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
