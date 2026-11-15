import Foundation

public struct Snapshot: Codable, Equatable {
    public var schemaVersion: Int
    public var serverId: String
    public var revision: Int
    public var generatedAt: Double
    public var settings: AppSettings
    public var vehicles: [Vehicle]
    public var trips: [Trip]
    public var charges: [Charge]
    public var battery: [BatterySample]
    public var idles: [Idle]
    public var collector: Collector

    public static func decode(_ data: Data) throws -> Snapshot {
        let result = try JSONDecoder().decode(Snapshot.self, from: data)
        guard result.schemaVersion == 2, !result.serverId.isEmpty, result.revision >= 0,
              result.generatedAt.isFinite, result.generatedAt > 0,
              TimeZone(identifier: result.settings.timeZone) != nil,
              result.settings.distanceUnit == "km", result.settings.temperatureUnit == "C" else {
            throw AppError.invalidSnapshot
        }
        let collections = [result.vehicles.map(\.id), result.trips.map(\.id), result.charges.map(\.id), result.battery.map(\.id), result.idles.map(\.id)]
        guard collections.allSatisfy({ ids in ids.allSatisfy { !$0.isEmpty } && Set(ids).count == ids.count }) else { throw AppError.invalidSnapshot }
        guard result.trips.allSatisfy({ $0.startTime > 0 && $0.endTime >= $0.startTime && $0.distanceKm >= 0 }),
              result.charges.allSatisfy({ $0.startTime > 0 && $0.endTime >= $0.startTime }) else { throw AppError.invalidSnapshot }
        return result
    }

    public var timeZone: TimeZone { TimeZone(identifier: settings.timeZone) ?? TimeZone(secondsFromGMT: 0)! }
}

public struct AppSettings: Codable, Equatable {
    public var currency: String
    public var distanceUnit: String
    public var temperatureUnit: String
    public var timeZone: String
    public var homeRatePerKwh: Double?
    public var batteryCapacityKwh: Double?
}

public struct Vehicle: Codable, Identifiable, Equatable {
    public var id: String
    public var vin: String?
    public var name: String
    public var model: String?
    public var latest: VehicleObservation?
}

public struct VehicleObservation: Codable, Equatable {
    public var observedAt: Double
    public var state: String
    public var batteryLevel: Double?
    public var estimatedRangeKm: Double?
    public var odometerKm: Double?
    public var outsideTempC: Double?
    public var chargingState: String?
    public var chargerPowerKw: Double?
    public var latitude: Double?
    public var longitude: Double?
}

public struct RoutePoint: Codable, Equatable {
    public var lat: Double
    public var lng: Double
    public var timestamp: Double
}

public struct Trip: Codable, Identifiable, Equatable {
    public var id: String
    public var vehicleId: String
    public var startTime: Double
    public var endTime: Double
    public var distanceKm: Double
    public var energyKwh: Double?
    public var energySource: String
    public var startBattery: Double?
    public var endBattery: Double?
    public var route: [RoutePoint]
    public var tag: String
    public var notes: String
    public var incomplete: Bool

    public var date: Date { Date(milliseconds: startTime) }
    public var durationMinutes: Double { max(0, (endTime - startTime) / 60_000) }
    public var efficiency: Double? { energyKwh.flatMap { distanceKm > 0 ? $0 * 1000 / distanceKm : nil } }
    public var validRoute: [RoutePoint] { route.filter { (-90...90).contains($0.lat) && (-180...180).contains($0.lng) } }
}

public struct Charge: Codable, Identifiable, Equatable {
    public var id: String
    public var vehicleId: String
    public var startTime: Double
    public var endTime: Double
    public var energyKwh: Double?
    public var startBattery: Double?
    public var endBattery: Double?
    public var maxPowerKw: Double?
    public var locationName: String?
    public var locationType: String
    public var cost: Double?
    public var costSource: String
    public var ratePerKwh: Double?
    public var incomplete: Bool

    public var date: Date { Date(milliseconds: startTime) }

