package com.xiu.game;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

// 打开游戏网页。服务器地址来自仓库根目录 server-url.txt（打包时复制到 assets/server.txt）；
// 管理员在游戏里设置的「游戏线路」切换后存在 SharedPreferences（xiu/url），以后都用它，不用重新打包
// 图片：打包时把 web/img 放进安装包（assets/img）。启动时读服务器的图片清单 img_ver.txt（sudo xiu-update 生成），
//   逐张比对：和包里一样的直接用包里的，服务器换过的那几张才去服务器下载（不会因为换了一张图就全部重新下载）
public class MainActivity extends Activity {
    private static final int BG = Color.parseColor("#14110f");
    private WebView web;
    private String imgTree = "";
    private final HashMap<String, String> imgHash = new HashMap<>();
    private volatile HashMap<String, String> srvHash = null;          // 服务器图片清单
    private final CountDownLatch srvReady = new CountDownLatch(1);
    private boolean lineDialog = false;

    private SharedPreferences prefs() { return getSharedPreferences("xiu", MODE_PRIVATE); }

    // 网页调用：window.XiuApp.setLines(列表 JSON) 缓存线路；switchTo(地址, 带登录的完整网址) 换线路
    private class Bridge {
        @JavascriptInterface public void setLines(String json) { if (json != null && json.length() < 20000) prefs().edit().putString("lines", json).apply(); }
        @JavascriptInterface public String getUrl() { return serverUrl(); }
        @JavascriptInterface public void switchTo(String base, String full) {
            if (base == null || !(base.startsWith("http://") || base.startsWith("https://"))) return;
            prefs().edit().putString("url", base).apply();
            runOnUiThread(() -> { if (web != null) web.loadUrl(full != null && full.startsWith(base) ? full : base); });
        }
    }

