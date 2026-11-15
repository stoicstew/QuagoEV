import SwiftUI

@MainActor
final class AppStore: ObservableObject {
    @Published private(set) var snapshot: Snapshot?
    @Published private(set) var profile: ServerProfile?
    @Published private(set) var savedAt: Date?
    @Published private(set) var isDemo = false
    @Published private(set) var isSyncing = false
    @Published private(set) var connectionVerified = false
    @Published var notice: String?
    @Published var selectedVehicleID = ""
    @Published var period: HistoryPeriod = .month
    private var generation = UUID()
    private var latestRequest = UUID()
    private let client = APIClient()
    private var cache: CacheStore?

    init() {
        do {
            cache = try CacheStore()
            profile = try CredentialStore.load()
            if let profile, let saved = try cache?.load(profile) {
                snapshot = saved.snapshot
                savedAt = saved.savedAt
                selectedVehicleID = saved.snapshot.vehicles.first?.id ?? ""
            }
        } catch { notice = error.localizedDescription }
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--reset-test-profile") { try? forget() }
        #endif
        if ProcessInfo.processInfo.arguments.contains("--demo") { enterDemo() }
    }

    var hasContent: Bool { snapshot != nil }
    var canEdit: Bool { !isDemo && connectionVerified && !isSyncing && profile != nil }
    var selectedVehicle: Vehicle? { snapshot?.vehicles.first { $0.id == selectedVehicleID } }
    var timeZone: TimeZone { snapshot?.timeZone ?? TimeZone(identifier: "Australia/Melbourne")! }
    var currency: String { snapshot?.settings.currency ?? "AUD" }
    var referenceDate: Date { isDemo ? Date(milliseconds: snapshot?.generatedAt ?? Date().milliseconds) : Date() }

    var trips: [Trip] { (snapshot?.trips ?? []).filter { matches($0.vehicleId, timestamp: $0.startTime) }.sorted { $0.startTime > $1.startTime } }
    var charges: [Charge] { (snapshot?.charges ?? []).filter { matches($0.vehicleId, timestamp: $0.startTime) }.sorted { $0.startTime > $1.startTime } }
    var battery: [BatterySample] { (snapshot?.battery ?? []).filter { matches($0.vehicleId, timestamp: $0.timestamp) }.sorted { $0.timestamp < $1.timestamp } }
    var idles: [Idle] { (snapshot?.idles ?? []).filter { matches($0.vehicleId, timestamp: $0.startTime) } }
    var distance: Double { trips.reduce(0) { $0 + $1.distanceKm } }

    func matches(_ vehicleID: String, timestamp: Double) -> Bool {
        (selectedVehicleID.isEmpty || vehicleID == selectedVehicleID) && period.contains(Date(milliseconds: timestamp), now: referenceDate, timeZone: timeZone)
    }

    func sync() async {
        guard !isDemo, let profile, !isSyncing else { return }
        let generation = generation
        let requestID = UUID(); latestRequest = requestID
        isSyncing = true
        defer { if self.generation == generation && latestRequest == requestID { isSyncing = false } }
        do {
            let fresh = try await client.snapshot(url: APIClient.serverURL(profile.url), token: profile.token)
            guard self.generation == generation && latestRequest == requestID else { return }
            guard fresh.serverId == profile.serverId else { throw AppError.serverChanged }
            try accept(fresh, profile: profile)
        } catch {
            guard self.generation == generation && latestRequest == requestID else { return }
            connectionVerified = false
            notice = error is URLError ? "Server unavailable. Showing saved history. Check that Tailscale and the Windows server are running." : error.localizedDescription
        }
    }

    func connect(server: String, token: String) async throws {
        let url = try APIClient.serverURL(server)
        let token = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else { throw AppError.message("Enter the QuagoEV server access key.") }
        generation = UUID(); let generation = generation
        let requestID = UUID(); latestRequest = requestID
        isSyncing = true
        defer { if self.generation == generation { isSyncing = false } }
        let fresh = try await client.snapshot(url: url, token: token)
        guard self.generation == generation && latestRequest == requestID else { throw CancellationError() }
        let newProfile = ServerProfile(url: url.absoluteString, token: token, serverId: fresh.serverId)
        if let old = profile, old.url == newProfile.url && old.serverId != fresh.serverId { throw AppError.serverChanged }
        guard let cache else { throw AppError.message("Local history storage is unavailable. Restart the app before connecting.") }
        let newSavedAt = try cache.save(fresh, profile: newProfile)
        try CredentialStore.save(newProfile)
        if let old = profile, old.cacheID != newProfile.cacheID { try? cache.remove(old) }
        profile = newProfile; snapshot = fresh; savedAt = newSavedAt
        isDemo = false; connectionVerified = true; notice = nil
        selectedVehicleID = fresh.vehicles.first?.id ?? ""
    }

