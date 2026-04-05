import SwiftUI

struct SettingsView: View {
    @Environment(AgentService.self) private var agentService
    @AppStorage("agentPort") private var agentPort = 3000
    @AppStorage("agentAutoStart") private var autoStart = true
    @AppStorage("nodePath") private var nodePath = ""

    var body: some View {
        TabView {
            generalTab
                .tabItem { Label("General", systemImage: "gear") }

            appearanceTab
                .tabItem { Label("Appearance", systemImage: "paintbrush") }

            advancedTab
                .tabItem { Label("Advanced", systemImage: "wrench.and.screwdriver") }
        }
        .frame(width: 450, height: 300)
    }

    private var generalTab: some View {
        Form {
            Section("Agent") {
                TextField("Port", value: $agentPort, format: .number)
                Toggle("Auto-start agent on launch", isOn: $autoStart)
            }
            Section("Node.js") {
                TextField("Custom path (leave empty for auto-detect)", text: $nodePath)
                    .font(.system(.body, design: .monospaced))
            }
        }
        .formStyle(.grouped)
    }

    private var appearanceTab: some View {
        Form {
            Section("Theme") {
                Text("Follows system appearance")
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }

    private var advancedTab: some View {
        Form {
            Section("Agent") {
                LabeledContent("Status", value: agentService.state.label)
                HStack {
                    Button("Restart Agent") { agentService.restart() }
                    Button("Stop Agent") { agentService.stop() }
                        .foregroundStyle(.red)
                }
            }
        }
        .formStyle(.grouped)
    }
}