    // 打不开游戏网页（地址失效 / 太慢超时）：弹出缓存的线路让玩家选，或重试
    private void showLines() {
        if (lineDialog || isFinishing()) return;
        final ArrayList<String> names = new ArrayList<>(), urls = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(prefs().getString("lines", "[]"));
            for (int i = 0; i < a.length(); i++) { JSONObject o = a.getJSONObject(i); names.add(o.optString("name", "线路" + (i + 1))); urls.add(o.optString("url", "")); }
        } catch (Exception e) { }
        String def = assetUrl();
        if (!urls.contains(def)) { names.add("安装包默认地址"); urls.add(def); }
        String cur = serverUrl();
        for (int i = 0; i < names.size(); i++) if (urls.get(i).equals(cur)) names.set(i, names.get(i) + "（当前）");
        lineDialog = true;
        new AlertDialog.Builder(this).setTitle("连接不上游戏服务器，换一条线路？")
            .setItems(names.toArray(new String[0]), (d, i) -> { lineDialog = false; prefs().edit().putString("url", urls.get(i)).apply(); web.loadUrl(urls.get(i)); })
            .setPositiveButton("重试", (d, i) -> { lineDialog = false; web.loadUrl(serverUrl()); })
            .setOnCancelListener(d -> lineDialog = false)
            .show();
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Window w = getWindow();
        // 真全屏：网页一直铺到屏幕最顶端（含刘海/状态栏区域），并隐藏状态栏和导航栏
        w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);
        w.getDecorView().setBackgroundColor(BG);
        setupFullscreen(w);
        loadImgVer();
        loadSrvHash();
        setContentView(makeWeb());
        // 安卓 13+ 要允许通知，后台运行的常驻通知才显示（不允许也能用，只是看不到通知）
        if (android.os.Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[] { "android.permission.POST_NOTIFICATIONS" }, 1);
        if (b != null) web.restoreState(b);
        else web.loadUrl(serverUrl());
    }

    // 允许网页绘制到刘海区域，并把状态栏 / 导航栏全部隐藏（从边缘滑动可临时呼出）
    private void setupFullscreen(Window w) {
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
                    ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            w.setAttributes(lp);
        }
        if (Build.VERSION.SDK_INT >= 30) w.setDecorFitsSystemWindows(false);
        hideSystemBars();
    }

    private void hideSystemBars() {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
            }
        } else {
            w.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    // 从通知栏 / 弹窗返回游戏时，系统栏可能重新出现，再次隐藏
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    // 建 WebView（网页进程被系统回收时会重新建一个）
    private WebView makeWeb() {
        web = new WebView(this);
        web.setBackgroundColor(BG);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setTextZoom(100);   // 不跟随手机系统字体大小，和浏览器里一样
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        web.addJavascriptInterface(new Bridge(), "XiuApp");
        web.setWebViewClient(new WebViewClient() {
            // 安装版标记：网页 html 加 class="apk"，样式里底部导航往上抬一点，避开手机底部手势条
            @Override
            public void onPageFinished(WebView v, String url) {
                v.evaluateJavascript("document.documentElement.classList.add('apk')", null);
            }
            // 切到后台久了，系统可能回收网页进程：不让整个 App 崩溃 / 一直黑屏，换一个新的 WebView 重新打开游戏
            @Override
            @android.annotation.TargetApi(26)
            public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
                if (v == web) {
                    android.view.ViewGroup p = (android.view.ViewGroup) v.getParent();
                    if (p != null) p.removeView(v);
                    v.destroy();
                    setContentView(makeWeb());
                    web.loadUrl(serverUrl());
                } else v.destroy();
                return true;
            }
            @Override
            @android.annotation.TargetApi(23)
            public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) showLines();
            }
            @Override
            public void onReceivedError(WebView v, int code, String desc, String url) {   // 安卓 5.x
                if (android.os.Build.VERSION.SDK_INT < 23) showLines();
            }
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                WebResourceResponse r = localImg(req.getUrl());
                return r != null ? r : super.shouldInterceptRequest(v, req);
            }
        });
        web.setWebChromeClient(new WebChromeClient());   // 让网页的确认框 / 提示框（confirm、alert）能弹出来
        return web;
    }

    // 切后台 / 切回来：切后台开 KeepAliveService 保持连接；切回来马上恢复绘制，减少黑屏
    // 切回来时告诉网页离开了多久（window.__appResume），网页显示「加载游戏中…」直到服务器结算完
    private long pausedAt = 0;
    @Override
    protected void onPause() {
        super.onPause();
        pausedAt = android.os.SystemClock.elapsedRealtime();
        // 不调用 web.onPause()：切后台时网页照常运行；开前台服务防止系统冻结 App，连接保持不断
        if (!isFinishing()) KeepAliveService.start(this);
    }
    @Override
    protected void onDestroy() { KeepAliveService.stop(this); super.onDestroy(); }
    @Override
    protected void onResume() {
        super.onResume();
        KeepAliveService.stop(this);
        if (web != null) {
            web.onResume(); web.resumeTimers(); web.invalidate();
            if (pausedAt > 0) {
                long away = android.os.SystemClock.elapsedRealtime() - pausedAt;
                pausedAt = 0;
                web.evaluateJavascript("window.__appResume&&window.__appResume(" + away + ")", null);
            }
        }
    }

    private void loadImgVer() {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(getAssets().open("img_ver.txt"), "UTF-8"))) {
            imgTree = r.readLine();
            if (imgTree == null) imgTree = "";
            imgTree = imgTree.trim();
            String line;
            while ((line = r.readLine()) != null) {
                int i = line.lastIndexOf(' ');
                if (i > 0) imgHash.put(line.substring(0, i), line.substring(i + 1).trim());
            }
        } catch (Exception e) { }
    }

    private void loadSrvHash() {
        new Thread(() -> {
            try {
                String base = serverUrl(); if (!base.endsWith("/")) base += "/";
                HttpURLConnection c = (HttpURLConnection) new URL(base + "img_ver.txt?t=" + System.currentTimeMillis()).openConnection();
                c.setConnectTimeout(4000); c.setReadTimeout(4000);
                if (c.getResponseCode() == 200) {
                    HashMap<String, String> m = new HashMap<>();
                    try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"))) {
                        String line;
                        while ((line = r.readLine()) != null) {
                            int i = line.lastIndexOf(' ');
                            if (i > 0) m.put(line.substring(0, i), line.substring(i + 1).trim());
                        }
                    }
                    if (!m.isEmpty()) srvHash = m;
                }
                c.disconnect();
            } catch (Exception e) { }
            srvReady.countDown();
        }).start();
    }

    private WebResourceResponse localImg(Uri u) {
        try {
            String path = u.getPath();
            if (path == null) return null;
            int i = path.indexOf("/img/");
            if (i < 0) return null;
            String rel = path.substring(i + 5);
            String h = imgHash.get(rel);
            if (h == null) return null;                       // 包里没有这张图
            try { srvReady.await(5, TimeUnit.SECONDS); } catch (InterruptedException e) { }
            HashMap<String, String> sh = srvHash;
            if (sh != null) {
                String s2 = sh.get(rel);
                if (s2 != null && !s2.equals(h)) return null;          // 服务器换了这张图 → 去服务器下载
            } else {
                String v = u.getQueryParameter("v");                    // 读不到清单：按旧办法比对版本号
                // DATA.IMG_V 现在是 37 这样的短数字，不是 8 位哈希：原来要求
                // v.length() == 8 让回退分支永远不触发，安卓端一直用内置旧图。
                // 去掉长度限制，版本号对不上就去服务器下载。
                if (v != null && !v.equals(imgTree) && !v.equals(h)) return null;
            }
            String mime = rel.endsWith(".webp") ? "image/webp" : rel.endsWith(".png") ? "image/png"
                    : rel.endsWith(".svg") ? "image/svg+xml" : rel.endsWith(".gif") ? "image/gif" : "image/jpeg";
            return new WebResourceResponse(mime, null, getAssets().open("img/" + rel));
        } catch (Exception e) {
            return null;
        }
    }

    private String serverUrl() {
        String u = prefs().getString("url", null);
        if (u != null && (u.startsWith("http://") || u.startsWith("https://"))) return u;
        return assetUrl();
    }
    private String assetUrl() {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(getAssets().open("server.txt"), "UTF-8"))) {
            String line;
            while ((line = r.readLine()) != null) {
                line = line.trim();
                if (!line.isEmpty() && !line.startsWith("#")) return line;
            }
        } catch (Exception e) { }
        return "about:blank";
    }

    @Override
    protected void onSaveInstanceState(Bundle b) { super.onSaveInstanceState(b); web.saveState(b); }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
