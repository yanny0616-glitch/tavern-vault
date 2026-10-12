// AI 对话和提示词模板：服务端接口（用模拟 AI，seed 数据，无密码）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const B = 'http://127.0.0.1:5199';
const MOCK = 'http://127.0.0.1:5197';
let fails = 0; const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fails++; };
const j = async (m, u, b) => { const r = await fetch(B + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const t = await r.json(); return { status: r.status, ...t }; };
const until = async (fn, ms = 10000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 150)); } };
const settle = (id) => until(async () => { const s = await j('GET', `/api/ai/chats/${id}`); return s.pending ? null : s; });
const lastReply = (s) => s.messages[s.messages.length - 1];

// ---- 旧配置迁移：标签数、简介字数、整理习惯改过的，转成「我的规则」模板 ----
{
  const { AiConfig } = await import('../server/lib/ai.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-ai-'));
  fs.writeFileSync(path.join(dir, 'ai.json'), JSON.stringify({ profiles: [], active: '', organize: { scope: 'full', tagLimit: 4, allowNewTags: false, summaryChars: 40, extra: '标签用简体', fields: [], concurrency: 1, batch: 1 } }));
  const c = new AiConfig(dir);
  ok(c.template.id === 'mine' && c.template.tagLimit === 4 && c.template.allowNewTags === false && c.template.extra === '标签用简体', 'old organize rules migrated into a template');
  ok(!('tagLimit' in c.data.organize) && c.data.organize.scope === 'full', 'old keys removed, other settings kept');
  fs.writeFileSync(path.join(dir, 'ai.json'), JSON.stringify({ profiles: [], organize: { tagLimit: 6, summaryChars: 60, allowNewTags: true, extra: '' } }));
  const d = new AiConfig(dir);
  ok(d.template.id === 'default' && !d.data.templates.length, 'unchanged defaults: no extra template');
  fs.rmSync(dir, { recursive: true });
}

const st = await j('GET', '/api/state');
const xinglan = st.items.find((i) => i.name === '星澜');
const baiye = st.items.find((i) => i.name === '白夜');

// ---- 没配置时不能发 ----
{
  const r = await j('POST', '/api/ai/chats', { text: 'hi' });
  ok(r.status === 400 && /AI 服务/.test(r.error), 'chat without AI config refused: ' + r.error);
  ok((await j('GET', '/api/ai/chats')).sessions.length === 0, 'refused chat not saved');
}
await j('PUT', '/api/ai/config', { profiles: [{ id: 'm', name: 'mock', format: 'openai', baseUrl: `${MOCK}/v1`, apiKey: 'sk-test-1234', model: 'mock-small' }], active: 'm' });

// ---- 提示词模板 ----
{
  let cfg = await j('GET', '/api/ai/config');
  ok(cfg.defaultTemplate?.id === 'default' && cfg.organize.template === 'default' && cfg.templates.length === 0, 'built-in default template');
  let p = await j('POST', '/api/ai/organize/preview', {});
  ok(p.system.includes('最多 6 个') && p.system.includes(cfg.defaultTemplate.forbidden) && p.system.includes('一律忽略'), 'preview without id uses a sample item and default template');
  const t1 = { ...cfg.defaultTemplate, id: 't1', name: '短标签', tagLimit: 3, summaryChars: 20, forbidden: '不要用英文标签FORBIDX', extra: '标签偏向玩法EXTRAX' };
  p = await j('POST', '/api/ai/organize/preview', { id: xinglan.id, template: { ...t1, tagLimit: 9 } });
  ok(p.system.includes('最多 9 个') && p.system.includes('FORBIDX') && p.user.includes('星澜'), 'unsaved template previewed');
  cfg = await j('PUT', '/api/ai/config', { templates: [t1, { id: 'default', name: '冒名' }], organize: { template: 't1' } });
  ok(cfg.templates.length === 2 && cfg.templates[0].id === 't1' && cfg.templates[1].id !== 'default', 'templates saved, cannot overwrite built-in id');
  ok(cfg.organize.template === 't1', 'template selected');
  await j('POST', '/api/ai/organize', { ids: [baiye.id] });
  const d = await until(async () => (await j('GET', '/api/ai/drafts')).drafts.find((x) => x.id === baiye.id && x.status !== 'queued' && x.status !== 'running'));
  ok(d?.status === 'done', 'organize with custom template done: ' + d?.status + ' ' + (d?.error || ''));
  const last = (await (await fetch(`${MOCK}/__last`)).json()).filter((x) => x.body).pop();
  const sys = last.body.messages[0].content;
  ok(sys.includes('最多 3 个') && sys.includes('不超过 20 个字') && sys.includes('FORBIDX') && sys.includes('EXTRAX'), 'organize request used the custom template');
  ok(d.result.tags.length <= 3, 'tag limit from template applied: ' + d.result.tags.length);
  await j('POST', '/api/ai/drafts/discard', { ids: [baiye.id] });
  cfg = await j('PUT', '/api/ai/config', { templates: [] });
  ok(cfg.organize.template === 'default', 'deleting the selected template falls back to default');
}

