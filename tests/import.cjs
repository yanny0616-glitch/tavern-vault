const { chromium } = require('playwright');
const B = 'http://127.0.0.1:5199'; const SP = process.argv[2];
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  const c = await b.newContext({ viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true });
  await c.addInitScript(() => localStorage.setItem('tv_prefs', JSON.stringify({ conflict: 'version', uploadConc: 2 })));
  const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(B + '/#/library'); await p.waitForSelector('.card');
  await p.click('.fab'); await p.waitForSelector('.drop');
  await p.setInputFiles('.drop input[type=file]:not([webkitdirectory])', [__dirname + "/fixtures/白夜-导入.json"]);
  await p.waitForTimeout(3000);
  const st = await (await fetch(B + '/api/state')).json();
  const bai = st.items.filter((i) => i.name.includes('白夜') && !i.deletedAt);
  ok(bai.length === 1 && bai[0].files.length === 2, `auto saved as new version (items=${bai.length}, files=${bai[0]?.files.length})`);
  ok(!(await p.locator('.conflict-acts').count()), 'no per-item decision asked');
  ok(!errs.length, 'no errors ' + errs.join('|'));
  await b.close();
})();