    private enum CodingKeys: String, CodingKey {
        case id, vehicleId, startTime, endTime, energyKwh, startBattery, endBattery, maxPowerKw
        case locationName, locationType, cost, costSource, ratePerKwh, incomplete
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        vehicleId = try values.decode(String.self, forKey: .vehicleId)
        startTime = try values.decode(Double.self, forKey: .startTime)
        endTime = try values.decode(Double.self, forKey: .endTime)
        energyKwh = try values.decodeIfPresent(Double.self, forKey: .energyKwh)
        startBattery = try values.decodeIfPresent(Double.self, forKey: .startBattery)
        endBattery = try values.decodeIfPresent(Double.self, forKey: .endBattery)
        maxPowerKw = try values.decodeIfPresent(Double.self, forKey: .maxPowerKw)
        locationName = try values.decodeIfPresent(String.self, forKey: .locationName)
        locationType = try values.decode(String.self, forKey: .locationType)
        cost = try values.decodeIfPresent(Double.self, forKey: .cost)
        costSource = try values.decode(String.self, forKey: .costSource)
        ratePerKwh = try values.decodeIfPresent(Double.self, forKey: .ratePerKwh)
        incomplete = try values.decodeIfPresent(Bool.self, forKey: .incomplete) ?? false
    }
}

public struct BatterySample: Codable, Identifiable, Equatable {
    public var id: String
    public var vehicleId: String
    public var timestamp: Double
    public var odometerKm: Double?
    public var batteryLevel: Double?
    public var fullRangeKm: Double?
    public var date: Date { Date(milliseconds: timestamp) }
}

public struct Idle: Codable, Identifiable, Equatable {
    public var id: String
    public var vehicleId: String
    public var startTime: Double
    public var endTime: Double
    public var energyKwh: Double?
    public var state: String
    public var incomplete: Bool
}

public struct Collector: Codable, Equatable {
    public var mode: String
    public var status: String
    public var lastReceivedAt: Double?
    public var message: String
    public var usage: Usage
}

public struct Usage: Codable, Equatable {
    public var month: String
    public var estimatedCostUsd: Double
    public var limitUsd: Double
    public var requests: Int
    public var signals: Int
}

public enum AppError: LocalizedError, Equatable {
    case invalidURL, invalidSnapshot, unauthorized, serverChanged, invalidNumber, server(Int), message(String)
    public var errorDescription: String? {
        switch self {
        case .invalidURL: return "Enter an HTTPS server address, such as https://quagoev.your-tailnet.ts.net. HTTP is allowed only for localhost development."
        case .invalidSnapshot: return "The server returned an unsupported or invalid data snapshot. Your saved history has been kept."
        case .unauthorized: return "The server access key was rejected. Your saved history remains available. Update the key in Settings."
        case .serverChanged: return "This address now identifies a different server. Forget this connection before pairing with the new server. Your saved history has been kept."
        case .invalidNumber: return "Enter a valid non-negative number, or leave the field empty for unknown."
        case .server(let status): return "The server returned HTTP \(status). Your saved history has been kept."
        case .message(let message): return message
        }
    }
}

public extension Date {
    init(milliseconds: Double) { self.init(timeIntervalSince1970: milliseconds / 1000) }
    var milliseconds: Double { timeIntervalSince1970 * 1000 }
}

public enum Analytics {
    public static func efficiency(_ trips: [Trip]) -> Double? {
        let eligible = trips.filter { !$0.incomplete && $0.energyKwh != nil && $0.distanceKm > 0 }
        let distance = eligible.reduce(0) { $0 + $1.distanceKm }
        guard distance > 0 else { return nil }
        return eligible.reduce(0) { $0 + ($1.energyKwh ?? 0) } * 1000 / distance
    }

    public static func knownSum(_ values: [Double?]) -> Double? {
        let known = values.compactMap { $0 }
        return known.isEmpty ? nil : known.reduce(0, +)
    }

    public static func csvField(_ value: String) -> String {
        // CSV fields remain strings; neutralise spreadsheet formula prefixes.
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let prefix = trimmed.first.map { "=+-@".contains($0) } ?? false
        let safe = prefix ? "'" + value : value
        return "\"" + safe.replacingOccurrences(of: "\"", with: "\"\"") + "\""
    }

    public static func tripsCSV(_ trips: [Trip]) -> String {
        let iso = ISO8601DateFormatter()
        var rows = ["ID,Vehicle,Start UTC,End UTC,Distance km,Energy kWh,Energy source,Tag,Notes,Incomplete"]
        rows += trips.map { trip in
            [trip.id, trip.vehicleId, iso.string(from: trip.date), iso.string(from: Date(milliseconds: trip.endTime)), String(trip.distanceKm), trip.energyKwh.map(String.init(describing:)) ?? "", trip.energySource, trip.tag, trip.notes, String(trip.incomplete)].map(csvField).joined(separator: ",")
        }
        return rows.joined(separator: "\r\n") + "\r\n"
    }
}
