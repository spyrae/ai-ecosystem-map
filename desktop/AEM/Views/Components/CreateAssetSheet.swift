import SwiftUI
import UniformTypeIdentifiers

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
        case .rule, .instruction: [.claude, .cursor, .windsurf, .codex, .gemini, .copilot]
        }
    }

    /// Whether this rule provider creates an instruction-type file (CLAUDE.md, AGENTS.md, etc.)
    private var isInstructionDestination: Bool {
        guard type == .rule else { return false }
        return [.codex, .gemini, .copilot].contains(provider)
    }

    /// The actual backend type to send
    private var effectiveType: AssetType {
        isInstructionDestination ? .instruction : type
    }

    private var supportsGlobalScope: Bool {
        switch effectiveType {
        case .rule: false
        case .instruction: [.claude, .codex, .gemini].contains(provider)
        case .mcp: provider != .continue_dev
        default: true
        }
    }

    private var supportsProjectScope: Bool {
        switch effectiveType {
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
                if store.globalReadOnly {
                    Text("Global read-only audit mode is enabled. Creating new assets is disabled until audit mode is turned off.")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }

                Section {
                    TextField("Name", text: $name)
                        .textFieldStyle(.roundedBorder)
                        .disabled(isInstructionDestination)

                    Picker("Type", selection: $type) {
                        ForEach(AssetType.creatableTypes) { t in
                            Label(t.label, systemImage: t.icon).tag(t)
                        }
                    }

                    if type == .rule || type == .skill || type == .agent || type == .mcp {
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

                    /* Hidden until LLM is configured
                    HStack {
                        TextField(aiPlaceholder, text: $aiDescription)
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
                    */

                    Button {
                        importFile()
                    } label: {
                        Label("Import from File", systemImage: "doc.badge.arrow.up")
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
                .disabled(store.globalReadOnly || name.isEmpty || isCreating)
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
        guard !store.globalReadOnly else {
            store.showToast("Global read-only audit mode is enabled")
            return
        }
        isCreating = true
        defer { isCreating = false }
        do {
            let finalName = isInstructionDestination ? derivedInstructionName : name
            _ = try await api.createAsset(
                name: finalName,
                type: effectiveType,
                content: content.isEmpty ? nil : content,
                provider: provider.rawValue,
                scope: scope
            )
            store.showToast("Created \(finalName)")
            await store.loadAll(api: api)
            dismiss()
        } catch {
            store.showToast("Create failed: \(error.localizedDescription)")
        }
    }

    private var aiPlaceholder: String {
        switch type {
        case .skill: "e.g. A skill for deploying Docker containers. Should check Dockerfile, build image, push to registry."
        case .agent: "e.g. An agent for database migrations. Can read schema, generate SQL, validate changes."
        case .rule, .instruction: "e.g. Rules for a React project. Use functional components, Zustand for state."
        case .mcp: "e.g. MCP server config for connecting to a custom REST API."
        }
    }

    private func importFile() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.plainText, .json, .yaml]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false

        guard panel.runModal() == .OK, let url = panel.url else { return }

        guard let fileContent = try? String(contentsOf: url, encoding: .utf8) else {
            store.showToast("Could not read file")
            return
        }

        let ext = url.pathExtension.lowercased()
        let baseName = url.deletingPathExtension().lastPathComponent
            .lowercased().replacingOccurrences(of: " ", with: "-")

        // Auto-detect type from content
        let fmPattern = try? NSRegularExpression(pattern: "^---\\s*\\n[\\s\\S]*?\\n---", options: [])
        let hasFrontmatter = fmPattern?.firstMatch(in: fileContent, range: NSRange(fileContent.startIndex..., in: fileContent)) != nil
        let hasModel = fileContent.contains("model:")
        let hasUseWhen = fileContent.lowercased().contains("use when")

        if ext == "json" {
            if let data = fileContent.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               json["command"] != nil || json["url"] != nil || json["args"] != nil {
                type = .mcp
            } else {
                type = .rule
            }
        } else if hasFrontmatter {
            if hasModel {
                type = .agent
            } else if hasUseWhen {
                type = .skill
            } else {
                type = .skill
            }
        } else {
            type = .rule
        }

        name = baseName
        content = fileContent

        if !availableProviders.contains(provider) {
            provider = availableProviders.first ?? .claude
        }
    }

    private func syncDerivedFields() {
        if isInstructionDestination {
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
