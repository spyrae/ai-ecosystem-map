import SwiftUI
import UniformTypeIdentifiers

private func bundleItemKey(_ item: BundleItem) -> String {
    item.assetId ?? "\(item.type.rawValue):\(item.name):\(item.projectPath ?? item.filePath ?? "")"
}

private func formatBundleTimestamp(_ value: Double?) -> String {
    guard let value else { return "Never" }
    let seconds = value > 1_000_000_000_000 ? value / 1000 : value
    return Date(timeIntervalSince1970: seconds).formatted(date: .abbreviated, time: .shortened)
}

private struct EligibleBundleAgent: Identifiable {
    let agent: RunningAgent
    let projectPath: String

    var id: String { agent.id }
}

private struct BundleEditorCandidate: Identifiable, Hashable {
    let key: String
    let item: BundleItem
    let found: Bool

    var id: String { key }
}

private struct ManifestJSONDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }

    let data: Data

    init(data: Data) {
        self.data = data
    }

    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else {
            throw CocoaError(.fileReadCorruptFile)
        }
        self.data = data
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}

private struct ManifestExportSheet: View {
    @Binding var includeAssets: Bool
    @Binding var includeBundles: Bool
    @Binding var includePolicies: Bool
    let exporting: Bool
    let onClose: () -> Void
    let onExport: () -> Void

    private var selectedCount: Int {
        [includeAssets, includeBundles, includePolicies].filter { $0 }.count
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Portable snapshot of harness assets, bundles, and policies for another HCP workspace.")
                    .font(.callout)
                    .foregroundStyle(.secondary)

                Toggle(isOn: $includeAssets) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Assets")
                            .font(.body.weight(.medium))
                        Text("Local and project-level skills, agents, MCP, instructions, and rules.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Toggle(isOn: $includeBundles) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Bundles")
                            .font(.body.weight(.medium))
                        Text("Reusable harness stacks and saved bundle versions.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Toggle(isOn: $includePolicies) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Policies")
                            .font(.body.weight(.medium))
                        Text("Governance rules, selectors, severities, and enforcement definitions.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()

                HStack {
                    Text(selectedCount > 0 ? "Manifest exports as sorted JSON." : "Choose at least one scope to export.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button("Cancel") { onClose() }
                        .keyboardShortcut(.cancelAction)
                    Button(exporting ? "Exporting…" : "Continue") {
                        onExport()
                    }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                    .disabled(exporting || selectedCount == 0)
                }
            }
            .padding()
            .frame(minWidth: 460, minHeight: 320)
            .navigationTitle("Export Workspace Manifest")
        }
    }
}

private struct ManifestImportPreviewSheet: View {
    let fileName: String
    let preview: WorkspaceManifestImportPreviewData?
    let loading: Bool
    let applying: Bool
    let readOnly: Bool
    let readOnlyReason: String?
    let onChooseFile: () -> Void
    let onApply: () -> Void

    @Environment(\.dismiss) private var dismiss

