import Foundation

public struct CachedSnapshot: Codable {
    public var savedAt: Date
    public var serverURL: String
    public var snapshot: Snapshot
}

public final class CacheStore {
    public let directory: URL
    public init(directory: URL? = nil) throws {
        self.directory = try directory ?? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("QuagoEV/Snapshots", isDirectory: true)
        try FileManager.default.createDirectory(at: self.directory, withIntermediateDirectories: true)
        var mutableURL = self.directory
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try? mutableURL.setResourceValues(values)
    }
    private func location(_ profile: ServerProfile) -> URL { directory.appendingPathComponent(profile.cacheID + ".json") }
    public func load(_ profile: ServerProfile) throws -> CachedSnapshot? {
        let url = location(profile)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let data = try Data(contentsOf: url)
        let cached = try JSONDecoder().decode(CachedSnapshot.self, from: data)
        guard cached.serverURL == profile.url, cached.snapshot.serverId == profile.serverId else { throw AppError.serverChanged }
        _ = try Snapshot.decode(JSONEncoder().encode(cached.snapshot))
        return cached
    }
    public func save(_ snapshot: Snapshot, profile: ServerProfile) throws -> Date {
        guard snapshot.serverId == profile.serverId else { throw AppError.serverChanged }
        let savedAt = Date()
        let data = try JSONEncoder().encode(CachedSnapshot(savedAt: savedAt, serverURL: profile.url, snapshot: snapshot))
        try data.write(to: location(profile), options: .atomic)
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: location(profile).path)
        #endif
        return savedAt
    }
    public func remove(_ profile: ServerProfile) throws {
        let url = location(profile)
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
    }
    public func removeAll() throws {
        for url in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) { try FileManager.default.removeItem(at: url) }
    }
}
