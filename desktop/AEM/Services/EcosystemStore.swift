import Foundation
import SwiftUI

@Observable
final class EcosystemStore: @unchecked Sendable {
    // Data
    var assets: [Asset] = []
    var stats: Stats?
    var topology: TopologyGraph?
    var dependencyGraph: DependencyGraph?
    var driftGraph: DriftGraph?
    var auditMode: AuditMode?
    var categories: [String: Int] = [:]
    var projects: [Project] = []
    var servers: [ServerEnvironment] = []
    var runningAgents: [RunningAgent] = []

    // Filters (persisted via UserDefaults)
    var searchText = ""
    var typeFilter: AssetType? {
        didSet {
            if let typeFilter { UserDefaults.standard.set(typeFilter.rawValue, forKey: "filter.type") }
            else { UserDefaults.standard.removeObject(forKey: "filter.type") }
        }
    }
    var providerFilter: Provider? {
        didSet {
            if let providerFilter { UserDefaults.standard.set(providerFilter.rawValue, forKey: "filter.provider") }
            else { UserDefaults.standard.removeObject(forKey: "filter.provider") }
        }
    }
    var categoryFilter: String? {
        didSet { UserDefaults.standard.set(categoryFilter, forKey: "filter.category") }
    }
    var healthFilter: AssetHealthFilter?
    var dependencyFilter: AssetDependencyFilter?
    var driftFilter: AssetDriftStatus?

    // UI state
    var selectedTab: NavigationTab = .map
    var isLoading = false
    var showCreate = false
    var selectedAsset: Asset?
    var focusedProjectID: String?
    var focusedServerID: String?
    var toast: String?
    var mapSelectionMode = false
    var selectedAssetIDs: Set<String> = []
    var batchTool: Provider = .claude
    var historyEntries: [HistoryEntry] = []
    var showHistory = false
    var historyLoading = false
    var historyBusyKey: String?

    // MARK: - Init

    init() {
        let defaults = UserDefaults.standard
        if let raw = defaults.string(forKey: "filter.type") {
            typeFilter = AssetType(rawValue: raw)
        }
        if let raw = defaults.string(forKey: "filter.provider") {
            providerFilter = Provider(rawValue: raw)
        }
        categoryFilter = defaults.string(forKey: "filter.category")
    }

    // MARK: - Computed

    var filteredAssets: [Asset] {
        var result = assets

        if let type = typeFilter {
            // When filtering by .rule, also include .instruction assets (merged in UI)
            if type == .rule {
                result = result.filter { $0.type == .rule || $0.type == .instruction }
            } else {
                result = result.filter { $0.type == type }
            }
        }
        if let provider = providerFilter {
            result = result.filter { $0.providers.contains(provider.rawValue) }
        }
        if let category = categoryFilter {
            result = result.filter { $0.cat == category }
        }
        if let healthFilter = healthFilter {
            result = result.filter { $0.health?.status == healthFilter.rawValue }
        }
        if let dependencyFilter = dependencyFilter {
            result = result.filter { asset in
                switch dependencyFilter {
                case .orphaned:
                    return asset.dependency?.orphaned == true
                }
            }
        }
        if let driftFilter = driftFilter {
            result = result.filter { $0.drift?.status == driftFilter }
        }
        if !searchText.isEmpty {
            let q = searchText.lowercased()
            result = result.filter { asset in
                let text = "\(asset.name) \(asset.desc) \(asset.tags.joined(separator: " ")) \(asset.keywords)".lowercased()
                return text.contains(q)
            }
        }

        return result
    }

    var groupedAssets: [(String, [Asset])] {
        var map: [String: [Asset]] = [:]
        for asset in filteredAssets {
            let cat = (asset.cat == "Instructions" ? "Rules" : asset.cat).isEmpty ? "Other" : (asset.cat == "Instructions" ? "Rules" : asset.cat)
            map[cat, default: []].append(asset)
        }
        return map.sorted { $0.value.count > $1.value.count }
    }