    private var canApply: Bool {
        !readOnly && (preview?.canApply == true)
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Import Workspace Manifest")
                        .font(.title3.weight(.semibold))
                    Text(fileName.isEmpty ? "Choose a manifest JSON file to begin." : fileName)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                HStack(spacing: 12) {
                    Button(loading ? "Reading Manifest…" : (preview == nil ? "Choose Manifest File" : "Choose Another File")) {
                        onChooseFile()
                    }
                    .disabled(loading || applying)

                    if let exportedAt = preview?.manifest.exportedAt {
                        let seconds = exportedAt > 1_000_000_000_000 ? exportedAt / 1000 : exportedAt
                        Text("Exported \(Date(timeIntervalSince1970: seconds).formatted(date: .abbreviated, time: .shortened))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                if readOnly {
                    Text(readOnlyReason ?? "Global read-only audit mode is enabled. Import apply is disabled.")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                }

                if loading {
                    ProgressView("Preparing manifest preview…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let preview {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 14) {
                            HStack(spacing: 12) {
                                summaryPill("Writes", value: preview.writeCount, tint: .accentColor)
                                summaryPill("Blocked", value: preview.counts.assets.blocked, tint: .red)
                                summaryPill("Bundles", value: preview.counts.bundles.create + preview.counts.bundles.update, tint: .green)
                                summaryPill("Policies", value: preview.counts.policies.create + preview.counts.policies.update, tint: .orange)
                            }

                            if preview.issues.isEmpty == false {
                                VStack(alignment: .leading, spacing: 8) {
                                    ForEach(preview.issues) { issue in
                                        issueRow(level: issue.level, message: issue.message)
                                    }
                                }
                            }

                            previewSection(title: "Assets", empty: preview.assets.isEmpty) {
                                ForEach(preview.assets) { entry in
                                    VStack(alignment: .leading, spacing: 6) {
                                        HStack(spacing: 8) {
                                            Text(entry.name)
                                                .font(.body.weight(.medium))
                                            Text(entry.type.label)
                                                .font(.caption2.weight(.semibold))
                                                .padding(.horizontal, 6)
                                                .padding(.vertical, 2)
                                                .background(Color.secondary.opacity(0.12), in: Capsule())
                                                .foregroundStyle(.secondary)
                                            actionBadge(entry.action)
                                        }
                                        Text(entry.summary)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                        if let path = entry.targetPath ?? entry.projectPath, !path.isEmpty {
                                            Text(path)
                                                .font(.caption2.monospaced())
                                                .foregroundStyle(.tertiary)
                                                .textSelection(.enabled)
                                        }
                                        ForEach(entry.issues) { issue in
                                            issueRow(level: issue.level, message: issue.message)
                                        }
                                    }
                                    .padding(10)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
                                }
                            }

                            previewSection(title: "Bundles", empty: preview.bundles.isEmpty) {
                                ForEach(preview.bundles) { entry in
                                    namedEntry(entry)
                                }
                            }

                            previewSection(title: "Policies", empty: preview.policies.isEmpty) {
                                ForEach(preview.policies) { entry in
                                    namedEntry(entry)
                                }
                            }
                        }
                    }
                } else {
                    ContentUnavailableView("No manifest selected", systemImage: "square.and.arrow.down.on.square")
                }

                HStack {
                    Text(preview == nil
                         ? "Choose a manifest to generate an import preview."
                         : canApply
                            ? "Manifest import will use the same preview/apply path as bundle sync."
                            : "Resolve blocking issues or disable read-only mode before applying.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    Spacer()
                    Button("Close") { dismiss() }
                        .keyboardShortcut(.cancelAction)
                    Button(applying ? "Applying…" : "Apply Import") {
                        onApply()
                    }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                    .disabled(preview == nil || !canApply || applying)
                }
            }
            .padding()
            .frame(minWidth: 860, minHeight: 620)
        }
    }

    private func summaryPill(_ label: String, value: Int, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(value)")
                .font(.title3.weight(.semibold))
                .foregroundStyle(tint)
            Text(label)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder
    private func previewSection<Content: View>(title: String, empty: Bool, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            if empty {
                Text("No \(title.lowercased()) in manifest.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
            } else {
                content()
            }
        }
    }

    @ViewBuilder
    private func issueRow(level: String, message: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: level == "blocking" ? "exclamationmark.triangle.fill" : "exclamationmark.circle")
                .foregroundStyle(level == "blocking" ? .red : .orange)
            Text(message)
                .font(.caption)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background((level == "blocking" ? Color.red : Color.orange).opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
    }

    private func actionBadge(_ action: String) -> some View {
        let color: Color
        switch action {
        case "blocked":
            color = .red
        case "update":
            color = .orange
        case "create":
            color = .green
        default:
            color = .secondary
        }
        return Text(action)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.12), in: Capsule())
            .foregroundStyle(color)
    }

    @ViewBuilder
    private func namedEntry(_ entry: WorkspaceManifestNamedPreviewEntry) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(entry.name)
                    .font(.body.weight(.medium))
                Text(entry.summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            actionBadge(entry.action)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
    }
}

struct BundlesListView: View {
    @Environment(APIClient.self) private var api
    @Environment(EcosystemStore.self) private var store

    @State private var bundles: [Bundle] = []
    @State private var sourceItems: [BundleItem] = []
    @State private var projects: [Project] = []
    @State private var servers: [ServerEnvironment] = []
    @State private var runningAgents: [RunningAgent] = []
    @State private var selectedBundleID: String?
    @State private var searchText = ""
    @State private var isLoading = true

    @State private var showEditor = false
    @State private var editingBundle: Bundle?
    @State private var isSavingBundle = false

    @State private var targetKind: BundleTargetKind = .provider
    @State private var providerTarget: Provider = .claude
    @State private var projectTargetPath = ""
    @State private var projectMethod = "symlink"
    @State private var serverTargetID = ""
    @State private var runningAgentTargetID = ""
    @State private var runningAgentMethod = "symlink"

