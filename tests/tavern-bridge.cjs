// 端到端：酒馆页比对 / 存为新版本 / 覆盖到酒馆 / 导入冲突 / 批量导入
const { chromium } = require('playwright');
const fs = require('fs');
const SP = process.argv[2];
const OUT = SP;
fs.mkdirSync(OUT, { recursive: true });
const V = 'http://127.0.0.1:5199';
const M = 'http://127.0.0.1:5198';
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const j = async (u, o) => (await fetch(u, o)).json();
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '#toasts{opacity:.0001}'; document.head.append(s); }); });
  // 这里测的是列表行上的收藏 / 对比 / 同步按钮：酒馆页用列表显示（默认是封面网格）
  await ctx.addInitScript(() => { if (location.port !== '5199') return; try { const p = JSON.parse(localStorage.getItem('tv_prefs') || '{}'); if (!p.tavernViews) { p.tavernViews = { character: 'list', background: 'list' }; localStorage.setItem('tv_prefs', JSON.stringify(p)); } } catch { /* ignore */ } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errs.push('HTTP ' + r.status() + ' ' + r.url()); });
  await page.goto(M + '/');
  await page.fill('#tv-url', 'http://localhost:5199');
  await page.click('#tv-connect');
  await page.waitForFunction(() => /已连接|失败/.test(document.querySelector('#tv-status').textContent));
  await page.click('#tv-menu-item');
  const frame = await (await page.waitForSelector('#tv-panel iframe')).contentFrame();
  await frame.waitForSelector('.tabbar button:has-text("酒馆")');
  await frame.click('.tabbar button:has-text("酒馆")');
  const row = (name) => frame.locator(`.row-item:has-text("${name}")`);
  await row('酒馆里的莉莉').waitFor();
  await row('酒馆里的莉莉').locator('button.btn:has-text("收藏")').click();
  await frame.waitForSelector('.overlay', { state: 'detached', timeout: 10000 });
  await row('酒馆里的莉莉').locator('text=已同步').waitFor({ timeout: 10000 });
  ok(true, 'collected → 已同步');

  // 酒馆里改了描述
  await fetch(`${M}/__edit?q=${encodeURIComponent(JSON.stringify({ avatar: 'lily.png', description: '在酒馆里改过的描述' }))}`);
  await frame.click('.topbar .btn[title="重新读取"]');
  await row('酒馆里的莉莉').locator('text=酒馆有改动').waitFor({ timeout: 10000 });
  ok(true, 'tavern edit → 酒馆有改动');
  await page.screenshot({ path: `${OUT}/tavern-changed.png` });
  const reqs = [];
  page.on('request', (q) => reqs.push(q.url()));
  // 连点三下：只打开一个对比页
  await row('酒馆里的莉莉').locator('button:has-text("对比")').evaluate((el) => { el.click(); el.click(); el.click(); });
  await frame.waitForSelector('.diff .dl.add', { timeout: 10000 });
  ok(await frame.locator('.overlay').count() === 1, `triple click opens one compare sheet (${await frame.locator('.overlay').count()})`);
  ok(reqs.some((u) => u.includes('probe=1')) && !reqs.some((u) => u.includes('/api/characters/export')), 'compare sent card text only (no PNG export)');
  ok(await frame.locator('.diff .fold-title:has-text("描述")').count() > 0, 'diff shows 描述 change');
  await page.screenshot({ path: `${OUT}/tavern-diff.png` });
  await frame.click('.sheet-foot button:has-text("酒馆的较新：存为新版本")');
  await row('酒馆里的莉莉').locator('text=已同步').waitFor({ timeout: 10000 });
  let st = await j(`${V}/api/state`);
  const lily = st.items.find((i) => i.name === '酒馆里的莉莉');
  ok(lily.files.length === 2, `vault now has ${lily.files.length} versions`);
  { const nf = lily.files.find((f) => f.primary); const buf = Buffer.from(await (await fetch(`${V}/api/files/${nf.sha}`)).arrayBuffer());
    const { extractCardFromPng } = await import(require("path").resolve(__dirname, "../server/lib/png.js"));
    const c = extractCardFromPng(buf); ok(buf.slice(1, 4).toString() === 'PNG' && JSON.stringify(c).includes('在酒馆里改过的描述'), 'saved version is full tavern PNG with new text'); }

  // 酒馆里其实是旧版：同步 → 存为旧版本，藏馆当前版本不变
  await fetch(`${M}/__edit?q=${encodeURIComponent(JSON.stringify({ avatar: 'lily.png', description: '酒馆里的旧描述' }))}`);
  await frame.click('.topbar .btn[title="重新读取"]');
  await row('酒馆里的莉莉').locator('text=酒馆有改动').waitFor({ timeout: 10000 });
  await row('酒馆里的莉莉').locator('button:has-text("同步")').click();
  await frame.waitForSelector('.menu-item:has-text("酒馆的较旧：存为旧版本")');
  await page.screenshot({ path: `${OUT}/tavern-sync-choice.png` });
  await frame.click('.menu-item:has-text("酒馆的较旧：存为旧版本")');
  await row('酒馆里的莉莉').locator('text=版本不同').waitFor({ timeout: 10000 });
  { const s2 = await j(`${V}/api/state`); const l2 = s2.items.find((i) => i.name === '酒馆里的莉莉');
    const pf = l2.files.find((f) => f.primary);
    ok(l2.files.length === 3 && pf.sha === lily.files.find((f) => f.primary).sha, `saved as old version, current unchanged (${l2.files.length} files)`); }
  // 再改回来，后面的流程照旧
  await fetch(`${M}/__edit?q=${encodeURIComponent(JSON.stringify({ avatar: 'lily.png', description: '在酒馆里改过的描述' }))}`);
  await frame.click('.topbar .btn[title="重新读取"]');
  await row('酒馆里的莉莉').locator('text=已同步').waitFor({ timeout: 10000 });

  // 藏馆里出现更新的版本（网页编辑） → 酒馆是旧版本
  const content = await j(`${V}/api/items/${lily.id}/content`);
  await fetch(`${V}/api/items/${lily.id}/card`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ card: { ...content.card, data: { ...content.data, first_mes: '藏馆里改的开场白' } } }) });
  await frame.click('.topbar .btn[title="重新读取"]');
  await row('酒馆里的莉莉').locator('text=藏馆较新').waitFor({ timeout: 10000 });
  ok(true, 'vault edit → 藏馆较新');
  await row('酒馆里的莉莉').locator('button:has-text("更新到酒馆")').click();
  await frame.waitForFunction(() => [...document.querySelectorAll('.progress-label')].some((e) => e.textContent.includes('已导入')), null, { timeout: 10000 });
  await page.screenshot({ path: `${OUT}/tavern-overwrite.png` });
  await frame.locator('body').press('Escape');
  const ms = await j(`${M}/__state`);
  ok(Object.keys(ms.chars).length === 1 && ms.chars['lily.png'].data.first_mes === '藏馆里改的开场白', `tavern card overwritten in place (chars=${Object.keys(ms.chars)})`);
  const imp = ms.received.filter((r) => r.path === '/api/characters/import').pop();
  ok(imp?.fields?.preserved_name === 'lily.png', `preserved_name sent: ${imp?.fields?.preserved_name}`);
  await row('酒馆里的莉莉').locator('text=已同步').waitFor({ timeout: 10000 });
  ok(true, 'after overwrite → 已同步');

  // 仓库 → 酒馆：已经一致时不重复导入；同名时询问
  await frame.click('.tabbar button:has-text("仓库")');
  await frame.click('.card:has-text("酒馆里的莉莉")');
  await frame.click('.sheet-foot button:has-text("导入到酒馆")');
  await page.waitForTimeout(1500);
  ok(await frame.locator('.overlay').count() === 1, 'same content → no import dialog/progress (only detail open)');
  await frame.locator('body').press('Escape');
  // 世界书：酒馆里有同名但内容不同 → 询问覆盖
  await fetch(`${V}/api/items?filename=${encodeURIComponent('酒馆世界书.json')}`, { method: 'POST', body: JSON.stringify({ entries: { 0: { uid: 0, key: ['酒馆'], content: '酒馆搬到了城西', comment: '酒馆' } } }) });
  await page.waitForTimeout(800);
  await frame.click('.card:has-text("酒馆世界书")');
  await frame.click('.sheet-foot button:has-text("导入到酒馆")');
  await frame.waitForSelector('.sheet.choice', { timeout: 10000 });
  await page.screenshot({ path: `${OUT}/tavern-clash.png` });
  await frame.click('.sheet.choice button:has-text("覆盖")');
  await frame.waitForFunction(() => [...document.querySelectorAll('.progress-label')].some((e) => e.textContent.includes('已导入')), null, { timeout: 10000 });
  const ms2 = await j(`${M}/__state`);
  ok(Object.keys(ms2.worlds).length === 1 && JSON.stringify(ms2.worlds['酒馆世界书']).includes('城西'), `worldbook overwritten (${Object.keys(ms2.worlds)})`);
  await frame.locator('body').press('Escape'); await page.waitForTimeout(200); await frame.locator('body').press('Escape');

  // 批量导入：压缩包里有新版本 → 冲突 → 全部存为新版本
  await frame.click('.fab');
  await frame.waitForSelector('.drop');
  await frame.setInputFiles('.drop input[type=file]:not([webkitdirectory])', [__dirname + "/fixtures/pack.zip", __dirname + "/fixtures/samples/紫夜主题.json"]);
  await frame.waitForSelector('.import-bulk:not([hidden])', { timeout: 15000 });
  await page.screenshot({ path: `${OUT}/import-conflict.png` });
  const conflicts = await frame.locator('.import-row.is-conflict').count();
  await frame.click('.import-bulk button:has-text("全部存为新版本")');
  await frame.waitForSelector('.import-bulk[hidden]', { state: 'attached', timeout: 10000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/import-done.png` });
  st = await j(`${V}/api/state`);
  const xl = st.items.filter((i) => i.name === '星澜');
  ok(conflicts >= 1 && xl.length === 1 && xl[0].files.length === 2, `zip conflict resolved as version (conflicts=${conflicts}, 星澜 items=${xl.length}, files=${xl[0]?.files.length})`);
  ok(st.collections.some((c) => c.name === 'pack'), 'zip collection created');
  await frame.locator('body').press('Escape');
  // 详情 → 文件 → 对比上一版
  await frame.click('.card:has-text("星澜")');
  await frame.click('.tabs button:has-text("文件")');
  await frame.click('button:has-text("对比上一版")');
  await frame.waitForSelector('.diff', { timeout: 10000 });
  await page.screenshot({ path: `${OUT}/detail-diff.png` });
  ok(true, 'detail compare opened');
  console.log(errs.join('\n') || 'no errors');
  await browser.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
