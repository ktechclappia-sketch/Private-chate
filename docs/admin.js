'use strict';

const base = 'https://plwpjflifvndejidiwqa.supabase.co';
const key = 'sb_publishable_TJMHDU9hFHqenS9g0jPnOw_e9TmQVvj';
const byId = id => document.getElementById(id);
const money = new Intl.NumberFormat('en-IN', {style:'currency', currency:'INR', maximumFractionDigits:2, minimumFractionDigits:0});
const dateFormat = new Intl.DateTimeFormat('en-IN', {day:'2-digit', month:'short', year:'numeric', timeZone:'Asia/Kolkata'});
const monthFormat = new Intl.DateTimeFormat('en-IN', {month:'long', year:'numeric', timeZone:'Asia/Kolkata'});
const timeFormat = new Intl.DateTimeFormat('en-IN', {hour:'2-digit', minute:'2-digit', timeZone:'Asia/Kolkata'});
const views = ['users','requests','payments','collections'];
let session = null, report = null, busy = false, generation = 0, currentView = 'users';
let decision = null;
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
function clear() {
  generation++; session=null; report=null; decision=null;
  if (byId('confirm').open) byId('confirm').close();
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
    } catch(e) { if(expected===generation && [400,401,403].includes(e.httpStatus)) clear(); throw e; }
  }
  return session.access_token;
}
async function load(expected) {
  const fresh=await api('/rest/v1/rpc/privacy_admin_report',{},await token(expected));
  if(expected!==generation) return;
  if(!fresh || !fresh.summary || !Array.isArray(fresh.users) || !Array.isArray(fresh.payments) || !Array.isArray(fresh.monthly))
    throw new Error('The server returned an incomplete admin report.');
  report=fresh;
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
      actions.append(action(freeLabel,()=>ask('set_free_testing',{user_id:u.id,value:!u.free_testing},freeLabel+'?',u.email,freeLabel)),
        action(stateLabel,()=>ask('set_user_enabled',{user_id:u.id,value:!u.enabled},stateLabel+' user?',u.email,stateLabel)));
    }
    return [u.email,pill(u.status),date(u.start),date(u.end),actions];
  });
  table('user-list',['Email','Status','Subscription start','Subscription end','Access controls'],rows,'No matching registered users.');
}
function renderRequests() {
  if(!report)return;
  const pending=report.payments.filter(p=>lower(p.status)==='pending');
  byId('pending-count').textContent=pending.length+' awaiting approval';
  byId('nav-pending-count').textContent=String(pending.length);
  table('pending-list',['Email','UPI reference','Amount','Submitted','Review'],pending.map(p=>{
    const actions=element('div',undefined,'actions');
    actions.append(action('Approve',()=>ask('approve',{id:p.id},'Approve payment?',p.email+' · '+amount(p.amount)+' · '+p.reference+'. Confirm the credit in your bank account before approving. Approval activates this subscription.','Approve')),
      action('Reject',()=>ask('reject',{id:p.id},'Reject payment?',p.email+' · '+p.reference,'Reject')));
    return [p.email,p.reference,amount(p.amount),date(p.date),actions];
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
      session=fresh;await load(expected);if(expected===generation)status('');
    } catch(e) {if(expected===generation)clear();throw e;}
    finally {byId('password').value='';}
  });
});
byId('refresh').addEventListener('click',()=>run(async expected=>{await load(expected);if(expected===generation)status('Report refreshed.');}));
byId('logout').addEventListener('click',()=>run(async()=>{
  const bearer=session?.access_token; clear();
  try { if(bearer)await api('/auth/v1/logout?scope=local',{},bearer); status('Signed out.'); }
  catch { status('Signed out of this page. The server could not confirm session revocation.'); }
}));
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>selectView(b.dataset.view)));
byId('user-search').addEventListener('input',renderUsers);byId('user-filter').addEventListener('change',renderUsers);
byId('payment-search').addEventListener('input',renderPayments);byId('payment-filter').addEventListener('change',renderPayments);
window.addEventListener('pagehide',clear);