    private func accept(_ fresh: Snapshot, profile: ServerProfile) throws {
        guard let cache else { throw AppError.message("Local history storage is unavailable. Your saved history has been kept.") }
        savedAt = try cache.save(fresh, profile: profile)
        snapshot = fresh
        if !fresh.vehicles.contains(where: { $0.id == selectedVehicleID }) { selectedVehicleID = fresh.vehicles.first?.id ?? "" }
        connectionVerified = true; notice = nil
    }

    func patch(path: String, payload: [String: Any]) async throws {
        guard canEdit, let profile else { throw AppError.message("Reconnect to your server before editing. Your draft has been kept.") }
        let generation = generation
        let requestID = UUID(); latestRequest = requestID
        isSyncing = true
        defer { if self.generation == generation && latestRequest == requestID { isSyncing = false } }
        do {
            let body = try JSONSerialization.data(withJSONObject: payload)
            let fresh = try await client.request(url: APIClient.serverURL(profile.url), token: profile.token, path: path, method: "PATCH", body: body)
            guard self.generation == generation && latestRequest == requestID else { throw CancellationError() }
            guard fresh.serverId == profile.serverId else { throw AppError.serverChanged }
            try accept(fresh, profile: profile)
        } catch {
            if self.generation == generation { connectionVerified = false; notice = error.localizedDescription }
            throw error
        }
    }

    func enterDemo() {
        do {
            guard let url = Bundle.main.url(forResource: "demo-snapshot", withExtension: "json") else { throw AppError.message("The sample data could not be found.") }
            let demo = try Snapshot.decode(Data(contentsOf: url))
            generation = UUID(); isSyncing = false; snapshot = demo; isDemo = true
            connectionVerified = false; savedAt = nil; notice = nil
            selectedVehicleID = demo.vehicles.first?.id ?? ""
        } catch { notice = error.localizedDescription }
    }

    func leaveDemo() {
        generation = UUID(); isDemo = false; snapshot = nil; savedAt = nil; connectionVerified = false
        if let profile {
            do { if let saved = try cache?.load(profile) { snapshot = saved.snapshot; savedAt = saved.savedAt; selectedVehicleID = saved.snapshot.vehicles.first?.id ?? "" } }
            catch { notice = error.localizedDescription }
        }
    }

    func forget() throws {
        generation = UUID(); latestRequest = UUID(); isSyncing = false
        try CredentialStore.delete()
        try cache?.removeAll()
        clearExports()
        profile = nil; snapshot = nil; savedAt = nil; isDemo = false; connectionVerified = false; notice = nil
        selectedVehicleID = ""
    }

    func exportJSON() throws -> URL {
        guard let snapshot else { throw AppError.message("There is no saved history to export.") }
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try writeExport(encoder.encode(snapshot), name: isDemo ? "QuagoEV-sample-history.json" : "QuagoEV-history.json")
    }

    func exportCSV() throws -> URL {
        try writeExport(Data(Analytics.tripsCSV(trips).utf8), name: isDemo ? "QuagoEV-sample-drives.csv" : "QuagoEV-drives.csv")
    }

    private var exportsDirectory: URL { FileManager.default.temporaryDirectory.appendingPathComponent("QuagoEV-Exports", isDirectory: true) }
    private func writeExport(_ data: Data, name: String) throws -> URL {
        try FileManager.default.createDirectory(at: exportsDirectory, withIntermediateDirectories: true)
        let url = exportsDirectory.appendingPathComponent(name)
        try data.write(to: url, options: .atomic)
        return url
    }
    private func clearExports() { try? FileManager.default.removeItem(at: exportsDirectory) }
}

enum HistoryPeriod: String, CaseIterable, Identifiable {
    case week = "7 days", month = "30 days", quarter = "90 days", all = "All time"
    var id: String { rawValue }
    func contains(_ date: Date, now: Date, timeZone: TimeZone) -> Bool {
        guard self != .all else { return true }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = timeZone
        let days = self == .week ? 7 : self == .month ? 30 : 90
        let start = calendar.date(byAdding: .day, value: -(days - 1), to: calendar.startOfDay(for: now))!
        return date >= start && date <= now
    }
}
