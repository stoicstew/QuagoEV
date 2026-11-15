import SwiftUI
import Charts

struct RootView: View {
    @EnvironmentObject private var store: AppStore
    @State private var settingsPresented = false
    var body: some View {
        Group {
            if store.hasContent {
                TabView {
                    page("Overview", symbol: "square.grid.2x2") { OverviewView() }
                    page("Drives", symbol: "point.topleft.down.to.point.bottomright.curvepath") { DrivesView() }
                    page("Charging", symbol: "bolt.car") { ChargingView() }
                    page("Battery", symbol: "battery.75percent") { BatteryView() }
                    page("Insights", symbol: "chart.xyaxis.line") { InsightsView() }
                }
            } else {
                NavigationStack {
                    VStack(spacing: 25) {
                        Image(systemName: "bolt.car.fill").font(.system(size: 56, weight: .light)).foregroundStyle(Color.evAccent).accessibilityHidden(true)
                        VStack(spacing: 10) {
                            Text("Your Tesla, understood.").font(.largeTitle.bold()).multilineTextAlignment(.center)
                            Text("Drives, charging and battery trends.\nYour history stays with you offline.").font(.body).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        }
                        VStack(spacing: 12) {
                            Button("Connect to home server") { settingsPresented = true }.buttonStyle(.borderedProminent).controlSize(.large)
                            Button("Explore sample data") { store.enterDemo() }.buttonStyle(.bordered).controlSize(.large)
                        }
                        if let notice = store.notice { Text(notice).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center) }
                        Text("Connect through Tailscale when away from home.").font(.footnote).foregroundStyle(.secondary)
                    }.padding(28).frame(maxWidth: 540).frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color(.systemGroupedBackground)).navigationTitle("QuagoEV")
                }
            }
        }.sheet(isPresented: $settingsPresented) { SettingsView() }
    }

    private func page<Content: View>(_ title: String, symbol: String, @ViewBuilder content: () -> Content) -> some View {
        NavigationStack {
            content().navigationTitle(title)
                .toolbar {
                    ToolbarItemGroup(placement: .topBarTrailing) {
                        if store.isSyncing { ProgressView().accessibilityLabel("Synchronizing history") }
                        else { Button { Task { await store.sync() } } label: { Image(systemName: "arrow.clockwise") }.disabled(store.isDemo).accessibilityLabel("Sync history") }
                        Button { settingsPresented = true } label: { Image(systemName: "gearshape") }.accessibilityLabel("Settings")
                    }
                }
        }.tabItem { Label(title, systemImage: symbol) }
    }
}

struct HistoryPage<Content: View>: View {
    @EnvironmentObject private var store: AppStore
    @ViewBuilder var content: Content
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                ConnectionBanner()
                HStack {
                    if (store.snapshot?.vehicles.count ?? 0) > 1 {
                        Picker("Vehicle", selection: $store.selectedVehicleID) {
                            ForEach(store.snapshot?.vehicles ?? []) { Text($0.name).tag($0.id) }
                        }.labelsHidden().accessibilityLabel("Vehicle")
                    } else { Text(store.selectedVehicle?.name ?? "No vehicle recorded").font(.subheadline.weight(.medium)) }
                    Spacer()
                    Picker("Date range", selection: $store.period) { ForEach(HistoryPeriod.allCases) { Text($0.rawValue).tag($0) } }
                        .labelsHidden().accessibilityLabel("Date range")
                }
                content
                Text("Times shown in \(store.timeZone.identifier.replacingOccurrences(of: "_", with: " ")).").font(.caption).foregroundStyle(.secondary)
            }.padding().frame(maxWidth: 800).frame(maxWidth: .infinity)
        }.background(Color(.systemGroupedBackground)).refreshable { await store.sync() }
    }
}

struct ConnectionBanner: View {
    @EnvironmentObject private var store: AppStore
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Label(store.isDemo ? "Sample data · no vehicle connected" : store.connectionVerified ? "History synchronized" : "Saved history", systemImage: store.isDemo ? "sparkles" : store.connectionVerified ? "checkmark.icloud" : "internaldrive")
                .font(.subheadline.weight(.medium))
            if let date = store.savedAt { Text("Last sync \(format(date, timeZone: store.timeZone))").font(.caption).foregroundStyle(.secondary) }
            if let notice = store.notice { Text(notice).font(.footnote).foregroundStyle(.secondary) }
            if store.isDemo { Text("Illustrative values for exploring QuagoEV.").font(.caption).foregroundStyle(.secondary) }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(14)
            .background(Color.evAccent.opacity(0.09), in: RoundedRectangle(cornerRadius: 14))
            .accessibilityElement(children: .combine)
    }
}

struct Panel<Content: View>: View {
    var title: String
    var subtitle: String? = nil
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline)
                if let subtitle { Text(subtitle).font(.caption).foregroundStyle(.secondary) }
            }
            content
        }.frame(maxWidth: .infinity, alignment: .leading).padding(18)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18))
    }
}

struct Metric: View {
    let label: String
    let value: String
    var detail: String? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title2.weight(.semibold)).monospacedDigit().minimumScaleFactor(0.75)
            if let detail { Text(detail).font(.caption).foregroundStyle(.secondary) }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(16)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
            .accessibilityElement(children: .combine)
    }
}

func number(_ value: Double?, digits: Int = 1, suffix: String = "") -> String {
    guard let value, value.isFinite else { return "—" }
    return value.formatted(.number.precision(.fractionLength(digits))) + (suffix.isEmpty ? "" : " " + suffix)
}

func money(_ value: Double?, currency: String) -> String {
    guard let value else { return "—" }
    return value.formatted(.currency(code: currency))
}

func format(_ date: Date, timeZone: TimeZone, time: Bool = true) -> String {
    let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_AU"); formatter.timeZone = timeZone
    formatter.dateStyle = .medium; formatter.timeStyle = time ? .short : .none
    return formatter.string(from: date)
}

struct EmptyHistory: View {
    var title: String
    var message: String = "Recorded data will appear here after the home server collects it. Try a wider date range."
    var body: some View { ContentUnavailableView(title, systemImage: "chart.bar.xaxis", description: Text(message)).padding(.vertical, 12) }
}

struct TripRow: View {
    @EnvironmentObject private var store: AppStore
    let trip: Trip
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "point.topleft.down.to.point.bottomright.curvepath").foregroundStyle(Color.evAccent).padding(.top, 3)
            VStack(alignment: .leading, spacing: 5) {
                Text(format(trip.date, timeZone: store.timeZone)).font(.subheadline.weight(.medium))
                Text("\(number(trip.durationMinutes, digits: 0)) min · \(trip.tag.capitalized)").font(.caption).foregroundStyle(.secondary)
                if trip.incomplete { Label("Incomplete recording", systemImage: "exclamationmark.circle").font(.caption).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 5) {
                Text(number(trip.distanceKm, suffix: "km")).font(.subheadline.weight(.medium)).monospacedDigit()
                Text(number(trip.energyKwh, suffix: "kWh")).font(.caption).foregroundStyle(.secondary)
            }
        }.padding(.vertical, 5).foregroundStyle(.primary)
    }
}

extension Color { static var evAccent: Color { Color("AccentColor") } }
