// AI 新增功能的界面：自定义读取范围、改原始回复重新解析、对话重新生成和撤回、挑几张
const { chromium } = require('playwright');
const B = 'http://127.0.0.1:5199'; const MOCK = 'http://127.0.0.1:5197';
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const J = async (p) => (await fetch(B + p)).json();
const send = (method, p, body) => fetch(B + p, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
let page = null;
(async () => {
  await send('PUT', '/api/ai/config', { profiles: [{ id: 'm', name: 'mock', format: 'openai', baseUrl: `${MOCK}/v1`, apiKey: 'sk-test-1234', model: 'mock-small' }], active: 'm', organize: { scope: 'standard' } });
  const card = (await J('/api/state')).items.find((i) => i.type === 'character' && !i.deletedAt);
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1200, height: 900 } })).newPage(); page = p;
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));

  // 读取范围：自定义
  await p.goto(B + '/#/settings/ai'); await p.waitForSelector('.ai-rules summary');
  await p.click('.ai-rules summary:has-text("整理规则")'); await p.waitForSelector('.ai-rules .opt:has-text("自定义")');
  ok(await p.locator('.read-box').isHidden(), 'part list hidden for the presets');
  await p.click('.ai-rules .opt:has-text("自定义")'); await p.waitForSelector('.read-box .read-parts');
  ok(await p.locator('.read-parts .opt.active').count() === 7 && !(await p.locator('.read-parts .opt:has-text("系统提示词")').getAttribute('class')).includes('active'), 'defaults: everything but the system prompt');
  await p.click('.read-parts .opt:has-text("对话示例")'); await p.click('.read-box .opt:has-text("不读")');
  await p.click('.ai-rules .btn:has-text("保存规则")'); await p.waitForTimeout(700);
  const cfg = await J('/api/ai/config');
  ok(cfg.organize.scope === 'custom' && cfg.organize.read.example === false && cfg.organize.read.book === 'none' && cfg.organize.read.description === true, 'choices saved');
  await send('PUT', '/api/ai/config', { organize: { scope: 'standard' } });

  // 改原始回复重新解析
  await send('PATCH', `/api/items/${card.id}`, { notes: 'BADJSON' });
  await send('POST', '/api/ai/organize', { ids: [card.id] });
  for (let i = 0; i < 60; i++) { const d = (await J('/api/ai/drafts')).drafts.find((x) => x.id === card.id); if (d && d.status === 'error') break; await p.waitForTimeout(150); }
  await p.goto(B + '/#/library'); await p.reload(); await p.waitForSelector('.card');
  await p.click(':text("AI 待审核")');
  await p.waitForSelector('.ai-card.is-error .btn:has-text("原始回复")');
  await p.click('.ai-card.is-error .btn:has-text("原始回复")'); await p.waitForSelector('.raw-edit');
  await p.click('.sheet-foot .btn:has-text("重新解析")'); await p.waitForTimeout(500);
  ok(await p.locator('.raw-edit').count() === 1 && (await p.textContent('.sheet:has(.raw-edit) .note.warn')).includes('JSON'), 'still broken: stays open and says why');
  const raw = await p.inputValue('.raw-edit');
  await p.fill('.raw-edit', raw.replace('"原创" "奇幻"', '"原创","奇幻"'));
  await p.click('.sheet-foot .btn:has-text("重新解析")'); await p.waitForSelector('.ai-card.is-done', { timeout: 6000 });
  ok(await p.locator('.raw-edit').count() === 0 && await p.locator('.ai-card.is-done .ai-tag').count() === 2 && (await p.textContent('.ai-card.is-done .ai-model')).includes('手动改过回复'), 'fixed reply becomes a normal draft to review');
  await send('POST', '/api/ai/drafts/discard', { ids: [card.id] }); await send('PATCH', `/api/items/${card.id}`, { notes: '' });
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  // 对话：重新生成、撤回改问
  await p.goto(B + '/#/library'); await p.reload(); await p.waitForSelector('.card');
  await p.click('button[title="AI 对话"]'); await p.waitForSelector('.chat-empty');
  const say = async (t) => { await p.fill('textarea.chat-input', t); const n = await p.locator('.chat-msg.user').count() + 1; await p.keyboard.press('Enter'); await p.waitForFunction((k) => document.querySelectorAll('button[title="重新生成"]').length === k, n, { timeout: 10000 }); await p.waitForTimeout(200); };
  await say('第一句'); await say('第二句');
  ok(await p.locator('button[title="重新生成"]').count() === 2 && await p.locator('button[title="撤回，改了再问"]').count() === 2, 'every reply can be regenerated, every question rewound');
  await p.locator('button[title="重新生成"]').first().click(); await p.waitForSelector('.sheet.dialog');
  ok((await p.textContent('.sheet.dialog')).includes('后面的 2 条'), 'says how many later messages go');
  await p.click('.sheet.dialog .btn:has-text("重新生成")'); await p.waitForTimeout(400);
  await p.waitForFunction(() => document.querySelectorAll('button[title="重新生成"]').length === 1 && !document.querySelector('.chat-msg.pending'), null, { timeout: 10000 }); await p.waitForTimeout(200);
  ok(await p.locator('.chat-msg.user').count() === 1 && await p.locator('.chat-msg.ai').count() === 1, 'back to one round with a fresh reply');
  await p.locator('button[title="撤回，改了再问"]').first().click(); await p.waitForTimeout(600);
  const box = await p.evaluate(() => [...document.querySelectorAll('textarea')].map((t) => t.value).find((v) => v) || '');
  ok(box === '第一句' && await p.locator('.chat-msg').count() === 0, 'question handed back to the input box');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  // 挑几张
  await p.click('button[title="抽一张"]'); await p.waitForSelector('.draw-ai-n');
  await p.selectOption('.draw-ai-n', '1'); await p.fill('.draw-ai input', '轻松的'); await p.click('.draw-ai .btn:has-text("让 AI 挑")'); await p.waitForSelector('.draw-reason');
  ok(await p.locator('.draw-card').count() === 1, 'asks for as many as chosen');

  ok(!errs.length, `no page errors ${errs.join(' | ')}`);
  await b.close();
})().catch(async (e) => { console.log('FAIL crashed', e.message.split('\n').slice(0, 4).join(' / ')); if (page) await page.screenshot({ path: __dirname + '/.work/logs/ai-more-ui-crash.png' }).catch(() => {}); process.exit(1); });
