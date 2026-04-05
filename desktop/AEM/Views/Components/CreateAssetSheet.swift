import SwiftUI

struct CreateAssetSheet: View {
    @Environment(APIClient.self) private var api
    @Environment(EcosystemStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var type: AssetType = .skill
    @State private var provider: Provider = .claude
    @State private var scope: String = "global"
    @State private var content = ""
    @State private var aiDescription = ""
    @State private var isGenerating = false
    @State private var isCreating = false

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Create New Asset")
                    .font(.headline)
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
            .padding()

            Divider()

            Form {
                Section {
                    TextField("Name", text: $name)
                        .textFieldStyle(.roundedBorder)

                    Picker("Type", selection: $type) {
                        ForEach(AssetType.allCases) { t in
                            Label(t.label, systemImage: t.icon).tag(t)
                        }
                    }

                    if type == .rule || type == .instruction {
                        Picker("Provider", selection: $provider) {
                            ForEach(Provider.allCases) { p in
                                Text(p.label).tag(p)
                            }
                        }
                    }

                    Picker("Scope", selection: $scope) {
                        Text("Global").tag("global")
                        Text("Project").tag("project")
                    }
                }

                Section("Content") {
                    TextEditor(text: $content)
                        .font(.system(.body, design: .monospaced))
                        .frame(minHeight: 150)

                    HStack {
                        TextField("Describe what this asset should do...", text: $aiDescription)
                            .textFieldStyle(.roundedBorder)
                        Button {
                            Task { await generate() }
                        } label: {
                            Label(
                                isGenerating ? "Generating..." : "AI Generate",
                                systemImage: "sparkles"
                            )
                        }
                        .disabled(aiDescription.isEmpty || isGenerating)
                    }
                }
            }
            .formStyle(.grouped)

            Divider()

            // Footer
            HStack {
                Spacer()
                Button("Create") {
                    Task { await create() }
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .disabled(name.isEmpty || isCreating)
            }
            .padding()
        }
        .frame(width: 520, height: 560)
    }

    private func generate() async {
        isGenerating = true
        defer { isGenerating = false }
        do {
            let generated = try await api.generateAsset(type: type, name: name.isEmpty ? "untitled" : name, description: aiDescription)
            content = generated
        } catch {
            store.showToast("Generation failed: \(error.localizedDescription)")
        }
    }

    private func create() async {
        isCreating = true
        defer { isCreating = false }
        do {
            _ = try await api.createAsset(
                name: name,
                type: type,
                content: content.isEmpty ? nil : content,
                provider: (type == .rule || type == .instruction) ? provider.rawValue : nil,
                scope: scope
            )
            store.showToast("Created \(name)")
            await store.loadAll(api: api)
            dismiss()
        } catch {
            store.showToast("Create failed: \(error.localizedDescription)")
        }
    }
}