    @State private var previewData: BundlePreviewData?
    @State private var isPreviewing = false
    @State private var isApplying = false
    @State private var showManifestExport = false
    @State private var includeManifestAssets = true
    @State private var includeManifestBundles = true
    @State private var includeManifestPolicies = true
    @State private var isExportingManifest = false
    @State private var showManifestFileExporter = false
    @State private var manifestDocument: ManifestJSONDocument?
    @State private var manifestExportFileName = "hcp-workspace-manifest.json"
    @State private var showManifestFileImporter = false
    @State private var showManifestImportPreview = false
    @State private var manifestImportFileName = ""
    @State private var manifestImportPayload: WorkspaceManifest?
    @State private var manifestImportPreview: WorkspaceManifestImportPreviewData?
    @State private var isManifestPreviewLoading = false
    @State private var isManifestApplying = false

    private var filteredBundles: [Bundle] {
        guard !searchText.isEmpty else { return bundles }
        return bundles.filter { bundle in
            "\(bundle.name) \(bundle.description)".localizedCaseInsensitiveContains(searchText)
        }
    }

    private var selectedBundle: Bundle? {
        bundles.first(where: { $0.id == selectedBundleID }) ?? filteredBundles.first
    }

    private var localProjects: [Project] {
        projects.filter { $0.environment_type != "remote" }
    }

    private var remoteServers: [ServerEnvironment] {
        servers.filter { $0.type == "remote" }
    }

    private var eligibleAgents: [EligibleBundleAgent] {
        runningAgents.compactMap { agent in
            guard let introspection = agent.introspection, introspection.checkedAt != nil else { return nil }
            let projectPaths = Array(Set(introspection.assets.compactMap(\.projectPath)))
            guard projectPaths.count == 1 else { return nil }
            guard localProjects.contains(where: { $0.path == projectPaths[0] }) else { return nil }
            return EligibleBundleAgent(agent: agent, projectPath: projectPaths[0])
        }
    }

    private var targetRequest: BundleTargetRequest? {
        switch targetKind {
        case .provider:
            return BundleTargetRequest(kind: targetKind.rawValue, provider: providerTarget.rawValue, projectPath: nil, method: nil, serverId: nil, agentId: nil)
        case .project:
            guard !projectTargetPath.isEmpty else { return nil }
            return BundleTargetRequest(kind: targetKind.rawValue, provider: nil, projectPath: projectTargetPath, method: projectMethod, serverId: nil, agentId: nil)
        case .server:
            guard !serverTargetID.isEmpty else { return nil }
            return BundleTargetRequest(kind: targetKind.rawValue, provider: nil, projectPath: nil, method: nil, serverId: serverTargetID, agentId: nil)
        case .running_agent:
            guard !runningAgentTargetID.isEmpty else { return nil }
            return BundleTargetRequest(kind: targetKind.rawValue, provider: nil, projectPath: nil, method: runningAgentMethod, serverId: nil, agentId: runningAgentTargetID)
        }
    }

    private var selectedServer: ServerEnvironment? {
        remoteServers.first(where: { $0.id == serverTargetID })
    }

    private var targetReadOnlyReason: String? {
        if store.globalReadOnly {
            return "Global read-only audit mode is enabled."
        }
        if let server = selectedServer, store.isEnvironmentReadOnly(server.id) {
            return store.readOnlyReason(environmentId: server.id, environmentName: server.name)
        }
        return nil
    }

    private var targetReadOnly: Bool {
        targetReadOnlyReason != nil
    }

