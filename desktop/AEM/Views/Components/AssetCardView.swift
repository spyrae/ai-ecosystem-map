import SwiftUI

struct AssetCardView: View {
    let asset: Asset
    let usedBy: [String]

    @Environment(EcosystemStore.self) private var store
    @State private var isHovered = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Header: type badge + name
            HStack(spacing: 6) {
                Image(systemName: asset.type.icon)
                    .font(.caption)
                    .foregroundStyle(typeColor)
                Text(asset.name)
                    .font(.system(.body, design: .monospaced, weight: .medium))
                    .lineLimit(1)
                Spacer()
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
                .stroke(isHovered ? Color.accentColor.opacity(0.3) : Color.gray.opacity(0.2), lineWidth: 1)
        )
        .onHover { isHovered = $0 }
        .onTapGesture { store.selectedAsset = asset }
        .contextMenu {
            Button("Edit") { store.selectedAsset = asset }
            Divider()
            Button("Delete", role: .destructive) {
                // TODO: delete confirmation
            }
        }
        .animation(.easeInOut(duration: 0.15), value: isHovered)
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
