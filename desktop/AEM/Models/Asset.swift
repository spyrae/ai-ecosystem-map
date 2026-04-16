import Foundation
import SwiftUI

// MARK: - Asset Types

enum AssetType: String, Codable, CaseIterable, Identifiable {
    case skill
    case agent
    case mcp
    case instruction
    case rule

    var id: String { rawValue }

    var label: String {
        switch self {
        case .skill: "Skills"
        case .agent: "Agents"
        case .mcp: "MCP Servers"
        case .instruction: "Rules"
        case .rule: "Rules"
        }
    }

    var icon: String {
        switch self {
        case .skill: "terminal.fill"
        case .agent: "sparkles"
        case .mcp: "server.rack"
        case .instruction: "checklist"
        case .rule: "checklist"
        }
    }

    /// Types shown in the Create Asset picker (instruction merged into rule)
    static var creatableTypes: [AssetType] {
        [.skill, .agent, .mcp, .rule]
    }

    /// Badge label shown on cards (instruction displays as "rule")
    var badgeLabel: String {
        self == .instruction ? "rule" : rawValue
    }
}

// MARK: - Provider

enum Provider: String, Codable, CaseIterable, Identifiable {
    case claude
    case codex
    case gemini
    case cursor
    case windsurf
    case copilot
    case continue_dev

    var id: String { rawValue }

    var label: String {
        switch self {
        case .claude: "Claude Code"
        case .codex: "Codex CLI"
        case .gemini: "Gemini CLI"
        case .cursor: "Cursor"
        case .windsurf: "Windsurf"
        case .copilot: "GitHub Copilot"
        case .continue_dev: "Continue"
        }
    }

    var icon: String {
        switch self {
        case .claude: "c.circle.fill"
        case .codex: "chevron.left.forwardslash.chevron.right"
        case .gemini: "diamond.fill"
        case .cursor: "cursorarrow.rays"
        case .windsurf: "wind"
        case .copilot: "airplane"
        case .continue_dev: "arrow.right.circle.fill"
        }
    }
}

enum AssetHealthFilter: String, CaseIterable, Identifiable {
    case broken
    case warning

    var id: String { rawValue }

    var label: String {
        switch self {
        case .broken: "Broken"
        case .warning: "Warnings"
        }
    }

    var icon: String {
        switch self {
        case .broken: "exclamationmark.octagon.fill"
        case .warning: "exclamationmark.triangle.fill"
        }
    }
}

enum AssetDependencyFilter: String, CaseIterable, Identifiable {
    case orphaned

    var id: String { rawValue }

    var label: String {
        switch self {
        case .orphaned: "Unused"
        }
    }

    var icon: String {
        switch self {
        case .orphaned: "point.3.connected.trianglepath.dotted"
        }
    }
}

enum AssetDriftStatus: String, Codable, CaseIterable, Identifiable {
    case source
    case synced
    case drifted
    case orphaned

    var id: String { rawValue }

    var label: String {
        switch self {
        case .source: "Source"
        case .synced: "Synced"
        case .drifted: "Drifted"
        case .orphaned: "Orphaned"
        }
    }

    var tint: Color {
        switch self {
        case .source: .blue
        case .synced: .green
        case .drifted: .orange
        case .orphaned: .red
        }
    }
}

enum AssetDriftSeverity: String, Codable, Hashable {
    case none
    case low
    case medium
    case high
}

// MARK: - Asset

