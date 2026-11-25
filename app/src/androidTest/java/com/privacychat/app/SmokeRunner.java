package com.privacychat.app;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import org.json.JSONObject;
import java.util.UUID;

public class SmokeRunner extends Instrumentation {
    @Override public void onCreate(Bundle b){super.onCreate(b);start();}
    private void check(boolean result,String message){if(!result)throw new AssertionError(message);}
    private boolean contains(View view,String text){
        if(view instanceof TextView && text.contentEquals(((TextView)view).getText()))return true;
        if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++)if(contains(group.getChildAt(i),text))return true;}
        return false;
    }
    @Override public void onStart(){
        Bundle result=new Bundle();
        try {
            Context app=getTargetContext();
            String id=UUID.randomUUID().toString();
            SessionVault vault=new SessionVault(app);vault.clear();
            Activity login=startActivitySync(new Intent(app,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            runOnMainSync(()->{check(contains(login.getWindow().getDecorView(),"Sign in"),"Login screen");login.finish();});
            waitForIdleSync();
            SecretStore store=new SecretStore(app,id);store.configure("owner-test-a".toCharArray(),"empty-test-b".toCharArray());
            check(store.unlock("owner-test-a".toCharArray())==1,"Owner password");
            check(store.unlock("empty-test-b".toCharArray())==2,"Restricted password");
            check(store.unlock("wrong-test".toCharArray())==0,"Invalid password");
            vault.save(new JSONObject().put("user",new JSONObject().put("id",id)).put("refresh_token","fixture-token"));
            check(new SessionVault(app).load().getString("refresh_token").equals("fixture-token"),"Vault restore");
            Activity restored=startActivitySync(new Intent(app,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            runOnMainSync(()->{check(contains(restored.getWindow().getDecorView(),"Unlock"),"Restored lock");restored.finish();});
            vault.clear();result.putString("result","PRIVACY_SMOKE_OK");finish(Activity.RESULT_OK,result);
        } catch(Throwable e){result.putString("failure",e.toString());finish(Activity.RESULT_CANCELED,result);}
    }
}
