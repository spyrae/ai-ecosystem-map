import Foundation
import SwiftUI

@Observable
final class EcosystemStore: @unchecked Sendable {
    // Data
    var assets: [Asset] = []
    var stats: Stats?
    var categories: [String: Int] = [:]
    var projects: [Project] = []
    var servers: [ServerEnvironment] = []
    var runningAgents: [RunningAgent] = []

    // Filters
    var searchText = ""
    var typeFilter: AssetType?
    var providerFilter: Provider?
    var categoryFilter: String?

    // UI state
    var isLoading = false
    var showCreate = false
    var selectedAsset: Asset?
    var toast: String?

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
        var map: [String: [String]] = [:]
        for asset in assets {
            for dep in asset.deps {
                map[dep, default: []].append(asset.name)
            }
        }
        return map
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
            async let catsTask = api.fetchCategories()
            let (a, s, c) = try await (assetsTask, statsTask, catsTask)
            assets = a
            stats = s
            categories = c
            print("[store] Loaded \(a.count) assets")
        } catch {
            print("[store] Failed to load: \(error)")
        }
    }

    @MainActor
    func loadProjects(api: APIClient) async {
        guard api.isReady else { return }
        do {
            projects = try await api.fetchProjects()
        } catch {
            print("[store] Failed to load projects: \(error)")
        }
    }

    @MainActor
    func loadServers(api: APIClient) async {
        guard api.isReady else { return }
        do {
            servers = try await api.fetchServers()
        } catch {
            print("[store] Failed to load servers: \(error)")
        }
    }

    @MainActor
    func loadRunningAgents(api: APIClient) async {
        guard api.isReady else { return }
        do {
            runningAgents = try await api.fetchRunningAgents()
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
}
