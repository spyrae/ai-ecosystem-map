import SwiftUI

struct EcosystemMapView: View {
    @Environment(EcosystemStore.self) private var store
    @Environment(APIClient.self) private var api
    @State private var showFilters = true
    @State private var isBatchRunning = false
    @State private var showBatchDeleteConfirmation = false

    var body: some View {
        @Bindable var store = store

        VStack(spacing: 0) {
            // Top bar: search + actions
            topBar

            if store.globalReadOnly {
                Text("Global read-only audit mode is enabled. Create, connect, disconnect, delete, and apply actions are disabled.")
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(Color.orange.opacity(0.08))
            }

            // Stats bar
            if let stats = store.stats {
                StatsBarView(stats: stats, healthCounts: store.healthCounts)
            }

            // Content: optional filter sidebar + cards
            HStack(spacing: 0) {
                if showFilters {
                    FilterSidebarView()
                        .frame(width: 180)
                    Divider()
                }

                // Cards grid
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 20) {
                        if store.isLoading {
                            ProgressView()
                                .frame(maxWidth: .infinity, minHeight: 200)
                        } else if store.filteredAssets.isEmpty {
                            ContentUnavailableView(
                                "No items match your filters",
                                systemImage: "magnifyingglass",
                                description: Text("Try adjusting your search or filters")
                            )
                            .frame(maxWidth: .infinity, minHeight: 300)
                        } else {
                            ForEach(store.groupedAssets, id: \.0) { category, assets in
                                CategorySectionView(
                                    category: category,
                                    assets: assets,
                                    usedByMap: store.usedByMap,
                                    selectionMode: store.mapSelectionMode,
                                    selectedAssetIDs: store.selectedAssetIDs,
                                    onToggleSelection: { asset in
                                        store.toggleAssetSelection(asset)
                                    }
                                )
                            }
                        }
                    }
                    .padding(16)
                }
            }
        }
        .inspector(isPresented: Binding(
            get: { store.selectedAsset != nil },
            set: { if !$0 { store.selectedAsset = nil } }
        )) {
            if let asset = store.selectedAsset {
                AssetDetailView(asset: asset)
                    .inspectorColumnWidth(min: 280, ideal: 340, max: 450)
            }
        }
        .alert("Delete Selected Assets?", isPresented: $showBatchDeleteConfirmation) {
            Button("Delete", role: .destructive) {
                Task { await runBatchDelete() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            let impactedAssets = store.selectedAssets.filter { ($0.dependency?.consumerCount ?? 0) > 0 }
            let totalConsumers = impactedAssets.reduce(0) { $0 + ($1.dependency?.consumerCount ?? 0) }
            if impactedAssets.isEmpty {
                Text("This will delete \(store.selectedAssets.count) selected assets and cannot be undone.")
            } else {
                Text("This will delete \(store.selectedAssets.count) selected assets. \(impactedAssets.count) of them have downstream consumers (\(totalConsumers) total assets, running agents, or provider targets), and this cannot be undone.")
            }
        }
    }

    private var topBar: some View {
        HStack(spacing: 8) {
            // Toggle filters
            Button {
                withAnimation { showFilters.toggle() }
            } label: {
                Image(systemName: "line.3.horizontal.decrease")
            }
            .buttonStyle(.plain)
            .help(showFilters ? "Hide Filters" : "Show Filters")

            // Search
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.tertiary)
                    .font(.caption)
                TextField("Search assets...", text: Binding(
                    get: { store.searchText },
                    set: { store.searchText = $0 }
                ))
                .textFieldStyle(.plain)
                .font(.body)
                if !store.searchText.isEmpty {
                    Button { store.searchText = "" } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.tertiary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 6))

            Spacer()

            if store.mapSelectionMode {
                                    Text("\(store.selectedAssets.count) selected")
                                        .font(.caption.weight(.medium))
                                        .foregroundStyle(Color.accentColor)
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 5)
                                        .background(Color.accentColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 6))

                Button("Select Visible") {
                    store.selectVisibleAssets()
                }
                .controlSize(.small)
                .disabled(isBatchRunning || store.filteredAssets.isEmpty)

                Button("Clear") {
                    store.clearAssetSelection()
                }
                .controlSize(.small)
                .disabled(isBatchRunning || store.selectedAssets.isEmpty)

                Picker("Provider", selection: Binding(
                    get: { store.batchTool },
                    set: { store.batchTool = $0 }
                )) {
                    ForEach(Provider.allCases) { provider in
                        Text(provider.label).tag(provider)
                    }
                }
                .pickerStyle(.menu)
                .controlSize(.small)
                .frame(width: 150)
                .disabled(isBatchRunning)

                Button("Validate Selected") {
                    Task { await runBatchValidate() }
                }
                .controlSize(.small)
                .disabled(isBatchRunning || store.selectedAssets.isEmpty)

                Button("Connect Selected") {
                    Task { await runBatchConnect(mode: .connect) }
                }
                .controlSize(.small)
                .disabled(store.globalReadOnly || isBatchRunning || store.selectedAssets.isEmpty)

                Button("Disconnect Selected") {
                    Task { await runBatchConnect(mode: .disconnect) }
                }
                .controlSize(.small)
                .disabled(store.globalReadOnly || isBatchRunning || store.selectedAssets.isEmpty)

                Button("Delete Selected", role: .destructive) {
                    showBatchDeleteConfirmation = true
                }
                .controlSize(.small)
                .disabled(store.globalReadOnly || isBatchRunning || store.selectedAssets.isEmpty)
            }

            Button {
                Task { await store.rescan(api: api) }
            } label: {
                Label("Rescan", systemImage: "arrow.clockwise")
                    .font(.caption)
            }
            .controlSize(.small)

            Button {
                store.setMapSelectionMode(!store.mapSelectionMode)
            } label: {
                Label(store.mapSelectionMode ? "Done" : "Select", systemImage: store.mapSelectionMode ? "checkmark.circle" : "checkmark.circle.badge.plus")
                    .font(.caption)
            }
            .controlSize(.small)

            Button {
                store.showCreate = true
            } label: {
                Label("Create", systemImage: "plus")
                    .font(.caption)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
            .disabled(store.globalReadOnly)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.bar)
    }

    @MainActor
    private func batchItems() -> [BatchActionItem] {
        store.selectedAssets.map { asset in
            BatchActionItem(
                assetId: asset.id,
                name: asset.name,
                type: asset.type.rawValue,
                filePath: asset.filePath,
                providers: asset.providers,
                projectPath: nil,
                scope: "local"
            )
        }
    }

    private enum BatchConnectMode {
        case connect
        case disconnect
    }

    private func runBatchValidate() async {
        let items = await MainActor.run { batchItems() }
        guard !items.isEmpty else { return }
        isBatchRunning = true
        defer { isBatchRunning = false }

        do {
            let result = try await api.validateBatch(items)
            await MainActor.run {
                store.showToast("Validated \(result.total): \(result.okCount ?? 0) ok, \(result.warningCount ?? 0) warnings, \(result.brokenCount ?? 0) broken")
            }
            await store.loadAll(api: api)
        } catch {
            await MainActor.run {
                store.showToast("Batch validation failed: \(error.localizedDescription)")
            }
        }
    }

    private func runBatchConnect(mode: BatchConnectMode) async {
        let items = await MainActor.run { batchItems() }
        let tool = await MainActor.run { store.batchTool.rawValue }
        guard !items.isEmpty else { return }
        isBatchRunning = true
        defer { isBatchRunning = false }

        do {
            let result: BatchActionResult
            switch mode {
            case .connect:
                result = try await api.connectBatch(items, tool: tool)
            case .disconnect:
                result = try await api.disconnectBatch(items, tool: tool)
            }
            await MainActor.run {
                let verb = mode == .connect ? "Connected" : "Disconnected"
                store.showToast("\(verb) \(result.successCount ?? 0)/\(result.total) for \(store.batchTool.label)")
            }
            await store.loadAll(api: api)
        } catch {
            await MainActor.run {
                store.showToast("Batch action failed: \(error.localizedDescription)")
            }
        }
    }

    private func runBatchDelete() async {
        let items = await MainActor.run { batchItems() }
        guard !items.isEmpty else { return }
        isBatchRunning = true
        defer { isBatchRunning = false }

        do {
            let result = try await api.deleteBatch(items, approval: .client("macos", note: "Confirmed batch delete from ecosystem map"))
            await MainActor.run {
                let failedIds = Set(result.results.filter { !$0.ok }.map(\.id))
                store.selectedAssetIDs = failedIds
                store.mapSelectionMode = !failedIds.isEmpty
                store.showToast("Deleted \(result.successCount ?? 0)/\(result.total) selected assets")
            }
            await store.loadAll(api: api)
        } catch {
            await MainActor.run {
                store.showToast("Batch delete failed: \(error.localizedDescription)")
            }
        }
    }
}

