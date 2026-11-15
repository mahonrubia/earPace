package expo.modules.garminlink

import com.garmin.android.connectiq.ConnectIQ
import com.garmin.android.connectiq.IQApp
import com.garmin.android.connectiq.IQDevice
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject

/**
 * Puente con el reloj Garmin a través de Garmin Connect Mobile (Connect IQ Mobile SDK).
 * Los mensajes viajan como JSON en texto para no depender de conversiones de tipos del puente.
 */
class GarminLinkModule : Module() {
  private var ciq: ConnectIQ? = null
  private var ready = false
  private var device: IQDevice? = null
  private var app: IQApp? = null

  override fun definition() = ModuleDefinition {
    Name("GarminLink")

    Events("onMessage", "onDeviceStatus", "onSdkStatus")

    AsyncFunction("initialize") { promise: Promise ->
      val context = appContext.reactContext?.applicationContext
      if (context == null) {
        promise.reject(CodedException("ERR_NO_CONTEXT", "No hay contexto de aplicación", null))
        return@AsyncFunction
      }
      if (ready) {
        promise.resolve(true)
        return@AsyncFunction
      }
      val sdk = ConnectIQ.getInstance(context, ConnectIQ.IQConnectType.WIRELESS)
      ciq = sdk
      // autoUI = false: si falta Garmin Connect se informa a JS en vez de abrir un diálogo sin Activity.
      sdk.initialize(context, false, object : ConnectIQ.ConnectIQListener {
        override fun onSdkReady() {
          ready = true
          sendEvent("onSdkStatus", mapOf("status" to "ready"))
          promise.resolve(true)
        }

        override fun onInitializeError(status: ConnectIQ.IQSdkErrorStatus) {
          ready = false
          sendEvent("onSdkStatus", mapOf("status" to "error", "error" to status.name))
          promise.reject(CodedException("ERR_CIQ_INIT", "Connect IQ no disponible: ${status.name}", null))
        }

        override fun onSdkShutDown() {
          ready = false
          sendEvent("onSdkStatus", mapOf("status" to "shutdown"))
        }
      })
    }

    AsyncFunction("getDevices") {
      val sdk = requireSdk()
      val connected = try { sdk.connectedDevices?.map { it.deviceIdentifier }?.toSet() ?: emptySet() } catch (e: Exception) { emptySet() }
      (sdk.knownDevices ?: emptyList()).map {
        mapOf(
          "id" to it.deviceIdentifier.toString(),
          "name" to (it.friendlyName ?: "Garmin"),
          "connected" to connected.contains(it.deviceIdentifier)
        )
      }
    }

    AsyncFunction("connect") { deviceId: String, deviceName: String, appId: String ->
      val sdk = requireSdk()
      device?.let { runCatching { sdk.unregisterForEvents(it) } }
      val dev = IQDevice(deviceId.toLong(), deviceName)
      val iqApp = IQApp(appId)
      device = dev
      app = iqApp
      sdk.registerForDeviceEvents(dev) { d, status ->
        sendEvent("onDeviceStatus", mapOf("id" to d.deviceIdentifier.toString(), "status" to status.name))
      }
      sdk.registerForAppEvents(dev, iqApp) { _, _, messages, status ->
        if (status == ConnectIQ.IQMessageStatus.SUCCESS) {
          for (m in messages) {
            sendEvent("onMessage", mapOf("json" to toJson(m).toString()))
          }
        }
      }
      runCatching { sdk.getDeviceStatus(dev).name }.getOrDefault("UNKNOWN")
    }

    AsyncFunction("send") { json: String, promise: Promise ->
      val sdk = ciq
      val dev = device
      val iqApp = app
      if (sdk == null || !ready || dev == null || iqApp == null) {
        promise.resolve("NOT_CONNECTED")
        return@AsyncFunction
      }
      try {
        sdk.sendMessage(dev, iqApp, fromJson(JSONObject(json))) { _, _, status ->
          promise.resolve(status.name)
        }
      } catch (e: Exception) {
        promise.resolve("ERROR")
      }
    }

    AsyncFunction("openApp") { promise: Promise ->
      val sdk = ciq
      val dev = device
      val iqApp = app
      if (sdk == null || !ready || dev == null || iqApp == null) {
        promise.resolve("NOT_CONNECTED")
        return@AsyncFunction
      }
      try {
        sdk.openApplication(dev, iqApp) { _, _, status -> promise.resolve(status.name) }
      } catch (e: Exception) {
        promise.resolve("ERROR")
      }
    }

    AsyncFunction("openStore") { appId: String ->
      requireSdk().openStore(appId)
    }

    OnDestroy {
      val context = appContext.reactContext?.applicationContext
      if (ready && context != null) {
        runCatching { ciq?.unregisterAllForEvents() }
        runCatching { ciq?.shutdown(context) }
      }
      ready = false
    }
  }

  private fun requireSdk(): ConnectIQ {
    val sdk = ciq
    if (sdk == null || !ready) throw CodedException("ERR_CIQ_NOT_READY", "Connect IQ no está inicializado", null)
    return sdk
  }

  private fun toJson(value: Any?): Any = when (value) {
    null -> JSONObject.NULL
    is Map<*, *> -> JSONObject().also { o -> value.forEach { (k, v) -> o.put(k.toString(), toJson(v)) } }
    is List<*> -> JSONArray().also { a -> value.forEach { a.put(toJson(it)) } }
    else -> value
  }

  private fun fromJson(value: Any?): Any? = when (value) {
    null, JSONObject.NULL -> null
    is JSONObject -> HashMap<String, Any?>().also { m -> value.keys().forEach { k -> m[k] = fromJson(value.get(k)) } }
    is JSONArray -> ArrayList<Any?>().also { l -> for (i in 0 until value.length()) l.add(fromJson(value.get(i))) }
    else -> value
  }
}