    var usedByMap: [String: [String]] {
        if let topology {
            let nodeMap = Dictionary(uniqueKeysWithValues: topology.nodes.map { ($0.id, $0) })
            var map: [String: [String]] = [:]
            for edge in topology.edges where edge.kind == "depends_on" {
                guard let source = nodeMap[edge.from], let target = nodeMap[edge.to] else { continue }
                guard let assetId = target.assetId else { continue }
                map[assetId, default: []].append(source.label)
            }
            return map.mapValues { Array(Set($0)).sorted() }
        }

        var map: [String: [String]] = [:]
        for asset in assets {
            for dep in asset.deps {
                if let depAsset = assets.first(where: { $0.name == dep }) {
                    map[depAsset.id, default: []].append(asset.name)
                }
            }
        }
        return map
    }

    var healthCounts: [AssetHealthFilter: Int] {
        var counts: [AssetHealthFilter: Int] = [.broken: 0, .warning: 0]
        for asset in assets {
            if asset.health?.status == AssetHealthFilter.broken.rawValue {
                counts[.broken, default: 0] += 1
            } else if asset.health?.status == AssetHealthFilter.warning.rawValue {
                counts[.warning, default: 0] += 1
            }
        }
        return counts
    }

    var driftCounts: [AssetDriftStatus: Int] {
        var counts: [AssetDriftStatus: Int] = [.source: 0, .synced: 0, .drifted: 0, .orphaned: 0]
        for asset in assets {
            guard let status = asset.drift?.status else { continue }
            counts[status, default: 0] += 1
        }
        return counts
    }

    var dependencyCounts: [AssetDependencyFilter: Int] {
        [.orphaned: dependencyGraph?.summary.orphanedCount ?? 0]
    }

    var selectedAssets: [Asset] {
        assets.filter { selectedAssetIDs.contains($0.id) }
    }

    var canUndoLastHistory: Bool {
        !globalReadOnly && historyEntries.contains { $0.can_rollback == true }
    }

    var globalReadOnly: Bool {
        auditMode?.global_read_only == true
    }

    // MARK: - Actions

    @MainActor
    func loadAll(api: APIClient) async {
        // Wait until API is ready
        if !api.isReady {
            print("[store] API not ready, waiting...")
            for _ in 0..<20 {
                try? await Task.sleep(for: .milliseconds(500))
                if api.isReady { break }
            }
        }
        guard api.isReady else { return }

        isLoading = true
        defer { isLoading = false }

        do {
            async let assetsTask = api.fetchAssets()
            async let statsTask = api.fetchStats()
            async let topologyTask = api.fetchTopology()
            async let dependenciesTask = api.fetchDependencies()
            async let driftTask = api.fetchDrift()
            async let auditTask = api.fetchAuditMode()
            async let catsTask = api.fetchCategories()
            async let historyTask = api.fetchHistory()
            let (a, s, t, deps, d, audit, c, h) = try await (assetsTask, statsTask, topologyTask, dependenciesTask, driftTask, auditTask, catsTask, historyTask)
            driftGraph = d
            dependencyGraph = deps
            auditMode = audit
            assets = decorateAssets(a, driftByAssetId: d.byAssetId, dependencyByAssetId: deps.byAssetId)
            stats = s
            topology = t
            categories = c
            historyEntries = h
            if let selectedAsset {
                self.selectedAsset = assets.first(where: { $0.id == selectedAsset.id })
            }
            print("[store] Loaded \(a.count) assets")
        } catch {
            print("[store] Failed to load: \(error)")
        }
    }

    @MainActor
    func loadHistory(api: APIClient, limit: Int = 50) async {
        guard api.isReady else { return }
        historyLoading = true
        defer { historyLoading = false }

        do {
            historyEntries = try await api.fetchHistory(limit: limit)
        } catch {
            print("[store] Failed to load history: \(error)")
            showToast("Failed to load history")
        }
    }

    @MainActor
    func openHistory(api: APIClient) async {
        showHistory = true
        await loadHistory(api: api)
    }

    @MainActor
    func undoLastHistory(api: APIClient) async {
        guard api.isReady, historyBusyKey == nil else { return }
        historyBusyKey = "latest"
        defer { historyBusyKey = nil }

        do {
            try await api.undoLastAction(approval: .client("macos"))
            showToast("Last change rolled back")
            await loadAll(api: api)
        } catch {
            print("[store] Failed to undo history: \(error)")
            showToast(error.localizedDescription.isEmpty ? "Undo failed" : error.localizedDescription)
        }
    }

