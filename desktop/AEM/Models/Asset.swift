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
        case .instruction: "Instructions"
        case .rule: "Rules"
        }
    }

    var icon: String {
        switch self {
        case .skill: "terminal.fill"
        case .agent: "sparkles"
        case .mcp: "server.rack"
        case .instruction: "doc.text.fill"
        case .rule: "checklist"
        }
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

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    static func == (lhs: Asset, rhs: Asset) -> Bool {
        lhs.id == rhs.id
    }

    private func hasBlockingHealthIssue(codes: Set<String>? = nil) -> Bool {
        guard let health else { return false }
        return health.issues.contains { issue in
            issue.level == "blocking" && (codes == nil || codes!.contains(issue.code))
        }
    }

    var canConnect: Bool {
        !hasBlockingHealthIssue()
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
        type == .mcp && !hasBlockingHealthIssue()
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

struct HistoryEntry: Codable, Identifiable {
    let id: Int
    let action: String
    let asset_name: String
    let details: String
    let created_at: Double
    let reverted: Int
    let snapshot_id: String?
    let can_rollback: Bool?
    let rolled_back_at: Double?
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
    let last_scanned_at: Double?
    let created_at: Double
    let providers: [String]?
    let assetCount: Int?
    let assets: [ProjectAsset]?
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

// MARK: - Server Environment

struct ServerEnvironment: Codable, Identifiable {
    let id: String
    let name: String
    let type: String // "local" | "remote"
    let ssh_host: String?
    let ssh_port: Int?
    let ssh_user: String?
    let ssh_key_path: String?
    let is_active: Int
    let created_at: Double
    let updated_at: Double
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

    enum CodingKeys: String, CodingKey {
        case id, name, url, description
        case protocol_type = "protocol"
        case is_active, created_at
    }
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

struct AnyCodable: Codable, Hashable {
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
