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
