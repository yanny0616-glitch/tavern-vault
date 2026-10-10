// 从酒馆同步时哪些不算差异
const { chromium } = require('playwright');
const SP = process.argv[2]; const OUT = SP;
const V = 'http://127.0.0.1:5199'; const M = 'http://127.0.0.1:5198';
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const j = async (u, o) => (await fetch(u, o)).json();
const set = (data) => fetch(`${M}/__set`, { method: 'POST', body: JSON.stringify({ avatar: 'lily.png', data }) });
const settings = (b) => fetch(`${V}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(M + '/'); await page.fill('#tv-url', 'http://localhost:5199'); await page.click('#tv-connect');
  await page.waitForFunction(() => /已连接|失败/.test(document.querySelector('#tv-status').textContent));
  await page.click('#tv-menu-item');
  const frame = await (await page.waitForSelector('#tv-panel iframe')).contentFrame();
  await frame.waitForSelector('.tabbar button:has-text("酒馆")'); await frame.click('.tabbar button:has-text("酒馆")');
  const row = (name) => frame.locator(`.row-item:has-text("${name}")`);
  const L = '酒馆里的莉莉';
  const refresh = async () => { await frame.click('.topbar .btn[title="重新读取"]'); await frame.waitForTimeout(900); };
  const status = async () => (await row(L).innerText()).replace(/\s+/g, ' ');
  await row(L).waitFor(); await row(L).locator('button.btn:has-text("收藏")').click();
  await frame.waitForSelector('.overlay', { state: 'detached', timeout: 10000 });
  await row(L).locator('text=已同步').waitFor({ timeout: 10000 });
  let st = await j(`${V}/api/state`); const lily = st.items.find((i) => i.name === L);
  ok(lily.files[0].parts && lily.files[0].parts.book, 'collected file has part sigs');
  const orig = await j(`${V}/api/items/${lily.id}/content`);
  // 自己在酒馆里改了世界书、加了一条开场白
  await set({ character_book: { name: '我的世界书', entries: [{ keys: ['雨'], content: '我自己加的设定', comment: '自加' }] }, alternate_greetings: [...(orig.data.alternate_greetings || []), '我自己加的开场白'] });
  await refresh(); await row(L).locator('text=酒馆有改动').waitFor({ timeout: 10000 });
  ok(true, 'own edits → 酒馆有改动 (no ignore yet)');
  await settings({ syncIgnore: ['book'] }); await frame.waitForTimeout(800);
  ok(/酒馆有改动/.test(await status()), 'ignore book only → still changed (greeting differs)');
  await settings({ syncIgnore: ['book', 'greet'] }); await frame.waitForTimeout(800);
  const s1 = await status();
  ok(/已同步/.test(s1) && /自己改过/.test(s1) && /不算差异：内嵌世界书、开场白/.test(s1), 'ignore book+greet → 已同步 with note: ' + s1);
  await page.screenshot({ path: `${OUT}/ign-synced.png` });
  // 收藏这行（已同步状态下手动选中收藏）→ 不会产生新版本
  const up = await j(`${V}/api/items?filename=lily.png&origin=tavern&target=${lily.id}&match=version`, { method: 'POST', body: await (await fetch(`${M}/__export?avatar=lily.png`).catch(() => null))?.arrayBuffer?.() || '' }).catch(() => null);
  // 真正的改动：描述也改了 → 存为新版本时世界书和开场白保留藏馆原来的
  await fetch(`${M}/__edit?q=${encodeURIComponent(JSON.stringify({ avatar: 'lily.png', description: '酒馆里改的描述' }))}`);
  await refresh(); await row(L).locator('text=酒馆有改动').waitFor({ timeout: 10000 });
  ok(true, 'real change (description) → 酒馆有改动');
  await row(L).locator('button:has-text("同步")').click(); await frame.click('.menu-item:has-text("酒馆的较新：存为新版本")');
  await frame.waitForSelector('.overlay', { state: 'detached', timeout: 10000 });
  await frame.waitForTimeout(1200);
  st = await j(`${V}/api/state`); let it = st.items.find((i) => i.id === lily.id);
  ok(it.files.length === 2, `new version created (${it.files.length} files)`);
  let c = await j(`${V}/api/items/${lily.id}/content`);
  ok(c.data.description === '酒馆里改的描述', 'new version has the tavern description');
  ok(JSON.stringify(c.data.character_book || null) === JSON.stringify(orig.data.character_book || null), 'new version kept the vault worldbook (own edit not stored)');
  ok(JSON.stringify(c.data.alternate_greetings || []) === JSON.stringify(orig.data.alternate_greetings || []), 'new version kept the vault greetings');
  ok(/已同步/.test(await status()), 'after saving → 已同步 again: ' + await status());
  // 关掉「保留藏馆原来的」→ 原样保存
  await settings({ syncKeep: false });
  await fetch(`${M}/__edit?q=${encodeURIComponent(JSON.stringify({ avatar: 'lily.png', description: '第二次改的描述' }))}`);
  await refresh(); await row(L).locator('button:has-text("同步")').click(); await frame.click('.menu-item:has-text("酒馆的较新：存为新版本")');
  await frame.waitForSelector('.overlay', { state: 'detached', timeout: 10000 }); await frame.waitForTimeout(1200);
  c = await j(`${V}/api/items/${lily.id}/content`);
  ok(c.data.description === '第二次改的描述' && c.data.character_book?.entries?.[0]?.content === '我自己加的设定', 'syncKeep off → stored as-is (with own worldbook)');
  // 清空忽略 → 恢复原来的行为
  await settings({ syncIgnore: [], syncKeep: true }); await frame.waitForTimeout(800);
  ok(/已同步/.test(await status()) && !/自己改过/.test(await status()), 'identical now → plain 已同步');
  // ---- 单独的世界书：条目开关、蓝绿灯 ----
  await frame.click('.tabs-sub button:has-text("世界书"), .tb-sub-tabs button:has-text("世界书"), button.seg-item:has-text("世界书")').catch(async () => { await frame.click('text=世界书'); });
  const W = '酒馆世界书';
  await row(W).waitFor(); await row(W).locator('button.btn:has-text("收藏")').click();
  await frame.waitForSelector('.overlay', { state: 'detached', timeout: 10000 });
  await row(W).locator('text=已同步').waitFor({ timeout: 10000 });
  await fetch(`${M}/__setworld`, { method: 'POST', body: JSON.stringify({ name: W, entry: 0, patch: { disable: true, constant: true } }) });
  await refresh(); await row(W).locator('text=酒馆有改动').waitFor({ timeout: 10000 });
  ok(true, 'worldbook entry toggled → 酒馆有改动 (default)');
  await settings({ syncIgnore: ['entryState'] }); await frame.waitForTimeout(800);
  ok(/酒馆有改动/.test(await row(W).innerText()), 'ignore state only → still changed (blue light changed too)');
  const wt = await row(W).innerText();
  ok(/不同的部分：蓝灯（常驻）\/ 绿灯/.test(wt) && /在设置里设为不算差异/.test(wt), 'row explains only blue/green differs: ' + wt.replace(/\s+/g, ' '));
  await settings({ syncIgnore: ['entryState', 'entryConst'] }); await frame.waitForTimeout(800);
  const ws = (await row(W).innerText()).replace(/\s+/g, ' ');
  ok(/已同步/.test(ws) && /条目启用 \/ 禁用、蓝灯（常驻）\/ 绿灯/.test(ws), 'ignore state+const → 已同步: ' + ws);
  await fetch(`${M}/__setworld`, { method: 'POST', body: JSON.stringify({ name: W, entry: 0, patch: { content: '酒馆搬到了城西' } }) });
  await refresh(); await row(W).locator('text=酒馆有改动').waitFor({ timeout: 10000 });
  await row(W).locator('button:has-text("同步")').click(); await frame.click('.menu-item:has-text("酒馆的较新：存为新版本")');
  await frame.waitForSelector('.overlay', { state: 'detached', timeout: 10000 }); await frame.waitForTimeout(1200);
  st = await j(`${V}/api/state`); const wit = st.items.find((i) => i.name === W);
  const wc = await j(`${V}/api/items/${wit.id}/content`); const e0 = Object.values(wc.data.entries)[0];
  ok(wit.files.length === 2 && e0.content === '酒馆搬到了城西' && !e0.disable && !e0.constant, 'new worldbook version: new content, entry state kept from vault ' + JSON.stringify([e0.disable, e0.constant]));
  await settings({ syncIgnore: [] });
  await frame.click('button.seg-item:has-text("角色卡")').catch(() => frame.click('text=角色卡'));
  // 设置页
  await frame.evaluate(() => { location.hash = '#/settings/import'; }); await frame.waitForSelector('.panel h3:has-text("哪些不算差异")');
  await frame.click('.panel:has(h3:has-text("哪些不算差异")) .opt:has-text("内嵌世界书")'); await frame.waitForTimeout(500);
  st = await j(`${V}/api/state`);
  ok(JSON.stringify(st.settings.syncIgnore) === '["book"]' && st.settings.syncKeep === true, 'settings UI saves syncIgnore');
  await (await frame.$('.panel:has(h3:has-text("哪些不算差异"))')).screenshot({ path: `${OUT}/ign-settings.png` });
  console.log(errs.length ? 'ERR ' + errs.join(' | ') : 'no errors');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
