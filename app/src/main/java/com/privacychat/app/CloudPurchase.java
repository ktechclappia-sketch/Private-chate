package com.privacychat.app;
import javax.net.ssl.HttpsURLConnection;
import java.net.URL;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.json.JSONObject;
import org.json.JSONArray;
final class CloudPurchase {
 static final class InactiveDeviceException extends java.io.IOException {
  InactiveDeviceException() { super("This device session is inactive. Sign in again."); }
 }
 static String request(String path,String token,JSONObject body)throws Exception{
 if(token==null||token.isEmpty())throw new IllegalArgumentException("Login required");
 HttpsURLConnection c=(HttpsURLConnection)new URL(CloudConfig.URL+path).openConnection();
 try{
 c.setInstanceFollowRedirects(false);c.setConnectTimeout(15000);c.setReadTimeout(15000);
 c.setRequestProperty("apikey",CloudConfig.PUBLIC_KEY);
 c.setRequestProperty("Authorization","Bearer "+token);
 if(body!=null){c.setRequestMethod("POST");c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");try(java.io.OutputStream o=c.getOutputStream()){o.write(body.toString().getBytes(StandardCharsets.UTF_8));}}
 int code=c.getResponseCode();
 if(code==409 && path.equals("/rest/v1/rpc/privacy_chat_action")){
  try(InputStream in=c.getErrorStream()){
   if(in!=null && "PT409".equals(new JSONObject(readError(in)).optString("code")))
    throw new InactiveDeviceException();
  } catch(org.json.JSONException ignored){ /* Other HTTP conflicts use the default error. */ }
 }
 if(code<200||code>=300)throw new java.io.IOException("Cloud request failed: "+code);
 try(java.io.InputStream in=c.getInputStream();java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream()){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1)out.write(b,0,n);return out.toString("UTF-8");}
 }finally{c.disconnect();}
 }
 private static String readError(InputStream in) throws java.io.IOException {
  byte[] buffer=new byte[2048];
  java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream();
  int remaining=8192;
  while(remaining>0){
   int read=in.read(buffer,0,Math.min(remaining,buffer.length));
   if(read<0)break;
   out.write(buffer,0,read);
   remaining-=read;
  }
  return out.toString("UTF-8");
 }
 static JSONArray subscription(String token)throws Exception{return new JSONArray(request("/rest/v1/privacy_subscriptions?select=starts_at,ends_at",token,null));}
 static JSONArray paymentRequests(String token)throws Exception{
  JSONObject body=new JSONObject().put("op","my_requests").put("args",new JSONObject());
  return new JSONArray(request("/rest/v1/rpc/privacy_payment_request_action",token,body));
 }
 static String uploadProof(String token,String userId,String requestId,byte[] jpeg)throws Exception{
  if(!userId.matches("[0-9a-fA-F-]{36}")||!requestId.matches("[0-9a-fA-F-]{36}")||jpeg==null||jpeg.length<4||jpeg.length>5242880)
   throw new IllegalArgumentException("Invalid payment proof");
  String name=UUID.randomUUID().toString()+".jpg";
  String path=userId+"/"+requestId+"/"+name;
  HttpsURLConnection c=(HttpsURLConnection)new URL(CloudConfig.URL+"/storage/v1/object/privacy-payment-proofs/"+path).openConnection();
  try{
   c.setRequestMethod("POST");c.setDoOutput(true);c.setConnectTimeout(15000);c.setReadTimeout(20000);
   c.setRequestProperty("apikey",CloudConfig.PUBLIC_KEY);c.setRequestProperty("Authorization","Bearer "+token);
   c.setRequestProperty("Content-Type","image/jpeg");c.setRequestProperty("x-upsert","false");
   c.setFixedLengthStreamingMode(jpeg.length);
   try(java.io.OutputStream o=c.getOutputStream()){o.write(jpeg);}
   int code=c.getResponseCode();
 if(code==409 && path.equals("/rest/v1/rpc/privacy_chat_action")){
  try(InputStream in=c.getErrorStream()){
   if(in!=null && "PT409".equals(new JSONObject(readError(in)).optString("code")))
    throw new InactiveDeviceException();
  } catch(org.json.JSONException ignored){ /* Other HTTP conflicts use the default error. */ }
 }
 if(code<200||code>=300)throw new java.io.IOException("Screenshot upload failed: "+code);
   return path;
  }finally{c.disconnect();}
 }
 static void submitProof(String token,String userId,String requestId,String utr,byte[] jpeg)throws Exception{
  String path=uploadProof(token,userId,requestId,jpeg);
  JSONObject args=new JSONObject().put("request_id",requestId).put("utr_number",utr.trim()).put("screenshot_path",path);
  JSONObject body=new JSONObject().put("op","submit_proof").put("args",args);
  request("/rest/v1/rpc/privacy_payment_request_action",token,body);
 }
}
