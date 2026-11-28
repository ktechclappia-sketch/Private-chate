package com.privacychat.app;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;

import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

public class SmokeRunner extends Instrumentation {
    // Only the test APK contains this activity. Screens, storage, timers and rendering
    // run against the installed app. Billing and chat responses here are fixtures.
    public static class FixtureActivity extends MainActivity {
        static volatile boolean active, enabled, tester, admin;
        static volatile String message;
        static volatile Intent upi;
        @Override protected JSONObject authenticateAccount(String email, String password, boolean signup)
                throws Exception {
            return new JSONObject().put("access_token", "fixture-access")
                .put("refresh_token", "fixture-refresh");
        }
        @Override protected void registerDevice(String accessToken) throws Exception {
            throw new java.io.IOException("Registration unavailable");
        }
        @Override protected Object rpc(String op,JSONObject args) throws Exception {
            switch(op) {
                case "access": return new JSONObject().put("enabled",enabled).put("active",active)
                    .put("free_testing",tester).put("admin",admin);
                case "rooms": return new JSONArray().put(new JSONObject().put("room","1")
                    .put("title","Test group").put("accepted",true).put("kind","group").put("owner",true));
                case "messages":
                    JSONArray rows=new JSONArray();
                    if(message!=null)rows.put(new JSONObject().put("id",1).put("email","participant@example.invalid")
                        .put("body",message).put("sent_at","test time").put("photo",false));
                    return rows;
                case "send": message=args.getString("body");return new JSONArray();
                case "members": return new JSONArray().put(new JSONObject().put("email","member@example.invalid")
                    .put("person","2").put("accepted",true).put("removable",true));
                case "payments": return new JSONArray();
                default: throw new AssertionError("Unexpected RPC "+op);
            }
        }
        @Override protected JSONArray paymentRequests() throws Exception {
            return new JSONArray().put(new JSONObject()
                .put("id", "8b65bc9f-f0ad-466a-a540-1a58830ed44b")
                .put("status", "requested")
                .put("reason", "Synthetic renewal request"));
        }
        @Override public void startActivity(Intent intent) {
            if(intent.getData()!=null && "upi".equals(intent.getData().getScheme()))upi=intent;
            else super.startActivity(intent);
        }
    }