    var body: some View {
        VStack(spacing: 0) {
            topBar

            HSplitView {
            List(selection: Binding(
                get: { selectedBundleID },
                set: { selectedBundleID = $0 }
            )) {
                ForEach(filteredBundles) { bundle in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 8) {
                            Text(bundle.name)
                                .font(.body.weight(.medium))
                            Text("v\(bundle.current_version)")
                                .font(.caption2.weight(.semibold))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.secondary.opacity(0.12), in: Capsule())
                                .foregroundStyle(.secondary)
                            if bundle.outdatedApplicationCount > 0 {
                                Text("\(bundle.outdatedApplicationCount) outdated")
                                    .font(.caption2.weight(.semibold))
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(Color.orange.opacity(0.12), in: Capsule())
                                    .foregroundStyle(.orange)
                            }
                        }
                        Text(bundle.description.isEmpty ? "No description" : bundle.description)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                        Text("\(bundle.itemCount) items · \(bundle.applicationCount) targets")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                    .tag(bundle.id)
                }
            }
            .listStyle(.sidebar)
            .frame(minWidth: 280, idealWidth: 300, maxWidth: 340)

            if let bundle = selectedBundle {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        GroupBox {
                            VStack(alignment: .leading, spacing: 10) {
                                HStack(spacing: 8) {
                                    Text(bundle.name)
                                        .font(.title3.weight(.semibold))
                                    Text("v\(bundle.current_version)")
                                        .font(.caption.weight(.semibold))
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 3)
                                        .background(Color.secondary.opacity(0.12), in: Capsule())
                                        .foregroundStyle(.secondary)
                                    if bundle.outdatedApplicationCount > 0 {
                                        Text("\(bundle.outdatedApplicationCount) outdated targets")
                                            .font(.caption.weight(.semibold))
                                            .padding(.horizontal, 8)
                                            .padding(.vertical, 3)
                                            .background(Color.orange.opacity(0.12), in: Capsule())
                                            .foregroundStyle(.orange)
                                    }
                                    Spacer()
                                    Button("Edit") {
                                        editingBundle = bundle
                                        showEditor = true
                                    }
                                    Button("Delete", role: .destructive) {
                                        Task { await deleteBundle(bundle) }
                                    }
                                }
                                Text(bundle.description.isEmpty ? "No description yet." : bundle.description)
                                    .font(.callout)
                                    .foregroundStyle(.secondary)
                                Text("\(bundle.itemCount) items · \(bundle.applicationCount) applications · Last applied \(formatBundleTimestamp(bundle.lastAppliedAt))")
                                    .font(.caption)
                                    .foregroundStyle(.tertiary)
                            }
                        }

                        GroupBox("Apply Bundle") {
                            VStack(alignment: .leading, spacing: 10) {
                                Picker("Target", selection: $targetKind) {
                                    ForEach(BundleTargetKind.allCases) { kind in
                                        Text(kind.label).tag(kind)
                                    }
                                }
                                .pickerStyle(.menu)

                                switch targetKind {
                                case .provider:
                                    Picker("Provider", selection: $providerTarget) {
                                        ForEach(Provider.allCases) { provider in
                                            Text(provider.label).tag(provider)
                                        }
                                    }
                                    .pickerStyle(.menu)
                                case .project:
                                    Picker("Project", selection: $projectTargetPath) {
                                        Text("Select project…").tag("")
                                        ForEach(localProjects) { project in
                                            Text(project.name).tag(project.path)
                                        }
                                    }
                                    .pickerStyle(.menu)
                                    Picker("Method", selection: $projectMethod) {
                                        Text("Symlink").tag("symlink")
                                        Text("Copy").tag("copy")
                                    }
                                    .pickerStyle(.segmented)
                                case .server:
                                    Picker("Remote Server", selection: $serverTargetID) {
                                        Text("Select server…").tag("")
                                        ForEach(remoteServers) { server in
                                            Text(server.name).tag(server.id)
                                        }
                                    }
                                    .pickerStyle(.menu)
                                case .running_agent:
                                    Picker("Running Agent", selection: $runningAgentTargetID) {
                                        Text("Select agent…").tag("")
                                        ForEach(eligibleAgents) { entry in
                                            Text("\(entry.agent.name) · \(entry.projectPath)").tag(entry.agent.id)
                                        }
                                    }
                                    .pickerStyle(.menu)
                                    Picker("Method", selection: $runningAgentMethod) {
                                        Text("Symlink").tag("symlink")
                                        Text("Copy").tag("copy")
                                    }
                                    .pickerStyle(.segmented)
                                    if eligibleAgents.isEmpty {
                                        Text("No running agents are currently resolvable to a single local project. Run introspection first.")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }

                                if let targetReadOnlyReason {
                                    Text(targetReadOnlyReason)
                                        .font(.caption)
                                        .foregroundStyle(.orange)
                                        .padding(10)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                                }

                                Button(isPreviewing ? "Preparing Preview…" : "Preview Apply") {
                                    Task { await preview(bundle) }
                                }
                                .buttonStyle(.borderedProminent)
                                .disabled(targetRequest == nil || isPreviewing)
                            }
                        }

                        GroupBox("Items") {
                            VStack(alignment: .leading, spacing: 8) {
                                ForEach(bundle.items) { item in
                                    VStack(alignment: .leading, spacing: 4) {
                                        HStack(spacing: 8) {
                                            Text(item.name)
                                                .font(.body.weight(.medium))
                                            Text(item.type.label)
                                                .font(.caption2.weight(.semibold))
                                                .padding(.horizontal, 6)
                                                .padding(.vertical, 2)
                                                .background(Color.secondary.opacity(0.12), in: Capsule())
                                                .foregroundStyle(.secondary)
                                        }
                                        Text((item.providers ?? []).compactMap { Provider(rawValue: $0)?.label ?? $0 }.joined(separator: " · "))
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                        if let projectPath = item.projectPath {
                                            Text(projectPath)
                                                .font(.caption2.monospaced())
                                                .foregroundStyle(.tertiary)
                                        } else if let filePath = item.filePath {
                                            Text(filePath)
                                                .font(.caption2.monospaced())
                                                .foregroundStyle(.tertiary)
                                        }
                                    }
                                    .padding(10)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
                                }
                            }
                        }

                        GroupBox("Versions") {
                            VStack(alignment: .leading, spacing: 8) {
                                ForEach(bundle.versions) { version in
                                    VStack(alignment: .leading, spacing: 4) {
                                        HStack {
                                            Text("v\(version.version)")
                                                .font(.body.weight(.medium))
                                            Spacer()
                                            Text(formatBundleTimestamp(version.created_at))
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                        Text(version.label.isEmpty ? (version.description.isEmpty ? "No version notes" : version.description) : version.label)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                        Text("\(version.itemCount) items")
                                            .font(.caption2)
                                            .foregroundStyle(.tertiary)
                                    }
                                    .padding(10)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
                                }
                            }
                        }

                        GroupBox("Applications") {
                            if bundle.applications.isEmpty {
                                ContentUnavailableView("No applications yet", systemImage: "shippingbox")
                            } else {
                                VStack(alignment: .leading, spacing: 8) {
                                    ForEach(bundle.applications) { application in
                                        VStack(alignment: .leading, spacing: 4) {
                                            HStack(spacing: 8) {
                                                Text(application.target_label)
                                                    .font(.body.weight(.medium))
                                                if application.outdated {
                                                    Text("outdated")
                                                        .font(.caption2.weight(.semibold))
                                                        .padding(.horizontal, 6)
                                                        .padding(.vertical, 2)
                                                        .background(Color.orange.opacity(0.12), in: Capsule())
                                                        .foregroundStyle(.orange)
                                                }
                                                Spacer()
                                                Text("v\(application.bundle_version)")
                                                    .font(.caption2.weight(.semibold))
                                                    .foregroundStyle(.secondary)
                                            }
                                            Text("\(application.target_kind.label) · \(application.last_status)")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                            Text(application.last_summary)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                            Text(formatBundleTimestamp(application.applied_at))
                                                .font(.caption2)
                                                .foregroundStyle(.tertiary)
                                        }
                                        .padding(10)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
                                    }
                                }
                            }
                        }
                    }
                    .padding()
                }
            } else if isLoading {
                ProgressView("Loading bundles…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ContentUnavailableView("No bundles yet", systemImage: "shippingbox")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: api.isReady) {
            guard api.isReady else { return }
            await loadData()
        }
        .sheet(isPresented: $showEditor) {
            BundleEditorSheet(
                bundle: editingBundle,
                sourceItems: sourceItems,
                isSaving: isSavingBundle,
                onClose: {
                    if !isSavingBundle {
                        editingBundle = nil
                        showEditor = false
                    }
                },
                onSave: { name, description, versionLabel, items in
                    Task { await saveBundle(name: name, description: description, versionLabel: versionLabel, items: items) }
                }
            )
        }
        .sheet(isPresented: $showManifestExport) {
            ManifestExportSheet(
                includeAssets: $includeManifestAssets,
                includeBundles: $includeManifestBundles,
                includePolicies: $includeManifestPolicies,
                exporting: isExportingManifest,
                onClose: {
                    if !isExportingManifest {
                        showManifestExport = false
                    }
                },
                onExport: {
                    Task { await exportManifest() }
                }
            )
        }
        .sheet(isPresented: Binding(
            get: { previewData != nil },
            set: { if !$0 { previewData = nil } }
        )) {
            if let previewData {
                BatchSyncPlanSheet(
                    title: selectedBundle.map { "Apply Bundle · \($0.name)" } ?? "Apply Bundle",
                    preview: previewData.preview,
                    isApplying: isApplying,
                    readOnly: targetReadOnly,
                    readOnlyReason: targetReadOnlyReason,
                    onApply: { Task { await applySelectedBundle() } }
                )
            }
        }
        .sheet(isPresented: $showManifestImportPreview, onDismiss: resetManifestImportState) {
            ManifestImportPreviewSheet(
                fileName: manifestImportFileName,
                preview: manifestImportPreview,
                loading: isManifestPreviewLoading,
                applying: isManifestApplying,
                readOnly: store.globalReadOnly,
                readOnlyReason: store.globalReadOnly ? "Global read-only audit mode is enabled." : nil,
                onChooseFile: { showManifestFileImporter = true },
                onApply: { Task { await applyManifestImport() } }
            )
        }
        .fileImporter(isPresented: $showManifestFileImporter, allowedContentTypes: [.json]) { result in
            switch result {
            case .success(let url):
                Task { await previewManifestImport(from: url) }
            case .failure:
                break
            }
        }
        .fileExporter(
            isPresented: $showManifestFileExporter,
            document: manifestDocument,
            contentType: .json,
            defaultFilename: manifestExportFileName
        ) { result in
            switch result {
            case .success:
                store.showToast("Workspace manifest saved")
            case .failure(let error):
                store.showToast("Failed to save manifest: \(error.localizedDescription)")
            }
            manifestDocument = nil
        }
    }

