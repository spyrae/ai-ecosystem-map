import SwiftUI

enum NavigationTab: String, CaseIterable, Identifiable {
    case map = "Ecosystem Map"
    case projects = "Projects"
    case agents = "Agents"
    case servers = "Servers"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .map: "square.grid.3x3.fill"
        case .projects: "folder.fill"
        case .agents: "sparkles"
        case .servers: "server.rack"
        }
    }
}

struct ContentView: View {
    @Environment(AgentService.self) private var agentService
    @Environment(APIClient.self) private var apiClient
    @Environment(EcosystemStore.self) private var store
    @State private var selectedTab: NavigationTab = .map

    var body: some View {
        NavigationSplitView {
            sidebar
        } detail: {
            detail
        }
        .navigationSplitViewStyle(.balanced)
        .sheet(isPresented: Binding(
            get: { store.showCreate },
            set: { store.showCreate = $0 }
        )) {
            CreateAssetSheet()
        }
        .sheet(isPresented: Binding(
            get: { store.showHistory },
            set: { store.showHistory = $0 }
        )) {
            HistorySheetView()
                .environment(apiClient)
                .environment(store)
        }
        .toolbar {
            ToolbarItemGroup(placement: .automatic) {
                Button {
                    Task { await store.undoLastHistory(api: apiClient) }
                } label: {
                    Label(store.historyBusyKey == "latest" ? "Undoing…" : "Undo Last", systemImage: "arrow.uturn.backward")
                }
                .disabled(store.historyBusyKey != nil || !store.canUndoLastHistory || !apiClient.isReady)

                Button {
                    Task { await store.openHistory(api: apiClient) }
                } label: {
                    Label("History", systemImage: "clock.arrow.circlepath")
                }
                .disabled(store.historyBusyKey != nil || !apiClient.isReady)
            }
        }
        // Global toast overlay
        .overlay(alignment: .bottom) {
            if let toast = store.toast {
                Text(toast)
                    .font(.caption)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
                    .shadow(radius: 8)
                    .padding(.bottom, 20)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .animation(.spring(duration: 0.3), value: store.toast)
            }
        }
    }

    // MARK: - Sidebar

    private var sidebar: some View {
        List(selection: $selectedTab) {
            Section {
                ForEach(NavigationTab.allCases) { tab in
                    Label(tab.rawValue, systemImage: tab.icon)
                        .tag(tab)
                }
            } header: {
                Image("SidebarLogo")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(height: 22)
                    .padding(.bottom, 4)
            }
        }
        .listStyle(.sidebar)
        .safeAreaInset(edge: .bottom) {
            agentStatusFooter
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
        }
        .navigationSplitViewColumnWidth(min: 180, ideal: 200, max: 260)
    }

    private var agentStatusFooter: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(agentService.state.color)
                .frame(width: 8, height: 8)
            Text(agentService.state.label)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Spacer()
            if agentService.state == .running {
                Text(":\(agentService.port)")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .monospacedDigit()
            }
        }
    }

    // MARK: - Detail

    @ViewBuilder
    private var detail: some View {
        switch selectedTab {
        case .map:
            EcosystemMapView()
        case .projects:
            ProjectsListView()
        case .agents:
            RunningAgentsListView()
        case .servers:
            ServersListView()
        }
    }
}

private struct HistorySheetView: View {
    @Environment(APIClient.self) private var apiClient
    @Environment(EcosystemStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if store.historyLoading {
                    VStack(spacing: 12) {
                        ProgressView()
                        Text("Loading history…")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if store.historyEntries.isEmpty {
                    ContentUnavailableView(
                        "No History Yet",
                        systemImage: "clock.arrow.circlepath",
                        description: Text("Recent write operations with reversible snapshots will appear here.")
                    )
                } else {
                    List(store.historyEntries) { entry in
                        HistoryEntryRow(entry: entry)
                    }
                    .listStyle(.inset)
                }
            }
            .navigationTitle("History & Rollback")
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    Button {
                        Task { await store.undoLastHistory(api: apiClient) }
                    } label: {
                        Label(store.historyBusyKey == "latest" ? "Undoing…" : "Undo Last", systemImage: "arrow.uturn.backward")
                    }
                    .disabled(store.historyBusyKey != nil || !store.canUndoLastHistory || !apiClient.isReady)

                    Button("Close") {
                        store.showHistory = false
                        dismiss()
                    }
                }
            }
        }
        .frame(minWidth: 760, minHeight: 520)
        .task {
            if store.historyEntries.isEmpty {
                await store.loadHistory(api: apiClient)
            }
        }
    }
}

private struct HistoryEntryRow: View {
    @Environment(APIClient.self) private var apiClient
    @Environment(EcosystemStore.self) private var store

    let entry: HistoryEntry

    private var isBusy: Bool {
        store.historyBusyKey == String(entry.id)
    }

    private var createdAtText: String {
        let seconds = entry.created_at > 1_000_000_000_000 ? entry.created_at / 1000 : entry.created_at
        return Date(timeIntervalSince1970: seconds).formatted(date: .abbreviated, time: .shortened)
    }

    private var badgeStyle: (label: String, color: Color)? {
        if entry.rolled_back_at != nil {
            return ("Rolled Back", .green)
        }
        if entry.can_rollback == true {
            return ("Undo Available", .accentColor)
        }
        return nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(entry.action)
                            .font(.headline)
                        Text("#\(entry.id)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        if let badgeStyle {
                            Text(badgeStyle.label)
                                .font(.caption2.weight(.semibold))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(badgeStyle.color.opacity(0.12), in: Capsule())
                                .foregroundStyle(badgeStyle.color)
                        }
                    }
                    Text(entry.asset_name)
                        .font(.subheadline)
                    Text(createdAtText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 12)

                Button {
                    Task { await store.rollbackHistory(api: apiClient, historyId: entry.id) }
                } label: {
                    Text(isBusy ? "Rolling back…" : "Rollback")
                }
                .buttonStyle(.bordered)
                .disabled(store.historyBusyKey != nil || entry.can_rollback != true)
            }

            if !entry.details.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    Text(entry.details)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                        .padding(10)
                        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                }
            }
        }
        .padding(.vertical, 6)
    }
}
