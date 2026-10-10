// AI 修复：要求不串卡、替换标签不清空、AI 简介单独存、中文引号、截断提示、解读缓存按模型
const B = 'http://127.0.0.1:5199';
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const j = async (m, u, b) => { const r = await fetch(B + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return r.json(); };
const wait = async () => { let d; for (let i = 0; i < 60; i++) { d = await j('GET', '/api/ai/drafts'); if (d.summary.queued + d.summary.running === 0) break; await new Promise((r) => setTimeout(r, 300)); } return d; };
await j('PUT', '/api/ai/config', { profiles: [{ id: 'm', name: 'mock', format: 'openai', baseUrl: 'http://127.0.0.1:5197/v1', apiKey: 'sk-test-1234', model: 'mock-small' }], active: 'm', organize: { batch: 5, concurrency: 1 } });
let st = await j('GET', '/api/state');
const live = st.items.filter((i) => !i.deletedAt);
const ids = live.slice(0, 4).map((i) => i.id);
// 1) 一项带要求，其余不带：带要求的单独发，要求不出现在合并请求里
await j('POST', '/api/ai/organize', { ids: [ids[0]], extra: 'EXTRA_ONLY_FOR_ONE' });
await j('POST', '/api/ai/organize', { ids: ids.slice(1) });
let d = await wait();
const log = await (await fetch('http://127.0.0.1:5197/__last')).json();
const calls = log.filter((x) => x.path === '/v1/chat/completions');
const withExtra = calls.filter((c) => JSON.stringify(c.body).includes('EXTRA_ONLY_FOR_ONE'));
ok(withExtra.length === 1 && !withExtra[0].body.messages[1].content.includes('<item id="2"'), `extra sent only in a single request (${withExtra.length})`);
ok(calls.some((c) => c.body.messages[1].content.includes('<item id="3"') && !JSON.stringify(c.body).includes('EXTRA_ONLY')), 'batch request has no foreign extra');
ok(ids.every((id) => d.drafts.find((x) => x.id === id)?.status === 'done'), 'all 4 done');
// 2) 写入：替换标签但一个都没选 → 标签不变；AI 简介单独存，作者简介不动
const it0 = live[0];
await j('POST', '/api/ai/drafts/apply', { items: [{ id: ids[0], tags: [], tagMode: 'replace', summary: 'AI 写的一句话', summaryMode: 'ai', fields: {} }] });
st = await j('GET', '/api/state'); let a0 = st.items.find((i) => i.id === ids[0]);
ok(JSON.stringify(a0.tags) === JSON.stringify(it0.tags), `replace with no tags keeps tags (${a0.tags})`);
ok(a0.ai.summary === 'AI 写的一句话' && a0.description === it0.description, 'summary stored in ai.summary, description untouched');
// 旧草稿里的 replace / notes 也只写 AI 简介
await j('POST', '/api/ai/drafts/apply', { items: [{ id: ids[1], tags: ['x1'], tagMode: 'append', summary: '旧模式的简介', summaryMode: 'replace', fields: {} }] });
st = await j('GET', '/api/state'); const a1 = st.items.find((i) => i.id === ids[1]);
ok(a1.ai.summary === '旧模式的简介' && a1.description === live[1].description && a1.tags.includes('x1'), 'legacy replace mode → ai.summary only');
// 选「不要」：保留之前的 AI 简介
await j('POST', '/api/ai/organize', { ids: [ids[0]] }); await wait();
await j('POST', '/api/ai/drafts/apply', { items: [{ id: ids[0], tags: [], tagMode: 'keep', summary: '新的', summaryMode: 'keep', fields: {} }] });
st = await j('GET', '/api/state'); a0 = st.items.find((i) => i.id === ids[0]);
ok(a0.ai.summary === 'AI 写的一句话', 'keep mode preserves previous AI summary');
// 搜索能搜到 AI 简介
const sr = await j('GET', `/api/search?q=${encodeURIComponent('AI 写的一句话')}`);
ok(Boolean(sr.hits?.[ids[0]]), `search finds AI summary (${JSON.stringify(sr.hits?.[ids[0]])})`);
// 3) 中文引号 + 尾逗号
await j('PATCH', `/api/items/${ids[2]}`, { notes: 'QUOTEME' });
await j('PUT', '/api/ai/config', { organize: { batch: 1 } });
await j('POST', '/api/ai/organize', { ids: [ids[2]] }); d = await wait();
const q = d.drafts.find((x) => x.id === ids[2]);
ok(q.status === 'done' && q.result.summary === '他读完了“雨夜”这本书', `Chinese quotes kept: ${q.result?.summary || q.error}`);
// 4) 截断
await j('PATCH', `/api/items/${ids[3]}`, { notes: 'TRUNCME' });
await j('POST', '/api/ai/organize', { ids: [ids[3]] }); d = await wait();
const t = d.drafts.find((x) => x.id === ids[3]);
ok(t.status === 'error' && /最大输出 tokens/.test(t.error) && t.truncated, `truncation hint: ${t.error}`);
await j('POST', '/api/ai/drafts/discard', { ids: d.drafts.map((x) => x.id) });
// 5) 版本解读缓存按模型
const xl = st.items.find((i) => i.files.length >= 2) || st.items.find((i) => i.name === '星澜');
if (xl.files.length < 2) {
  const content = await j('GET', `/api/items/${xl.id}/content`); const cd = structuredClone(content.card); (cd.data || cd).description += '（新版）';
  await j('PUT', `/api/items/${xl.id}/card`, { card: cd });
}
st = await j('GET', '/api/state'); const x2 = st.items.find((i) => i.id === xl.id);
const [fa, fb] = x2.files;
const e1 = await j('POST', '/api/ai/explain', { a: { sha: fa.sha }, b: { sha: fb.sha } });
const e2 = await j('POST', '/api/ai/explain', { a: { sha: fa.sha }, b: { sha: fb.sha } });
await j('PUT', '/api/ai/config', { profiles: [{ id: 'm', name: 'mock', format: 'openai', baseUrl: 'http://127.0.0.1:5197/v1', apiKey: 'sk-test-1234', model: 'mock-large' }], active: 'm' });
const e3 = await j('POST', '/api/ai/explain', { a: { sha: fa.sha }, b: { sha: fb.sha } });
ok(!e1.cached && e2.cached && !e3.cached, `explain cache per model (${e1.cached},${e2.cached},${e3.cached})`);
