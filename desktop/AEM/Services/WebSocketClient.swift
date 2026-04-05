import Foundation

enum AgentEvent {
    case assetsUpdated
    case scanProgress(String)
    case watcherChanged(String)
    case sshConnected(String)
    case sshError(String)
    case unknown(String)
}

@Observable
final class WebSocketClient: @unchecked Sendable {
    var isConnected = false

    var onMessage: ((AgentEvent) -> Void)?

    private var task: URLSessionWebSocketTask?
    private var url: URL?
    private var reconnectDelay: TimeInterval = 1
    private let maxReconnectDelay: TimeInterval = 30
    private var shouldReconnect = true

    func connect(url: URL) {
        self.url = url
        shouldReconnect = true
        doConnect()
    }

    func disconnect() {
        shouldReconnect = false
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        isConnected = false
    }

    // MARK: - Private

    private func doConnect() {
        guard let url else { return }
        let session = URLSession(configuration: .default)
        task = session.webSocketTask(with: url)
        task?.resume()

        Task { @MainActor in
            isConnected = true
            reconnectDelay = 1
        }

        listen()
        schedulePing()
    }

    private func listen() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let message):
                self.handleMessage(message)
                self.listen() // Continue listening
            case .failure:
                Task { @MainActor in
                    self.isConnected = false
                    self.scheduleReconnect()
                }
            }
        }
    }

    private func handleMessage(_ message: URLSessionWebSocketTask.Message) {
        guard case .string(let text) = message,
              let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else {
            return
        }

        let event: AgentEvent
        switch type {
        case "assets:updated":
            event = .assetsUpdated
        case "scan:progress":
            event = .scanProgress(json["message"] as? String ?? "")
        case "watcher:changed":
            event = .watcherChanged(json["path"] as? String ?? "")
        case "ssh:connected":
            event = .sshConnected(json["server"] as? String ?? "")
        case "ssh:error":
            event = .sshError(json["error"] as? String ?? "")
        default:
            event = .unknown(type)
        }

        Task { @MainActor in
            self.onMessage?(event)
        }
    }

    private func schedulePing() {
        Task {
            try? await Task.sleep(for: .seconds(30))
            task?.sendPing { [weak self] error in
                if error == nil {
                    self?.schedulePing()
                }
            }
        }
    }

    private func scheduleReconnect() {
        guard shouldReconnect else { return }
        Task {
            try? await Task.sleep(for: .seconds(reconnectDelay))
            reconnectDelay = min(reconnectDelay * 2, maxReconnectDelay)
            doConnect()
        }
    }
}
