const B = 'http://127.0.0.1:5199';
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const j = async (m, u, b) => { const r = await fetch(B + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return r.json(); };
await j('PUT', '/api/ai/config', { profiles: [{ id: 'm', name: 'mock', format: 'openai', baseUrl: 'http://127.0.0.1:5197/v1', apiKey: 'sk-test-1234', model: 'mock-small' }], active: 'm', organize: { batch: 5, concurrency: 1 } });
const st = await j('GET', '/api/state'); const ids = st.items.filter((i) => !i.deletedAt).slice(0, 7).map((i) => i.id);
// one item gets DROPME in its notes so the mock omits it
await j('PATCH', `/api/items/${ids[2]}`, { notes: 'DROPME' });
const est = await j('POST', '/api/ai/organize/estimate', { ids });
ok(est.requests === 2 && est.batch === 5, `estimate: ${est.count} items → ${est.requests} requests, in ${est.inTokens}`);
await j('PUT', '/api/ai/config', { organize: { batch: 1 } });
const est1 = await j('POST', '/api/ai/organize/estimate', { ids });
ok(est1.requests === 7 && est1.inTokens > est.inTokens, `per-item: 7 requests, in ${est1.inTokens} > ${est.inTokens}`);
await j('PUT', '/api/ai/config', { organize: { batch: 5 } });
await j('POST', '/api/ai/organize', { ids });
let d; for (let i = 0; i < 40; i++) { d = await j('GET', '/api/ai/drafts'); if (d.summary.queued + d.summary.running === 0) break; await new Promise((r) => setTimeout(r, 300)); }
const last = await (await fetch('http://127.0.0.1:5197/__last')).json();
const calls = last.filter((x) => x.path === '/v1/chat/completions');
ok(calls.length >= 2 && last.some((x) => x.batch === 5), `mock saw batch requests (${last.map((x) => x.batch || x.path).join(',')})`);
const by = new Map(d.drafts.map((x) => [x.id, x]));
const done = ids.filter((id) => by.get(id)?.status === 'done');
ok(done.length === 6, `6 done (${done.length})`);
const names = new Map(st.items.map((i) => [i.id, i.name]));
ok(done.every((id) => by.get(id).result.summary.endsWith(names.get(id))), 'each result matched to the right item even though reply order was reversed');
ok(by.get(ids[2]).status === 'error' && /没有这一项/.test(by.get(ids[2]).error), `missing item → error: ${by.get(ids[2]).error}`);
ok(by.get(ids[0]).batchSize === 5, 'batchSize recorded');
const sys = calls.find((c) => c.body.messages[1].content.includes('<item id="2"')).body.messages[0].content;
ok(sys.includes('id 照抄') && !sys.includes('只输出一个 JSON 对象，不要任何解释，不要代码块。格式：\n{"tags"'), 'batch system prompt rewritten');
// retry the failed one alone (single → runOne path)
await j('PATCH', `/api/items/${ids[2]}`, { notes: '' });
await j('POST', '/api/ai/organize', { ids: [ids[2]] });
for (let i = 0; i < 20; i++) { d = await j('GET', '/api/ai/drafts'); if (d.summary.queued + d.summary.running === 0) break; await new Promise((r) => setTimeout(r, 300)); }
ok(d.drafts.find((x) => x.id === ids[2]).status === 'done', 'single retry goes through normal path');
await j('PUT', '/api/ai/config', { organize: { batch: 99 } });
ok((await j('GET', '/api/ai/config')).organize.batch === 10, 'batch clamped to 10');
