/* Privacy Chat — plain JavaScript frontend with isolated pc_ tables in a shared Supabase project.
   No service-role keys, real passwords, or plaintext decoy passwords are stored.
   Messages are private using Supabase RLS, but NOT end-to-end encrypted. */
'use strict';

const $ = id => document.getElementById(id);
const state = { sb: null, user: null, requests: [], profiles: {}, chatId: null,
  tab: 'chats', authMode: 'login', imageFile: null, busy: false, polling: null,
  channels: [], photoCache: new Map(), messageLoadVersion: 0, photoViewerLoadVersion: 0,
  groups: [], groupMemberships: [], groupMembers: [], chatType: 'direct',
  presenceChannels: new Map(), presenceByRequest: {}, lastLoadedMessageIds: new Map(),
  pendingBlink: new Set(), notifiedMessageIds: new Set() };

const config = window.PRIVACY_CHAT_CONFIG || {};
const isAndroidApp = location.hostname==='appassets.androidplatform.net';
const configured = /^https:\/\/[^\s]+\.supabase\.co$/.test(config.supabaseUrl || '') &&
  /^(sb_publishable_|eyJ)/.test(config.supabasePublishableKey || '');

const escapeText = v => String(v ?? '');
const shortTime = d => new Date(d).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
function toast(message, timeout=3800) {
  const t=$('toast'); t.textContent=message; t.classList.add('visible');
  clearTimeout(toast.timeout); toast.timeout=setTimeout(()=>t.classList.remove('visible'),timeout);
}
function notifyIncoming(title) {
  const safeTitle=String(title||'Private contact').slice(0,100);
  if(isAndroidApp && window.PrivacyChatNative?.showMessageNotification) {
    window.PrivacyChatNative.showMessageNotification('New private message',`From ${safeTitle}`);
  } else if('Notification' in window && Notification.permission==='granted') {
    try { new Notification('New private message',{body:`From ${safeTitle}`}); } catch(_) {}
  }
}
function errorText(e) { return e?.message || 'Something went wrong. Please try again.'; }
function emailFor(userId) { return state.profiles[userId] || (userId===state.user?.id ? state.user.email : 'Private contact'); }
function peerId(r) { return r.sender_id===state.user?.id ? r.recipient_id : r.sender_id; }
function initial(value) { return (value||'P').charAt(0).toUpperCase(); }
function el(tag,className,txt) { const x=document.createElement(tag); if(className)x.className=className;if(txt!==undefined)x.textContent=txt;return x; }
function clear(id) { $(id).replaceChildren(); }

// The second password is device-local and *never* opens an authenticated session.
// Main password is checked by Supabase Auth, not by code running in this browser.
function bytesToHex(b) { return Array.from(b, v=>v.toString(16).padStart(2,'0')).join(''); }
async function fingerprint(email) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(email.trim().toLowerCase()));
  return 'privacy-chat-decoy-'+bytesToHex(new Uint8Array(digest));
}
async function pbkdf2(password,saltBytes) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),{name:'PBKDF2'},false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:saltBytes,iterations:210000,hash:'SHA-256'},key,256);
  return bytesToHex(new Uint8Array(bits));
}
function constantEqual(a,b) {
  if(a.length!==b.length)return false;
  let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;
}
async function isAlternate(email,password) {
  if(!crypto?.subtle)return false;
  try {
    const record=localStorage.getItem(await fingerprint(email));
    if(!record)return false;
    const parsed=JSON.parse(record);
    const salt=Uint8Array.from(parsed.salt.match(/.{2}/g).map(x=>parseInt(x,16)));
    return constantEqual(await pbkdf2(password,salt),parsed.hash);
  }catch(_){return false;}
}
function emptyMask() {
  // No authenticated API requests or chat data are fetched in this mode.
  document.body.classList.add('decoy-mode');
  document.title='';
}
function setAuthMode(mode) {
  state.authMode=mode;
  $('auth-title').textContent=mode==='login'?'Welcome back':'Create your account';
  $('auth-subtitle').textContent=mode==='login'?'Sign in to your private space':'Start your invitation-only account';
  $('auth-submit').textContent=mode==='login'?'Sign in →':'Create account →';
  $('auth-switch').textContent=mode==='login'?'New here? Create an account':'Already registered? Sign in';
  $('auth-password').autocomplete=mode==='login'?'current-password':'new-password';
}