struct Asset: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let type: AssetType
    let desc: String
    let cat: String
    let filePath: String?
    let tags: [String]
    let providers: [String]
    let keywords: String
    let deps: [String]
    let isOrchestrator: Bool
    let hash: String?
    let environment_id: String?
    let discovered_at: Double?
    let updated_at: Double?
    let health: AssetHealth?
    let capabilities: AssetCapabilities?
    let runtime: McpRuntimeCheck?
    var dependency: AssetDependencyInfo?
    var drift: AssetDriftInfo?

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    static func == (lhs: Asset, rhs: Asset) -> Bool {
        lhs.id == rhs.id
    }

    private func hasBlockingHealthIssue(codes: Set<String>? = nil, excludePrefixes: [String] = []) -> Bool {
        guard let health else { return false }
        return health.issues.contains { issue in
            issue.level == "blocking"
                && (codes == nil || codes!.contains(issue.code))
                && !excludePrefixes.contains(where: { issue.code.hasPrefix($0) })
        }
    }

    var canConnect: Bool {
        !hasBlockingHealthIssue(excludePrefixes: ["runtime_"])
    }

    var canEdit: Bool {
        if type == .mcp {
            return !hasBlockingHealthIssue(codes: ["missing_config", "missing_path", "missing_file", "broken_symlink"])
        }
        return filePath != nil && !(filePath?.isEmpty ?? true) && !hasBlockingHealthIssue(codes: ["missing_path", "missing_file", "broken_symlink"])
    }

    var canDelete: Bool {
        if type == .mcp {
            return !hasBlockingHealthIssue(codes: ["missing_config"])
        }
        return filePath != nil && !(filePath?.isEmpty ?? true) && !hasBlockingHealthIssue(codes: ["missing_path", "missing_file"])
    }

    var canInspectMcpTools: Bool {
        type == .mcp && !hasBlockingHealthIssue(codes: ["missing_config", "missing_transport", "invalid_command", "invalid_url", "invalid_args", "missing_path", "missing_file", "broken_symlink"])
    }
}

// MARK: - Stats

struct Stats: Codable {
    let total: Int
    let skill: Int?
    let agent: Int?
    let mcp: Int?
    let instruction: Int?
    let rule: Int?
    let orchestrator: Int?
}

// MARK: - Connection

struct ConnectionInfo: Codable {
    let connected: Bool
    let method: String?
    let installed: Bool?
    let supported: Bool?
    let isSource: Bool?
    let isSymlink: Bool?
    let targetPath: String?
}

// MARK: - History

struct HistoryActor: Codable, Hashable {
    let kind: String
    let user: String?
    let host: String?
    let client: String?
}

struct HistoryApproval: Codable, Hashable {
    let required: Bool
    let confirmed: Bool
    let note: String?
    let reason: String?
    let source: String?
}

struct HistoryTarget: Codable, Hashable {
    let kind: String
    let id: String?
    let label: String?
}

struct HistoryEffect: Codable, Hashable {
    let applied: Int?
    let skipped: Int?
    let total: Int?
    let restored: Int?
    let operationCount: Int?
    let resultCount: Int?
}

struct HistoryDetails: Codable, Hashable {
    let assetId: String?
    let assetType: AssetType?
    let snapshotId: String?
    let summary: String?
    let actor: HistoryActor?
    let approval: HistoryApproval?
    let target: HistoryTarget?
    let effect: HistoryEffect?
    let metadata: [String: AnyCodable]?
}

struct HistoryEntry: Codable, Identifiable {
    let id: Int
    let action: String
    let asset_name: String
    let details: String
    let created_at: Double
    let reverted: Int
    let details_json: HistoryDetails?
    let snapshot_id: String?
    let can_rollback: Bool?
    let rolled_back_at: Double?
}

struct ApprovalPayload: Codable, Hashable, Sendable {
    let confirmed: Bool
    let note: String?
    let source: String?

    static func client(_ source: String, note: String? = nil) -> ApprovalPayload {
        ApprovalPayload(confirmed: true, note: note, source: source)
    }
}

// MARK: - Provider Stat

struct ProviderStat: Codable, Identifiable {
    let name: String
    let count: Int
    let types: [String: Int]

    var id: String { name }
}

// MARK: - Project

struct Project: Codable, Identifiable {
    let id: String
    let name: String
    let path: String
    let environment_id: String
    let environment_name: String?
    let environment_type: String?
    let project_type: String?
    let last_scanned_at: Double?
    let created_at: Double
    let providers: [String]?
    let assetCount: Int?
    let assets: [ProjectAsset]?
    let git: GitContext?
    let policy: PolicySubjectStatus?
}

struct ProjectAsset: Codable, Identifiable {
    let id: String
    let name: String
    let desc: String
    let type: AssetType
    let scope: String // "global" | "project"
    let projectPath: String
    let projectName: String
    let environment_id: String?
    let environment_type: String?
    let filePath: String?
    let providers: [String]
    let health: AssetHealth?
    let capabilities: AssetCapabilities?
    var drift: AssetDriftInfo?
    let git: GitContext?
}

enum GitFileStatus: String, Codable, Hashable {
    case clean
    case modified
    case staged
    case untracked
    case conflicted
}

