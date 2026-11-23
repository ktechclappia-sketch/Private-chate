package com.privacychat.app;

import android.app.Activity;
import android.os.Bundle;
import android.graphics.Color;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

public class MainActivity extends Activity {
  private LinearLayout root;
  private EditText pin;
  @Override public void onCreate(Bundle state) { super.onCreate(state); showWelcome(); }
  private void base(String heading) {
    root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL);
    root.setPadding(48,64,48,32); root.setBackgroundColor(Color.rgb(248,249,252));
    setContentView(root);
    TextView title = new TextView(this); title.setText(heading); title.setTextSize(26);
    title.setTextColor(Color.rgb(23,34,55)); title.setPadding(0,0,0,32); root.addView(title);
  }
  private TextView info(String text) {
    TextView v = new TextView(this); v.setText(text); v.setTextSize(16);
    v.setTextColor(Color.DKGRAY); v.setPadding(0,12,0,20); root.addView(v); return v;
  }
  private EditText field(String hint, int type) {
    EditText e = new EditText(this); e.setHint(hint); e.setInputType(type); root.addView(e); return e;
  }
  private void button(String name, View.OnClickListener click) {
    Button b = new Button(this); b.setText(name); b.setOnClickListener(click); root.addView(b);
  }
  private void showWelcome() {
    base("Privacy Chat");
    info("Native Android starter • Demo only\nNo messages are sent or stored online.");
    field("Email address (UI preview)", 33);
    field("Login password (UI preview)", 129);
    button("Preview chat lock", v -> showLock());
    info("Authentication, friend requests, photo sharing and Supabase are not connected yet.");
  }
  private void showLock() {
    base("Chat Lock Preview");
    info("This is a UI demonstration, not a secure PIN implementation.");
    pin = field("Chat PIN (demo)", 18);
    button("Open demo chat", v -> showChat());
    button("Back", v -> showWelcome());
  }
  private void showChat() {
    base("Chat Preview");
    info("Private chat interface placeholder.\nLive messaging will require Supabase Auth, database policies and realtime setup.");
    field("Type a message (not sent)", 1);
    button("Back to lock", v -> showLock());
  }
}
