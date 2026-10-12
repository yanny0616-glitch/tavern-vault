// 标签整理：AI 合并建议、合并时记住旧写法（同义词）、以后各处自动换成现在的标签
const B = 'http://127.0.0.1:5199';
let fails = 0; const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fails++; };
const j = async (m, u, b) => { const r = await fetch(B + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json()) }; };
const state = () => j('GET', '/api/state');
const tagCount = (st) => { const m = {}; for (const i of st.items) if (!i.deletedAt) for (const t of i.tags) m[t] = (m[t] || 0) + 1; return m; };

// AI 建议：只给建议，不改数据；不存在的、重复出现的、空的组都去掉
let r = await j('POST', '/api/ai/tags/suggest');
ok(r.status === 400 && /还没有配置/.test(r.error), 'suggest needs an AI service');
await j('PUT', '/api/ai/config', { profiles: [{ id: 'm', name: 'mock', format: 'openai', baseUrl: 'http://127.0.0.1:5197/v1', apiKey: 'sk-test-1234', model: 'mock-small' }], active: 'm' });
const before = tagCount(await state());
r = await j('POST', '/api/ai/tags/suggest');
const sent = (await (await fetch('http://127.0.0.1:5197/__last')).json()).find((x) => x.tagMerge)?.tagMerge || '';
ok(/温柔（3）/.test(sent) && /共 7 个/.test(sent), 'all tags with counts sent to AI');
ok(r.groups?.length === 2 && r.groups[0].to === '现代' && r.groups[0].from.map((x) => x.tag).join() === '都市' && r.groups[0].toCount === 2, 'valid group kept, unknown tag dropped: ' + JSON.stringify(r.groups?.[0]));
ok(r.groups[1].to === '温婉' && r.groups[1].toCount === 0 && r.groups[1].from[0].tag === '温柔' && r.groups[1].from[0].count === 3, 'merge into a new name allowed');
ok(JSON.stringify(tagCount(await state())) === JSON.stringify(before), 'suggest changes nothing');

// 合并并记住旧写法
r = await j('POST', '/api/tags/replace', { ops: [{ from: ['都市'], to: ['现代'] }], remember: true });
let st = await state();
ok(r.count === 1 && !tagCount(st)['都市'] && tagCount(st)['现代'] === 2, 'merged 都市 into 现代 (that card already had 现代): ' + r.count + ' ' + JSON.stringify(tagCount(st)));
ok(JSON.stringify(st.settings.tagAliases) === '{"都市":"现代"}', 'alias remembered');
const it = st.items.find((i) => !i.deletedAt && i.type === 'character');
await j('PATCH', `/api/items/${it.id}`, { tags: ['都市', '新标签', '现代'] });
st = await state();
ok(st.items.find((i) => i.id === it.id).tags.join() === '现代,新标签', 'manual tags use the remembered alias');
await j('POST', '/api/batch', { ids: [st.items.find((i) => i.type === 'worldbook').id], action: 'addTags', value: ['都市'] });
st = await state();
ok(st.items.find((i) => i.type === 'worldbook').tags.includes('现代') && !st.items.find((i) => i.type === 'worldbook').tags.includes('都市'), 'batch add uses alias');
// 不记住
await j('POST', '/api/tags/replace', { ops: [{ from: ['校园'], to: ['学园'] }] });
ok(!('校园' in (await state()).settings.tagAliases), 'not remembered unless asked');
// 改名：指向它的同义词跟着改；改回去不会成环
await j('POST', '/api/tags/replace', { ops: [{ from: ['现代'], to: ['现实'] }], remember: true });
st = await state();
ok(JSON.stringify(st.settings.tagAliases) === '{"都市":"现实","现代":"现实"}', 'aliases follow rename: ' + JSON.stringify(st.settings.tagAliases));
await j('POST', '/api/tags/replace', { ops: [{ from: ['现实'], to: ['现代'] }], remember: true });
st = await state();
ok(JSON.stringify(st.settings.tagAliases) === '{"都市":"现代","现实":"现代"}', 'rename back without cycles: ' + JSON.stringify(st.settings.tagAliases));
// 删除标签：指向它的同义词去掉
await j('POST', '/api/tags/replace', { ops: [{ from: ['现代'], to: [] }] });
ok(JSON.stringify((await state()).settings.tagAliases) === '{}', 'deleting a tag drops its aliases');
// 手动编辑同义词：链条拉直、成环和自己指自己的丢掉
r = await j('PUT', '/api/tags/aliases', { aliases: { 甲: '乙', 乙: '丙', 天: '地', 地: '天', 同: '同', ' 空格 ': ' 标签 ' } });
ok(JSON.stringify(r.aliases) === '{"甲":"丙","乙":"丙","空格":"标签"}', 'aliases cleaned: ' + JSON.stringify(r.aliases));
process.exit(fails ? 1 : 0);
