// 并排对比、抽一张（含 AI 推荐）、聊天记录阅读和绑定、独立世界书编辑和草稿、标签列表、模板导入导出
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path'); const os = require('os');
const B = 'http://127.0.0.1:5199'; const MOCK = 'http://127.0.0.1:5197';
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const J = async (p) => (await fetch(B + p)).json();
const send = (method, p, body) => fetch(B + p, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const upload = async (name, text) => (await fetch(`${B}/api/items?filename=${encodeURIComponent(name)}&mode=new`, { method: 'POST', body: Buffer.from(text) })).json();
(async () => {
  await send('PUT', '/api/ai/config', { profiles: [{ id: 'm', name: 'mock', format: 'openai', baseUrl: `${MOCK}/v1`, apiKey: 'sk-test-1234', model: 'mock-small' }], active: 'm' });
  let items = (await J('/api/state')).items.filter((i) => !i.deletedAt);
  const chars = items.filter((i) => i.type === 'character');
  const wb = items.find((i) => i.type === 'worldbook');
  ok(chars.length >= 3 && wb, `fixtures: ${chars.length} cards, a world book`);

  // ---- AI 推荐（接口）
  const rec = await (await send('POST', '/api/ai/recommend', { ids: chars.map((c) => c.id), want: '轻松一点的' })).json();
  ok(rec.picks.length === 2 && rec.picks[0].id === chars[1].id && rec.picks[1].id === chars[0].id && rec.considered === chars.length, `picks mapped back to items, repeats and unknown numbers dropped (${JSON.stringify(rec.picks.map((x) => x.reason))})`);
  ok((await send('POST', '/api/ai/recommend', { ids: chars.map((c) => c.id), want: '  ' })).status === 400, 'empty wish is refused');

  // ---- 独立世界书保存（接口）
  const wb0 = (await J(`/api/items/${wb.id}/content`)).data;
  ok((await send('PUT', `/api/items/${chars[0].id}/json`, { data: { entries: {} } })).status === 400 && (await send('PUT', `/api/items/${wb.id}/json`, { data: { nope: 1 } })).status === 400, 'only world books, and only valid data, can be saved this way');

  // ---- 聊天记录
  const chat = [JSON.stringify({ user_name: '阿雪', character_name: chars[0].name, create_date: '2026-01-01' }),
    ...Array.from({ length: 130 }, (_, i) => JSON.stringify({ name: i % 2 ? chars[0].name : '阿雪', is_user: i % 2 === 0, is_system: false, send_date: `2026-01-01 10:${String(i % 60).padStart(2, '0')}`, mes: `第 ${i + 1} 句话 *动作*` }))].join('\n');
  const up = await upload('和朋友的聊天.jsonl', chat);
  ok(up.item?.type === 'chat', `chat log recognised (${up.item?.type})`);
  ok((await send('PATCH', `/api/items/${up.item.id}`, { chatOf: 123 })).status === 200 && !(await J('/api/state')).items.find((i) => i.id === up.item.id).chatOf, 'binding must be an item id string');

  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  const c = await b.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
  await c.addInitScript(() => { if (!localStorage.getItem('tv_prefs')) localStorage.setItem('tv_prefs', JSON.stringify({ detailTab: 'content', detailTabOther: 'content' })); });
  const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const typeTab = async (label) => { await p.click(`.seg-item:has-text("${label}")`); await p.waitForTimeout(300); };

  // 聊天记录：气泡、分段加载、绑定
  await p.goto(B + '/#/library'); await p.waitForSelector('.seg-item');
  await typeTab('聊天记录');
  await p.click('.card:has-text("和朋友的聊天"), .row-item:has-text("和朋友的聊天")'); await p.waitForSelector('.chat-log .dlg-turn');
  ok(await p.locator('.chat-log .dlg-turn').count() === 80 && await p.locator('.chat-log .dlg-turn.user').count() === 40, 'first 80 messages as bubbles, user and character on their own sides');
  ok((await p.textContent('.chat-more')).includes('80 / 130'), 'says how many are shown');
  await p.click('.chat-more .btn:has-text("再显示")'); await p.waitForTimeout(200);
  ok(await p.locator('.chat-log .dlg-turn').count() === 130, 'load more shows the rest');
  ok((await p.textContent('.chat-bind')).includes(`和「${chars[0].name}」的聊天`), 'shows who the chat is with');
  await p.click('.chat-bind .btn:has-text("绑定角色卡")'); await p.waitForSelector('.sheet:has-text("绑定到哪张角色卡") .row-item');
  ok((await p.textContent('.sheet:has-text("绑定到哪张角色卡") .row-item >> nth=0')).includes(chars[0].name), 'the card with the same name comes first');
  await p.click('.sheet:has-text("绑定到哪张角色卡") .row-item >> nth=0'); await p.waitForTimeout(700);
  ok((await J('/api/state')).items.find((i) => i.id === up.item.id).chatOf === chars[0].id, 'bound to the card');
  ok(await p.locator('.chat-bind .chat-card').count() === 1, 'chat page now links to the card');
  await p.click('.chat-bind .chat-card'); await p.waitForTimeout(500);
  await p.locator('.overlay').last().locator('.tabs button:has-text("介绍")').click(); await p.waitForTimeout(400);
  ok(await p.locator('.panel:has-text("聊天记录 · 1") .chat-link').count() === 1, 'the card lists its chat log');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200); await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  // 并排对比
  await p.goto(B + '/#/library'); await p.waitForSelector('.seg-item'); await typeTab('角色卡');
  await p.click('button[title="多选"]');
  for (const i of [0, 1, 2]) await p.click(`.card >> nth=${i}`);
  await p.click('.selbar :text("更多")');
  await p.click('.menu-item:has-text("并排对比")'); await p.waitForSelector('.cmp-row.diff');
  ok(await p.locator('.cmp-head .cmp-cell').count() === 3, 'three columns');
  const rowsAll = await p.locator('.cmp-row:not(.cmp-head)').count();
  ok(rowsAll > 3 && await p.locator('.cmp-row.diff:has-text("描述")').count() === 1, `fields side by side (${rowsAll} rows)`);
  const hasSame = await p.locator('.cmp-row.same').count();
  await p.click('.cmp-toggle .switch'); await p.waitForTimeout(200);
  ok(await p.locator('.cmp-row.same').count() === 0 && await p.locator('.cmp-row.diff').count() === rowsAll - hasSame, 'only the differences when asked');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.click('.selbar .btn:has-text("完成"), button:has-text("完成")').catch(() => {});

  // 抽一张
  await p.goto(B + '/#/library'); await p.waitForSelector('.seg-item'); await typeTab('角色卡');
  await p.click('button[title="抽一张"]'); await p.waitForSelector('.draw-empty');
  const seen = new Set();
  for (let i = 0; i < chars.length; i++) { await p.click('.sheet .btn:has-text("随便抽一张")'); await p.waitForTimeout(120); seen.add(await p.textContent('.draw-card b')); }
  ok(seen.size === chars.length, `no repeats until every card has come up (${seen.size}/${chars.length})`);
  await p.fill('.draw-ai input', '轻松一点的'); await p.click('.draw-ai .btn:has-text("让 AI 挑")'); await p.waitForSelector('.draw-reason');
  ok(await p.locator('.draw-card').count() === 2 && (await p.textContent('.draw-card >> nth=0')).includes('标签对得上'), 'AI picks shown with reasons');
  await p.click('.draw-card >> nth=0'); await p.waitForSelector('.detail-sheet');
  ok(true, 'a pick opens the item');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  // 独立世界书：编辑 + 草稿
  await p.goto(B + '/#/library'); await p.waitForSelector('.seg-item'); await typeTab('世界书');
  await p.click(`.card:has-text("${wb.name}"), .row-item:has-text("${wb.name}")`); await p.waitForSelector('.reader-tools .btn:has-text("编辑条目")');
  const n0 = Object.keys(wb0.entries).length;
  await p.click('.reader-tools .btn:has-text("编辑条目")'); await p.waitForSelector('.book-edit-item');
  ok(await p.locator('.book-edit-item').count() === n0, `editor opens the stand-alone world book (${n0})`);
  await p.click('.sheet .btn:has-text("添加条目")'); await p.waitForSelector('.book-edit-item.open');
  await p.fill('.book-edit-item.open .field:has-text("标题") input', '草稿里的条目'); await p.waitForTimeout(800);
  await p.reload(); await p.waitForSelector('.seg-item'); await typeTab('世界书');
  await p.click(`.card:has-text("${wb.name}"), .row-item:has-text("${wb.name}")`); await p.waitForSelector('.reader-tools .btn:has-text("编辑条目")');
  await p.click('.reader-tools .btn:has-text("编辑条目")'); await p.waitForSelector('.sheet.dialog:has-text("恢复草稿")');
  await p.click('.sheet.dialog .btn:has-text("恢复")'); await p.waitForTimeout(300);
  ok(await p.locator('.book-edit-item').count() === n0 + 1 && (await p.textContent('.book-edit')).includes('草稿里的条目'), 'draft restored after the page was reloaded');
  await p.click('.sheet-foot .btn:has-text("保存")'); await p.waitForTimeout(900);
  const wb1 = (await J(`/api/items/${wb.id}/content`)).data;
  const added = Object.values(wb1.entries).find((e) => e.comment === '草稿里的条目');
  ok(Object.keys(wb1.entries).length === n0 + 1 && added && Array.isArray(added.key) && !Array.isArray(wb1.entries), 'saved in the world-book file format (entries keyed, key/keysecondary)');
  ok(await p.evaluate(() => !Object.keys(localStorage).some((k) => k.startsWith('tv_draft_book_'))), 'draft cleared after saving');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  // 模板导出 / 导入
  await p.goto(B + '/#/settings/ai'); await p.waitForSelector('.ai-rules summary');
  await p.click('.ai-rules summary:has-text("提示词模板")');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('.tpl-acts .btn:has-text("导出")')]);
  const file = path.join(os.tmpdir(), `tv-tpl-${Date.now()}.json`); await dl.saveAs(file);
  const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
  ok(pack.kind === 'ai-templates' && pack.templates.length === 1 && !('id' in pack.templates[0]) && pack.templates[0].name === '默认', 'export writes a template file without internal ids');
  pack.templates[0].tagLimit = 3;
  fs.writeFileSync(file, JSON.stringify(pack));
  await p.setInputFiles('.tpl-acts input[type=file]', file); await p.waitForTimeout(700);
  const tpls = (await J('/api/ai/config')).templates;
  ok(tpls.length === 1 && tpls[0].name === '默认 2' && tpls[0].tagLimit === 3, `import adds it under a new name (${tpls.map((t) => t.name)})`);
  fs.writeFileSync(file, '{"not":"a template"}');
  await p.setInputFiles('.tpl-acts input[type=file]', file); await p.waitForTimeout(400);
  ok((await J('/api/ai/config')).templates.length === 1, 'a file that is not a template is refused');
  fs.rmSync(file, { force: true });

  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
})();
