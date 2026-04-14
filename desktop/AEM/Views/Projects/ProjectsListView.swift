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
    @State private var projectTypeDraft = ""
    @State private var isSavingProjectType = false
    @State private var projectRemediations: [String: [RemediationSuggestion]] = [:]
    @State private var loadingProjectRemediations: Set<String> = []
    @State private var applyingProjectRemediationID: String?

    var body: some View {
        VStack(spacing: 0) {
            topBar

            HSplitView {
            // Project list
            List(store.projects, selection: Binding(
                get: { selectedProject?.id },
                set: { id in
                    selectedProject = store.projects.first { $0.id == id }
                    projectTypeDraft = selectedProject?.project_type ?? ""
                    if selectedProject?.id == store.focusedProjectID {
                        store.focusedProjectID = nil
                    }
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
                            if let projectType = project.project_type, !projectType.isEmpty {
                                Text(projectType)
                                    .font(.caption2.weight(.semibold))
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(Color.purple.opacity(0.12), in: Capsule())
                                    .foregroundStyle(.purple)
                            }
                            if let policy = project.policy, policy.violationCount > 0 {
                                Text(policy.status.rawValue)
                                    .font(.caption2.weight(.semibold))
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(policy.status.tint.opacity(0.12), in: Capsule())
                                    .foregroundStyle(policy.status.tint)
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
                        if let git = project.git {
                            Text("Git: \(git.summary)")
                                .font(.caption2)
                                .foregroundStyle(gitTint(git))
                                .lineLimit(1)
                        }
                    }
                }
                .tag(project.id)
            }
            .listStyle(.sidebar)
            .frame(minWidth: 280, idealWidth: 300, maxWidth: 340)
            .fileImporter(isPresented: $showAddProject, allowedContentTypes: [.folder]) { result in
                if case .success(let url) = result {
                    Task {
                        _ = try? await api.addProject(path: url.path)
                        await store.loadProjects(api: api)
                    }
                }
            }

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
                                if let projectType = project.project_type, !projectType.isEmpty {
                                    Text(projectType)
                                        .font(.caption.weight(.semibold))
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 3)
                                        .background(Color.purple.opacity(0.12), in: Capsule())
                                        .foregroundStyle(.purple)
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
                            if let git = project.git {
                                Text("Git: \(git.summary)")
                                    .font(.caption)
                                    .foregroundStyle(gitTint(git))
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
                            GroupBox {
                                VStack(alignment: .leading, spacing: 10) {
                                    HStack(alignment: .bottom, spacing: 12) {
                                        VStack(alignment: .leading, spacing: 6) {
                                            Text("Project Type")
                                                .font(.caption.weight(.semibold))
                                                .foregroundStyle(.secondary)
                                            HStack(spacing: 8) {
                                                TextField("web-app, infra, research…", text: $projectTypeDraft)
                                                    .textFieldStyle(.roundedBorder)
                                                    .disabled(store.globalReadOnly)
                                                Button(isSavingProjectType ? "Saving..." : "Save") {
                                                    Task { await saveProjectType(project) }
                                                }
                                                .disabled(store.globalReadOnly || isSavingProjectType)
                                            }
                                        }
                                        Spacer()
                                        if let policy = project.policy {
                                            VStack(alignment: .leading, spacing: 4) {
                                                Text("Policy")
                                                    .font(.caption.weight(.semibold))
                                                    .foregroundStyle(.secondary)
                                                Text(policy.summary)
                                                    .font(.caption)
                                                    .foregroundStyle(policy.status.tint)
                                            }
                                            .padding(10)
                                            .background(policy.status.tint.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                                        }
                                    }
                                    if let policy = project.policy, !policy.violations.isEmpty {
                                        VStack(alignment: .leading, spacing: 6) {
                                            ForEach(policy.violations.prefix(3)) { violation in
                                                Text("\(violation.policyName): \(violation.message)")
                                                    .font(.caption)
                                                    .foregroundStyle(.secondary)
                                                    .padding(8)
                                                    .frame(maxWidth: .infinity, alignment: .leading)
                                                    .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                                            }
                                            if policy.violations.count > 3 {
                                                Text("+\(policy.violations.count - 3) more policy issues")
                                                    .font(.caption2)
                                                    .foregroundStyle(.tertiary)
                                            }
                                        }
                                    }

                                    let remediations = projectRemediations[project.id] ?? []
                                    if loadingProjectRemediations.contains(project.id) || !remediations.isEmpty {
                                        VStack(alignment: .leading, spacing: 8) {
                                            Text("Suggested Fixes")
                                                .font(.caption.weight(.semibold))
                                                .foregroundStyle(.secondary)
                                            if loadingProjectRemediations.contains(project.id) {
                                                ProgressView()
                                            } else {
                                                ForEach(remediations) { suggestion in
                                                    VStack(alignment: .leading, spacing: 6) {
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
                                                                    ForEach(Array(suggestion.details.enumerated()), id: \.offset) { entry in
                                                                        Text(entry.element)
                                                                            .font(.caption2)
                                                                            .foregroundStyle(.tertiary)
                                                                    }
                                                                }
                                                            }
                                                            Spacer()
                                                            if suggestion.canApply {
                                                                Button(applyingProjectRemediationID == suggestion.id ? "Applying..." : (suggestion.applyLabel ?? "Apply")) {
                                                                    Task { await applyProjectRemediation(project, suggestion: suggestion) }
                                                                }
                                                                .controlSize(.small)
                                                                .buttonStyle(.borderedProminent)
                                                                .disabled(store.globalReadOnly || applyingProjectRemediationID != nil)
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
                                                    .padding(8)
                                                    .frame(maxWidth: .infinity, alignment: .leading)
                                                    .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            if store.globalReadOnly {
                                Text("Global read-only audit mode is enabled. Project sync actions are disabled until audit mode is turned off.")
                                    .font(.caption)
                                    .foregroundStyle(.orange)
                                    .padding(10)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                            }

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
                                .disabled(store.globalReadOnly || selectedProjectIsRemote)

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
                                    .disabled(store.globalReadOnly || selectedProjectAssets.isEmpty || batchTargetProjectPath.isEmpty)

                                    Button("Copy Selected") {
                                        Task { await previewBatchMove(method: "copy") }
                                    }
                                    .controlSize(.small)
                                    .disabled(store.globalReadOnly || selectedProjectAssets.isEmpty || batchTargetProjectPath.isEmpty)
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
                                if let drift = asset.drift {
                                    Text(drift.status.label)
                                        .font(.caption2.weight(.semibold))
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .background(drift.status.tint.opacity(0.12), in: Capsule())
                                        .foregroundStyle(drift.status.tint)
                                        .help(drift.summary)
                                }
                                if let git = asset.git, let relevantStatus = git.relevantStatus, relevantStatus != .clean {
                                    Text(relevantStatus.rawValue)
                                        .font(.caption2.weight(.semibold))
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .background(gitTint(git).opacity(0.12), in: Capsule())
                                        .foregroundStyle(gitTint(git))
                                        .help(git.summary)
                                }
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
                                            .disabled(store.globalReadOnly)
                                        }
                                    }
                                    Menu("Link to Project") {
                                        ForEach(otherProjects) { targetProject in
                                            Button(targetProject.name) {
                                                Task { await previewMove(asset: asset, to: targetProject, method: "symlink") }
                                            }
                                            .disabled(store.globalReadOnly)
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
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
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
                    readOnly: store.globalReadOnly,
                    readOnlyReason: store.globalReadOnly ? "Global read-only audit mode is enabled." : nil,
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
                    readOnly: store.globalReadOnly,
                    readOnlyReason: store.globalReadOnly ? "Global read-only audit mode is enabled." : nil,
                    onApply: { Task { await applyPendingBatchSync() } }
                )
            }
        }
        .task(id: store.focusedProjectID) {
            await applyFocusedProjectSelection()
        }
    }

    private var topBar: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Projects")
                    .font(.headline)
                Text("\(store.projects.count) discovered projects across local and remote environments.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Button {
                Task { await discover() }
            } label: {
                Label(isDiscovering ? "Scanning..." : "Discover", systemImage: "magnifyingglass")
            }
            .disabled(isDiscovering)

            Button {
                showAddProject = true
            } label: {
                Label("Add", systemImage: "plus")
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.bar)
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
        loadingProjectRemediations.insert(project.id)
        defer { loadingProjectRemediations.remove(project.id) }

        async let assetsTask = api.fetchProjectAssets(projectId: project.id)
        async let remediationsTask = api.fetchProjectRemediations(projectId: project.id)

        let loaded = (try? await assetsTask) ?? []
        projectAssets = store.decorateProjectAssets(loaded)
        projectRemediations[project.id] = (try? await remediationsTask) ?? []
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
        guard !store.globalReadOnly else {
            store.showToast("Global read-only audit mode is enabled")
            return
        }
        guard let pendingSyncRequest else { return }
        isApplyingSync = true
        defer { isApplyingSync = false }

        do {
            let response = try await api.applySync(pendingSyncRequest, approval: .client("macos", note: "Approved project sync"))
            guard response.ok else {
                store.showToast("Sync failed: \(response.error ?? "Unknown error")")
                return
            }

            store.showToast("Sync applied")
            syncPlan = nil
            self.pendingSyncRequest = nil
            syncTitle = ""

            await store.loadProjects(api: api)
            if let selectedProject {
                await loadProjectAssets(selectedProject)
            }
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
        if let projectType = project.project_type, !projectType.isEmpty {
            items.append(projectType)
        }
        items.append(contentsOf: project.policy?.compactItems ?? [])
        return items.isEmpty ? nil : items.joined(separator: " · ")
    }

    private func gitTint(_ git: GitContext) -> Color {
        if git.conflictedCount > 0 { return .red }
        return git.dirty ? .orange : .green
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

    private func confirmRiskyProjectRemediation(_ suggestion: RemediationSuggestion) -> Bool {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Apply risky fix?"
        alert.informativeText = ([suggestion.summary] + suggestion.details).joined(separator: "\n")
        alert.addButton(withTitle: suggestion.applyLabel ?? "Apply")
        alert.addButton(withTitle: "Cancel")
        return alert.runModal() == .alertFirstButtonReturn
    }

    @MainActor
    private func applyProjectRemediation(_ project: Project, suggestion: RemediationSuggestion) async {
        guard suggestion.canApply else { return }
        guard !store.globalReadOnly else {
            store.showToast("Global read-only audit mode is enabled")
            return
        }
        guard applyingProjectRemediationID == nil else { return }
        if suggestion.risky && !confirmRiskyProjectRemediation(suggestion) {
            return
        }

        applyingProjectRemediationID = suggestion.id
        defer { applyingProjectRemediationID = nil }

        do {
            _ = try await api.applyProjectRemediation(
                projectId: project.id,
                remediationId: suggestion.id,
                confirmRisk: suggestion.risky,
                approval: .client("macos", note: suggestion.risky ? "Approved risky project remediation" : "Approved project remediation")
            )
            store.showToast(suggestion.applyLabel ?? "Fix applied")
            await store.loadProjects(api: api)
            if let refreshed = store.projects.first(where: { $0.id == project.id }) {
                selectedProject = refreshed
                projectTypeDraft = refreshed.project_type ?? ""
                await loadProjectAssets(refreshed)
            }
        } catch {
            store.showToast(error.localizedDescription.isEmpty ? "Failed to apply suggested fix" : error.localizedDescription)
        }
    }

    @MainActor
    private func saveProjectType(_ project: Project) async {
        guard !store.globalReadOnly else {
            store.showToast("Global read-only audit mode is enabled")
            return
        }
        let trimmed = projectTypeDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        let current = (project.project_type ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed != current else { return }
        isSavingProjectType = true
        defer { isSavingProjectType = false }

        do {
            let updated = try await api.updateProject(id: project.id, projectType: trimmed.isEmpty ? nil : trimmed)
            await store.loadProjects(api: api)
            if selectedProject?.id == updated.id {
                selectedProject = store.projects.first(where: { $0.id == updated.id }) ?? updated
            }
            projectTypeDraft = selectedProject?.project_type ?? updated.project_type ?? ""
            store.showToast(trimmed.isEmpty ? "Project type cleared" : "Project type set to \(trimmed)")
        } catch {
            store.showToast("Failed to update project type: \(error.localizedDescription)")
        }
    }

    private func applyPendingBatchSync() async {
        guard !store.globalReadOnly else {
            store.showToast("Global read-only audit mode is enabled")
            return
        }
        guard !batchRequests.isEmpty else { return }
        isApplyingBatchSync = true
        defer { isApplyingBatchSync = false }

        do {
            let response = try await api.applyBatchSync(batchRequests, approval: .client("macos", note: "Approved batch project sync"))
            store.showToast("Batch sync applied: \(response.successCount)/\(response.total)")
            batchPreview = nil
            batchRequests = []
            batchTitle = ""

            await store.loadProjects(api: api)
            if let selectedProject {
                await loadProjectAssets(selectedProject)
            }
        } catch {
            store.showToast("Batch sync failed: \(error.localizedDescription)")
        }
    }

    @MainActor
    private func applyFocusedProjectSelection() async {
        guard let focusedProjectID = store.focusedProjectID,
              let project = store.projects.first(where: { $0.id == focusedProjectID }) else { return }
        guard selectedProject?.id != project.id else {
            store.focusedProjectID = nil
            return
        }
        selectedProject = project
        projectTypeDraft = project.project_type ?? ""
        selectionMode = false
        selectedProjectAssetIDs.removeAll()
        store.focusedProjectID = nil
        await loadProjectAssets(project)
    }
}

struct BatchSyncPlanSheet: View {
    let title: String
    let preview: BatchSyncPreview
    let isApplying: Bool
    let readOnly: Bool
    let readOnlyReason: String?
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
        !readOnly && preview.readyCount > 0 && preview.hasChangesCount > 0 && blockingCount == 0
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

                if let readOnlyReason {
                    issueRow(level: "warning", message: readOnlyReason)
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

                                if let git = result.plan?.target?.git {
                                    HStack(alignment: .top, spacing: 8) {
                                        Image(systemName: git.conflictedCount > 0 ? "exclamationmark.triangle.fill" : "arrow.triangle.branch")
                                            .foregroundStyle(git.conflictedCount > 0 ? .red : (git.dirty ? .orange : .green))
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text("Git Target")
                                                .font(.caption.weight(.semibold))
                                            Text(git.summary)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                    .padding(10)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background((git.conflictedCount > 0 ? Color.red : (git.dirty ? Color.orange : Color.green)).opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
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