struct GitContext: Codable, Hashable {
    let repoRoot: String
    let branch: String
    let dirty: Bool
    let conflictedCount: Int
    let modifiedCount: Int
    let stagedCount: Int
    let untrackedCount: Int
    let relevantStatus: GitFileStatus?
    let summary: String
}

struct AssetDriftInfo: Codable, Hashable {
    let groupKey: String
    let status: AssetDriftStatus
    let severity: AssetDriftSeverity
    let sourceAssetId: String?
    let sourceMode: String?
    let isSourceOfTruth: Bool
    let summary: String
    let copyCount: Int
}

struct DriftReason: Codable, Hashable, Identifiable {
    let code: String
    let message: String

    var id: String { "\(code):\(message)" }
}

struct DriftMember: Codable, Hashable, Identifiable {
    let assetId: String
    let name: String
    let type: AssetType
    let filePath: String?
    let projectId: String?
    let projectName: String?
    let projectPath: String?
    let environmentId: String?
    let environmentName: String?
    let environmentType: String?
    let providers: [String]
    let health: AssetHealth?
    let capabilities: AssetCapabilities?
    let scope: String
    let locationLabel: String
    let sourceOfTruth: Bool
    let status: AssetDriftStatus
    let differsFromSource: Bool
    let reasons: [DriftReason]
    let summary: String

    var id: String { assetId }
}

struct DriftGroup: Codable, Hashable, Identifiable {
    let key: String
    let name: String
    let type: AssetType
    let status: AssetDriftStatus
    let severity: AssetDriftSeverity
    let summary: String
    let copyCount: Int
    let sourceAssetId: String?
    let sourceMode: String?
    let members: [DriftMember]

    var id: String { key }
}

struct DriftSummary: Codable, Hashable {
    let totalGroups: Int
    let totalCopies: Int
    let driftedGroups: Int
    let orphanedGroups: Int
    let syncedGroups: Int
    let sourceGroups: Int
}

struct DriftGraph: Codable, Hashable {
    let groups: [DriftGroup]
    let byAssetId: [String: AssetDriftInfo]
    let summary: DriftSummary
}

struct HealthIssue: Codable, Hashable, Identifiable {
    let level: String
    let code: String
    let message: String

    var id: String { "\(level):\(code):\(message)" }
}

struct AssetHealth: Codable, Hashable {
    let status: String
    let issueCount: Int
    let hasBlocking: Bool
    let summary: String
    let issues: [HealthIssue]
}

struct McpRuntimeCheck: Codable {
    let transport: String
    let status: String
    let reachable: Bool
    let phase: String
    let reasonCode: String
    let summary: String
    let details: [String]
    let checkedAt: String?
    let durationMs: Int?
    let toolCount: Int?
    let tools: [McpTool]
    let cached: Bool
    let stale: Bool

    var statusLabel: String {
        status.replacingOccurrences(of: "_", with: " ").capitalized
    }

    var statusTint: Color {
        switch status {
        case "ok":
            return .green
        case "warning":
            return .orange
        case "broken":
            return .red
        default:
            return .secondary
        }
    }
}

enum CapabilityState: String, Codable, Hashable {
    case active
    case configured
    case available
    case missing
    case unsupported
    case invalid

    var label: String {
        switch self {
        case .active: "Active"
        case .configured: "Configured"
        case .available: "Available"
        case .missing: "Missing"
        case .unsupported: "Unsupported"
        case .invalid: "Invalid"
        }
    }

    var tint: Color {
        switch self {
        case .active: .blue
        case .configured: .green
        case .available: .secondary
        case .missing: .orange
        case .unsupported: .secondary
        case .invalid: .red
        }
    }
}

struct AssetCapabilitySummary: Codable, Hashable {
    let total: Int
    let active: Int
    let configured: Int
    let available: Int
    let missing: Int
    let unsupported: Int
    let invalid: Int

    var compactItems: [String] {
        [
            active > 0 ? "\(active) active" : nil,
            configured > 0 ? "\(configured) configured" : nil,
            available > 0 ? "\(available) available" : nil,
            invalid > 0 ? "\(invalid) invalid" : nil,
            missing > 0 ? "\(missing) missing" : nil,
            unsupported > 0 ? "\(unsupported) unsupported" : nil
        ].compactMap { $0 }
    }
}