async function authSubmit(e) {
  e.preventDefault();
  if(!configured || !state.sb) {toast('Supabase config is not ready. See START_HERE.');return;}
  if(isAndroidApp && window.PrivacyChatNative?.requestNotificationPermission)window.PrivacyChatNative.requestNotificationPermission();
  const email=$('auth-email').value.trim().toLowerCase(), password=$('auth-password').value;
  if(password.length<8){toast('Use at least 8 characters.');return;}
  $('auth-submit').disabled=true;
  try {
    if(state.authMode==='login') {
      if(await isAlternate(email,password)) { emptyMask();return; }
      const {data,error}=await state.sb.auth.signInWithPassword({email,password});
      if(error)throw error;
      if(!data?.user)throw new Error('Could not sign in.');
      await enterApp(data.user);
    }else{
      const {data,error}=await state.sb.auth.signUp({email,password});
      if(error)throw error;
      if(data?.session && data?.user)await enterApp(data.user);
      else { setAuthMode('login'); $('auth-password').value='';toast('Account requested. Check your email for confirmation.',6000); }
    }
  }catch(e){toast(errorText(e),5500);}
  finally{$('auth-submit').disabled=false;}
}

async function enterApp(user) {
  // Register only this signed-in user as a Privacy Chat participant.
  // Do not create global auth.users triggers or backfill restaurant users.
  const {error:profileError}=await state.sb.rpc('pc_register_self');
  if(profileError){
    await state.sb.auth.signOut();
    throw new Error('Privacy Chat profile could not be created: '+errorText(profileError));
  }
  state.user=user;
  // First verified account sign-in or restored session: require native local lock setup.
  // After the setup, future starts show the local unlock screen, not email login.
  if(isAndroidApp)location.href='privacychat://session-ready';
  $('auth-password').value='';
  $('my-email').textContent=user.email || '';
  $('user-avatar').textContent=initial(user.email);
  $('auth').classList.add('hidden');$('dashboard').classList.remove('hidden');
  setTab('chats');
  subscribeRealtime();
  await refreshRequests();
  await refreshGroups();
  syncPresenceChannels();
  clearInterval(state.polling);
  state.polling=setInterval(async()=>{
    if(!state.user)return;
    await refreshRequests();
    await refreshGroups();
    syncPresenceChannels();
    if(state.chatId)await loadMessages(false);
  },12000);
}

async function refreshRequests() {
  if(!state.user)return;
  const userId=state.user.id;
  const {data,error}=await state.sb.from('pc_requests').select('id,sender_id,recipient_id,status,created_at').order('created_at',{ascending:false});
  if(error){toast('Could not refresh invitations: '+errorText(error));return;}
  if(state.user?.id!==userId)return;
  state.requests=data || [];
  const ids=[...new Set(state.requests.flatMap(r=>[r.sender_id,r.recipient_id]))];
  const next={ [userId]:state.user.email };
  if(ids.length){
    const {data:profiles,error:profileError}=await state.sb.from('pc_profiles').select('id,email').in('id',ids);
    if(!profileError)for(const p of profiles||[])next[p.id]=p.email;
  }
  if(state.user?.id!==userId)return;
  state.profiles=next;
  renderLists();
  syncPresenceChannels();
  if(state.chatType==='direct'){
    const selected=state.requests.find(r=>r.id===state.chatId&&r.status==='accepted');
    if(state.chatId&&!selected){state.chatId=null;showEmptyChat();}
    else if(selected)renderPeer(selected);
  }
}

function renderLists() {
  clear('chat-list');clear('received-list');clear('sent-list');
  const approved=state.requests.filter(r=>r.status==='accepted');
  if(!approved.length)$('chat-list').append(el('p','empty-list','No conversations yet. Send an invitation from Requests.'));
  for(const r of approved){
    const email=emailFor(peerId(r));
    const b=el('button','list-entry'+(state.chatId===r.id?' selected':''));
    const avatarWrap=el('span','avatar-wrap');
    const avatar=el('span','avatar',initial(email));
    const presence=el('span','presence-dot'+(state.presenceByRequest[r.id]?' is-online':''));
    presence.title=state.presenceByRequest[r.id]?'Online':'Offline';
    avatarWrap.append(avatar,presence);
    const text=el('span','list-text');text.append(el('span','list-name',email),el('small','', 'Private conversation'));
    if(state.pendingBlink.has(r.id))b.classList.add('has-unread');
    b.append(avatarWrap,text);b.addEventListener('click',()=>openChat(r.id));$('chat-list').append(b);
  }
  const received=state.requests.filter(r=>r.status==='pending'&&r.recipient_id===state.user.id);
  const sent=state.requests.filter(r=>r.sender_id===state.user.id&&r.status!=='accepted');
  $('pending-count').textContent=String(received.length);
  $('pending-count').classList.toggle('hidden',received.length===0);
  if(!received.length)$('received-list').append(el('p','empty-list','No pending requests.'));
  if(!sent.length)$('sent-list').append(el('p','empty-list','No sent requests.'));
  for(const r of received){
    const box=el('div','invite-entry');box.append(el('strong','',emailFor(r.sender_id)),el('small','','Wants to connect'));
    const actions=el('div','inline-actions'),accept=el('button','','Accept'),reject=el('button','reject','Reject');
    accept.addEventListener('click',()=>respond(r.id,'accepted'));reject.addEventListener('click',()=>respond(r.id,'rejected'));
    actions.append(accept,reject);box.append(actions);$('received-list').append(box);
  }
  for(const r of sent){
    const box=el('div','invite-entry');box.append(el('strong','',emailFor(r.recipient_id)),el('small','',r.status==='pending'?'Awaiting acceptance':'Rejected'));
    $('sent-list').append(box);
  }
}

