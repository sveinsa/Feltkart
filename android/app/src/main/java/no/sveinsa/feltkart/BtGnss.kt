package no.sveinsa.feltkart

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import org.json.JSONObject
import java.io.IOException
import java.util.UUID

/**
 * Leser NMEA fra en parkoblet GNSS-mottaker over klassisk Bluetooth (seriell profil, SPP) og sender teksten videre til webappen.
 * Tolkingen (GGA, GST …) skjer i webappen (src/lib/field/nmea.ts). Kobler til på nytt hvis forbindelsen brytes.
 */
@SuppressLint("MissingPermission")
class BtGnss(private val emit: (String, JSONObject) -> Unit) {
    @Volatile private var running = false
    @Volatile private var socket: BluetoothSocket? = null
    private var thread: Thread? = null

    fun connect(adapter: BluetoothAdapter, device: BluetoothDevice) {
        disconnect()
        running = true
        val t = Thread { loop(adapter, device) }
        t.isDaemon = true
        thread = t
        t.start()
    }

    fun disconnect() {
        running = false
        try { socket?.close() } catch (_: IOException) { /* ignorer */ }
        socket = null
        thread?.interrupt()
        thread = null
    }

    private fun state(state: String, message: String = "") = emit("btState", JSONObject().put("state", state).put("message", message))

    /** Kobler til mottakeren: først vanlig seriell tjeneste (SPP), og hvis den ikke svarer, kanal 1 direkte */
    private fun connectSocket(device: BluetoothDevice): BluetoothSocket {
        var first: BluetoothSocket? = null
        try {
            first = device.createRfcommSocketToServiceRecord(SPP)
            first.connect()
            return first
        } catch (e: IOException) {
            try { first?.close() } catch (_: IOException) { /* ignorer */ }
            if (!running) throw e
            var second: BluetoothSocket? = null
            try {
                @Suppress("DiscouragedPrivateApi")
                second = device.javaClass.getMethod("createRfcommSocket", Int::class.javaPrimitiveType).invoke(device, 1) as BluetoothSocket
                second.connect()
                return second
            } catch (e2: Exception) {
                try { second?.close() } catch (_: IOException) { /* ignorer */ }
                throw e // meld den første feilen
            }
        }
    }

    private fun loop(adapter: BluetoothAdapter, device: BluetoothDevice) {
        var failures = 0
        while (running) {
            var s: BluetoothSocket? = null
            try {
                state("connecting")
                adapter.cancelDiscovery()
                s = connectSocket(device)
                socket = s
                failures = 0
                state("connected")
                val input = s.inputStream
                val buf = ByteArray(2048)
                while (running) {
                    val n = input.read(buf)
                    if (n < 0) break
                    if (n > 0) emit("nmea", JSONObject().put("text", String(buf, 0, n, Charsets.ISO_8859_1)))
                }
                if (running) state("disconnected", "Forbindelsen til mottakeren ble brutt. Prøver igjen …")
            } catch (e: IOException) {
                failures++
                if (running) {
                    val hint = if (failures >= 2) " Hvis dette gjentar seg: bruk «Android-posisjon» via Leica Zeno Connect i stedet, eller sjekk at mottakeren er på og ikke er koblet til en annen app." else ""
                    state("disconnected", "Får ikke kontakt med ${device.name ?: device.address}: ${e.message ?: "ukjent feil"}.$hint")
                }
            } catch (e: Exception) {
                state("error", "Bluetooth-feil: ${e.message}")
                running = false
            } finally {
                try { s?.close() } catch (_: IOException) { /* ignorer */ }
                socket = null
            }
            if (running) {
                try { Thread.sleep(3000) } catch (_: InterruptedException) { return }
            }
        }
    }

    companion object {
        private val SPP: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    }
}
