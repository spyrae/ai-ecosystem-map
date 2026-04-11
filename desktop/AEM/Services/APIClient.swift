import Foundation

@Observable
final class APIClient: @unchecked Sendable {
    var baseURL: URL = URL(string: "http://localhost:3000")!
    var isReady = false

    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 15
        return URLSession(configuration: config)
    }()

    // MARK: - Generic HTTP (string-based URL to avoid double-encoding)

    private func makeURL(_ path: String, params: [String: String] = [:]) -> URL {
        var urlString = baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        urlString += "/" + path
        if !params.isEmpty {
            let query = params.map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? $0.value)" }.joined(separator: "&")
            urlString += "?" + query
        }
        return URL(string: urlString)!
    }

    private func get<T: Decodable>(_ path: String, params: [String: String] = [:]) async throws -> T {
        let url = makeURL(path, params: params)
        let (data, response) = try await session.data(from: url)
        try validateResponse(response, url: url)
        return try decode(data, url: url)
    }

    private func post<T: Decodable>(_ path: String, body: some Encodable) async throws -> T {
        let url = makeURL(path)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await session.data(for: request)
        try validateResponse(response, url: url)
        return try decode(data, url: url)
    }

    private func put<T: Decodable>(_ path: String, body: some Encodable) async throws -> T {
        let url = makeURL(path)
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await session.data(for: request)
        try validateResponse(response, url: url)
        return try decode(data, url: url)
    }

    private func delete<T: Decodable>(_ path: String, params: [String: String] = [:]) async throws -> T {
        let url = makeURL(path, params: params)
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        let (data, response) = try await session.data(for: request)
        try validateResponse(response, url: url)
        return try decode(data, url: url)
    }

    private func validateResponse(_ response: URLResponse, url: URL) throws {
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        guard (200...299).contains(http.statusCode) else {
            print("[api] HTTP \(http.statusCode) ← \(url.path)")
            throw APIError.httpError(http.statusCode)
        }
    }

    private func decode<T: Decodable>(_ data: Data, url: URL) throws -> T {
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            let preview = String(data: data.prefix(300), encoding: .utf8) ?? "binary"
            print("[api] Decode error for \(T.self) ← \(url.path): \(error)")
            print("[api] Response: \(preview)")
            throw error
        }
    }

    // MARK: - Assets

    func fetchAssets(
        type: AssetType? = nil,
        provider: Provider? = nil,
        category: String? = nil,
        q: String? = nil
    ) async throws -> [Asset] {
        var params: [String: String] = [:]
        if let type { params["type"] = type.rawValue }
        if let provider { params["provider"] = provider.rawValue }
        if let category { params["category"] = category }
        if let q, !q.isEmpty { params["q"] = q }
        let response: APIResponse<[Asset]> = try await get("api/assets", params: params)
        return response.data ?? []
    }

    func fetchAssetContent(assetId: String, type: AssetType? = nil) async throws -> (content: String, filePath: String) {
        var params: [String: String] = [:]
        if let type { params["type"] = type.rawValue }
        let response: AssetContentResponse = try await get("api/assets/\(assetId.urlEncoded)/content", params: params)
        return (response.content, response.filePath)
    }

    func updateAssetContent(assetId: String, content: String, type: AssetType? = nil) async throws {
        let _: APIResult = try await put("api/assets/\(assetId.urlEncoded)/content", body: UpdateAssetContentBody(content: content, type: type?.rawValue))
    }

    func createAsset(
        name: String,
        type: AssetType,
        content: String? = nil,
        provider: String? = nil,
        scope: String? = nil,
        config: [String: String]? = nil
    ) async throws -> String {
        let body = CreateAssetBody(name: name, type: type.rawValue, content: content, provider: provider, scope: scope, config: config)
        let response: CreateAssetResponse = try await post("api/assets/create", body: body)
        return response.filePath ?? ""
    }

    func generateAsset(type: AssetType, name: String, description: String) async throws -> String {
        let body = GenerateBody(type: type.rawValue, name: name, description: description)
        let response: GenerateResponse = try await post("api/generate", body: body)
        return response.content ?? ""
    }

    func deleteAsset(assetId: String, type: AssetType) async throws {
        let _: APIResult = try await delete("api/assets/\(assetId.urlEncoded)", params: ["type": type.rawValue])
    }

    // MARK: - Connections

    func fetchConnections(assetId: String, type: AssetType) async throws -> [String: ConnectionInfo] {
        try await get("api/assets/\(assetId.urlEncoded)/connections", params: ["type": type.rawValue])
    }

    func connect(assetId: String, tool: String, type: AssetType) async throws {
        let _: APIResult = try await post("api/connect", body: ConnectBody(assetId: assetId, tool: tool, type: type.rawValue))
    }

    func disconnect(assetId: String, tool: String, type: AssetType) async throws {
        let _: APIResult = try await post("api/disconnect", body: ConnectBody(assetId: assetId, tool: tool, type: type.rawValue))
    }

    // MARK: - Stats & Meta

    func fetchStats() async throws -> Stats {
        let response: APIResponse<Stats> = try await get("api/stats")
        return response.data!
    }

    func fetchTopology() async throws -> TopologyGraph {
        let response: APIResponse<TopologyGraph> = try await get("api/topology")
        return response.data!
    }

    func fetchCategories() async throws -> [String: Int] {
        let response: APIResponse<[String: Int]> = try await get("api/categories")
        return response.data ?? [:]
    }

    func fetchProviders() async throws -> [ProviderStat] {
        let response: APIResponse<[ProviderStat]> = try await get("api/providers")
        return response.data ?? []
    }

    func fetchHistory(limit: Int = 50) async throws -> [HistoryEntry] {
        let response: APIResponse<[HistoryEntry]> = try await get("api/history", params: ["limit": String(limit)])
        return response.data ?? []
    }

    func rollbackHistoryEntry(_ historyId: Int) async throws {
        let _: APIResult = try await post("api/history/\(historyId)/rollback", body: EmptyBody())
    }

    func undoLastAction() async throws {
        let _: APIResult = try await post("api/undo", body: EmptyBody())
    }

    func rescan() async throws -> Int {
        let response: RescanResponse = try await post("api/rescan", body: EmptyBody())
        return response.count
    }

    // MARK: - Projects

    func fetchProjects() async throws -> [Project] {
        let response: APIResponse<[Project]> = try await get("api/projects")
        return response.data ?? []
    }

    func discoverProjects(dirs: [String]) async throws -> [Project] {
        let response: APIResponse<[Project]> = try await post("api/projects/discover", body: ["dirs": dirs])
        return response.data ?? []
    }

    func addProject(path: String) async throws -> Project {
        let response: APIResponse<Project> = try await post("api/projects/add", body: ["path": path])
        return response.data!
    }

    func fetchProjectAssets(path: String) async throws -> [ProjectAsset] {
        let response: APIResponse<[ProjectAsset]> = try await get("api/projects/\(path.urlEncoded)/assets")
        return response.data ?? []
    }

    func fetchProjectAssets(projectId: String) async throws -> [ProjectAsset] {
        let response: APIResponse<[ProjectAsset]> = try await get("api/projects/\(projectId.urlEncoded)/assets-by-id")
        return response.data ?? []
    }

    func discoverRemoteProjects(serverId: String, dirs: [String] = []) async throws -> [Project] {
        let response: APIResponse<[Project]> = try await post("api/servers/\(serverId)/projects/discover", body: ["dirs": dirs])
        return response.data ?? []
    }

    // MARK: - Servers

    func fetchServers() async throws -> [ServerEnvironment] {
        let response: APIResponse<[ServerEnvironment]> = try await get("api/servers")
        return response.data ?? []
    }

    func addServer(name: String, host: String, user: String, port: Int = 22, keyPath: String? = nil) async throws -> String {
        let body = AddServerBody(name: name, ssh_host: host, ssh_user: user, ssh_port: port, ssh_key_path: keyPath)
        let response: AddServerResponse = try await post("api/servers/add", body: body)
        return response.id
    }

    func testServer(id: String) async throws -> String {
        let response: TestServerResponse = try await post("api/servers/\(id)/test", body: EmptyBody())
        return response.hostname ?? "OK"
    }

    func scanServer(id: String) async throws -> Int {
        let response: ScanServerResponse = try await post("api/servers/\(id)/scan", body: EmptyBody())
        return response.count
    }

    func diffServer(id: String) async throws -> DiffResult {
        let response: APIResponse<DiffResult> = try await get("api/servers/\(id)/diff")
        return response.data!
    }

    func previewSync(_ request: SyncRequestPayload) async throws -> SyncPlan {
        let response: SyncPreviewResponse = try await post("api/sync/preview", body: request)
        return response.plan
    }

    func applySync(_ request: SyncRequestPayload) async throws -> SyncApplyResponse {
        try await post("api/sync/apply", body: request)
    }

    func validateBatch(_ items: [BatchActionItem]) async throws -> BatchActionResult {
        try await post("api/batch/validate", body: BatchItemsBody(items: items))
    }

    func connectBatch(_ items: [BatchActionItem], tool: String) async throws -> BatchActionResult {
        try await post("api/batch/connect", body: BatchToolBody(items: items, tool: tool))
    }

    func disconnectBatch(_ items: [BatchActionItem], tool: String) async throws -> BatchActionResult {
        try await post("api/batch/disconnect", body: BatchToolBody(items: items, tool: tool))
    }

    func deleteBatch(_ items: [BatchActionItem]) async throws -> BatchActionResult {
        try await post("api/batch/delete", body: BatchItemsBody(items: items))
    }

    func previewBatchSync(_ requests: [SyncRequestPayload]) async throws -> BatchSyncPreview {
        try await post("api/batch/sync/preview", body: BatchSyncBody(requests: requests))
    }

    func applyBatchSync(_ requests: [SyncRequestPayload]) async throws -> BatchSyncApplyResult {
        try await post("api/batch/sync/apply", body: BatchSyncBody(requests: requests))
    }

    func pushToServer(id: String, asset: Asset) async throws {
        _ = try await applySync(SyncRequestPayload(
            source: SyncSourceInput(
                assetId: asset.id,
                name: asset.name,
                type: asset.type.rawValue,
                filePath: asset.filePath,
                providers: asset.providers,
                projectPath: nil
            ),
            target: SyncTargetInput(kind: "server", projectPath: nil, method: nil, serverId: id, direction: "push")
        ))
    }

    func pullFromServer(id: String, asset: Asset) async throws {
        _ = try await applySync(SyncRequestPayload(
            source: SyncSourceInput(
                assetId: asset.id,
                name: asset.name,
                type: asset.type.rawValue,
                filePath: asset.filePath,
                providers: asset.providers,
                projectPath: nil
            ),
            target: SyncTargetInput(kind: "server", projectPath: nil, method: nil, serverId: id, direction: "pull")
        ))
    }

    // MARK: - MCP

    func fetchMcpConfig(assetId: String) async throws -> McpConfig {
        try await get("api/mcp/\(assetId.urlEncoded)/config")
    }

    func listMcpTools(assetId: String) async throws -> [McpTool] {
        let response: McpToolsResponse = try await post("api/mcp/\(assetId.urlEncoded)/tools", body: EmptyBody())
        return response.tools ?? []
    }

    // MARK: - Running Agents

    func fetchRunningAgents() async throws -> [RunningAgent] {
        let response: APIResponse<[RunningAgent]> = try await get("api/running-agents")
        return response.data ?? []
    }

    func addRunningAgent(name: String, url: String, description: String = "", protocol: String = "mcp") async throws -> String {
        let body = AddRunningAgentBody(name: name, url: url, description: description, protocol: `protocol`)
        let response: AddServerResponse = try await post("api/running-agents/add", body: body)
        return response.id
    }

    func removeRunningAgent(id: String) async throws {
        let _: APIResult = try await delete("api/running-agents/\(id)")
    }

    func listAgentTools(id: String) async throws -> [McpTool] {
        let response: McpToolsResponse = try await post("api/running-agents/\(id)/tools", body: EmptyBody())
        return response.tools ?? []
    }

    func moveAsset(asset: ProjectAsset, targetProjectPath: String, method: String) async throws {
        _ = try await applySync(SyncRequestPayload(
            source: SyncSourceInput(
                assetId: asset.id,
                name: asset.name,
                type: asset.type.rawValue,
                filePath: asset.filePath,
                providers: asset.providers,
                projectPath: asset.projectPath
            ),
            target: SyncTargetInput(kind: "project", projectPath: targetProjectPath, method: method, serverId: nil, direction: nil)
        ))
    }
}

