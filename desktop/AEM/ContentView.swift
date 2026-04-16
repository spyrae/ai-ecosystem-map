import SwiftUI

enum NavigationTab: String, CaseIterable, Identifiable {
    case map = "Ecosystem Map"
    case history = "History"
    case projects = "Projects"
    case agents = "Agents"
    case servers = "Servers"
    case bundles = "Bundles"
    case policies = "Policies"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .map: "square.grid.3x3.fill"
        case .history: "clock.arrow.circlepath"
        case .projects: "folder.fill"
        case .agents: "sparkles"
        case .servers: "server.rack"
        case .bundles: "shippingbox.fill"
        case .policies: "checklist.checked"
        }
    }

    /// Tabs shown in the sidebar
    static var visibleTabs: [NavigationTab] {
        [.map, .history]
    }
}

struct ContentView: View {
    @Environment(AgentService.self) private var agentService
    @Environment(APIClient.self) private var apiClient
    @Environment(EcosystemStore.self) private var store

    var body: some View {
        NavigationSplitView {
            sidebar
        } detail: {
            detail
        }
        .navigationSplitViewStyle(.balanced)
        .sheet(isPresented: Binding(
            get: { store.showCreate },
            set: { store.showCreate = $0 }
        )) {
            CreateAssetSheet()
        }
        .sheet(isPresented: Binding(
            get: { store.showHistory },
            set: { store.showHistory = $0 }
        )) {
            HistorySheetView()
                .environment(apiClient)
                .environment(store)
        }
        .navigationTitle("")
        .toolbar {
            ToolbarItem(placement: .navigation) {
                HStack(spacing: 8) {
                    Image("SidebarLogo")
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(height: 18)
                    Text("Harness Control Plane")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.primary)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
            }
            ToolbarItemGroup(placement: .automatic) {
                Button {
                    Task {
                        do {
                            let mode = try await apiClient.setGlobalReadOnly(!store.globalReadOnly)
                            store.auditMode = mode
                            store.showToast(mode.global_read_only ? "Global audit mode enabled" : "Global audit mode disabled")
                        } catch {
                            store.showToast("Failed to update audit mode: \(error.localizedDescription)")
                        }
                    }
                } label: {
                    Label(store.globalReadOnly ? "Audit Mode On" : "Enable Audit Mode", systemImage: store.globalReadOnly ? "lock.fill" : "lock.open")
                }
                .disabled(!apiClient.isReady)

                Button {
                    Task { await store.undoLastHistory(api: apiClient) }
                } label: {
                    Label(store.historyBusyKey == "latest" ? "Undoing…" : "Undo Last", systemImage: "arrow.uturn.backward")
                }
                .disabled(store.historyBusyKey != nil || !store.canUndoLastHistory || !apiClient.isReady)
            }
        }
        // Global toast overlay
        .overlay(alignment: .bottom) {
            if let toast = store.toast {
                Text(toast)
                    .font(.caption)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
                    .shadow(radius: 8)
                    .padding(.bottom, 20)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .animation(.spring(duration: 0.3), value: store.toast)
            }
        }
    }

    // MARK: - Sidebar

    private var sidebar: some View {
        List(selection: Binding(
            get: { store.selectedTab },
            set: { store.selectedTab = $0 }
        )) {
            Section {
                ForEach(NavigationTab.visibleTabs) { tab in
                    Label(tab.rawValue, systemImage: tab.icon)
                        .tag(tab)
                }
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("")
        .safeAreaInset(edge: .bottom) {
            agentStatusFooter
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
        }
        .navigationSplitViewColumnWidth(min: 160, ideal: 180, max: 220)
    }

    private var agentStatusFooter: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(agentService.state.color)
                .frame(width: 8, height: 8)
            Text(agentService.state.label)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Spacer()
            if agentService.state == .running {
                Text(":\(agentService.port)")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .monospacedDigit()
            }
            if store.globalReadOnly {
                Text("Audit")
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.orange.opacity(0.14), in: Capsule())
                    .foregroundStyle(.orange)
            }
        }
    }

    // MARK: - Detail

    @ViewBuilder
    private var detail: some View {
        switch store.selectedTab {
        case .map:
            EcosystemMapView()
        case .history:
            HistorySheetView()
                .environment(apiClient)
                .environment(store)
        // Hidden tabs — kept for future use
        case .projects:
            ProjectsListView()
        case .agents:
            RunningAgentsListView()
        case .servers:
            ServersListView()
        case .bundles:
            BundlesListView()
        case .policies:
            PoliciesListView()
        }
    }
}