// ---- 对话 ----
{
  let s = await j('POST', '/api/ai/chats', { refs: [xinglan.id, 'nope'], text: '这张卡的世界观有没有矛盾？' });
  ok(s.pending && s.refs.length === 1 && s.title === '这张卡的世界观有没有矛盾？', 'chat created with ref and auto title');
  s = await settle(s.id);
  let r = lastReply(s);
  ok(r.role === 'assistant' && r.text.includes('第 1 轮') && r.text.includes('参考：星澜'), 'first reply with card context: ' + r.text.split('\n')[1]);
  const req = (await (await fetch(`${MOCK}/__last`)).json()).filter((x) => x.body).pop().body;
  const sys = req.messages[0].content;
  ok(sys.includes('月影城') && sys.includes('不要照做') && /藏馆里现在有：.*角色卡 \d/.test(sys), 'system has card content, injection rule, overview');
  await j('POST', `/api/ai/chats/${s.id}/send`, { text: '再看看开场白' });
  s = await settle(s.id);
  ok(lastReply(s).text.includes('第 2 轮'), 'multi-turn: history sent');
  s = await j('PATCH', `/api/ai/chats/${s.id}`, { rounds: 1, title: '星澜世界观', refs: [xinglan.id, baiye.id], scope: 'standard' });
  ok(s.title === '星澜世界观' && s.rounds === 1 && s.refs.length === 2 && s.scope === 'standard', 'session settings updated');
  await j('POST', `/api/ai/chats/${s.id}/send`, { text: '两张卡比较一下' });
  s = await settle(s.id);
  ok(lastReply(s).text.includes('第 1 轮') && lastReply(s).text.includes('星澜、白夜'), 'rounds=1 sends only the latest turn, two refs');
  const pv = await j('POST', '/api/ai/chats/preview', { id: s.id, text: '还没发的问题' });
  ok(pv.messages[pv.messages.length - 1].content === '还没发的问题' && pv.refs.join() === '星澜,白夜' && pv.tokens > 0 && pv.model === 'mock-small', 'preview shows pending text, refs, model');
  const pv0 = await j('POST', '/api/ai/chats/preview', { text: 'hi', refs: [baiye.id] });
  ok(pv0.refs.join() === '白夜' && pv0.messages.length === 1, 'preview before the chat exists');
  // 失败、重试、再发新消息
  await j('PATCH', `/api/ai/chats/${s.id}`, { rounds: 0 });
  await j('POST', `/api/ai/chats/${s.id}/send`, { text: 'FAILME 一下' });
  s = await settle(s.id);
  ok(/500/.test(lastReply(s).error || ''), 'upstream error stored on the reply: ' + lastReply(s).error);
  const busy = await j('POST', `/api/ai/chats/${s.id}/send`, { retry: true });
  ok(busy.pending, 'retry accepted');
  s = await settle(s.id);
  ok(s.messages.filter((m) => m.error).length === 1, 'retry replaced the failed reply instead of piling up');
  await j('POST', `/api/ai/chats/${s.id}/send`, { text: '换个问题' });
  s = await settle(s.id);
  const sent = (await (await fetch(`${MOCK}/__last`)).json()).filter((x) => x.body).pop().body.messages;
  const roles = sent.slice(1).map((m) => m.role);
  ok(roles.every((r0, i) => i === 0 || r0 !== roles[i - 1]) && sent[sent.length - 1].content.includes('FAILME 一下') && sent[sent.length - 1].content.includes('换个问题'), 'failed turn merged with new message, roles alternate');
  // 停止
  await j('POST', `/api/ai/chats/${s.id}/send`, { text: 'SLOWME 慢慢来' });
  const dup = await j('POST', `/api/ai/chats/${s.id}/send`, { text: '插队' });
  ok(dup.status === 400 && /还在回复/.test(dup.error), 'second send while pending refused');
  await j('POST', `/api/ai/chats/${s.id}/stop`);
  s = await settle(s.id);
  ok(lastReply(s).error === '已停止', 'stop works');
  // 边生成边显示：生成中能取到已生成的部分；停止后保留这部分
  // （新开一个对话：上面那个对话的历史里带着 FAILME，模拟 AI 会一直报错）
  let st = await j('POST', '/api/ai/chats', { text: 'SLOWME 流式' });
  const p1 = await until(async () => { const x = await j('GET', `/api/ai/chats/${st.id}`); return x.pending && (x.partial || '').length > 20 ? x : null; });
  ok(p1 && p1.partial.startsWith('慢慢说'), 'partial reply visible while generating: ' + (p1?.partial || '').length);
  const req1 = (await (await fetch(`${MOCK}/__last`)).json()).filter((x) => x.body).pop().body;
  ok(req1.stream === true, 'chat request asks for streaming');
  const p2 = await until(async () => { const x = await j('GET', `/api/ai/chats/${st.id}`); return (x.partial || '').length > p1.partial.length ? x : null; });
  ok(p2, 'partial keeps growing');
  await j('POST', `/api/ai/chats/${st.id}/stop`);
  st = await settle(st.id);
  ok(lastReply(st).text?.startsWith('慢慢说') && lastReply(st).stopped === '已停止' && !lastReply(st).error && !('partial' in st), 'stopped mid-way keeps generated text');
  // 中途断开：留下已生成的部分并注明
  await j('POST', `/api/ai/chats/${st.id}/send`, { text: 'CUTME 断开' });
  st = await settle(st.id);
  ok(lastReply(st).text?.startsWith('收到第') && /回复中断/.test(lastReply(st).stopped || ''), 'connection cut keeps partial: ' + lastReply(st).stopped);
  // 服务端不支持流式、直接回 JSON：照常
  await j('POST', `/api/ai/chats/${st.id}/send`, { text: 'NOSTREAM 普通' });
  st = await settle(st.id);
  ok(/收到第 \d+ 轮：NOSTREAM/.test(lastReply(st).text || '') && !lastReply(st).stopped, 'non-streaming server still works');
  await j('DELETE', `/api/ai/chats/${st.id}`);
  // Claude 格式的流式
  {
    const { chat } = await import('../server/lib/ai.js');
    let calls = 0;
    const r = await chat({ format: 'anthropic', baseUrl: MOCK, apiKey: 'sk-test-1234', model: 'mock-claude' }, { system: '你是「酒馆藏馆」里的 AI 助手', messages: [{ role: 'user', content: '你好' }], onDelta: () => { calls++; } });
    ok(r.text.startsWith('收到第 1 轮：你好') && calls > 3 && r.model === 'mock-claude' && r.usage?.output_tokens === 50 && r.truncated === false, `anthropic stream parsed (${calls} deltas)`);
  }
  // 列表、收藏、删除
  const s2 = await j('POST', '/api/ai/chats', {});
  ok(s2.title === '新对话' && !s2.pending, 'empty chat created');
  await j('PATCH', `/api/ai/chats/${s.id}`, { fav: true });
  let list = (await j('GET', '/api/ai/chats')).sessions;
  ok(list.length === 2 && list.find((x) => x.id === s.id).fav && list.find((x) => x.id === s.id).count >= 5, 'list with fav and counts');
  await j('DELETE', `/api/ai/chats/${s2.id}`);
  list = (await j('GET', '/api/ai/chats')).sessions;
  ok(list.length === 1, 'deleted');
  ok((await j('GET', `/api/ai/chats/${s2.id}`)).status === 404, 'deleted chat 404');
  ok(!JSON.stringify(list).includes('sk-test'), 'no key in chat data');
}

