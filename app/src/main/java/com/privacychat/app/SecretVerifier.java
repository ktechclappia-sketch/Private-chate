package com.privacychat.app;
import java.security.SecureRandom;
import java.security.MessageDigest;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import android.util.Base64;
final class SecretVerifier {
 private static final int ITERATIONS=600000;
 static String create(char[] password)throws Exception{
 if(password.length<8)throw new IllegalArgumentException("Use at least 8 characters");
 byte[] salt=new byte[16];new SecureRandom().nextBytes(salt);
 return Base64.encodeToString(salt,Base64.NO_WRAP)+":"+Base64.encodeToString(derive(password,salt),Base64.NO_WRAP);
 }
 static boolean verify(char[] password,String stored)throws Exception{
 if(stored==null)return false;
 String[] parts=stored.split(":",-1);if(parts.length!=2)return false;
 byte[] salt=Base64.decode(parts[0],Base64.NO_WRAP),expected=Base64.decode(parts[1],Base64.NO_WRAP);
 if(salt.length!=16||expected.length!=32)return false;
 return MessageDigest.isEqual(expected,derive(password,salt));
 }
 private static byte[] derive(char[] password,byte[] salt)throws Exception{
 PBEKeySpec spec=new PBEKeySpec(password,salt,ITERATIONS,256);
 try{return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();}finally{spec.clearPassword();}
 }
}
