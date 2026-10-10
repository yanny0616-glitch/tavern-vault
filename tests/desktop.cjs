const { chromium } = require('playwright');
const fs = require('fs'); const B = 'http://127.0.0.1:5199'; const OUT = process.argv[2];
(async () => {
  const { token } = await (await fetch(B + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'testpw' }) })).json();
  const H = { Authorization: 'Bearer ' + token };
  await fetch(B + '/api/items?filename=yutang.json', { method: 'POST', headers: H, body: fs.readFileSync(__dirname + '/fixtures/雨棠.json') });
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  const errs = [];
  for (const skin of ['ink', 'neon']) {
    await fetch(B + '/api/settings', { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ skin }) });
    const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await c.addInitScript((t) => localStorage.setItem('tv_token', t), token);
    const p = await c.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(B + '/#/library'); await p.waitForSelector('.card');
    await p.screenshot({ path: `${OUT}/d-${skin}-lib.png` });
    await p.click('.lib-notice .btn:not(.ghost)'); await p.waitForSelector('.dup-group'); await p.waitForTimeout(300);
    await p.screenshot({ path: `${OUT}/d-${skin}-dupes.png` }); await p.keyboard.press('Escape');
    await p.fill('.search-input', '雨棠'); await p.waitForTimeout(400); await p.click('.card'); await p.waitForSelector('.greet-head .btn[title="全屏阅读"]');
    await p.click('.greet-head .btn[title="全屏阅读"]'); await p.waitForSelector('.read-sheet .st-frame'); await p.waitForTimeout(500);
    await p.screenshot({ path: `${OUT}/d-${skin}-reader.png` }); await p.keyboard.press('Escape');
    await c.close();
  }
  const c = await b.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2 });
  await c.addInitScript((t) => localStorage.setItem('tv_token', t), token);
  const p = await c.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(B + '/#/settings/ai'); await p.waitForSelector('.ai-rules');
  await p.click('.ai-rules summary'); await p.waitForTimeout(200);
  const sel = await p.$$eval('.ai-rules select', (a) => a.map((s) => [...s.options].map((o) => o.textContent)));
  console.log('ai selects', JSON.stringify(sel));
  await (await p.$$('.ai-rules select'))[1].selectOption('5'); await p.click('.ai-rules .btn.primary'); await p.waitForTimeout(500);
  const cfg = await (await fetch(B + '/api/ai/config', { headers: H })).json();
  console.log(cfg.organize.batch === 5 ? 'PASS batch saved from UI' : 'FAIL batch ' + cfg.organize.batch);
  await (await p.$('.ai-rules')).screenshot({ path: `${OUT}/ai-rules.png` });
  await p.goto(B + '/#/settings/data'); await p.waitForSelector('.panel h3:has-text("重复条目")');
  console.log('settings dup panel:', await p.$eval('.panel:has(h3:has-text("重复条目")) .muted', (e) => e.textContent.slice(0, 30)));
  console.log(errs.length ? errs : 'no errors'); await b.close();
})();
