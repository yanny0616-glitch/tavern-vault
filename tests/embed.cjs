const { chromium } = require('playwright');
const V = 'http://127.0.0.1:5199'; const M = 'http://127.0.0.1:5198'; const OUT = process.argv[2];
let fails = 0; const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, screen: { width: 393, height: 852 } });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(M + '/');
  // 模拟 iPhone 15：TauriTavern 给的安全区变量
  await page.addStyleTag({ content: ':root{--tt-inset-top:59px;--tt-inset-bottom:34px;--tt-viewport-bottom-inset:34px}' });
  // TauriTavern 的几何防火墙：把铺满屏幕的浮层缩进安全区
  await page.addStyleTag({ content: 'body [data-tt-mobile-surface="fullscreen-window"][data-tt-mobile-surface][data-tt-mobile-surface]{position:fixed!important;top:max(var(--tt-inset-top),0px)!important;left:0!important;right:0!important;bottom:max(var(--tt-viewport-bottom-inset,var(--tt-inset-bottom)),0px)!important;height:auto!important}' });
  await page.evaluate(() => new MutationObserver(() => { const el = document.getElementById('tv-panel'); if (el && !el.hasAttribute('data-tt-mobile-surface')) el.setAttribute('data-tt-mobile-surface', 'fullscreen-window'); }).observe(document.body, { childList: true }));
  await page.fill('#tv-url', 'http://localhost:5199'); await page.click('#tv-connect');
  await page.waitForFunction(() => /已连接|失败/.test(document.querySelector('#tv-status').textContent));
  await page.click('#tv-menu-item');
  const frame = await (await page.waitForSelector('#tv-panel iframe')).contentFrame();
  await frame.waitForSelector('.card, .empty, .tabbar');
  await page.waitForFunction(() => document.querySelector('#tv-panel').classList.contains('tv-edge'), null, { timeout: 8000 });
  const box = await page.$eval('#tv-panel iframe', (f) => { const r = f.getBoundingClientRect(); return [r.top, r.height]; });
  ok(box[0] === 0 && box[1] === 852, 'iframe fills full screen: ' + box);
  ok(await page.$eval('#tv-panel .tv-bar', (e) => getComputedStyle(e).display) === 'none', 'extension bar hidden');
  const v = await frame.evaluate(() => { const cs = getComputedStyle(document.documentElement); const tb = document.querySelector('.topbar').getBoundingClientRect(); const tab = document.querySelector('.tabbar'); return { st: cs.getPropertyValue('--safe-top'), sb: cs.getPropertyValue('--safe-bottom'), edge: document.documentElement.classList.contains('embed-edge'), titleTop: document.querySelector('.tb-title').getBoundingClientRect().top, tabH: tab.getBoundingClientRect().height, tabPad: getComputedStyle(tab).paddingBottom, close: getComputedStyle(document.querySelector('.tb-close')).display }; });
  console.log(JSON.stringify(v));
  ok(v.edge && v.st.trim() === '59px' && v.sb.trim() === '34px', 'vault got insets');
  ok(v.titleTop >= 59 && v.titleTop < 59 + 40, 'title just below dynamic island: ' + v.titleTop);
  ok(v.tabPad === '20px' && Math.round(v.tabH) === 74, 'tabbar compact: pad ' + v.tabPad + ' h ' + v.tabH);
  ok(v.close !== 'none', 'close button visible');
  await page.screenshot({ path: OUT + '/embed.png' });
  // 键盘弹出 300px：面板底部抬到键盘上面
  await page.addStyleTag({ content: ':root{--tt-viewport-bottom-inset:300px!important}' }); await page.waitForTimeout(100);
  const kb = await page.$eval('#tv-panel', (e) => e.getBoundingClientRect().bottom);
  ok(kb === 852 - 266, 'keyboard lifts panel bottom: ' + kb);
  // 重新加载藏馆（数据很慢）：面板一打开就是全屏，不先显示插件标题栏；藏馆在数据到之前就拿到安全区
  await page.addStyleTag({ content: ':root{--tt-viewport-bottom-inset:34px!important}' });
  await page.route('**/api/state', async (r) => { await new Promise((ok2) => setTimeout(ok2, 2500)); r.continue(); });
  await page.evaluate(() => { const el = document.querySelector('#tv-panel'); el.classList.remove('tv-edge'); el.querySelector('[data-act="reload"]').click(); });
  await page.waitForTimeout(150);
  ok(await page.$eval('#tv-panel', (e) => e.classList.contains('tv-edge')), 'fullscreen right away on reopen');
  ok(await page.$eval('#tv-panel .tv-bar', (e) => getComputedStyle(e).display) === 'none', 'no extension bar while loading');
  const f2 = await (await page.$('#tv-panel iframe')).contentFrame();
  await f2.waitForFunction(() => document.documentElement.classList.contains('embed-edge'), null, { timeout: 2000 });
  ok(!(await f2.$('.tabbar')), 'vault got insets before data arrived');
  await page.screenshot({ path: OUT + '/embed-loading.png' });
  await f2.waitForSelector('.tb-close', { timeout: 8000 });
  await page.unroute('**/api/state');
  await f2.click('.tb-close'); await page.waitForTimeout(300);
  ok(!(await page.$eval('#tv-panel', (e) => e.classList.contains('open'))), 'close button closes panel');
  console.log(errs.length ? 'ERR ' + errs.join(' | ') : 'no page errors');
  await b.close(); process.exit(fails ? 1 : 0);
})();
