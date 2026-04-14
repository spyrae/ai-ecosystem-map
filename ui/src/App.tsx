import { useEffect, useState, useMemo, useCallback, useRef } from 'react';

function usePersistedState<T>(key: string, defaultValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : defaultValue;
    } catch { return defaultValue; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  }, [key, value]);
  return [value, setValue];
}
import { DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import { PROVIDER_LABELS, assetCanConnect, type Asset, type AssetHealthStatus, type AssetType, type AuditMode, type DependencyGraph, type DriftGraph, type DriftStatus, type HistoryEntry, type Provider, type Stats, type TopologyGraph } from './types';
import { fetchAssets, fetchStats, fetchCategories, fetchHistory, fetchTopology, fetchDependencies, fetchDrift, fetchAuditMode, fetchAuditReport, setGlobalReadOnly, setSourceOfTruth, rollbackHistoryEntry, undoLastAction, rescan, connectAsset, validateBatch, connectBatch, disconnectBatch, deleteBatch } from './lib/api';
import { buildUsedByMapFromTopology } from './lib/topology';
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
import { BundlesView } from './components/BundlesView';
import { PoliciesView } from './components/PoliciesView';
import { DragOverlay } from './components/DragOverlay';
import { AEMLogo } from './components/AEMLogo';
import { HistoryModal } from './components/HistoryModal';

type View = 'map' | 'projects' | 'agents' | 'servers' | 'bundles' | 'policies';

export default function App() {
  const [view, setView] = useState<View>('map');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [topology, setTopology] = useState<TopologyGraph | null>(null);
  const [dependencies, setDependencies] = useState<DependencyGraph | null>(null);
  const [drift, setDrift] = useState<DriftGraph | null>(null);
  const [auditMode, setAuditMode] = useState<AuditMode | null>(null);
  const [categories, setCategories] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = usePersistedState<AssetType | null>('aem:filter:type', null);
  const [providerFilter, setProviderFilter] = usePersistedState<Provider | null>('aem:filter:provider', null);
  const [categoryFilter, setCategoryFilter] = usePersistedState<string | null>('aem:filter:category', null);
  const [healthFilter, setHealthFilter] = useState<AssetHealthStatus | null>(null);
  const [driftFilter, setDriftFilter] = useState<DriftStatus | null>(null);
  const [dependencyFilter, setDependencyFilter] = useState<'orphaned' | null>(null);
  const [hiddenProviders, setHiddenProviders] = usePersistedState<Provider[]>('aem:hidden:providers', []);
  const [sidebarHidden, setSidebarHidden] = usePersistedState<{ types: string[]; providers: Provider[]; categories: string[] }>('aem:hidden:sidebar', { types: [], providers: [], categories: [] });
  const [loading, setLoading] = useState(true);
  const [connectTarget, setConnectTarget] = useState<Asset | null>(null);
  const [detailAsset, setDetailAsset] = useState<Asset | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [highlightName, setHighlightName] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [draggedAsset, setDraggedAsset] = useState<Asset | null>(null);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyBusyId, setHistoryBusyId] = useState<number | 'latest' | null>(null);
  const [focusedProjectId, setFocusedProjectId] = useState<string | null>(null);
  const [focusedServerId, setFocusedServerId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  const [batchTool, setBatchTool] = useState<Provider>('claude');
  const [batchRunning, setBatchRunning] = useState(false);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<SearchBarHandle>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const loadData = useCallback(async () => {
    try {
      const [assetsRes, statsRes, catsRes, historyRes, topologyRes, dependencyRes, driftRes, auditRes] = await Promise.all([
        fetchAssets({
          type: typeFilter ?? undefined,
          provider: providerFilter ?? undefined,
          category: categoryFilter ?? undefined,
          q: search || undefined,
        }),
        fetchStats(),
        fetchCategories(),
        fetchHistory(50),
        fetchTopology(),
        fetchDependencies(),
        fetchDrift(),
        fetchAuditMode(),
      ]);
      const driftByAssetId = driftRes.data.byAssetId || {};
      const dependencyByAssetId = dependencyRes.data.byAssetId || {};
      const nextAssets = assetsRes.data.map((asset) => ({
        ...asset,
        drift: driftByAssetId[asset.id] || undefined,
        dependency: dependencyByAssetId[asset.id] || undefined,
      }));
      setAssets(nextAssets);
      setStats(statsRes.data);
      setCategories(catsRes.data);
      setHistoryEntries(historyRes.data);
      setTopology(topologyRes.data);
      setDependencies(dependencyRes.data);
      setDrift(driftRes.data);
      setAuditMode(auditRes.data);
      setDetailAsset((current) => current ? nextAssets.find((asset) => asset.id === current.id) || null : null);
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
    const fromTopology = buildUsedByMapFromTopology(topology);
    if (Object.keys(fromTopology).length > 0) return fromTopology;
    const map: Record<string, string[]> = {};
    const assetsByName = new Map<string, Asset[]>();
    for (const asset of assets) {
      const list = assetsByName.get(asset.name) || [];
      list.push(asset);
      assetsByName.set(asset.name, list);
    }
    for (const asset of assets) {
      for (const dep of asset.deps) {
        for (const target of assetsByName.get(dep) || []) {
          if (!map[target.id]) map[target.id] = [];
          if (!map[target.id].includes(asset.name)) map[target.id].push(asset.name);
        }
      }
    }
    return map;
  }, [assets, topology]);

  const healthCounts = useMemo<Record<AssetHealthStatus, number>>(() => (
    assets.reduce<Record<AssetHealthStatus, number>>((acc, asset) => {
      if (asset.health?.status === 'warning') acc.warning += 1;
      if (asset.health?.status === 'broken') acc.broken += 1;
      return acc;
    }, { warning: 0, broken: 0 })
  ), [assets]);

  const driftCounts = useMemo<Record<DriftStatus, number>>(() => (
    assets.reduce<Record<DriftStatus, number>>((acc, asset) => {
      const status = asset.drift?.status;
      if (status) acc[status] += 1;
      return acc;
    }, { source: 0, synced: 0, drifted: 0, orphaned: 0 })
  ), [assets]);

  const dependencyCounts = useMemo(() => ({
    orphaned: dependencies?.summary.orphanedCount || 0,
  }), [dependencies]);

  const visibleAssets = useMemo(() => {
    let result = assets;
    if (healthFilter) {
      result = result.filter((asset) => asset.health?.status === healthFilter);
    }
    if (driftFilter) {
      result = result.filter((asset) => asset.drift?.status === driftFilter);
    }
    if (dependencyFilter === 'orphaned') {
      result = result.filter((asset) => asset.dependency?.orphaned === true);
    }
    return result;
  }, [assets, dependencyFilter, driftFilter, healthFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, Asset[]>();
    for (const asset of visibleAssets) {
      const cat = asset.cat || 'Other';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(asset);
    }
    return [...map.entries()].sort(([, a], [, b]) => b.length - a.length);
  }, [visibleAssets]);

  const selectableVisibleAssets = useMemo(
    () => visibleAssets.filter((asset) => ['skill', 'agent', 'mcp', 'instruction', 'rule'].includes(asset.type)),
    [visibleAssets]
  );

  const selectedMapAssets = useMemo(
    () => assets.filter((asset) => selectedAssetIds.has(asset.id)),
    [assets, selectedAssetIds]
  );

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);
  const buildApproval = useCallback((note?: string | null) => ({
    confirmed: true,
    note: note ?? null,
    source: 'web',
  }), []);

  const globalReadOnly = auditMode?.global_read_only === true;

  const handleAuditToggle = useCallback(async () => {
    try {
      const res = await setGlobalReadOnly(!globalReadOnly);
      setAuditMode(res.data);
      showToast(res.data.global_read_only ? 'Global audit mode enabled' : 'Global audit mode disabled');
    } catch (err) {
      console.error('Failed to toggle audit mode:', err);
      showToast('Failed to update audit mode');
    }
  }, [globalReadOnly, showToast]);

  const handleExportAuditReport = useCallback(async () => {
    try {
      const res = await fetchAuditReport();
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      anchor.href = url;
      anchor.download = `aem-audit-report-${timestamp}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      showToast('Audit report downloaded');
    } catch (err) {
      console.error('Failed to export audit report:', err);
      showToast('Failed to export audit report');
    }
  }, [showToast]);

  const handleRescan = useCallback(async () => {
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
  }, [loadData, showToast]);

  const handleMakeSourceOfTruth = useCallback(async (groupKey: string, assetId: string) => {
    try {
      await setSourceOfTruth(groupKey, assetId);
      showToast('Source of truth updated');
      await loadData();
    } catch (err) {
      console.error('Failed to set source of truth:', err);
      showToast('Failed to update source of truth');
    }
  }, [loadData, showToast]);

  const openHistory = useCallback(async () => {
    setShowHistory(true);
    setHistoryLoading(true);
    try {
      const res = await fetchHistory(50);
      setHistoryEntries(res.data);
    } catch (err) {
      console.error('Failed to load history:', err);
      showToast('Failed to load history');
    } finally {
      setHistoryLoading(false);
    }
  }, [showToast]);

  const handleUndoLast = useCallback(async () => {
    setHistoryBusyId('latest');
    try {
      await undoLastAction(buildApproval());
      showToast('Last change rolled back');
      await loadData();
    } catch (err) {
      console.error('Undo failed:', err);
      showToast(err instanceof Error ? err.message : 'Undo failed');
    } finally {
      setHistoryBusyId(null);
    }
  }, [buildApproval, loadData, showToast]);

  const handleRollbackHistory = useCallback(async (historyId: number) => {
    setHistoryBusyId(historyId);
    try {
      await rollbackHistoryEntry(historyId, buildApproval());
      showToast(`Rolled back history entry #${historyId}`);
      await loadData();
    } catch (err) {
      console.error('Rollback failed:', err);
      showToast(err instanceof Error ? err.message : 'Rollback failed');
    } finally {
      setHistoryBusyId(null);
    }
  }, [buildApproval, loadData, showToast]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if (meta && e.key === 'f') {
        e.preventDefault();
        setView('map');
        setTimeout(() => searchRef.current?.focus(), 50);
        return;
      }
      if (meta && e.key === 'n') {
        e.preventDefault();
        if (!globalReadOnly) setShowCreate(true);
        return;
      }
      if (meta && e.key === 'r') {
        e.preventDefault();
        handleRescan();
        return;
      }
      if (meta && e.key.toLowerCase() === 'z' && !isInput) {
        e.preventDefault();
        if (!globalReadOnly) void handleUndoLast();
        return;
      }
      if (meta && e.key >= '1' && e.key <= '6') {
        e.preventDefault();
        const views: View[] = ['map', 'projects', 'agents', 'servers', 'bundles', 'policies'];
        setView(views[parseInt(e.key) - 1]);
        return;
      }
      if (e.key === 'Escape' && !isInput) {
        if (selectionMode) { setSelectionMode(false); setSelectedAssetIds(new Set()); return; }
        if (showHistory) { setShowHistory(false); return; }
        if (detailAsset) { setDetailAsset(null); return; }
        if (connectTarget) { setConnectTarget(null); return; }
        if (showCreate) { setShowCreate(false); return; }
        if (search) { setSearch(''); return; }
      }
      if (e.key === 'Escape' && isInput && target.tagName === 'INPUT') {
        if (search) { setSearch(''); }
        (target as HTMLInputElement).blur();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectionMode, showHistory, detailAsset, connectTarget, showCreate, search, handleRescan, handleUndoLast, globalReadOnly]);

  const toggleAssetSelection = useCallback((asset: Asset) => {
    setSelectedAssetIds((prev) => {
      const next = new Set(prev);
      if (next.has(asset.id)) next.delete(asset.id);
      else next.add(asset.id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedAssetIds(new Set());
  }, []);

  const setSelectionEnabled = useCallback((enabled: boolean) => {
    setSelectionMode(enabled);
    if (!enabled) clearSelection();
  }, [clearSelection]);

  const selectVisibleAssets = useCallback(() => {
    setSelectedAssetIds(new Set(selectableVisibleAssets.map((asset) => asset.id)));
  }, [selectableVisibleAssets]);

  const batchItemsFromAssets = useCallback((items: Asset[]) => (
    items.map((asset) => ({
      assetId: asset.id,
      name: asset.name,
      type: asset.type,
      filePath: asset.filePath,
      providers: asset.providers,
      scope: 'local' as const,
    }))
  ), []);

  const runBatchValidation = useCallback(async () => {
    if (selectedMapAssets.length === 0) return;
    setBatchRunning(true);
    try {
      const result = await validateBatch(batchItemsFromAssets(selectedMapAssets));
      showToast(`Validated ${result.total}: ${result.okCount ?? 0} ok, ${result.warningCount ?? 0} warnings, ${result.brokenCount ?? 0} broken, ${result.failureCount ?? 0} failed`);
      await loadData();
    } catch (err) {
      console.error('Batch validation failed:', err);
      showToast('Batch validation failed');
    } finally {
      setBatchRunning(false);
    }
  }, [batchItemsFromAssets, loadData, selectedMapAssets, showToast]);

  const runBatchConnect = useCallback(async (mode: 'connect' | 'disconnect') => {
    if (selectedMapAssets.length === 0) return;
    setBatchRunning(true);
    try {
      const items = batchItemsFromAssets(selectedMapAssets);
      const result = mode === 'connect'
        ? await connectBatch(items, batchTool)
        : await disconnectBatch(items, batchTool);
      showToast(`${mode === 'connect' ? 'Connected' : 'Disconnected'} ${result.successCount ?? 0}/${result.total} items for ${PROVIDER_LABELS[batchTool]}`);
      await loadData();
    } catch (err) {
      console.error(`Batch ${mode} failed:`, err);
      showToast(`Batch ${mode} failed`);
    } finally {
      setBatchRunning(false);
    }
  }, [batchItemsFromAssets, batchTool, loadData, selectedMapAssets, showToast]);

  const runBatchDelete = useCallback(async () => {
    if (selectedMapAssets.length === 0) return;
    const impactedAssets = selectedMapAssets.filter((asset) => (asset.dependency?.consumerCount || 0) > 0);
    const totalConsumers = impactedAssets.reduce((sum, asset) => sum + (asset.dependency?.consumerCount || 0), 0);
    const message = impactedAssets.length > 0
      ? `Delete ${selectedMapAssets.length} selected assets? ${impactedAssets.length} of them have downstream consumers (${totalConsumers} total assets/providers/running agents) and this cannot be undone.`
      : `Delete ${selectedMapAssets.length} selected assets? This cannot be undone.`;
    if (!window.confirm(message)) return;
    setBatchRunning(true);
    try {
      const result = await deleteBatch(batchItemsFromAssets(selectedMapAssets), buildApproval('Confirmed batch delete from ecosystem map'));
      const failedIds = new Set(result.results.filter((entry) => !entry.ok).map((entry) => entry.id));
      setSelectedAssetIds(failedIds);
      setSelectionMode(failedIds.size > 0);
      showToast(`Deleted ${result.successCount ?? 0}/${result.total} selected assets`);
      await loadData();
    } catch (err) {
      console.error('Batch delete failed:', err);
      showToast('Batch delete failed');
    } finally {
      setBatchRunning(false);
    }
  }, [batchItemsFromAssets, buildApproval, loadData, selectedMapAssets, showToast]);

  const handleNavigate = (name: string) => {
    const el = document.getElementById(`card-${name}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightName(name);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => setHighlightName(null), 2500);
    }
  };

  const handleOpenProjectFromDrift = useCallback((projectId: string) => {
    setDetailAsset(null);
    setFocusedServerId(null);
    setFocusedProjectId(projectId);
    setView('projects');
  }, []);

  const handleOpenServerFromDrift = useCallback((serverId: string) => {
    setDetailAsset(null);
    setFocusedProjectId(null);
    setFocusedServerId(serverId);
    setView('servers');
  }, []);

  function handleDragStart(event: DragStartEvent) {
    const asset = event.active.data.current?.asset as Asset | undefined;
    if (asset) setDraggedAsset(asset);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setDraggedAsset(null);
    const asset = event.active.data.current?.asset as Asset | undefined;
    const provider = event.over?.data.current?.provider as string | undefined;
    if (asset && provider) {
      if (globalReadOnly) {
        showToast('Global read-only audit mode is enabled');
        return;
      }
      if (!assetCanConnect(asset)) {
        showToast(asset.health?.summary || 'This asset cannot be connected until its blocking issues are fixed');
        return;
      }
      try {
        await connectAsset(asset.id, provider, asset.type);
        showToast(`Connected ${asset.name} → ${provider}`);
        void loadData();
      } catch {
        showToast('Connection failed');
      }
    }
  }

  const NAV_ITEMS: { key: View; label: string; icon: string }[] = [
    { key: 'map', label: 'Ecosystem Map', icon: '🗺️' },
    // { key: 'projects', label: 'Projects', icon: '📂' },
    // { key: 'agents', label: 'Agents', icon: '🤖' },
    // { key: 'servers', label: 'Servers', icon: '🖥️' },
    // { key: 'bundles', label: 'Bundles', icon: '📦' },
    // { key: 'policies', label: 'Policies', icon: '📜' },
  ];

  const NAV_ICONS: Record<string, React.ReactNode> = {
    map: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg>,
    projects: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" /></svg>,
    agents: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" /></svg>,
    servers: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" /></svg>,
    bundles: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5v9a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 16.5v-9m16.5 0-7.126-3.563a2.25 2.25 0 00-2.012 0L3.75 7.5m16.5 0L12 11.25 3.75 7.5" /></svg>,
    policies: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 4.5l3 3m-9 10.5H6.75A2.25 2.25 0 014.5 15.75V6.75A2.25 2.25 0 016.75 4.5h7.5A2.25 2.25 0 0116.5 6.75v3.75m-6 7.5l7.5-7.5a2.121 2.121 0 00-3-3l-7.5 7.5-.75 3.75 3.75-.75z" /></svg>,
  };

  return (
    <div className="flex flex-col h-screen bg-bg">
      {/* Header — row 1: logo + nav */}
      <header className="flex items-center justify-between border-b border-border px-6 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <AEMLogo height={22} showText />
        </div>
        <div className="flex items-center gap-2">
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
          <button
            onClick={() => void handleAuditToggle()}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              globalReadOnly
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15'
                : 'border-border text-accent-fg hover:bg-[hsl(240,4%,13%)]'
            }`}
          >
            {globalReadOnly ? 'Audit: Read-Only' : 'Enable Audit Mode'}
          </button>
          <button
            onClick={() => void openHistory()}
            disabled={historyBusyId !== null}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-[hsl(240,4%,13%)] transition-colors disabled:opacity-40"
          >
            History
          </button>
        </div>
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
              <div className="flex flex-wrap items-center justify-end gap-2">
                {globalReadOnly && (
                  <span className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300">
                    Global read-only audit mode
                  </span>
                )}
                {selectionMode && (
                  <>
                    <span className="rounded-lg border border-accent/25 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent">
                      {selectedMapAssets.length} selected
                    </span>
                    <button
                      onClick={selectVisibleAssets}
                      disabled={batchRunning || selectableVisibleAssets.length === 0}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-[hsl(240,4%,13%)] transition-colors disabled:opacity-40"
                    >
                      Select Visible
                    </button>
                    <button
                      onClick={clearSelection}
                      disabled={batchRunning || selectedMapAssets.length === 0}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-[hsl(240,4%,13%)] transition-colors disabled:opacity-40"
                    >
                      Clear
                    </button>
                    <select
                      value={batchTool}
                      onChange={(e) => setBatchTool(e.target.value as Provider)}
                      disabled={batchRunning}
                      className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text focus:outline-none focus:border-accent disabled:opacity-40"
                    >
                      {Object.entries(PROVIDER_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                    <button
                      onClick={runBatchValidation}
                      disabled={batchRunning || selectedMapAssets.length === 0}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-[hsl(240,4%,13%)] transition-colors disabled:opacity-40"
                    >
                      Validate Selected
                    </button>
                    <button
                      onClick={() => void runBatchConnect('connect')}
                      disabled={globalReadOnly || batchRunning || selectedMapAssets.length === 0}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-[hsl(240,4%,13%)] transition-colors disabled:opacity-40"
                    >
                      Connect Selected
                    </button>
                    <button
                      onClick={() => void runBatchConnect('disconnect')}
                      disabled={globalReadOnly || batchRunning || selectedMapAssets.length === 0}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-[hsl(240,4%,13%)] transition-colors disabled:opacity-40"
                    >
                      Disconnect Selected
                    </button>
                    <button
                      onClick={runBatchDelete}
                      disabled={globalReadOnly || batchRunning || selectedMapAssets.length === 0}
                      className="rounded-lg border border-red/30 bg-red/10 px-3 py-1.5 text-xs font-medium text-red hover:bg-red/15 transition-colors disabled:opacity-40"
                    >
                      Delete Selected
                    </button>
                  </>
                )}
                <button
                  onClick={() => setSelectionEnabled(!selectionMode)}
                  disabled={batchRunning}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${
                    selectionMode
                      ? 'border-accent/25 bg-accent/10 text-accent'
                      : 'border-border text-accent-fg hover:bg-[hsl(240,4%,13%)]'
                  }`}
                >
                  {selectionMode ? 'Done' : 'Select'}
                </button>
                <button
                  onClick={handleRescan}
                  disabled={rescanning || batchRunning}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-[hsl(240,4%,13%)] transition-colors disabled:opacity-40"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" /></svg>
                  {rescanning ? 'Scanning...' : 'Rescan'}
                </button>
                <button
                  onClick={() => setShowCreate(true)}
                  disabled={globalReadOnly || batchRunning}
                  className="flex items-center gap-1.5 rounded-lg border border-accent/20 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/15 transition-colors disabled:opacity-40"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                  Create
                </button>
              </div>
            </div>

            {/* Stats */}
            <StatsBar stats={stats} healthCounts={healthCounts} />

            {/* Sidebar + cards */}
            <div className="flex flex-1 overflow-hidden">
              <Sidebar
                categories={categories}
                healthCounts={healthCounts}
                driftCounts={driftCounts}
                dependencyCounts={dependencyCounts}
                activeType={typeFilter}
                activeProvider={providerFilter}
                activeCategory={categoryFilter}
                activeHealth={healthFilter}
                activeDrift={driftFilter}
                activeDependency={dependencyFilter}
                onTypeChange={setTypeFilter}
                onProviderChange={setProviderFilter}
                onCategoryChange={setCategoryFilter}
                onHealthChange={setHealthFilter}
                onDriftChange={setDriftFilter}
                onDependencyChange={setDependencyFilter}
                hiddenProviders={hiddenProviders}
                onHiddenProvidersChange={setHiddenProviders}
                hidden={sidebarHidden}
                onHiddenChange={setSidebarHidden}
              />

              {/* Cards grid */}
              <div className="flex-1 overflow-y-auto p-6">
                {loading ? (
                  <div className="flex h-40 items-center justify-center text-sm text-muted">Loading...</div>
                ) : visibleAssets.length === 0 ? (
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
                      selectionMode={selectionMode}
                      selectedAssetIds={selectedAssetIds}
                      onToggleSelection={toggleAssetSelection}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
          <DragOverlay activeAsset={draggedAsset} />
          </DndContext>
        )}
        {view === 'projects' && (
          <ProjectsView
            auditMode={auditMode}
            focusProjectId={focusedProjectId}
            onFocusConsumed={() => setFocusedProjectId(null)}
          />
        )}
        {view === 'agents' && <RunningAgentsView />}
        {view === 'servers' && (
          <ServersView
            auditMode={auditMode}
            onAuditModeChange={setAuditMode}
            focusServerId={focusedServerId}
            onFocusConsumed={() => setFocusedServerId(null)}
          />
        )}
        {view === 'bundles' && (
          <BundlesView auditMode={auditMode} />
        )}
        {view === 'policies' && (
          <PoliciesView />
        )}
      </main>

      {/* Connect Modal */}
      <ConnectModal asset={connectTarget} onClose={() => setConnectTarget(null)} readOnly={globalReadOnly} />

      {/* Asset Detail */}
      {detailAsset && (
        <AssetDetail
          asset={detailAsset}
          topology={topology}
          driftGroup={detailAsset.drift?.groupKey ? drift?.groups.find((group) => group.key === detailAsset.drift?.groupKey) || null : null}
          onClose={() => setDetailAsset(null)}
          onDeleted={() => { void loadData(); }}
          onUpdated={() => loadData()}
          onConnect={(a) => { setDetailAsset(null); setConnectTarget(a); }}
          onMakeSourceOfTruth={handleMakeSourceOfTruth}
          onOpenProject={handleOpenProjectFromDrift}
          onOpenServer={handleOpenServerFromDrift}
          readOnly={globalReadOnly}
        />
      )}

      {/* Create Modal */}
      {showCreate && (
        <CreateAssetModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); void loadData(); }}
          readOnly={globalReadOnly}
        />
      )}

      {showHistory && (
        <HistoryModal
          entries={historyEntries}
          loading={historyLoading}
          busyId={historyBusyId}
          onClose={() => setShowHistory(false)}
          onUndoLatest={() => void handleUndoLast()}
          onRollback={(historyId) => void handleRollbackHistory(historyId)}
          readOnly={globalReadOnly}
        />
      )}

      {/* Global Toast */}
      {toast && (
        <div className="animate-slide-up fixed bottom-6 left-1/2 z-[300] rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-5 py-2.5 text-emerald-400 text-[13px] shadow-[0_8px_32px_rgba(0,0,0,.5)] backdrop-blur-sm">
          {toast}
        </div>
      )}

      {/* Footer */}
      <footer className="flex items-center justify-center py-2.5 border-t border-border shrink-0">
        <AEMLogo height={14} />
      </footer>
    </div>
  );
}
