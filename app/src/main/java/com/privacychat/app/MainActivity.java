package com.privacychat.app;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.content.Intent;
import android.net.Uri;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.util.Base64;
import android.view.WindowManager;
import android.widget.*;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import org.json.*;

public class MainActivity extends Activity {
    private LinearLayout root;
    private TextView status;
    private final ExecutorService queue = Executors.newSingleThreadExecutor();
    private final Handler timer = new Handler(android.os.Looper.getMainLooper());
    private SessionVault vault;
    private JSONObject session;
    private int screen;
    private boolean busy, foreground, owner;
    private Uri pendingPhoto;
    private String photoRoom;
    private String accessState;
    private int unlockGeneration;
    private final Runnable accessCheck = this::checkAccess;
    private final Runnable lockTimer = this::lock;
    interface Work { Object run() throws Exception; }
    interface Done { void accept(Object value) throws Exception; }

    @Override public void onCreate(Bundle b) {
        super.onCreate(null);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        vault = new SessionVault(this);
        try { session = vault.load(); } catch(Exception e) { login(); status.setText("Saved session unavailable. Sign in again."); return; }
        if(session == null) login(); else lock();
    }
    @Override protected void onResume(){super.onResume();foreground=true;}
    @Override protected void onPause(){foreground=false; if(session!=null) lock(); else {screen++;busy=false;} super.onPause();}
    @Override protected void onDestroy(){timer.removeCallbacksAndMessages(null);queue.shutdown();super.onDestroy();}
    @Override public void onUserInteraction(){super.onUserInteraction();armTimer();}
    private void armTimer(){timer.removeCallbacks(lockTimer);if(owner)timer.postDelayed(lockTimer,120000);}
    @Override public void onBackPressed(){if(owner){lock();}else super.onBackPressed();}
    private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
    private void page(String title){
        screen++;busy=false;
        ScrollView scroll=new ScrollView(this);
        scroll.setBackgroundColor(Color.rgb(255,241,247));
        root=new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL);root.setPadding(dp(16),dp(12),dp(16),dp(20));
        scroll.addView(root);setContentView(scroll);
        scroll.setOnApplyWindowInsetsListener((v,i)->{v.setPadding(i.getSystemWindowInsetLeft(),i.getSystemWindowInsetTop(),i.getSystemWindowInsetRight(),i.getSystemWindowInsetBottom());return i;});scroll.requestApplyInsets();
        TextView heading=label(title);heading.setTextSize(23);heading.setTextColor(Color.rgb(126,30,77));status=label("");
        status.setAccessibilityLiveRegion(android.view.View.ACCESSIBILITY_LIVE_REGION_POLITE);
    }
    private TextView label(String text){TextView v=new TextView(this);v.setText(text);v.setTextColor(Color.rgb(65,36,51));root.addView(v);return v;}
    private EditText field(String hint,int type){EditText e=new EditText(this);e.setHint(hint);e.setInputType(type);e.setSaveEnabled(false);root.addView(e);return e;}
    private void button(String title,Runnable action){Button b=new Button(this);b.setText(title);b.setAllCaps(false);root.addView(b);b.setOnClickListener(v->{if(!busy)action.run();});}
    private void task(Work work,Done done){
        if(busy)return;busy=true;status.setText("Working…");int version=screen;
        queue.execute(()->{try{Object out=work.run();runOnUiThread(()->{
            if(screen!=version||!foreground||isDestroyed())return;busy=false;status.setText("");
            try{done.accept(out);}catch(Exception e){error(e);}
        });}catch(Exception e){runOnUiThread(()->{if(screen==version&&foreground){busy=false;error(e);}});}});
    }
    private void error(Exception e){status.setText(e.getMessage()==null?"Request failed. Try again.":e.getMessage());}
    private static JSONObject args(Object... pairs)throws JSONException{JSONObject o=new JSONObject();for(int i=0;i<pairs.length;i+=2)o.put((String)pairs[i],pairs[i+1]);return o;}
    private String uid(){return session.optJSONObject("user").optString("id");}
    private void login(){
        owner=false;page("Privacy Chat");EditText email=field("Email",33),password=field("Account password",129);
        button("Sign in",()->authenticate(email,password,false));button("Create account",()->authenticate(email,password,true));
    }
    private void authenticate(EditText email,EditText password,boolean signup){
        String address=email.getText().toString().trim(),pass=password.getText().toString();password.setText("");
        task(()->signup?CloudAuth.signup(address,pass):CloudAuth.login(address,pass),value->{
            JSONObject result=(JSONObject)value;if(!result.has("refresh_token")){status.setText("Open the confirmation email, then sign in.");return;}
            synchronized(this){vault.save(result);session=result;} lock();
        });
    }
    private synchronized String token() throws Exception {
        if(session==null)throw new Exception("Sign in required");
        if(session.optLong("expires_at")<System.currentTimeMillis()/1000+90){
            JSONObject fresh=CloudAuth.request("/auth/v1/token?grant_type=refresh_token",args("refresh_token",session.getString("refresh_token")));
            vault.save(fresh);session=fresh;
        }
        return session.getString("access_token");
    }
    private void logout(){
        String accessToken;
        synchronized(this){accessToken=session==null?"":session.optString("access_token");vault.clear();session=null;}
        if(!accessToken.isEmpty())queue.execute(()->{try{
            CloudPurchase.request("/auth/v1/logout?scope=local",accessToken,new JSONObject());
        }catch(Exception ignored){ /* The device session was already cleared. */ }});
        cancelAccessChecks();pendingPhoto=null;photoRoom=null;timer.removeCallbacks(lockTimer);login();
    }
    private void lock(){
        owner=false;cancelAccessChecks();timer.removeCallbacks(lockTimer);if(session==null){login();return;}
        SecretStore secrets=new SecretStore(this,uid());
        if(!secrets.configured()){
            page("Set your two secret passwords");EditText a=field("Full chat password · 8+ characters",129),b=field("Empty view password · 8+ characters",129);
            button("Save passwords",()->{char[] x=a.getText().toString().toCharArray(),y=b.getText().toString().toCharArray();a.setText("");b.setText("");
                task(()->{secrets.configure(x,y);return null;},v->lock());});
        }else{
            page("Privacy Chat");EditText p=field("Secret password",129);
            button("Unlock",()->{
                if(secrets.retryDelay()>0){status.setText("Try again in 30 seconds.");return;}
                char[] x=p.getText().toString().toCharArray();p.setText("");
                task(()->secrets.unlock(x),v->{int mode=(Integer)v;if(mode==0){status.setText("Incorrect password");return;}
                    if(mode==1){owner=true;armTimer();home();}else{pendingPhoto=null;photoRoom=null;page("Privacy Chat");label("No conversations");button("Lock",this::lock);}});
            });
        }
        button("Sign out",this::logout);
    }
    protected Object rpc(String op,JSONObject input)throws Exception{
        String result=CloudPurchase.request("/rest/v1/rpc/privacy_chat_action",token(),args("op",op,"args",input));
        return new JSONTokener(result).nextValue();
    }
    private void call(String op,Done done,Object... pairs){task(()->rpc(op,args(pairs)),done);}
    private void cancelAccessChecks(){
        unlockGeneration++;accessState=null;timer.removeCallbacks(accessCheck);
    }
    private static String accessState(JSONObject a){
        return a.optBoolean("enabled",true)+":"+a.optBoolean("active")+":"+a.optBoolean("admin")+":"+a.optBoolean("free_testing")+":"+a.optString("end")+":"+a.optString("payment");
    }
    private void scheduleAccessCheck(){
        timer.removeCallbacks(accessCheck);
        if(owner&&foreground)timer.postDelayed(accessCheck,15000);
    }
    private void checkAccess(){
        if(!owner||!foreground)return;
        final int generation=unlockGeneration;
        queue.execute(()->{
            try{
                JSONObject a=(JSONObject)rpc("access",new JSONObject());
                runOnUiThread(()->{
                    if(generation!=unlockGeneration||!owner||!foreground||isDestroyed())return;
                    if(!accessState(a).equals(accessState))home();else scheduleAccessCheck();
                });
            }catch(Exception e){runOnUiThread(()->{
                if(generation==unlockGeneration && owner && foreground && !isDestroyed()){
                    lock();status.setText("Connection interrupted. Unlock to check access again.");
                }
            });}
        });
    }
    private void home(){
        page("Privacy Chat");button("Lock",this::lock);button("Refresh",this::home);
        call("access",v->{JSONObject a=(JSONObject)v;accessState=accessState(a);scheduleAccessCheck();
            if(!a.optBoolean("enabled",true)){
                pendingPhoto=null;photoRoom=null;page("Account deactivated");
                label("Contact the Privacy Chat admin to restore access.");button("Refresh access",this::home);button("Lock",this::lock);return;
            }
            if(!a.getBoolean("active")){subscription(a);return;}
            if(pendingPhoto!=null&&photoRoom!=null){confirmPhoto();return;}
            if(a.optBoolean("admin")){label("Admin · Free testing");button("Review UPI payments",this::reviews);}
            else if(a.optBoolean("free_testing"))label("Free testing access");
            else label("Active until "+displayValue(a,"end"));
            button("Personal chat · invite by email",()->entry(false));button("Create group",()->entry(true));
            call("rooms",rooms->{JSONArray list=(JSONArray)rooms;if(list.length()==0)label("No conversations");
                for(int i=0;i<list.length();i++){JSONObject row=list.getJSONObject(i);String id=row.getString("room"),title=row.getString("title");
                    if(row.getBoolean("accepted"))button(title,()->thread(row,null));else{
                        label("Invitation · "+title);button("Accept",()->call("accept",z->home(),"room",id));button("Decline",()->call("decline",z->home(),"room",id));}}
            });
        });
    }
    private void entry(boolean group){
        page(group?"New group":"Personal chat");EditText e=field(group?"Group name":"Registered contact email",group?1:33);
        button(group?"Create":"Invite",()->call(group?"group":"personal",v->home(),group?"title":"email",e.getText().toString()));button("Dashboard",this::home);
    }
    private void thread(JSONObject room,Long before){
        String id=room.optString("room");page(room.optString("title"));button("Dashboard",this::home);
        button("Members",()->members(room));button("Latest messages",()->thread(room,null));
        EditText body=field("Message",android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        button("Send",()->call("send",z->thread(room,null),"room",id,"body",body.getText().toString()));
        button("Choose photo",()->{photoRoom=id;Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE);try{startActivityForResult(intent,17);}catch(Exception ex){error(ex);}});
        call("messages",v->{JSONArray messages=(JSONArray)v;if(messages.length()==40)button("Earlier messages",()->thread(room,messages.optJSONObject(0).optLong("id")));
            for(int i=0;i<messages.length();i++){JSONObject m=messages.getJSONObject(i);label(m.optString("email")+" · "+m.optString("sent_at"));label(m.optString("body"));
                if(m.optBoolean("photo"))button("View photo",()->call("photo",data->{byte[] bytes=Base64.decode((String)data,0);ImageView image=new ImageView(this);image.setAdjustViewBounds(true);image.setImageBitmap(BitmapFactory.decodeByteArray(bytes,0,bytes.length));root.addView(image);},"id",m.optLong("id"),"room",id));}
        },"room",id,"before",before);
    }
    private void members(JSONObject room){
        String id=room.optString("room");page("Members");button("Conversation",()->thread(room,null));
        if(room.optBoolean("owner")&&"group".equals(room.optString("kind"))){EditText e=field("Registered member email",33);button("Invite member",()->call("invite",v->members(room),"room",id,"email",e.getText().toString()));}
        call("members",v->{JSONArray list=(JSONArray)v;for(int i=0;i<list.length();i++){JSONObject m=list.getJSONObject(i);label(m.optString("email")+(m.optBoolean("accepted")?"":" · Invited"));if(m.optBoolean("removable"))button("Remove "+m.optString("email"),()->call("remove",z->members(room),"room",id,"person",m.optString("person")));}},"room",id);
    }
    @Override protected void onActivityResult(int req,int result,Intent data){super.onActivityResult(req,result,data);if(req==17&&result==RESULT_OK&&data!=null)pendingPhoto=data.getData();}
    private String photo(Uri uri)throws Exception{
        BitmapFactory.Options opt=new BitmapFactory.Options();opt.inJustDecodeBounds=true;
        try(InputStream in=getContentResolver().openInputStream(uri)){BitmapFactory.decodeStream(in,null,opt);}
        opt.inJustDecodeBounds=false;opt.inSampleSize=1;while(Math.max(opt.outWidth,opt.outHeight)/opt.inSampleSize>1280)opt.inSampleSize*=2;
        Bitmap bitmap;try(InputStream in=getContentResolver().openInputStream(uri)){bitmap=BitmapFactory.decodeStream(in,null,opt);}
        if(bitmap==null)throw new Exception("Unsupported picture");try(ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
            for(int quality=80;quality>=20;quality-=15){bytes.reset();bitmap.compress(Bitmap.CompressFormat.JPEG,quality,bytes);if(bytes.size()<=375000)return Base64.encodeToString(bytes.toByteArray(),Base64.NO_WRAP);}
            throw new Exception("Choose a smaller picture");}finally{bitmap.recycle();}
    }
    private void confirmPhoto(){
        page("Share selected photo");Uri uri=pendingPhoto;String room=photoRoom;
        button("Send photo to selected conversation",()->task(()->rpc("send",args("room",room,"photo",photo(uri))),v->{pendingPhoto=null;photoRoom=null;home();}));
        button("Discard",()->{pendingPhoto=null;photoRoom=null;home();});
    }
    private static String displayValue(JSONObject o,String key){return o.isNull(key)?"—":o.optString(key);}
    private void subscription(JSONObject a){
        page("Privacy Chat · ₹100 per month");label("Start: "+displayValue(a,"start")+"   End: "+displayValue(a,"end"));label("Last payment: "+displayValue(a,"payment"));label(CloudConfig.UPI_ID);
        button("Pay ₹100 with UPI",()->{Uri pay=Uri.parse("upi://pay").buildUpon().appendQueryParameter("pa",CloudConfig.UPI_ID).appendQueryParameter("pn","Privacy Chat").appendQueryParameter("am","100.00").appendQueryParameter("cu","INR").build();try{startActivity(new Intent(Intent.ACTION_VIEW,pay));}catch(Exception ex){status.setText("Use the displayed UPI ID in your payment app.");}});
        EditText ref=field("UPI transaction reference",1);
        button("Submit for verification",()->{String reference=ref.getText().toString().trim();if(reference.length()<8||reference.length()>80){status.setText("Enter the UPI transaction reference (8–80 characters).");return;}task(()->{CloudPurchase.submit(token(),uid(),reference);return null;},v->home());});
        button("Refresh access",this::home);button("Lock",this::lock);
    }
    private void reviews(){
        page("UPI payment review");button("Dashboard",this::home);
        call("payments",v->{JSONArray list=(JSONArray)v;if(list.length()==0)label("No pending payments");for(int i=0;i<list.length();i++){JSONObject p=list.getJSONObject(i);label(p.optString("email")+" · ₹100 · "+p.optString("reference"));button("Confirm ₹100 received",()->call("approve",z->reviews(),"id",p.optString("id")));button("Reject",()->call("reject",z->reviews(),"id",p.optString("id")));}});
    }
}
