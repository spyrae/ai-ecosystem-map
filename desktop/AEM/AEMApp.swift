import SwiftUI

@main
struct AEMApp: App {
    @State private var agentService = AgentService()
    @State private var apiClient = APIClient()
    @State private var wsClient = WebSocketClient()
    @State private var store = EcosystemStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(agentService)
                .environment(apiClient)
                .environment(wsClient)
                .environment(store)
                .frame(minWidth: 900, minHeight: 600)
                .task { await bootstrap() }
                .task(id: agentService.state) { await syncAgentReadiness() }
        }
        .defaultSize(width: 1200, height: 800)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Asset...") { store.showCreate = true }
                    .keyboardShortcut("n", modifiers: .command)
            }
            CommandGroup(after: .toolbar) {
                Button("Rescan") { Task { await store.rescan(api: apiClient) } }
                    .keyboardShortcut("r", modifiers: .command)
                Button("History") { Task { await store.openHistory(api: apiClient) } }
                    .keyboardShortcut("h", modifiers: [.command, .shift])
                Button("Undo Last Harness Change") { Task { await store.undoLastHistory(api: apiClient) } }
                    .keyboardShortcut("z", modifiers: [.command, .option])
                    .disabled(!store.canUndoLastHistory || store.historyBusyKey != nil)
            }
        }

        Settings {
            SettingsView()
                .environment(agentService)
        }

        MenuBarExtra("AEM", image: "MenuBarIcon") {
            MenuBarView()
                .environment(agentService)
                .environment(store)
                .environment(apiClient)
        }
    }

    private func bootstrap() async {
        apiClient.baseURL = agentService.baseURL

        let autoStart = UserDefaults.standard.object(forKey: "agentAutoStart") as? Bool ?? true
        if autoStart {
            agentService.start()
        }

        // Wait for agent to be ready
        let attempts = autoStart ? 30 : 1
        for _ in 0..<attempts {
            if await agentService.healthCheck() { break }
            try? await Task.sleep(for: .milliseconds(500))
        }
        await syncAgentReadiness()
    }

    private func syncAgentReadiness() async {
        apiClient.baseURL = agentService.baseURL
        let isReady = await agentService.healthCheck()
        apiClient.isReady = isReady

        guard isReady else { return }

        print("[app] API ready at \(apiClient.baseURL)")

        wsClient.disconnect()
        wsClient.connect(url: agentService.wsURL)
        wsClient.onMessage = { (event: AgentEvent) in
            if case .assetsUpdated = event {
                Task { await store.loadAll(api: apiClient) }
            }
        }

        await store.loadAll(api: apiClient)
    }
}
