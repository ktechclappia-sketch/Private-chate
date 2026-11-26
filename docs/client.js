'use strict';

const BASE='https://plwpjflifvndejidiwqa.supabase.co';
const KEY='sb_publishable_TJMHDU9hFHqenS9g0jPnOw_e9TmQVvj';
const UPI='9923237174-2@ybl';
const $=id=>document.getElementById(id);
let session=null, busy=false, generation=0, current='overview', access=null, payments=[], devices=[];
const money=new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0});
const dateFmt=new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric',timeZone:'Asia/Kolkata'});
const niceDate=v=>v&&Number.isFinite(Date.parse(v))?dateFmt.format(new Date(v)):'—';
function status(target,msg){$(target).textContent=msg||'';}
function add(tag,text,cls){const n=document.createElement(tag);n.textContent=text??'';if(cls)n.className=cls;return n;}
function safeDate(v){return v?niceDate(v):'—';}
async function request(path,method='POST',body=null,token=null,headers={}){
  const h={apikey:KEY,...headers};
  if(body!==null)h['Content-Type']='application/json';
  if(token)h.Authorization='Bearer '+token;
  const r=await fetch(BASE+path,{method,headers:h,body:body===null?undefined:JSON.stringify(body),cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(18000)});
  const raw=await r.text();let data=null;
  if(raw){try{data=JSON.parse(raw)}catch{data=raw}}
  if(!r.ok)throw new Error(data?.msg||data?.message||data?.error_description||'Request failed ('+r.status+').');
  return data;
}
async function token(expected){
  if(!session||expected!==generation)throw new Error('Sign in again to continue.');
  if(session.expires_at*1000<Date.now()+30000){
    session=await request('/auth/v1/token?grant_type=refresh_token','POST',{refresh_token:session.refresh_token});
    if(expected!==generation)throw new Error('Session ended.');
  }
  return session.access_token;
}
function showSection(id){
  current=id;
  document.querySelectorAll('.section').forEach(s=>s.hidden=s.id!==id);
  document.querySelectorAll('.nav-link').forEach(b=>b.classList.toggle('current',b.dataset.section===id));
}
function pill(value){
  const p=add('span',value,'pill');
  const s=String(value||'').toLowerCase();
  if(s==='approved'||s==='success')p.classList.add('approved');
  else if(s==='rejected')p.classList.add('rejected');
  return p;
}
function drawTable(target,rows,empty){
  const host=$(target);host.replaceChildren();
  if(!rows.length){host.append(add('p',empty,'empty'));return}
  const wrap=add('div',undefined,'table-wrap'),t=document.createElement('table'),head=t.createTHead().insertRow();
  ['Date','Plan','Amount','UPI reference','Status'].forEach(x=>{const th=add('th',x);th.scope='col';head.append(th)});
  const body=t.createTBody();
  rows.forEach(p=>{const tr=body.insertRow();[safeDate(p.created_at),'Monthly',money.format(Number(p.amount_paise||10000)/100),p.upi_reference||'—',pill(p.status)].forEach((v,i)=>{const td=tr.insertCell();if(v instanceof Node)td.append(v);else td.textContent=v})});
  wrap.append(t);host.append(wrap);
}
function drawDevices(){
  const host=$('devices-list');host.replaceChildren();
  if(!devices.length){host.append(add('p','No devices registered yet. Sign in here to register this browser.','empty'));return}
  const wrap=add('div',undefined,'table-wrap'),t=document.createElement('table'),head=t.createTHead().insertRow();
  ['Device','Type','First seen','Last active'].forEach(x=>{const th=add('th',x);th.scope='col';head.append(th)});
  const body=t.createTBody();
  devices.forEach((d,i)=>{const tr=body.insertRow();[d.device_name||'Device '+(i+1),d.platform||'—',safeDate(d.first_seen_at),safeDate(d.last_seen_at)].forEach(v=>{const td=tr.insertCell();td.textContent=v})});
  wrap.append(t);host.append(wrap);
}
async function load(expected){
  const accessData=await request('/rest/v1/rpc/privacy_chat_action','POST',{op:'access',args:{}},await token(expected));
  if(expected!==generation)return;
  access=accessData||{};
  const uid=session.user.id;
  const bearer=await token(expected);
  const [payResult,subResult,deviceResult]=await Promise.all([
    request('/rest/v1/privacy_payments?select=id,amount_paise,upi_reference,status,created_at,reviewed_at&user_id=eq.'+encodeURIComponent(uid)+'&order=created_at.desc','GET',null,bearer),
    request('/rest/v1/privacy_subscriptions?select=starts_at,ends_at&user_id=eq.'+encodeURIComponent(uid),'GET',null,bearer),
    request('/rest/v1/rpc/privacy_chat_list_devices','POST',{},bearer)
  ]);
  if(expected!==generation)return;
  payments=Array.isArray(payResult)?payResult:[];
  devices=Array.isArray(deviceResult)?deviceResult:[];
  const sub=Array.isArray(subResult)&&subResult[0]?subResult[0]:null;
  const enabled=access.enabled!==false, active=access.active===true;
  const label=!enabled?'Deactivated':active?(access.admin?'Admin access':access.free_testing?'Free testing':'Active'):(sub&&Date.parse(sub.ends_at)<=Date.now()?'Expired':'Inactive');
  $('user-email').textContent=session.user.email||'Client';
  $('profile-email').textContent=session.user.email||'—';
  $('profile-email-full').textContent=session.user.email||'—';
  $('start-date').textContent=safeDate(access.start||sub?.starts_at);
  $('end-date').textContent=safeDate(access.end||sub?.ends_at);
  $('overview-status').textContent=label==='Active'?'Subscription active':label+' access';
  $('subscription-status').textContent=label;
  $('subscription-start').textContent=safeDate(access.start||sub?.starts_at);
  $('subscription-end').textContent=safeDate(access.end||sub?.ends_at);
  $('status-badge').textContent=label;
  $('status-badge').className='badge '+(active?'':'muted');
  $('app-access').textContent=label;
  $('app-access').className='badge '+(active?'':'muted');
  $('device-count').textContent=String(devices.length);
  drawTable('payments-list',payments,'No payments submitted yet.');
  drawTable('recent-payments',payments.slice(0,3),'No recent payments.');
  drawDevices();
  status('app-status','Updated '+new Intl.DateTimeFormat('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'}).format(new Date())+' IST');
}
async function run(work){
  if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);
  const expected=generation;
  try{await work(expected)}catch(e){status('app-status',e.message);if(/invalid|expired|refresh token/i.test(e.message)){signOut(true);status('login-status','Session expired. Sign in again.')}}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false)}
}
function signOut(showLogin=true){
  generation++;session=null;access=null;payments=[];devices=[];
  if(showLogin){$('app').hidden=true;$('login').hidden=false;$('password').value='';status('login-status','Signed out.')}
}
function deviceKey(){
  let key=localStorage.getItem('privacy-chat-device-key');
  if(!key){key=crypto.randomUUID?crypto.randomUUID():'pc-'+Array.from(crypto.getRandomValues(new Uint8Array(24))).map(x=>x.toString(16).padStart(2,'0')).join('');localStorage.setItem('privacy-chat-device-key',key)}
  return key;
}
async function registerDevice(expected){
  const ua=navigator.userAgent;
  const platform=/Android/i.test(ua)?'Android':'Web';
  const label=platform==='Android'?'Android device':'Web browser';
  await request('/rest/v1/rpc/privacy_chat_register_device','POST',{p_device_key:deviceKey(),p_device_name:label,p_platform:platform},await token(expected));
}
async function login(e){
  e.preventDefault();if(busy)return;status('login-status','Signing in…');$('login-status').classList.remove('error');
  const email=$('email').value.trim().toLowerCase(),password=$('password').value;
  try{
    session=await request('/auth/v1/token?grant_type=password','POST',{email,password});
    session.expires_at=session.expires_at||Math.floor(Date.now()/1000)+Number(session.expires_in||3600);
    if(!session.user?.id||!session.access_token)throw new Error('Sign-in response was incomplete.');
    generation++;const expected=generation;
    const result=await request('/rest/v1/rpc/privacy_chat_action','POST',{op:'access',args:{}},session.access_token);
    if(!result)throw new Error('Account access could not be loaded.');
    access=result;
    await registerDevice(expected);
    $('login').hidden=true;$('app').hidden=false;
    $('user-email').textContent=session.user.email||'Client';
    await load(expected);showSection(current);
  }catch(e){session=null;status('login-status',e.message);$('login-status').classList.add('error')}
}
function submitPayment(e){
  e.preventDefault();run(async expected=>{
    const ref=$('upi-reference').value.trim();
    if(ref.length<8||ref.length>80)throw new Error('Enter a UPI reference between 8 and 80 characters.');
    if(payments.some(p=>p.status==='pending'))throw new Error('A payment is already pending admin approval.');
    const uid=session.user.id;
    await request('/rest/v1/privacy_payments','POST',{user_id:uid,upi_reference:ref},await token(expected),{Prefer:'return=minimal'});
    $('upi-reference').value='';
    status('payment-status','Reference submitted. Subscription activates after admin approval.');
    await load(expected);
  }).catch(e=>status('payment-status',e.message));
}
function start(){
  $('login-form').addEventListener('submit',login);
  $('payment-form').addEventListener('submit',submitPayment);
  $('logout').addEventListener('click',()=>signOut());
  $('refresh').addEventListener('click',()=>run(load));
  $('copy-upi').addEventListener('click',()=>navigator.clipboard?.writeText(UPI).then(()=>status('payment-status','UPI ID copied.')).catch(()=>status('payment-status','Copy the UPI ID shown above.')));
  $('upi-link').href='upi://pay?pa='+encodeURIComponent(UPI)+'&pn=KTech%20IT%20Hub&am=100.00&cu=INR&tn=Privacy%20Chat%20Monthly';
  document.querySelectorAll('[data-section]').forEach(b=>b.addEventListener('click',()=>showSection(b.dataset.section)));
  document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>showSection(b.dataset.go)));
  setInterval(()=>{if(session&&!busy)run(load)},20000);
}
start();