function setTab(tab) {
  state.tab=tab;
  for(const b of document.querySelectorAll('.side-tab'))b.classList.toggle('active',b.dataset.tab===tab);
  for(const panel of ['chats','groups','requests','security'])$(panel+'-panel').classList.toggle('hidden',panel!==tab);
}
async function invite(e) {
  e.preventDefault();
  const target=$('invite-email').value.trim().toLowerCase();
  if(!target)return;
  const button=$('invite-form').querySelector('button');button.disabled=true;
  try {
    const {error}=await state.sb.rpc('pc_send_invite',{target_email:target});
    if(error)throw error;
    $('invite-email').value='';
    toast('Request submitted if that email has an account.');
    await refreshRequests();
  }catch(e){toast(errorText(e));}
  finally{button.disabled=false;}
}
async function respond(id,status) {
  const {error}=await state.sb.from('pc_requests').update({status}).eq('id',id).eq('status','pending');
  if(error){toast(errorText(error));return;}
  toast(status==='accepted'?'Invitation accepted. You can now chat.':'Invitation rejected.');
  await refreshRequests();
  if(status==='accepted')openChat(id);
}
function renderPeer(r) {
  const email=emailFor(peerId(r));
  $('peer-avatar').textContent=initial(email);
  $('peer-title').textContent=email;
  $('peer-subtitle').textContent=(state.presenceByRequest[r.id]?'Online':'Offline')+' · Private 1-to-1 conversation';
  $('peer-subtitle').classList.toggle('peer-online',!!state.presenceByRequest[r.id]);
}
function showEmptyChat() {
  $('chat-empty').classList.remove('hidden');$('chat-active').classList.add('hidden');
  $('peer-avatar').textContent='◈';$('peer-title').textContent='Your private space';
  $('peer-subtitle').textContent='Select a conversation to begin';$('group-members-button').classList.add('hidden');
}
function openChat(id) {
  const r=state.requests.find(x=>x.id===id&&x.status==='accepted');
  if(!r){toast('This conversation is not approved.');return;}
  state.chatId=id;state.chatType='direct';$('group-members-button').classList.add('hidden');
  ++state.messageLoadVersion;closePhotoViewer();
  state.imageFile=null;renderFilePreview();
  $('chat-empty').classList.add('hidden');$('chat-active').classList.remove('hidden');
  renderPeer(r);renderLists();setTab('chats');
  $('dashboard').classList.add('mobile-chat');
  loadMessages();
}

