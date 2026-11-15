import XCTest

@MainActor
final class QuagoEVUITests: XCTestCase {
    func testServerSyncAndOfflineRelaunch() async throws {
        let base = URL(string: "http://127.0.0.1:38417")!
        var probe = URLRequest(url: base.appendingPathComponent("healthz")); probe.timeoutInterval = 2
        do { _ = try await URLSession.shared.data(for: probe) }
        catch { throw XCTSkip("Run scripts/fixture_server.py to exercise native server synchronization.") }
        func mode(_ mode: String) async throws {
            var request = URLRequest(url: base.appendingPathComponent("__mode/" + mode)); request.httpMethod = "POST"
            _ = try await URLSession.shared.data(for: request)
        }
        try await mode("online")
        let app = XCUIApplication()
        app.launchArguments = ["--reset-test-profile"]
        app.launch()
        app.buttons["Connect to home server"].tap()
        let address = app.textFields["Server address"]
        XCTAssertTrue(address.waitForExistence(timeout: 5))
        address.tap(); address.typeText(base.absoluteString)
        let key = app.secureTextFields["Server access key"]
        key.tap(); key.typeText("native-test-access-key")
        app.buttons["Connect and sync"].tap()
        XCTAssertTrue(app.staticTexts["History synchronized"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Native fixture vehicle"].exists)
        try await mode("offline")
        app.terminate()
        app.launchArguments = []
        app.launch()
        XCTAssertTrue(app.staticTexts["Saved history"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "HTTP 503")).firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Native fixture vehicle"].exists)
        app.tabBars.buttons["Drives"].tap()
        XCTAssertTrue(app.buttons["Export"].exists)
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "Offline native history"; attachment.lifetime = .keepAlways; add(attachment)
        app.terminate()
        app.launchArguments = ["--reset-test-profile"]
        app.launch()
        XCTAssertTrue(app.buttons["Connect to home server"].waitForExistence(timeout: 5))
        try await mode("online")
    }

    func testSampleNavigationAndNativeDetails() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--demo"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Sample data · no vehicle connected"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Drives"].tap()
        XCTAssertTrue(app.navigationBars["Drives"].exists)
        XCTAssertTrue(app.buttons["Export"].exists)
        let firstDrive = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "km")).firstMatch
        if firstDrive.waitForExistence(timeout: 3) { firstDrive.tap() }
        app.tabBars.buttons["Charging"].tap()
        XCTAssertTrue(app.navigationBars["Charging"].exists)
        app.tabBars.buttons["Battery"].tap()
        XCTAssertTrue(app.staticTexts["Estimated range trend"].waitForExistence(timeout: 3))
        app.tabBars.buttons["Insights"].tap()
        XCTAssertTrue(app.navigationBars["Insights"].exists)
        app.buttons["Settings"].tap()
        XCTAssertTrue(app.textFields["Server address"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.secureTextFields["Server access key"].exists)
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "Native settings"; attachment.lifetime = .keepAlways; add(attachment)
    }
}
