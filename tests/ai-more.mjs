// AI 部分的补充：自定义读取范围、改原始回复重新解析、新标签归类、对话重新生成和撤回、挑卡数量和分批（模拟 AI，seed 数据）
const B = 'http://127.0.0.1:5199';
const MOCK = 'http://127.0.0.1:5197';
let fails = 0; const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fails++; };
const j = async (m, u, b) => { const r = await fetch(B + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const t = await r.json(); return { status: r.status, ...t }; };
const until = async (fn, ms = 12000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 150)); } };
const upload = async (name, text) => (await fetch(`${B}/api/items?filename=${encodeURIComponent(name)}&mode=new`, { method: 'POST', body: Buffer.from(text) })).json();
const draftOf = (id) => until(async () => { const d = (await j('GET', '/api/ai/drafts')).drafts.find((x) => x.id === id); return d && (d.status === 'done' || d.status === 'error') ? d : null; });

await j('PUT', '/api/ai/config', { profiles: [{ id: 'm', name: 'mock', format: 'openai', baseUrl: `${MOCK}/v1`, apiKey: 'sk-test-1234', model: 'mock-small' }], active: 'm' });

// ---- 自定义读取范围
const book = { entries: [
  { id: 0, keys: ['灯塔'], comment: '开着的条目', content: '灯塔的内容ENTRYON', enabled: true, insertion_order: 1 },
  { id: 1, keys: ['码头'], comment: '关掉的条目', content: '码头的内容ENTRYOFF', enabled: false, insertion_order: 2 }] };
const big = (await upload('读取范围测试.json', JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: { name: '读取范围测试', description: 'DESC描述', personality: 'PERS性格', scenario: 'SCEN场景', first_mes: 'FIRST开场', alternate_greetings: ['ALT备选'], mes_example: 'EXAM示例', system_prompt: 'SYS系统', creator_notes: 'NOTE注释', character_book: book } }))).item;
const prev = async () => (await j('POST', '/api/ai/organize/preview', { id: big.id })).user;
const std = await prev();
ok(['DESC', 'PERS', 'SCEN', 'FIRST', 'ALT', 'EXAM', 'NOTE', 'ENTRYON'].every((k) => std.includes(k)) && !std.includes('SYS系统') && !std.includes('ENTRYOFF'), 'standard scope unchanged');
let cfg = await j('PUT', '/api/ai/config', { organize: { scope: 'custom', read: { personality: false, example: false, alt: false, system: true, book: 'none', level: 'nope', junk: 1 } } });
ok(cfg.organize.scope === 'custom' && cfg.organize.read.level === 'standard' && cfg.organize.read.book === 'none' && !('junk' in cfg.organize.read) && cfg.organize.read.description === true, 'custom read settings cleaned and saved');
const c1 = await prev();
ok(c1.includes('DESC') && c1.includes('SCEN') && c1.includes('SYS系统') && !c1.includes('PERS性格') && !c1.includes('EXAM') && !c1.includes('ALT备选') && !c1.includes('内嵌世界书'), 'only the ticked parts are sent, world book left out');
await j('PUT', '/api/ai/config', { organize: { scope: 'custom', read: { book: 'all', bookBody: false } } });
const c2 = await prev();
ok(c2.includes('关掉的条目') && c2.includes('［关闭］') && !c2.includes('ENTRYON') && !c2.includes('ENTRYOFF'), 'world book: closed entries listed when asked, titles only');
await j('PUT', '/api/ai/config', { organize: { scope: 'custom', read: { book: 'enabled', bookBody: true } } });
const c3 = await prev();
ok(c3.includes('ENTRYON') && !c3.includes('关掉的条目'), 'world book: enabled entries only, with content');
const est = await j('POST', '/api/ai/organize/estimate', { ids: [big.id] });
ok(est.count === 1 && est.inTokens > 0, 'estimate works with the custom scope');
await j('PUT', '/api/ai/config', { organize: { scope: 'standard' } });

// ---- 改原始回复重新解析
await j('PATCH', `/api/items/${big.id}`, { notes: 'BADJSON' });
await j('POST', '/api/ai/organize', { ids: [big.id] });
let d = await draftOf(big.id);
ok(d?.status === 'error' && d.raw.includes('"原创" "奇幻"'), `broken reply kept for editing (${d?.error})`);
let rp = await j('POST', '/api/ai/drafts/reparse', { id: big.id, raw: d.raw });
ok(rp.status === 400, 'reparsing the same broken text still fails, with a message');
rp = await j('POST', '/api/ai/drafts/reparse', { id: big.id, raw: d.raw.replace('"原创" "奇幻"', '"原创","奇幻"') });
ok(rp.status === 200 && rp.draft.status === 'done' && rp.draft.edited === true && rp.draft.result.tags.map((t) => t.name).join() === '原创,奇幻' && rp.draft.result.summary.includes('读取范围测试'), 'fixed by hand and parsed without another request');
ok((await j('POST', '/api/ai/drafts/reparse', { id: 'nope', raw: '{}' })).status === 400, 'unknown draft refused');
rp = await j('POST', '/api/ai/drafts/reparse', { id: big.id, raw: JSON.stringify({ items: [{ id: '1', tags: ['甲'], summary: 'a' }, { id: '2', tags: ['乙'], summary: 'b' }] }) });
ok(rp.status === 400, 'a multi-item reply cannot be matched to a single-request draft');
await j('POST', '/api/ai/drafts/discard', { ids: [big.id] });
await j('PATCH', `/api/items/${big.id}`, { notes: '' });