async function loadMessages(scroll=true) {
  const chatId=state.chatId, chatType=state.chatType;
  if(!chatId||!state.user)return;
  const loadVersion=++state.messageLoadVersion;
  const isGroup=chatType==='group';
  const table=isGroup?'pc_group_messages':'pc_messages';
  const field=isGroup?'group_id':'request_id';
  const bucket=isGroup?'pc-group-photos':'pc-photos';
  const {data,error}=await state.sb.from(table)
    .select('id,sender_id,body,photo_path,created_at')
    .eq(field,chatId).order('created_at',{ascending:false}).limit(300);
  if(error){toast('Messages not available: '+errorText(error));return;}
  if(state.chatId!==chatId||state.chatType!==chatType||loadVersion!==state.messageLoadVersion)return;
  const area=$('messages'),nearBottom=area.scrollHeight-area.scrollTop-area.clientHeight<100;
  const fragment=document.createDocumentFragment();
  const chronological=[...(data||[])].reverse();
  const previousIds=state.lastLoadedMessageIds.get(chatType+':'+chatId);
  if(!chronological.length)fragment.append(el('p','no-messages','This conversation starts here. Say hello!'));
  let previousDate='';
  for(const m of chronological){
    if(state.chatId!==chatId||state.chatType!==chatType||loadVersion!==state.messageLoadVersion)return;
    const day=new Date(m.created_at).toLocaleDateString();
    if(day!==previousDate){fragment.append(el('div','message-day',day));previousDate=day;}
    const isNew=m.sender_id!==state.user.id&&((!!previousIds&&!previousIds.has(m.id))||state.pendingBlink.has(chatId));
    const bubble=el('div','message'+(m.sender_id===state.user.id?' mine':'')+(isNew?' new-incoming':''));
    if(isGroup)bubble.append(el('div','message-sender',emailFor(m.sender_id)));
    if(m.photo_path){
      const img=el('img','photo');img.alt='Tap to enlarge shared private photograph';img.loading='lazy';
      const cacheKey=bucket+':'+m.photo_path;
      const cached=state.photoCache.get(cacheKey);
      if(cached?.expiry>Date.now())img.src=cached.url;
      else{
        const {data:photo,error:photoError}=await state.sb.storage.from(bucket).createSignedUrl(m.photo_path,60);
        if(photo?.signedUrl){img.src=photo.signedUrl;state.photoCache.set(cacheKey,{url:photo.signedUrl,expiry:Date.now()+45000});}
        else bubble.append(el('p','photo-error',photoError?.message||'Photo unavailable'));
      }
      if(img.src){img.addEventListener('click',()=>openPhotoViewer(m.photo_path,bucket));bubble.append(img);}
    }
    if(m.body)bubble.append(el('div','body',m.body));
    bubble.append(el('div','time',shortTime(m.created_at)));
    fragment.append(bubble);
  }
  if(state.chatId!==chatId||state.chatType!==chatType||loadVersion!==state.messageLoadVersion)return;
  area.replaceChildren(fragment);
  state.pendingBlink.delete(chatId);
  state.lastLoadedMessageIds.set(chatType+':'+chatId,new Set(chronological.map(m=>m.id)));
  if(isGroup)renderGroupLists();else renderLists();
  if(scroll||nearBottom)area.scrollTop=area.scrollHeight;
}
async function openPhotoViewer(photoPath,bucket='pc-photos'){
  if(!photoPath||!state.user)return;
  const nonce=++state.photoViewerLoadVersion;
  $('photo-viewer-image').removeAttribute('src');
  $('photo-viewer').classList.remove('hidden');
  const {data,error}=await state.sb.storage.from(bucket).createSignedUrl(photoPath,60);
  if(nonce!==state.photoViewerLoadVersion||$('photo-viewer').classList.contains('hidden'))return;
  if(error||!data?.signedUrl){closePhotoViewer();toast('Photo unavailable: '+errorText(error));return;}
  $('photo-viewer-image').src=data.signedUrl;
}
function closePhotoViewer(){
  ++state.photoViewerLoadVersion;
  $('photo-viewer').classList.add('hidden');
  $('photo-viewer-image').removeAttribute('src');
}
// Hide immediately before waiting for a remote sign-out. Reopening requires real login.
async function hideImmediately(){
  closePhotoViewer();
  if(isAndroidApp){location.href='privacychat://lock-now';return;}
  emptyMask();
  try{await logout();}catch(e){/* Browser interface already hidden. */}
}
function renderFilePreview() {
  const file=state.imageFile;const p=$('file-preview');p.replaceChildren();
  p.classList.toggle('hidden',!file);
  if(file){p.append(el('span','', '📷 '+file.name+' · '+(file.size/1024/1024).toFixed(1)+' MB '));
    const remove=el('button','','Remove ×');remove.type='button';remove.addEventListener('click',()=>{state.imageFile=null;$('photo-input').value='';renderFilePreview();});p.append(remove);}
}
function choosePhoto(e) {
  const f=e.target.files?.[0];if(!f)return;
  if(!['image/jpeg','image/png','image/webp'].includes(f.type)){toast('Only JPG, PNG or WebP photos are supported.');e.target.value='';return;}
  if(f.size>5*1024*1024){toast('Photo limit: 5 MB.');e.target.value='';return;}
  state.imageFile=f;renderFilePreview();
}
async function sendMessage(e) {
  e.preventDefault();
  if(state.busy||!state.chatId)return;
  const body=$('message-input').value.trim();const file=state.imageFile;
  if(!body&&!file)return;
  const request_id=state.chatId, chatType=state.chatType;
  const isGroup=chatType==='group';
  state.busy=true;$('send-btn').disabled=true;
  try {
    let photo_path=null;
    if(file){
      const ext=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'})[file.type];
      photo_path=`${request_id}/${state.user.id}/${crypto.randomUUID()}.${ext}`;
      const {error}=await state.sb.storage.from(isGroup?'pc-group-photos':'pc-photos').upload(photo_path,file,{contentType:file.type,upsert:false});
      if(error)throw error;
    }
    const record=isGroup?{group_id:request_id,sender_id:state.user.id,body:body||null,photo_path}:{request_id,sender_id:state.user.id,body:body||null,photo_path};
    const {error}=await state.sb.from(isGroup?'pc_group_messages':'pc_messages').insert(record);
    if(error)throw error;
    // Sending can finish after a person switches chats: preserve the new chat's draft.
    if(state.chatId===request_id && state.chatType===chatType) {
      if($('message-input').value.trim()===body)$('message-input').value='';
      if(state.imageFile===file){$('photo-input').value='';state.imageFile=null;renderFilePreview();}
      await loadMessages();
    }
  }catch(e){toast('Send failed: '+errorText(e),6000);}
  finally{state.busy=false;$('send-btn').disabled=false;}
}