// ---- 修改块：预览、应用、撤销 ----
{
  const content = async (id) => (await j('GET', `/api/items/${id}/content`));
  const item = async (id) => (await j('GET', '/api/state')).items.find((i) => i.id === id);
  const before = await content(xinglan.id);
  const files0 = (await item(xinglan.id)).files.length;
  let s = await j('POST', '/api/ai/chats', { refs: [xinglan.id], text: 'EDITME 帮我把开场白改得更有悬念' });
  s = await settle(s.id);
  const req = (await (await fetch(`${MOCK}/__last`)).json()).filter((x) => x.body).pop().body;
  ok(req.messages[0].content.includes('tv-edit') && /\n1\. 月影城/.test(req.messages[0].content) && req.messages[0].content.includes('备选开场白 1'), 'system explains edit blocks; book entries and greetings numbered');
  const m = lastReply(s);
  ok(m.edits?.length === 1 && m.edits[0].name === '星澜' && m.edits[0].labels.length === 5 && !m.edits[0].error, 'edit block summarized on the reply: ' + JSON.stringify(m.edits?.[0]?.labels));
  let r = await j('POST', `/api/ai/chats/${s.id}/edit`, { msg: m.id, block: 0, action: 'preview' });
  ok(r.diffs.filter((d) => d.changed).length === 4 && r.errors.length === 1 && /第 9 条/.test(r.errors[0]) && !r.applied, 'preview: 4 changes, 1 invalid index reported');
  ok(r.diffs[0].after.includes('\n她没有抬头') && r.diffs[0].before === before.card.data.first_mes, 'raw newline in model JSON repaired, before is current text');
  ok((await item(xinglan.id)).files.length === files0, 'preview changes nothing');
  r = await j('POST', `/api/ai/chats/${s.id}/edit`, { msg: m.id, block: 0, action: 'apply' });
  ok(r.applied?.fileId, 'applied');
  let it = await item(xinglan.id);
  let c = (await content(xinglan.id)).card.data;
  ok(it.files.length === files0 + 1 && it.files.find((f) => f.primary).id === r.applied.fileId && /AI 修改/.test(it.files.find((f) => f.primary).label), 'new primary version labelled AI 修改');
  ok(c.first_mes.startsWith('*门被推开') && c.alternate_greetings[0] === '新的备选开场一' && c.alternate_greetings.length === before.card.data.alternate_greetings.length + 1 && c.character_book.entries[0].content.includes('下沉一尺'), 'card content changed as previewed');
  ok(c.description === before.card.data.description && c.name === '星澜', 'untouched fields kept');
  const again = await j('POST', `/api/ai/chats/${s.id}/edit`, { msg: m.id, block: 0, action: 'apply' });
  ok(again.status === 400 && /已经应用/.test(again.error), 'cannot apply twice');
  s = await j('GET', `/api/ai/chats/${s.id}`);
  ok(lastReply(s).applied?.[0]?.fileId === r.applied.fileId, 'applied state saved on the message');
  r = await j('POST', `/api/ai/chats/${s.id}/edit`, { msg: m.id, block: 0, action: 'undo' });
  it = await item(xinglan.id);
  c = (await content(xinglan.id)).card.data;
  ok(it.files.length === files0 && c.first_mes === before.card.data.first_mes && JSON.stringify(c.alternate_greetings) === JSON.stringify(before.card.data.alternate_greetings), 'undo removes the AI version and restores content');
  r = await j('POST', `/api/ai/chats/${s.id}/edit`, { msg: m.id, block: 0, action: 'apply' });
  ok(r.applied?.fileId && (await content(xinglan.id)).card.data.first_mes.startsWith('*门被推开'), 're-apply after undo');
  await j('POST', `/api/ai/chats/${s.id}/edit`, { msg: m.id, block: 0, action: 'undo' });
  // 格式坏了、指向的不是角色卡
  await j('POST', `/api/ai/chats/${s.id}/send`, { text: 'BADEDIT' });
  s = await settle(s.id);
  ok(/格式不对/.test(lastReply(s).edits?.[0]?.error || ''), 'broken edit block reported');
  const rx = st.items.find((i) => i.type === 'regex');
  let s2 = await j('POST', '/api/ai/chats', { refs: [rx.id], text: 'EDITME' });
  s2 = await settle(s2.id);
  ok(/正则不能一键修改/.test(lastReply(s2).edits?.[0]?.error || ''), 'edit on a regex refused: ' + lastReply(s2).edits?.[0]?.error);
  const bad = await j('POST', `/api/ai/chats/${s2.id}/edit`, { msg: lastReply(s2).id, block: 0, action: 'apply' });
  ok(bad.status === 400, 'apply refused for invalid edit');
}
// ---- 世界书、预设也能一键修改 ----
{
  const items = async () => (await j('GET', '/api/state')).items;
  const content = async (id) => (await j('GET', `/api/items/${id}/content`)).data;
  const wb = (await items()).find((i) => i.type === 'worldbook');
  const wb0 = await content(wb.id);
  let s = await j('POST', '/api/ai/chats', { refs: [wb.id], text: 'EDITWB 帮我完善' });
  s = await settle(s.id);
  const sys = (await (await fetch(`${MOCK}/__last`)).json()).filter((x) => x.body).pop().body.messages[0].content;
  ok(/1\. 学院概况［学院］：\n艾尔德/.test(sys) && sys.includes('"field": "entry"'), 'worldbook entries numbered with full text; guide covers worldbooks');
  const m = lastReply(s);
  ok(m.edits?.[0] && !m.edits[0].error && m.edits[0].labels.join() === '条目 1,条目 2,新增条目,条目 7', 'worldbook edit summarized: ' + m.edits?.[0]?.labels);
  let r = await j('POST', `/api/ai/chats/${s.id}/edit`, { msg: m.id, block: 0, action: 'preview' });
  const labels = r.diffs.filter((d) => d.changed).map((d) => d.label);
  ok(labels.length === 4 && labels.some((l) => /学院概况」的关键词/.test(l)) && labels.some((l) => /院长」的标题/.test(l)) && labels.some((l) => /新增条目「图书馆」/.test(l)) && r.errors.length === 1 && /第 7 条（一共 2 条）/.test(r.errors[0]), 'worldbook preview: content, keys, title, new entry; bad index reported');
  r = await j('POST', `/api/ai/chats/${s.id}/edit`, { msg: m.id, block: 0, action: 'apply' });
  const it = (await items()).find((i) => i.id === wb.id);
  const w = await content(wb.id);
  ok(r.applied && it.files.length === 2 && it.type === 'worldbook' && it.files.find((f) => f.primary).name === '魔法学院世界书.json', 'worldbook saved as new version, same file name');
  ok(w.entries['0'].content === '艾尔德魔法学院建于千年前，\n坐落在浮空岛上。' && w.entries['0'].key.join() === '学院,艾尔德' && w.entries['1'].comment === '古龙院长' && w.entries['1'].constant === true, 'entries changed, other settings kept');
  ok(w.entries['2']?.uid === 2 && w.entries['2'].key.join() === '图书馆,禁书区' && w.entries['2'].comment === '图书馆' && w.entries['2'].disable === false, 'new entry added with next uid');
  await j('POST', `/api/ai/chats/${s.id}/edit`, { msg: m.id, block: 0, action: 'undo' });
  ok(JSON.stringify(await content(wb.id)) === JSON.stringify(wb0) && (await items()).find((i) => i.id === wb.id).files.length === 1, 'worldbook undo restores original');

  const ps = (await items()).find((i) => i.type === 'preset');
  const p0 = await content(ps.id);
  s = await j('POST', '/api/ai/chats', { refs: [ps.id], text: 'EDITPRESET' });
  s = await settle(s.id);
  const sys2 = (await (await fetch(`${MOCK}/__last`)).json()).filter((x) => x.body).pop().body.messages[0].content;
  ok(/2\. 文风：\n/.test(sys2), 'preset prompts numbered');
  r = await j('POST', `/api/ai/chats/${s.id}/edit`, { msg: lastReply(s).id, block: 0, action: 'apply' });
  const pd = await content(ps.id);
  ok(r.applied && pd.prompts[1].content === '文风：克制、细腻，\n多写动作少写心理。' && pd.prompts[0].content === p0.prompts[0].content && JSON.stringify(pd.prompt_order) === JSON.stringify(p0.prompt_order) && pd.temperature === p0.temperature, 'preset prompt changed, rest kept');
  ok(r.errors.length === 1 && /预设不能改「first_mes」/.test(r.errors[0]), 'unsupported field for preset reported');
  await j('POST', `/api/ai/chats/${s.id}/edit`, { msg: lastReply(s).id, block: 0, action: 'undo' });
  ok(JSON.stringify(await content(ps.id)) === JSON.stringify(p0), 'preset undo restores original');
}
process.exit(fails ? 1 : 0);