private struct HistorySheetView: View {
    @Environment(APIClient.self) private var apiClient
    @Environment(EcosystemStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if store.historyLoading {
                    VStack(spacing: 12) {
                        ProgressView()
                        Text("Loading history…")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if store.historyEntries.isEmpty {
                    ContentUnavailableView(
                        "No History Yet",
                        systemImage: "clock.arrow.circlepath",
                        description: Text("Recent write operations with reversible snapshots will appear here.")
                    )
                } else {
                    VStack(spacing: 0) {
                        if store.globalReadOnly {
                            Text("Global read-only audit mode is enabled. Undo and rollback actions are disabled.")
                                .font(.caption)
                                .foregroundStyle(.orange)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 10)
                                .background(Color.orange.opacity(0.08))
                        }
                        List(store.historyEntries) { entry in
                            HistoryEntryRow(entry: entry)
                        }
                        .listStyle(.inset)
                    }
                }
            }
            .navigationTitle("History & Rollback")
        }
        .frame(minWidth: 760, minHeight: 520)
        .task {
            if store.historyEntries.isEmpty {
                await store.loadHistory(api: apiClient)
            }
        }
    }
}

private struct HistoryEntryRow: View {
    @Environment(APIClient.self) private var apiClient
    @Environment(EcosystemStore.self) private var store

    let entry: HistoryEntry

    private var isBusy: Bool {
        store.historyBusyKey == String(entry.id)
    }

    private var createdAtText: String {
        let seconds = entry.created_at > 1_000_000_000_000 ? entry.created_at / 1000 : entry.created_at
        return Date(timeIntervalSince1970: seconds).formatted(date: .abbreviated, time: .shortened)
    }

    private var badgeStyle: (label: String, color: Color)? {
        if entry.rolled_back_at != nil {
            return ("Rolled Back", .green)
        }
        if entry.can_rollback == true {
            return ("Undo Available", .accentColor)
        }
        return nil
    }

    private var actorText: String? {
        guard let actor = entry.details_json?.actor else { return nil }
        let parts = [actor.user, actor.host].compactMap { $0 }
        let base = parts.isEmpty ? actor.kind : parts.joined(separator: " @ ")
        if let client = actor.client, !client.isEmpty {
            return "\(base) via \(client)"
        }
        return base
    }

    private var effectText: String? {
        guard let effect = entry.details_json?.effect else { return nil }
        let parts = [
            effect.applied.map { "\($0) applied" },
            effect.skipped.map { "\($0) skipped" },
            effect.restored.map { "\($0) restored" },
            effect.operationCount.map { "\($0) operations" },
            effect.total.map { "\($0) total" },
        ].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(entry.action)
                            .font(.headline)
                        Text("#\(entry.id)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        if let badgeStyle {
                            Text(badgeStyle.label)
                                .font(.caption2.weight(.semibold))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(badgeStyle.color.opacity(0.12), in: Capsule())
                                .foregroundStyle(badgeStyle.color)
                        }
                    }
                    Text(entry.details_json?.summary ?? entry.asset_name)
                        .font(.subheadline)
                    Text(createdAtText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 12)

