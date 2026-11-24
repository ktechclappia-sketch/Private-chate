package com.ktech.privacychat;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.KeyguardManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.hardware.biometrics.BiometricPrompt;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.SystemClock;
import android.text.InputType;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.security.spec.KeySpec;
import java.util.Collections;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/** Privacy Chat 2.0: Native PIN/biometric gate before the WebView is constructed.
 * The two local passwords are app-lock credentials, not Supabase login credentials.
 * Password hashes are salted; no clear-text PIN is stored. This is not E2E encryption.
 */
public final class MainActivity extends Activity {
    private static final String APP_HOST="appassets.androidplatform.net";
    private static final String ROOT_URL="https://"+APP_HOST+"/index.html";
    private static final int FILE_REQUEST_CODE=4381;
    private static final int BG=Color.rgb(248,196,218);
    private WebView webView;
    private ValueCallback<Uri[]> pendingFileCallback;
    private boolean choosingPhoto=false;
    private boolean blankMode=false;
    private boolean initialLockSetupOpen=false;
    private int failedUnlocks=0;
    private long cooldownUntil=0;
    private SharedPreferences locks;

    @Override public void onCreate(Bundle savedInstanceState){
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        locks=getSharedPreferences("pc_local_lock_v2", MODE_PRIVATE);
        if(hasLock()) showLockScreen(); else showWebView();
    }

