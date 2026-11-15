import SwiftUI
import Charts

struct OverviewView: View {
    @EnvironmentObject private var store: AppStore
    var body: some View {
        HistoryPage {
            if let observed = store.selectedVehicle?.latest {
                Panel(title: "Last vehicle observation", subtitle: format(Date(milliseconds: observed.observedAt), timeZone: store.timeZone)) {
                    HStack(alignment: .firstTextBaseline) {
                        Label(number(observed.batteryLevel, digits: 0, suffix: "%"), systemImage: "battery.75percent").font(.largeTitle.weight(.medium)).foregroundStyle(Color.evAccent)
                        Spacer()
                        VStack(alignment: .trailing, spacing: 5) {
                            Text(number(observed.estimatedRangeKm, digits: 0, suffix: "km")).font(.title2.weight(.medium))
                            Text("Estimated range").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    HStack {
                        Text(observed.state.capitalized)
                        Spacer()
                        Text(number(observed.outsideTempC, digits: 0, suffix: "°C outside"))
                    }.font(.subheadline).foregroundStyle(.secondary)
                }
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 140))], spacing: 12) {
                Metric(label: "Distance driven", value: number(store.trips.isEmpty ? nil : store.distance, suffix: "km"), detail: "\(store.trips.count) recorded drives")
                Metric(label: "Driving efficiency", value: number(Analytics.efficiency(store.trips), digits: 0, suffix: "Wh/km"), detail: "Complete, energy-known drives")
                Metric(label: "Charging cost", value: money(Analytics.knownSum(store.charges.map(\.cost)), currency: store.currency), detail: "\(store.charges.filter { $0.cost != nil }.count) of \(store.charges.count) sessions costed · \(store.charges.filter(\.incomplete).count) partial")
            }
            if !store.trips.isEmpty { DistanceChart(trips: store.trips, timeZone: store.timeZone) }
            Panel(title: "Recent drives") {
                if store.trips.isEmpty { EmptyHistory(title: "No drives in this period") }
                ForEach(Array(store.trips.prefix(3))) { trip in
                    NavigationLink { TripDetailView(trip: trip) } label: { TripRow(trip: trip) }
                    if trip.id != store.trips.prefix(3).last?.id { Divider() }
                }
            }
            if let collector = store.snapshot?.collector {
                Panel(title: "Data collection", subtitle: store.connectionVerified ? "Reported by your home server" : "Last known server status") {
                    Label(collector.status.replacingOccurrences(of: "_", with: " ").capitalized, systemImage: "externaldrive.connected.to.line.below").font(.subheadline.weight(.medium))
                    Text(collector.message).font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
    }
}

struct DistanceChart: View {
    var trips: [Trip]
    var timeZone: TimeZone
    private var daily: [(date: Date, distance: Double)] {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = timeZone
        return Dictionary(grouping: trips, by: { calendar.startOfDay(for: $0.date) })
            .map { (date: $0.key, distance: $0.value.reduce(0) { $0 + $1.distanceKm }) }.sorted { $0.date < $1.date }
    }
    var body: some View {
        Panel(title: "Distance over time", subtitle: "Kilometres per recorded day") {
            Chart(daily, id: \.date) { item in
                BarMark(x: .value("Day", item.date, unit: .day), y: .value("Distance (km)", item.distance)).foregroundStyle(Color.evAccent.gradient).cornerRadius(4)
            }.chartYAxisLabel("km").frame(height: 180).environment(\.timeZone, timeZone)
                .accessibilityLabel("Distance driven by day")
        }
    }
}

struct DrivesView: View {
    @EnvironmentObject private var store: AppStore
    @State private var exportURL: ShareFile?
    @State private var error: String?
    var body: some View {
        HistoryPage {
            HStack {
                Text("\(store.trips.count) drives · \(number(store.distance, suffix: "km"))").font(.subheadline).foregroundStyle(.secondary)
                Spacer()
                Button { do { exportURL = ShareFile(url: try store.exportCSV()) } catch { self.error = error.localizedDescription } } label: { Label("Export", systemImage: "square.and.arrow.up") }.disabled(store.trips.isEmpty)
            }
            Panel(title: "Drive history") {
                if store.trips.isEmpty { EmptyHistory(title: "No drives in this period") }
                ForEach(store.trips) { trip in
                    NavigationLink { TripDetailView(trip: trip) } label: { TripRow(trip: trip) }
                    if trip.id != store.trips.last?.id { Divider() }
                }
            }
        }.sheet(item: $exportURL) { ShareSheet(items: [$0.url]) }
            .alert("Export unavailable", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) { Button("OK") { error = nil } } message: { Text(error ?? "") }
    }
}

struct ChargingView: View {
    @EnvironmentObject private var store: AppStore
    var body: some View {
        HistoryPage {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 140))], spacing: 12) {
                Metric(label: "Recorded energy added", value: number(Analytics.knownSum(store.charges.map(\.energyKwh)), suffix: "kWh"), detail: "\(store.charges.count) sessions · \(store.charges.filter(\.incomplete).count) partial")
                Metric(label: "Recorded costs", value: money(Analytics.knownSum(store.charges.map(\.cost)), currency: store.currency), detail: "Includes tariff estimates")
            }
            Panel(title: "Charging sessions", subtitle: "Totals include observed portions of partial recordings. Energy-based costs may exclude charging losses.") {
                if store.charges.isEmpty { EmptyHistory(title: "No charges in this period") }
                ForEach(store.charges) { charge in
                    NavigationLink { ChargeDetailView(charge: charge) } label: {
                        HStack(alignment: .top) {
                            Image(systemName: "bolt.fill").foregroundStyle(Color.evAccent).padding(.top, 3)
                            VStack(alignment: .leading, spacing: 5) {
                                Text(charge.locationName ?? "Unlabelled location").font(.subheadline.weight(.medium))
                                Text(format(charge.date, timeZone: store.timeZone)).font(.caption).foregroundStyle(.secondary)
                                if charge.incomplete { Label("Partial recording", systemImage: "exclamationmark.circle").font(.caption).foregroundStyle(.secondary) }
                                Text("\(number(charge.startBattery, digits: 0))% → \(number(charge.endBattery, digits: 0))%").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 5) {
                                Text(number(charge.energyKwh, suffix: "kWh")).font(.subheadline.weight(.medium))
                                Text(money(charge.cost, currency: store.currency)).font(.subheadline)
                                Text(charge.costSource.capitalized).font(.caption).foregroundStyle(.secondary)
                            }
                        }.foregroundStyle(.primary).padding(.vertical, 5)
                    }
                    if charge.id != store.charges.last?.id { Divider() }
                }
            }
        }
    }
}

