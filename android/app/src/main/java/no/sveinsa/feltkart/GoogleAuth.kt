package no.sveinsa.feltkart

import android.content.Context
import android.net.Uri
import android.util.Base64
import androidx.browser.customtabs.CustomTabsIntent
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Googles innlogging for Android-appen. Googles regler tillater ikke innlogging inne i en WebView, så vi åpner Chrome
 * (Custom Tab), bruker «Authorization Code + PKCE» og tar imot svaret på adressen `no.sveinsa.feltkart:/oauth2redirect`.
 * Innloggingen huskes (refresh token), så du slipper å logge inn på nytt hver time.
 * Forutsetter en OAuth-klient av typen «Android» i Google Cloud med pakkenavn no.sveinsa.feltkart og SHA-1 fra appens signeringsnøkkel.
 */
object GoogleAuth {
    const val SCHEME = "no.sveinsa.feltkart"
    private const val REDIRECT = "$SCHEME:/oauth2redirect"
    private const val AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
    private const val TOKEN = "https://oauth2.googleapis.com/token"

    private class Pending(val verifier: String, val state: String, val clientId: String, val scope: String, val cb: (Result<Pair<String, Long>>) -> Unit)

    @Volatile private var pending: Pending? = null
    @Volatile private var appContext: Context? = null

    private fun prefs(c: Context) = c.getSharedPreferences("feltkart_auth", Context.MODE_PRIVATE)

    fun getToken(act: MainActivity, clientId: String, scope: String, force: Boolean, cb: (Result<Pair<String, Long>>) -> Unit) {
        appContext = act.applicationContext
        val p = prefs(act)
        val same = p.getString("client_id", null) == clientId && p.getString("scope", null) == scope
        if (!force && same) {
            val now = System.currentTimeMillis()
            val at = p.getString("access_token", null)
            val exp = p.getLong("expires_at", 0)
            if (at != null && exp - now > 60_000) { cb(Result.success(at to (exp - now) / 1000)); return }
            val rt = p.getString("refresh_token", null)
            if (rt != null) {
                try {
                    val j = post(TOKEN, mapOf("client_id" to clientId, "refresh_token" to rt, "grant_type" to "refresh_token"))
                    cb(Result.success(store(act, clientId, scope, j, rt)))
                    return
                } catch (_: Exception) { /* utløpt eller trukket tilbake: logg inn på nytt */ }
            }
        }
        val verifier = randomUrlSafe(48)
        val state = randomUrlSafe(16)
        val challenge = Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()), Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
        val uri = Uri.parse(AUTH).buildUpon()
            .appendQueryParameter("client_id", clientId)
            .appendQueryParameter("redirect_uri", REDIRECT)
            .appendQueryParameter("response_type", "code")
            .appendQueryParameter("scope", scope)
            .appendQueryParameter("code_challenge", challenge)
            .appendQueryParameter("code_challenge_method", "S256")
            .appendQueryParameter("state", state)
            .appendQueryParameter("access_type", "offline")
            .appendQueryParameter("prompt", if (force) "select_account consent" else "consent")
            .build()
        pending?.cb?.invoke(Result.failure(Exception("Ny innlogging startet")))
        pending = Pending(verifier, state, clientId, scope, cb)
        act.runOnUiThread {
            try {
                CustomTabsIntent.Builder().build().launchUrl(act, uri)
            } catch (e: Exception) {
                pending = null
                cb(Result.failure(Exception("Fant ingen nettleser å logge inn i: ${e.message}")))
            }
        }
    }

    /** Kalles når Chrome sender oss tilbake til appen med svar fra Google */
    fun handleRedirect(uri: Uri) {
        val p = pending ?: return
        pending = null
        val error = uri.getQueryParameter("error")
        if (error != null) {
            val hint = if (error == "access_denied") "Innloggingen ble avbrutt eller avvist" else "Google avviste innloggingen ($error). Sjekk Android Client ID, pakkenavn og SHA-1 i Google Cloud."
            p.cb(Result.failure(Exception(hint)))
            return
        }
        val code = uri.getQueryParameter("code")
        if (code == null || uri.getQueryParameter("state") != p.state) { p.cb(Result.failure(Exception("Ugyldig svar fra Google"))); return }
        val ctx = appContext ?: run { p.cb(Result.failure(Exception("Appen var ikke klar"))); return }
        Thread {
            try {
                val j = post(TOKEN, mapOf("client_id" to p.clientId, "code" to code, "code_verifier" to p.verifier, "redirect_uri" to REDIRECT, "grant_type" to "authorization_code"))
                p.cb(Result.success(store(ctx, p.clientId, p.scope, j, null)))
            } catch (e: Exception) {
                p.cb(Result.failure(Exception("Kunne ikke hente tilgang fra Google: ${e.message}")))
            }
        }.start()
    }

    /** Brukeren kom tilbake uten å fullføre innloggingen */
    fun cancelPending() {
        val p = pending ?: return
        pending = null
        p.cb(Result.failure(Exception("Innloggingen ble avbrutt")))
    }

    fun signOut(ctx: Context) {
        prefs(ctx).edit().clear().apply()
    }

    private fun store(ctx: Context, clientId: String, scope: String, j: JSONObject, oldRefresh: String?): Pair<String, Long> {
        val at = j.getString("access_token")
        val seconds = j.optLong("expires_in", 3600)
        prefs(ctx).edit()
            .putString("client_id", clientId).putString("scope", scope)
            .putString("access_token", at).putLong("expires_at", System.currentTimeMillis() + seconds * 1000)
            .putString("refresh_token", j.optString("refresh_token", "").ifEmpty { oldRefresh })
            .apply()
        return at to seconds
    }

    private fun post(url: String, form: Map<String, String>): JSONObject {
        val body = form.entries.joinToString("&") { URLEncoder.encode(it.key, "UTF-8") + "=" + URLEncoder.encode(it.value, "UTF-8") }
        val c = URL(url).openConnection() as HttpURLConnection
        try {
            c.requestMethod = "POST"
            c.connectTimeout = 15000
            c.readTimeout = 20000
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
            c.outputStream.use { it.write(body.toByteArray()) }
            val stream = if (c.responseCode in 200..299) c.inputStream else c.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            if (c.responseCode !in 200..299) throw Exception(runCatching { JSONObject(text).optString("error_description", JSONObject(text).optString("error")) }.getOrDefault(text).ifEmpty { "HTTP ${c.responseCode}" })
            return JSONObject(text)
        } finally {
            c.disconnect()
        }
    }

    private fun randomUrlSafe(bytes: Int): String {
        val b = ByteArray(bytes)
        SecureRandom().nextBytes(b)
        return Base64.encodeToString(b, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    }
}
