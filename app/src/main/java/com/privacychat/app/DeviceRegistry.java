package com.privacychat.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import java.util.UUID;
import org.json.JSONObject;

/** Registers a non-secret device identifier for the signed-in account. */
final class DeviceRegistry {
    private DeviceRegistry() {}

    static void register(Context context, String accessToken) throws Exception {
        SharedPreferences prefs=context.getSharedPreferences("device_registry",Context.MODE_PRIVATE);
        String key=prefs.getString("device_key",null);
        if(key==null){
            key=UUID.randomUUID().toString();
            if(!prefs.edit().putString("device_key",key).commit())
                throw new java.io.IOException("Could not save device identifier");
        }
        String manufacturer=Build.MANUFACTURER==null?"Android":Build.MANUFACTURER.trim();
        String model=Build.MODEL==null?"device":Build.MODEL.trim();
        String name=(manufacturer+" "+model).trim();
        if(name.length()>80)name=name.substring(0,80);
        JSONObject body=new JSONObject()
            .put("p_device_key",key)
            .put("p_device_name",name.isEmpty()?"Android device":name)
            .put("p_platform","Android");
        CloudPurchase.request("/rest/v1/rpc/privacy_chat_register_device",accessToken,body);
    }
}
