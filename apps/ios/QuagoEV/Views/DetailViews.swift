import SwiftUI
import MapKit
import UIKit

struct TripDetailView: View {
    @EnvironmentObject private var store: AppStore
    let trip: Trip
    @State private var tag: String
    @State private var notes: String
    @State private var error: String?
    @State private var saved = false

    init(trip: Trip) {
        self.trip = trip
        _tag = State(initialValue: trip.tag)
        _notes = State(initialValue: trip.notes)
    }

    private var current: Trip { store.snapshot?.trips.first { $0.id == trip.id } ?? trip }
    var body: some View {
        Form {
            Section {
                LabeledContent("Started", value: format(current.date, timeZone: store.timeZone))
                LabeledContent("Duration", value: number(current.durationMinutes, digits: 0, suffix: "min"))
                LabeledContent("Distance", value: number(current.distanceKm, suffix: "km"))
                LabeledContent("Energy", value: number(current.energyKwh, suffix: "kWh"))
                LabeledContent("Energy source", value: current.energySource.replacingOccurrences(of: "-", with: " ").capitalized)
                LabeledContent("Efficiency", value: number(current.efficiency, digits: 0, suffix: "Wh/km"))
                if current.incomplete { Label("This recording has missing observations.", systemImage: "exclamationmark.circle").foregroundStyle(.secondary) }
            } header: { Text("Drive summary") }
            Section {
                if current.validRoute.count > 1 { RouteView(points: current.validRoute) }
                else { Text("No route points were recorded for this drive.").foregroundStyle(.secondary) }
            } header: { Text("Recorded route") }
            Section {
                Picker("Classification", selection: $tag) {
                    Text("Unclassified").tag("unclassified")
                    Text("Personal").tag("personal")
                    Text("Business").tag("business")
                }
                TextField("Notes", text: $notes, axis: .vertical).lineLimit(3...8)
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                Button(saved ? "Saved" : "Save drive details") {
                    Task {
                        do { try await store.patch(path: "api/v2/trips/\(trip.id)", payload: ["tag": tag, "notes": notes]); saved = true; error = nil }
                        catch { self.error = error.localizedDescription }
                    }
                }.disabled(!store.canEdit || notes.count > 4_000)
                    .onChange(of: tag) { _, _ in saved = false }.onChange(of: notes) { _, _ in saved = false }
            } header: { Text("Your records") } footer: {
                Text(store.isDemo ? "Sample records are read-only." : store.canEdit ? "Changes sync to your other devices through the home server." : "Reconnect to save. Your draft stays on this screen.")
            }
        }.navigationTitle("Drive details").navigationBarTitleDisplayMode(.inline)
    }
}

struct ChargeDetailView: View {
    @EnvironmentObject private var store: AppStore
    let charge: Charge
    @State private var locationName: String
    @State private var locationType: String
    @State private var actualCost: String
    @State private var tariff: String
    @State private var error: String?
    @State private var saved = false
    init(charge: Charge) {
        self.charge = charge
        _locationName = State(initialValue: charge.locationName ?? "")
        _locationType = State(initialValue: charge.locationType)
        _actualCost = State(initialValue: charge.costSource == "actual" ? charge.cost.map(String.init(describing:)) ?? "" : "")
        _tariff = State(initialValue: charge.ratePerKwh.map(String.init(describing:)) ?? "")
    }
    private var current: Charge { store.snapshot?.charges.first { $0.id == charge.id } ?? charge }
    var body: some View {
        Form {
            Section("Charge summary") {
                LabeledContent("Started", value: format(current.date, timeZone: store.timeZone))
                LabeledContent("Energy added", value: number(current.energyKwh, suffix: "kWh"))
                LabeledContent("Maximum power", value: number(current.maxPowerKw, suffix: "kW"))
                LabeledContent("Cost", value: money(current.cost, currency: store.currency))
                LabeledContent("Cost source", value: current.costSource.capitalized)
                if current.incomplete {
                    Label("Partial recording", systemImage: "exclamationmark.circle").foregroundStyle(.secondary)
                    Text("Energy and duration cover the recorded observations only. The full charging session may have started earlier or contain a gap.").font(.footnote).foregroundStyle(.secondary)
                }
            }
            Section {
                TextField("Location name", text: $locationName)
                Picker("Location type", selection: $locationType) {
                    ForEach(["unknown", "home", "work", "public"], id: \.self) { Text($0.capitalized).tag($0) }
                }
                TextField("Actual cost (\(store.currency))", text: $actualCost).keyboardType(.decimalPad)
                TextField("Session tariff (\(store.currency)/kWh, optional)", text: $tariff).keyboardType(.decimalPad)
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                Button(saved ? "Saved" : "Save charge details") {
                    Task {
                        do {
                            let cost = try optionalNumber(actualCost)
                            let rate = try optionalNumber(tariff)
                            try await store.patch(path: "api/v2/charges/\(charge.id)", payload: ["locationName": locationName.isEmpty ? NSNull() : locationName as Any, "locationType": locationType, "cost": cost.map { $0 as Any } ?? NSNull(), "ratePerKwh": rate.map { $0 as Any } ?? NSNull()])
                            saved = true; error = nil
                        } catch { self.error = error.localizedDescription }
                    }
                }.disabled(!store.canEdit)
                    .onChange(of: actualCost) { _, _ in saved = false }.onChange(of: locationName) { _, _ in saved = false }.onChange(of: locationType) { _, _ in saved = false }.onChange(of: tariff) { _, _ in saved = false }
            } header: { Text("Your records") } footer: {
                Text(store.canEdit ? "Actual cost takes precedence. Leave it blank to use a tariff estimate. A blank session tariff inherits your home rate for home sessions; other locations remain unknown." : "Connect to the home server to save changes. Sample records are read-only.")
            }
        }.navigationTitle("Charge details").navigationBarTitleDisplayMode(.inline)
    }
}

