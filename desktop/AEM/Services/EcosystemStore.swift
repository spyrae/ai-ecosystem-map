import Foundation
import SwiftUI

@Observable
final class EcosystemStore: @unchecked Sendable {
    // Data
    var assets: [Asset] = []
    var stats: Stats?
    var topology: TopologyGraph?
    var categories: [String: Int] = [:]
    var projects: [Project] = []
    var servers: [ServerEnvironment] = []
    var runningAgents: [RunningAgent] = []

    // Filters
    var searchText = ""
    var typeFilter: AssetType?
    var providerFilter: Provider?
    var categoryFilter: String?
    var healthFilter: AssetHealthFilter?

    // UI state
    var isLoading = false
    var showCreate = false
    var selectedAsset: Asset?
    var toast: String?
    var mapSelectionMode = false
    var selectedAssetIDs: Set<String> = []
    var batchTool: Provider = .claude
    var historyEntries: [HistoryEntry] = []
    var showHistory = false
    var historyLoading = false
    var historyBusyKey: String?

    // MARK: - Computed

    var filteredAssets: [Asset] {
        var result = assets

        if let type = typeFilter {
            result = result.filter { $0.type == type }
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
            let cat = asset.cat.isEmpty ? "Other" : asset.cat
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
                map[target.label, default: []].append(source.label)
            }
            return map.mapValues { Array(Set($0)).sorted() }
        }

        var map: [String: [String]] = [:]
        for asset in assets {
            for dep in asset.deps {
                map[dep, default: []].append(asset.name)
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

    var selectedAssets: [Asset] {
        assets.filter { selectedAssetIDs.contains($0.id) }
    }

    var canUndoLastHistory: Bool {
        historyEntries.contains { $0.can_rollback == true }
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
            async let catsTask = api.fetchCategories()
            async let historyTask = api.fetchHistory()
            let (a, s, t, c, h) = try await (assetsTask, statsTask, topologyTask, catsTask, historyTask)
            assets = a
            stats = s
            topology = t
            categories = c
            historyEntries = h
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
            try await api.undoLastAction()
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
            try await api.rollbackHistoryEntry(historyId)
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
            projects = try await projectsTask
            topology = try await topologyTask
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
            servers = try await serversTask
            topology = try await topologyTask
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
            runningAgents = try await agentsTask
            topology = try await topologyTask
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
            dependedOnBy: incoming.filter { $0.kind == "depends_on" }.compactMap { nodeMap[$0.from] }
        )
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

    static let empty = AssetTopologySnapshot(
        environments: [],
        projects: [],
        providers: [],
        dependsOn: [],
        dependedOnBy: []
    )
}