    @Override public Activity newActivity(ClassLoader loader,String name,Intent intent)
            throws InstantiationException,IllegalAccessException,ClassNotFoundException {
        if(MainActivity.class.getName().equals(name))return new FixtureActivity();
        return super.newActivity(loader,name,intent);
    }
    @Override public void onCreate(Bundle b){super.onCreate(b);start();}
    private static void check(boolean result,String message){if(!result)throw new AssertionError(message);}
    private Activity launch(){
        return startActivitySync(new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }
    private TextView find(View view,String text){
        if(view instanceof TextView){TextView v=(TextView)view;if(text.contentEquals(v.getText())||(v.getHint()!=null&&text.contentEquals(v.getHint())))return v;}
        if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++){
            TextView match=find(group.getChildAt(i),text);if(match!=null)return match;
        }}
        return null;
    }
    private boolean visible(Activity a,String text){
        AtomicBoolean found=new AtomicBoolean();runOnMainSync(()->found.set(find(a.getWindow().getDecorView(),text)!=null));
        return found.get();
    }
    private void waitFor(Activity a,String text,long maxWait){
        long end=SystemClock.elapsedRealtime()+maxWait;
        while(SystemClock.elapsedRealtime()<end){
            if(visible(a,text)&&!visible(a,"Working…"))return;
            SystemClock.sleep(150);
        }
        throw new AssertionError("Timed out waiting for "+text);
    }
    private void click(Activity a,String text){
        waitFor(a,text,30000);runOnMainSync(()->find(a.getWindow().getDecorView(),text).performClick());
    }
    private void fill(Activity a,String hint,String value){
        runOnMainSync(()->((EditText)find(a.getWindow().getDecorView(),hint)).setText(value));
    }
    private void unlock(Activity a,String password){
        waitFor(a,"Unlock",30000);fill(a,"Secret password",password);click(a,"Unlock");
    }
    @Override public void onStart(){
        Bundle result=new Bundle();
        try {
            Context app=getTargetContext();String id=UUID.randomUUID().toString();
            SessionVault vault=new SessionVault(app);vault.clear();
            Activity login=launch();waitFor(login,"Sign in",30000);
            check((login.getWindow().getAttributes().flags&WindowManager.LayoutParams.FLAG_SECURE)!=0,"Screen capture protection");
            fill(login,"Email","fixture@example.invalid");
            fill(login,"Account password","fixture-password");
            click(login,"Sign in");
            waitFor(login,"Device registration failed. Check your connection and sign in again.",30000);
            check(vault.load()==null && !visible(login,"Unlock"),"Registration failure blocks session");
            runOnMainSync(login::finish);waitForIdleSync();
            SecretStore secrets=new SecretStore(app,id);secrets.configure("owner-test-a".toCharArray(),"empty-test-b".toCharArray());
            vault.save(new JSONObject().put("user",new JSONObject().put("id",id)).put("refresh_token","fixture-token").put(MainActivity.DEVICE_REGISTERED,true));
            check(new SessionVault(app).load().getString("refresh_token").equals("fixture-token"),"Keystore restore");
            check(!app.getSharedPreferences("session_v1",0).getAll().toString().contains("fixture-token"),"Ciphertext persistence");

            Activity a=launch();
            unlock(a,"wrong");waitFor(a,"Incorrect password",30000);
            unlock(a,"empty-test-b");waitFor(a,"No conversations",30000);
            check(!visible(a,"Test group"),"Restricted mode");click(a,"Lock");
            FixtureActivity.enabled=true;FixtureActivity.active=true;FixtureActivity.tester=true;
            unlock(a,"owner-test-a");waitFor(a,"Free testing access",30000);
            check(!visible(a,"Review UPI payments"),"Tester has no approval control");
            click(a,"Test group");waitFor(a,"Send",30000);fill(a,"Message","Android UI message");click(a,"Send");
            waitFor(a,"Android UI message",30000);click(a,"Members");waitFor(a,"Remove member@example.invalid",30000);

            // The server fixture changes while the member view is still open; no tap/refresh.
            FixtureActivity.enabled=false;FixtureActivity.active=false;
            waitFor(a,"Account deactivated",35000);
            check(!visible(a,"Pay ₹100 with UPI"),"Disabled account cannot purchase");
            FixtureActivity.enabled=true;FixtureActivity.tester=false;
            click(a,"Refresh access");waitFor(a,"Pay ₹100 with UPI",30000);click(a,"Pay ₹100 with UPI");
            check("100.00".equals(FixtureActivity.upi.getData().getQueryParameter("am")),"UPI amount");
            check("INR".equals(FixtureActivity.upi.getData().getQueryParameter("cu")),"UPI currency");
            check(CloudConfig.UPI_ID.equals(FixtureActivity.upi.getData().getQueryParameter("pa")),"UPI recipient");
            waitFor(a,"Reason: Synthetic renewal request",30000);
            click(a,"Resubmit for Admin approval");
            waitFor(a,"Enter a valid UTR number (8–80 letters or digits).",30000);
            fill(a,"UTR / transaction number","SYNTHETIC1234");
            click(a,"Resubmit for Admin approval");
            waitFor(a,"Attach a screenshot of the payment first.",30000);
            FixtureActivity.admin=true;FixtureActivity.active=true;click(a,"Refresh access");
            click(a,"Review UPI payments");waitFor(a,"No pending payments",30000);
            runOnMainSync(()->{callActivityOnPause(a);callActivityOnResume(a);});
            waitFor(a,"Unlock",30000);check(!visible(a,"No pending payments"),"Background lock");
            unlock(a,"owner-test-a");waitFor(a,"Review UPI payments",30000);
            waitFor(a,"Unlock",145000); // Exercise the real two-minute idle lock timer.
            click(a,"Sign out");waitFor(a,"Sign in",30000);check(vault.load()==null,"Sign-out clears vault");
            runOnMainSync(a::finish);waitForIdleSync();
            result.putString("result","PRIVACY_SMOKE_OK");finish(Activity.RESULT_OK,result);
        } catch(Throwable e){android.util.Log.e("PrivacyChatQA","Instrumentation failure",e);result.putString("failure",e.toString());finish(Activity.RESULT_CANCELED,result);}
    }
}