    @MainActor
    func rollbackHistory(api: APIClient, historyId: Int) async {
        guard api.isReady, historyBusyKey == nil else { return }
        historyBusyKey = String(historyId)
        defer { historyBusyKey = nil }

        do {
            try await api.rollbackHistoryEntry(historyId, approval: .client("macos"))
            showToast("Rolled back history entry #\(historyId)")
            await loadAll(api: api)
        } catch {
            print("[store] Failed to rollback history \(historyId): \(error)")
            showToast(error.localizedDescription.isEmpty ? "Rollback failed" : error.localizedDescription)
        }
    }

    @MainActor
    func loadProjects(api: APIClient) async {
        guard api.isReady else { return }
        do {
            async let projectsTask = api.fetchProjects()
            async let topologyTask = api.fetchTopology()
            async let dependenciesTask = api.fetchDependencies()
            async let driftTask = api.fetchDrift()
            async let auditTask = api.fetchAuditMode()
            projects = try await projectsTask
            topology = try await topologyTask
            dependencyGraph = try await dependenciesTask
            driftGraph = try await driftTask
            auditMode = try await auditTask
        } catch {
            print("[store] Failed to load projects: \(error)")
        }
    }

    @MainActor
    func loadServers(api: APIClient) async {
        guard api.isReady else { return }
        do {
            async let serversTask = api.fetchServers()
            async let topologyTask = api.fetchTopology()
            async let dependenciesTask = api.fetchDependencies()
            async let driftTask = api.fetchDrift()
            async let auditTask = api.fetchAuditMode()
            servers = try await serversTask
            topology = try await topologyTask
            dependencyGraph = try await dependenciesTask
            driftGraph = try await driftTask
            auditMode = try await auditTask
        } catch {
            print("[store] Failed to load servers: \(error)")
        }
    }

    @MainActor
    func loadRunningAgents(api: APIClient) async {
        guard api.isReady else { return }
        do {
            async let agentsTask = api.fetchRunningAgents()
            async let topologyTask = api.fetchTopology()
            async let dependenciesTask = api.fetchDependencies()
            async let driftTask = api.fetchDrift()
            async let auditTask = api.fetchAuditMode()
            runningAgents = try await agentsTask
            topology = try await topologyTask
            dependencyGraph = try await dependenciesTask
            driftGraph = try await driftTask
            auditMode = try await auditTask
        } catch {
            print("[store] Failed to load running agents: \(error)")
        }
    }

    @MainActor
    func rescan(api: APIClient) async {
        do {
            let count = try await api.rescan()
            showToast("Rescan complete: \(count) assets found")
            await loadAll(api: api)
        } catch {
            showToast("Rescan failed")
        }
    }

    @MainActor
    func showToast(_ message: String) {
        toast = message
        Task {
            try? await Task.sleep(for: .seconds(3))
            if toast == message { toast = nil }
        }
    }

    @MainActor
    func toggleAssetSelection(_ asset: Asset) {
        if selectedAssetIDs.contains(asset.id) {
            selectedAssetIDs.remove(asset.id)
        } else {
            selectedAssetIDs.insert(asset.id)
        }
    }

    @MainActor
    func clearAssetSelection() {
        selectedAssetIDs.removeAll()
    }

    @MainActor
    func setMapSelectionMode(_ enabled: Bool) {
        mapSelectionMode = enabled
        if !enabled {
            clearAssetSelection()
        }
    }

    @MainActor
    func selectVisibleAssets() {
        selectedAssetIDs = Set(filteredAssets.map(\.id))
    }

    func topologyNode(kind: String, value: String) -> TopologyNode? {
        topology?.nodes.first { $0.id == "\(kind):\(value)" }
    }

    func projectTopologyNode(projectId: String) -> TopologyNode? {
        topologyNode(kind: "project", value: projectId)
    }

    func environmentTopologyNode(environmentId: String, environmentType: String?) -> TopologyNode? {
        topologyNode(kind: environmentType == "remote" ? "remote_server" : "machine", value: environmentId)
    }

    func auditPolicy(environmentId: String?) -> AuditEnvironmentPolicy? {
        guard let environmentId else { return nil }
        return auditMode?.environments.first(where: { $0.environment_id == environmentId })
    }