                Button {
                    Task { await store.rollbackHistory(api: apiClient, historyId: entry.id) }
                } label: {
                    Text(isBusy ? "Rolling back…" : "Rollback")
                }
                .buttonStyle(.bordered)
                .disabled(store.globalReadOnly || store.historyBusyKey != nil || entry.can_rollback != true)
            }

            if entry.details_json?.target?.label != nil || actorText != nil || effectText != nil {
                FlowLayout(spacing: 8) {
                    if let target = entry.details_json?.target?.label {
                        historyMetaPill("Target: \(target)")
                    }
                    if let actorText {
                        historyMetaPill(actorText)
                    }
                    if let effectText {
                        historyMetaPill(effectText)
                    }
                }
            }

            if let approval = entry.details_json?.approval {
                VStack(alignment: .leading, spacing: 4) {
                    Text(approval.confirmed ? "Approval recorded" : "Approval required")
                        .font(.caption.weight(.semibold))
                    if let reason = approval.reason, !reason.isEmpty {
                        Text(reason)
                            .font(.caption)
                    }
                    if let note = approval.note, !note.isEmpty {
                        Text("Note: \(note)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .foregroundStyle(approval.confirmed ? .green : .orange)
                .padding(10)
                .background((approval.confirmed ? Color.green : Color.orange).opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
            }

            if let metadata = entry.details_json?.metadata, !metadata.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    Text(prettyHistoryMetadata(metadata))
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                        .padding(10)
                        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                }
            } else if entry.details_json == nil, !entry.details.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    Text(entry.details)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                        .padding(10)
                        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                }
            }
        }
        .padding(.vertical, 6)
    }
}

private func historyMetaPill(_ text: String) -> some View {
    Text(text)
        .font(.caption2)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(Color.secondary.opacity(0.08), in: Capsule())
}

private func prettyHistoryMetadata(_ metadata: [String: AnyCodable]) -> String {
    let dictionary = metadata.mapValues(\.value)
    guard JSONSerialization.isValidJSONObject(dictionary),
          let data = try? JSONSerialization.data(withJSONObject: dictionary, options: [.prettyPrinted, .sortedKeys]),
          let text = String(data: data, encoding: .utf8) else {
        return metadata.description
    }
    return text
}

private func prettyPolicyJSON<T: Encodable>(_ value: T) -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let data = (try? encoder.encode(value)) ?? Data("{}".utf8)
    return String(decoding: data, as: UTF8.self)
}

private func decodePolicyJSON<T: Decodable>(_ source: String, as type: T.Type) throws -> T {
    let data = Data(source.utf8)
    return try JSONDecoder().decode(type, from: data)
}

private func formatPolicyTimestamp(_ value: Double?) -> String {
    guard let value else { return "Never" }
    let seconds = value > 1_000_000_000_000 ? value / 1000 : value
    return Date(timeIntervalSince1970: seconds).formatted(date: .abbreviated, time: .shortened)
}

private func impactedSubjects(for policyID: String, evaluation: PolicyEvaluation?) -> [PolicySubjectStatus] {
    guard let evaluation else { return [] }
    return (evaluation.projects + evaluation.environments)
        .filter { $0.matchedPolicyIds.contains(policyID) && $0.violationCount > 0 }
        .sorted {
            if $0.blockingCount != $1.blockingCount { return $0.blockingCount > $1.blockingCount }
            return $0.warningCount > $1.warningCount
        }
}

private struct PolicyEditorPayload {
    let name: String
    let description: String
    let enabled: Bool
    let severity: PolicySeverity
    let selectors: PolicySelectors
    let rules: [PolicyRule]
}

