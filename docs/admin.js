'use strict';

const base = 'https://plwpjflifvndejidiwqa.supabase.co';
const key = 'sb_publishable_TJMHDU9hFHqenS9g0jPnOw_e9TmQVvj';
const byId = id => document.getElementById(id);
const money = new Intl.NumberFormat('en-IN', {style:'currency', currency:'INR', maximumFractionDigits:2, minimumFractionDigits:0});
const dateFormat = new Intl.DateTimeFormat('en-IN', {day:'2-digit', month:'short', year:'numeric', timeZone:'Asia/Kolkata'});
const monthFormat = new Intl.DateTimeFormat('en-IN', {month:'long', year:'numeric', timeZone:'Asia/Kolkata'});
const timeFormat = new Intl.DateTimeFormat('en-IN', {hour:'2-digit', minute:'2-digit', timeZone:'Asia/Kolkata'});
const views = ['users','requests','payments','collections'];
let session = null, report = null, paymentRequests = [], busy = false, generation = 0, currentView = 'users';
let decision = null, requestTarget = null;
const ADMIN_SESSION_KEY = 'privacyChatAdminSession';
const ADMIN_ACTIVITY_KEY = 'privacyChatAdminLastActivity';
const ADMIN_IDLE_LIMIT = 5 * 60 * 60 * 1000;
const status = message => { byId('status').textContent = message; };
const amount = paise => money.format(Number(paise)/100);
const date = value => value && Number.isFinite(Date.parse(value)) ? dateFormat.format(new Date(value)) : '—';
const lower = value => String(value || '').toLowerCase();

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function pill(value) {
  const state = lower(value);
  const style = ['active','approved','admin free','free testing'].includes(state) ? 'good'
    : state === 'pending' ? 'wait' : ['deactivated','expired','rejected'].includes(state) ? 'off' : '';
  return element('span', String(value).replace(/^./, c=>c.toUpperCase()), 'pill '+style);
}
function action(label, callback) {
  const button = element('button',label);
  button.type = 'button';
  button.addEventListener('click',callback);
  return button;
}
function table(target, headers, rows, empty, compact=false) {
  const container=byId(target);
  container.replaceChildren();
  if (!rows.length) { container.append(element('p',empty,'empty')); return; }
  const grid=element('table',undefined,compact?'':'wide-table');
  const heading=grid.createTHead().insertRow();
  for (const name of headers) { const th=element('th',name); th.scope='col'; heading.append(th); }
  const body=grid.createTBody();
  for (const values of rows) {
    const row=body.insertRow();
    values.forEach((value,index) => {
      const cell=row.insertCell(); cell.dataset.label=headers[index];
      if (value instanceof Node) cell.append(value); else cell.textContent=value ?? '—';
    });
  }
  container.append(grid);
}
function persistSession() {
  if (!session) return;
  try { sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session)); } catch {}
}
async function revokeSession(saved) {
  if (!saved?.access_token) return;
  let bearer=saved.access_token;
  if (saved.refresh_token && saved.expires_at*1000 <= Date.now()) {
    const fresh=await api('/auth/v1/token?grant_type=refresh_token',{refresh_token:saved.refresh_token});
    if (!fresh?.access_token) throw new Error('The session could not be renewed for revocation.');
    bearer=fresh.access_token;
  }
  await api('/auth/v1/logout?scope=local',{},bearer);
}
function expireSession() {
  const saved=session;
  clear();
  status('Signed out after 5 hours of inactivity.');
  revokeSession(saved).catch(()=>{});
}
function recordActivity() {
  if (!session) return;
  const now=Date.now();
  try {
    const last=Number(sessionStorage.getItem(ADMIN_ACTIVITY_KEY));
    if (!last || now-last>=ADMIN_IDLE_LIMIT) { expireSession(); return; }
    sessionStorage.setItem(ADMIN_ACTIVITY_KEY,String(now));
  } catch {}
}
function checkIdle() {
  if (!session) return;
  try {
    const last=Number(sessionStorage.getItem(ADMIN_ACTIVITY_KEY));
    if (!last || Date.now()-last>=ADMIN_IDLE_LIMIT) expireSession();
  } catch { expireSession(); }
}
function restoreSession() {
  let saved, last;
  try {
    const raw=sessionStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return;
    saved=JSON.parse(raw);
    last=Number(sessionStorage.getItem(ADMIN_ACTIVITY_KEY));
  } catch { clear(); return; }
  if (!saved?.access_token || !saved?.refresh_token || !Number.isFinite(last)) { clear(); return; }
  session=saved;
  if (Date.now()-last>=ADMIN_IDLE_LIMIT) { expireSession(); return; }
  run(async expected=>{
    await load(expected);
    if (expected===generation) status('');
  });
}
function clear() {
  generation++; session=null; report=null; decision=null;
  try { sessionStorage.removeItem(ADMIN_SESSION_KEY); sessionStorage.removeItem(ADMIN_ACTIVITY_KEY); } catch {}
  if (byId('confirm').open) byId('confirm').close();
  if (byId('request-dialog').open) byId('request-dialog').close();
  if (byId('proof-dialog').open) byId('proof-dialog').close();
  byId('request-reason').value='';byId('proof-image').removeAttribute('src');requestTarget=null;paymentRequests=[];
  for (const id of ['metrics','user-list','payment-list','pending-list','monthly-list']) byId(id).replaceChildren();
  for (const id of ['updated','user-count','pending-count','nav-pending-count','status']) byId(id).textContent='';
  for (const id of ['password','user-filter','user-search','payment-filter','payment-search']) byId(id).value='';
  byId('panel').hidden=true; byId('tools').hidden=true; byId('login').hidden=false;
  selectView('users');
}
function selectView(view) {
  currentView=view;
  for (const id of views) byId(id).hidden = id!==view;
  for (const button of document.querySelectorAll('[data-view]')) {
    if(button.dataset.view===view) button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  }
}
async function api(path, body, bearer) {
  const headers={apikey:key,'Content-Type':'application/json'};
  if (bearer) headers.Authorization='Bearer '+bearer;
  const r=await fetch(base+path,{method:'POST',headers,body:JSON.stringify(body),cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(20000)});
  let data=null;
  if(r.status!==204) {const raw=await r.text();if(raw)data=JSON.parse(raw);}
  if (!r.ok) {
    const e=new Error(data?.message || data?.msg || data?.error_description || 'The server could not complete this request.');
    e.httpStatus=r.status;
    throw e;
  }
  return data;
}
async function token(expected) {
  if (!session || expected!==generation) throw new Error('Please sign in again.');
  if (session.expires_at*1000 < Date.now()+30000) {
    try {
      const fresh=await api('/auth/v1/token?grant_type=refresh_token',{refresh_token:session.refresh_token});
      if(expected!==generation) throw new Error('Session ended.');
      session=fresh;
      persistSession();
    } catch(e) { if(expected===generation && [400,401,403].includes(e.httpStatus)) clear(); throw e; }
  }
  return session.access_token;
}
async function load(expected) {
  const bearer=await token(expected);
  const [fresh,requests]=await Promise.all([
    api('/rest/v1/rpc/privacy_admin_report',{},bearer),
    api('/rest/v1/rpc/privacy_payment_request_action',{op:'admin_pending',args:{}},bearer)
  ]);
  if(expected!==generation) return;
  if(!fresh || !fresh.summary || !Array.isArray(fresh.users) || !Array.isArray(fresh.payments) || !Array.isArray(fresh.monthly) || !Array.isArray(requests))
    throw new Error('The server returned an incomplete admin report.');
  report=fresh;paymentRequests=requests;
  renderMetrics();renderUsers();renderRequests();renderPayments();renderMonthly();
  byId('updated').textContent='Updated '+timeFormat.format(new Date())+' IST';
  byId('login').hidden=true;byId('panel').hidden=false;byId('tools').hidden=false;
  selectView(currentView);
}
async function run(work) {
  if (busy) return;
  busy=true;
  document.querySelectorAll('button:not(dialog button)').forEach(b=>b.disabled=true);
  try { await work(generation); }
  catch(e) {
    if ([401,403].includes(e.httpStatus) || /admin (access|permission) required/i.test(e.message)) clear();
    status(e.message);
  } finally { busy=false; document.querySelectorAll('button').forEach(b=>b.disabled=false); }
}
function renderMetrics() {
  const s=report.summary;
  const metrics=[['Registered users',s.registered],['Active access',s.active],['Expired',s.expired],
    ['Free access',s.free_testing],['Deactivated',s.deactivated],['Total collected',amount(s.total_collection_paise)]];
  const container=byId('metrics');container.replaceChildren();
  for (const [title,value] of metrics) {
    const card=element('div',undefined,'metric');
    card.append(element('div',title), element('strong',value));container.append(card);
  }
}
function ask(op,args,title,detail,label) {
  if (busy || !session || byId('confirm').open) return;
  decision={op,args};byId('confirm-title').textContent=title;byId('confirm-detail').textContent=detail;byId('confirm-ok').textContent=label;
  byId('confirm').returnValue='cancel';byId('confirm').showModal();
  byId('confirm').querySelector('[value="cancel"]').focus();
}
byId('request-dialog').addEventListener('close',()=>{
  const target=requestTarget;requestTarget=null;
  if(!target || byId('request-dialog').returnValue!=='send')return;
  const reason=byId('request-reason').value.trim();
  if(reason.length<5){status('Enter a reason of at least 5 characters.');return;}
  run(async expected=>{
    try {
      await api('/rest/v1/rpc/privacy_payment_request_action',{op:'create_request',args:{user_id:target.userId,reason}},await token(expected));
    } catch(e) {
      if(/duplicate key value violates unique constraint|already open/i.test(e.message)) {
        status('This customer already has an unpaid payment request.');
        await load(expected);return;
      }
      throw e;
    }
    if(expected!==generation)return;
    status('Payment request sent to '+target.email+'. It will appear in the customer app.');
    await load(expected);
  });
});
byId('confirm').addEventListener('close',()=>{
  const d=decision;decision=null;
  if (!d || byId('confirm').returnValue!=='confirm') return;
  run(async expected=>{
    await api('/rest/v1/rpc/privacy_chat_action',{op:d.op,args:d.args},await token(expected));
    if(expected!==generation)return;
    status('Change saved. Refreshing the report…');
    try { await load(expected); }
    catch(e) { if(![401,403].includes(e.httpStatus))throw new Error('Change saved. Refresh to see the latest report.');throw e; }
    if(expected===generation)status('Change saved.');
  });
});
function openPaymentRequest(userId,email) {
  requestTarget={userId,email};
  byId('request-customer').textContent='Customer: '+email+' · Plan: ₹100 / month';
  byId('request-reason').value='';
  byId('request-dialog').returnValue='cancel';
  byId('request-dialog').showModal();
  byId('request-reason').focus();
}
function renderUsers() {
  if(!report)return;
  const query=lower(byId('user-search').value.trim()), filter=byId('user-filter').value;
  const subset=report.users.filter(u=>lower(u.email).includes(query) && (!filter || u.status===filter));
  byId('user-count').textContent=subset.length+' of '+report.users.length;
  const rows=subset.map(u=>{
    const actions=element('div',undefined,'actions');
    if(u.is_admin) actions.append(element('span','Protected admin','table-label'));
    else {
      const freeLabel=u.free_testing?'Remove free access':'Grant free access';
      const stateLabel=u.enabled?'Deactivate':'Activate';
      if(u.enabled) actions.append(action('Request payment',()=>openPaymentRequest(u.id,u.email)));
      actions.append(action(freeLabel,()=>ask('set_free_testing',{user_id:u.id,value:!u.free_testing},freeLabel+'?',u.email,freeLabel)),
        action(stateLabel,()=>ask('set_user_enabled',{user_id:u.id,value:!u.enabled},stateLabel+' user?',u.email,stateLabel)));
    }
    return [u.email,pill(u.status),date(u.start),date(u.end),actions];
  });
  table('user-list',['Email','Status','Subscription start','Subscription end','Access controls'],rows,'No matching registered users.');
}
function viewProof(path) {
  const safe=String(path||'');
  if(!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/i.test(safe)){status('Screenshot unavailable for this payment.');return;}
  run(async expected=>{
    const encoded=safe.split('/').map(encodeURIComponent).join('/');
    const result=await api('/storage/v1/object/sign/privacy-payment-proofs/'+encoded,{expiresIn:120},await token(expected));
    if(expected!==generation)return;
    const url=result.signedURL||'';
    if(!url)throw new Error('Could not load the private screenshot.');
    byId('proof-image').src=url.startsWith('http')?url:base+(url.startsWith('/storage/v1/')?url:'/storage/v1'+url);
    byId('proof-dialog').showModal();
  });
}
function renderRequests() {
  if(!report)return;
  byId('pending-count').textContent=paymentRequests.length+' awaiting approval';
  byId('nav-pending-count').textContent=String(paymentRequests.length);
  table('pending-list',['Email','Reason','UTR','Amount','Submitted','Proof','Review'],paymentRequests.map(p=>{
    const actions=element('div',undefined,'actions');
    actions.append(action('Approve',()=>ask('approve',{id:p.id},'Approve payment?',p.email+' · ₹100 · UTR '+(p.utr_number||p.reference)+'. Confirm bank credit before approving. Approval activates this subscription.','Approve')),
      action('Reject',()=>ask('reject',{id:p.id},'Reject payment?',p.email+' · UTR '+(p.utr_number||p.reference),'Reject')));
    const proof=p.screenshot_path?action('View screenshot',()=>viewProof(p.screenshot_path)):element('span','Not attached','table-label');
    return [p.email,p.request_reason||'Legacy payment',p.utr_number||p.reference,amount(p.amount),date(p.date),proof,actions];
  }),'No pending payment requests.');
}
function renderPayments() {
  if(!report)return;
  const query=lower(byId('payment-search').value.trim()), filter=byId('payment-filter').value;
  const matches=report.payments.filter(p=>(!filter||lower(p.status)===filter) && (lower(p.email).includes(query)||lower(p.reference).includes(query)));
  table('payment-list',['Email','Reference','Amount','Status','Submitted','Reviewed'],matches.map(p=>
    [p.email,p.reference,amount(p.amount),pill(p.status),date(p.date),date(p.reviewed_at)]),'No matching payments.');
}
function renderMonthly() {
  const rows=report.monthly.map(m=>{
    const parsed=new Date(m.month+'-01T00:00:00+05:30');
    return [Number.isFinite(parsed.getTime())?monthFormat.format(parsed):m.month,String(m.count),amount(m.amount_paise)];
  });
  table('monthly-list',['Month','Approvals','Collected'],rows,'No approved payments yet.',true);
}
byId('form').addEventListener('submit',event=>{
  event.preventDefault();
  run(async expected=>{
    status('Signing in…');
    try {
      const fresh=await api('/auth/v1/token?grant_type=password',{email:byId('email').value.trim(),password:byId('password').value});
      if(expected!==generation)return;
      if(!fresh?.access_token)throw new Error('Sign in failed.');
      session=fresh;persistSession();sessionStorage.setItem(ADMIN_ACTIVITY_KEY,String(Date.now()));await load(expected);if(expected===generation)status('');
    } catch(e) {if(expected===generation)clear();throw e;}
    finally {byId('password').value='';}
  });
});
byId('refresh').addEventListener('click',()=>run(async expected=>{await load(expected);if(expected===generation)status('Report refreshed.');}));
byId('logout').addEventListener('click',()=>run(async()=>{
  const saved=session; clear();
  try { await revokeSession(saved); status('Signed out.'); }
  catch { status('Signed out of this page. The server could not confirm session revocation.'); }
}));
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>selectView(b.dataset.view)));
byId('user-search').addEventListener('input',renderUsers);byId('user-filter').addEventListener('change',renderUsers);
byId('payment-search').addEventListener('input',renderPayments);byId('payment-filter').addEventListener('change',renderPayments);
for (const eventName of ['pointerdown','keydown','touchstart','scroll']) {
  window.addEventListener(eventName,recordActivity,{passive:true});
}
window.addEventListener('focus',checkIdle);
window.addEventListener('pageshow',checkIdle);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')checkIdle();});
window.setInterval(checkIdle,30000);
restoreSession();