    func isEnvironmentReadOnly(_ environmentId: String?) -> Bool {
        globalReadOnly || auditPolicy(environmentId: environmentId)?.read_only == true
    }

    func readOnlyReason(environmentId: String?, environmentName: String? = nil) -> String? {
        if globalReadOnly {
            return "Global read-only audit mode is enabled."
        }
        if let policy = auditPolicy(environmentId: environmentId), policy.read_only {
            return "\(environmentName ?? policy.name) is in read-only audit mode."
        }
        return nil
    }

    func driftGroup(for assetId: String) -> DriftGroup? {
        guard let groupKey = driftGraph?.byAssetId[assetId]?.groupKey else { return nil }
        return driftGraph?.groups.first(where: { $0.key == groupKey })
    }

    func decorateProjectAssets(_ items: [ProjectAsset]) -> [ProjectAsset] {
        let driftByAssetId = driftGraph?.byAssetId ?? [:]
        return items.map { asset in
            var decorated = asset
            decorated.drift = driftByAssetId[asset.id]
            return decorated
        }
    }

    func runningAgentTopologyNode(agentId: String) -> TopologyNode? {
        topologyNode(kind: "running_agent", value: agentId)
    }

    func runningAgentEnvironmentNode(agentId: String) -> TopologyNode? {
        guard let topology else { return nil }
        let fromId = "running_agent:\(agentId)"
        guard let edge = topology.edges.first(where: { $0.kind == "runs_on" && $0.from == fromId }) else { return nil }
        return topology.nodes.first(where: { $0.id == edge.to })
    }

    func assetTopologySnapshot(assetId: String) -> AssetTopologySnapshot {
        guard let topology else { return .empty }
        let fromId = "asset:\(assetId)"
        let nodeMap = Dictionary(uniqueKeysWithValues: topology.nodes.map { ($0.id, $0) })
        let outgoing = topology.edges.filter { $0.from == fromId }
        let incoming = topology.edges.filter { $0.to == fromId }

        return AssetTopologySnapshot(
            environments: outgoing.filter { $0.kind == "discovered_on" }.compactMap { nodeMap[$0.to] },
            projects: outgoing.filter { $0.kind == "belongs_to_project" }.compactMap { nodeMap[$0.to] },
            providers: outgoing.filter { $0.kind == "targets_provider" }.compactMap { edge in
                guard let node = nodeMap[edge.to] else { return nil }
                return AssetTopologyProviderLink(node: node, edge: edge)
            },
            dependsOn: outgoing.filter { $0.kind == "depends_on" }.compactMap { nodeMap[$0.to] },
            dependedOnBy: incoming.filter { $0.kind == "depends_on" }.compactMap { nodeMap[$0.from] },
            runtimeConsumers: outgoing.filter { $0.kind == "loaded_by" }.compactMap { edge in
                guard let node = nodeMap[edge.to] else { return nil }
                return AssetTopologyProviderLink(node: node, edge: edge)
            }
        )
    }

    func focusProject(_ projectId: String) {
        selectedTab = .projects
        focusedProjectID = projectId
    }

    func focusServer(_ serverId: String) {
        selectedTab = .servers
        focusedServerID = serverId
    }

    private func decorateAssets(_ items: [Asset], driftByAssetId: [String: AssetDriftInfo], dependencyByAssetId: [String: AssetDependencyInfo]) -> [Asset] {
        items.map { asset in
            var decorated = asset
            decorated.drift = driftByAssetId[asset.id]
            decorated.dependency = dependencyByAssetId[asset.id]
            return decorated
        }
    }
}

struct AssetTopologyProviderLink: Hashable {
    let node: TopologyNode
    let edge: TopologyEdge
}

struct AssetTopologySnapshot: Hashable {
    let environments: [TopologyNode]
    let projects: [TopologyNode]
    let providers: [AssetTopologyProviderLink]
    let dependsOn: [TopologyNode]
    let dependedOnBy: [TopologyNode]
    let runtimeConsumers: [AssetTopologyProviderLink]

    static let empty = AssetTopologySnapshot(
        environments: [],
        projects: [],
        providers: [],
        dependsOn: [],
        dependedOnBy: [],
        runtimeConsumers: []
    )
}
