import SwiftUI

struct CategorySectionView: View {
    let category: String
    let assets: [Asset]
    let usedByMap: [String: [String]]

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
                        usedBy: usedByMap[asset.name] ?? []
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
