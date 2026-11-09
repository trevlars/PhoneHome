// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "PhonehomeCallkit",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "PhonehomeCallkit",
            targets: ["PhoneHomeCallKitPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(url: "https://github.com/stasel/WebRTC.git", exact: "153.0.0")
    ],
    targets: [
        .target(
            name: "PhoneHomeCallKitPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "WebRTC", package: "WebRTC")
            ],
            path: "ios/Sources/PhoneHomeCallKitPlugin"),
        .testTarget(
            name: "PhoneHomeCallKitPluginTests",
            dependencies: ["PhoneHomeCallKitPlugin"],
            path: "ios/Tests/PhoneHomeCallKitPluginTests")
    ]
)