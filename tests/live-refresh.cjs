// 自己改的内容要马上出现在仓库页：即使服务器的实时推送收不到（被拦掉）也一样
const { chromium } = require('playwright');
const B = 'http://127.0.0.1:5199'; const OUT = process.argv[2];
let fails = 0; const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fails++; };
(async () => {
  const { token } = await (await fetch(B + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'testpw' }) })).json();
  const st = await (await fetch(B + '/api/state', { headers: { Authorization: `Bearer ${token}` } })).json();
  const ch = st.items.find((i) => !i.deletedAt && i.type === 'character' && i.cover);
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  const c = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await c.addInitScript((t) => localStorage.setItem('tv_token', t), token);
  const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route('**/api/events*', (r) => r.abort());
  await p.goto(B + '/#/library'); await p.waitForSelector('.card');
  const card = p.locator(`.card[data-id="${ch.id}"]`);
  await card.click(); await p.waitForSelector('.detail-sheet');
  await p.click('.detail-sheet button:has-text("编辑资料")');
  const field = p.locator('.sheet:has-text("编辑资料") .field', { hasText: '作者' }).locator('input');
  await field.fill('测试作者甲');
  await p.click('.sheet:has-text("编辑资料") .sheet-foot button:has-text("保存")');
  await p.waitForTimeout(800);
  ok(/测试作者甲/.test(await p.textContent('.detail-sheet')), 'detail shows new author');
  await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  ok(/测试作者甲/.test(await card.locator('.card-overlay .card-sub, .card-body .card-sub').first().textContent()), 'library card shows new author without push');
  await p.screenshot({ path: OUT + '/1-card.png' });
  console.log(errs.length ? 'ERR ' + errs.join(' | ') : 'no page errors');
  ok(!errs.length, 'no page errors');
  await b.close(); process.exit(fails ? 1 : 0);
})();