struct BatteryView: View {
    @EnvironmentObject private var store: AppStore
    private var samples: [BatterySample] { store.battery.filter { $0.fullRangeKm != nil } }
    var body: some View {
        HistoryPage {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 140))], spacing: 12) {
                Metric(label: "Full-charge range", value: number(samples.last?.fullRangeKm, digits: 0, suffix: "km"), detail: "BMS-derived estimate")
                Metric(label: "Measurements", value: String(samples.count), detail: "Selected period")
            }
            Panel(title: "Estimated range trend", subtitle: "Range extrapolated to 100% charge") {
                if samples.isEmpty { EmptyHistory(title: "No battery measurements") }
                else {
                    Chart(samples) { point in
                        LineMark(x: .value("Date", point.date), y: .value("Full-charge range", point.fullRangeKm ?? 0)).foregroundStyle(Color.evAccent)
                        PointMark(x: .value("Date", point.date), y: .value("Full-charge range", point.fullRangeKm ?? 0)).foregroundStyle(Color.evAccent).symbolSize(24)
                    }.chartYScale(domain: .automatic(includesZero: false)).chartYAxisLabel("km").frame(height: 220).environment(\.timeZone, store.timeZone)
                    Text("Range estimates vary with calibration and conditions. This is a history of estimates, not a diagnostic battery health test.").font(.footnote).foregroundStyle(.secondary)
                }
            }
            Panel(title: "Recent measurements") {
                ForEach(Array(samples.suffix(7).reversed())) { sample in
                    HStack {
                        Text(format(sample.date, timeZone: store.timeZone, time: false)).font(.subheadline)
                        Spacer()
                        Text(number(sample.fullRangeKm, suffix: "km")).font(.subheadline).monospacedDigit()
                    }
                }
            }
        }
    }
}

struct InsightsView: View {
    @EnvironmentObject private var store: AppStore
    private var businessDistance: Double { store.trips.filter { $0.tag == "business" }.reduce(0) { $0 + $1.distanceKm } }
    var body: some View {
        HistoryPage {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 140))], spacing: 12) {
                Metric(label: "Driving energy", value: number(Analytics.knownSum(store.trips.map(\.energyKwh)), suffix: "kWh"), detail: "\(store.trips.filter { $0.energyKwh != nil }.count) of \(store.trips.count) drives known")
                Metric(label: "Idle energy", value: number(Analytics.knownSum(store.idles.map(\.energyKwh)), suffix: "kWh"), detail: "\(store.idles.filter { $0.energyKwh != nil }.count) of \(store.idles.count) periods known")
                Metric(label: "Business distance", value: number(businessDistance, suffix: "km"), detail: "Based on your drive tags")
            }
            if !store.trips.isEmpty { DistanceChart(trips: store.trips, timeZone: store.timeZone) }
            Panel(title: "Recording quality") {
                qualityRow("Incomplete drives", value: "\(store.trips.filter(\.incomplete).count)")
                qualityRow("Partial charging recordings", value: "\(store.charges.filter(\.incomplete).count)")
                qualityRow("Drives with estimated energy", value: "\(store.trips.filter { $0.energySource == "estimated" || $0.energySource == "legacy-estimate" }.count)")
                qualityRow("Charges missing a cost", value: "\(store.charges.filter { $0.cost == nil }.count)")
                Text("Unknown values stay unknown. Estimates are included only when the server has enough information to calculate them.").font(.footnote).foregroundStyle(.secondary)
            }
            if let usage = store.snapshot?.collector.usage {
                Panel(title: "Collector usage", subtitle: "Last reported for \(usage.month)") {
                    qualityRow("Estimated API usage", value: money(usage.estimatedCostUsd, currency: "USD"))
                    qualityRow("Collector limit", value: money(usage.limitUsd, currency: "USD"))
                    Text("This estimate covers this collector, not your Tesla billing account. The allowance and billing settings must be verified separately.").font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
    }
    private func qualityRow(_ title: String, value: String) -> some View { HStack { Text(title); Spacer(); Text(value).monospacedDigit() }.font(.subheadline) }
}
