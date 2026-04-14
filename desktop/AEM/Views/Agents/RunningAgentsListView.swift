import SwiftUI

struct RunningAgentsListView: View {
    @Environment(APIClient.self) private var api
    @Environment(EcosystemStore.self) private var store
    @State private var showAddAgent = false
    @State private var expandedAgentIDs: Set<String> = []
    @State private var checkingIDs: Set<String> = []
    @State private var introspectionErrors: [String: String] = [:]

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Running Agents").font(.headline)
                    Text("Inspect running MCP agents and compare file-only, loaded, and active runtime assets.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button { showAddAgent = true } label: {
                    Label("Add Agent", systemImage: "plus")
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(.bar)

            if store.runningAgents.isEmpty {
                ContentUnavailableView(
                    "No Running Agents",
                    systemImage: "sparkles",
                    description: Text("Add MCP-compatible endpoints to inspect what the runtime actually picked up.")
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    ForEach(store.runningAgents) { agent in
                        DisclosureGroup(isExpanded: binding(for: agent.id)) {
                            runtimeDetails(for: agent)
                                .padding(.top, 6)
                        } label: {
                            agentSummaryRow(agent)
                        }
                        .contextMenu {
                            Button("Refresh Runtime") {
                                Task { await runIntrospection(agentId: agent.id) }
                            }
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

    private func binding(for agentId: String) -> Binding<Bool> {
        Binding(
            get: { expandedAgentIDs.contains(agentId) },
            set: { isExpanded in
                if isExpanded {
                    expandedAgentIDs.insert(agentId)
                } else {
                    expandedAgentIDs.remove(agentId)
                }
            }
        )
    }

    @ViewBuilder
    private func agentSummaryRow(_ agent: RunningAgent) -> some View {
        let topologyNode = store.runningAgentTopologyNode(agentId: agent.id)
        let environmentNode = store.runningAgentEnvironmentNode(agentId: agent.id)
        let introspection = agent.introspection

        HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(introspectionColor(introspection?.status))
                .frame(width: 10, height: 10)
                .padding(.top, 4)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(agent.name)
                        .font(.body.weight(.medium))
                    Text(agent.protocol_type ?? "mcp")
                        .font(.caption2.monospaced())
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.accentColor.opacity(0.15))
                        .foregroundStyle(Color.accentColor)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                    statusChip(introspection?.status ?? "unknown")
                }

                Text(agent.url)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)

                if !agent.description.isEmpty {
                    Text(agent.description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                if let summary = runningAgentSummary(environmentNode: environmentNode, topologyNode: topologyNode, introspection: introspection) {
                    Text(summary)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .lineLimit(2)
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 6) {
                Button(checkingIDs.contains(agent.id) ? "Checking..." : (agent.introspection?.checkedAt == nil ? "Run Introspection" : "Refresh Runtime")) {
                    Task { await runIntrospection(agentId: agent.id) }
                }
                .buttonStyle(.bordered)
                .disabled(checkingIDs.contains(agent.id))

                Button("Delete", role: .destructive) {
                    let api = api
                    let store = store
                    Task {
                        try? await api.removeRunningAgent(id: agent.id)
                        await store.loadRunningAgents(api: api)
                    }
                }
                .buttonStyle(.borderless)
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func runtimeDetails(for agent: RunningAgent) -> some View {
        if let introspection = agent.introspection {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Text("Runtime Status")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        statusChip(introspection.status)
                    }
                    Text(introspection.summary)
                        .font(.callout)
                    Text(runtimeMetadata(introspection))
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }

                if let error = introspectionErrors[agent.id], !error.isEmpty {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                }

                HStack(spacing: 12) {
                    metricCard("Configured", value: introspection.configuredCount)
                    metricCard("Loaded", value: introspection.loadedCount)
                    metricCard("Active Assets", value: introspection.activeCount)
                    metricCard("Active Tools", value: introspection.activeToolCount)
                }

                if !introspection.details.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Diagnostics")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        ForEach(Array(introspection.details.enumerated()), id: \.offset) { entry in
                            Text(entry.element)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                if !introspection.activeTools.isEmpty {
                    runtimeToolSection(title: "Active Tools", tools: introspection.activeTools)
                }

                runtimeAssetSection(
                    title: "Loaded Assets",
                    assets: introspection.assets.filter { $0.state == "loaded" }
                )

                runtimeAssetSection(
                    title: "Active Assets",
                    assets: introspection.assets.filter { $0.state == "active" }
                )

                let configured = introspection.assets.filter { $0.state == "configured" }
                if !configured.isEmpty {
                    runtimeAssetSection(
                        title: configured.count > 12 ? "File-only Assets (showing 12 of \(configured.count))" : "File-only Assets",
                        assets: Array(configured.prefix(12))
                    )
                }
            }
            .padding(.leading, 8)
            .padding(.bottom, 6)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Text("No runtime probe has been executed for this agent yet.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("Run Introspection") {
                    Task { await runIntrospection(agentId: agent.id) }
                }
                .buttonStyle(.borderedProminent)
                .disabled(checkingIDs.contains(agent.id))
            }
            .padding(.leading, 8)
            .padding(.bottom, 6)
        }
    }

    @ViewBuilder
    private func runtimeToolSection(title: String, tools: [RunningAgentActiveTool]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(title) (\(tools.count))")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            ForEach(tools) { tool in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(tool.name)
                            .font(.caption.monospaced().weight(.medium))
                        Text(tool.state)
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(tool.state == "matched" ? .green : .secondary)
                    }
                    if !tool.description.isEmpty {
                        Text(tool.description)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(3)
                    }
                }
                .padding(8)
                .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 10))
            }
        }
    }

    @ViewBuilder
    private func runtimeAssetSection(title: String, assets: [RunningAgentAssetState]) -> some View {
        if !assets.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("\(title) (\(assets.count))")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                ForEach(assets) { asset in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 8) {
                            Text(asset.name)
                                .font(.caption.weight(.medium))
                            Text(asset.type.rawValue)
                                .font(.caption2.monospaced())
                                .padding(.horizontal, 5)
                                .padding(.vertical, 2)
                                .background(.quaternary.opacity(0.45), in: Capsule())
                            if let projectName = asset.projectName {
                                Text(projectName)
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                        }
                        Text(asset.detail)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(3)
                    }
                    .padding(8)
                    .background(.quaternary.opacity(0.25), in: RoundedRectangle(cornerRadius: 10))
                }
            }
        }
    }

    private func metricCard(_ title: String, value: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            Text("\(value)")
                .font(.title3.weight(.semibold))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 10))
    }

    private func statusChip(_ status: String) -> some View {
        Text(status.uppercased())
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(introspectionColor(status).opacity(0.14), in: Capsule())
            .foregroundStyle(introspectionColor(status))
    }

    private func introspectionColor(_ status: String?) -> Color {
        switch status {
        case "ok": return .green
        case "warning": return .yellow
        case "broken": return .red
        default: return .secondary
        }
    }

    private func runningAgentSummary(environmentNode: TopologyNode?, topologyNode: TopologyNode?, introspection: RunningAgentIntrospection?) -> String? {
        var items: [String] = []
        if let environmentNode {
            items.append("Runs on \(environmentNode.label)")
        }
        if let introspection {
            if introspection.activeCount > 0 { items.append("\(introspection.activeCount) active assets") }
            if introspection.loadedCount > 0 { items.append("\(introspection.loadedCount) loaded") }
            if introspection.configuredCount > 0 { items.append("\(introspection.configuredCount) file-only") }
            if introspection.activeToolCount > 0 { items.append("\(introspection.activeToolCount) tools") }
        } else if let badges = topologyNode?.badges, !badges.isEmpty {
            items.append(contentsOf: badges)
        }
        return items.isEmpty ? nil : items.joined(separator: " · ")
    }

    private func runtimeMetadata(_ introspection: RunningAgentIntrospection) -> String {
        var segments: [String] = []
        if let checkedAt = introspection.checkedAt,
           let date = ISO8601DateFormatter().date(from: checkedAt) {
            segments.append("Checked \(date.formatted(date: .abbreviated, time: .shortened))")
        }
        if let durationMs = introspection.durationMs {
            segments.append("\(durationMs) ms")
        }
        if introspection.cached {
            segments.append(introspection.stale ? "cached (stale)" : "cached")
        } else {
            segments.append("fresh")
        }
        segments.append(introspection.reachable ? "reachable" : "unreachable")
        return segments.joined(separator: " · ")
    }

    @MainActor
    private func runIntrospection(agentId: String) async {
        checkingIDs.insert(agentId)
        introspectionErrors[agentId] = nil
        do {
            let result = try await api.runRunningAgentIntrospection(id: agentId)
            store.showToast(result.summary)
            await store.loadRunningAgents(api: api)
            expandedAgentIDs.insert(agentId)
        } catch {
            introspectionErrors[agentId] = error.localizedDescription
            store.showToast(error.localizedDescription.isEmpty ? "Running agent introspection failed" : error.localizedDescription)
        }
        checkingIDs.remove(agentId)
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

    var body: some View {
        VStack(spacing: 16) {
            Text("Add Running Agent").font(.headline)

            Form {
                TextField("Name", text: $name)
                TextField("URL", text: $url)
                TextField("Description", text: $description)
                LabeledContent("Protocol", value: "MCP")
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
                            name: name, url: url, description: description, protocol: "mcp"
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
        .frame(width: 420)
    }
}
