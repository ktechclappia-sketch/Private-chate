package com.privacychat.app;
import android.app.Activity;
import android.os.Bundle;
import android.graphics.Color;
import android.widget.*;
import org.json.JSONObject;
public class MainActivity extends Activity {
 LinearLayout root;
 @Override public void onCreate(Bundle b){super.onCreate(b);loginScreen();}
 void base(String title){root=new LinearLayout(this);root.setOrientation(1);root.setPadding(40,48,40,24);root.setBackgroundColor(Color.rgb(255,240,247));setContentView(root);label(title);}
 TextView label(String s){TextView t=new TextView(this);t.setText(s);t.setTextSize(18);root.addView(t);return t;}
 EditText field(String hint,int type){EditText e=new EditText(this);e.setHint(hint);e.setInputType(type);root.addView(e);return e;}
 Button button(String s,Runnable action){Button b=new Button(this);b.setText(s);b.setOnClickListener(v->action.run());root.addView(b);return b;}
 void loginScreen(){base("Privacy Chat");EditText email=field("Email",33),password=field("Password",129);TextView status=label("");Button login=button("Login",()->authenticate(email,password,status,false));button("Register",()->authenticate(email,password,status,true));}
 boolean busy=false;
 void authenticate(EditText e,EditText p,TextView status,boolean signup){if(busy)return;String email=e.getText().toString().trim(),pass=p.getText().toString();if(email.isEmpty()||pass.isEmpty()){status.setText("Enter email and password");return;}busy=true;status.setText("Connecting...");new Thread(()->{try{JSONObject result=signup?CloudAuth.signup(email,pass):CloudAuth.login(email,pass);boolean session=!result.optString("access_token").isEmpty();runOnUiThread(()->{busy=false;if(session){base("Login successful");label("Subscription and secure chat integration pending.");button("Return to login",()->loginScreen());}else status.setText("Check your email for verification.");});}catch(Exception ex){runOnUiThread(()->{busy=false;status.setText("Authentication failed. Check credentials, email verification and internet.");});}}).start();}
}
