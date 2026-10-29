// AI 对话和提示词模板：网页操作（模拟 AI，seed 数据，无密码）
const { chromium } = require('playwright');
const OUT = process.argv[2]; const B = 'http://127.0.0.1:5199';
require('fs').mkdirSync(OUT, { recursive: true });
let fails = 0; const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fails++; };
const j = async (m, u, b) => (await fetch(B + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })).json();
(async () => {
  await j('PUT', '/api/ai/config', { profiles: [{ id: 'm', name: '模拟服务', format: 'openai', baseUrl: 'http://127.0.0.1:5197/v1', apiKey: 'sk-test-1234', model: 'mock-small' }, { id: 'n', name: '备用', format: 'anthropic', baseUrl: 'http://127.0.0.1:5197', apiKey: 'sk-test-1234', model: 'mock-large' }], active: 'm' });
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  for (const [label, vp, mobile] of [['phone', { width: 393, height: 820 }, true], ['desk', { width: 1280, height: 860 }, false]]) {
    const c = await b.newContext({ viewport: vp, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
    const p = await c.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
    // 从详情「更多」进入：带上这张卡
    await p.goto(B + '/#/library'); await p.waitForSelector('.card');
    await p.click('.card:has-text("星澜")'); await p.waitForSelector('.detail-sheet');
    await p.click('button[title="更多操作"]'); await p.click('.menu-item:has-text("问 AI")');
    await p.waitForSelector('.ai-chat .chat-empty');
    ok(await p.locator('.ai-chat .chat-ref-name').allTextContents().then((t) => t.join() === '星澜'), `${label}: card attached as ref`);
    ok(await p.locator('.ai-chat .chat-idea').count() >= 3, `${label}: suggestions shown`);
    await p.screenshot({ path: `${OUT}/${label}-empty.png` });
    await p.locator('.ai-chat .chat-idea').first().click();
    await p.waitForSelector('.ai-chat .chat-msg.ai:not(.pending) .md', { timeout: 8000 });
    const reply = await p.textContent('.ai-chat .chat-msg.ai:not(.pending) .md');
    ok(/第 1 轮/.test(reply) && /参考：星澜/.test(reply), `${label}: reply received via SSE`);
    ok(await p.locator('.ai-chat .md li').count() === 2 && await p.locator('.ai-chat .md strong').count() >= 1, `${label}: markdown rendered (list, bold)`);
    ok(/设定有没有前后矛盾/.test(await p.textContent('.ai-chat .sheet-head h2')), `${label}: auto title`);
    // 第二条，用输入框
    await p.fill('.ai-chat .chat-input', '那开场白呢 SLOWME');
    await p.click('.ai-chat .chat-send');
    await p.waitForSelector('.ai-chat .chat-msg.pending');
    ok(await p.locator('.ai-chat .chat-send.stop').count() === 1, `${label}: send button turns into stop while pending`);
    // 边生成边显示，点停止留下已生成的部分
    await p.waitForSelector('.ai-chat .chat-msg.pending .chat-caret', { timeout: 8000 });
    const t1 = (await p.textContent('.ai-chat .chat-msg.pending')).length;
    await p.waitForTimeout(700);
    const t2 = (await p.textContent('.ai-chat .chat-msg.pending')).length;
    ok(/慢慢说/.test(await p.textContent('.ai-chat .chat-msg.pending')) && t2 > t1, `${label}: reply streams in (${t1} → ${t2})`);
    await p.screenshot({ path: `${OUT}/${label}-pending.png` });
    await p.click('.ai-chat .chat-send.stop');
    await p.waitForSelector('.ai-chat .chat-msg.pending', { state: 'detached', timeout: 10000 });
    ok(/慢慢说/.test(await p.locator('.ai-chat .chat-msg.ai .md').last().textContent()) && /已停止，上面是已经生成的部分/.test(await p.textContent('.ai-chat .chat-msgs')), `${label}: stopped reply kept with note`);
    await p.screenshot({ path: `${OUT}/${label}-stopped.png` });
    // 设置：范围、轮数、服务、预览
    await p.click('.ai-chat .chat-chip:has-text("设置")');
    await p.waitForSelector('.ai-chat .chat-opts:not([hidden])');
    await p.click('.ai-chat .chat-opt .opt:has-text("最近 6 轮")');
    await p.selectOption('.ai-chat .chat-opt select', 'n');
    await p.waitForTimeout(300);
    await p.click('.ai-chat button:has-text("预览这一轮要发送的内容")');
    await p.waitForSelector('.sheet:has-text("发送内容预览") pre.code');
    const pv = await p.textContent('.sheet:has-text("发送内容预览")');
    ok(pv.includes('备用') && pv.includes('mock-large') && pv.includes('月影城'), `${label}: preview uses chosen profile and card content`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    // 指定条目：再加一张
    await p.click('.ai-chat .chat-chip:has-text("指定条目")');
    await p.waitForSelector('.sheet:has-text("指定条目") .row-item');
    await p.fill('.sheet:has-text("指定条目") input[type=search]', '白夜');
    await p.click('.sheet:has-text("指定条目") .row-item:has-text("白夜")');
    await p.click('.sheet:has-text("指定条目") .sheet-foot button:has-text("确定")');
    await p.waitForTimeout(400);
    ok((await p.locator('.ai-chat .chat-ref-name').allTextContents()).join() === '星澜,白夜', `${label}: second ref added`);
    await p.fill('.ai-chat .chat-input', '比较一下');
    await p.click('.ai-chat .chat-send');
    await p.waitForFunction(() => /第 1 轮/.test([...document.querySelectorAll('.ai-chat .chat-msg.ai:not(.pending) .md')].pop()?.textContent || '') && /星澜、白夜/.test([...document.querySelectorAll('.ai-chat .chat-msg.ai:not(.pending) .md')].pop()?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
    ok(/星澜、白夜/.test(await p.locator('.ai-chat .chat-msg.ai .md').last().textContent()), `${label}: two refs sent with the anthropic profile`);
    // 失败和重试
    await p.fill('.ai-chat .chat-input', 'FAILME');
    await p.click('.ai-chat .chat-send');
    await p.waitForSelector('.ai-chat .chat-err', { timeout: 8000 });
    ok(await p.locator('.ai-chat .chat-err button:has-text("重试")').count() === 1, `${label}: error with retry`);
    await p.screenshot({ path: `${OUT}/${label}-chat.png` });
    // 历史：关掉再打开，从历史里找回来
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    while (await p.$('.overlay')) { await p.keyboard.press('Escape'); await p.waitForTimeout(200); }
    await p.click('button[title="AI 对话"]');
    await p.waitForSelector('.ai-chat .chat-empty');
    ok(await p.locator('.ai-chat .chat-ref').count() === 0, `${label}: toolbar opens a blank chat`);
    await p.click('.ai-chat button[title="历史对话"]');
    await p.waitForSelector('.ai-chat .chat-hist');
    await p.screenshot({ path: `${OUT}/${label}-history.png` });
    const n0 = await p.locator('.ai-chat .chat-hist').count();
    await p.locator('.ai-chat .chat-hist').first().click();
    await p.waitForSelector('.ai-chat .chat-msg.user');
    ok(await p.locator('.ai-chat .chat-msg.user').count() === 4, `${label}: history reopened with all messages`);
    await p.click('.ai-chat button[title="历史对话"]'); await p.waitForSelector('.ai-chat .chat-hist');
    await p.locator('.ai-chat .chat-hist').first().locator('button[title="删除"]').click();
    await p.click('.sheet.dialog .btn.danger');
    await p.waitForTimeout(500);
    ok(await p.locator('.ai-chat .chat-hist').count() === n0 - 1, `${label}: deleted from history`);
    while (await p.$('.overlay')) { await p.keyboard.press('Escape'); await p.waitForTimeout(200); }
    // 多选 → 问 AI
    await p.click('button[title="多选"]');
    await p.locator('.card').nth(0).click(); await p.locator('.card').nth(1).click();
    await p.click('.sel-act:has-text("问 AI")');
    await p.waitForSelector('.ai-chat');
    ok(await p.locator('.ai-chat .chat-ref').count() === 2, `${label}: selection opens chat with 2 refs`);
    while (await p.$('.overlay')) { await p.keyboard.press('Escape'); await p.waitForTimeout(200); }
    ok(!errs.length, `${label}: no page errors ${errs.join(' | ')}`);
    await c.close();
  }

  // ---- 修改建议：预览、应用、撤销 ----
  {
    const c = await b.newContext({ viewport: { width: 393, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    const st = await j('GET', '/api/state'); const x = st.items.find((i) => i.name === '星澜');
    const files0 = x.files.length;
    await p.goto(B + '/#/library'); await p.waitForSelector('.card');
    await p.click('.card:has-text("星澜")'); await p.waitForSelector('.detail-sheet');
    await p.click('button[title="更多操作"]'); await p.click('.menu-item:has-text("问 AI")');
    await p.fill('.ai-chat .chat-input', 'EDITME 开场白改得更有悬念');
    await p.click('.ai-chat .chat-send');
    await p.waitForSelector('.ai-chat .chat-edit', { timeout: 8000 });
    ok(!(await p.textContent('.ai-chat .chat-msgs')).includes('tv-edit') && /修改建议 · 星澜/.test(await p.textContent('.chat-edit')), 'edit block hidden, suggestion card shown');
    ok(await p.locator('.chat-edit .chip-s').count() === 5, 'changed parts listed');
    await p.screenshot({ path: `${OUT}/edit-card.png` });
    await p.click('.chat-edit button:has-text("预览改动")');
    await p.waitForSelector('.sheet:has-text("改动预览") .diff-lines');
    ok(await p.locator('.sheet:has-text("改动预览") .chat-edit-diff').count() === 4 && /第 9 条/.test(await p.textContent('.sheet:has-text("改动预览")')), 'preview: 4 diffs + warning');
    await p.screenshot({ path: `${OUT}/edit-preview.png` });
    await p.click('.sheet:has-text("改动预览") .sheet-foot button:has-text("应用")');
    await p.waitForSelector('.chat-edit.applied');
    ok(/已存成「星澜」的新版本/.test(await p.textContent('.chat-edit')), 'applied from preview');
    let it = (await j('GET', '/api/state')).items.find((i) => i.id === x.id);
    ok(it.files.length === files0 + 1, 'new version on server');
    await p.screenshot({ path: `${OUT}/edit-applied.png` });
    await p.click('.chat-edit button:has-text("撤销")');
    await p.waitForSelector('.chat-edit:not(.applied)');
    ok(/已撤销/.test(await p.textContent('.chat-edit')), 'undo shown');
    it = (await j('GET', '/api/state')).items.find((i) => i.id === x.id);
    ok(it.files.length === files0, 'version removed on undo');
    await p.click('.chat-edit button:has-text("应用")');
    await p.waitForSelector('.chat-edit.applied');
    await p.click('.chat-edit button:has-text("查看")');
    await p.waitForTimeout(500);
    await p.locator('.detail-sheet').last().locator('.tabs button:has-text("文件")').click();
    await p.waitForTimeout(400);
    ok(/AI 修改/.test(await p.locator('.detail-sheet').last().textContent()), 'detail files tab shows the AI version');
    await p.screenshot({ path: `${OUT}/edit-files.png` });
    ok(!errs.length, 'no page errors ' + errs.join(' | '));
    await c.close();
  }

  // ---- 世界书的修改建议 ----
  {
    const c = await b.newContext({ viewport: { width: 393, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(B + '/#/library'); await p.waitForSelector('.card');
    await p.click('.main .seg-item:has-text("世界书")');
    await p.click('.card:has-text("魔法学院世界书")'); await p.waitForSelector('.detail-sheet');
    await p.click('button[title="更多操作"]'); await p.click('.menu-item:has-text("问 AI")');
    await p.fill('.ai-chat .chat-input', 'EDITWB 帮我完善');
    await p.click('.ai-chat .chat-send');
    await p.waitForSelector('.ai-chat .chat-edit', { timeout: 8000 });
    ok(/修改建议 · 魔法学院世界书/.test(await p.textContent('.chat-edit')) && await p.locator('.chat-edit .chip-s').count() === 4, 'worldbook suggestion card');
    await p.click('.chat-edit button:has-text("预览改动")');
    await p.waitForSelector('.sheet:has-text("改动预览") .chat-edit-diff');
    const pv = await p.textContent('.sheet:has-text("改动预览")');
    ok(await p.locator('.sheet:has-text("改动预览") .chat-edit-diff').count() === 4 && /的关键词/.test(pv) && /新增条目「图书馆」/.test(pv), 'worldbook preview shows keys, title, new entry');
    await p.screenshot({ path: `${OUT}/edit-worldbook.png` });
    await p.click('.sheet:has-text("改动预览") .sheet-foot button:has-text("应用")');
    await p.waitForSelector('.chat-edit.applied');
    ok(/已存成「魔法学院世界书」的新版本/.test(await p.textContent('.chat-edit')), 'worldbook applied');
    await p.click('.chat-edit button:has-text("撤销")');
    await p.waitForSelector('.chat-edit:not(.applied)');
    ok(!errs.length, 'no page errors ' + errs.join(' | '));
    await c.close();
  }

  // ---- 提示词模板 ----
  {
    const c = await b.newContext({ viewport: { width: 393, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(B + '/#/settings/ai'); await p.waitForSelector('.ai-rules');
    await p.click('.ai-rules summary:has-text("提示词模板")');
    const box = p.locator('.ai-rules:has(summary:has-text("提示词模板"))');
    ok(await box.locator('.opt.active:has-text("默认")').count() === 1 && await box.locator('textarea[readonly]').count() === 5, 'default template is read-only');
    await box.locator('button:has-text("预览完整提示词")').click();
    await p.waitForSelector('.sheet:has-text("完整提示词") pre.code');
    const pv = await p.textContent('.sheet:has-text("完整提示词")');
    ok(pv.includes('最多 6 个') && pv.includes('一律忽略') && pv.includes('名称：'), 'full prompt preview with fixed rules and example item');
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    await box.locator('button:has-text("复制一份来改")').click();
    await p.fill('.sheet.dialog input', '玩法标签');
    await p.click('.sheet.dialog .btn.primary');
    await p.waitForSelector('.ai-rules .opt.active:has-text("玩法标签")');
    await box.locator('.input-unit input').first().fill('3');
    await p.waitForTimeout(200);
    await box.locator('textarea').nth(3).fill('不要用英文标签UIFORBID');
    await box.locator('button:has-text("保存")').click();
    await p.waitForTimeout(500);
    await box.locator('button:has-text("使用这个模板")').click();
    await p.waitForSelector('.ai-rules .opt:has-text("玩法标签") .chip-s');
    await p.screenshot({ path: `${OUT}/template.png`, fullPage: false });
    const cfg = await j('GET', '/api/ai/config');
    const t = cfg.templates.find((x) => x.name === '玩法标签');
    ok(t && t.tagLimit === 3 && t.forbidden === '不要用英文标签UIFORBID' && cfg.organize.template === t.id, 'custom template saved and selected');
    const prev = await j('POST', '/api/ai/organize/preview', {});
    ok(prev.system.includes('最多 3 个') && prev.system.includes('UIFORBID'), 'organize preview uses the selected template');
    // 改了没保存，切走时提醒
    await box.locator('textarea').nth(0).fill('随便改改');
    await box.locator('.opt:has-text("默认")').click();
    ok(await p.locator('.sheet.dialog:has-text("还没保存")').count() === 1, 'unsaved changes guarded');
    await p.click('.sheet.dialog .btn.primary'); await p.waitForTimeout(300);
    ok((await j('GET', '/api/ai/config')).templates.find((x) => x.id === t.id).role !== '随便改改', 'discarded edit not saved');
    ok(!errs.length, 'no page errors ' + errs.join(' | '));
    await c.close();
  }
  await b.close(); process.exit(fails ? 1 : 0);
})();
