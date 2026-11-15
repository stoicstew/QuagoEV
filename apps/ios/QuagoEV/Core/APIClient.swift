import Foundation
import CryptoKit

public struct ServerProfile: Codable, Equatable {
    public var url: String
    public var token: String
    public var serverId: String

    public init(url: String, token: String, serverId: String) {
        self.url = url; self.token = token; self.serverId = serverId
    }
    public var cacheID: String {
        SHA256.hash(data: Data((url + "\n" + token).utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

public final class APIClient: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    public static func serverURL(_ value: String) throws -> URL {
        guard var parts = URLComponents(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
              let host = parts.host?.lowercased(), !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/",
              parts.scheme == "https" || (parts.scheme == "http" && ["localhost", "127.0.0.1", "[::1]", "::1"].contains(host)) else { throw AppError.invalidURL }
        parts.host = host
        parts.path = ""
        guard let url = parts.url else { throw AppError.invalidURL }
        return url
    }

    public func snapshot(url: URL, token: String) async throws -> Snapshot {
        try await request(url: url, token: token, path: "api/v2/snapshot")
    }

    public func request(url: URL, token: String, path: String, method: String = "GET", body: Data? = nil) async throws -> Snapshot {
        let session = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        var request = URLRequest(url: url.appendingPathComponent(path))
        request.httpMethod = method
        request.timeoutInterval = 20
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body { request.httpBody = body; request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw AppError.invalidSnapshot }
        if response.statusCode == 401 || response.statusCode == 403 { throw AppError.unauthorized }
        guard response.statusCode == 200 else { throw AppError.server(response.statusCode) }
        guard data.count < 50 * 1024 * 1024 else { throw AppError.invalidSnapshot }
        return try Snapshot.decode(data)
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        // Never send the access key to a redirected host or downgraded URL.
        completionHandler(nil)
    }
}
