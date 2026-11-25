package com.privacychat.app;
import javax.net.ssl.HttpsURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;
import org.json.JSONArray;
final class CloudPurchase {
 static String request(String path,String token,JSONObject body)throws Exception{
 if(token==null||token.isEmpty())throw new IllegalArgumentException("Login required");
 HttpsURLConnection c=(HttpsURLConnection)new URL(CloudConfig.URL+path).openConnection();
 try{
 c.setInstanceFollowRedirects(false);c.setConnectTimeout(15000);c.setReadTimeout(15000);
 c.setRequestProperty("apikey",CloudConfig.PUBLIC_KEY);
 c.setRequestProperty("Authorization","Bearer "+token);
 if(body!=null){c.setRequestMethod("POST");c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");try(java.io.OutputStream o=c.getOutputStream()){o.write(body.toString().getBytes(StandardCharsets.UTF_8));}}
 int code=c.getResponseCode();if(code<200||code>=300)throw new java.io.IOException("Cloud request failed: "+code);
 try(java.io.InputStream in=c.getInputStream();java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream()){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1)out.write(b,0,n);return out.toString("UTF-8");}
 }finally{c.disconnect();}
 }
 static JSONArray subscription(String token)throws Exception{return new JSONArray(request("/rest/v1/privacy_subscriptions?select=starts_at,ends_at",token,null));}
 static void submit(String token,String userId,String reference)throws Exception{request("/rest/v1/privacy_payments",token,new JSONObject().put("user_id",userId).put("upi_reference",reference.trim()));}
}
