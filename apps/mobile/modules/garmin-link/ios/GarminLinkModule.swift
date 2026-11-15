import ConnectIQ
import ExpoModulesCore

/// Puente con el reloj Garmin a través de Garmin Connect Mobile (Connect IQ Mobile SDK para iOS).
/// En iOS la lista de relojes se obtiene abriendo Garmin Connect (`showDeviceSelection`), que
/// devuelve el control a la app mediante su esquema de URL.
public final class GarminLinkModule: Module {
  static let urlScheme = "pinganillo"
  static weak var shared: GarminLinkModule?

  private var initialized = false
  private var devices: [IQDevice] = []
  private var device: IQDevice?
  private var app: IQApp?
  private lazy var delegate = GarminLinkDelegate(module: self)
  private let storeKey = "GarminLink.devices"

  public func definition() -> ModuleDefinition {
    Name("GarminLink")

    Events("onMessage", "onDeviceStatus", "onSdkStatus")

    OnCreate {
      GarminLinkModule.shared = self
    }

    AsyncFunction("initialize") { () -> Bool in
      if !self.initialized {
        ConnectIQ.sharedInstance().initialize(withUrlScheme: GarminLinkModule.urlScheme, uiOverrideDelegate: nil)
        self.initialized = true
        self.devices = self.loadDevices()
        self.sendEvent("onSdkStatus", ["status": "ready"])
      }
      return true
    }.runOnQueue(.main)

    AsyncFunction("getDevices") { () -> [[String: Any]] in
      self.devices.map { d in
        ["id": d.uuid.uuidString, "name": d.friendlyName ?? d.modelName ?? "Garmin",
         "connected": ConnectIQ.sharedInstance().getDeviceStatus(d) == .connected]
      }
    }.runOnQueue(.main)

    /// Abre Garmin Connect para que el usuario elija el reloj (solo iOS).
    AsyncFunction("pickDevice") {
      ConnectIQ.sharedInstance().showDeviceSelection()
    }.runOnQueue(.main)

    AsyncFunction("connect") { (deviceId: String, _: String, appId: String) -> String in
      guard let dev = self.devices.first(where: { $0.uuid.uuidString == deviceId }),
            let uuid = UUID(uuidString: GarminLinkModule.dashed(appId)) else {
        return "UNKNOWN"
      }
      let ciq = ConnectIQ.sharedInstance()!
      ciq.unregister(forAllDeviceEvents: self.delegate)
      ciq.unregister(forAllAppMessages: self.delegate)
      let iqApp = IQApp(uuid: uuid, store: nil, device: dev)
      self.device = dev
      self.app = iqApp
      ciq.register(forDeviceEvents: dev, delegate: self.delegate)
      ciq.register(forAppMessages: iqApp, delegate: self.delegate)
      return GarminLinkModule.name(of: ciq.getDeviceStatus(dev))
    }.runOnQueue(.main)

    AsyncFunction("send") { (json: String, promise: Promise) in
      guard let iqApp = self.app,
            let data = json.data(using: .utf8),
            let message = try? JSONSerialization.jsonObject(with: data) else {
        promise.resolve("NOT_CONNECTED")
        return
      }
      ConnectIQ.sharedInstance().sendMessage(message, to: iqApp, progress: nil) { result in
        promise.resolve(result == .success ? "SUCCESS" : "FAILURE")
      }
    }.runOnQueue(.main)

    AsyncFunction("openApp") { (promise: Promise) in
      guard let iqApp = self.app else {
        promise.resolve("NOT_CONNECTED")
        return
      }
      ConnectIQ.sharedInstance().openAppRequest(iqApp) { result in
        promise.resolve(result == .success ? "SUCCESS" : "FAILURE")
      }
    }.runOnQueue(.main)

    AsyncFunction("openStore") { (appId: String) -> Bool in
      guard let dev = self.device ?? self.devices.first,
            let uuid = UUID(uuidString: GarminLinkModule.dashed(appId)) else { return false }
      ConnectIQ.sharedInstance().showStore(for: IQApp(uuid: uuid, store: uuid, device: dev))
      return true
    }.runOnQueue(.main)
  }

  /// Garmin Connect devuelve aquí los relojes elegidos por el usuario.
  func handleOpen(url: URL) -> Bool {
    guard url.scheme == GarminLinkModule.urlScheme,
          let found = ConnectIQ.sharedInstance().parseDeviceSelectionResponse(from: url) as? [IQDevice],
          !found.isEmpty else {
      return false
    }
    devices = found
    saveDevices()
    sendEvent("onSdkStatus", ["status": "devices"])
    return true
  }

  func emitMessage(_ message: Any) {
    let wrapped: Any = JSONSerialization.isValidJSONObject(message) ? message : ["v": message]
    if let data = try? JSONSerialization.data(withJSONObject: wrapped),
       let json = String(data: data, encoding: .utf8) {
      sendEvent("onMessage", ["json": json])
    }
  }

  func emitStatus(_ device: IQDevice, _ status: IQDeviceStatus) {
    sendEvent("onDeviceStatus", ["id": device.uuid.uuidString, "status": GarminLinkModule.name(of: status)])
  }

  static func name(of status: IQDeviceStatus) -> String {
    switch status {
    case .connected: return "CONNECTED"
    case .notConnected: return "NOT_CONNECTED"
    case .notFound: return "NOT_PAIRED"
    case .bluetoothNotReady: return "BLUETOOTH_OFF"
    case .invalidDevice: return "UNKNOWN"
    @unknown default: return "UNKNOWN"
    }
  }

  /// El manifest del reloj guarda el id sin guiones; UUID(uuidString:) los necesita.
  static func dashed(_ id: String) -> String {
    guard id.count == 32 else { return id }
    var s = id
    for offset in [8, 13, 18, 23] { s.insert("-", at: s.index(s.startIndex, offsetBy: offset)) }
    return s
  }

  private func saveDevices() {
    let list = devices.map { ["id": $0.uuid.uuidString, "model": $0.modelName ?? "", "name": $0.friendlyName ?? ""] }
    UserDefaults.standard.set(list, forKey: storeKey)
  }

  private func loadDevices() -> [IQDevice] {
    let list = UserDefaults.standard.array(forKey: storeKey) as? [[String: String]] ?? []
    return list.compactMap { d in
      guard let id = d["id"], let uuid = UUID(uuidString: id) else { return nil }
      return IQDevice(id: uuid, modelName: d["model"], friendlyName: d["name"])
    }
  }
}

final class GarminLinkDelegate: NSObject, IQDeviceEventDelegate, IQAppMessageDelegate {
  weak var module: GarminLinkModule?

  init(module: GarminLinkModule) {
    self.module = module
  }

  func deviceStatusChanged(_ device: IQDevice!, status: IQDeviceStatus) {
    module?.emitStatus(device, status)
  }

  func receivedMessage(_ message: Any!, from app: IQApp!) {
    if let message = message {
      module?.emitMessage(message)
    }
  }
}

/// Recibe la URL de vuelta desde Garmin Connect tras elegir reloj.
public class GarminLinkAppDelegate: ExpoAppDelegateSubscriber {
  public func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
    return GarminLinkModule.shared?.handleOpen(url: url) ?? false
  }
}