    private var topBar: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Bundles")
                    .font(.headline)
                Text("\(filteredBundles.count) matching bundles · reusable harness stacks and manifest workflows.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.tertiary)
                    .font(.caption)
                TextField("Search bundles", text: $searchText)
                    .textFieldStyle(.plain)
                if !searchText.isEmpty {
                    Button {
                        searchText = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.tertiary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .frame(width: 280)
            .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))

            Button {
                Task { await loadData() }
            } label: {
                Label("Refresh", systemImage: "arrow.clockwise")
            }

            Button {
                editingBundle = nil
                showEditor = true
            } label: {
                Label("Create", systemImage: "plus")
            }

            Button {
                showManifestExport = true
            } label: {
                Label("Export", systemImage: "square.and.arrow.up")
            }

            Button {
                showManifestFileImporter = true
            } label: {
                Label("Import", systemImage: "square.and.arrow.down")
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.bar)
    }

    @MainActor
    private func loadData() async {
        guard api.isReady else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            async let bundlesTask = api.fetchBundles()
            async let assetsTask = api.fetchAssets()
            async let projectsTask = api.fetchProjects()
            async let serversTask = api.fetchServers()
            async let agentsTask = api.fetchRunningAgents()
            async let auditTask = api.fetchAuditMode()
            let (bundles, assets, projects, servers, agents, auditMode) = try await (bundlesTask, assetsTask, projectsTask, serversTask, agentsTask, auditTask)
            let localEnvironmentId = servers.first(where: { $0.type == "local" })?.id
            let localProjects = projects.filter { $0.environment_type != "remote" }
            let projectAssetGroups = try await withThrowingTaskGroup(of: [BundleItem].self) { group in
                for project in localProjects {
                    group.addTask {
                        let assets = try await api.fetchProjectAssets(projectId: project.id)
                        return assets.map { asset in
                            BundleItem(
                                assetId: asset.id,
                                name: asset.name,
                                type: asset.type,
                                filePath: asset.filePath,
                                providers: asset.providers,
                                projectPath: asset.projectPath,
                                scope: "project"
                            )
                        }
                    }
                }
                var results: [BundleItem] = []
                for try await chunk in group {
                    results.append(contentsOf: chunk)
                }
                return results
            }
            self.bundles = bundles
            self.sourceItems = assets.compactMap { asset in
                guard [.skill, .agent, .mcp, .instruction, .rule].contains(asset.type) else { return nil }
                if let localEnvironmentId, let environmentId = asset.environment_id, environmentId != localEnvironmentId {
                    return nil
                }
                return BundleItem(
                    assetId: asset.id,
                    name: asset.name,
                    type: asset.type,
                    filePath: asset.filePath,
                    providers: asset.providers,
                    projectPath: nil,
                    scope: asset.environment_id == nil ? "local" : "remote"
                )
            } + projectAssetGroups
            self.projects = projects
            self.servers = servers
            self.runningAgents = agents
            store.auditMode = auditMode
            if selectedBundleID == nil {
                selectedBundleID = bundles.first?.id
            } else if let selectedBundleID, !bundles.contains(where: { $0.id == selectedBundleID }) {
                self.selectedBundleID = bundles.first?.id
            }
            if projectTargetPath.isEmpty {
                projectTargetPath = localProjects.first?.path ?? ""
            }
            if serverTargetID.isEmpty {
                serverTargetID = remoteServers.first?.id ?? ""
            }
            if runningAgentTargetID.isEmpty {
                runningAgentTargetID = eligibleAgents.first?.agent.id ?? ""
            }
        } catch {
            store.showToast("Failed to load bundles: \(error.localizedDescription)")
        }
    }

    @MainActor
    private func saveBundle(name: String, description: String, versionLabel: String, items: [BundleItem]) async {
        isSavingBundle = true
        defer { isSavingBundle = false }
        do {
            if let editingBundle {
                _ = try await api.updateBundle(id: editingBundle.id, name: name, description: description, versionLabel: versionLabel, items: items)
                store.showToast("Updated bundle \(name)")
            } else {
                _ = try await api.createBundle(name: name, description: description, versionLabel: versionLabel, items: items)
                store.showToast("Created bundle \(name)")
            }
            self.editingBundle = nil
            showEditor = false
            await loadData()
        } catch {
            store.showToast("Failed to save bundle: \(error.localizedDescription)")
        }
    }

    @MainActor
    private func deleteBundle(_ bundle: Bundle) async {
        do {
            try await api.deleteBundle(id: bundle.id)
            store.showToast("Deleted bundle \(bundle.name)")
            await loadData()
        } catch {
            store.showToast("Failed to delete bundle: \(error.localizedDescription)")
        }
    }

    @MainActor
    private func preview(_ bundle: Bundle) async {
        guard let targetRequest else { return }
        isPreviewing = true
        defer { isPreviewing = false }
        do {
            previewData = try await api.previewBundle(id: bundle.id, target: targetRequest)
        } catch {
            store.showToast("Failed to preview bundle: \(error.localizedDescription)")
        }
    }

    @MainActor
    private func applySelectedBundle() async {
        guard let bundle = selectedBundle, let targetRequest else { return }
        isApplying = true
        defer { isApplying = false }
        do {
            let result = try await api.applyBundle(id: bundle.id, target: targetRequest)
            previewData = result.ok ? nil : BundlePreviewData(
                bundleId: result.bundleId,
                bundleVersion: result.bundleVersion,
                target: result.target,
                resolvedTarget: result.resolvedTarget,
                preview: result.preview
            )
            store.showToast(result.ok ? "Applied bundle \(bundle.name)" : (result.error ?? "Bundle apply completed with failures"))
            await loadData()
        } catch {
            store.showToast("Failed to apply bundle: \(error.localizedDescription)")
        }
    }

    @MainActor
    private func exportManifest() async {
        isExportingManifest = true
        defer { isExportingManifest = false }
        do {
            let manifest = try await api.exportWorkspaceManifest(
                includeAssets: includeManifestAssets,
                includeBundles: includeManifestBundles,
                includePolicies: includeManifestPolicies
            )
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let data = try encoder.encode(manifest)
            manifestDocument = ManifestJSONDocument(data: data)
            manifestExportFileName = "hcp-workspace-manifest-\(ISO8601DateFormatter().string(from: .now).replacingOccurrences(of: ":", with: "-")).json"
            showManifestExport = false
            showManifestFileExporter = true
        } catch {
            store.showToast("Failed to export manifest: \(error.localizedDescription)")
        }
    }

    @MainActor
    private func previewManifestImport(from url: URL) async {
        let accessing = url.startAccessingSecurityScopedResource()
        defer {
            if accessing {
                url.stopAccessingSecurityScopedResource()
            }
        }
        do {
            manifestImportFileName = url.lastPathComponent
            manifestImportPreview = nil
            manifestImportPayload = nil
            isManifestPreviewLoading = true
            showManifestImportPreview = true
            let data = try Data(contentsOf: url)
            let manifest = try JSONDecoder().decode(WorkspaceManifest.self, from: data)
            let preview = try await api.previewImportManifest(manifest)
            manifestImportPayload = manifest
            manifestImportPreview = preview
        } catch {
            showManifestImportPreview = false
            resetManifestImportState()
            store.showToast("Failed to preview manifest import: \(error.localizedDescription)")
        }
        isManifestPreviewLoading = false
    }

    @MainActor
    private func applyManifestImport() async {
        guard let manifestImportPayload else { return }
        isManifestApplying = true
        defer { isManifestApplying = false }
        do {
            let result = try await api.applyImportManifest(manifestImportPayload, approval: .client("macos", note: "Confirmed workspace manifest import"))
            store.showToast("Imported workspace manifest (\(result.result.writeCount) writes)")
            showManifestImportPreview = false
            resetManifestImportState()
            await loadData()
        } catch {
            store.showToast("Failed to apply manifest import: \(error.localizedDescription)")
        }
    }

    @MainActor
    private func resetManifestImportState() {
        manifestImportFileName = ""
        manifestImportPayload = nil
        manifestImportPreview = nil
        isManifestPreviewLoading = false
        isManifestApplying = false
    }
}