async function saveDecoy(e) {
  e.preventDefault();
  const current=$('verify-password').value, decoy=$('decoy-password').value, repeat=$('decoy-repeat').value;
  if(!crypto?.subtle){toast('Use HTTPS or localhost to set an alternate password.');return;}
  if(decoy.length<8){toast('Use at least 8 characters.');return;}
  if(decoy!==repeat){toast('Alternate passwords do not match.');return;}
  if(decoy===current){toast('Alternate password must be different from your main password.');return;}
  const submit=$('decoy-form').querySelector('button');submit.disabled=true;
  try{
    const {error}=await state.sb.auth.signInWithPassword({email:state.user.email,password:current});
    if(error)throw new Error('Main password verification failed.');
    const salt=crypto.getRandomValues(new Uint8Array(16));
    const hash=await pbkdf2(decoy,salt);
    localStorage.setItem(await fingerprint(state.user.email),JSON.stringify({salt:bytesToHex(salt),hash}));
    $('decoy-form').reset();
    toast('Alternate password saved on this device. Sign out to test it.',5000);
  }catch(e){toast(errorText(e));}
  finally{submit.disabled=false;}
}
async function removeDecoy() {
  try{localStorage.removeItem(await fingerprint(state.user.email));toast('Alternate password removed from this device.');}
  catch(e){toast(errorText(e));}
}
async function logout() {
  clearInterval(state.polling);
  for(const channel of state.channels)await state.sb.removeChannel(channel);
  state.channels=[];
  const {error:signOutError}=await state.sb.auth.signOut();
  if(signOutError)throw signOutError;
  // Only explicit sign-out removes the Android local app lock. Normal app exit never does.
  if(isAndroidApp)location.href='privacychat://signed-out';
  state.user=null;state.chatId=null;state.chatType='direct';++state.messageLoadVersion;state.requests=[];state.groups=[];state.groupMemberships=[];state.groupMembers=[];state.profiles={};state.photoCache.clear();closePhotoViewer();closeGroupMembers();
  state.presenceChannels.clear();state.presenceByRequest={};state.lastLoadedMessageIds.clear();state.pendingBlink.clear();state.notifiedMessageIds.clear();
  showEmptyChat();$('dashboard').classList.remove('mobile-chat');
  $('dashboard').classList.add('hidden');$('auth').classList.remove('hidden');setAuthMode('login');
  $('auth-password').value='';$('live-label').textContent='Disconnected';$('live-dot').classList.remove('live');
}
function subscribeRealtime() {
  for(const old of state.channels)state.sb.removeChannel(old);
  state.channels=[];
  const userId=state.user.id;
  const req=state.sb.channel('pc-requests-'+userId)
    .on('postgres_changes',{event:'*',schema:'public',table:'pc_requests'},()=>refreshRequests())
    .subscribe(s=>{if(s==='SUBSCRIBED'){$('live-label').textContent='Live connection';$('live-dot').classList.add('live');}});
  const msgs=state.sb.channel('pc-messages-'+userId)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'pc_messages'},p=>{
      const m=p.new;if(!m)return;
      if(m.sender_id!==state.user?.id&&!state.notifiedMessageIds.has(m.id)){
        state.notifiedMessageIds.add(m.id);
        const request=state.requests.find(r=>r.id===m.request_id&&r.status==='accepted');
        if(request){notifyIncoming(emailFor(peerId(request)));if(state.chatId!==m.request_id)state.pendingBlink.add(m.request_id);renderLists();}
      }
      if(state.chatType==='direct'&&m.request_id===state.chatId)loadMessages();
    }).subscribe();
  const groupMessages=state.sb.channel('pc-group-messages-'+userId)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'pc_group_messages'},p=>{
      const m=p.new;if(!m)return;
      if(m.sender_id!==state.user?.id&&!state.notifiedMessageIds.has(m.id)){
        state.notifiedMessageIds.add(m.id);
        const group=state.groups.find(g=>g.id===m.group_id);
        if(group){notifyIncoming(group.name);if(state.chatId!==m.group_id)state.pendingBlink.add(m.group_id);renderGroupLists();}
      }
      if(state.chatType==='group'&&m.group_id===state.chatId)loadMessages();
    }).subscribe();
  const memberChanges=state.sb.channel('pc-group-members-'+userId)
    .on('postgres_changes',{event:'*',schema:'public',table:'pc_group_members'},()=>refreshGroups())
    .subscribe();
  state.channels=[req,msgs,groupMessages,memberChanges];
}

