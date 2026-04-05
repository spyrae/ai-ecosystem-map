import SwiftUI

struct FilterSidebarView: View {
    @Environment(EcosystemStore.self) private var store

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                filterSection("Types") {
                    ForEach(AssetType.allCases) { type in
                        filterRow(
                            label: type.label,
                            icon: type.icon,
                            isActive: store.typeFilter == type
                        ) {
                            store.typeFilter = store.typeFilter == type ? nil : type
                        }
                    }
                }

                Divider()

                filterSection("Providers") {
                    ForEach(Provider.allCases) { provider in
                        filterRow(
                            label: provider.label,
                            icon: provider.icon,
                            isActive: store.providerFilter == provider
                        ) {
                            store.providerFilter = store.providerFilter == provider ? nil : provider
                        }
                    }
                }

                if !store.categories.isEmpty {
                    Divider()

                    filterSection("Categories") {
                        ForEach(store.categories.sorted(by: { $0.value > $1.value }), id: \.key) { cat, count in
                            filterRow(
                                label: cat,
                                count: count,
                                icon: "tag",
                                isActive: store.categoryFilter == cat
                            ) {
                                store.categoryFilter = store.categoryFilter == cat ? nil : cat
                            }
                        }
                    }
                }
            }
            .padding(10)
        }
        .background(Color(.windowBackgroundColor).opacity(0.5))
    }

    private func filterSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.tertiary)
                .textCase(.uppercase)
                .padding(.bottom, 2)
            content()
        }
    }

    private func filterRow(label: String, count: Int? = nil, icon: String, isActive: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .frame(width: 14)
                    .font(.caption2)
                Text(label)
                    .font(.caption)
                    .lineLimit(1)
                if let count {
                    Spacer()
                    Text("\(count)")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(.vertical, 3)
            .padding(.horizontal, 6)
            .background(isActive ? Color.accentColor.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 4))
        }
        .buttonStyle(.plain)
        .foregroundStyle(isActive ? Color.accentColor : .primary)
    }
}
