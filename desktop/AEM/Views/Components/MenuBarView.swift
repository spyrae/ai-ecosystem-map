import SwiftUI

struct MenuBarView: View {
    @Environment(AgentService.self) private var agentService
    @Environment(EcosystemStore.self) private var store
    @Environment(APIClient.self) private var api

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            // Status
            HStack(spacing: 6) {
                Circle()
                    .fill(agentService.state.color)
                    .frame(width: 8, height: 8)
                Text("Agent: \(agentService.state.label)")
                if agentService.state == .running {
                    Text("(:\(agentService.port))")
                        .foregroundStyle(.secondary)
                }
            }

            Divider()

            // Stats
            if let stats = store.stats {
                Text("\(stats.total) assets")
                    .font(.headline)
                HStack(spacing: 8) {
                    statLabel("Skills", count: stats.skill ?? 0)
                    statLabel("Agents", count: stats.agent ?? 0)
                    statLabel("MCP", count: stats.mcp ?? 0)
                }
            }

            Divider()

            // Actions
            Button("Rescan") {
                Task { await store.rescan(api: api) }
            }
            .keyboardShortcut("r")

            Button("Open AEM") {
                NSApp.activate(ignoringOtherApps: true)
                if let window = NSApp.windows.first(where: { $0.canBecomeMain }) {
                    window.makeKeyAndOrderFront(nil)
                }
            }

            Divider()

            Button("Quit") {
                agentService.stop()
                NSApp.terminate(nil)
            }
            .keyboardShortcut("q")
        }
        .padding(4)
    }

    private func statLabel(_ label: String, count: Int) -> some View {
        Text("\(count) \(label)")
            .font(.caption)
            .foregroundStyle(.secondary)
    }
}