function syncPresenceChannels(){
  if(!state.user||!state.sb)return;
  const accepted=state.requests.filter(r=>r.status==='accepted');
  const wanted=new Set(accepted.map(r=>r.id));
  for(const [id,channel] of state.presenceChannels){
    if(!wanted.has(id)){state.sb.removeChannel(channel);state.presenceChannels.delete(id);delete state.presenceByRequest[id];}
  }
  for(const request of accepted){
    if(state.presenceChannels.has(request.id))continue;
    const channel=state.sb.channel('pc-presence-'+request.id,{config:{presence:{key:state.user.id}}});
    const update=()=>{
      const peer=peerId(request),presence=channel.presenceState();
      state.presenceByRequest[request.id]=Object.entries(presence).some(([key,entries])=>key===peer||(entries||[]).some(entry=>entry.user_id===peer));
      renderLists();if(state.chatType==='direct'&&state.chatId===request.id)renderPeer(request);
    };
    channel.on('presence',{event:'sync'},update).on('presence',{event:'join'},update).on('presence',{event:'leave'},update)
      .subscribe(status=>{
        if(status==='SUBSCRIBED')channel.track({user_id:state.user.id,status:'online'});
        else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){state.presenceByRequest[request.id]=false;update();}
      });
    state.presenceChannels.set(request.id,channel);state.channels.push(channel);
  }
}


