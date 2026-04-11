import SwiftUI

struct BatchSyncPlanSheet: View {
    let title: String
    let preview: BatchSyncPreview
    let isApplying: Bool
    let onApply: () -> Void

    @Environment(\.dismiss) private var dismiss

    private var blockingCount: Int {
        preview.results.reduce(into: 0) { count, result in
            if !result.ok {
                count += 1
            }
            if result.plan?.issues.contains(where: { $0.level == "blocking" }) == true {
                count += 1
            }
        }
    }

    private var canApply: Bool {
        preview.readyCount > 0 && preview.hasChangesCount > 0 && blockingCount == 0
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(title)
                        .font(.title3.weight(.semibold))
                    Text("\(preview.total) assets · \(preview.readyCount) ready · \(preview.blockedCount) blocked · \(preview.operationCount) operations")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                HStack(spacing: 12) {
                    summaryPill("Ready", value: preview.readyCount, tint: .green)
                    summaryPill("Blocked", value: preview.blockedCount, tint: .red)
                    summaryPill("With Changes", value: preview.hasChangesCount, tint: .accentColor)
                    summaryPill("Operations", value: preview.operationCount, tint: .orange)
                }

                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(preview.results) { result in
                            VStack(alignment: .leading, spacing: 10) {
                                HStack {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(result.name)
                                            .font(.headline)
                                        Text(result.ok ? "\(result.plan?.operations.count ?? 0) operations · \(result.plan?.issues.count ?? 0) issues" : "Preview failed")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Text(result.ok ? (result.plan?.hasChanges == true ? "changes" : "up to date") : "error")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(result.ok ? .accentColor : .red)
                                }

                                if let error = result.error, !result.ok {
                                    issueRow(level: "blocking", message: error)
                                }

                                ForEach(result.plan?.issues ?? []) { issue in
                                    issueRow(level: issue.level, message: issue.message)
                                }

                                if let operations = result.plan?.operations, !operations.isEmpty {
                                    VStack(alignment: .leading, spacing: 8) {
                                        ForEach(operations) { operation in
                                            VStack(alignment: .leading, spacing: 4) {
                                                HStack {
                                                    Text(operation.summary)
                                                        .font(.subheadline)
                                                    Spacer()
                                                    Text(operation.action.uppercased())
                                                        .font(.caption2.weight(.semibold))
                                                        .foregroundStyle(.secondary)
                                                }
                                                if let targetPath = operation.targetPath, !targetPath.isEmpty {
                                                    Text(targetPath)
                                                        .font(.caption.monospaced())
                                                        .foregroundStyle(.secondary)
                                                        .textSelection(.enabled)
                                                }
                                            }
                                            .padding(10)
                                            .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                                        }
                                    }
                                } else if result.ok {
                                    Text("No operations generated for this asset.")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .padding(14)
                            .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
                        }
                    }
                }

                HStack {
                    Text(canApply
                         ? "Batch sync will be applied through the unified sync engine."
                         : "Resolve blocking issues or select assets with pending changes before applying.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    Spacer()
                    Button("Cancel") { dismiss() }
                        .keyboardShortcut(.cancelAction)
                    Button(isApplying ? "Applying..." : "Apply Batch Sync") {
                        onApply()
                    }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                    .disabled(isApplying || !canApply)
                }
            }
            .padding()
            .frame(minWidth: 760, minHeight: 560)
        }
    }

    private func summaryPill(_ label: String, value: Int, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(value)")
                .font(.title3.weight(.semibold))
                .foregroundStyle(tint)
            Text(label)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder
    private func issueRow(level: String, message: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: level == "blocking" ? "exclamationmark.triangle.fill" : "exclamationmark.circle")
                .foregroundStyle(level == "blocking" ? .red : .orange)
            Text(message)
                .font(.caption)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background((level == "blocking" ? Color.red : Color.orange).opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
    }
}