private struct BundleEditorSheet: View {
    let bundle: Bundle?
    let sourceItems: [BundleItem]
    let isSaving: Bool
    let onClose: () -> Void
    let onSave: (_ name: String, _ description: String, _ versionLabel: String, _ items: [BundleItem]) -> Void

    @State private var name: String
    @State private var description: String
    @State private var versionLabel = ""
    @State private var searchText = ""
    @State private var typeFilter = "all"
    @State private var selectedKeys: Set<String>

    init(
        bundle: Bundle?,
        sourceItems: [BundleItem],
        isSaving: Bool,
        onClose: @escaping () -> Void,
        onSave: @escaping (_ name: String, _ description: String, _ versionLabel: String, _ items: [BundleItem]) -> Void
    ) {
        self.bundle = bundle
        self.sourceItems = sourceItems
        self.isSaving = isSaving
        self.onClose = onClose
        self.onSave = onSave
        _name = State(initialValue: bundle?.name ?? "")
        _description = State(initialValue: bundle?.description ?? "")
        _selectedKeys = State(initialValue: Set((bundle?.items ?? []).map(bundleItemKey)))
    }

    private var candidates: [BundleEditorCandidate] {
        var map: [String: BundleEditorCandidate] = [:]

        for item in sourceItems {
            map[bundleItemKey(item)] = BundleEditorCandidate(key: bundleItemKey(item), item: item, found: true)
        }

        for item in bundle?.items ?? [] {
            let key = bundleItemKey(item)
            if map[key] == nil {
                map[key] = BundleEditorCandidate(key: key, item: item, found: false)
            }
        }

        return map.values.sorted {
            if $0.item.type != $1.item.type {
                return $0.item.type.rawValue < $1.item.type.rawValue
            }
            return $0.item.name < $1.item.name
        }
    }

