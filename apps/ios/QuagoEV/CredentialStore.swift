import Foundation
import Security

enum CredentialStore {
    private static let service = "com.quagoev.ios.server"
    private static var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "active-profile"] }

    static func load() throws -> ServerProfile? {
        var query = query
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw AppError.message("The saved server credentials could not be read from Keychain.") }
        return try JSONDecoder().decode(ServerProfile.self, from: data)
    }

    static func save(_ profile: ServerProfile) throws {
        let data = try JSONEncoder().encode(profile)
        let update = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly] as [String: Any]
        let status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var insertion = query; update.forEach { insertion[$0.key] = $0.value }
            guard SecItemAdd(insertion as CFDictionary, nil) == errSecSuccess else { throw AppError.message("The server key could not be saved securely.") }
        } else if status != errSecSuccess { throw AppError.message("The server key could not be updated securely.") }
    }

    static func delete() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw AppError.message("The saved server key could not be removed.") }
    }
}
