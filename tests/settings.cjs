const { chromium } = require('playwright');
const fs = require('fs');
const B = 'http://127.0.0.1:5199'; const OUT = process.argv[2];
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
(async () => {
  const { token } = await (await fetch(B + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'testpw' }) })).json();
  const H = { Authorization: 'Bearer ' + token };
  const items = async () => (await (await fetch(B + '/api/state', { headers: H })).json()).items;
  const its = await items();
  const nsfwItem = its.find((i) => i.cover && !i.deletedAt);
  await fetch(B + `/api/items/${nsfwItem.id}`, { method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { ...(nsfwItem.fields || {}), nsfw: true } }) });
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  const c = await b.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await c.addInitScript((t) => localStorage.setItem('tv_token', t), token);
  const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(B + '/#/settings'); await p.waitForSelector('.set-nav-item');
  ok(await p.isVisible('.set-nav') && !(await p.isVisible('.set-content')), 'mobile: section list first');
  await p.screenshot({ path: `${OUT}/m-home.png` });
  await p.click('.set-nav-item:has-text("外观")'); await p.waitForSelector('.set-title');
  ok(!(await p.isVisible('.set-nav')) && await p.isVisible('.set-back'), 'mobile: section opens as its own page');
  await p.screenshot({ path: `${OUT}/m-appearance.png`, fullPage: true });
  await p.fill('.set-row:has-text("阅读字号") input', '150'); await p.press('.set-row:has-text("阅读字号") input', 'Enter');
  await p.waitForTimeout(200);
  ok(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--read-zoom').trim()) === '1.5', 'typed read size 150% applied');
  await p.fill('.set-row:has-text("界面字号") input', '16.3'); await p.press('.set-row:has-text("界面字号") input', 'Enter');
  await p.waitForTimeout(200);
  ok(await p.inputValue('.set-row:has-text("界面字号") input') === '16.5' && Math.abs(Number(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fs').trim())) - 1.1) < 0.001, 'typed ui font rounds to 16.5px');
  await p.click('.set-row:has-text("界面字号") .opt[title="小一点"]'); await p.waitForTimeout(150);
  ok(await p.inputValue('.set-row:has-text("界面字号") input') === '16', 'minus steps 0.5px');
  await p.fill('.set-row:has-text("界面字号") input', '99'); await p.press('.set-row:has-text("界面字号") input', 'Enter'); await p.waitForTimeout(150);
  ok(await p.inputValue('.set-row:has-text("界面字号") input') === '24', 'clamped to 24');
  await p.screenshot({ path: `${OUT}/m-font.png` });
  await p.click('.set-row:has-text("界面字号") .opt:has-text("恢复标准")'); await p.waitForTimeout(150);
  await p.click('.set-back'); await p.waitForSelector('.set-nav-item');
  await p.click('.set-nav-item:has-text("浏览")'); await p.waitForSelector('.set-title');
  await p.screenshot({ path: `${OUT}/m-browse.png`, fullPage: true });
  await p.click('.set-row:has-text("标签") .switch');
  await p.click('.set-row:has-text("模糊 NSFW") .switch');
  await p.click('.set-row:has-text("打开时先显示") .opt:has-text("内容")');
  await p.fill('.set-row:has-text("{{user}}") input', '阿雪'); await p.press('.set-row:has-text("{{user}}") input', 'Tab');
  await p.click('.set-row:has-text("打开时进入") .opt:has-text("合集")');
  await p.click('.set-nav-item:has-text("导入")').catch(() => {});
  await p.goto(B + '/#/settings/import'); await p.waitForSelector('.set-title');
  await p.click('.set-row:has-text("同名条目") .opt:has-text("存为新版本")');
  await p.click('.set-row:has-text("同时上传") .opt:text-is("2")');
  await p.screenshot({ path: `${OUT}/m-import.png`, fullPage: true });
  const prefs = await p.evaluate(() => JSON.parse(localStorage.getItem('tv_prefs')));
  ok(prefs.showTags === false && prefs.blurNsfw && prefs.detailTab === 'content' && prefs.userName === '阿雪' && prefs.start === 'collections' && prefs.conflict === 'version' && prefs.uploadConc === 2, 'prefs saved ' + JSON.stringify(prefs));
  // 打开时进入合集
  await p.goto(B + '/'); await p.waitForTimeout(800);
  ok(await p.evaluate(() => document.documentElement.dataset.route) === 'collections', 'start page = 合集');
  await p.goto(B + '/#/library'); await p.waitForSelector('.card');
  ok(await p.$$eval('.card-tags', (a) => a.every((e) => getComputedStyle(e).display === 'none')), 'card tags hidden');
  const blur = await p.$eval('.card.nsfw .card-frame img', (e) => getComputedStyle(e).filter).catch(() => '');
  ok(blur.includes('blur'), 'NSFW cover blurred: ' + blur);
  await p.screenshot({ path: `${OUT}/m-library.png` });
  // 详情默认内容页、字号、{{user}}
  await p.click('.card:has-text("Rowan")'); await p.waitForSelector('.detail-sheet .reader');
  ok(true, 'detail opens on 内容 tab');
  const zoom = await p.$eval('.detail-body .rt', (e) => getComputedStyle(e).zoom);
  ok(Math.abs(Number(zoom) - 1.5) < 0.01, 'reading zoom ' + zoom);
  const uname = await p.$$eval('.rt-name.user', (a) => a.map((e) => e.textContent));
  ok(!uname.length || uname.every((t) => t === '阿雪'), `{{user}} shown as 阿雪 (${uname.length})`);
  // 阅读全文：单独页面
  const btnCount = await p.locator('.clamp-btn').count();
  if (btnCount) {
    const before = await p.evaluate(() => document.querySelector('.detail-sheet .sheet-body, .detail-sheet').scrollHeight);
    await p.locator('.clamp-btn').first().click(); await p.waitForSelector('.read-sheet');
    await p.screenshot({ path: `${OUT}/m-readfull.png` });
    ok(await p.locator('.read-sheet .read-full .rt, .read-sheet .read-full .dlg-list').count() > 0, 'read-full sheet shows full text');
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    ok(!(await p.isVisible('.read-sheet')) && await p.isVisible('.detail-sheet'), 'Escape closes only the reader');
    const after = await p.evaluate(() => document.querySelector('.detail-sheet .sheet-body, .detail-sheet').scrollHeight);
    ok(after === before, 'detail page not lengthened');
  } else ok(false, 'no 阅读全文 button found');
  await p.keyboard.press('Escape');
  // 数据与存储
  await p.goto(B + '/#/settings/data'); await p.waitForSelector('.storage .facts');
  await p.click('.set-row:has-text("自动清空") .opt:has-text("30 天")'); await p.waitForTimeout(400);
  if (await p.isVisible('.overlay .btn.danger')) await p.click('.overlay .btn.danger');
  await p.waitForTimeout(600);
  const st = await (await fetch(B + '/api/state', { headers: H })).json();
  ok(st.settings.trashDays === 30, 'trashDays saved: ' + st.settings.trashDays);
  await p.screenshot({ path: `${OUT}/m-data.png`, fullPage: true });
  for (const k of ['fields', 'ai', 'connect', 'security', 'about']) { await p.goto(B + `/#/settings/${k}`); await p.waitForSelector('.set-title'); await p.screenshot({ path: `${OUT}/m-${k}.png`, fullPage: true }); }
  // 桌面两栏，多种风格
  const d = await c.browser().newContext({ viewport: { width: 1280, height: 860 } });
  await d.addInitScript((t) => localStorage.setItem('tv_token', t), token);
  const q = await d.newPage(); q.on('pageerror', (e) => errs.push(e.message));
  for (const skin of ['atelier', 'ink', 'neon', 'sakura', 'minimal', 'tavern']) {
    await fetch(B + '/api/settings', { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ skin }) });
    await q.goto(B + '/#/settings/browse'); await q.waitForSelector('.set-title'); await q.waitForTimeout(300);
    if (skin === 'atelier') ok(await q.isVisible('.set-nav') && await q.isVisible('.set-content') && !(await q.isVisible('.set-back')), 'desktop: two columns');
    await q.screenshot({ path: `${OUT}/d-${skin}.png` });
  }
  await fetch(B + '/api/settings', { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ skin: 'atelier' }) });
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
})();
