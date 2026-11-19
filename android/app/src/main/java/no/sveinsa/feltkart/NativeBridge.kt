package no.sveinsa.feltkart

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import android.util.Base64
import android.view.WindowManager
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Broen mellom webappen (src/lib/field/native.ts) og Android.
 * JavaScript kaller `FeltkartNative.call(metode, json, id)`. Svar går tilbake via `window.__fkResult(id, ok, json)`,
 * og hendelser (NMEA-data, Bluetooth-status) via `window.__fkEvent(navn, json)`.
 */
class NativeBridge(private val act: MainActivity) {
    private val io = Executors.newCachedThreadPool()
    private val bt = BtGnss { name, data -> event(name, data) }
    private val loc = LocGnss(act) { name, data -> event(name, data) }

    @JavascriptInterface
    fun call(method: String, args: String, id: Int) {
        io.execute {
            try {
                dispatch(method, JSONObject(if (args.isBlank()) "{}" else args), id)
            } catch (e: Throwable) {
                fail(id, e.message ?: e.toString())
            }
        }
    }

    fun shutdown() {
        bt.disconnect()
        loc.stop()
        io.shutdownNow()
    }

    private fun dispatch(method: String, a: JSONObject, id: Int) {
        when (method) {
            "btList" -> withBtPermission(id) { ok(id, listBonded().toString()) }
            "btConnect" -> withBtPermission(id) {
                val adapter = act.getSystemService(BluetoothManager::class.java)?.adapter
                    ?: throw IllegalStateException("Enheten har ikke Bluetooth")
                if (!adapter.isEnabled) throw IllegalStateException("Bluetooth er slått av. Slå det på og prøv igjen.")
                bt.connect(adapter, adapter.getRemoteDevice(a.getString("address")))
                ok(id)
            }
            "btDisconnect" -> { bt.disconnect(); ok(id) }
            "locStart" -> act.requestPerms(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) { r ->
                if (r[Manifest.permission.ACCESS_FINE_LOCATION] == true) {
                    try { loc.start(); ok(id) } catch (e: Throwable) { fail(id, e.message ?: e.toString()) }
                } else {
                    fail(id, "Feltkart mangler tillatelsen «Nøyaktig posisjon». Gi den under Felt → Oppsett → Åpne Android-innstillinger for appen.")
                }
            }
            "locStop" -> { loc.stop(); ok(id) }
            "takePhoto" -> act.launchCamera { f ->
                if (f == null) ok(id, "null")
                else ok(id, JSONObject().put("url", "https://${MainActivity.HOST}/capture/${f.name}").put("name", f.name).toString())
            }
            "saveFile" -> ok(id, saveFile(a.getString("name"), a.optString("mime", "application/octet-stream"), a.getString("base64")))
            "googleToken" -> GoogleAuth.getToken(act, a.getString("clientId"), a.getString("scope"), a.optBoolean("force", false)) { r ->
                r.onSuccess { (token, seconds) -> ok(id, JSONObject().put("accessToken", token).put("expiresIn", seconds).toString()) }
                    .onFailure { fail(id, it.message ?: "Innlogging feilet") }
            }
            "googleSignOut" -> { GoogleAuth.signOut(act); ok(id) }
            "keepAwake" -> {
                val on = a.optBoolean("on", false)
                act.runOnUiThread {
                    if (on) act.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    else act.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }
                ok(id)
            }
            "openAppSettings" -> {
                act.runOnUiThread {
                    act.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${act.packageName}")))
                }
                ok(id)
            }
            "info" -> ok(id, JSONObject().put("sdk", Build.VERSION.SDK_INT).put("model", Build.MODEL).toString())
            else -> fail(id, "Ukjent metode: $method")
        }
    }

    /** Android 12+ krever tillatelsen «Enheter i nærheten» (BLUETOOTH_CONNECT) før parkoblede enheter kan leses eller brukes */
    private fun withBtPermission(id: Int, body: () -> Unit) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) { runGuarded(id, body); return }
        act.requestPerms(arrayOf(Manifest.permission.BLUETOOTH_CONNECT)) { r ->
            if (r.values.all { it }) io.execute { runGuarded(id, body) }
            else fail(id, "Feltkart mangler tillatelsen «Enheter i nærheten» (Bluetooth). Gi den under Felt → Oppsett → Åpne Android-innstillinger for appen.")
        }
    }

    private fun runGuarded(id: Int, body: () -> Unit) {
        try { body() } catch (e: Throwable) { fail(id, e.message ?: e.toString()) }
    }

    @SuppressLint("MissingPermission")
    private fun listBonded(): JSONArray {
        val arr = JSONArray()
        val adapter = act.getSystemService(BluetoothManager::class.java)?.adapter ?: throw IllegalStateException("Enheten har ikke Bluetooth")
        if (!adapter.isEnabled) throw IllegalStateException("Bluetooth er slått av. Slå det på og prøv igjen.")
        adapter.bondedDevices.sortedBy { it.name ?: "" }.forEach { arr.put(JSONObject().put("name", it.name ?: it.address).put("address", it.address)) }
        return arr
    }

    /** Lagrer i Nedlastinger/Feltkart (Android 10+ trenger ingen tillatelse) */
    private fun saveFile(name: String, mime: String, b64: String): String {
        val bytes = Base64.decode(b64, Base64.DEFAULT)
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.MIME_TYPE, mime)
            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Feltkart")
        }
        val uri = act.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IllegalStateException("Kunne ikke opprette filen i Nedlastinger")
        act.contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: throw IllegalStateException("Kunne ikke skrive filen")
        return JSONObject().put("where", "Nedlastinger/Feltkart").toString()
    }

    private fun ok(id: Int, json: String = "{}") = js("window.__fkResult($id,true,${JSONObject.quote(json)})")
    private fun fail(id: Int, msg: String) = js("window.__fkResult($id,false,${JSONObject.quote(JSONObject.quote(msg))})")
    private fun event(name: String, data: JSONObject) = js("window.__fkEvent(${JSONObject.quote(name)},${JSONObject.quote(data.toString())})")
    private fun js(code: String) = act.runOnUiThread { act.webView.evaluateJavascript(code, null) }
}
