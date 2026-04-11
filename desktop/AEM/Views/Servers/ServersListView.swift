import SwiftUI

struct ServersListView: View {
    @Environment(APIClient.self) private var api
    @Environment(EcosystemStore.self) private var store
    @State private var showAddServer = false
    @State private var selectedServer: ServerEnvironment?
    @State private var diff: DiffResult?
    @State private var pendingSyncRequest: SyncRequestPayload?
    @State private var syncPlan: SyncPlan?
    @State private var syncTitle = ""
    @State private var isApplyingSync = false
    @State private var typeFilter = "all"
    @State private var providerFilter = "all"
    @State private var batchPreview: BatchSyncPreview?
    @State private var batchRequests: [SyncRequestPayload] = []
    @State private var batchTitle = ""
    @State private var isApplyingBatchSync = false
    @State private var discoveringProjects = Set<String>()

    var body: some View {
        NavigationSplitView {
            List(store.servers, selection: Binding(
                get: { selectedServer?.id },
                set: { id in selectedServer = store.servers.first { $0.id == id } }
            )) { server in
                HStack {
                    Circle()
                        .fill(server.type == "local" ? .green : .blue)
                        .frame(width: 8, height: 8)
                    VStack(alignment: .leading) {
                        Text(server.name).font(.body.weight(.medium))
                        if let host = server.ssh_host {
                            Text("\(server.ssh_user ?? "")@\(host)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else {
                            Text("Local machine")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        if let summary = serverSummaryText(server) {
                            Text(summary)
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                                .lineLimit(1)
                        }
                    }
                }
                .tag(server.id)
            }
            .navigationTitle("Servers")
            .toolbar {
                ToolbarItem {
                    Button { showAddServer = true } label: {
                        Label("Add Server", systemImage: "plus")
                    }
                }
            }
        } detail: {
            if let server = selectedServer {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        // Server info
                        GroupBox {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(server.name).font(.title3.weight(.semibold))
                                if let summary = serverSummaryText(server) {
                                    Text(summary)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                if server.type == "remote" {
                                    LabeledContent("Host", value: server.ssh_host ?? "-")
                                    LabeledContent("User", value: server.ssh_user ?? "-")
                                    LabeledContent("Port", value: String(server.ssh_port ?? 22))

                                    HStack(spacing: 8) {
                                        Button("Test Connection") {
                                            let api = api
                                            let store = store
                                            Task {
                                                let result = try? await api.testServer(id: server.id)
                                                if let result {
                                                    store.showToast("Connection OK: \(result)")
                                                }
                                            }
                                        }
                                        Button("Scan Assets") {
                                            let api = api
                                            let store = store
                                            Task {
                                                let count = try? await api.scanServer(id: server.id)
                                                store.showToast("Found \(count ?? 0) assets")
                                            }
                                        }
                                        Button(discoveringProjects.contains(server.id) ? "Discovering..." : "Discover Projects") {
                                            let api = api
                                            let store = store
                                            discoveringProjects.insert(server.id)
                                            Task {
                                                defer { discoveringProjects.remove(server.id) }
                                                do {
                                                    let projects = try await api.discoverRemoteProjects(serverId: server.id)
                                                    await store.loadProjects(api: api)
                                                    store.showToast(
                                                        projects.isEmpty
                                                            ? "No remote projects with AI tooling found"
                                                            : "Discovered \(projects.count) remote projects"
                                                    )
                                                } catch {
                                                    store.showToast("Remote project discovery failed: \(error.localizedDescription)")
                                                }
                                            }
                                        }
                                        .disabled(discoveringProjects.contains(server.id))
                                        Button("Compare") {
                                            let api = api
                                            Task { diff = try? await api.diffServer(id: server.id) }
                                        }
                                    }
                                    .padding(.top, 4)
                                } else {
                                    Text("Local machine").foregroundStyle(.secondary)
                                }
                            }
                        }

                        // Diff view
                        if let diff {
                            GroupBox("Diff: Local vs \(server.name)") {
                                VStack(alignment: .leading, spacing: 12) {
                                    HStack(spacing: 16) {
                                        Text("Local: \(diff.localCount)")
                                        Text("Remote: \(diff.remoteCount)")
                                        Text("Only Local: \(diff.onlyLocal.count)")
                                        Text("Only Remote: \(diff.onlyRemote.count)")
                                        Text("Same: \(diff.sameCount ?? 0)")
                                        Text("Drifted: \(diff.driftedCount ?? 0)")
                                    }
                                    .font(.caption)
                                    .foregroundStyle(.secondary)

                                    HStack(spacing: 8) {
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
                                            ForEach(diffProviders(for: diff), id: \.self) { provider in
                                                Text(Provider(rawValue: provider)?.label ?? provider).tag(provider)
                                            }
                                        }
                                        .pickerStyle(.menu)
                                        .controlSize(.small)
                                        .frame(width: 150)

                                        Button("Push Visible Only-Local") {
                                            Task {
                                                await previewBatchServerSync(
                                                    server: server,
                                                    assets: filteredOnlyLocal(diff: diff),
                                                    direction: "push",
                                                    title: "Push \(filteredOnlyLocal(diff: diff).count) assets"
                                                )
                                            }
                                        }
                                        .controlSize(.small)
                                        .disabled(filteredOnlyLocal(diff: diff).isEmpty)

                                        Button("Pull Visible Only-Remote") {
                                            Task {
                                                await previewBatchServerSync(
                                                    server: server,
                                                    assets: filteredOnlyRemote(diff: diff),
                                                    direction: "pull",
                                                    title: "Pull \(filteredOnlyRemote(diff: diff).count) assets"
                                                )
                                            }
                                        }
                                        .controlSize(.small)
                                        .disabled(filteredOnlyRemote(diff: diff).isEmpty)

                                        Button("Push Visible Drifted") {
                                            Task {
                                                await previewBatchServerSync(
                                                    server: server,
                                                    assets: filteredDriftedAssets(diff: diff, direction: "push"),
                                                    direction: "push",
                                                    title: "Push \(filteredDriftedAssets(diff: diff, direction: "push").count) drifted assets"
                                                )
                                            }
                                        }
                                        .controlSize(.small)
                                        .disabled(filteredDriftedAssets(diff: diff, direction: "push").isEmpty)

                                        Button("Pull Visible Drifted") {
                                            Task {
                                                await previewBatchServerSync(
                                                    server: server,
                                                    assets: filteredDriftedAssets(diff: diff, direction: "pull"),
                                                    direction: "pull",
                                                    title: "Pull \(filteredDriftedAssets(diff: diff, direction: "pull").count) drifted assets"
                                                )
                                            }
                                        }
                                        .controlSize(.small)
                                        .disabled(filteredDriftedAssets(diff: diff, direction: "pull").isEmpty)
                                    }

                                    HStack(alignment: .top, spacing: 16) {
                                        diffColumn("Only Local", assets: filteredOnlyLocal(diff: diff), color: .green, server: server, canPush: true)
                                        Divider()
                                        diffColumn("Only Remote", assets: filteredOnlyRemote(diff: diff), color: .blue, server: server, canPush: false)
                                    }

                                    semanticDiffSection(diff: filteredDiff(diff), server: server)
                                }
                            }
                        }
                    }
                    .padding()
                }
            } else {
                ContentUnavailableView("Select a server", systemImage: "server.rack")
            }
        }
        .task(id: api.isReady) {
            guard api.isReady else { return }
            await store.loadServers(api: api)
        }
        .sheet(isPresented: $showAddServer) {
            AddServerSheet()
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

    private func serverSummaryText(_ server: ServerEnvironment) -> String? {
        let summary = store.environmentTopologyNode(environmentId: server.id, environmentType: server.type)?.summary
        var items: [String] = []
        if let projectCount = summary?.projectCount {
            items.append("\(projectCount) projects")
        }
        if let providerCount = summary?.providerCount {
            items.append("\(providerCount) providers")
        }
        if let agentCount = summary?.agentCount {
            items.append("\(agentCount) agents")
        }
        return items.isEmpty ? nil : items.joined(separator: " · ")
    }

    private func diffColumn(_ title: String, assets: [Asset], color: Color, server: ServerEnvironment, canPush: Bool) -> some View {
        let syncableTypes: Set<AssetType> = [.skill, .agent, .instruction, .rule, .mcp]

        return VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(color)
            if assets.isEmpty {
                Text("None").font(.caption).foregroundStyle(.secondary)
            } else {
                ForEach(assets) { asset in
                    HStack(spacing: 4) {
                        Image(systemName: asset.type.icon)
                            .font(.caption2)
                        Text(asset.name)
                            .font(.caption.monospaced())
                        Spacer()
                        if canPush, syncableTypes.contains(asset.type) {
                            Button("Push") {
                                Task { await previewServerSync(serverId: server.id, asset: asset, direction: "push") }
                            }
                            .controlSize(.mini)
                        } else if !canPush, syncableTypes.contains(asset.type) {
                            Button("Pull") {
                                Task { await previewServerSync(serverId: server.id, asset: asset, direction: "pull") }
                            }
                            .controlSize(.mini)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func semanticDiffSection(diff: DiffResult, server: ServerEnvironment) -> some View {
        let drifted = diff.both.filter { $0.status == "drifted" }
        let same = diff.both.filter { $0.status == "same" }

        VStack(alignment: .leading, spacing: 10) {
            if !drifted.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Drifted")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.orange)

                    ForEach(drifted, id: \.local.id) { pair in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 6) {
                                Image(systemName: pair.local.type.icon)
                                    .font(.caption2)
                                Text(pair.local.name)
                                    .font(.caption.monospaced())
                                Spacer()
                                Button("Push") {
                                    Task { await previewServerSync(serverId: server.id, asset: pair.local, direction: "push") }
                                }
                                .controlSize(.mini)
                                Button("Pull") {
                                    Task { await previewServerSync(serverId: server.id, asset: pair.remote, direction: "pull") }
                                }
                                .controlSize(.mini)
                            }

                            Text(pair.summary)
                                .font(.caption2)
                                .foregroundStyle(.secondary)

                            if !pair.reasons.isEmpty {
                                FlowLayout(spacing: 4) {
                                    ForEach(pair.reasons) { reason in
                                        Text(reason.code.replacingOccurrences(of: "_", with: " "))
                                            .font(.caption2)
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 2)
                                            .background(Color.orange.opacity(0.12), in: Capsule())
                                    }
                                }
                            }
                        }
                        .padding(10)
                        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                    }
                }
            }

            if !same.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Same on both")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.green)
                    Text(same.prefix(10).map(\.local.name).joined(separator: ", ") + (same.count > 10 ? " …and \(same.count - 10) more" : ""))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func previewServerSync(serverId: String, asset: Asset, direction: String) async {
        do {
            let request = SyncRequestPayload(
                source: SyncSourceInput(
                    assetId: asset.id,
                    name: asset.name,
                    type: asset.type.rawValue,
                    filePath: asset.filePath,
                    providers: asset.providers,
                    projectPath: nil
                ),
                target: SyncTargetInput(
                    kind: "server",
                    projectPath: nil,
                    method: nil,
                    serverId: serverId,
                    direction: direction
                )
            )
            let plan = try await api.previewSync(request)
            pendingSyncRequest = request
            syncPlan = plan
            syncTitle = "\(direction == "push" ? "Push" : "Pull") \(asset.name)"
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

            if let selectedServer {
                diff = try? await api.diffServer(id: selectedServer.id)
            }
            await store.loadServers(api: api)
        } catch {
            store.showToast("Sync failed: \(error.localizedDescription)")
        }
    }

    private func diffProviders(for diff: DiffResult) -> [String] {
        Array(Set(
            diff.onlyLocal.flatMap(\.providers)
            + diff.onlyRemote.flatMap(\.providers)
            + diff.both.flatMap { $0.local.providers }
        )).sorted()
    }

    private func assetMatchesFilters(_ asset: Asset) -> Bool {
        (typeFilter == "all" || asset.type.rawValue == typeFilter)
        && (providerFilter == "all" || asset.providers.contains(providerFilter))
    }

    private func filteredOnlyLocal(diff: DiffResult) -> [Asset] {
        diff.onlyLocal.filter(assetMatchesFilters)
    }

    private func filteredOnlyRemote(diff: DiffResult) -> [Asset] {
        diff.onlyRemote.filter(assetMatchesFilters)
    }

    private func filteredDriftedAssets(diff: DiffResult, direction: String) -> [Asset] {
        diff.both
            .filter { $0.status == "drifted" && assetMatchesFilters($0.local) }
            .map { pair in direction == "push" ? pair.local : pair.remote }
    }

    private func filteredDiff(_ diff: DiffResult) -> DiffResult {
        let filteredBoth = diff.both.filter { assetMatchesFilters($0.local) }
        return DiffResult(
            onlyLocal: filteredOnlyLocal(diff: diff),
            onlyRemote: filteredOnlyRemote(diff: diff),
            both: filteredBoth,
            localCount: diff.localCount,
            remoteCount: diff.remoteCount,
            sameCount: filteredBoth.filter { $0.status == "same" }.count,
            driftedCount: filteredBoth.filter { $0.status == "drifted" }.count,
            reasonCounts: diff.reasonCounts
        )
    }

    private func previewBatchServerSync(server: ServerEnvironment, assets: [Asset], direction: String, title: String) async {
        guard !assets.isEmpty else { return }
        do {
            let requests = assets.map { asset in
                SyncRequestPayload(
                    source: SyncSourceInput(
                        assetId: asset.id,
                        name: asset.name,
                        type: asset.type.rawValue,
                        filePath: asset.filePath,
                        providers: asset.providers,
                        projectPath: nil
                    ),
                    target: SyncTargetInput(
                        kind: "server",
                        projectPath: nil,
                        method: nil,
                        serverId: server.id,
                        direction: direction
                    )
                )
            }
            let preview = try await api.previewBatchSync(requests)
            batchRequests = requests
            batchPreview = preview
            batchTitle = title
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

            if let selectedServer {
                diff = try? await api.diffServer(id: selectedServer.id)
            }
            await store.loadServers(api: api)
        } catch {
            store.showToast("Batch sync failed: \(error.localizedDescription)")
        }
    }
}

// MARK: - Add Server Sheet

struct AddServerSheet: View {
    @Environment(APIClient.self) private var api
    @Environment(EcosystemStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var host = ""
    @State private var user = "root"
    @State private var port = "22"
    @State private var keyPath = ""
    @State private var showKeyPicker = false

    var body: some View {
        VStack(spacing: 16) {
            Text("Add Remote Server").font(.headline)

            Form {
                TextField("Name", text: $name)
                TextField("Host", text: $host)
                TextField("User", text: $user)
                TextField("Port", text: $port)
                HStack {
                    TextField("SSH Key Path", text: $keyPath)
                    Button("Browse") { showKeyPicker = true }
                }
            }
            .formStyle(.grouped)

            HStack {
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button("Add") {
                    let api = api
                    let store = store
                    Task {
                        _ = try? await api.addServer(
                            name: name,
                            host: host,
                            user: user,
                            port: Int(port) ?? 22,
                            keyPath: keyPath.isEmpty ? nil : keyPath
                        )
                        await store.loadServers(api: api)
                        dismiss()
                    }
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .disabled(name.isEmpty || host.isEmpty)
            }
            .padding(.horizontal)
        }
        .padding()
        .frame(width: 400)
        .fileImporter(isPresented: $showKeyPicker, allowedContentTypes: [.item]) { result in
            if case .success(let url) = result {
                keyPath = url.path
            }
        }
    }
}

struct SyncPlanSheet: View {
    let title: String
    let plan: SyncPlan
    let isApplying: Bool
    let onApply: () -> Void

    @Environment(\.dismiss) private var dismiss

    private var hasBlockingIssues: Bool {
        plan.issues.contains { $0.level == "blocking" }
    }

    private var canApply: Bool {
        plan.canApply && plan.hasChanges && !hasBlockingIssues
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(title)
                        .font(.title3.weight(.semibold))
                    Text("\(plan.source?.name ?? "Asset") → \(plan.target?.label ?? plan.target?.kind ?? "Target")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if !plan.issues.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Issues")
                            .font(.headline)
                        ForEach(plan.issues) { issue in
                            HStack(alignment: .top, spacing: 8) {
                                Image(systemName: issue.level == "blocking" ? "exclamationmark.triangle.fill" : "exclamationmark.circle")
                                    .foregroundStyle(issue.level == "blocking" ? .red : .orange)
                                Text(issue.message)
                                    .font(.caption)
                            }
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Planned Actions")
                        .font(.headline)
                    if plan.operations.isEmpty {
                        Text("No operations generated")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 8) {
                                ForEach(plan.operations) { operation in
                                    HStack(alignment: .top, spacing: 8) {
                                        Text(operation.action.uppercased())
                                            .font(.caption2.weight(.semibold))
                                            .foregroundStyle(actionColor(operation.action))
                                            .frame(width: 56, alignment: .leading)
                                        VStack(alignment: .leading, spacing: 3) {
                                            Text(operation.summary)
                                                .font(.caption)
                                            if let targetPath = operation.targetPath ?? operation.targetPathRemote {
                                                Text(targetPath)
                                                    .font(.caption2.monospaced())
                                                    .foregroundStyle(.secondary)
                                            }
                                        }
                                        Spacer(minLength: 0)
                                    }
                                    .padding(10)
                                    .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                                }
                            }
                        }
                    }
                }

                Spacer(minLength: 0)
            }
            .padding()
            .frame(minWidth: 560, minHeight: 420)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isApplying ? "Applying..." : "Apply Sync") {
                        onApply()
                    }
                    .disabled(isApplying || !canApply)
                }
            }
        }
    }

    private func actionColor(_ action: String) -> Color {
        switch action {
        case "create": return .green
        case "update": return .orange
        default: return .secondary
        }
    }
}