// Group chat: approval-based membership, one creator/admin, RLS for every group read/write.
async function refreshGroups(){
  if(!state.user)return;
  const userId=state.user.id;
  const {data:members,error}=await state.sb.from('pc_group_members')
    .select('group_id,user_id,role,status,joined_at').eq('user_id',userId);
  if(error){toast('Groups unavailable: '+errorText(error));return;}
  if(state.user?.id!==userId)return;
  state.groupMemberships=members||[];
  let groups=[];
  const ids=state.groupMemberships.map(m=>m.group_id);
  if(ids.length){
    const res=await state.sb.from('pc_groups').select('id,name,owner_id,created_at').in('id',ids);
    if(res.error){toast('Could not load groups: '+errorText(res.error));return;}
    groups=res.data||[];
  }
  if(state.user?.id!==userId)return;
  state.groups=groups;
  renderGroupLists();
  if(state.chatType==='group'&&state.chatId){
    const group=state.groups.find(g=>g.id===state.chatId);
    const membership=state.groupMemberships.find(m=>m.group_id===state.chatId&&m.status==='active');
    if(!group||!membership){state.chatId=null;++state.messageLoadVersion;state.photoCache.clear();closePhotoViewer();closeGroupMembers();showEmptyChat();$('dashboard').classList.remove('mobile-chat');}
    else renderGroupPeer(group);
  }
}
function renderGroupLists(){
  clear('group-list');clear('group-invites');
  const approved=state.groupMemberships.filter(m=>m.status==='active');
  const pending=state.groupMemberships.filter(m=>m.status==='pending');
  $('group-pending-count').textContent=String(pending.length);
  $('group-pending-count').classList.toggle('hidden',!pending.length);
  if(!approved.length)$('group-list').append(el('p','empty-list','No groups yet. Create one above.'));
  for(const m of approved){
    const g=state.groups.find(x=>x.id===m.group_id);if(!g)continue;
    const b=el('button','list-entry group-list-entry'+(state.chatType==='group'&&state.chatId===g.id?' selected':''));
    if(state.pendingBlink.has(g.id))b.classList.add('has-unread');
    const avatar=el('span','avatar','♧');const t=el('span','list-text');
    t.append(el('span','list-name',g.name),el('small','',g.owner_id===state.user.id?'Group admin':'Group member'));
    b.append(avatar,t);b.addEventListener('click',()=>openGroupChat(g.id));$('group-list').append(b);
  }
  if(!pending.length)$('group-invites').append(el('p','empty-list','No pending group invitations.'));
  for(const m of pending){
    const g=state.groups.find(x=>x.id===m.group_id);if(!g)continue;
    const box=el('div','invite-entry group-pending');box.append(el('strong','',g.name),el('small','','Invitation to join this group'));
    const actions=el('div','inline-actions'),accept=el('button','','Accept'),reject=el('button','reject','Reject');
    accept.addEventListener('click',()=>respondGroupInvite(g.id,'active'));
    reject.addEventListener('click',()=>respondGroupInvite(g.id,'rejected'));
    actions.append(accept,reject);box.append(actions);$('group-invites').append(box);
  }
}
async function createGroup(e){
  e.preventDefault();
  const input=$('new-group-name'),name=input.value.trim();
  if(name.length<2||name.length>80){toast('Use a group name of 2–80 characters.');return;}
  const b=$('create-group-form').querySelector('button');b.disabled=true;
  try{
    const {data,error}=await state.sb.from('pc_groups').insert({name,owner_id:state.user.id}).select('id').single();
    if(error)throw error;
    input.value='';toast('Group created. Add accepted contacts using Members.');
    await refreshGroups();if(data?.id)openGroupChat(data.id);
  }catch(e){toast('Could not create group: '+errorText(e));}finally{b.disabled=false;}
}
async function respondGroupInvite(id,status){
  const {error}=await state.sb.from('pc_group_members').update({status})
    .eq('group_id',id).eq('user_id',state.user.id).eq('status','pending');
  if(error){toast(errorText(error));return;}
  toast(status==='active'?'Joined group.':'Group invitation rejected.');
  await refreshGroups();if(status==='active')openGroupChat(id);
}
function renderGroupPeer(group){
  $('peer-avatar').textContent='♧';$('peer-title').textContent=group.name;
  $('peer-subtitle').textContent='Private group conversation';
  $('group-members-button').classList.remove('hidden');
}
function openGroupChat(id){
  const group=state.groups.find(x=>x.id===id), m=state.groupMemberships.find(x=>x.group_id===id&&x.status==='active');
  if(!group||!m){toast('You must accept this group invitation first.');return;}
  state.chatId=id;state.chatType='group';++state.messageLoadVersion;closePhotoViewer();closeGroupMembers();
  state.imageFile=null;renderFilePreview();
  $('chat-empty').classList.add('hidden');$('chat-active').classList.remove('hidden');
  renderGroupPeer(group);renderLists();renderGroupLists();setTab('groups');
  $('dashboard').classList.add('mobile-chat');
  loadGroupMembers(id).then(()=>loadMessages());
}
async function loadGroupMembers(id){
  const currentId=id;
  const {data,error}=await state.sb.from('pc_group_members')
    .select('group_id,user_id,role,status,joined_at').eq('group_id',id);
  if(error){toast('Group members unavailable: '+errorText(error));return;}
  if(state.chatId!==currentId||state.chatType!=='group')return;
  state.groupMembers=data||[];
  const members=state.groupMembers.filter(m=>m.status==='active').map(m=>m.user_id);
  if(members.length){
    const {data:profiles}=await state.sb.from('pc_profiles').select('id,email').in('id',members);
    if(state.chatId!==currentId||state.chatType!=='group')return;
    for(const p of profiles||[])state.profiles[p.id]=p.email;
  }
  if(state.chatId===id&&state.chatType==='group'){
    const n=state.groupMembers.filter(m=>m.status==='active').length;
    $('peer-subtitle').textContent=n+' member'+(n===1?'':'s')+' · Invite-only group';
  }
}
function closeGroupMembers(){$('group-members-overlay').classList.add('hidden');}
async function openGroupMembers(){
  const g=state.groups.find(x=>x.id===state.chatId);
  if(state.chatType!=='group'||!g)return;
  $('manage-group-title').textContent=g.name+' · Members';
  await loadGroupMembers(g.id);
  const admin=g.owner_id===state.user.id;
  $('group-invite-controls').classList.toggle('hidden',!admin);
  $('leave-group').classList.toggle('hidden',admin);
  const list=$('group-members-list');list.replaceChildren();
  for(const m of state.groupMembers.filter(x=>x.status!=='rejected')){
    const row=el('div','group-member-row');const label=el('span','group-member-label',emailFor(m.user_id));
    label.append(el('small','',m.role==='admin'?'Admin':m.status==='pending'?'Pending invitation':'Member'));
    row.append(label);
    if(admin&&m.role!=='admin'){
      const b=el('button','group-member-remove','Remove');b.type='button';
      b.addEventListener('click',()=>removeGroupMember(g.id,m.user_id));row.append(b);
    }
    list.append(row);
  }
  const select=$('group-invite-contact');select.replaceChildren();
  const existing=new Set(state.groupMembers.map(m=>m.user_id));
  for(const request of state.requests.filter(r=>r.status==='accepted')){
    const uid=peerId(request);if(existing.has(uid))continue;
    const opt=document.createElement('option');opt.value=uid;opt.textContent=emailFor(uid);select.append(opt);
  }
  if(admin&&!select.options.length){const opt=document.createElement('option');opt.textContent='No eligible friends';opt.value='';select.append(opt);}
  $('group-members-overlay').classList.remove('hidden');
}
async function inviteGroupMember(e){
  e.preventDefault();const groupId=state.chatId,userId=$('group-invite-contact').value;
  if(!groupId||!userId){toast('Add an accepted direct contact first.');return;}
  try{
    const {error}=await state.sb.from('pc_group_members').insert({group_id:groupId,user_id:userId,role:'member',status:'pending',invited_by:state.user.id});
    if(error)throw error;
    toast('Group invitation sent in Privacy Chat.');await openGroupMembers();
  }catch(e){toast('Could not invite: '+errorText(e));}
}
async function removeGroupMember(groupId,userId){
  if(!confirm('Remove this member from the group? They will lose access to group messages and photos.'))return;
  const {error}=await state.sb.from('pc_group_members').delete().eq('group_id',groupId).eq('user_id',userId);
  if(error){toast('Remove failed: '+errorText(error));return;}
  toast('Member removed.');await openGroupMembers();
}
async function leaveGroup(){
  const groupId=state.chatId;
  if(!confirm('Leave this group?'))return;
  const {error}=await state.sb.from('pc_group_members').delete().eq('group_id',groupId).eq('user_id',state.user.id);
  if(error){toast('Could not leave: '+errorText(error));return;}
  state.chatId=null;closeGroupMembers();showEmptyChat();$('dashboard').classList.remove('mobile-chat');
  await refreshGroups();toast('You left the group.');
}
async function resendVerification(){
  const email=$('auth-email').value.trim().toLowerCase();
  if(!email||!email.includes('@')){toast('Enter your email address first.');return;}
  const btn=$('resend-verification');btn.disabled=true;
  try{
    const {error}=await state.sb.auth.resend({type:'signup',email});
    if(error)throw error;
    toast('If this email needs verification, a message was requested. Check Inbox and Spam.',5500);
  }catch(e){toast('Could not resend: '+errorText(e),5500);}finally{btn.disabled=false;}
}
function init(){
  if(!configured||!window.supabase?.createClient){$('setup-warning').classList.remove('hidden');$('auth-submit').disabled=true;}
  else state.sb=window.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey,
    {auth:{persistSession:isAndroidApp,autoRefreshToken:true,detectSessionInUrl:false}});
  $('auth-form').addEventListener('submit',authSubmit);
  $('resend-verification').addEventListener('click',resendVerification);
  $('create-group-form').addEventListener('submit',createGroup);
  $('group-members-button').addEventListener('click',openGroupMembers);
  $('close-group-members').addEventListener('click',closeGroupMembers);
  $('group-members-overlay').addEventListener('click',e=>{if(e.target.id==='group-members-overlay')closeGroupMembers();});
  $('group-invite-form').addEventListener('submit',inviteGroupMember);
  $('leave-group').addEventListener('click',leaveGroup);
  $('setup-native-lock').addEventListener('click',()=>{location.href='privacychat://configure-lock';});
  if(isAndroidApp){$('android-lock-settings').classList.remove('hidden');$('browser-decoy-settings').classList.add('hidden');
    // Only the Android app is protected by its native PIN/biometric gate on launch.
    state.sb?.auth.getUser().then(async ({data,error})=>{
      if(!error && data?.user && !state.user){try{await enterApp(data.user);}catch(e){toast(errorText(e));}}
    }).catch(()=>{});
  }
  $('auth-switch').addEventListener('click',()=>setAuthMode(state.authMode==='login'?'signup':'login'));
  $('auth-toggle-password').addEventListener('click',()=>{
    const input=$('auth-password');input.type=input.type==='password'?'text':'password';
    $('auth-toggle-password').textContent=input.type==='password'?'Show':'Hide';
  });
  for(const b of document.querySelectorAll('.side-tab'))b.addEventListener('click',()=>setTab(b.dataset.tab));
  $('empty-invite').addEventListener('click',()=>{setTab('requests');$('dashboard').classList.remove('mobile-chat');});
  $('invite-form').addEventListener('submit',invite);
  $('photo-input').addEventListener('change',choosePhoto);
  $('composer').addEventListener('submit',sendMessage);
  $('message-input').addEventListener('keydown',e=>{
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('composer').requestSubmit();}
  });
  $('decoy-form').addEventListener('submit',saveDecoy);
  $('remove-decoy').addEventListener('click',removeDecoy);
  $('logout').addEventListener('click',async()=>{try{await logout();}catch(e){toast('Sign out failed: '+errorText(e),5500);}});
  $('quick-hide').addEventListener('click',hideImmediately);
  $('photo-viewer-close').addEventListener('click',closePhotoViewer);
  $('photo-viewer').addEventListener('click',e=>{if(e.target.id==='photo-viewer')closePhotoViewer();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closePhotoViewer();closeGroupMembers();}});
  $('mobile-back').addEventListener('click',()=>$('dashboard').classList.remove('mobile-chat'));
}
init();
