const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const source = fs.readFileSync(new URL('../docs/admin.js', require('node:url').pathToFileURL(__filename)), 'utf8');
const hour = 3600000;
const last = 100 * hour;

function page(now, activity, expiresAt = 9999999999) {
  const store = new Map([
    ['privacyChatAdminSession', JSON.stringify({ access_token:'fixture', refresh_token:'fixture', expires_at:expiresAt })],
    ['privacyChatAdminLastActivity', String(activity)]
  ]);
  const el = new Map(), calls = [];
  const make = () => ({ addEventListener(){}, replaceChildren(){}, append(){}, removeAttribute(){}, dataset:{} });
  const context = vm.createContext({
    Date: class extends Date { static now() { return now; } },
    Intl, AbortSignal, Node: class {},
    document:{getElementById(id){if(!el.has(id))el.set(id,make());return el.get(id);},querySelectorAll(){return [];},addEventListener(){},createElement:make},
    window:{addEventListener(){},setInterval(){}},
    sessionStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
    fetch: async (url, options) => {
      const path = new URL(url).pathname;
      calls.push(path);
      if (path === '/auth/v1/token') {
        assert.equal(JSON.parse(options.body).refresh_token, 'fixture');
        return { status: 200, ok: true, text: async () => '{"access_token":"renewed-fixture"}' };
      }
      if (path === '/auth/v1/logout' && expiresAt !== 9999999999) {
        assert.equal(options.headers.Authorization, 'Bearer renewed-fixture');
      }
      return { status: 204, ok: true };
    }
  });
  vm.runInContext(source,context);
  return { context, store, calls, el, advance(t){ now=t; } };
}
(async () => {
const before = page(last+5*hour-1,last);
assert(before.store.has('privacyChatAdminSession'));
await new Promise(setImmediate);
assert(before.calls.includes('/rest/v1/rpc/privacy_admin_report'));
before.advance(last+5*hour);
vm.runInContext('checkIdle()',before.context);
assert(!before.store.has('privacyChatAdminSession'));
assert(!before.store.has('privacyChatAdminLastActivity'));
await new Promise(setImmediate);
assert(before.calls.includes('/auth/v1/logout'));
assert.equal(before.el.get('status').textContent,'Signed out after 5 hours of inactivity.');
const expired = page(last+5*hour,last);
assert(!expired.store.has('privacyChatAdminSession'));
assert.deepEqual(expired.calls,['/auth/v1/logout']);
const active = page(last+hour,last);
vm.runInContext('recordActivity()',active.context);
assert.equal(active.store.get('privacyChatAdminLastActivity'),String(last+hour));
const expiredToken = page(last+5*hour,last,1);
assert(!expiredToken.store.has('privacyChatAdminSession'));
await new Promise(setImmediate);
assert.deepEqual(expiredToken.calls,['/auth/v1/token','/auth/v1/logout']);
console.log('PASS unexpired reload, activity timestamp, five-hour expiry and expired-token revocation flow');
})().catch(error => { console.error(error);process.exitCode=1; });
