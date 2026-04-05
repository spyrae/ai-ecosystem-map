import SwiftUI

struct EcosystemMapView: View {
    @Environment(EcosystemStore.self) private var store
    @Environment(APIClient.self) private var api
    @State private var showFilters = true

    var body: some View {
        @Bindable var store = store

        VStack(spacing: 0) {
            // Top bar: search + actions
            topBar

            // Stats bar
            if let stats = store.stats {
                StatsBarView(stats: stats)
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
                                    usedByMap: store.usedByMap
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

            Button {
                Task { await store.rescan(api: api) }
            } label: {
                Label("Rescan", systemImage: "arrow.clockwise")
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
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.bar)
    }
}

// MARK: - Stats Bar

struct StatsBarView: View {
    let stats: Stats

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