    private var filteredCandidates: [BundleEditorCandidate] {
        candidates.filter { candidate in
            if typeFilter != "all", candidate.item.type.rawValue != typeFilter { return false }
            if searchText.isEmpty { return true }
            let haystack = "\(candidate.item.name) \(candidate.item.type.rawValue) \((candidate.item.providers ?? []).joined(separator: " "))"
            return haystack.localizedCaseInsensitiveContains(searchText)
        }
    }

    private var selectedItems: [BundleItem] {
        candidates.filter { selectedKeys.contains($0.key) }.map(\.item)
    }

    private var canSave: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !selectedItems.isEmpty && !isSaving
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack(spacing: 16) {
                    VStack(alignment: .leading, spacing: 10) {
                        TextField("Bundle name", text: $name)
                            .textFieldStyle(.roundedBorder)
                        TextField("Version label", text: $versionLabel)
                            .textFieldStyle(.roundedBorder)
                        TextField("Description", text: $description, axis: .vertical)
                            .textFieldStyle(.roundedBorder)
                            .lineLimit(3, reservesSpace: true)
                        Text("\(selectedItems.count) selected items")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .frame(width: 280, alignment: .topLeading)

                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            TextField("Filter assets…", text: $searchText)
                                .textFieldStyle(.roundedBorder)
                            Picker("Type", selection: $typeFilter) {
                                Text("All").tag("all")
                                ForEach(AssetType.allCases) { type in
                                    Text(type.label).tag(type.rawValue)
                                }
                            }
                            .pickerStyle(.menu)
                            .frame(width: 140)
                        }

                        List(filteredCandidates, selection: Binding(
                            get: { selectedKeys },
                            set: { selectedKeys = $0 }
                        )) { candidate in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack(spacing: 8) {
                                    Text(candidate.item.name)
                                        .font(.body.weight(.medium))
                                    Text(candidate.item.type.label)
                                        .font(.caption2.weight(.semibold))
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .background(Color.secondary.opacity(0.12), in: Capsule())
                                        .foregroundStyle(.secondary)
                                    if !candidate.found {
                                        Text("not found locally")
                                            .font(.caption2.weight(.semibold))
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 2)
                                            .background(Color.orange.opacity(0.12), in: Capsule())
                                            .foregroundStyle(.orange)
                                    }
                                }
                                Text((candidate.item.providers ?? []).compactMap { Provider(rawValue: $0)?.label ?? $0 }.joined(separator: " · "))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                if let path = candidate.item.projectPath ?? candidate.item.filePath {
                                    Text(path)
                                        .font(.caption2.monospaced())
                                        .foregroundStyle(.tertiary)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                        .frame(minHeight: 340)
                    }
                }
                .padding()

                Divider()

                HStack {
                    Text(bundle == nil ? "Bundle items are reusable snapshots of harness assets." : "Saving changed content creates a new bundle version.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button("Cancel") { onClose() }
                        .keyboardShortcut(.cancelAction)
                    Button(isSaving ? "Saving…" : (bundle == nil ? "Create Bundle" : "Save Bundle")) {
                        onSave(
                            name.trimmingCharacters(in: .whitespacesAndNewlines),
                            description.trimmingCharacters(in: .whitespacesAndNewlines),
                            versionLabel.trimmingCharacters(in: .whitespacesAndNewlines),
                            selectedItems
                        )
                    }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                    .disabled(!canSave)
                }
                .padding()
            }
            .navigationTitle(bundle == nil ? "Create Bundle" : "Edit Bundle")
        }
        .frame(minWidth: 860, minHeight: 620)
    }
}
