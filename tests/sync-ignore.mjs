const B = 'http://127.0.0.1:5199';
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const { token } = await (await fetch(B + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'testpw' }) })).json();
const H = { Authorization: 'Bearer ' + token };
const j = async (m, u, b, raw) => (await fetch(B + u, { method: m, headers: raw ? H : { ...H, 'Content-Type': 'application/json' }, body: raw ? b : b ? JSON.stringify(b) : undefined })).json();
let st = await j('GET', '/api/state');
const chars = st.items.filter((i) => i.type === 'character' && !i.deletedAt);
ok(chars.every((i) => i.files.filter((f) => f.sig).every((f) => f.parts && f.parts.v === 2 && f.parts['book.sbt'])), `old files backfilled with parts (${chars.length} cards)`);
const it = chars.find((i) => i.name === '程砚'); const pf = it.files.find((f) => f.primary);
const png = Buffer.from(await (await fetch(`${B}/api/files/${pf.sha}?token=${token}`)).arrayBuffer());
const content = await j('GET', `/api/items/${it.id}/content`);
const card = structuredClone(content.card); const d = card.data || card;
d.character_book = { entries: [{ keys: ['x'], content: '我在酒馆里改的世界书', comment: 'mine' }] };
const mod = Buffer.from(JSON.stringify(card));
for (const keep of [true, false]) {
  await j('PUT', '/api/settings', { syncIgnore: ['book'], syncKeep: keep });
  const r = await j('POST', `/api/items?filename=jc.json&origin=tavern&target=${it.id}&match=version`, mod, true);
  ok(r.status === 'duplicate' && r.ignoredOnly, `keep=${keep}: book-only change → duplicate, ignoredOnly (${r.status})`);
}
await j('PUT', '/api/settings', { syncIgnore: [] });
const r2 = await j('POST', `/api/items?filename=jc.json&origin=tavern&target=${it.id}&match=version`, mod, true);
ok(r2.status === 'version', 'no ignore → version as before');
// not from tavern: normal uploads never use ignore
await j('PUT', '/api/settings', { syncIgnore: ['book', 'greet', 'setting', 'notes', 'bogus'] });
st = await j('GET', '/api/state');
ok(JSON.stringify(st.settings.syncIgnore) === '["book","greet","setting","notes"]', 'invalid part key dropped');
d.description = '另一个描述'; d.character_book = { entries: [] };
const r3 = await j('POST', `/api/items?filename=jc2.json&target=${it.id}&match=version`, Buffer.from(JSON.stringify(card)), true);
ok(r3.status === 'version', 'manual upload ignores the setting');
// 只改一项：在服务器当前列表上增删，不覆盖别处刚勾的
await j('PUT', '/api/settings', { syncIgnore: ['entryState'] });
await j('PUT', '/api/settings', { syncIgnoreSet: { entryConst: true } });
await j('PUT', '/api/settings', { syncIgnoreSet: { greet: true, bogus: true } });
st = await j('GET', '/api/state');
ok(JSON.stringify(st.settings.syncIgnore) === '["entryState","entryConst","greet"]', 'syncIgnoreSet adds without overwriting: ' + JSON.stringify(st.settings.syncIgnore));
await j('PUT', '/api/settings', { syncIgnoreSet: { entryState: false, greet: false } });
st = await j('GET', '/api/state');
ok(JSON.stringify(st.settings.syncIgnore) === '["entryConst"]', 'syncIgnoreSet removes');
await j('PUT', '/api/settings', { syncIgnore: [] });
