// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "QuagoEVCore",
    platforms: [.macOS(.v13), .iOS(.v17)],
    products: [.library(name: "QuagoEVCore", targets: ["QuagoEVCore"])],
    targets: [
        .target(name: "QuagoEVCore", path: "QuagoEV/Core"),
        .testTarget(name: "QuagoEVCoreTests", dependencies: ["QuagoEVCore"], path: "Tests", resources: [.copy("Fixtures")])
    ]
)
