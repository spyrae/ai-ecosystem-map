import SwiftUI

struct AssetDetailView: View {
    let asset: Asset

    @Environment(APIClient.self) private var api
    @Environment(EcosystemStore.self) private var store
    @State private var content = ""
    @State private var originalContent = ""
    @State private var isLoadingContent = true
    @State private var connections: [String: ConnectionInfo] = [:]
    @State private var mcpRuntime: McpRuntimeCheck?
    @State private var runtimeError: String?
    @State private var isCheckingRuntime = false
    @State private var remediations: [RemediationSuggestion] = []
    @State private var isLoadingRemediations = false
    @State private var applyingRemediationID: String?
    @State private var showDeleteConfirm = false
    @State private var sourceOfTruthBusyAssetID: String?

    private var dependency: AssetDependencyInfo? {
        asset.dependency
    }

    private var readOnlyReason: String? {
        store.readOnlyReason(
            environmentId: asset.environment_id,
            environmentName: store.auditPolicy(environmentId: asset.environment_id)?.name
        )
    }

    var hasUnsavedChanges: Bool {
        !isLoadingContent && !content.isEmpty && content != originalContent
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if let readOnlyReason {
                    Text(readOnlyReason + " Edit, connect, delete, and source-of-truth actions are disabled.")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                }
                metadataSection
                capabilitySection
                driftSection
                dependencySection
                topologySection
                healthSection
                remediationSection
                runtimeSection
                connectionsSection
                depsSection
                editorSection
            }
            .padding(16)
        }
        .toolbar {
            ToolbarItem {
                if hasEditableContent && hasUnsavedChanges {
                    Button("Save") { Task { await save() } }
                        .keyboardShortcut("s", modifiers: .command)
                        .disabled(store.globalReadOnly)
                }
            }
            ToolbarItem {
                Button(role: .destructive) {
                    showDeleteConfirm = true
                } label: {
                    Image(systemName: "trash")
                }
                .disabled(store.globalReadOnly || !asset.canDelete)
            }
        }
        .alert("Delete \(asset.name)?", isPresented: $showDeleteConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) { Task { await deleteAsset() } }
        } message: {
            if let dependency, dependency.consumerCount > 0 {
                Text("This will permanently delete the asset file. It also affects \(dependency.consumerCount) downstream consumers across assets, running agents, and provider connections.")
            } else {
                Text("This will permanently delete the asset file.")
            }
        }
        .task { await loadContent() }
        .task { await loadConnections() }
        .task(id: "\(asset.id)|\(asset.runtime?.checkedAt ?? "none")") {
            syncRuntimeFromAsset()
        }
        .task(id: remediationTaskKey) {
            await loadRemediations()
        }
    }

    // MARK: - Sections

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: asset.type.icon)
                    .font(.title3)
                Text(asset.name)
                    .font(.title2.weight(.semibold))
                    .textSelection(.enabled)
            }

            if !asset.desc.isEmpty {
                Text(asset.desc)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 4) {
                Label(asset.type.label, systemImage: asset.type.icon)
                    .font(.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(.quaternary, in: Capsule())

                Label(asset.cat, systemImage: "tag")
                    .font(.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(.quaternary, in: Capsule())
            }
        }
    }

    private var metadataSection: some View {
        GroupBox("File") {
            VStack(alignment: .leading, spacing: 4) {
                if let fp = asset.filePath, !fp.isEmpty {
                    HStack {
                        Text(fp)
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                        Spacer()
                        Button {
                            NSWorkspace.shared.selectFile(fp, inFileViewerRootedAtPath: "")
                        } label: {
                            Image(systemName: "folder")
                        }
                        .buttonStyle(.plain)
                        .help("Reveal in Finder")
                    }
                } else {
                    Text(asset.type == .mcp ? "Configured in .mcp.json" : "No file path available")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
        }
    }

    @ViewBuilder
    private var capabilitySection: some View {
        if let capabilities = asset.capabilities {
            GroupBox("Capability Matrix") {
                VStack(alignment: .leading, spacing: 10) {
                    let items = capabilities.summary.compactItems
                    if !items.isEmpty {
                        FlowLayout(spacing: 4) {
                            ForEach(items, id: \.self) { item in
                                Text(item)
                                    .font(.caption2)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(.quaternary, in: Capsule())
                            }
                        }
                    }

                    ForEach(capabilities.providers) { entry in
                        VStack(alignment: .leading, spacing: 5) {
                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(entry.label)
                                        .font(.caption.weight(.semibold))
                                    Text(entry.detail)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                    if let targetPath = entry.targetPath, !targetPath.isEmpty {
                                        Text(targetPath)
                                            .font(.caption2.monospaced())
                                            .foregroundStyle(.tertiary)
                                            .textSelection(.enabled)
                                    }
                                }
                                Spacer()
                                Text(entry.state.label)
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(entry.state.tint)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 3)
                                    .background(entry.state.tint.opacity(0.12), in: Capsule())
                            }
                        }
                        .padding(8)
                        .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var driftSection: some View {
        if let drift = asset.drift, let group = store.driftGroup(for: asset.id) {
            GroupBox("Drift Map") {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(group.summary)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text("\(group.copyCount) copies")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                        Spacer()
                        Text(drift.status.label)
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(drift.status.tint.opacity(0.12), in: Capsule())
                            .foregroundStyle(drift.status.tint)
                    }

                    ForEach(group.members) { member in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack(spacing: 6) {
                                        Text(member.name)
                                            .font(.caption.monospaced())
                                        Text(member.locationLabel)
                                            .font(.caption2)
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 2)
                                            .background(.quaternary, in: Capsule())
                                            .foregroundStyle(.secondary)
                                    }

                                    Text(member.summary)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)

                                    if let filePath = member.filePath, !filePath.isEmpty {
                                        Text(filePath)
                                            .font(.caption2.monospaced())
                                            .foregroundStyle(.tertiary)
                                            .textSelection(.enabled)
                                    }
                                }

                                Spacer(minLength: 12)

                                VStack(alignment: .trailing, spacing: 6) {
                                    Text(member.status.label)
                                        .font(.caption2.weight(.semibold))
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 3)
                                        .background(member.status.tint.opacity(0.12), in: Capsule())
                                        .foregroundStyle(member.status.tint)

                                    if let projectId = member.projectId {
                                        Button("Open Project") {
                                            store.focusProject(projectId)
                                        }
                                        .buttonStyle(.bordered)
                                        .controlSize(.small)
                                    } else if member.environmentType == "remote", let environmentId = member.environmentId {
                                        Button("Open Server Diff") {
                                            store.focusServer(environmentId)
                                        }
                                        .buttonStyle(.bordered)
                                        .controlSize(.small)
                                    }

                                    if !member.sourceOfTruth {
                                        Button(sourceOfTruthBusyAssetID == member.assetId ? "Updating…" : "Make Source") {
                                            Task { await makeSourceOfTruth(groupKey: group.key, assetId: member.assetId) }
                                        }
                                        .buttonStyle(.bordered)
                                        .controlSize(.small)
                                        .disabled(store.globalReadOnly || sourceOfTruthBusyAssetID != nil)
                                    }
                                }
                            }

                            if !member.reasons.isEmpty {
                                FlowLayout(spacing: 4) {
                                    ForEach(member.reasons) { reason in
                                        Text(reason.message)
                                            .font(.caption2)
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 2)
                                            .background(Color.orange.opacity(0.12), in: Capsule())
                                            .foregroundStyle(.orange)
                                    }
                                }
                            }
                        }
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var dependencySection: some View {
        if let dependency {
            GroupBox("Dependency Graph") {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(dependency.summary)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            if dependency.orphaned {
                                Text("Unused asset")
                                    .font(.caption2.weight(.semibold))
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 3)
                                    .background(Color.red.opacity(0.12), in: Capsule())
                                    .foregroundStyle(.red)
                            }
                        }
                        Spacer()
                    }

                    HStack(spacing: 8) {
                        dependencyMetric("Deps", value: dependency.dependencyCount, tint: .purple)
                        dependencyMetric("Consumers", value: dependency.consumerCount, tint: .green)
                        dependencyMetric("Assets", value: dependency.assetConsumerCount, tint: .blue)
                        dependencyMetric("Agents", value: dependency.runtimeConsumerCount, tint: .orange)
                        dependencyMetric("Providers", value: dependency.providerConsumerCount, tint: .secondary)
                    }

                    if !dependency.dependsOn.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Depends On")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            FlowLayout(spacing: 4) {
                                ForEach(dependency.dependsOn) { ref in
                                    topologyPill(ref.name, tint: .purple)
                                }
                            }
                        }
                    }

                    if !dependency.dependedOnBy.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Used By Assets")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            FlowLayout(spacing: 4) {
                                ForEach(dependency.dependedOnBy) { ref in
                                    topologyPill(ref.name, tint: .green)
                                }
                            }
                        }
                    }

                    if !dependency.runtimeConsumers.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Running Agents")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            FlowLayout(spacing: 4) {
                                ForEach(dependency.runtimeConsumers) { consumer in
                                    topologyPill("\(consumer.name) · \(consumer.state)", tint: .orange)
                                }
                            }
                        }
                    }

                    if !dependency.providerConsumers.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Provider Targets")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            FlowLayout(spacing: 4) {
                                ForEach(dependency.providerConsumers) { consumer in
                                    topologyPill("\(consumer.name) · \(consumer.state)", tint: .secondary)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var topologySection: some View {
        let snapshot = store.assetTopologySnapshot(assetId: asset.id)
        if !snapshot.environments.isEmpty || !snapshot.projects.isEmpty || !snapshot.providers.isEmpty || !snapshot.dependsOn.isEmpty || !snapshot.dependedOnBy.isEmpty || !snapshot.runtimeConsumers.isEmpty {
            GroupBox("Topology") {
                VStack(alignment: .leading, spacing: 12) {
                    if !snapshot.environments.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Environment")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            FlowLayout(spacing: 4) {
                                ForEach(snapshot.environments, id: \.id) { node in
                                    topologyPill(node.label, tint: .secondary)
                                }
                            }
                        }
                    }

                    if !snapshot.projects.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Projects")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            FlowLayout(spacing: 4) {
                                ForEach(snapshot.projects, id: \.id) { node in
                                    topologyPill(node.label, tint: .blue)
                                }
                            }
                        }
                    }

                    if !snapshot.providers.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Providers")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            FlowLayout(spacing: 4) {
                                ForEach(snapshot.providers, id: \.self) { link in
                                    let state = link.edge.state ?? .available
                                    topologyPill("\(link.node.label) · \(state.label)", tint: state.tint)
                                }
                            }
                        }
                    }

                    if !snapshot.dependsOn.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Depends On")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            FlowLayout(spacing: 4) {
                                ForEach(snapshot.dependsOn, id: \.id) { node in
                                    topologyPill(node.label, tint: .purple)
                                }
                            }
                        }
                    }

                    if !snapshot.dependedOnBy.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Used By")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            FlowLayout(spacing: 4) {
                                ForEach(snapshot.dependedOnBy, id: \.id) { node in
                                    topologyPill(node.label, tint: .green)
                                }
                            }
                        }
                    }

                    if !snapshot.runtimeConsumers.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Running Agents")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            FlowLayout(spacing: 4) {
                                ForEach(snapshot.runtimeConsumers, id: \.self) { link in
                                    topologyPill("\(link.node.label) · \(link.edge.label ?? "loaded")", tint: .orange)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var healthSection: some View {
        if let health = asset.health, !health.issues.isEmpty {
            GroupBox("Health") {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(health.issues) { issue in
                        VStack(alignment: .leading, spacing: 4) {
                            Label(issue.level == "blocking" ? "Blocking" : "Warning", systemImage: issue.level == "blocking" ? "exclamationmark.octagon.fill" : "exclamationmark.triangle.fill")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(issue.level == "blocking" ? .red : .orange)
                            Text(issue.message)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(8)
                        .background((issue.level == "blocking" ? Color.red : Color.orange).opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var remediationSection: some View {
        if isLoadingRemediations || !remediations.isEmpty {
            GroupBox("Suggested Fixes") {
                VStack(alignment: .leading, spacing: 10) {
                    if isLoadingRemediations {
                        ProgressView()
                            .frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        ForEach(remediations) { suggestion in
                            VStack(alignment: .leading, spacing: 8) {
                                HStack(alignment: .top, spacing: 8) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        HStack(spacing: 6) {
                                            Text(suggestion.title)
                                                .font(.caption.weight(.semibold))
                                            Text(suggestion.category.replacingOccurrences(of: "_", with: " ").capitalized)
                                                .font(.caption2.weight(.semibold))
                                                .padding(.horizontal, 6)
                                                .padding(.vertical, 2)
                                                .background(.quaternary, in: Capsule())
                                                .foregroundStyle(.secondary)
                                            if suggestion.risky {
                                                Text("Risky")
                                                    .font(.caption2.weight(.semibold))
                                                    .padding(.horizontal, 6)
                                                    .padding(.vertical, 2)
                                                    .background(Color.orange.opacity(0.12), in: Capsule())
                                                    .foregroundStyle(.orange)
                                            }
                                        }

                                        Text(suggestion.summary)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)

                                        if !suggestion.details.isEmpty {
                                            VStack(alignment: .leading, spacing: 3) {
                                                ForEach(Array(suggestion.details.enumerated()), id: \.offset) { entry in
                                                    Text(entry.element)
                                                        .font(.caption2)
                                                        .foregroundStyle(.tertiary)
                                                }
                                            }
                                        }
                                    }

                                    Spacer()

                                    if suggestion.canApply {
                                        Button(applyingRemediationID == suggestion.id ? "Applying…" : (suggestion.applyLabel ?? "Apply")) {
                                            Task { await applyRemediation(suggestion) }
                                        }
                                        .buttonStyle(.borderedProminent)
                                        .controlSize(.small)
                                        .disabled(readOnlyReason != nil || applyingRemediationID != nil)
                                    } else {
                                        Text("Guided")
                                            .font(.caption2.weight(.semibold))
                                            .padding(.horizontal, 8)
                                            .padding(.vertical, 3)
                                            .background(.quaternary, in: Capsule())
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var runtimeSection: some View {
        if asset.type == .mcp {
            GroupBox("Runtime Check") {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(mcpRuntime?.summary ?? "Runtime check has not been run yet.")
                                .font(.caption)
                                .foregroundStyle(.secondary)

                            if let runtime = mcpRuntime {
                                Text(runtimeMetadata(runtime))
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                        }

                        Spacer()

                        VStack(alignment: .trailing, spacing: 8) {
                            Text((mcpRuntime?.statusLabel ?? "Unknown").uppercased())
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle((mcpRuntime?.statusTint ?? .secondary))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background((mcpRuntime?.statusTint ?? .secondary).opacity(0.12), in: Capsule())

                            Button(isCheckingRuntime ? "Checking…" : (mcpRuntime == nil || mcpRuntime?.status == "unknown" ? "Run Check" : "Refresh Check")) {
                                Task { await runRuntimeCheck() }
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                            .disabled(!asset.canInspectMcpTools || isCheckingRuntime)
                        }
                    }

                    if let runtimeError, !runtimeError.isEmpty {
                        Text(runtimeError)
                            .font(.caption)
                            .foregroundStyle(.red)
                            .padding(8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                    }

                    if let runtime = mcpRuntime, !runtime.details.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(Array(runtime.details.enumerated()), id: \.offset) { entry in
                                Text(entry.element)
                                    .font(.caption)
                                    .foregroundStyle(.primary)
                                    .padding(8)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))
                            }
                        }
                    }

                    if let runtime = mcpRuntime, !runtime.tools.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("\(runtime.tools.count) Tools Available")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)

                            ForEach(runtime.tools) { tool in
                                HStack(alignment: .top, spacing: 8) {
                                    Text(tool.name)
                                        .font(.caption.monospaced())
                                        .foregroundStyle(.green)
                                    Text(tool.description)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                .padding(8)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))
                            }
                        }
                    }
                }
            }
        }
    }

    private var connectionsSection: some View {
        GroupBox("Connections") {
            VStack(alignment: .leading, spacing: 8) {
                if !asset.canConnect {
                    Text("Connections are unavailable until the blocking asset issues are fixed.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if let providers = asset.capabilities?.providers, !providers.isEmpty {
                    VStack(spacing: 6) {
                        ForEach(providers) { entry in
                            let connection = connections[entry.provider]
                            let isSource = connection?.isSource ?? entry.isSource
                            let isConnected = connection?.connected ?? entry.connected
                            let supported = connection?.supported ?? entry.supported
                            let installed = connection?.installed ?? entry.installed
                            let isUnavailable = !asset.canConnect || isSource || !supported || !installed || entry.state == .invalid

                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: 3) {
                                    HStack(spacing: 6) {
                                        if let provider = Provider(rawValue: entry.provider) {
                                            Image(systemName: provider.icon)
                                                .foregroundStyle(entry.state.tint)
                                        }
                                        Text(entry.label)
                                            .font(.caption.weight(.medium))
                                    }

                                    Text(entry.detail)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)

                                    if let targetPath = connection?.targetPath ?? entry.targetPath, !targetPath.isEmpty {
                                        Text(targetPath)
                                            .font(.caption2.monospaced())
                                            .foregroundStyle(.tertiary)
                                            .textSelection(.enabled)
                                    }
                                }
                                Spacer()

                                if isSource {
                                    Text("Source")
                                        .font(.caption2.weight(.semibold))
                                        .foregroundStyle(.blue)
                                } else if isConnected {
                                    Button("Disconnect") {
                                        Task { await toggleConnection(tool: entry.provider, connect: false) }
                                    }
                                    .controlSize(.small)
                                    .disabled(store.globalReadOnly || !asset.canConnect)
                                } else {
                                    Button(entry.state == .invalid ? entry.state.label : "Connect") {
                                        Task { await toggleConnection(tool: entry.provider, connect: true) }
                                    }
                                    .controlSize(.small)
                                    .buttonStyle(.borderedProminent)
                                    .disabled(store.globalReadOnly || isUnavailable)
                                }
                            }
                            .font(.caption)
                            .padding(.vertical, 2)
                        }
                    }
                } else if connections.isEmpty {
                Text("Loading...")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                } else {
                    Text("No provider targets available for this asset.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var depsSection: some View {
        Group {
            if !asset.deps.isEmpty {
                GroupBox("Dependencies") {
                    FlowLayout(spacing: 4) {
                        ForEach(asset.deps, id: \.self) { dep in
                            Text(dep)
                                .font(.caption.monospaced())
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(.blue.opacity(0.1), in: Capsule())
                        }
                    }
                }
            }
        }
    }

    private func topologyPill(_ text: String, tint: Color) -> some View {
        Text(text)
            .font(.caption)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(tint.opacity(0.12), in: Capsule())
            .foregroundStyle(tint)
    }

    private func dependencyMetric(_ label: String, value: Int, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(value)")
                .font(.caption.weight(.semibold))
                .foregroundStyle(tint)
            Text(label)
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(tint.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
    }

    private var hasEditableContent: Bool {
        asset.canEdit
    }

    private var remediationTaskKey: String {
        [
            asset.id,
            asset.type.rawValue,
            asset.health?.summary ?? "no-health",
            asset.runtime?.checkedAt ?? "no-runtime",
            asset.drift?.status.rawValue ?? "no-drift"
        ].joined(separator: "|")
    }

    @ViewBuilder
    private var editorSection: some View {
        if hasEditableContent {
            GroupBox("Content") {
                if isLoadingContent {
                    ProgressView()
                        .frame(maxWidth: .infinity, minHeight: 100)
                } else {
                    TextEditor(text: $content)
                        .font(.system(.body, design: .monospaced))
                        .frame(minHeight: 200)
                        .scrollContentBackground(.hidden)

                    if hasUnsavedChanges {
                        HStack {
                            Circle().fill(.orange).frame(width: 6, height: 6)
                            Text("Unsaved changes")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Spacer()
                            Button("Revert") { content = originalContent }
                                .controlSize(.small)
                            Button("Save") { Task { await save() } }
                                .controlSize(.small)
                                .buttonStyle(.borderedProminent)
                                .disabled(store.globalReadOnly)
                        }
                    }
                }
            }
        } else if asset.health?.hasBlocking == true {
            GroupBox("Content") {
                Text("Content is unavailable until the blocking asset issues are fixed.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    // MARK: - Actions

    private func loadContent() async {
        guard hasEditableContent else {
            isLoadingContent = false
            return
        }
        do {
            let result = try await api.fetchAssetContent(assetId: asset.id, type: asset.type)
            content = result.content
            originalContent = result.content
        } catch {
            content = "// Failed to load: \(error.localizedDescription)"
        }
        isLoadingContent = false
    }

    private func loadConnections() async {
        guard asset.canConnect else {
            connections = [:]
            return
        }
        do {
            connections = try await api.fetchConnections(assetId: asset.id, type: asset.type)
        } catch {
            // Silent fail
        }
    }

    private func syncRuntimeFromAsset() {
        guard asset.type == .mcp else {
            mcpRuntime = nil
            runtimeError = nil
            return
        }
        mcpRuntime = asset.runtime
        runtimeError = nil
    }

    private func loadRemediations() async {
        isLoadingRemediations = true
        defer { isLoadingRemediations = false }

        do {
            remediations = try await api.fetchAssetRemediations(assetId: asset.id, type: asset.type)
        } catch {
            remediations = []
        }
    }

    private func runtimeMetadata(_ runtime: McpRuntimeCheck) -> String {
        var segments: [String] = [runtime.transport.uppercased()]
        if let checkedAt = runtime.checkedAt,
           let date = ISO8601DateFormatter().date(from: checkedAt) {
            segments.append("Checked \(DateFormatter.localizedString(from: date, dateStyle: .short, timeStyle: .short))")
        }
        if let durationMs = runtime.durationMs {
            segments.append("\(durationMs) ms")
        }
        if let toolCount = runtime.toolCount {
            segments.append("\(toolCount) tools")
        }
        if runtime.cached {
            segments.append(runtime.stale ? "cached (stale)" : "cached")
        }
        segments.append(runtime.reachable ? "reachable" : "unreachable")
        return segments.joined(separator: " · ")
    }

    private func runRuntimeCheck() async {
        guard asset.canInspectMcpTools else {
            store.showToast(asset.health?.summary ?? "Runtime check is unavailable for this asset")
            return
        }

        isCheckingRuntime = true
        defer { isCheckingRuntime = false }

        do {
            let runtime = try await api.runMcpRuntimeCheck(assetId: asset.id)
            mcpRuntime = runtime
            runtimeError = nil
            store.showToast(runtime.summary)
            await store.loadAll(api: api)
            await loadRemediations()
        } catch {
            runtimeError = error.localizedDescription
            store.showToast(error.localizedDescription.isEmpty ? "Runtime check failed" : error.localizedDescription)
        }
    }

    private func confirmRiskyRemediation(_ suggestion: RemediationSuggestion) -> Bool {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Apply risky fix?"
        alert.informativeText = ([suggestion.summary] + suggestion.details).joined(separator: "\n")
        alert.addButton(withTitle: suggestion.applyLabel ?? "Apply")
        alert.addButton(withTitle: "Cancel")
        return alert.runModal() == .alertFirstButtonReturn
    }

    private func applyRemediation(_ suggestion: RemediationSuggestion) async {
        guard readOnlyReason == nil else {
            store.showToast(readOnlyReason ?? "Read-only audit mode is enabled")
            return
        }
        guard suggestion.canApply, applyingRemediationID == nil else { return }
        if suggestion.risky && !confirmRiskyRemediation(suggestion) {
            return
        }

        applyingRemediationID = suggestion.id
        defer { applyingRemediationID = nil }

        do {
            _ = try await api.applyAssetRemediation(
                assetId: asset.id,
                remediationId: suggestion.id,
                type: asset.type,
                confirmRisk: suggestion.risky,
                approval: .client("macos", note: suggestion.risky ? "Approved risky asset remediation" : "Approved asset remediation")
            )
            store.showToast(suggestion.applyLabel ?? "Fix applied")
            await store.loadAll(api: api)
            await loadRemediations()
            await loadContent()
            await loadConnections()
        } catch {
            store.showToast(error.localizedDescription.isEmpty ? "Failed to apply suggested fix" : error.localizedDescription)
        }
    }

    private func save() async {
        guard !store.globalReadOnly else {
            store.showToast(readOnlyReason ?? "Read-only audit mode is enabled")
            return
        }
        do {
            try await api.updateAssetContent(assetId: asset.id, content: content, type: asset.type)
            originalContent = content
            store.showToast("Saved \(asset.name)")
        } catch {
            store.showToast("Save failed: \(error.localizedDescription)")
        }
    }

    private func toggleConnection(tool: String, connect: Bool) async {
        guard !store.globalReadOnly else {
            store.showToast(readOnlyReason ?? "Read-only audit mode is enabled")
            return
        }
        guard asset.canConnect else {
            store.showToast(asset.health?.summary ?? "Connections are unavailable for this asset")
            return
        }
        do {
            if connect {
                try await api.connect(assetId: asset.id, tool: tool, type: asset.type)
            } else {
                try await api.disconnect(assetId: asset.id, tool: tool, type: asset.type)
            }
            await loadConnections()
            store.showToast(connect ? "Connected \(asset.name) → \(tool)" : "Disconnected \(asset.name) from \(tool)")
        } catch {
            store.showToast("Failed: \(error.localizedDescription)")
        }
    }

    private func deleteAsset() async {
        guard !store.globalReadOnly else {
            store.showToast(readOnlyReason ?? "Read-only audit mode is enabled")
            return
        }
        guard asset.canDelete else {
            store.showToast("Delete is unavailable for this asset")
            return
        }
        do {
            try await api.deleteAsset(assetId: asset.id, type: asset.type)
            store.selectedAsset = nil
            store.showToast("Deleted \(asset.name)")
            await store.loadAll(api: api)
        } catch {
            store.showToast("Delete failed: \(error.localizedDescription)")
        }
    }

    @MainActor
    private func makeSourceOfTruth(groupKey: String, assetId: String) async {
        guard !store.globalReadOnly else {
            store.showToast(readOnlyReason ?? "Read-only audit mode is enabled")
            return
        }
        guard sourceOfTruthBusyAssetID == nil else { return }
        sourceOfTruthBusyAssetID = assetId
        defer { sourceOfTruthBusyAssetID = nil }

        do {
            _ = try await api.setSourceOfTruth(groupKey: groupKey, assetId: assetId)
            store.showToast("Source of truth updated")
            await store.loadAll(api: api)
        } catch {
            store.showToast("Failed to update source of truth: \(error.localizedDescription)")
        }
    }
}

// MARK: - Flow Layout Helper

struct FlowLayout: Layout {
    var spacing: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrange(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(proposal: proposal, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y), proposal: .unspecified)
        }
    }

    private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> (positions: [CGPoint], size: CGSize) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var maxX: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth && x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
            maxX = max(maxX, x)
        }

        return (positions, CGSize(width: maxX, height: y + rowHeight))
    }
}