struct AssetCapabilityEntry: Codable, Hashable, Identifiable {
    let provider: String
    let label: String
    let state: CapabilityState
    let installed: Bool
    let supported: Bool
    let connected: Bool
    let isSource: Bool
    let isSymlink: Bool
    let targetPath: String?
    let detail: String

    var id: String { provider }
}

struct AssetCapabilities: Codable, Hashable {
    let summary: AssetCapabilitySummary
    let providers: [AssetCapabilityEntry]
}

struct AssetDependencyRef: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let type: AssetType?
}

struct AssetDependencyConsumer: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let state: String
}

struct AssetDependencyInfo: Codable, Hashable {
    let assetId: String
    let name: String
    let type: AssetType?
    let dependencyCount: Int
    let consumerCount: Int
    let assetConsumerCount: Int
    let runtimeConsumerCount: Int
    let providerConsumerCount: Int
    let orphaned: Bool
    let summary: String
    let dependsOn: [AssetDependencyRef]
    let dependedOnBy: [AssetDependencyRef]
    let runtimeConsumers: [AssetDependencyConsumer]
    let providerConsumers: [AssetDependencyConsumer]
}

struct DependencyGraphSummary: Codable, Hashable {
    let assetCount: Int
    let orphanedCount: Int
    let usedCount: Int
    let dependencyEdgeCount: Int
    let assetConsumerCount: Int
    let runtimeConsumerCount: Int
    let providerConsumerCount: Int
}

struct DependencyGraph: Codable, Hashable {
    let byAssetId: [String: AssetDependencyInfo]
    let orphanedAssetIds: [String]
    let summary: DependencyGraphSummary
}

// MARK: - Server Environment

struct ServerEnvironment: Codable, Identifiable {
    let id: String
    let name: String
    let type: String // "local" | "remote"
    let ssh_host: String?
    let ssh_port: Int?
    let ssh_user: String?
    let ssh_key_path: String?
    let read_only: Int?
    let is_active: Int
    let created_at: Double
    let updated_at: Double
    let policy: PolicySubjectStatus?
}

enum PolicySeverity: String, Codable, Hashable {
    case warning
    case blocking
}

enum PolicyMode: String, Codable, Hashable {
    case required
    case forbidden
    case recommended
}

enum PolicyScope: String, Codable, Hashable {
    case project
    case environment
    case any
}

enum PolicySubjectKind: String, Codable, Hashable {
    case project
    case environment
}

enum PolicyStatusState: String, Codable, Hashable {
    case ok
    case warning
    case broken

    var tint: Color {
        switch self {
        case .ok: .green
        case .warning: .orange
        case .broken: .red
        }
    }
}

struct PolicySelectors: Codable, Hashable {
    let environmentIds: [String]?
    let environmentTypes: [String]?
    let projectIds: [String]?
    let projectTypes: [String]?
    let projectPathPatterns: [String]?
    let providers: [String]?
}

struct PolicyRule: Codable, Hashable, Identifiable {
    let mode: PolicyMode
    let assetType: AssetType
    let scope: PolicyScope
    let name: String?
    let namePattern: String?
    let provider: String?
    let note: String?

    var id: String { "\(mode.rawValue):\(assetType.rawValue):\(scope.rawValue):\(name ?? namePattern ?? provider ?? "rule")" }
}

struct Policy: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let description: String
    let enabled: Bool
    let severity: PolicySeverity
    let selectors: PolicySelectors
    let rules: [PolicyRule]
    let created_at: Double
    let updated_at: Double
}

struct PolicyViolationAsset: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let type: AssetType
    let filePath: String?
}

struct PolicyViolation: Codable, Hashable, Identifiable {
    let id: String
    let policyId: String
    let policyName: String
    let severity: PolicySeverity
    let mode: PolicyMode
    let assetType: AssetType
    let scope: PolicyScope
    let name: String?
    let namePattern: String?
    let provider: String?
    let message: String
    let note: String?
    let matchedAssets: [PolicyViolationAsset]?
}

struct PolicySubjectStatus: Codable, Hashable, Identifiable {
    let kind: PolicySubjectKind
    let subjectId: String
    let projectId: String?
    let environmentId: String?
    let name: String
    let path: String?
    let projectType: String?
    let environmentName: String?
    let environmentType: String?
    let providers: [String]
    let status: PolicyStatusState
    let violationCount: Int
    let blockingCount: Int
    let warningCount: Int
    let summary: String
    let matchedPolicyIds: [String]
    let violations: [PolicyViolation]

