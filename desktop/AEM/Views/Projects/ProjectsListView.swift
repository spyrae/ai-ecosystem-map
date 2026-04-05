import SwiftUI

struct ProjectsListView: View {
    @Environment(APIClient.self) private var api
    @Environment(EcosystemStore.self) private var store
    @State private var showAddProject = false
    @State private var isDiscovering = false
    @State private var selectedProject: Project?
    @State private var projectAssets: [ProjectAsset] = []

    private let columns = [
        GridItem(.adaptive(minimum: 260, maximum: 360), spacing: 12)
    ]

    var body: some View {
        NavigationSplitView {
            // Project list
            List(store.projects, selection: Binding(
                get: { selectedProject?.id },
                set: { id in
                    selectedProject = store.projects.first { $0.id == id }
                    if let p = selectedProject {
                        Task { await loadProjectAssets(p) }
                    }
                }
            )) { project in
                HStack {
                    Image(systemName: "folder.fill")
                        .foregroundStyle(.blue)
                    VStack(alignment: .leading) {
                        Text(project.name)
                            .font(.body.weight(.medium))
                        Text(project.path)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
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
                            Text(project.name).font(.title2.weight(.semibold))
                            Text(project.path).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                    .padding()
                    .background(.bar)

                    // Assets
                    if projectAssets.isEmpty {
                        ContentUnavailableView("No assets in this project", systemImage: "doc")
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else {
                        List(projectAssets) { asset in
                            HStack {
                                Image(systemName: asset.type.icon)
                                    .foregroundStyle(.secondary)
                                VStack(alignment: .leading) {
                                    Text(asset.name).font(.body.monospaced())
                                    Text(asset.desc).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                                Spacer()
                                Text(asset.scope)
                                    .font(.caption2)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(asset.scope == "global" ? Color.blue.opacity(0.1) : Color.green.opacity(0.1), in: Capsule())
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
        projectAssets = (try? await api.fetchProjectAssets(path: project.path)) ?? []
    }
}
