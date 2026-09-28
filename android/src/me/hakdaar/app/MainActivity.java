package me.hakdaar.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * HakDaar for Android: the live web app in a full-screen WebView.
 * It always shows the latest version of the site, so the app never needs updating for new features.
 */
public class MainActivity extends Activity {
    static final String HOME = "https://hakdaar.vercel.app/app";
    static final String HOST = "hakdaar.vercel.app";
    static final int MIC_REQUEST = 1;

    WebView web;
    PermissionRequest pendingMic;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                 // keeps the worker signed in
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " HakDaarApp/1.0");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri uri = req.getUrl();
                if (HOST.equals(uri.getHost())) return false;   // stay inside the app
                startActivity(new Intent(Intent.ACTION_VIEW, uri)); // other links: phone's browser
                return true;
            }
        });

        // Voice input: the page asks for the microphone; ask Android first, then allow it.
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                for (String r : request.getResources()) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) {
                        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                            request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                        } else {
                            pendingMic = request;
                            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MIC_REQUEST);
                        }
                        return;
                    }
                }
                request.deny();
            }
        });

        if (state != null) web.restoreState(state);
        else web.loadUrl(HOME);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code != MIC_REQUEST || pendingMic == null) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            pendingMic.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            pendingMic.deny();
        }
        pendingMic = null;
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
