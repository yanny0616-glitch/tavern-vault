const { chromium } = require('playwright');
const B = 'http://127.0.0.1:5199';
(async () => {
  const { token } = await (await fetch(B + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'testpw' }) })).json();
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  let bad = 0;
  for (const [w, hgt] of [[402, 874], [375, 640], [1440, 900]]) {
    const c = await b.newContext({ viewport: { width: w, height: hgt }, isMobile: w < 900, hasTouch: w < 900 });
    await c.addInitScript((t) => localStorage.setItem('tv_token', t), token);
    const p = await c.newPage(); await p.goto(B + '/#/library'); await p.waitForSelector('.card');
    const check = async (name) => {
      await p.waitForTimeout(350);
      const r = await p.evaluate(() => { const sh = [...document.querySelectorAll('.sheet')].pop(); const f = sh.querySelector('.sheet-foot'); const rb = sh.getBoundingClientRect(); return { appH: getComputedStyle(document.documentElement).getPropertyValue('--app-h'), inner: innerHeight, sheetBottom: Math.round(rb.bottom), sheetTop: Math.round(rb.top), footBottom: f ? Math.round(f.getBoundingClientRect().bottom) : null }; });
      const okk = r.sheetBottom <= r.inner && r.sheetTop >= 0 && (r.footBottom == null || r.footBottom <= r.inner);
      if (!okk) bad++;
      console.log(okk ? 'PASS' : 'FAIL', `${w}x${hgt} ${name}`, JSON.stringify(r));
    };
    await p.click('.card'); await p.waitForSelector('.detail-sheet'); await check('detail');
    await p.keyboard.press('Escape');
    await p.click('.tb-actions-inner .btn[title="筛选与排序"]'); await check('filters'); await p.keyboard.press('Escape');
    await p.goto(B + '/#/settings/data'); await p.waitForSelector('.panel h3:has-text("重复条目")');
    await p.click('.panel:has(h3:has-text("重复条目")) .btn'); await check('dupes (no foot)'); await p.keyboard.press('Escape');
    await c.close();
  }
  // 关掉弹窗后马上跳页面：关弹窗时退回的那一步不能把刚跳的页面退回去
  {
    const c = await b.newContext({ viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true });
    await c.addInitScript((t) => localStorage.setItem('tv_token', t), token);
    const p = await c.newPage();
    let lost = 0;
    for (let i = 0; i < 12; i++) {
      await p.goto(B + '/#/library'); await p.waitForSelector('.card');
      await p.click('.tb-actions-inner .btn[title="筛选与排序"]'); await p.waitForTimeout(300);
      await p.keyboard.press('Escape'); if (i % 3) await p.waitForTimeout(i % 5);
      await p.goto(B + '/#/settings/data'); await p.waitForTimeout(600);
      if (await p.evaluate(() => location.hash) !== '#/settings/data') lost++;
    }
    console.log(lost ? 'FAIL' : 'PASS', `navigation right after closing a sheet kept (${lost}/12 lost)`);
    if (lost) bad++;
    await c.close();
  }
  await b.close(); process.exit(bad ? 1 : 0);
})();