// MARK: - Stats Bar

struct StatsBarView: View {
    let stats: Stats
    let healthCounts: [AssetHealthFilter: Int]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                statPill("Total", count: stats.total, icon: "square.grid.3x3")
                Divider().frame(height: 14)
                statPill("Skills", count: stats.skill ?? 0, icon: "terminal.fill")
                statPill("Agents", count: stats.agent ?? 0, icon: "sparkles")
                statPill("MCP", count: stats.mcp ?? 0, icon: "server.rack")
                statPill("Rules", count: stats.rule ?? 0, icon: "checklist")
                statPill("Instr", count: stats.instruction ?? 0, icon: "doc.text.fill")
                statPill("Broken", count: healthCounts[.broken] ?? 0, icon: "exclamationmark.octagon.fill")
                statPill("Warnings", count: healthCounts[.warning] ?? 0, icon: "exclamationmark.triangle.fill")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 4)
        }
        .background(.bar)
        .font(.caption2)
    }

    private func statPill(_ label: String, count: Int, icon: String) -> some View {
        HStack(spacing: 3) {
            Image(systemName: icon)
                .foregroundStyle(.tertiary)
                .imageScale(.small)
            Text("\(count)")
                .fontWeight(.medium)
                .monospacedDigit()
            Text(label)
                .foregroundStyle(.secondary)
        }
    }
}
