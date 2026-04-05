import { DragOverlay as DndDragOverlay } from '@dnd-kit/core';
import type { Asset } from '../types';

interface Props {
  activeAsset: Asset | null;
}

export function DragOverlay({ activeAsset }: Props) {
  if (!activeAsset) return null;

  return (
    <DndDragOverlay dropAnimation={null}>
      <div
        className="w-72 rounded-xl border border-accent/30 p-4 pointer-events-none"
        style={{
          backgroundImage: 'linear-gradient(180deg, hsl(240 5% 9%) 0%, hsl(240 5% 7.5%) 100%)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.3)',
          opacity: 0.8,
        }}
      >
        <span className="font-mono text-sm font-medium text-[hsl(217,91%,60%)]">
          /{activeAsset.name}
        </span>
        <span className="ml-2 text-xs text-muted">{activeAsset.type}</span>
        {activeAsset.desc && (
          <p className="mt-1.5 line-clamp-1 text-[12px] text-[hsl(240,5%,40%)]">
            {activeAsset.desc}
          </p>
        )}
      </div>
    </DndDragOverlay>
  );
}
