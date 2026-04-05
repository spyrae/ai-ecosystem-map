import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import type { Asset, AssetType, Provider, Stats } from './types';
import { fetchAssets, fetchStats, fetchCategories, rescan, connectAsset } from './lib/api';
import * as ws from './lib/ws';
import { SearchBar, type SearchBarHandle } from './components/SearchBar';
import { Sidebar } from './components/Sidebar';
import { StatsBar } from './components/StatsBar';
import { CategorySection } from './components/CategorySection';
import { ConnectModal } from './components/ConnectModal';
import { AssetDetail } from './components/AssetDetail';
import { CreateAssetModal } from './components/CreateAssetModal';
import { ProjectsView } from './components/ProjectsView';
import { ServersView } from './components/ServersView';
import { RunningAgentsView } from './components/RunningAgentsView';
import { DragOverlay } from './components/DragOverlay';

type View = 'map' | 'projects' | 'agents' | 'servers';

export default function App() {
  const [view, setView] = useState<View>('map');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [categories, setCategories] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<AssetType | null>(null);
  const [providerFilter, setProviderFilter] = useState<Provider | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectTarget, setConnectTarget] = useState<Asset | null>(null);
  const [detailAsset, setDetailAsset] = useState<Asset | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [highlightName, setHighlightName] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [draggedAsset, setDraggedAsset] = useState<Asset | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<SearchBarHandle>(null);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Cmd+F — focus search
      if (meta && e.key === 'f') {
        e.preventDefault();
        setView('map');
        setTimeout(() => searchRef.current?.focus(), 50);
        return;
      }
      // Cmd+N — create new asset
      if (meta && e.key === 'n') {
        e.preventDefault();
        setShowCreate(true);
        return;
      }
      // Cmd+R — rescan
      if (meta && e.key === 'r') {
        e.preventDefault();
        handleRescan();
        return;
      }
      // Cmd+1/2/3/4 — switch views
      if (meta && e.key >= '1' && e.key <= '4') {
        e.preventDefault();
        const views: View[] = ['map', 'projects', 'agents', 'servers'];
        setView(views[parseInt(e.key) - 1]);
        return;
      }
      // Escape — close modals/panels, clear search
      if (e.key === 'Escape' && !isInput) {
        if (detailAsset) { setDetailAsset(null); return; }
        if (connectTarget) { setConnectTarget(null); return; }
        if (showCreate) { setShowCreate(false); return; }
        if (search) { setSearch(''); return; }
      }
      // Escape in search input — clear and blur
      if (e.key === 'Escape' && isInput && target.tagName === 'INPUT') {
        if (search) { setSearch(''); }
        (target as HTMLInputElement).blur();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [detailAsset, connectTarget, showCreate, search]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const loadData = useCallback(async () => {
    try {
      const [assetsRes, statsRes, catsRes] = await Promise.all([
        fetchAssets({
          type: typeFilter ?? undefined,
          provider: providerFilter ?? undefined,
          category: categoryFilter ?? undefined,
          q: search || undefined,
        }),
        fetchStats(),
        fetchCategories(),
      ]);
      setAssets(assetsRes.data);
      setStats(statsRes.data);
      setCategories(catsRes.data);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, providerFilter, categoryFilter, search]);

  useEffect(() => {
    setLoading(true);
    loadData();
  }, [loadData]);

  useEffect(() => {
    ws.connect();
    const unsub = ws.onMessage((msg) => {
      if (msg.type === 'assets:updated') loadData();
    });
    return () => { unsub(); ws.disconnect(); };
  }, [loadData]);

  const usedByMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const asset of assets) {
      for (const dep of asset.deps) {
        if (!map[dep]) map[dep] = [];
        if (!map[dep].includes(asset.name)) map[dep].push(asset.name);
      }
    }
    return map;
  }, [assets]);

  const grouped = useMemo(() => {
    const map = new Map<string, Asset[]>();
    for (const asset of assets) {
      const cat = asset.cat || 'Other';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(asset);
    }
    return [...map.entries()].sort(([, a], [, b]) => b.length - a.length);
  }, [assets]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleRescan = async () => {
    setRescanning(true);
    try {
      const res = await rescan();
      showToast(`Rescan complete: ${res.count} assets found`);
      await loadData();
    } catch {
      showToast('Rescan failed');
    } finally {
      setRescanning(false);
    }
  };

  const handleNavigate = (name: string) => {
    const el = document.getElementById(`card-${name}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightName(name);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => setHighlightName(null), 2500);
    }
  };

  function handleDragStart(event: DragStartEvent) {
    const asset = event.active.data.current?.asset as Asset | undefined;
    if (asset) setDraggedAsset(asset);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setDraggedAsset(null);
    const asset = event.active.data.current?.asset as Asset | undefined;
    const provider = event.over?.data.current?.provider as string | undefined;
    if (asset && provider) {
      try {
        await connectAsset(asset.name, provider, asset.type);
        showToast(`Connected ${asset.name} → ${provider}`);
        loadData();
      } catch {
        showToast('Connection failed');
      }
    }
  }

  const NAV_ITEMS: { key: View; label: string; icon: string }[] = [
    { key: 'map', label: 'Ecosystem Map', icon: '🗺️' },
    { key: 'projects', label: 'Projects', icon: '📂' },
    { key: 'agents', label: 'Agents', icon: '🤖' },
    { key: 'servers', label: 'Servers', icon: '🖥️' },
  ];

  const NAV_ICONS: Record<string, React.ReactNode> = {
    map: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg>,
    projects: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" /></svg>,
    agents: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" /></svg>,
    servers: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" /></svg>,
  };

  return (
    <div className="flex flex-col h-screen bg-bg">
      {/* Header — row 1: logo + nav */}
      <header className="flex items-center justify-between border-b border-border px-6 py-3 shrink-0">
        <h1 className="text-gradient-primary text-lg font-semibold tracking-tight">
          AI Ecosystem Map
        </h1>
        <nav className="flex gap-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              onClick={() => setView(item.key)}
              className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                view === item.key
                  ? 'bg-accent/10 text-accent'
                  : 'text-accent-fg hover:bg-[hsl(240,4%,13%)]'
              }`}
            >
              {NAV_ICONS[item.key]}
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {view === 'map' && (
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setDraggedAsset(null)}
          >
          <div className="flex h-full flex-col">
            {/* Top bar: search + actions */}
            <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
              <SearchBar ref={searchRef} value={search} onChange={setSearch} />
              <div className="flex gap-2">
                <button
                  onClick={handleRescan}
                  disabled={rescanning}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-[hsl(240,4%,13%)] transition-colors disabled:opacity-40"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" /></svg>
                  {rescanning ? 'Scanning...' : 'Rescan'}
                </button>
                <button
                  onClick={() => setShowCreate(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-accent/20 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/15 transition-colors"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                  Create
                </button>
              </div>
            </div>

            {/* Stats */}
            <StatsBar stats={stats} />

            {/* Sidebar + cards */}
            <div className="flex flex-1 overflow-hidden">
              <Sidebar
                categories={categories}
                activeType={typeFilter}
                activeProvider={providerFilter}
                activeCategory={categoryFilter}
                onTypeChange={setTypeFilter}
                onProviderChange={setProviderFilter}
                onCategoryChange={setCategoryFilter}
              />

              {/* Cards grid */}
              <div className="flex-1 overflow-y-auto p-6">
                {loading ? (
                  <div className="flex h-40 items-center justify-center text-sm text-muted">Loading...</div>
                ) : assets.length === 0 ? (
                  <div className="flex h-40 items-center justify-center text-sm text-muted">No items match your filters</div>
                ) : (
                  grouped.map(([cat, items]) => (
                    <CategorySection
                      key={cat}
                      category={cat}
                      assets={items}
                      usedByMap={usedByMap}
                      onConnect={setConnectTarget}
                      onNavigate={handleNavigate}
                      onAssetClick={setDetailAsset}
                      highlightName={highlightName}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
          <DragOverlay activeAsset={draggedAsset} />
          </DndContext>
        )}
        {view === 'projects' && <ProjectsView />}
        {view === 'agents' && <RunningAgentsView />}
        {view === 'servers' && <ServersView />}
      </main>

      {/* Connect Modal */}
      <ConnectModal asset={connectTarget} onClose={() => setConnectTarget(null)} />

      {/* Asset Detail */}
      {detailAsset && (
        <AssetDetail
          asset={detailAsset}
          onClose={() => setDetailAsset(null)}
          onDeleted={() => { loadData(); }}
          onConnect={(a) => { setDetailAsset(null); setConnectTarget(a); }}
        />
      )}

      {/* Create Modal */}
      {showCreate && (
        <CreateAssetModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadData(); }}
        />
      )}

      {/* Global Toast */}
      {toast && (
        <div className="animate-slide-up fixed bottom-6 left-1/2 z-[300] rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-5 py-2.5 text-emerald-400 text-[13px] shadow-[0_8px_32px_rgba(0,0,0,.5)] backdrop-blur-sm">
          {toast}
        </div>
      )}

      {/* Footer */}
      <footer className="text-center py-2.5 border-t border-border text-[11px] text-muted shrink-0">
        <a href="https://github.com/spyrae/ai-ecosystem-map" target="_blank" rel="noopener" className="text-accent/60 hover:text-accent transition-colors">
          ai-ecosystem-map
        </a>
        <span className="mx-1.5 opacity-30">·</span>
        Claude · Codex · Gemini · Cursor · Windsurf · Copilot
      </footer>
    </div>
  );
}
