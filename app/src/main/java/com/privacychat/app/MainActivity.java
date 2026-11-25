package com.privacychat.app;
import android.app.Activity;
import android.os.Bundle;
import android.graphics.Color;
import android.widget.*;
import org.json.JSONObject;
public class MainActivity extends Activity {
 LinearLayout root;
 @Override public void onCreate(Bundle b){super.onCreate(b);loginScreen();}
 void base(String title){root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(40,48,40,24);root.setBackgroundColor(Color.rgb(255,240,247));setContentView(root);label(title);}
 TextView label(String s){TextView t=new TextView(this);t.setText(s);t.setTextSize(18);root.addView(t);return t;}
 EditText field(String hint,int type){EditText e=new EditText(this);e.setHint(hint);e.setInputType(type);root.addView(e);return e;}
 Button button(String s,Runnable action){Button b=new Button(this);b.setText(s);b.setOnClickListener(v->action.run());root.addView(b);return b;}
 void loginScreen(){base("Privacy Chat");EditText email=field("Email",33),password=field("Password",129);TextView status=label("");Button login=button("Login",()->authenticate(email,password,status,false));button("Register",()->authenticate(email,password,status,true));}
 String token="",userId="";
 void purchaseScreen(){
 base("Privacy Chat Premium");
 label("₹100 / Month");
 TextView dates=label("Checking subscription...");
 label("UPI: "+CloudConfig.UPI_ID);
 button("Purchase Now / Purchase Again",()->{try{
 android.net.Uri uri=android.net.Uri.parse("upi://pay").buildUpon().appendQueryParameter("pa",CloudConfig.UPI_ID).appendQueryParameter("pn","Privacy Chat").appendQueryParameter("am","100.00").appendQueryParameter("cu","INR").build();
 startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW,uri));
 }catch(Exception ex){dates.setText("UPI app unavailable. Pay using the displayed UPI ID.");}});
 EditText reference=field("UPI Transaction Reference",1);
 TextView status=label("");
 button("Submit Payment",()->{String ref=reference.getText().toString().trim();if(ref.length()<8||ref.length()>80){status.setText("Enter valid transaction reference");return;}if(busy)return;busy=true;status.setText("Submitting...");String t=token,u=userId;new Thread(()->{try{CloudPurchase.submit(t,u,ref);runOnUiThread(()->{busy=false;status.setText("Submitted: Pending Admin Approval");});}catch(Exception ex){runOnUiThread(()->{busy=false;status.setText("Submission failed. Check connection or duplicate reference.");});}}).start();});
 button("Refresh Subscription",()->refreshDates(dates));
 button("Sign Out",()->{token="";userId="";loginScreen();});
 refreshDates(dates);
 }
 void refreshDates(TextView dates){String t=token;new Thread(()->{try{org.json.JSONArray a=CloudPurchase.subscription(t);String msg="Start Date: Not activated\nEnd Date: —";if(a.length()>0){JSONObject row=a.getJSONObject(0);msg="Start Date: "+row.optString("starts_at")+"\nEnd Date: "+row.optString("ends_at");}final String result=msg;runOnUiThread(()->dates.setText(result));}catch(Exception ex){runOnUiThread(()->dates.setText("Unable to load subscription. Try again."));}}).start();}
 boolean busy=false;
 void authenticate(EditText e,EditText p,TextView status,boolean signup){if(busy)return;String email=e.getText().toString().trim(),pass=p.getText().toString();if(email.isEmpty()||pass.isEmpty()){status.setText("Enter email and password");return;}busy=true;status.setText("Connecting...");new Thread(()->{try{JSONObject result=signup?CloudAuth.signup(email,pass):CloudAuth.login(email,pass);boolean session=!result.optString("access_token").isEmpty();runOnUiThread(()->{busy=false;if(session){token=result.optString("access_token");JSONObject user=result.optJSONObject("user");userId=user==null?"":user.optString("id");purchaseScreen();}else status.setText("Check your email for verification.");});}catch(Exception ex){runOnUiThread(()->{busy=false;status.setText("Authentication failed. Check credentials, email verification and internet.");});}}).start();}
}
