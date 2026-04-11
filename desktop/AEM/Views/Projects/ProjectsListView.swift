import SwiftUI

struct ProjectsListView: View {
    @Environment(APIClient.self) private var api
    @Environment(EcosystemStore.self) private var store
    @State private var showAddProject = false
    @State private var isDiscovering = false
    @State private var selectedProject: Project?
    @State private var projectAssets: [ProjectAsset] = []
    @State private var pendingSyncRequest: SyncRequestPayload?
    @State private var syncPlan: SyncPlan?
    @State private var syncTitle = ""
    @State private var isApplyingSync = false
    @State private var selectionMode = false
    @State private var selectedProjectAssetIDs: Set<String> = []
    @State private var typeFilter: String = "all"
    @State private var providerFilter: String = "all"
    @State private var batchTargetProjectPath = ""
    @State private var batchPreview: BatchSyncPreview?
    @State private var batchRequests: [SyncRequestPayload] = []
    @State private var batchTitle = ""
    @State private var isApplyingBatchSync = false

    var body: some View {
        NavigationSplitView {
            // Project list
            List(store.projects, selection: Binding(
                get: { selectedProject?.id },
                set: { id in
                    selectedProject = store.projects.first { $0.id == id }
                    selectionMode = false
                    selectedProjectAssetIDs.removeAll()
                    if let p = selectedProject {
                        Task { await loadProjectAssets(p) }
                    }
                }
            )) { project in
                HStack {
                    Image(systemName: "folder.fill")
                        .foregroundStyle(.blue)
                    VStack(alignment: .leading) {
                        HStack(spacing: 6) {
                            Text(project.name)
                                .font(.body.weight(.medium))
                            if project.environment_type == "remote" {
                                Text("Remote")
                                    .font(.caption2.weight(.semibold))
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(Color.blue.opacity(0.12), in: Capsule())
                                    .foregroundStyle(.blue)
                            }
                        }
                        Text(project.path)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                        if project.environment_type == "remote", let environmentName = project.environment_name {
                            Text(environmentName)
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                                .lineLimit(1)
                        }
                        if let summary = projectSummaryText(project) {
                            Text(summary)
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                                .lineLimit(1)
                        }
                    }
                }
                .tag(project.id)
            }
            .navigationTitle("Projects")
            .toolbar {
                ToolbarItem {
                    Button {
                        Task { await discover() }
                    } label: {
                        Label(isDiscovering ? "Scanning..." : "Discover", systemImage: "magnifyingglass")
                    }
                    .disabled(isDiscovering)
                }
                ToolbarItem {
                    Button { showAddProject = true } label: {
                        Label("Add", systemImage: "plus")
                    }
                }
            }
            .fileImporter(isPresented: $showAddProject, allowedContentTypes: [.folder]) { result in
                if case .success(let url) = result {
                    Task {
                        _ = try? await api.addProject(path: url.path)
                        await store.loadProjects(api: api)
                    }
                }
            }
        } detail: {
            if let project = selectedProject {
                VStack(alignment: .leading, spacing: 0) {
                    // Header
                    HStack {
                        VStack(alignment: .leading) {
                            HStack(spacing: 8) {
                                Text(project.name).font(.title2.weight(.semibold))
                                if project.environment_type == "remote" {
                                    Text("Remote")
                                        .font(.caption.weight(.semibold))
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 3)
                                        .background(Color.blue.opacity(0.12), in: Capsule())
                                        .foregroundStyle(.blue)
                                }
                            }
                            Text(project.path).font(.caption).foregroundStyle(.secondary)
                            if project.environment_type == "remote", let environmentName = project.environment_name {
                                Text(environmentName).font(.caption2).foregroundStyle(.tertiary)
                            }
                            if let summary = projectSummaryText(project) {
                                Text(summary)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                    }
                    .padding()
                    .background(.bar)

                    // Assets
                    if filteredProjectAssets.isEmpty {
                        ContentUnavailableView("No assets in this project", systemImage: "doc")
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else {
                        VStack(alignment: .leading, spacing: 12) {
                            if selectedProjectIsRemote {
                                Text("Remote project detected. Viewing assets is available; project-to-project sync stays disabled until remote project sync is implemented.")
                                    .font(.caption)
                                    .foregroundStyle(.blue)
                                    .padding(10)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(Color.blue.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                            }

                            HStack(spacing: 8) {
                                Button(selectionMode ? "Done" : "Select") {
                                    selectionMode.toggle()
                                    if !selectionMode {
                                        selectedProjectAssetIDs.removeAll()
                                    }
                                }
                                .controlSize(.small)
                                .disabled(selectedProjectIsRemote)

                                Button("Select Visible") {
                                    selectedProjectAssetIDs = Set(filteredProjectAssets.map(\.id))
                                }
                                .controlSize(.small)
                                .disabled(!selectionMode || filteredProjectAssets.isEmpty)

                                Button("Clear") {
                                    selectedProjectAssetIDs.removeAll()
                                }
                                .controlSize(.small)
                                .disabled(!selectionMode || selectedProjectAssets.isEmpty)

                                Picker("Type", selection: $typeFilter) {
                                    Text("All types").tag("all")
                                    ForEach(AssetType.allCases) { type in
                                        Text(type.label).tag(type.rawValue)
                                    }
                                }
                                .pickerStyle(.menu)
                                .controlSize(.small)
                                .frame(width: 130)

                                Picker("Provider", selection: $providerFilter) {
                                    Text("All providers").tag("all")
                                    ForEach(projectProviders, id: \.self) { provider in
                                        Text(Provider(rawValue: provider)?.label ?? provider).tag(provider)
                                    }
                                }
                                .pickerStyle(.menu)
                                .controlSize(.small)
                                .frame(width: 150)

                                if selectionMode {
                                    Text("\(selectedProjectAssets.count) selected")
                                        .font(.caption.weight(.medium))
                                        .foregroundStyle(Color.accentColor)
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 5)
                                        .background(Color.accentColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 6))

                                    Picker("Target Project", selection: $batchTargetProjectPath) {
                                        Text("Target project").tag("")
                                        ForEach(targetProjects) { targetProject in
                                            Text(targetProject.name).tag(targetProject.path)
                                        }
                                    }
                                    .pickerStyle(.menu)
                                    .controlSize(.small)
                                    .frame(width: 180)

                                    Button("Link Selected") {
                                        Task { await previewBatchMove(method: "symlink") }
                                    }
                                    .controlSize(.small)
                                    .disabled(selectedProjectAssets.isEmpty || batchTargetProjectPath.isEmpty)

                                    Button("Copy Selected") {
                                        Task { await previewBatchMove(method: "copy") }
                                    }
                                    .controlSize(.small)
                                    .disabled(selectedProjectAssets.isEmpty || batchTargetProjectPath.isEmpty)
                                }
                            }

                            List(filteredProjectAssets) { asset in
                            HStack {
                                if selectionMode {
                                    Image(systemName: selectedProjectAssetIDs.contains(asset.id) ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(selectedProjectAssetIDs.contains(asset.id) ? Color.accentColor : Color.secondary.opacity(0.6))
                                }
                                Image(systemName: asset.type.icon)
                                    .foregroundStyle(.secondary)
                                VStack(alignment: .leading) {
                                    Text(asset.name).font(.body.monospaced())
                                    Text(asset.desc).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                    if let capabilitySummary = asset.capabilities?.summary {
                                        let items = capabilitySummary.compactItems.prefix(2)
                                        if !items.isEmpty {
                                            Text(items.joined(separator: " · "))
                                                .font(.caption2)
                                                .foregroundStyle(.tertiary)
                                                .lineLimit(1)
                                        }
                                    }
                                }
                                Spacer()
                                Text(asset.scope)
                                    .font(.caption2)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(asset.scope == "global" ? Color.blue.opacity(0.1) : Color.green.opacity(0.1), in: Capsule())
                            }
                            .contextMenu {
                                let otherProjects = targetProjects
                                if selectedProjectIsRemote || otherProjects.isEmpty {
                                    Text("No other projects")
                                } else {
                                    Menu("Copy to Project") {
                                        ForEach(otherProjects) { targetProject in
                                            Button(targetProject.name) {
                                                Task { await previewMove(asset: asset, to: targetProject, method: "copy") }
                                            }
                                        }
                                    }
                                    Menu("Link to Project") {
                                        ForEach(otherProjects) { targetProject in
                                            Button(targetProject.name) {
                                                Task { await previewMove(asset: asset, to: targetProject, method: "symlink") }
                                            }
                                        }
                                    }
                                }
                            }
                            .contentShape(Rectangle())
                            .onTapGesture {
                                if selectionMode {
                                    toggleProjectAssetSelection(asset)
                                }
                            }
                        }
                        }
                    }
                }
            } else {
                ContentUnavailableView("Select a project", systemImage: "folder")
            }
        }
        .task(id: api.isReady) {
            guard api.isReady else { return }
            await store.loadProjects(api: api)
        }
        .sheet(isPresented: Binding(
            get: { syncPlan != nil },
            set: { isPresented in
                if !isPresented {
                    syncPlan = nil
                    pendingSyncRequest = nil
                    syncTitle = ""
                }
            }
        )) {
            if let syncPlan {
                SyncPlanSheet(
                    title: syncTitle,
                    plan: syncPlan,
                    isApplying: isApplyingSync,
                    onApply: { Task { await applyPendingSync() } }
                )
            }
        }
        .sheet(isPresented: Binding(
            get: { batchPreview != nil },
            set: { isPresented in
                if !isPresented {
                    batchPreview = nil
                    batchRequests = []
                    batchTitle = ""
                }
            }
        )) {
            if let batchPreview {
                BatchSyncPlanSheet(
                    title: batchTitle,
                    preview: batchPreview,
                    isApplying: isApplyingBatchSync,
                    onApply: { Task { await applyPendingBatchSync() } }
                )
            }
        }
    }

    private func discover() async {
        isDiscovering = true
        defer { isDiscovering = false }
        let home = NSHomeDirectory()
        _ = try? await api.discoverProjects(dirs: ["\(home)/Projects", "\(home)/Documents/Projects"])
        await store.loadProjects(api: api)
        store.showToast("Discovered \(store.projects.count) projects")
    }

    private func loadProjectAssets(_ project: Project) async {
        projectAssets = (try? await api.fetchProjectAssets(projectId: project.id)) ?? []
        if batchTargetProjectPath.isEmpty {
            batchTargetProjectPath = targetProjects.first?.path ?? ""
        }
    }

    private func previewMove(asset: ProjectAsset, to targetProject: Project, method: String) async {
        do {
            let request = SyncRequestPayload(
                source: SyncSourceInput(
                    assetId: asset.id,
                    name: asset.name,
                    type: asset.type.rawValue,
                    filePath: asset.filePath,
                    providers: asset.providers,
                    projectPath: asset.projectPath
                ),
                target: SyncTargetInput(
                    kind: "project",
                    projectPath: targetProject.path,
                    method: method,
                    serverId: nil,
                    direction: nil
                )
            )
            let plan = try await api.previewSync(request)
            pendingSyncRequest = request
            syncPlan = plan
            syncTitle = "\(method == "symlink" ? "Link" : "Copy") \(asset.name) → \(targetProject.name)"
        } catch {
            store.showToast("Sync preview failed: \(error.localizedDescription)")
        }
    }

    private func applyPendingSync() async {
        guard let pendingSyncRequest else { return }
        isApplyingSync = true
        defer { isApplyingSync = false }

        do {
            let response = try await api.applySync(pendingSyncRequest)
            guard response.ok else {
                store.showToast("Sync failed: \(response.error ?? "Unknown error")")
                return
            }

            store.showToast("Sync applied")
            syncPlan = nil
            self.pendingSyncRequest = nil
            syncTitle = ""

            if let selectedProject {
                await loadProjectAssets(selectedProject)
            }
            await store.loadProjects(api: api)
        } catch {
            store.showToast("Sync failed: \(error.localizedDescription)")
        }
    }

    private var targetProjects: [Project] {
        store.projects.filter { $0.id != selectedProject?.id && $0.environment_type != "remote" }
    }

    private func projectSummaryText(_ project: Project) -> String? {
        let summary = store.projectTopologyNode(projectId: project.id)?.summary
        let assetCount = summary?.assetCount ?? project.assetCount
        let providerCount = summary?.providerCount ?? project.providers?.count
        var items: [String] = []
        if let assetCount {
            items.append("\(assetCount) assets")
        }
        if let providerCount {
            items.append("\(providerCount) providers")
        }
        return items.isEmpty ? nil : items.joined(separator: " · ")
    }

    private var selectedProjectIsRemote: Bool {
        selectedProject?.environment_type == "remote"
    }

    private var projectProviders: [String] {
        Array(Set(projectAssets.flatMap(\.providers))).sorted()
    }

    private var filteredProjectAssets: [ProjectAsset] {
        projectAssets.filter { asset in
            (typeFilter == "all" || asset.type.rawValue == typeFilter)
            && (providerFilter == "all" || asset.providers.contains(providerFilter))
        }
    }

    private var selectedProjectAssets: [ProjectAsset] {
        projectAssets.filter { selectedProjectAssetIDs.contains($0.id) }
    }

    private func toggleProjectAssetSelection(_ asset: ProjectAsset) {
        if selectedProjectAssetIDs.contains(asset.id) {
            selectedProjectAssetIDs.remove(asset.id)
        } else {
            selectedProjectAssetIDs.insert(asset.id)
        }
    }

    private func previewBatchMove(method: String) async {
        guard !selectedProjectAssets.isEmpty, !batchTargetProjectPath.isEmpty else { return }
        guard !selectedProjectIsRemote else {
            store.showToast("Remote project assets are view-only for now")
            return
        }
        let targetProject = targetProjects.first { $0.path == batchTargetProjectPath }
        guard let targetProject else {
            store.showToast("Choose a target project")
            return
        }

        do {
            let requests = selectedProjectAssets.map { asset in
                SyncRequestPayload(
                    source: SyncSourceInput(
                        assetId: asset.id,
                        name: asset.name,
                        type: asset.type.rawValue,
                        filePath: asset.filePath,
                        providers: asset.providers,
                        projectPath: asset.projectPath
                    ),
                    target: SyncTargetInput(
                        kind: "project",
                        projectPath: targetProject.path,
                        method: method,
                        serverId: nil,
                        direction: nil
                    )
                )
            }
            let preview = try await api.previewBatchSync(requests)
            batchRequests = requests
            batchPreview = preview
            batchTitle = "\(method == "symlink" ? "Link" : "Copy") \(selectedProjectAssets.count) assets → \(targetProject.name)"
        } catch {
            store.showToast("Batch sync preview failed: \(error.localizedDescription)")
        }
    }

    private func applyPendingBatchSync() async {
        guard !batchRequests.isEmpty else { return }
        isApplyingBatchSync = true
        defer { isApplyingBatchSync = false }

        do {
            let response = try await api.applyBatchSync(batchRequests)
            store.showToast("Batch sync applied: \(response.successCount)/\(response.total)")
            batchPreview = nil
            batchRequests = []
            batchTitle = ""

            if let selectedProject {
                await loadProjectAssets(selectedProject)
            }
            await store.loadProjects(api: api)
        } catch {
            store.showToast("Batch sync failed: \(error.localizedDescription)")
        }
    }
}

struct BatchSyncPlanSheet: View {
    let title: String
    let preview: BatchSyncPreview
    let isApplying: Bool
    let onApply: () -> Void

    @Environment(\.dismiss) private var dismiss

    private var blockingCount: Int {
        preview.results.reduce(into: 0) { count, result in
            if !result.ok {
                count += 1
            }
            if result.plan?.issues.contains(where: { $0.level == "blocking" }) == true {
                count += 1
            }
        }
    }

    private var canApply: Bool {
        preview.readyCount > 0 && preview.hasChangesCount > 0 && blockingCount == 0
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(title)
                        .font(.title3.weight(.semibold))
                    Text("\(preview.total) assets · \(preview.readyCount) ready · \(preview.blockedCount) blocked · \(preview.operationCount) operations")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                HStack(spacing: 12) {
                    summaryPill("Ready", value: preview.readyCount, tint: .green)
                    summaryPill("Blocked", value: preview.blockedCount, tint: .red)
                    summaryPill("With Changes", value: preview.hasChangesCount, tint: .accentColor)
                    summaryPill("Operations", value: preview.operationCount, tint: .orange)
                }

                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(preview.results) { result in
                            VStack(alignment: .leading, spacing: 10) {
                                HStack {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(result.name)
                                            .font(.headline)
                                        Text(result.ok ? "\(result.plan?.operations.count ?? 0) operations · \(result.plan?.issues.count ?? 0) issues" : "Preview failed")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Text(result.ok ? (result.plan?.hasChanges == true ? "changes" : "up to date") : "error")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(result.ok ? Color.accentColor : Color.red)
                                }

                                if let error = result.error, !result.ok {
                                    issueRow(level: "blocking", message: error)
                                }

                                ForEach(result.plan?.issues ?? []) { issue in
                                    issueRow(level: issue.level, message: issue.message)
                                }

                                if let operations = result.plan?.operations, !operations.isEmpty {
                                    VStack(alignment: .leading, spacing: 8) {
                                        ForEach(operations) { operation in
                                            VStack(alignment: .leading, spacing: 4) {
                                                HStack {
                                                    Text(operation.summary)
                                                        .font(.subheadline)
                                                    Spacer()
                                                    Text(operation.action.uppercased())
                                                        .font(.caption2.weight(.semibold))
                                                        .foregroundStyle(.secondary)
                                                }
                                                if let targetPath = operation.targetPath, !targetPath.isEmpty {
                                                    Text(targetPath)
                                                        .font(.caption.monospaced())
                                                        .foregroundStyle(.secondary)
                                                        .textSelection(.enabled)
                                                }
                                            }
                                            .padding(10)
                                            .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                                        }
                                    }
                                } else if result.ok {
                                    Text("No operations generated for this asset.")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .padding(14)
                            .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
                        }
                    }
                }

                HStack {
                    Text(canApply
                         ? "Batch sync will be applied through the unified sync engine."
                         : "Resolve blocking issues or select assets with pending changes before applying.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    Spacer()
                    Button("Cancel") { dismiss() }
                        .keyboardShortcut(.cancelAction)
                    Button(isApplying ? "Applying..." : "Apply Batch Sync") {
                        onApply()
                    }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                    .disabled(isApplying || !canApply)
                }
            }
            .padding()
            .frame(minWidth: 760, minHeight: 560)
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
}
