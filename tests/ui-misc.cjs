const { chromium } = require('playwright');
const B = 'http://127.0.0.1:5199'; const OUT = process.argv[2];
let fails = 0; const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fails++; };
(async () => {
  const { token } = await (await fetch(B + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'testpw' }) })).json();
  const H = { Authorization: `Bearer ${token}` };
  const state = async () => (await fetch(B + '/api/state', { headers: H })).json();
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  const c = await b.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, screen: { width: 402, height: 874 } });
  await c.addInitScript((t) => { if (window === top) localStorage.setItem('tv_token', t); }, token);
  const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const cdp = await c.newCDPSession(p);
  const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const center = async (el) => { const r = await el.boundingBox(); return [r.x + r.width / 2, r.y + r.height / 2]; };
  await p.goto(B + '/#/library'); await p.waitForSelector('.card');
  // ---- 字号 ----
  const fs1 = await p.$eval('.card-title', (e) => parseFloat(getComputedStyle(e).fontSize));
  ok(Math.abs(Number(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fs').trim())) - 14 / 15) < 0.001, 'phone default ui font = 14px');
  await p.evaluate(() => { const v = JSON.parse(localStorage.getItem('tv_prefs') || '{}'); v.uiSize = 'md'; localStorage.setItem('tv_prefs', JSON.stringify(v)); });
  await p.reload(); await p.waitForSelector('.card');
  const fs2 = await p.$eval('.card-title', (e) => parseFloat(getComputedStyle(e).fontSize));
  ok(Math.abs(fs1 / fs2 - 14 / 15) < 0.02, `old pref migrates: 14px ${fs1} vs md ${fs2}`);
  await p.evaluate(() => { const v = JSON.parse(localStorage.getItem('tv_prefs') || '{}'); v.uiFont = 18; localStorage.setItem('tv_prefs', JSON.stringify(v)); });
  await p.reload(); await p.waitForSelector('.card');
  const fs3 = await p.$eval('.card-title', (e) => parseFloat(getComputedStyle(e).fontSize));
  ok(Math.abs(fs3 / fs2 - 18 / 15) < 0.02, `custom 18px applied before first paint too (${fs3})`);
  await p.evaluate(() => { const v = JSON.parse(localStorage.getItem('tv_prefs') || '{}'); delete v.uiFont; localStorage.setItem('tv_prefs', JSON.stringify(v)); });
  await p.evaluate(() => { const v = JSON.parse(localStorage.getItem('tv_prefs') || '{}'); delete v.uiSize; localStorage.setItem('tv_prefs', JSON.stringify(v)); });
  await p.reload(); await p.waitForSelector('.card');
  ok(await p.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY) === 'none', 'html overscroll none');
  // ---- 9 标签筛选 ----
  const st0 = await state(); const live = st0.items.filter((i) => !i.deletedAt);
  const tagCount = new Map(); for (const it of live) for (const t of it.tags) tagCount.set(t, (tagCount.get(t) || 0) + 1);
  const [tag] = [...tagCount.entries()].sort((a, b) => b[1] - a[1])[0];
  await p.click('button[title="筛选与排序"]'); await p.waitForSelector('.tag-opt');
  const tagBtn = p.locator('.tag-opt', { hasText: tag }).first();
  await tagBtn.click(); await p.waitForTimeout(200);
  const nIn = await p.$$eval('.lib-content .card', (a) => a.length);
  ok(nIn === live.filter((i) => i.tags.includes(tag)).length, `include tag ${tag}: ${nIn}`);
  await tagBtn.click(); await p.waitForTimeout(200);
  const nOut = await p.$$eval('.lib-content .card', (a) => a.length);
  ok(nOut === live.filter((i) => !i.tags.includes(tag)).length && await tagBtn.evaluate((e) => e.classList.contains('out')), `exclude tag: ${nOut}`);
  await p.locator('.opt', { hasText: '多个版本' }).click(); await p.waitForTimeout(200);
  const multi = live.filter((i) => !i.tags.includes(tag) && i.files.filter((f) => f.primary || f.sig).length > 1).length;
  ok(await p.$$eval('.lib-content .card', (a) => a.length) === multi, 'quick filter 多个版本 combined: ' + multi);
  await p.screenshot({ path: OUT + '/filters.png' });
  await p.click('.sheet-foot button:has-text("重置")'); await p.click('.sheet-foot button:has-text("完成")'); await p.waitForTimeout(300);
  ok(await p.$$eval('.lib-content .card', (a) => a.length) === live.length, 'reset filters');
  // ---- 13 长按进入多选 ----
  const cards = await p.$$('.lib-content .card');
  let [x, y] = await center(cards[0]);
  await touch('touchStart', x, y); await p.waitForTimeout(650); await touch('touchEnd');
  await p.waitForTimeout(250);
  ok(await p.$eval('.sel-count', (e) => e.textContent) === '已选 1 项', 'long press enters selection with 1 selected');
  ok(await p.$('.detail-sheet') === null, 'long press did not open detail');
  // 横向滑过第 2、3 张（第一行右边那张 + 第二行）
  const cs = await p.$$('.lib-content .card');
  const [x1, y1] = await center(cs[1]); const [x2, y2] = await center(cs[2]);
  await touch('touchStart', x1 - 30, y1);
  for (let i = 1; i <= 6; i++) await touch('touchMove', x1 - 30 + i * 10, y1);
  for (let i = 1; i <= 8; i++) await touch('touchMove', x1 + 30 - (x1 - x2) * i / 8, y1 + (y2 - y1) * i / 8);
  await touch('touchEnd'); await p.waitForTimeout(200);
  ok(await p.$eval('.sel-count', (e) => e.textContent) === '已选 3 项', 'swipe select adds 2 more: ' + await p.$eval('.sel-count', (e) => e.textContent));
  // ---- 7 批量标签：三态 ----
  const sel = await p.evaluate(() => [...document.querySelectorAll('.lib-content .card.selected')].map((e) => e.dataset.id));
  await p.click('.sel-act:has-text("标签")'); await p.waitForSelector('.tri-opts'); await p.waitForTimeout(700);
  await p.screenshot({ path: OUT + '/batch-tags.png' });
  const items0 = (await state()).items.filter((i) => sel.includes(i.id));
  const someTag = [...new Set(items0.flatMap((i) => i.tags))].find((t) => items0.some((i) => !i.tags.includes(t)));
  const allTag = [...new Set(items0.flatMap((i) => i.tags))].find((t) => items0.every((i) => i.tags.includes(t)));
  if (allTag) await p.locator('.opt.tri', { hasText: allTag }).first().click(); // all → none
  await p.fill('.sheet input.input', '批量新标签');
  await p.click('.sheet-foot button:has-text("确定")'); await p.waitForTimeout(800);
  const items1 = (await state()).items.filter((i) => sel.includes(i.id));
  ok(items1.every((i) => i.tags.includes('批量新标签')), 'typed tag added to all');
  ok(!allTag || items1.every((i) => !i.tags.includes(allTag)), `removed shared tag ${allTag}`);
  ok(!someTag || someTag === allTag || items1.filter((i) => i.tags.includes(someTag)).length === items0.filter((i) => i.tags.includes(someTag)).length, 'partial tag untouched');
  // 收藏按钮跟着状态变
  await p.click('.sel-act:has-text("收藏")'); await p.waitForTimeout(700);
  ok(await p.$('.sel-act:has-text("取消收藏")') !== null, 'favorite → button becomes 取消收藏');
  await p.click('.sel-act:has-text("取消收藏")'); await p.waitForTimeout(700);
  ok((await state()).items.filter((i) => sel.includes(i.id)).every((i) => !i.favorite), 'unfavorite works');
  // 对比两项
  await p.locator('.lib-content .card.selected').first().click(); await p.waitForTimeout(150);
  ok(await p.$eval('.sel-count', (e) => e.textContent) === '已选 2 项', 'deselect one');
  await p.click('.sel-act:has-text("更多")'); await p.click('.menu-item:has-text("对比这两项")');
  await p.waitForSelector('.sheet h2:has-text("对比两个条目")'); ok(true, 'compare two opened');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  await p.click('.btn:has-text("完成")'); await p.waitForTimeout(200);
  // ---- 6 详情页上一项 / 下一项 ----
  const order = await p.$$eval('.lib-content .card', (a) => a.map((e) => e.dataset.id));
  await p.locator('.lib-content .card').first().click(); await p.waitForSelector('.detail-pos');
  ok(await p.$eval('.detail-pos', (e) => e.textContent) === `1 / ${order.length}`, 'position shown');
  await p.keyboard.press('ArrowRight'); await p.waitForTimeout(300);
  ok(await p.$eval('.detail-pos', (e) => e.textContent) === `2 / ${order.length}`, 'arrow → next');
  const body = await p.$('.detail-sheet .sheet-body'); const bb = await body.boundingBox();
  await touch('touchStart', bb.x + 300, bb.y + 200); for (let i = 1; i <= 5; i++) await touch('touchMove', bb.x + 300 - i * 30, bb.y + 200 + i * 2); await touch('touchEnd');
  await p.waitForTimeout(400);
  ok(await p.$eval('.detail-pos', (e) => e.textContent) === `3 / ${order.length}`, 'swipe left → next');
  await p.screenshot({ path: OUT + '/detail-nav.png' });
  await p.click('.detail-nav button[title^="上一项"]'); await p.waitForTimeout(300);
  ok(await p.$eval('.detail-pos', (e) => e.textContent) === `2 / ${order.length}`, 'prev button');
  await p.locator('.detail-sheet .sheet-x').click(); await p.waitForTimeout(300);
  ok(await p.$eval(`.lib-content [data-id="${order[1]}"]`, (e) => e.classList.contains('just-viewed')), 'last viewed card highlighted on close');
  console.log(errs.length ? 'ERR ' + errs.join(' | ') : 'no page errors');
  // ---- 电脑：Shift 选一段 ----
  const d = await b.newContext({ viewport: { width: 1280, height: 860 } });
  await d.addInitScript((t) => { if (window === top) localStorage.setItem('tv_token', t); }, token);
  const q = await d.newPage(); await q.goto(B + '/#/library'); await q.waitForSelector('.card');
  await q.click('button[title="多选"]'); const dc = await q.$$('.lib-content .card');
  await dc[0].click(); await dc[4].click({ modifiers: ['Shift'] }); await q.waitForTimeout(200);
  ok(await q.$eval('.sel-count', (e) => e.textContent) === '已选 5 项', 'shift-click range selects 5');
  await b.close(); process.exit(fails ? 1 : 0);
})();