    var id: String { subjectId }

    var compactItems: [String] {
        [
            blockingCount > 0 ? "\(blockingCount) blocking" : nil,
            warningCount > 0 ? "\(warningCount) warning" : nil,
        ].compactMap { $0 }
    }
}

struct PolicyEvaluationSummary: Codable, Hashable {
    let policyCount: Int
    let projectCount: Int
    let environmentCount: Int
    let violatingProjectCount: Int
    let violatingEnvironmentCount: Int
    let blockingCount: Int
    let warningCount: Int
    let violationCount: Int
}

struct PolicyEvaluation: Codable, Hashable {
    let projects: [PolicySubjectStatus]
    let environments: [PolicySubjectStatus]
    let byProjectId: [String: PolicySubjectStatus]
    let byEnvironmentId: [String: PolicySubjectStatus]
    let summary: PolicyEvaluationSummary
}

struct RemediationSuggestion: Codable, Identifiable {
    let id: String
    let category: String
    let action: String
    let title: String
    let summary: String
    let details: [String]
    let applyLabel: String?
    let canApply: Bool
    let risky: Bool
    let issueCodes: [String]
    let syncRequest: SyncRequestPayload?
    let sourceAssetId: String?
}

struct AuditEnvironmentPolicy: Codable, Hashable, Identifiable {
    let environment_id: String
    let name: String
    let type: String
    let read_only: Bool
    let ssh_host: String?

    var id: String { environment_id }
}

struct AuditMode: Codable, Hashable {
    let global_read_only: Bool
    let environments: [AuditEnvironmentPolicy]
}

struct AuditReportEnvironment: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let type: String
    let read_only: Bool
    let ssh_host: String?
    let ssh_user: String?
    let project_count: Int
    let asset_count: Int
}

struct AuditReportSummary: Codable, Hashable {
    let asset_count: Int
    let project_count: Int
    let local_project_count: Int
    let remote_project_count: Int
    let environment_count: Int
    let remote_server_count: Int
    let running_agent_count: Int
    let broken_asset_count: Int
    let warning_asset_count: Int
    let drift_group_count: Int
    let drifted_group_count: Int
    let orphaned_group_count: Int
}

struct AuditReportIssue: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let type: AssetType
    let status: String
    let summary: String
}

struct AuditReport: Codable {
    let generated_at: String
    let audit_mode: AuditMode
    let summary: AuditReportSummary
    let blocked_actions: [String]
    let providers: [ProviderStat]
    let environments: [AuditReportEnvironment]
    let top_issues: [AuditReportIssue]
}

// MARK: - Diff

struct DiffResult: Codable {
    let onlyLocal: [Asset]
    let onlyRemote: [Asset]
    let both: [DiffPair]
    let localCount: Int
    let remoteCount: Int
    let sameCount: Int?
    let driftedCount: Int?
    let reasonCounts: [String: Int]?
}

struct DiffPair: Codable {
    let local: Asset
    let remote: Asset
    let status: String
    let reasons: [DiffReason]
    let summary: String
}

struct DiffReason: Codable, Hashable, Identifiable {
    let code: String
    let message: String

    var id: String { "\(code):\(message)" }
}

// MARK: - Bundles

enum BundleTargetKind: String, Codable, CaseIterable, Identifiable {
    case provider
    case project
    case server
    case running_agent

    var id: String { rawValue }

    var label: String {
        switch self {
        case .provider: "Provider"
        case .project: "Project"
        case .server: "Remote Server"
        case .running_agent: "Running Agent"
        }
    }
}

struct BundleItem: Codable, Hashable, Identifiable {
    let assetId: String?
    let name: String
    let type: AssetType
    let filePath: String?
    let providers: [String]?
    let projectPath: String?
    let scope: String?

    var id: String {
        assetId ?? "\(type.rawValue):\(name):\(projectPath ?? filePath ?? "")"
    }
}

struct BundleVersion: Codable, Hashable, Identifiable {
    let id: String
    let version: Int
    let label: String
    let description: String
    let items: [BundleItem]
    let itemCount: Int
    let created_at: Double
}

struct BundleApplication: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let target_kind: BundleTargetKind
    let target_ref: String
    let target_label: String
    let target_meta: [String: AnyCodable]?
    let bundle_version: Int
    let applied_at: Double
    let last_status: String
    let last_summary: String
    let outdated: Bool
}

