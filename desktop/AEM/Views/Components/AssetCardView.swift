import SwiftUI

struct AssetCardView: View {
    let asset: Asset
    let usedBy: [String]
    var selectionMode = false
    var selected = false
    var onToggleSelection: ((Asset) -> Void)? = nil

    @Environment(EcosystemStore.self) private var store
    @State private var isHovered = false

    private var consumerCount: Int {
        asset.dependency?.consumerCount ?? 0
    }

    private var isOrphaned: Bool {
        asset.dependency?.orphaned == true
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Header: type badge + name
            HStack(spacing: 6) {
                if selectionMode {
                    Button {
                        onToggleSelection?(asset)
                    } label: {
                        Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(selected ? Color.accentColor : Color.secondary)
                    }
                    .buttonStyle(.plain)
                }
                Image(systemName: asset.type.icon)
                    .font(.caption)
                    .foregroundStyle(typeColor)
                Text(asset.name)
                    .font(.system(.body, design: .monospaced, weight: .medium))
                    .lineLimit(1)
                Spacer()
                if let health = asset.health, health.status != "ok" {
                    Label(health.status == "broken" ? "Broken" : "Warning", systemImage: health.status == "broken" ? "exclamationmark.octagon.fill" : "exclamationmark.triangle.fill")
                        .font(.caption2)
                        .foregroundStyle(health.status == "broken" ? .red : .orange)
                        .help(health.summary)
                }
                if isOrphaned {
                    Text("Unused")
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.red.opacity(0.12), in: Capsule())
                        .foregroundStyle(.red)
                        .help(asset.dependency?.summary ?? "This asset has no downstream consumers.")
                }
                if let drift = asset.drift {
                    Text(drift.status.label)
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(drift.status.tint.opacity(0.12), in: Capsule())
                        .foregroundStyle(drift.status.tint)
                        .help(drift.summary)
                }
                if asset.isOrchestrator {
                    Image(systemName: "arrow.triangle.branch")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                        .help("Orchestrator")
                }
            }

            // Description
            if !asset.desc.isEmpty {
                Text(asset.desc)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            if let health = asset.health, health.status != "ok" {
                Text(health.summary)
                    .font(.caption2)
                    .foregroundStyle(health.status == "broken" ? .red : .orange)
                    .lineLimit(2)
            }

            if let capabilitySummary = asset.capabilities?.summary {
                let items = capabilitySummary.compactItems.prefix(3)
                if !items.isEmpty {
                    HStack(spacing: 4) {
                        Text("Targets")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.tertiary)
                        ForEach(Array(items), id: \.self) { item in
                            Text(item)
                                .font(.caption2)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 2)
                                .background(.quaternary, in: Capsule())
                        }
                    }
                }
            }

            if consumerCount > 0, let dependency = asset.dependency {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Consumers")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.tertiary)
                    Text(dependency.summary)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))
            }

            // Provider badges
            if !asset.providers.isEmpty {
                HStack(spacing: 4) {
                    ForEach(asset.providers, id: \.self) { providerName in
                        if let provider = Provider(rawValue: providerName) {
                            Image(systemName: provider.icon)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .help(provider.label)
                        }
                    }
                    Spacer()

                    // Deps count
                    if !asset.deps.isEmpty {
                        HStack(spacing: 2) {
                            Image(systemName: "arrow.right")
                            Text("\(asset.deps.count)")
                        }
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .help("Uses \(asset.deps.count) other assets")
                    }

                    if !usedBy.isEmpty {
                        HStack(spacing: 2) {
                            Image(systemName: "arrow.left")
                            Text("\(usedBy.count)")
                        }
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .help("Used by \(usedBy.count) assets")
                    }
                }
            }

            // Tags
            if !asset.tags.isEmpty {
                HStack(spacing: 4) {
                    ForEach(asset.tags.prefix(4), id: \.self) { tag in
                        Text(tag)
                            .font(.system(size: 10))
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(.quaternary, in: Capsule())
                    }
                    if asset.tags.count > 4 {
                        Text("+\(asset.tags.count - 4)")
                            .font(.system(size: 10))
                            .foregroundStyle(.tertiary)
                    }
                }
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(.background)
                .shadow(color: isHovered ? .accentColor.opacity(0.15) : .black.opacity(0.1), radius: isHovered ? 8 : 4)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(
                    selected
                        ? Color.accentColor.opacity(0.8)
                        : (isHovered ? Color.accentColor.opacity(0.3) : Color.gray.opacity(0.2)),
                    lineWidth: selected ? 2 : 1
                )
        )
        .onHover { isHovered = $0 }
        .onTapGesture {
            if selectionMode {
                onToggleSelection?(asset)
            } else {
                store.selectedAsset = asset
            }
        }
        .contextMenu {
            Button("Edit") { store.selectedAsset = asset }
                .disabled(!asset.canEdit)
            Divider()
            Button("Delete", role: .destructive) {
                store.selectedAsset = asset
            }
            .disabled(!asset.canDelete)
        }
        .animation(.easeInOut(duration: 0.15), value: isHovered)
        .animation(.easeInOut(duration: 0.15), value: selected)
    }

    private var typeColor: Color {
        switch asset.type {
        case .skill: .blue
        case .agent: .purple
        case .mcp: .green
        case .instruction: .orange
        case .rule: .cyan
        }
    }
}
