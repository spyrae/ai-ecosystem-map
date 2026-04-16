import SwiftUI

struct FilterSidebarView: View {
    @Environment(EcosystemStore.self) private var store

    @AppStorage("configMode") private var configMode = false
    @AppStorage("hiddenTypes") private var hiddenTypesRaw = ""
    @AppStorage("hiddenProviders") private var hiddenProvidersRaw = ""
    @AppStorage("hiddenCategories") private var hiddenCategoriesRaw = ""

    private var hiddenTypes: Set<String> {
        Set(hiddenTypesRaw.split(separator: ",").map(String.init))
    }

    private var hiddenProviders: Set<String> {
        Set(hiddenProvidersRaw.split(separator: ",").map(String.init))
    }

    private var hiddenCategories: Set<String> {
        Set(hiddenCategoriesRaw.split(separator: ",").map(String.init))
    }

    private func toggleHidden(_ item: String, in raw: Binding<String>) {
        var set = Set(raw.wrappedValue.split(separator: ",").map(String.init))
        if set.contains(item) {
            set.remove(item)
        } else {
            set.insert(item)
        }
        raw.wrappedValue = set.sorted().joined(separator: ",")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                // Config toggle
                HStack {
                    Text("Filters")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.tertiary)
                        .textCase(.uppercase)
                    Spacer()
                    Button {
                        configMode.toggle()
                    } label: {
                        Image(systemName: "gearshape")
                            .font(.caption)
                            .foregroundStyle(configMode ? Color.accentColor : Color.secondary)
                    }
                    .buttonStyle(.plain)
                    .help(configMode ? "Done configuring" : "Configure visible filters")
                }

                // Types
                filterSection("Types") {
                    ForEach(AssetType.creatableTypes) { type in
                        if configMode {
                            checkboxRow(
                                label: type.label,
                                icon: type.icon,
                                checked: !hiddenTypes.contains(type.rawValue)
                            ) {
                                toggleHidden(type.rawValue, in: $hiddenTypesRaw)
                                if hiddenTypes.contains(type.rawValue) && store.typeFilter == type {
                                    store.typeFilter = nil
                                }
                            }
                        } else if !hiddenTypes.contains(type.rawValue) {
                            filterRow(
                                label: type.label,
                                icon: type.icon,
                                isActive: store.typeFilter == type
                            ) {
                                store.typeFilter = store.typeFilter == type ? nil : type
                            }
                        }
                    }
                }

                Divider()

                // Providers
                filterSection("Providers") {
                    ForEach(Provider.allCases) { provider in
                        if configMode {
                            checkboxRow(
                                label: provider.label,
                                icon: provider.icon,
                                checked: !hiddenProviders.contains(provider.rawValue)
                            ) {
                                toggleHidden(provider.rawValue, in: $hiddenProvidersRaw)
                                if hiddenProviders.contains(provider.rawValue) && store.providerFilter == provider {
                                    store.providerFilter = nil
                                }
                            }
                        } else if !hiddenProviders.contains(provider.rawValue) {
                            filterRow(
                                label: provider.label,
                                icon: provider.icon,
                                isActive: store.providerFilter == provider
                            ) {
                                store.providerFilter = store.providerFilter == provider ? nil : provider
                            }
                        }
                    }
                }

                if !store.categories.isEmpty {
                    Divider()

                    // Categories
                    filterSection("Categories") {
                        ForEach(store.categories.sorted(by: { $0.value > $1.value }), id: \.key) { cat, count in
                            if configMode {
                                checkboxRow(
                                    label: cat,
                                    icon: "tag",
                                    checked: !hiddenCategories.contains(cat)
                                ) {
                                    toggleHidden(cat, in: $hiddenCategoriesRaw)
                                    if hiddenCategories.contains(cat) && store.categoryFilter == cat {
                                        store.categoryFilter = nil
                                    }
                                }
                            } else if !hiddenCategories.contains(cat) {
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
            }
            .padding(10)
        }
        .background(Color(.windowBackgroundColor).opacity(0.5))
    }

    // MARK: - Components

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

    private func checkboxRow(label: String, icon: String, checked: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: checked ? "checkmark.square.fill" : "square")
                    .frame(width: 14)
                    .font(.caption)
                    .foregroundStyle(checked ? Color.accentColor : Color.secondary)
                Image(systemName: icon)
                    .frame(width: 14)
                    .font(.caption2)
                Text(label)
                    .font(.caption)
                    .lineLimit(1)
                    .strikethrough(!checked)
                    .opacity(checked ? 1 : 0.5)
            }
            .padding(.vertical, 3)
            .padding(.horizontal, 6)
        }
        .buttonStyle(.plain)
        .foregroundStyle(checked ? .primary : .secondary)
    }
}