struct Bundle: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let description: String
    let current_version: Int
    let items: [BundleItem]
    let itemCount: Int
    let versions: [BundleVersion]
    let applications: [BundleApplication]
    let applicationCount: Int
    let outdatedApplicationCount: Int
    let lastAppliedAt: Double?
    let created_at: Double
    let updated_at: Double
}

struct BundleTargetSummary: Codable, Hashable {
    let kind: BundleTargetKind
    let provider: Provider?
    let projectPath: String?
    let method: String?
    let serverId: String?
    let agentId: String?
    let label: String?
    let ref: String?
    let meta: [String: AnyCodable]?
}

struct BundlePreviewData: Codable {
    let bundleId: String
    let bundleVersion: Int
    let target: BundleTargetSummary?
    let resolvedTarget: SyncTargetSummary?
    let preview: BatchSyncPreview
}

struct BundleApplyData: Codable {
    let ok: Bool
    let bundleId: String
    let bundleVersion: Int
    let target: BundleTargetSummary?
    let resolvedTarget: SyncTargetSummary?
    let preview: BatchSyncPreview
    let result: BatchSyncApplyResult?
    let error: String?
}

// MARK: - Workspace Manifest

struct WorkspaceManifestSummary: Codable, Sendable {
    let assetCount: Int
    let bundleCount: Int
    let policyCount: Int
    let projectCount: Int
}

struct WorkspaceManifestTopologyProject: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let path: String
    let projectType: String?
}

struct WorkspaceManifestTopologyProvider: Codable, Identifiable, Sendable {
    let provider: String
    let count: Int

    var id: String { provider }
}

struct WorkspaceManifestAssetRecord: Codable, Identifiable, Sendable {
    let key: String
    let name: String
    let type: AssetType
    let scope: String
    let provider: String?
    let fileName: String?
    let filePath: String?
    let projectPath: String?
    let projectName: String?
    let projectType: String?
    let description: String?
    let category: String?
    let providers: [String]?
    let tags: [String]?
    let keywords: String?
    let deps: [String]?
    let content: String?
    let rawConfig: [String: AnyCodable]?

    var id: String { key }
}

struct WorkspaceManifestBundleRecord: Codable, Identifiable, Sendable {
    let id: String?
    let name: String
    let description: String?
    let currentVersion: Int?
    let items: [BundleItem]
    let versions: [BundleVersion]?
    let applications: [BundleApplication]?
}

struct WorkspaceManifestPolicyRecord: Codable, Identifiable, Sendable {
    let id: String?
    let name: String
    let description: String?
    let enabled: Bool
    let severity: PolicySeverity
    let selectors: PolicySelectors
    let rules: [PolicyRule]
}

struct WorkspaceManifestSource: Codable, Sendable {
    let app: String?
    let version: Int?
}

struct WorkspaceManifestTopology: Codable, Sendable {
    let projects: [WorkspaceManifestTopologyProject]?
    let providers: [WorkspaceManifestTopologyProvider]?
}

struct WorkspaceManifest: Codable, Sendable {
    let kind: String
    let schemaVersion: Int
    let exportedAt: Double
    let source: WorkspaceManifestSource?
    let summary: WorkspaceManifestSummary?
    let topology: WorkspaceManifestTopology?
    let assets: [WorkspaceManifestAssetRecord]
    let bundles: [WorkspaceManifestBundleRecord]
    let policies: [WorkspaceManifestPolicyRecord]
}

struct WorkspaceManifestImportIssue: Codable, Identifiable, Hashable, Sendable {
    let level: String
    let code: String
    let message: String

    var id: String { "\(level):\(code):\(message)" }
}

struct WorkspaceManifestAssetPreviewEntry: Codable, Identifiable, Sendable {
    let key: String
    let name: String
    let type: AssetType
    let scope: String
    let provider: String?
    let action: String
    let targetPath: String?
    let projectPath: String?
    let summary: String
    let issues: [WorkspaceManifestImportIssue]
    let canApply: Bool

    var id: String { key }
}

struct WorkspaceManifestNamedPreviewEntry: Codable, Identifiable, Sendable {
    let name: String
    let action: String
    let existingId: String?
    let summary: String
    let canApply: Bool

