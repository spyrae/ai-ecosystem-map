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
        agentService.start()

        // Wait for agent to be ready
        for _ in 0..<30 {
            if await agentService.healthCheck() { break }
            try? await Task.sleep(for: .milliseconds(500))
        }

        // Mark API as ready and set URL
        apiClient.baseURL = agentService.baseURL
        apiClient.isReady = true

        print("[app] API ready at \(apiClient.baseURL)")

        // Connect WebSocket
        wsClient.connect(url: agentService.wsURL)
        wsClient.onMessage = { (event: AgentEvent) in
            if case .assetsUpdated = event {
                Task { await store.loadAll(api: apiClient) }
            }
        }

        // Initial data load
        await store.loadAll(api: apiClient)
    }
}
