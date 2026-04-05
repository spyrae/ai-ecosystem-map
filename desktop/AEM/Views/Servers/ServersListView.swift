import SwiftUI

struct ServersListView: View {
    @Environment(APIClient.self) private var api
    @Environment(EcosystemStore.self) private var store
    @State private var showAddServer = false
    @State private var selectedServer: ServerEnvironment?
    @State private var diff: DiffResult?

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
                                HStack(alignment: .top, spacing: 16) {
                                    diffColumn("Only Local", assets: diff.onlyLocal, color: .green)
                                    Divider()
                                    diffColumn("Only Remote", assets: diff.onlyRemote, color: .blue)
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
    }

    private func diffColumn(_ title: String, assets: [Asset], color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
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
                    }
                }
            }
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