    var id: String { "\(name):\(action)" }
}

struct WorkspaceManifestImportAssetCounts: Codable, Sendable {
    let create: Int
    let update: Int
    let noop: Int
    let blocked: Int
}

struct WorkspaceManifestImportNamedCounts: Codable, Sendable {
    let create: Int
    let update: Int
    let noop: Int
}

struct WorkspaceManifestImportCounts: Codable, Sendable {
    let assets: WorkspaceManifestImportAssetCounts
    let bundles: WorkspaceManifestImportNamedCounts
    let policies: WorkspaceManifestImportNamedCounts
}

struct WorkspaceManifestPreviewHeader: Codable, Sendable {
    let kind: String
    let schemaVersion: Int
    let exportedAt: Double
    let summary: WorkspaceManifestSummary?
}

struct WorkspaceManifestImportPreviewData: Codable, Sendable {
    let manifest: WorkspaceManifestPreviewHeader
    let assets: [WorkspaceManifestAssetPreviewEntry]
    let bundles: [WorkspaceManifestNamedPreviewEntry]
    let policies: [WorkspaceManifestNamedPreviewEntry]
    let issues: [WorkspaceManifestImportIssue]
    let counts: WorkspaceManifestImportCounts
    let writeCount: Int
    let canApply: Bool
}

struct WorkspaceManifestImportResult: Codable, Sendable {
    let assetWrites: Int
    let bundleWrites: Int
    let policyWrites: Int
    let writeCount: Int
}

struct WorkspaceManifestImportApplyData: Codable, Sendable {
    let preview: WorkspaceManifestImportPreviewData
    let result: WorkspaceManifestImportResult
}

// MARK: - Sync

struct SyncSourceSummary: Codable {
    let assetId: String?
    let name: String?
    let type: String?
    let filePath: String?
}

struct SyncTargetSummary: Codable {
    let kind: String
    let label: String?
    let projectPath: String?
    let method: String?
    let serverId: String?
    let direction: String?
    let provider: Provider?
    let git: GitContext?
}

struct SyncOperation: Codable, Identifiable {
    let id: String
    let action: String
    let mode: String
    let summary: String
    let sourcePath: String?
    let targetPath: String?
    let targetPathRemote: String?
    let assetName: String?
}

struct SyncIssue: Codable, Identifiable {
    let level: String
    let code: String
    let message: String

    var id: String { "\(level):\(code):\(message)" }
}

struct SyncPlan: Codable {
    let source: SyncSourceSummary?
    let target: SyncTargetSummary?
    let operations: [SyncOperation]
    let issues: [SyncIssue]
    let canApply: Bool
    let hasChanges: Bool
}

struct BatchActionItem: Codable, Hashable, Identifiable {
    let assetId: String?
    let name: String
    let type: String
    let filePath: String?
    let providers: [String]?
    let projectPath: String?
    let scope: String?

    var id: String { assetId ?? "\(type):\(name)" }
}

struct BatchActionResultItem: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let type: String
    let ok: Bool
    let filePath: String?
    let message: String?
    let error: String?
    let health: AssetHealth?
    let status: String?
}

struct BatchActionResult: Codable {
    let ok: Bool
    let total: Int
    let successCount: Int?
    let failureCount: Int?
    let okCount: Int?
    let warningCount: Int?
    let brokenCount: Int?
    let results: [BatchActionResultItem]
}

struct BatchSyncPreviewItem: Codable, Identifiable {
    let id: String
    let name: String
    let ok: Bool
    let plan: SyncPlan?
    let error: String?
}

struct BatchSyncPreview: Codable {
    let ok: Bool
    let total: Int
    let readyCount: Int
    let blockedCount: Int
    let hasChangesCount: Int
    let operationCount: Int
    let results: [BatchSyncPreviewItem]
}

struct BatchSyncApplyItem: Codable, Identifiable {
    let id: String
    let name: String
    let ok: Bool
    let plan: SyncPlan?
    let error: String?
    let applied: Int?
    let skipped: Int?
    let message: String?
}

struct BatchSyncApplyResult: Codable {
    let ok: Bool
    let total: Int
    let appliedCount: Int
    let skippedCount: Int
    let successCount: Int
    let failureCount: Int
    let results: [BatchSyncApplyItem]
}

// MARK: - MCP

struct McpTool: Codable, Identifiable {
    let name: String
    let description: String
    let parameters: AnyCodable?

