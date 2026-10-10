// 服务端测试：备份暂停、搜索、版本号、预设识别
const B = 'http://127.0.0.1:5199';
let fails = 0; const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fails++; };
const { token } = await (await fetch(B + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'testpw' }) })).json();
const H = { Authorization: `Bearer ${token}` };
const j = async (p, o = {}) => { const r = await fetch(B + p, { ...o, headers: { ...H, ...(o.headers || {}) } }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const post = (p, body) => j(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const up = async (name, data, q = '') => j(`/api/items?filename=${encodeURIComponent(name)}${q.replace('?', '&')}`, { method: 'POST', body: data });
// search
const s1 = await j('/api/search?q=' + encodeURIComponent('刑侦卷宗'));
const ids = Object.keys(s1.hits); console.log('search 刑侦卷宗 →', ids.length, JSON.stringify(Object.values(s1.hits)[0]).slice(0, 120));
ok(ids.length >= 1, 'deep search finds regex/greeting content');
const st = await j('/api/state'); const byId = new Map(st.items.map((i) => [i.id, i]));
ok(!ids.every((id) => (byId.get(id).searchText || '').includes('刑侦卷宗')), 'deep search finds things not in list searchText');
const s2 = await j('/api/search?q=' + encodeURIComponent('刑侦卷宗 -程砚'));
ok(Object.keys(s2.hits).length < ids.length, 'negative term excludes: ' + Object.keys(s2.hits).length);
// version ordering
const card = (v, desc) => JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: { name: '版本测试', creator: 'tester', character_version: v, description: desc, first_mes: 'hi' } });
const r1 = await up('版本测试.json', card('2.0', 'v2 desc'));
const r2 = await up('版本测试.json', card('1.0', 'v1 desc'), '?match=version');
console.log(JSON.stringify({ s1: r1.status ?? r1.results?.[0]?.status, r2: (r2.results?.[0] || r2).status, older: (r2.results?.[0] || r2).older }));
const res2 = r2.results?.[0] || r2;
ok(res2.status === 'version' && res2.older === true && res2.currentVersion === '2.0', 'older version stored as history');
const it = (await j('/api/state')).items.find((i) => i.name === '版本测试');
const prim = it.files.find((f) => f.primary);
ok(it.files.length === 2 && prim.ver === '2.0', 'primary stays v2');
const r3 = await up('版本测试.json', card('3.0', 'v3 desc'), '?match=version');
const it3 = (await j('/api/state')).items.find((i) => i.name === '版本测试');
ok((r3.results?.[0] || r3).older === false && it3.files.find((f) => f.primary).ver === '3.0', 'newer version becomes primary');
// preset effective prompts
const preset = { name: '测试预设', temperature: 1, openai_max_context: 1000, prompts: [{ identifier: 'a', name: 'A', content: 'aaa', enabled: true }, { identifier: 'b', name: 'B', content: 'bbb', enabled: true }, { identifier: 'c', name: 'C', content: 'ccc' }],
  prompt_order: [{ character_id: 100000, order: [{ identifier: 'a', enabled: true }] }, { character_id: 100001, order: [{ identifier: 'b', enabled: true }, { identifier: 'a', enabled: false }] }], extensions: { regex_scripts: [{ scriptName: 'R1', findRegex: 'x', replaceString: 'y' }] } };
await up('测试预设.json', JSON.stringify(preset));
const pi = (await j('/api/state')).items.find((i) => i.name === '测试预设');
ok(pi.meta.enabledPrompts === 1 && pi.meta.regexCount === 1 && pi.meta.promptNames.join() === 'B,A,C', 'preset meta from prompt_order: ' + JSON.stringify([pi.meta.enabledPrompts, pi.meta.promptNames]));
// object-form embedded book
const objCard = JSON.stringify({ spec: 'chara_card_v2', data: { name: '对象世界书', first_mes: 'x', character_book: { entries: { 0: { keys: '雨，雪', content: '天气条目' }, 1: { keys: ['城'], content: '城市条目' } } } } });
await up('对象世界书.json', objCard);
const oi = (await j('/api/state')).items.find((i) => i.name === '对象世界书');
ok(oi.meta.card.bookEntries === 2, 'object-form entries counted: ' + oi.meta.card?.bookEntries);
const s3 = await j('/api/search?q=' + encodeURIComponent('城市条目'));
ok(s3.hits[oi.id]?.where === '内嵌世界书', 'search finds embedded book entry: ' + JSON.stringify(s3.hits[oi.id]));
// backup guard
const b0 = await post('/api/backups');
const bl = await j('/api/backups');
ok(bl.counts[b0.name] > 0 && !bl.guard, 'backup records count, no guard: ' + bl.counts[b0.name]);
process.exit(fails ? 1 : 0);
