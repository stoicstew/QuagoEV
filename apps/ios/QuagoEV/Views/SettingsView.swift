import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var server = ""
    @State private var token = ""
    @State private var rate = ""
    @State private var capacity = ""
    @State private var error: String?
    @State private var confirmation = false
    @State private var export: ShareFile?
    @State private var savedSettings = false
    var body: some View {
        NavigationStack {
            Form {
                if store.isDemo {
                    Section {
                        Label("Exploring sample data", systemImage: "sparkles")
                        Button("Leave sample data") { store.leaveDemo(); Task { await store.sync() } }
                    }
                }
                Section {
                    TextField("https://quagoev.your-tailnet.ts.net", text: $server).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityLabel("Server address")
                    SecureField("QuagoEV access key", text: $token).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityLabel("Server access key")
                    Button {
                        Task {
                            do { try await store.connect(server: server, token: token); error = nil; dismiss() }
                            catch { self.error = error.localizedDescription }
                        }
                    } label: {
                        HStack { Text(store.isSyncing ? "Connecting…" : "Connect and sync"); if store.isSyncing { Spacer(); ProgressView() } }
                    }.disabled(store.isSyncing || server.isEmpty || token.isEmpty)
                    if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                } header: { Text("Home server") } footer: {
                    Text("Use the private HTTPS address of your Windows server. Tailscale must be connected when accessing it remotely. The access key is stored in this iPhone’s Keychain.")
                }
                if let profile = store.profile {
                    Section("Saved connection") {
                        LabeledContent("Server", value: profile.url)
                        if let savedAt = store.savedAt { LabeledContent("Last sync", value: format(savedAt, timeZone: store.timeZone)) }
                        Text("Opening the app and pulling to refresh synchronize history. Collection continues on the Windows laptop while this app is closed.").font(.footnote).foregroundStyle(.secondary)
                    }
                }
                if store.snapshot != nil {
                    Section {
                        TextField("Home electricity rate (\(store.currency)/kWh)", text: $rate).keyboardType(.decimalPad)
                        TextField("Usable battery capacity (kWh, optional)", text: $capacity).keyboardType(.decimalPad)
                        Button(savedSettings ? "Preferences saved" : "Save preferences") {
                            Task {
                                do {
                                    let parsedRate = try optionalNumber(rate)
                                    let parsedCapacity = try optionalNumber(capacity)
                                    if let parsedCapacity, parsedCapacity <= 0 { throw AppError.invalidNumber }
                                    try await store.patch(path: "api/v2/settings", payload: ["homeRatePerKwh": parsedRate.map { $0 as Any } ?? NSNull(), "batteryCapacityKwh": parsedCapacity.map { $0 as Any } ?? NSNull()])
                                    savedSettings = true; error = nil
                                } catch { self.error = error.localizedDescription }
                            }
                        }.disabled(!store.canEdit)
                            .onChange(of: rate) { _, _ in savedSettings = false }.onChange(of: capacity) { _, _ in savedSettings = false }
                    } header: { Text("Energy estimates") } footer: {
                        Text("Leave unknown values blank. Capacity is used only for estimates. These preferences are shared with your other devices. \(store.canEdit ? "" : "Reconnect to edit; sample data is read-only.")")
                    }
                    Section("Your data") {
                        Button("Share saved history (JSON)", systemImage: "square.and.arrow.up") {
                            do { export = ShareFile(url: try store.exportJSON()) } catch { self.error = error.localizedDescription }
                        }
                        Button("Share selected drives (CSV)", systemImage: "tablecells") {
                            do { export = ShareFile(url: try store.exportCSV()) } catch { self.error = error.localizedDescription }
                        }.disabled(store.trips.isEmpty)
                        Text("Exports contain vehicle history and may contain precise locations. Server keys and Tesla credentials are excluded.").font(.footnote).foregroundStyle(.secondary)
                    }
                }
                Section {
                    Button("Explore sample data") { store.enterDemo(); dismiss() }
                    if store.profile != nil {
                        Button("Forget server and saved history", role: .destructive) { confirmation = true }
                    }
                }
                Section {
                    Text("QuagoEV · Tesla data and analytics").font(.footnote)
                    Text("Data only. This app does not operate your vehicle.").font(.footnote).foregroundStyle(.secondary)
                }
            }.navigationTitle("Settings").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
                .onAppear {
                    server = store.profile?.url ?? ""
                    token = store.profile?.token ?? ""
                    rate = store.snapshot?.settings.homeRatePerKwh.map(String.init(describing:)) ?? ""
                    capacity = store.snapshot?.settings.batteryCapacityKwh.map(String.init(describing:)) ?? ""
                }
                .confirmationDialog("Remove this server’s key and all saved history from this iPhone?", isPresented: $confirmation, titleVisibility: .visible) {
                    Button("Forget connection", role: .destructive) {
                        do { try store.forget(); token = ""; server = ""; dismiss() } catch { self.error = error.localizedDescription }
                    }
                } message: { Text("History stored on the Windows server is unaffected.") }
                .sheet(item: $export) { ShareSheet(items: [$0.url]) }
        }
    }
}