    var id: String { name }
}

struct McpConfig: Codable {
    let config: [String: AnyCodable]
    let source: String
}

// MARK: - Running Agent

struct RunningAgent: Codable, Identifiable {
    let id: String
    let name: String
    let url: String
    let description: String
    let protocol_type: String?
    let is_active: Int
    let created_at: Double
    let introspection: RunningAgentIntrospection?

    enum CodingKeys: String, CodingKey {
        case id, name, url, description
        case protocol_type = "protocol"
        case is_active, created_at, introspection
    }
}

struct RunningAgentIntrospection: Codable, Hashable {
    let agentId: String
    let status: String
    let reachable: Bool
    let summary: String
    let details: [String]
    let checkedAt: String?
    let durationMs: Int?
    let toolCount: Int?
    let configuredCount: Int
    let loadedCount: Int
    let activeCount: Int
    let activeToolCount: Int
    let unmatchedToolCount: Int
    let cached: Bool
    let stale: Bool
    let assets: [RunningAgentAssetState]
    let activeTools: [RunningAgentActiveTool]

    var statusLabel: String {
        status.uppercased()
    }

    var statusTint: Color {
        switch status {
        case "ok": return .green
        case "warning": return .yellow
        case "broken": return .red
        default: return .secondary
        }
    }
}

struct RunningAgentAssetState: Codable, Hashable, Identifiable {
    let assetId: String
    let name: String
    let type: AssetType
    let state: String
    let matchedTools: [String]
    let environmentId: String?
    let projectId: String?
    let projectName: String?
    let projectPath: String?
    let filePath: String?
    let detail: String

    var id: String { assetId }
}

struct RunningAgentActiveTool: Codable, Hashable, Identifiable {
    let name: String
    let description: String
    let matchedAssetIds: [String]
    let state: String

    var id: String { name }
}

// MARK: - Topology

struct TopologyNodeSummary: Codable, Hashable {
    let relatedCount: Int?
    let assetCount: Int?
    let projectCount: Int?
    let providerCount: Int?
    let environmentCount: Int?
    let agentCount: Int?
    let activeCount: Int?
    let configuredCount: Int?
    let missingCount: Int?
    let invalidCount: Int?
    let warningCount: Int?
    let brokenCount: Int?
    let dependencyCount: Int?
    let assetConsumerCount: Int?
    let runtimeConsumerCount: Int?
    let providerConsumerCount: Int?
    let consumerCount: Int?
    let orphaned: Bool?
}

struct TopologyNode: Codable, Hashable, Identifiable {
    let id: String
    let kind: String
    let label: String
    let subtitle: String?
    let environmentId: String?
    let projectId: String?
    let assetId: String?
    let provider: String?
    let assetType: AssetType?
    let status: String?
    let badges: [String]?
    let summary: TopologyNodeSummary?
}

struct TopologyEdge: Codable, Hashable, Identifiable {
    let id: String
    let kind: String
    let from: String
    let to: String
    let label: String?
    let state: CapabilityState?
}

struct TopologySummary: Codable, Hashable {
    let nodeCount: Int
    let edgeCount: Int
    let machineCount: Int
    let remoteServerCount: Int
    let providerCount: Int
    let projectCount: Int
    let runningAgentCount: Int
    let assetCount: Int
}

struct TopologyGraph: Codable, Hashable {
    let nodes: [TopologyNode]
    let edges: [TopologyEdge]
    let summary: TopologySummary
}

// MARK: - AnyCodable helper

struct AnyCodable: Codable, Hashable, @unchecked Sendable {
    let value: Any

    init(_ value: Any) { self.value = value }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            value = NSNull()
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.map(\.value)
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            value = dict.mapValues(\.value)
        } else {
            value = NSNull()
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case is NSNull:
            try container.encodeNil()
        case let bool as Bool:
            try container.encode(bool)
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let string as String:
            try container.encode(string)
        case let array as [Any]:
            try container.encode(array.map { AnyCodable($0) })
        case let dict as [String: Any]:
            try container.encode(dict.mapValues { AnyCodable($0) })
        default:
            try container.encodeNil()
        }
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(String(describing: value))
    }

    static func == (lhs: AnyCodable, rhs: AnyCodable) -> Bool {
        String(describing: lhs.value) == String(describing: rhs.value)
    }
}
