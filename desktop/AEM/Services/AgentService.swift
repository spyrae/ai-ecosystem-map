import Foundation
import SwiftUI

enum AgentState: Equatable {
    case stopped
    case starting
    case running
    case error(String)

    var label: String {
        switch self {
        case .stopped: "Stopped"
        case .starting: "Starting..."
        case .running: "Running"
        case .error(let msg): "Error: \(msg)"
        }
    }

    var color: Color {
        switch self {
        case .stopped: .gray
        case .starting: .yellow
        case .running: .green
        case .error: .red
        }
    }

    static func == (lhs: AgentState, rhs: AgentState) -> Bool {
        switch (lhs, rhs) {
        case (.stopped, .stopped), (.starting, .starting), (.running, .running): true
        case (.error(let a), .error(let b)): a == b
        default: false
        }
    }
}

@Observable
final class AgentService: @unchecked Sendable {
    var state: AgentState = .stopped
    var port: Int

    private var process: Process?
    private var restartCount = 0
    private let maxRestarts = 3

    var baseURL: URL {
        URL(string: "http://localhost:\(port)")!
    }

    var wsURL: URL {
        URL(string: "ws://localhost:\(port)/ws")!
    }

    var menuBarIcon: String {
        switch state {
        case .running: "square.grid.3x3.fill"
        case .starting: "square.grid.3x3"
        case .error: "exclamationmark.triangle.fill"
        case .stopped: "square.grid.3x3"
        }
    }

    init() {
        port = UserDefaults.standard.integer(forKey: "agentPort")
        if port == 0 { port = 3000 }
    }

    // MARK: - Lifecycle

    func start() {
        guard state != .starting else { return }
        state = .starting

        // First try to connect to an already-running agent
        Task {
            if await healthCheck() {
                print("[agent] Already running on port \(port)")
                return
            }
            await MainActor.run { launchAgent() }
        }
    }

    private func launchAgent() {
        guard let nodePath = findNode() else {
            state = .error("Node.js not found. Install: brew install node")
            return
        }

        guard let cliPath = findCLI() else {
            state = .error("Agent CLI not found")
            return
        }

        // Project root is parent of bin/
        let projectRoot = ((cliPath as NSString).deletingLastPathComponent as NSString).deletingLastPathComponent

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: nodePath)
        proc.arguments = [cliPath, "--port", String(port), "--no-open", "--headless"]
        proc.currentDirectoryURL = URL(fileURLWithPath: projectRoot)

        // Inherit environment + ensure PATH includes homebrew
        var env = ProcessInfo.processInfo.environment
        let extraPaths = "/opt/homebrew/bin:/usr/local/bin"
        env["PATH"] = extraPaths + ":" + (env["PATH"] ?? "/usr/bin")
        proc.environment = env

        print("[agent] node: \(nodePath)")
        print("[agent] cli: \(cliPath)")
        print("[agent] cwd: \(projectRoot)")
        print("[agent] port: \(port)")

        let stdout = Pipe()
        let stderr = Pipe()
        proc.standardOutput = stdout
        proc.standardError = stderr

        // Log output
        stdout.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if !data.isEmpty, let str = String(data: data, encoding: .utf8) {
                print("[agent] \(str)", terminator: "")
            }
        }
        stderr.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if !data.isEmpty, let str = String(data: data, encoding: .utf8) {
                print("[agent:err] \(str)", terminator: "")
            }
        }

        proc.terminationHandler = { [weak self] process in
            DispatchQueue.main.async {
                guard let self else { return }
                if process.terminationStatus != 0 && self.restartCount < self.maxRestarts {
                    self.restartCount += 1
                    print("[agent] Crashed (exit \(process.terminationStatus)), restarting (\(self.restartCount)/\(self.maxRestarts))...")
                    self.state = .stopped
                    DispatchQueue.main.asyncAfter(deadline: .now() + Double(self.restartCount)) {
                        self.start()
                    }
                } else if process.terminationStatus != 0 {
                    self.state = .error("Agent crashed after \(self.maxRestarts) restarts")
                } else {
                    self.state = .stopped
                }
            }
        }

        do {
            try proc.run()
            process = proc
            // Health check will confirm running state
        } catch {
            state = .error("Failed to launch: \(error.localizedDescription)")
        }
    }

    func stop() {
        guard let proc = process, proc.isRunning else {
            state = .stopped
            return
        }
        proc.terminate()
        // Give 5s for graceful, then force
        DispatchQueue.global().asyncAfter(deadline: .now() + 5) {
            if proc.isRunning { proc.interrupt() }
        }
        process = nil
        state = .stopped
    }

    func restart() {
        restartCount = 0
        stop()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            self.start()
        }
    }

    @discardableResult
    func healthCheck() async -> Bool {
        let url = baseURL.appendingPathComponent("api/stats")
        do {
            let (_, response) = try await URLSession.shared.data(from: url)
            if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                await MainActor.run { state = .running; restartCount = 0 }
                return true
            }
        } catch {
            // Not ready yet
        }
        return false
    }

    // MARK: - Node.js Discovery

    private func findNode() -> String? {
        // Check user override
        if let custom = UserDefaults.standard.string(forKey: "nodePath"),
           FileManager.default.isExecutableFile(atPath: custom) {
            return custom
        }

        let candidates = [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node",
        ]

        for path in candidates {
            if FileManager.default.isExecutableFile(atPath: path) {
                return path
            }
        }

        // Fallback: which node
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        proc.arguments = ["which", "node"]
        let pipe = Pipe()
        proc.standardOutput = pipe
        try? proc.run()
        proc.waitUntilExit()
        if let output = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !output.isEmpty {
            return output
        }
        return nil
    }

    private func findCLI() -> String? {
        // 1. Bundled in app resources
        if let bundled = Foundation.Bundle.main.path(forResource: "bin/cli", ofType: "js") {
            return bundled
        }

        // 2. Known project locations (development)
        let knownPaths = [
            NSHomeDirectory() + "/Documents/Projects/Projects/claude-ecosystem-map/bin/cli.js",
            NSHomeDirectory() + "/Documents/Projects/Tools/claude-ecosystem-map/bin/cli.js",
        ]
        for knownPath in knownPaths {
            if FileManager.default.fileExists(atPath: knownPath) {
                return knownPath
            }
        }

        // 3. Relative to app bundle (when built inside desktop/)
        let devPaths = [
            FileManager.default.currentDirectoryPath + "/../bin/cli.js",
            Foundation.Bundle.main.bundlePath + "/../../../../bin/cli.js",
            Foundation.Bundle.main.bundlePath + "/../../../../../bin/cli.js",
        ]
        for path in devPaths {
            let resolved = (path as NSString).standardizingPath
            if FileManager.default.fileExists(atPath: resolved) {
                return resolved
            }
        }

        // 4. Global npm installs
        let npmPaths = [
            NSHomeDirectory() + "/.npm-global/lib/node_modules/ai-ecosystem-map/bin/cli.js",
            "/usr/local/lib/node_modules/ai-ecosystem-map/bin/cli.js",
            "/opt/homebrew/lib/node_modules/ai-ecosystem-map/bin/cli.js",
        ]
        for path in npmPaths {
            if FileManager.default.fileExists(atPath: path) {
                return path
            }
        }

        return nil
    }
}
