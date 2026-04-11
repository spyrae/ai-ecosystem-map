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

    private var availableProviders: [Provider] {
        switch type {
        case .skill: [.claude, .codex, .gemini]
        case .agent: [.claude, .codex]
        case .mcp: [.claude, .codex, .gemini, .windsurf, .continue_dev]
        case .rule: [.cursor, .windsurf, .claude]
        case .instruction: [.claude, .codex, .gemini, .copilot, .cursor, .windsurf]
        }
    }

    private var supportsGlobalScope: Bool {
        switch type {
        case .rule: false
        case .instruction: [.claude, .codex, .gemini].contains(provider)
        case .mcp: provider != .continue_dev
        default: true
        }
    }

    private var supportsProjectScope: Bool {
        switch type {
        case .rule: true
        case .instruction: true
        case .skill: provider != .continue_dev
        case .agent: provider == .claude
        case .mcp: provider == .claude
        }
    }

    private var derivedInstructionName: String {
        switch provider {
        case .claude: "claude"
        case .codex: "agents"
        case .gemini: "gemini"
        case .copilot: "copilot-instructions"
        case .cursor: "cursorrules"
        case .windsurf: "windsurfrules"
        case .continue_dev: "instructions"
        }
    }

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
                        .disabled(type == .instruction)

                    Picker("Type", selection: $type) {
                        ForEach(AssetType.allCases) { t in
                            Label(t.label, systemImage: t.icon).tag(t)
                        }
                    }

                    if type == .rule || type == .instruction || type == .skill || type == .agent || type == .mcp {
                        Picker("Provider", selection: $provider) {
                            ForEach(availableProviders) { p in
                                Text(p.label).tag(p)
                            }
                        }
                    }

                    if supportsGlobalScope || supportsProjectScope {
                        Picker("Scope", selection: $scope) {
                            if supportsGlobalScope {
                                Text("Global").tag("global")
                            }
                            if supportsProjectScope {
                                Text("Project").tag("project")
                            }
                        }
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
        .onAppear {
            syncDerivedFields()
        }
        .onChange(of: type) { _, _ in
            if !availableProviders.contains(provider) {
                provider = availableProviders.first ?? .claude
            }
            syncDerivedFields()
        }
        .onChange(of: provider) { _, _ in
            syncDerivedFields()
        }
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
                name: type == .instruction ? derivedInstructionName : name,
                type: type,
                content: content.isEmpty ? nil : content,
                provider: provider.rawValue,
                scope: scope
            )
            store.showToast("Created \(type == .instruction ? derivedInstructionName : name)")
            await store.loadAll(api: api)
            dismiss()
        } catch {
            store.showToast("Create failed: \(error.localizedDescription)")
        }
    }

    private func syncDerivedFields() {
        if type == .instruction {
            name = derivedInstructionName
        }
        if type == .mcp && content.isEmpty {
            content = """
            {
              "command": "npx",
              "args": ["-y", "your-mcp-server"],
              "env": {}
            }
            """
        }
        if type == .rule {
            scope = "project"
        } else if !supportsGlobalScope && supportsProjectScope {
            scope = "project"
        } else if !supportsProjectScope {
            scope = "global"
        }
    }
}
