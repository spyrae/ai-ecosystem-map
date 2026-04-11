import SwiftUI

struct CategorySectionView: View {
    let category: String
    let assets: [Asset]
    let usedByMap: [String: [String]]
    var selectionMode = false
    var selectedAssetIDs: Set<String> = []
    var onToggleSelection: ((Asset) -> Void)? = nil

    @State private var isExpanded = true

    private let columns = [
        GridItem(.adaptive(minimum: 280, maximum: 400), spacing: 12)
    ]

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            LazyVGrid(columns: columns, spacing: 12) {
                ForEach(assets) { asset in
                    AssetCardView(
                        asset: asset,
                        usedBy: usedByMap[asset.name] ?? [],
                        selectionMode: selectionMode,
                        selected: selectedAssetIDs.contains(asset.id),
                        onToggleSelection: onToggleSelection
                    )
                }
            }
        } label: {
            HStack(spacing: 8) {
                Text(category)
                    .font(.headline)
                Text("\(assets.count)")
                    .font(.caption)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.quaternary, in: Capsule())
            }
        }
    }
}