// MARK: - Response Types

private struct APIResponse<T: Decodable>: Decodable {
    let ok: Bool
    let data: T?
    let error: String?
}

private struct APIResult: Decodable {
    let ok: Bool
    let error: String?
}

struct SyncApplyResponse: Decodable {
    let ok: Bool
    let plan: SyncPlan?
    let applied: Int?
    let skipped: Int?
    let error: String?
}

private struct AssetContentResponse: Decodable {
    let ok: Bool
    let content: String
    let filePath: String
}

private struct CreateAssetResponse: Decodable {
    let ok: Bool
    let filePath: String?
    let error: String?
}

private struct GenerateResponse: Decodable {
    let ok: Bool
    let content: String?
    let error: String?
}

private struct RescanResponse: Decodable {
    let ok: Bool
    let count: Int
}

private struct AddServerResponse: Decodable {
    let ok: Bool
    let id: String
}

private struct TestServerResponse: Decodable {
    let ok: Bool
    let hostname: String?
}

private struct ScanServerResponse: Decodable {
    let ok: Bool
    let count: Int
}

private struct McpToolsResponse: Decodable {
    let ok: Bool
    let tools: [McpTool]?
    let count: Int?
}

// MARK: - Request Bodies

private struct EmptyBody: Encodable {}

private struct ConnectBody: Encodable {
    let assetId: String
    let tool: String
    let type: String
}

