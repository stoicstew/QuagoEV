import XCTest
@testable import QuagoEVCore

final class CoreTests: XCTestCase {
    private func fixture() throws -> Data { try Data(contentsOf: XCTUnwrap(Bundle.module.url(forResource: "demo-snapshot", withExtension: "json", subdirectory: "Fixtures"))) }

    func testContractDecodesMillisecondsAndUnknownValues() throws {
        let snapshot = try Snapshot.decode(fixture())
        XCTAssertEqual(snapshot.schemaVersion, 2)
        XCTAssertEqual(snapshot.vehicles.first?.latest?.batteryLevel, 72)
        XCTAssertNil(snapshot.settings.batteryCapacityKwh)
        XCTAssertNil(snapshot.idles.first?.energyKwh)
        XCTAssertEqual(snapshot.trips.first?.date.timeIntervalSince1970, (snapshot.trips.first?.startTime ?? 0) / 1000)
        XCTAssertEqual(snapshot.timeZone.identifier, "Australia/Melbourne")
    }

    func testRejectsWrongVersionAndDuplicateRecords() throws {
        var snapshot = try Snapshot.decode(fixture())
        snapshot.schemaVersion = 1
        XCTAssertThrowsError(try Snapshot.decode(JSONEncoder().encode(snapshot)))
        snapshot.schemaVersion = 2
        snapshot.trips.append(snapshot.trips[0])
        XCTAssertThrowsError(try Snapshot.decode(JSONEncoder().encode(snapshot)))
    }

    func testEfficiencyWeightsByDistanceAndExcludesUnknownEnergy() throws {
        var trips = try Snapshot.decode(fixture()).trips
        trips = Array(trips.prefix(3))
        trips[0].distanceKm = 10; trips[0].energyKwh = 1
        trips[1].distanceKm = 90; trips[1].energyKwh = 18
        trips[2].distanceKm = 500; trips[2].energyKwh = nil
        XCTAssertEqual(Analytics.efficiency(trips), 190)
        XCTAssertNil(Analytics.efficiency([]))
        XCTAssertNil(Analytics.knownSum([nil, nil]))
        XCTAssertEqual(Analytics.knownSum([0, nil]), 0)
    }

    func testCSVQuotesNewlinesAndNeutralisesFormulaCells() throws {
        var trip = try XCTUnwrap(Snapshot.decode(fixture()).trips.first)
        trip.notes = "=HYPERLINK(\"x\")\nline, two"
        let csv = Analytics.tripsCSV([trip])
        XCTAssertTrue(csv.contains("\"'=HYPERLINK(\"\"x\"\")\nline, two\""))
        XCTAssertTrue(csv.contains("Start UTC"))
        XCTAssertTrue(csv.contains("Z"))
    }

    func testPartialChargesDecodeAndMissingFlagDefaultsToFalse() throws {
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: fixture()) as? [String: Any])
        var charges = try XCTUnwrap(object["charges"] as? [[String: Any]])
        charges[0]["incomplete"] = true
        charges[0]["ratePerKwh"] = NSNull()
        charges[1].removeValue(forKey: "incomplete")
        object["charges"] = charges
        let snapshot = try Snapshot.decode(JSONSerialization.data(withJSONObject: object))
        XCTAssertTrue(snapshot.charges[0].incomplete)
        XCTAssertFalse(snapshot.charges[1].incomplete)
        XCTAssertNil(snapshot.charges[0].ratePerKwh, "An inherited tariff must remain nil, not become a session override")
    }

    func testCompleteDriveEfficiencyOmitsPartialRecordings() throws {
        var trips = Array(try Snapshot.decode(fixture()).trips.prefix(2))
        trips[0].distanceKm = 10; trips[0].energyKwh = 1; trips[0].incomplete = false
        trips[1].distanceKm = 90; trips[1].energyKwh = 90; trips[1].incomplete = true
        XCTAssertEqual(Analytics.efficiency(trips), 100)
    }

    func testRemoteHTTPAndCredentialURLsAreRejected() throws {
        for value in ["http://server.ts.net", "https://user:password@server.ts.net", "https://server.ts.net?token=x", "https://server.ts.net/path", "ftp://localhost", "https://server.ts.net#fragment"] {
            XCTAssertThrowsError(try APIClient.serverURL(value), value)
        }
        XCTAssertEqual(try APIClient.serverURL(" https://SERVER.ts.net/ ").absoluteString, "https://server.ts.net")
        XCTAssertNoThrow(try APIClient.serverURL("http://127.0.0.1:3001"))
        XCTAssertNoThrow(try APIClient.serverURL("http://localhost:3001"))
    }

    func testCacheSurvivesRelaunchAndIsSeparatedByCredentials() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let snapshot = try Snapshot.decode(fixture())
        let profile = ServerProfile(url: "https://one.ts.net", token: "secret", serverId: snapshot.serverId)
        let cache = try CacheStore(directory: directory)
        _ = try cache.save(snapshot, profile: profile)
        XCTAssertEqual(try CacheStore(directory: directory).load(profile)?.snapshot, snapshot)
        XCTAssertNil(try cache.load(ServerProfile(url: profile.url, token: "different", serverId: snapshot.serverId)))
        XCTAssertNil(try cache.load(ServerProfile(url: "https://two.ts.net", token: profile.token, serverId: snapshot.serverId)))
        XCTAssertThrowsError(try cache.load(ServerProfile(url: profile.url, token: profile.token, serverId: "different-server")))
        try cache.removeAll()
        XCTAssertNil(try cache.load(profile))
    }

    func testEmptyAuthoritativeSnapshotReplacesOldHistory() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        var snapshot = try Snapshot.decode(fixture())
        let profile = ServerProfile(url: "https://one.ts.net", token: "secret", serverId: snapshot.serverId)
        let cache = try CacheStore(directory: directory)
        _ = try cache.save(snapshot, profile: profile)
        snapshot.trips = []; snapshot.charges = []; snapshot.revision += 1
        _ = try cache.save(snapshot, profile: profile)
        XCTAssertEqual(try cache.load(profile)?.snapshot.trips.count, 0)
        XCTAssertEqual(try cache.load(profile)?.snapshot.revision, snapshot.revision)
    }

    func testOtherServerCannotOverwriteCache() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        var snapshot = try Snapshot.decode(fixture())
        let profile = ServerProfile(url: "https://one.ts.net", token: "secret", serverId: snapshot.serverId)
        let cache = try CacheStore(directory: directory)
        _ = try cache.save(snapshot, profile: profile)
        snapshot.serverId = "unexpected"
        XCTAssertThrowsError(try cache.save(snapshot, profile: profile))
        XCTAssertEqual(try cache.load(profile)?.snapshot.serverId, profile.serverId)
    }
}