private struct PolicyEditorSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(EcosystemStore.self) private var store

    let policy: Policy?
    let onSave: (PolicyEditorPayload) async -> Void

    @State private var name: String
    @State private var description: String
    @State private var enabled: Bool
    @State private var severity: PolicySeverity
    @State private var selectorsText: String
    @State private var rulesText: String
    @State private var error: String?

    init(policy: Policy?, onSave: @escaping (PolicyEditorPayload) async -> Void) {
        self.policy = policy
        self.onSave = onSave
        _name = State(initialValue: policy?.name ?? "")
        _description = State(initialValue: policy?.description ?? "")
        _enabled = State(initialValue: policy?.enabled ?? true)
        _severity = State(initialValue: policy?.severity ?? .warning)
        _selectorsText = State(initialValue: prettyPolicyJSON(policy?.selectors ?? PolicySelectors(environmentIds: nil, environmentTypes: nil, projectIds: nil, projectTypes: nil, projectPathPatterns: nil, providers: nil)))
        _rulesText = State(initialValue: prettyPolicyJSON(policy?.rules ?? [
            PolicyRule(mode: .required, assetType: .instruction, scope: .project, name: nil, namePattern: "CLAUDE*", provider: nil, note: "Project-level instruction must exist")
        ]))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Identity") {
                    TextField("Policy name", text: $name)
                    TextField("Description", text: $description, axis: .vertical)
                        .lineLimit(3...5)
                    Toggle("Enabled", isOn: $enabled)
                    Picker("Severity", selection: $severity) {
                        Text("Warning").tag(PolicySeverity.warning)
                        Text("Blocking").tag(PolicySeverity.blocking)
                    }
                }

                Section("Selectors JSON") {
                    TextEditor(text: $selectorsText)
                        .font(.system(.caption, design: .monospaced))
                        .frame(minHeight: 140)
                }

                Section("Rules JSON") {
                    TextEditor(text: $rulesText)
                        .font(.system(.caption, design: .monospaced))
                        .frame(minHeight: 220)
                    Text("Rules must include `mode`, `assetType`, `scope`, and either `name` or `namePattern`.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if let error {
                    Section {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(policy == nil ? "Create Policy" : "Edit Policy")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(policy == nil ? "Create" : "Save") {
                        Task { await save() }
                    }
                    .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .frame(minWidth: 760, minHeight: 640)
    }

    @MainActor
    private func save() async {
        do {
            let selectors = try decodePolicyJSON(selectorsText, as: PolicySelectors.self)
            let rules = try decodePolicyJSON(rulesText, as: [PolicyRule].self)
            error = nil
            await onSave(
                PolicyEditorPayload(
                    name: name.trimmingCharacters(in: .whitespacesAndNewlines),
                    description: description.trimmingCharacters(in: .whitespacesAndNewlines),
                    enabled: enabled,
                    severity: severity,
                    selectors: selectors,
                    rules: rules
                )
            )
            dismiss()
        } catch {
            self.error = error.localizedDescription
            store.showToast("Invalid policy JSON")
        }
    }
}

struct PoliciesListView: View {
    @Environment(APIClient.self) private var api
    @Environment(EcosystemStore.self) private var store

    @State private var policies: [Policy] = []
    @State private var evaluation: PolicyEvaluation?
    @State private var selectedPolicyID: String?
    @State private var isLoading = true
    @State private var showEditor = false
    @State private var editingPolicy: Policy?
    @State private var isSaving = false
    @State private var deleteCandidate: Policy?

    private var selectedPolicy: Policy? {
        policies.first(where: { $0.id == selectedPolicyID }) ?? policies.first
    }

    var body: some View {
        NavigationSplitView {
            List(selection: Binding(
                get: { selectedPolicyID },
                set: { selectedPolicyID = $0 }
            )) {
                ForEach(policies) { policy in
                    let impacted = impactedSubjects(for: policy.id, evaluation: evaluation)
                    let blockingCount = impacted.reduce(0) { $0 + $1.blockingCount }
                    let warningCount = impacted.reduce(0) { $0 + $1.warningCount }
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 8) {
                            Text(policy.name)
                                .font(.body.weight(.medium))
                            Text(policy.enabled ? "Enabled" : "Disabled")
                                .font(.caption2.weight(.semibold))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background((policy.enabled ? Color.green : Color.secondary).opacity(0.12), in: Capsule())
                                .foregroundStyle(policy.enabled ? .green : .secondary)
                            Text(policy.severity.rawValue)
                                .font(.caption2.weight(.semibold))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background((policy.severity == .blocking ? Color.red : Color.orange).opacity(0.12), in: Capsule())
                                .foregroundStyle(policy.severity == .blocking ? .red : .orange)
                        }
                        Text(policy.description.isEmpty ? "No description" : policy.description)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                        Text("\(policy.rules.count) rules · \(impacted.count) subjects")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                        if blockingCount > 0 || warningCount > 0 {
                            Text([
                                blockingCount > 0 ? "\(blockingCount) blocking" : nil,
                                warningCount > 0 ? "\(warningCount) warning" : nil,
                            ].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption2)
                            .foregroundStyle(blockingCount > 0 ? .red : .orange)
                        }
                    }
                    .tag(policy.id)
                }
            }
            .navigationTitle("Policies")
            .toolbar {
                ToolbarItemGroup {
                    Button {
                        Task { await loadData() }
                    } label: {
                        Label("Run Checks", systemImage: "arrow.clockwise")
                    }

                    Button {
                        editingPolicy = nil
                        showEditor = true
                    } label: {
                        Label("Create", systemImage: "plus")
                    }
                }
            }
        } detail: {
            if isLoading {
                ProgressView("Loading policies…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let policy = selectedPolicy {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        GroupBox {
                            VStack(alignment: .leading, spacing: 10) {
                                HStack(alignment: .top) {
                                    VStack(alignment: .leading, spacing: 6) {
                                        HStack(spacing: 8) {
                                            Text(policy.name)
                                                .font(.title3.weight(.semibold))
                                            Text(policy.severity.rawValue)
                                                .font(.caption.weight(.semibold))
                                                .padding(.horizontal, 8)
                                                .padding(.vertical, 3)
                                                .background((policy.severity == .blocking ? Color.red : Color.orange).opacity(0.12), in: Capsule())
                                                .foregroundStyle(policy.severity == .blocking ? .red : .orange)
                                        }
                                        Text(policy.description.isEmpty ? "No description yet." : policy.description)
                                            .font(.callout)
                                            .foregroundStyle(.secondary)
                                        Text("Updated \(formatPolicyTimestamp(policy.updated_at))")
                                            .font(.caption)
                                            .foregroundStyle(.tertiary)
                                    }
                                    Spacer()
                                    Button("Edit") {
                                        editingPolicy = policy
                                        showEditor = true
                                    }
                                    Button("Delete", role: .destructive) {
                                        deleteCandidate = policy
                                    }
                                }
                            }
                        }

                        summaryCards

                        GroupBox("Selectors") {
                            ScrollView(.horizontal) {
                                Text(prettyPolicyJSON(policy.selectors))
                                    .font(.system(.caption, design: .monospaced))
                                    .textSelection(.enabled)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }

                        GroupBox("Rules") {
                            VStack(alignment: .leading, spacing: 10) {
                                ForEach(Array(policy.rules.enumerated()), id: \.offset) { _, rule in
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("\(rule.mode.rawValue) \(rule.assetType.rawValue) · \(rule.scope.rawValue)")
                                            .font(.caption.weight(.semibold))
                                        Text([rule.name, rule.namePattern, rule.provider].compactMap { $0 }.joined(separator: " · "))
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                        if let note = rule.note, !note.isEmpty {
                                            Text(note)
                                                .font(.caption2)
                                                .foregroundStyle(.tertiary)
                                        }
                                    }
                                    .padding(10)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                                }
                            }
                        }

                        GroupBox("Current Violations") {
                            let impacted = impactedSubjects(for: policy.id, evaluation: evaluation)
                            if impacted.isEmpty {
                                Text("No current violations for this policy.")
                                    .font(.callout)
                                    .foregroundStyle(.green)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            } else {
                                VStack(alignment: .leading, spacing: 10) {
                                    ForEach(impacted) { subject in
                                        VStack(alignment: .leading, spacing: 8) {
                                            HStack {
                                                VStack(alignment: .leading, spacing: 3) {
                                                    Text(subject.name)
                                                        .font(.callout.weight(.medium))
                                                    Text(subject.kind == .project ? (subject.path ?? "Project") : (subject.environmentName ?? subject.environmentType ?? "Environment"))
                                                        .font(.caption)
                                                        .foregroundStyle(.secondary)
                                                }
                                                Spacer()
                                                if subject.blockingCount > 0 {
                                                    Text("\(subject.blockingCount) blocking")
                                                        .font(.caption2.weight(.semibold))
                                                        .padding(.horizontal, 6)
                                                        .padding(.vertical, 2)
                                                        .background(Color.red.opacity(0.12), in: Capsule())
                                                        .foregroundStyle(.red)
                                                }
                                                if subject.warningCount > 0 {
                                                    Text("\(subject.warningCount) warning")
                                                        .font(.caption2.weight(.semibold))
                                                        .padding(.horizontal, 6)
                                                        .padding(.vertical, 2)
                                                        .background(Color.orange.opacity(0.12), in: Capsule())
                                                        .foregroundStyle(.orange)
                                                }
                                            }
                                            ForEach(subject.violations.filter { $0.policyId == policy.id }) { violation in
                                                Text(violation.message)
                                                    .font(.caption)
                                                    .foregroundStyle(.secondary)
                                                    .padding(8)
                                                    .frame(maxWidth: .infinity, alignment: .leading)
                                                    .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                                            }
                                        }
                                        .padding(10)
                                        .background(Color.secondary.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
                                    }
                                }
                            }
                        }
                    }
                    .padding()
                }
            } else {
                ContentUnavailableView("No Policies", systemImage: "checklist", description: Text("Create the first policy to enforce harness baselines."))
            }
        }
        .sheet(isPresented: $showEditor) {
            PolicyEditorSheet(policy: editingPolicy) { payload in
                await savePolicy(payload)
            }
            .environment(store)
        }
        .confirmationDialog(
            "Delete policy?",
            isPresented: Binding(
                get: { deleteCandidate != nil },
                set: { if !$0 { deleteCandidate = nil } }
            ),
            titleVisibility: .visible
        ) {
            if let deleteCandidate {
                Button("Delete \(deleteCandidate.name)", role: .destructive) {
                    Task { await removePolicy(deleteCandidate) }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes the policy definition, but does not change any assets.")
        }
        .task(id: api.isReady) {
            guard api.isReady else { return }
            await loadData()
        }
    }

    private var summaryCards: some View {
        HStack(spacing: 12) {
            summaryCard("Policies", value: String(evaluation?.summary.policyCount ?? policies.count))
            summaryCard("Violating Projects", value: String(evaluation?.summary.violatingProjectCount ?? 0))
            summaryCard("Violating Environments", value: String(evaluation?.summary.violatingEnvironmentCount ?? 0))
            summaryCard("Blocking / Warning", value: "\(evaluation?.summary.blockingCount ?? 0) / \(evaluation?.summary.warningCount ?? 0)")
        }
    }

    private func summaryCard(_ title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.title3.weight(.semibold))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
    }

    @MainActor
    private func loadData() async {
        isLoading = true
        defer { isLoading = false }
        do {
            async let policiesTask = api.fetchPolicies()
            async let evaluationTask = api.fetchPolicyEvaluation()
            let loadedPolicies = try await policiesTask
            let loadedEvaluation = try await evaluationTask
            policies = loadedPolicies
            evaluation = loadedEvaluation
            if selectedPolicyID == nil || !loadedPolicies.contains(where: { $0.id == selectedPolicyID }) {
                selectedPolicyID = loadedPolicies.first?.id
            }
        } catch {
            store.showToast("Failed to load policies: \(error.localizedDescription)")
        }
    }

    @MainActor
    private func savePolicy(_ payload: PolicyEditorPayload) async {
        isSaving = true
        defer { isSaving = false }
        do {
            if let editingPolicy {
                _ = try await api.updatePolicy(
                    id: editingPolicy.id,
                    name: payload.name,
                    description: payload.description,
                    enabled: payload.enabled,
                    severity: payload.severity,
                    selectors: payload.selectors,
                    rules: payload.rules
                )
                store.showToast("Policy updated")
            } else {
                _ = try await api.createPolicy(
                    name: payload.name,
                    description: payload.description,
                    enabled: payload.enabled,
                    severity: payload.severity,
                    selectors: payload.selectors,
                    rules: payload.rules
                )
                store.showToast("Policy created")
            }
            showEditor = false
            editingPolicy = nil
            await loadData()
        } catch {
            store.showToast("Failed to save policy: \(error.localizedDescription)")
        }
    }

    @MainActor
    private func removePolicy(_ policy: Policy) async {
        do {
            try await api.deletePolicy(id: policy.id)
            store.showToast("Policy deleted")
            deleteCandidate = nil
            await loadData()
        } catch {
            store.showToast("Failed to delete policy: \(error.localizedDescription)")
        }
    }
}
