import fs from 'node:fs';
const B = 'http://127.0.0.1:5199'; const D = process.argv[2];
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const login = async (pw, ip) => { const r = await fetch(B + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(ip ? { 'CF-Connecting-IP': ip } : {}) }, body: JSON.stringify({ password: pw }) }); return { status: r.status, body: await r.json() }; };
// --- 登录保护 ---
let r;
for (let i = 1; i <= 4; i++) { r = await login('wrong', '10.0.0.1'); if (i === 3) ok(r.status === 401 && /再错 2 次/.test(r.body.error), `3rd wrong warns: ${r.body.error}`); }
r = await login('wrong', '10.0.0.1'); ok(r.status === 429, `5th wrong → locked: ${r.body.error}`);
r = await login('testpw', '10.0.0.1'); ok(r.status === 429, 'correct password blocked during lock');
r = await login('testpw', '10.0.0.2'); ok(r.status === 200 && r.body.token, 'other source can still log in');
const token = r.body.token; const H = { Authorization: 'Bearer ' + token };
const log = await (await fetch(B + '/api/security/log', { headers: H })).json();
ok(log.log.length >= 6 && log.log[0].ok && log.locked.some((l) => l.ip === '10.0.0.1'), `login log ${log.log.length} entries, locked ${JSON.stringify(log.locked.map((l) => l.ip))}`);
ok((await fetch(B + '/api/security/log')).status === 401, 'login log needs auth');
ok(fs.existsSync(D + '/login-log.json'), 'login log persisted');
for (let i = 0; i < 50; i++) await login('wrong', `10.1.0.${i}`);
r = await login('testpw', '10.2.0.1'); ok(r.status === 429 && /暂停新登录/.test(r.body.error), `global lock after 50 fails: ${r.body.error}`);
ok((await fetch(B + '/api/state', { headers: H })).status === 200, 'already logged-in device unaffected');
// --- 自动备份 ---
const put = (b) => fetch(B + '/api/settings', { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
await put({ autoBackup: { on: true, keep: 3 } });
let bl = await (await fetch(B + '/api/backups', { headers: H })).json();
ok(bl.on && bl.keep === 3 && bl.list.filter((b) => b.auto).length === 1, `first auto backup made on enable (${bl.list.map((b) => b.name)})`);
await put({ autoBackup: { on: true } });
bl = await (await fetch(B + '/api/backups', { headers: H })).json();
ok(bl.list.filter((b) => b.auto).length === 1, 'no second backup within 23h');
const st = await (await fetch(B + '/api/state', { headers: H })).json(); const it = st.items[0];
for (let i = 0; i < 4; i++) {
  for (const b of fs.readdirSync(D + '/backups').filter((f) => f.includes('-auto-'))) { const t = new Date(Date.now() - 25 * 3600e3); fs.utimesSync(`${D}/backups/${b}`, t, t); }
  await fetch(B + `/api/items/${it.id}`, { method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: `n${i}` }) });
  await new Promise((r) => setTimeout(r, 1100));
  await put({ autoBackup: { on: true } });
}
bl = await (await fetch(B + '/api/backups', { headers: H })).json();
ok(bl.list.filter((b) => b.auto).length === 3, `pruned to keep 3 auto (${bl.list.filter((b) => b.auto).length})`);
for (const b of fs.readdirSync(D + '/backups').filter((f) => f.includes('-auto-'))) { const t = new Date(Date.now() - 25 * 3600e3); fs.utimesSync(`${D}/backups/${b}`, t, t); }
const before = bl.list.length; await put({ autoBackup: { on: true } });
ok((await (await fetch(B + '/api/backups', { headers: H })).json()).list.length === before, 'unchanged data → no duplicate backup');
const m = await (await fetch(B + '/api/backups', { method: 'POST', headers: H })).json();
ok(m.name.includes('-manual-'), 'manual backup ' + m.name);
const dl = await fetch(B + `/api/backups/${m.name}?token=${token}`); const zip = Buffer.from(await dl.arrayBuffer());
ok(dl.status === 200 && zip.length > 1000 && zip.toString('latin1').includes('db.json'), `download ${zip.length} bytes`);
ok((await fetch(B + `/api/backups/${m.name}`)).status === 401, 'download needs auth');
ok((await fetch(B + `/api/backups/..%2Fdb.json`, { headers: H })).status === 404, 'bad name rejected');
await fetch(B + `/api/items/${it.id}`, { method: 'DELETE', headers: H, }); await fetch(B + `/api/items/${it.id}?hard=1`, { method: 'DELETE', headers: H });
const rs = await (await fetch(B + `/api/backups/${m.name}/restore?mode=merge`, { method: 'POST', headers: H })).json();
const st2 = await (await fetch(B + '/api/state', { headers: H })).json();
ok(rs.ok && st2.items.some((x) => x.id === it.id), `restore from server backup brought item back (added ${rs.added})`);
ok((await fetch(B + `/api/backups/${m.name}`, { method: 'DELETE', headers: H })).status === 200 && !fs.existsSync(`${D}/backups/${m.name}`), 'delete backup');
const zipNames = zip.toString('latin1'); ok(!zipNames.includes('login-log') && !zipNames.includes('ai.json') && !zipNames.includes('thumbs/'), 'backup excludes login log / ai keys / thumbs');
