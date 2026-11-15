import SwiftUI

@main
struct QuagoEVApp: App {
    @StateObject private var store = AppStore()
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(store).tint(Color.evAccent)
                .task { await store.sync() }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { Task { await store.sync() } }
                }
        }
    }
}
