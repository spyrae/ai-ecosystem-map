import Foundation

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

// MARK: - Asset

struct Asset: Codable, Identifiable, Hashable {
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

    // API may not return id — use name as fallback
    var id: String { name }

    func hash(into hasher: inout Hasher) {
        hasher.combine(name)
    }

    static func == (lhs: Asset, rhs: Asset) -> Bool {
        lhs.name == rhs.name
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
    let supported: Bool?
    let isSource: Bool?
    let isSymlink: Bool?
}

// MARK: - History

struct HistoryEntry: Codable, Identifiable {
    let id: Int
    let action: String
    let asset_name: String
    let details: String
    let created_at: Double
    let reverted: Int
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
    let last_scanned_at: Double?
    let created_at: Double
    let providers: [String]?
    let assetCount: Int?
    let assets: [ProjectAsset]?
}

struct ProjectAsset: Codable, Identifiable {
    let name: String
    let desc: String
    let type: AssetType
    let scope: String // "global" | "project"
    let projectPath: String
    let projectName: String
    let filePath: String?
    let providers: [String]

    var id: String { "\(projectPath)/\(name)" }
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
}

struct DiffPair: Codable {
    let local: Asset
    let remote: Asset
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
