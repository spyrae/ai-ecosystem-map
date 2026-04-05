import SwiftUI

struct RunningAgentsListView: View {
    @Environment(APIClient.self) private var api
    @Environment(EcosystemStore.self) private var store
    @State private var showAddAgent = false
    @State private var expandedTools: [String: [McpTool]] = [:]

    var body: some View {
        VStack(spacing: 0) {
            // Toolbar
            HStack {
                Text("Running Agents").font(.headline)
                Spacer()
                Button { showAddAgent = true } label: {
                    Label("Add Agent", systemImage: "plus")
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(.bar)

            // Content
            if store.runningAgents.isEmpty {
                ContentUnavailableView(
                    "No Running Agents",
                    systemImage: "sparkles",
                    description: Text("Add agent endpoints to inspect their tools")
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    ForEach(store.runningAgents) { agent in
                        DisclosureGroup {
                            if let tools = expandedTools[agent.id] {
                                ForEach(tools) { tool in
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(tool.name)
                                            .font(.caption.monospaced().weight(.medium))
                                        Text(tool.description)
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                            .lineLimit(2)
                                    }
                                    .padding(.vertical, 2)
                                }
                            } else {
                                Button("Load Tools") {
                                    let api = api
                                    Task {
                                        expandedTools[agent.id] = try? await api.listAgentTools(id: agent.id)
                                    }
                                }
                            }
                        } label: {
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(agent.name).font(.body.weight(.medium))
                                    Text(agent.url).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                if let tools = expandedTools[agent.id] {
                                    Text("\(tools.count) tools")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        .contextMenu {
                            Button("Delete", role: .destructive) {
                                let api = api
                                let store = store
                                Task {
                                    try? await api.removeRunningAgent(id: agent.id)
                                    await store.loadRunningAgents(api: api)
                                }
                            }
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: api.isReady) {
            guard api.isReady else { return }
            await store.loadRunningAgents(api: api)
        }
        .sheet(isPresented: $showAddAgent) {
            AddRunningAgentSheet()
        }
    }
}

// MARK: - Add Running Agent Sheet

struct AddRunningAgentSheet: View {
    @Environment(APIClient.self) private var api
    @Environment(EcosystemStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var url = "http://localhost:"
    @State private var description = ""
    @State private var protocolType = "mcp"

    var body: some View {
        VStack(spacing: 16) {
            Text("Add Running Agent").font(.headline)

            Form {
                TextField("Name", text: $name)
                TextField("URL", text: $url)
                TextField("Description", text: $description)
                Picker("Protocol", selection: $protocolType) {
                    Text("MCP").tag("mcp")
                    Text("HTTP").tag("http")
                    Text("A2A").tag("a2a")
                }
            }
            .formStyle(.grouped)

            HStack {
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Spacer()
                Button("Add") {
                    let api = api
                    let store = store
                    Task {
                        _ = try? await api.addRunningAgent(
                            name: name, url: url, description: description, protocol: protocolType
                        )
                        await store.loadRunningAgents(api: api)
                        dismiss()
                    }
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .disabled(name.isEmpty || url.isEmpty)
            }
            .padding(.horizontal)
        }
        .padding()
        .frame(width: 400)
    }
}
