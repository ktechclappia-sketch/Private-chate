package com.privacychat.app;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;
import java.io.InputStream;
final class CloudAuth {
 static JSONObject request(String path, JSONObject body) throws Exception {
  HttpsURLConnection c=(HttpsURLConnection)new URL(CloudConfig.URL+path).openConnection();
  try {
   c.setConnectTimeout(15000); c.setReadTimeout(15000);
   c.setInstanceFollowRedirects(false);
   c.setRequestMethod("POST"); c.setDoOutput(true);
   c.setRequestProperty("apikey",CloudConfig.PUBLIC_KEY);
   c.setRequestProperty("Content-Type","application/json");
   try(java.io.OutputStream out=c.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));}
   int status=c.getResponseCode();
   InputStream stream=status>=200 && status<300?c.getInputStream():c.getErrorStream();
   if(stream==null) throw new java.io.IOException("Cloud request failed: "+status);
   java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();
   try(InputStream in=stream){byte[] buf=new byte[4096];int n;while((n=in.read(buf))!=-1)bytes.write(buf,0,n);}
   JSONObject result=new JSONObject(bytes.toString("UTF-8"));
   if(status<200 || status>=300)throw new java.io.IOException(result.optString("msg",result.optString("message","Authentication failed")));
   return result;
  } finally {c.disconnect();}
 }
 static JSONObject login(String email,String password)throws Exception {
  return request("/auth/v1/token?grant_type=password",new JSONObject().put("email",email).put("password",password));
 }
 static JSONObject signup(String email,String password)throws Exception {
  return request("/auth/v1/signup",new JSONObject().put("email",email).put("password",password).put("data",new JSONObject().put("registration_app","privacy_chat")));
 }
}
