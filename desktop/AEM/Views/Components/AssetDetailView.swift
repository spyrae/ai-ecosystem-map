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
                connectionsSection
                depsSection
                editorSection
            }
            .padding(16)
        }
        .toolbar {
            ToolbarItem {
                if hasFile && hasUnsavedChanges {
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

    private var connectionsSection: some View {
        GroupBox("Connections") {
            if connections.isEmpty {
                Text("Loading...")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                VStack(spacing: 6) {
                    ForEach(connections.sorted(by: { $0.key < $1.key }), id: \.key) { tool, info in
                        if info.supported == true {
                            HStack {
                                if let provider = Provider(rawValue: tool) {
                                    Image(systemName: provider.icon)
                                    Text(provider.label)
                                } else {
                                    Text(tool)
                                }
                                Spacer()
                                if info.isSource == true {
                                    // This is the original file location
                                    HStack(spacing: 4) {
                                        Circle().fill(.blue).frame(width: 6, height: 6)
                                        Text("source")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                } else if info.connected {
                                    HStack(spacing: 4) {
                                        Circle().fill(.green).frame(width: 6, height: 6)
                                        Text(info.isSymlink == true ? "symlink" : "connected")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Button("Disconnect") {
                                        Task { await toggleConnection(tool: tool, connect: false) }
                                    }
                                    .controlSize(.small)
                                } else {
                                    Button("Connect") {
                                        Task { await toggleConnection(tool: tool, connect: true) }
                                    }
                                    .controlSize(.small)
                                    .buttonStyle(.borderedProminent)
                                }
                            }
                            .font(.caption)
                        }
                    }
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

    private var hasFile: Bool {
        asset.filePath != nil && !(asset.filePath?.isEmpty ?? true) && asset.type != .mcp
    }

    @ViewBuilder
    private var editorSection: some View {
        if hasFile {
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
        }
    }

    // MARK: - Actions

    private func loadContent() async {
        guard hasFile else {
            isLoadingContent = false
            return
        }
        do {
            let result = try await api.fetchAssetContent(name: asset.name)
            content = result.content
            originalContent = result.content
        } catch {
            content = "// Failed to load: \(error.localizedDescription)"
        }
        isLoadingContent = false
    }

    private func loadConnections() async {
        do {
            connections = try await api.fetchConnections(name: asset.name, type: asset.type)
        } catch {
            // Silent fail
        }
    }

    private func save() async {
        do {
            try await api.updateAssetContent(name: asset.name, content: content)
            originalContent = content
            store.showToast("Saved \(asset.name)")
        } catch {
            store.showToast("Save failed: \(error.localizedDescription)")
        }
    }

    private func toggleConnection(tool: String, connect: Bool) async {
        do {
            if connect {
                try await api.connect(name: asset.name, tool: tool, type: asset.type)
            } else {
                try await api.disconnect(name: asset.name, tool: tool, type: asset.type)
            }
            await loadConnections()
            store.showToast(connect ? "Connected \(asset.name) → \(tool)" : "Disconnected \(asset.name) from \(tool)")
        } catch {
            store.showToast("Failed: \(error.localizedDescription)")
        }
    }

    private func deleteAsset() async {
        do {
            try await api.deleteAsset(name: asset.name, type: asset.type)
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
