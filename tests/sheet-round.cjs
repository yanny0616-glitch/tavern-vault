const { chromium } = require('playwright');
const B = 'http://127.0.0.1:5199'; const OUT = process.argv[2];
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  for (const [label, vp, mobile] of [['phone', { width: 393, height: 760 }, true], ['desk', { width: 1280, height: 800 }, false]]) {
    const c = await b.newContext({ viewport: vp, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
    const p = await c.newPage();
    for (const skin of ['atelier', 'sakura', 'tavern', 'minimal', 'ink']) {
      await fetch(B + '/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skin }) });
      await p.goto(B + '/#/library'); await p.waitForSelector('.card'); await p.waitForTimeout(300);
      await p.click('button[title="筛选与排序"]'); await p.waitForTimeout(450);
      const r = await p.evaluate(() => { const s = document.querySelector('.overlay .sheet'); const cs = getComputedStyle(s); const bx = s.getBoundingClientRect(); return { tl: cs.borderTopLeftRadius, bl: cs.borderBottomLeftRadius, gap: Math.round(innerHeight - bx.bottom) }; });
      ok(r.tl === r.bl && (skin === 'ink' || parseFloat(r.bl) > 0) && r.gap >= 8, `${label} ${skin}: ${JSON.stringify(r)}`);
      if (skin === 'sakura' || skin === 'atelier') await p.screenshot({ path: `${OUT}/round-${label}-${skin}.png` });
      await p.keyboard.press('Escape'); await p.waitForTimeout(250);
    }
    await c.close();
  }
  await fetch(B + '/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skin: 'atelier' }) });
  await b.close();
})();