func optionalNumber(_ value: String) throws -> Double? {
    let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if value.isEmpty { return nil }
    guard let number = Double(value), number.isFinite, number >= 0 else { throw AppError.invalidNumber }
    return number
}

struct RouteView: View {
    let points: [RoutePoint]
    @State private var showMap = false
    private var coordinates: [CLLocationCoordinate2D] { points.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lng) } }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("Route display", selection: $showMap) { Text("Saved route").tag(false); Text("Map").tag(true) }.pickerStyle(.segmented)
            if showMap {
                Map {
                    MapPolyline(coordinates: coordinates).stroke(Color.evAccent, lineWidth: 4)
                    if let start = coordinates.first { Marker("Start", systemImage: "play.fill", coordinate: start).tint(Color.evAccent) }
                    if let end = coordinates.last { Marker("End", systemImage: "flag.fill", coordinate: end).tint(.orange) }
                }.frame(height: 240).clipShape(RoundedRectangle(cornerRadius: 12))
                Text("Map backgrounds may need internet. Saved route works offline.").font(.caption).foregroundStyle(.secondary)
            } else {
                RouteSketch(points: points).frame(height: 210)
                HStack { Label("Start", systemImage: "circle.fill").foregroundStyle(Color.evAccent); Spacer(); Label("End", systemImage: "flag.fill").foregroundStyle(.secondary) }.font(.caption)
                Text("\(points.count) saved points · straight lines join recorded observations.").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

struct RouteSketch: View {
    let points: [RoutePoint]
    var body: some View {
        Canvas { context, size in
            guard points.count > 1 else { return }
            let latitude = points.map(\.lat).reduce(0, +) / Double(points.count)
            let xs = points.map { $0.lng * cos(latitude * .pi / 180) }
            let ys = points.map { -$0.lat }
            let minX = xs.min()!, maxX = xs.max()!, minY = ys.min()!, maxY = ys.max()!
            let scale = min((size.width - 44) / max(maxX - minX, 0.00001), (size.height - 44) / max(maxY - minY, 0.00001))
            let middleX = (minX + maxX) / 2
            let middleY = (minY + maxY) / 2
            var coordinates: [CGPoint] = []
            for index in xs.indices {
                let x = CGFloat(xs[index] - middleX) * scale + size.width / 2
                let y = CGFloat(ys[index] - middleY) * scale + size.height / 2
                coordinates.append(CGPoint(x: x, y: y))
            }
            var path = Path(); path.addLines(coordinates)
            context.stroke(path, with: .color(Color.evAccent), style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
            for (index, point) in [coordinates.first!, coordinates.last!].enumerated() {
                let mark = CGRect(x: point.x - 6, y: point.y - 6, width: 12, height: 12)
                context.fill(Path(ellipseIn: mark), with: .color(index == 0 ? Color.evAccent : .orange))
            }
        }.background(Color.evAccent.opacity(0.04), in: RoundedRectangle(cornerRadius: 12))
            .accessibilityLabel("Offline route sketch with \(points.count) saved geographic observations. Start and end are marked.")
    }
}

struct ShareFile: Identifiable { let id = UUID(); let url: URL }

struct ShareSheet: UIViewControllerRepresentable {
    var items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: items, applicationActivities: nil) }
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
