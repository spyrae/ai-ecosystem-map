import SwiftUI

struct AssetDetailView: View {
    let asset: Asset

    @Environment(APIClient.self) private var api
    @Environment(EcosystemStore.self) private var store
    @State private var content = ""
    @State private var originalContent = ""
    @State private var isLoadingContent = true
    @State private var connections: [String: ConnectionInfo] = [:]
    @State private var showDeleteConfirm = false

    var hasUnsavedChanges: Bool {
        !isLoadingContent && !content.isEmpty && content != originalContent
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                metadataSection
                capabilitySection
                topologySection
                healthSection
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
                }
            }
            ToolbarItem {
                Button(role: .destructive) {
                    showDeleteConfirm = true
                } label: {
                    Image(systemName: "trash")
                }
                .disabled(!asset.canDelete)
            }
        }
        .alert("Delete \(asset.name)?", isPresented: $showDeleteConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) { Task { await deleteAsset() } }
        } message: {
            Text("This will permanently delete the asset file.")
        }
        .task { await loadContent() }
        .task { await loadConnections() }
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
    private var topologySection: some View {
        let snapshot = store.assetTopologySnapshot(assetId: asset.id)
        if !snapshot.environments.isEmpty || !snapshot.projects.isEmpty || !snapshot.providers.isEmpty || !snapshot.dependsOn.isEmpty || !snapshot.dependedOnBy.isEmpty {
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
                                    .disabled(!asset.canConnect)
                                } else {
                                    Button(entry.state == .invalid ? entry.state.label : "Connect") {
                                        Task { await toggleConnection(tool: entry.provider, connect: true) }
                                    }
                                    .controlSize(.small)
                                    .buttonStyle(.borderedProminent)
                                    .disabled(isUnavailable)
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

    private var hasEditableContent: Bool {
        asset.canEdit
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

    private func save() async {
        do {
            try await api.updateAssetContent(assetId: asset.id, content: content, type: asset.type)
            originalContent = content
            store.showToast("Saved \(asset.name)")
        } catch {
            store.showToast("Save failed: \(error.localizedDescription)")
        }
    }

    private func toggleConnection(tool: String, connect: Bool) async {
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