// ---- 新标签归类
await j('PUT', '/api/tags/groups', { groups: [{ name: '题材', tags: [] }, { name: '人设', tags: [] }] });
const sys = (await j('POST', '/api/ai/organize/preview', { id: big.id })).system;
ok(sys.includes('新标签归类') && sys.includes('「题材」「人设」') && sys.includes('"groups":{'), 'prompt asks where new tags belong once groups exist');
await j('POST', '/api/ai/organize', { ids: [big.id] });
d = await draftOf(big.id);
const byName = Object.fromEntries((d?.result?.tags || []).map((t) => [t.name, t]));
ok(byName['全新标签甲']?.group === '题材' && !byName['全新标签甲'].existing, `new tag sorted into an existing group (${JSON.stringify(d?.result?.tags)})`);
ok(d.result.tags.every((t) => !t.existing || !t.group) && d.result.tags.every((t) => t.group !== '不存在的分类'), 'existing tags and unknown groups are not sorted');
const sorted = d.result.tags.filter((t) => t.group);
await j('POST', '/api/ai/drafts/apply', { items: [{ id: big.id, tags: d.result.tags.map((t) => t.name), tagMode: 'append', summaryMode: 'keep', groups: { ...Object.fromEntries(sorted.map((t) => [t.name, t.group])), 没写入的: '题材', [sorted[0]?.name || 'x']: sorted[0]?.group || '题材' } }] });
const groups = (await j('GET', '/api/state')).settings.tagGroups;
ok(sorted.length > 0 && sorted.every((t) => groups.find((g) => g.name === t.group).tags.includes(t.name)) && !groups.some((g) => g.tags.includes('没写入的')), `accepted new tags land in their group (${JSON.stringify(groups)})`);
await j('PUT', '/api/tags/groups', { groups: [] });
ok(!(await j('POST', '/api/ai/organize/preview', { id: big.id })).system.includes('新标签归类'), 'no groups, no extra instruction');

// ---- 对话：重新生成、撤回改问
let s = await j('POST', '/api/ai/chats', { text: '第一句' });
const settle = (id) => until(async () => { const x = await j('GET', `/api/ai/chats/${id}`); return x.pending ? null : x; });
s = await settle(s.id);
await j('POST', `/api/ai/chats/${s.id}/send`, { text: '第二句' });
s = await settle(s.id);
ok(s.messages.length === 4, 'two rounds');
const a1 = s.messages[1]; const u2 = s.messages[2];
let r = await j('POST', `/api/ai/chats/${s.id}/regen`, { msg: u2.id });
ok(r.status === 400, 'only replies can be regenerated');
r = await j('POST', `/api/ai/chats/${s.id}/regen`, { msg: a1.id });
ok(r.status === 200 && r.pending === true && r.messages.length === 1, 'regenerating an earlier reply drops it and everything after');
s = await settle(s.id);
ok(s.messages.length === 2 && s.messages[1].role === 'assistant' && s.messages[1].id !== a1.id && s.messages[1].text, 'a fresh reply takes its place');
await j('POST', `/api/ai/chats/${s.id}/send`, { text: '要撤回的话' });
s = await settle(s.id);
r = await j('POST', `/api/ai/chats/${s.id}/rewind`, { msg: s.messages[2].id });
ok(r.status === 200 && r.text === '要撤回的话' && r.session.messages.length === 2, 'rewinding hands the question back and drops what followed');
ok((await j('POST', `/api/ai/chats/${s.id}/rewind`, { msg: s.messages[1].id })).status === 400, 'only questions can be rewound');
await j('DELETE', `/api/ai/chats/${s.id}`);

// ---- 挑卡：数量、分批
const chars = (await j('GET', '/api/state')).items.filter((i) => i.type === 'character' && !i.deletedAt);
r = await j('POST', '/api/ai/recommend', { ids: chars.map((c) => c.id), want: '轻松的', count: 1 });
ok(r.picks.length === 1 && r.requests === 1, 'count is respected');
const many = [];
for (let i = 0; i < 405; i++) many.push((await j('POST', '/api/items/manual', { name: `批量候选${i}`, type: 'prompt' })).id);
ok(many.filter(Boolean).length === 405, 'made 405 candidates');
r = await j('POST', '/api/ai/recommend', { ids: many, want: '随便', count: 3 });
ok(r.needSplit === true && r.total === 405 && r.batches === 2 && r.requests === 3 && !r.picks, 'too many candidates: asks first instead of cutting the list');
r = await j('POST', '/api/ai/recommend', { ids: many, want: '随便', count: 3, split: true });
ok(r.picks.length === 2 && r.requests === 3 && r.considered === 405 && r.picks.every((p) => many.includes(p.id)), `split into batches, then a final round (${r.requests} requests, ${r.picks.length} picks)`);
await j('POST', '/api/batch', { ids: many, action: 'purge' });

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
