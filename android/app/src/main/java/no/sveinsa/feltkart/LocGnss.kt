package no.sveinsa.feltkart

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Looper
import org.json.JSONObject

/**
 * «Intern GPS»: leser Androids egen posisjonstjeneste direkte (LocationManager), uten omvei via nettvisningen.
 * Her kommer både telefonens egen GPS og «mock»-posisjon fra f.eks. Leica Zeno Connect. Rådata (nøyaktighet, leverandør, mock)
 * sendes med, slik at appen kan vise hva Android faktisk får.
 */
@SuppressLint("MissingPermission")
class LocGnss(private val ctx: Context, private val emit: (String, JSONObject) -> Unit) {
    private var manager: LocationManager? = null
    private var listener: LocationListener? = null

    /** Starter lytting. Kaster feil med klartekst hvis posisjon er slått av. Krever at posisjonstillatelsen er gitt. */
    fun start() {
        stop()
        val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
            ?: throw IllegalStateException("Enheten har ikke posisjonstjeneste")
        if (!lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
            throw IllegalStateException("Posisjon (GPS) er slått av i Android. Slå den på og prøv igjen.")
        }
        val l = object : LocationListener {
            override fun onLocationChanged(loc: Location) {
                // Fra «passive» tar vi bare med mock-posisjon, så ikke nettverksposisjoner fra andre apper blandes inn
                if (loc.provider == LocationManager.PASSIVE_PROVIDER && !isMock(loc)) return
                emit("loc", toJson(loc))
            }

            override fun onProviderEnabled(provider: String) {}

            override fun onProviderDisabled(provider: String) {
                if (provider == LocationManager.GPS_PROVIDER) {
                    emit("locState", JSONObject().put("message", "Posisjon (GPS) ble slått av i Android"))
                }
            }

            @Deprecated("Brukes ikke i nyere Android")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
        }
        manager = lm
        listener = l
        lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 500L, 0f, l, Looper.getMainLooper())
        try {
            // Noen mock-apper melder posisjonen under et annet leverandørnavn. «passive» fanger den opp.
            lm.requestLocationUpdates(LocationManager.PASSIVE_PROVIDER, 0L, 0f, l, Looper.getMainLooper())
        } catch (_: Exception) { /* valgfritt */ }
    }

    fun stop() {
        val l = listener
        if (l != null) {
            try { manager?.removeUpdates(l) } catch (_: Exception) { /* ignorer */ }
        }
        listener = null
        manager = null
    }

    @Suppress("DEPRECATION")
    private fun isMock(l: Location): Boolean = if (Build.VERSION.SDK_INT >= 31) l.isMock else l.isFromMockProvider

    private fun mm(v: Float): Double = Math.round(v * 1000.0) / 1000.0

    private fun toJson(l: Location): JSONObject {
        val j = JSONObject()
        j.put("lat", l.latitude)
        j.put("lng", l.longitude)
        if (l.hasAltitude()) j.put("alt", l.altitude)
        if (l.hasAccuracy()) j.put("acc", mm(l.accuracy))
        if (Build.VERSION.SDK_INT >= 26 && l.hasVerticalAccuracy()) j.put("vacc", mm(l.verticalAccuracyMeters))
        j.put("provider", l.provider ?: "")
        j.put("mock", isMock(l))
        j.put("time", l.time)
        val sats = l.extras?.getInt("satellites", -1) ?: -1
        if (sats >= 0) j.put("sats", sats)
        return j
    }
}
