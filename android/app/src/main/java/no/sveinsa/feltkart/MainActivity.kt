package no.sveinsa.feltkart

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Feltkart for Android: viser webappen (samme kode som på nettsiden) i en WebView og gir den tilgang til
 * Bluetooth-GNSS (RTK), kamera, Googles innlogging og lagring i Nedlastinger via [NativeBridge].
 */
class MainActivity : ComponentActivity() {
    lateinit var webView: WebView
    private lateinit var bridge: NativeBridge
    private lateinit var assetLoader: WebViewAssetLoader

    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var permCallback: ((Map<String, Boolean>) -> Unit)? = null
    private var photoCallback: ((File?) -> Unit)? = null
    private var photoFile: File? = null

    private val fileChooser = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data))
        fileCallback = null
    }
    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { r ->
        val cb = permCallback
        permCallback = null
        cb?.invoke(r)
    }
    private val takePicture = registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val f = photoFile
        photoFile = null
        val cb = photoCallback
        photoCallback = null
        cb?.invoke(if (ok && f != null && f.exists() && f.length() > 0) f else null)
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Tegn bak systemlinjene, og legg inn polstring så innholdet ikke havner under statuslinjen eller tastaturet
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val root = FrameLayout(this)
        root.setBackgroundColor(Color.parseColor("#0F5A3C"))
        webView = WebView(this)
        root.addView(webView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)
        WindowCompat.getInsetsController(window, root).isAppearanceLightStatusBars = false
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }

        // Webappen ligger i APK-en og serves fra en egen https-adresse (gir «sikker kontekst», IndexedDB og lagring som i nettleseren)
        assetLoader = WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/capture/", WebViewAssetLoader.InternalStoragePathHandler(this, File(cacheDir, "capture").apply { mkdirs() }))
            .build()

        val s = webView.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.databaseEnabled = true
        s.allowFileAccess = false
        s.allowContentAccess = false
        s.setSupportZoom(false)
        s.builtInZoomControls = false
        s.mediaPlaybackRequiresUserGesture = false
        s.cacheMode = WebSettings.LOAD_DEFAULT
        s.userAgentString = s.userAgentString + " FeltkartAndroid/" + versionName()
        if (0 != (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE)) WebView.setWebContentsDebuggingEnabled(true)

        bridge = NativeBridge(this)
        webView.addJavascriptInterface(bridge, "FeltkartNative")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                if (u.host == HOST) return false
                // Lenker ut av appen (f.eks. skjema for feilmelding) åpnes i nettleseren
                try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (_: Exception) { /* ingen app kan åpne den */ }
                return true
            }

            override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
                // Nettvisningen ble stoppet av Android (lite minne). Start den på nytt i stedet for å krasje.
                recreate()
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            // Navnet på metoden i Android-SDK-en er onGeolocationPermissionsShowPrompt. Parameterne er «plattformtyper», så både med og uten ? er lov.
            override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback?) {
                if (callback == null) return
                val o = origin ?: ""
                requestPerms(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) { r ->
                    callback.invoke(o, r.values.any { it }, false)
                }
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                request.deny() // kamera/mikrofon i nettvisningen brukes ikke; kamera går via appen
            }

            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    fileChooser.launch(params.createIntent())
                    true
                } catch (e: Exception) {
                    fileCallback = null
                    callback.onReceiveValue(null)
                    false
                }
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Åpen dialog/visning lukkes (Esc). Står du i Kart eller innstillinger, går tilbake til Felt. Ellers legges appen i bakgrunnen, så Bluetooth-forbindelsen beholdes.
                val js = "(function(){var m=document.querySelector('.modal-back,.viewer,.sec-win');" +
                    "if(m){window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));return 'esc';}" +
                    "var v=document.documentElement.dataset.fkView;" +
                    "if(v&&v!=='field'){window.dispatchEvent(new Event('fk-back'));return 'esc';}return 'min';})()"
                webView.evaluateJavascript(js) { r -> if (r == null || !r.contains("esc")) moveTaskToBack(true) }
            }
        })

        // Posisjon spørres om ved første oppstart, slik at «Android-posisjon» virker uten venting
        requestPerms(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) { }

        if (savedInstanceState == null) webView.loadUrl("https://$HOST/assets/www/index.html")
        else webView.restoreState(savedInstanceState)
        intent?.data?.let { handleRedirect(it) }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.data?.let { handleRedirect(it) }
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        // Kom vi tilbake fra Chrome uten at innloggingen ble fullført, ble den avbrutt
        GoogleAuth.cancelPending()
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        bridge.shutdown()
        webView.destroy()
        super.onDestroy()
    }

    private fun handleRedirect(uri: Uri) {
        if (uri.scheme == GoogleAuth.SCHEME) GoogleAuth.handleRedirect(uri)
    }

    private fun versionName(): String = try { packageManager.getPackageInfo(packageName, 0).versionName ?: "" } catch (_: Exception) { "" }

    /** Ber om tillatelser (på hovedtråden). `cb` får svar per tillatelse. */
    fun requestPerms(perms: Array<String>, cb: (Map<String, Boolean>) -> Unit) {
        runOnUiThread {
            val missing = perms.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
            if (missing.isEmpty()) { cb(perms.associateWith { true }); return@runOnUiThread }
            if (permCallback != null) { webView.postDelayed({ requestPerms(perms, cb) }, 400); return@runOnUiThread } // en annen forespørsel venter på svar
            permCallback = { r -> cb(perms.associateWith { p -> r[p] ?: (ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED) }) }
            permissionLauncher.launch(missing.toTypedArray())
        }
    }

    /** Åpner kameraet. `cb` får bildefilen (i appens cache) eller null hvis du avbrøt. */
    fun launchCamera(cb: (File?) -> Unit) {
        runOnUiThread {
            val dir = File(cacheDir, "capture").apply { mkdirs() }
            dir.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 3_600_000 }?.forEach { it.delete() }
            val name = "IMG_" + SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date()) + ".jpg"
            val f = File(dir, name)
            photoFile = f
            photoCallback = cb
            try {
                takePicture.launch(FileProvider.getUriForFile(this, "$packageName.fileprovider", f))
            } catch (e: Exception) {
                photoFile = null
                photoCallback = null
                cb(null)
            }
        }
    }

    companion object {
        const val HOST = "appassets.androidplatform.net"
    }
}
