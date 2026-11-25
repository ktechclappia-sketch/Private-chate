package com.privacychat.app;
import android.content.Context;
import android.content.SharedPreferences;
import java.util.Arrays;
final class SecretStore {
 private final SharedPreferences prefs;
 private final String prefix;
 SecretStore(Context context,String userId){
 if(userId==null||!userId.matches("[0-9a-fA-F-]{36}"))throw new IllegalArgumentException("Invalid account");
 prefs=context.getSharedPreferences("private_lock",Context.MODE_PRIVATE);prefix=userId+":";
 }
 boolean configured(){return prefs.contains(prefix+"owner")&&prefs.contains(prefix+"restricted");}
 synchronized void configure(char[] owner,char[] restricted)throws Exception{
 try{
 if(configured())throw new IllegalStateException("Already configured");
 if(Arrays.equals(owner,restricted))throw new IllegalArgumentException("Passwords must differ");
 String a=SecretVerifier.create(owner),b=SecretVerifier.create(restricted);
 if(!prefs.edit().putString(prefix+"owner",a).putString(prefix+"restricted",b).commit())throw new IllegalStateException("Save failed");
 }finally{Arrays.fill(owner,'\0');Arrays.fill(restricted,'\0');}
 }
 synchronized int unlock(char[] password)throws Exception{
 try{
 if(!configured())return 0;
 boolean a=SecretVerifier.verify(password,prefs.getString(prefix+"owner",null));
 boolean b=SecretVerifier.verify(password,prefs.getString(prefix+"restricted",null));
 return a?1:b?2:0;
 }finally{Arrays.fill(password,'\0');}
 }
}