    private boolean hasLock(){return locks.contains("mainHash") && locks.contains("decoyHash");}
    private void note(String message){Toast.makeText(this,message,Toast.LENGTH_LONG).show();}
    private EditText secretInput(String hint){
        EditText field=new EditText(this);
        field.setSingleLine(true);
        field.setHint(hint);
        field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        field.setTextSize(16);
        field.setPadding(18,14,18,14);
        return field;
    }
    private LinearLayout column(){
        LinearLayout col=new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(28,28,28,28);
        col.setBackgroundColor(Color.rgb(255,244,250));
        return col;
    }
    private void showLockScreen(){
        blankMode=false;
        if(webView!=null)destroyWebView();
        LinearLayout base=column();
        base.setGravity(Gravity.CENTER);
        TextView title=new TextView(this);
        title.setText("◈  PRIVACY CHAT");title.setTextSize(23);title.setTextColor(Color.rgb(163,45,102));
        title.setGravity(Gravity.CENTER);
        base.addView(title,new LinearLayout.LayoutParams(-1,92));
        TextView hint=new TextView(this);
        hint.setText("Enter your secret password to continue.");
        hint.setTextColor(Color.DKGRAY);hint.setGravity(Gravity.CENTER);
        base.addView(hint);
        EditText input=secretInput("Secret password");
        base.addView(input,new LinearLayout.LayoutParams(-1,-2));
        Button unlock=new Button(this);unlock.setText("Unlock");
        base.addView(unlock,new LinearLayout.LayoutParams(-1,-2));
        unlock.setOnClickListener(v->{
            if(SystemClock.elapsedRealtime()<cooldownUntil){note("Too many attempts. Try again shortly.");return;}
            String submitted=input.getText().toString();input.setText("");
            if(checkSecret(submitted,"main")){failedUnlocks=0;showWebView();}
            else if(checkSecret(submitted,"decoy")){failedUnlocks=0;showBlankScreen();}
            else{
                failedUnlocks++;
                if(failedUnlocks>=5){cooldownUntil=SystemClock.elapsedRealtime()+30000;failedUnlocks=0;}
                note("Incorrect local password");
            }
        });
        Button bio=new Button(this);bio.setText("Use Fingerprint");
        base.addView(bio,new LinearLayout.LayoutParams(-1,-2));
        bio.setOnClickListener(v->promptBiometric());
        TextView note=new TextView(this);
        note.setGravity(Gravity.CENTER);note.setTextSize(11);note.setTextColor(Color.GRAY);
        note.setText("Use a fingerprint or your secret password.");
        base.addView(note);
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.addView(base);
        setContentView(scroll);
    }
    private void showBlankScreen(){
        blankMode=true;
        if(webView!=null)destroyWebView();
        View blank=new View(this);
        blank.setBackgroundColor(Color.WHITE);
        setContentView(blank);
    }
    private void promptBiometric(){
        if(Build.VERSION.SDK_INT<28){note("Fingerprint unlock requires Android 9 or newer. Use the main password.");return;}
        try{
            KeyguardManager km=(KeyguardManager)getSystemService(KEYGUARD_SERVICE);
            if(km==null || !km.isDeviceSecure()){
                note("Set up your phone fingerprint and screen lock first.");return;
            }
            BiometricPrompt prompt=new BiometricPrompt.Builder(this)
                .setTitle("Unlock Privacy Chat")
                .setSubtitle("Confirm your fingerprint")
                .setNegativeButton("Use password",getMainExecutor(),(dialog,which)->{})
                .build();
            prompt.authenticate(new CancellationSignal(),getMainExecutor(),new BiometricPrompt.AuthenticationCallback(){
                @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result){
                    super.onAuthenticationSucceeded(result);failedUnlocks=0;showWebView();
                }
                @Override public void onAuthenticationError(int errorCode,CharSequence errString){
                    super.onAuthenticationError(errorCode,errString);
                    if(errorCode!=BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED)
                        note("Fingerprint unavailable. Use your main password.");
                }
            });
        }catch(Exception e){note("Fingerprint unavailable. Use your main password.");}
    }

    private String[] hashSecret(String plain){
        try{
            byte[] salt=new byte[16];new SecureRandom().nextBytes(salt);
            return new String[]{Base64.encodeToString(salt,Base64.NO_WRAP),computeHash(plain,salt)};
        }catch(Exception e){throw new IllegalStateException("Could not secure the password",e);}
    }
    private String computeHash(String plain,byte[] salt) throws Exception{
        KeySpec spec=new PBEKeySpec(plain.toCharArray(),salt,210000,256);
        byte[] hash=SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
        return Base64.encodeToString(hash,Base64.NO_WRAP);
    }
    private boolean checkSecret(String plain,String prefix){
        try{
            String value=locks.getString(prefix+"Hash",null),salt=locks.getString(prefix+"Salt",null);
            if(value==null || salt==null || plain==null)return false;
            String test=computeHash(plain,Base64.decode(salt,Base64.NO_WRAP));
            byte[] a=Base64.decode(value,Base64.NO_WRAP),b=Base64.decode(test,Base64.NO_WRAP);
            return java.security.MessageDigest.isEqual(a,b);
        }catch(Exception ignored){return false;}
    }
    private void configureNativeLock(boolean required){
        if(required && initialLockSetupOpen)return;
        if(required)initialLockSetupOpen=true;
        final LinearLayout form=column();
        final EditText current=secretInput("Existing main local password");
        if(hasLock())form.addView(current);
        final EditText main=secretInput("Main secret password (min 8 characters)");
        final EditText decoy=secretInput("Alternate secret password (min 8 characters)");
        final EditText repeat=secretInput("Repeat alternate secret password");
        form.addView(main);form.addView(decoy);form.addView(repeat);
        ScrollView formScroll=new ScrollView(this);formScroll.addView(form);
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("Set up private app lock")
            .setView(formScroll).setCancelable(!required)
            .setNegativeButton(required ? "Sign out" : "Cancel",(d,w)->{
                initialLockSetupOpen=false;
                if(required && webView!=null)webView.evaluateJavascript("logout().catch(function(e){toast(\"Sign out failed: \"+errorText(e))})",null);
            })
            .setPositiveButton("Save",null).create();
        dialog.setOnShowListener(v->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(clicked->{
            String a=main.getText().toString(),b=decoy.getText().toString(),again=repeat.getText().toString();
            if(hasLock()&&!checkSecret(current.getText().toString(),"main")){note("Current main password incorrect");return;}
            if(a.length()<8||b.length()<8){note("Both secret passwords need at least 8 characters");return;}
            if(a.equals(b)){note("Main and alternate passwords must be different");return;}
            if(!b.equals(again)){note("Alternate password confirmation does not match");return;}
            try{
                String[] one=hashSecret(a),two=hashSecret(b);
                locks.edit().putString("mainSalt",one[0]).putString("mainHash",one[1])
                    .putString("decoySalt",two[0]).putString("decoyHash",two[1]).apply();
                initialLockSetupOpen=false;
                note("Secret passwords saved. Reopen the app to test.");dialog.dismiss();
            }catch(Exception ex){note("Could not save lock. Please try again.");}
        }));
        dialog.show();
    }
    private void destroyWebView(){
        if(webView==null)return;
        webView.stopLoading();webView.setWebChromeClient(null);webView.setWebViewClient(null);
        ViewGroup parent=(ViewGroup)webView.getParent();if(parent!=null)parent.removeView(webView);
        webView.destroy();webView=null;
    }
    private void showWebView(){
        blankMode=false;
        if(webView!=null)return;
        webView=new WebView(this);
        webView.setBackgroundColor(BG);
        WebSettings settings=webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        webView.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request){
                Uri uri=request.getUrl();
                if(!"https".equalsIgnoreCase(uri.getScheme())||!APP_HOST.equalsIgnoreCase(uri.getHost()))return null;
                String path=uri.getPath();if(path==null||path.equals("/"))path="/index.html";
                if(!path.equals("/index.html")&&!path.equals("/app.js")&&!path.equals("/config.js")&&!path.equals("/style.css"))
                    return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));
                String file=path.substring(1);
                String mime=file.endsWith(".css")?"text/css":file.endsWith(".js")?"application/javascript":"text/html";
                try{InputStream in=getAssets().open(file);return new WebResourceResponse(mime,"UTF-8",in);}
                catch(IOException e){return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                Uri uri=request.getUrl();
                if("privacychat".equalsIgnoreCase(uri.getScheme())){
                    if(request.isForMainFrame() && view.getUrl()!=null && view.getUrl().startsWith("https://"+APP_HOST+"/")){
                        String cmd=uri.getHost();
                        if("configure-lock".equals(cmd))configureNativeLock(false);
                        else if("session-ready".equals(cmd)){
                            // Called only after a real Supabase login/session restore.
                            // Require both passwords before relying on app-lock protection.
                            if(!hasLock())configureNativeLock(true);
                        }
                        else if("lock-now".equals(cmd)){
                            if(hasLock())showLockScreen();else {note("Set up both local passwords under Privacy & security first.");showBlankScreen();}
                        }else if("signed-out".equals(cmd)){
                            locks.edit().clear().apply();initialLockSetupOpen=false;
                        }
                    }
                    return true;
                }
                if(APP_HOST.equalsIgnoreCase(uri.getHost()))return false;
                if("https".equalsIgnoreCase(uri.getScheme())){
                    try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(ActivityNotFoundException ignored){}
                }
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
                if(pendingFileCallback!=null)pendingFileCallback.onReceiveValue(null);
                pendingFileCallback=callback;
                Intent intent=new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("image/*");
                try{
                    choosingPhoto=true;
                    startActivityForResult(Intent.createChooser(intent,"Choose a photo"),FILE_REQUEST_CODE);
                    return true;
                }catch(ActivityNotFoundException e){
                    choosingPhoto=false;pendingFileCallback=null;callback.onReceiveValue(null);return false;
                }
            }
        });
        setContentView(webView);
        webView.loadUrl(ROOT_URL);
    }
    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){
        super.onActivityResult(requestCode,resultCode,data);
        if(requestCode==FILE_REQUEST_CODE){
            choosingPhoto=false;
            if(pendingFileCallback!=null){
                pendingFileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode,data));
                pendingFileCallback=null;
            }
        }
    }
    @Override protected void onStop(){
        super.onStop();
        // The decoy view stays completely blank until the Activity closes.
        if(blankMode){finish();return;}
        if(hasLock()&&webView!=null&&!choosingPhoto)showLockScreen();
    }
    @Override public void onBackPressed(){
        if(blankMode){finish();return;}
        if(webView==null){finish();return;}
        webView.evaluateJavascript(
            "(function(){var d=document.getElementById('dashboard');"+
            "var v=document.getElementById('photo-viewer');"+
            "if(v && !v.classList.contains('hidden')) {"+
            "var c=document.getElementById('photo-viewer-close');if(c)c.click();return true;}"+
            "var g=document.getElementById('group-members-overlay');"+
            "if(g && !g.classList.contains('hidden')){document.getElementById('close-group-members').click();return true;}"+
            "if(d && d.classList.contains('mobile-chat')){"+
            "var b=document.getElementById('mobile-back');if(b)b.click();return true;}return false;})()",
            result->{if(!"true".equals(result))runOnUiThread(()->finish());});
    }
    @Override protected void onDestroy(){
        if(pendingFileCallback!=null){pendingFileCallback.onReceiveValue(null);pendingFileCallback=null;}
        destroyWebView();super.onDestroy();
    }
}