private struct UpdateAssetContentBody: Encodable {
    let content: String
    let type: String?
}

private struct CreateAssetBody: Encodable {
    let name: String
    let type: String
    let content: String?
    let provider: String?
    let scope: String?
    let config: [String: String]?
}

private struct GenerateBody: Encodable {
    let type: String
    let name: String
    let description: String
}

private struct AddServerBody: Encodable {
    let name: String
    let ssh_host: String
    let ssh_user: String
    let ssh_port: Int
    let ssh_key_path: String?
}

private struct AddRunningAgentBody: Encodable {
    let name: String
    let url: String
    let description: String
    let `protocol`: String
}

private struct BatchItemsBody: Encodable {
    let items: [BatchActionItem]
}

private struct BatchToolBody: Encodable {
    let items: [BatchActionItem]
    let tool: String
}

private struct BatchSyncBody: Encodable {
    let requests: [SyncRequestPayload]
}

struct SyncSourceInput: Codable {
    let assetId: String?
    let name: String
    let type: String
    let filePath: String?
    let providers: [String]?
    let projectPath: String?
}

struct SyncTargetInput: Codable {
    let kind: String
    let projectPath: String?
    let method: String?
    let serverId: String?
    let direction: String?
}

struct SyncRequestPayload: Codable {
    let source: SyncSourceInput
    let target: SyncTargetInput
}

private struct SyncPreviewResponse: Decodable {
    let ok: Bool
    let plan: SyncPlan
}

private struct PushPullBody: Encodable {
    let assetId: String?
    let name: String?
    let type: String
    let remotePath: String?
}

private struct MoveAssetBody: Encodable {
    let assetId: String?
    let sourcePath: String?
    let name: String
    let type: String
    let targetProjectPath: String
    let method: String
    let provider: String?
}

// MARK: - Errors

enum APIError: LocalizedError {
    case invalidResponse
    case httpError(Int)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: "Invalid response from agent"
        case .httpError(let code): "HTTP \(code)"
        }
    }
}

// MARK: - String Extension

extension String {
    var urlEncoded: String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: ":/")
        return addingPercentEncoding(withAllowedCharacters: allowed) ?? self
    }
}
