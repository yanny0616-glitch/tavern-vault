const { chromium } = require('playwright');
const B = 'http://127.0.0.1:5199'; const OUT = process.argv[2];
let fails = 0; const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fails++; };
(async () => {
  const { token } = await (await fetch(B + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'testpw' }) })).json();
  await fetch(B + '/api/settings', { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ syncIgnore: ['entryState'] }) });
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  const c = await b.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await c.addInitScript((t) => { if (window === top) localStorage.setItem('tv_token', t); }, token);
  const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  for (const sec of ['appearance', 'browse', 'import', 'fields', 'ai', 'connect', 'security', 'data', 'about']) {
    await p.goto(`${B}/#/settings/${sec}`); await p.waitForSelector('.panel'); await p.waitForTimeout(700);
    const r = await p.evaluate(() => {
      const vis = (e) => e.getClientRects().length > 0;
      const helps = [...document.querySelectorAll('.set-help')];
      const descs = [...document.querySelectorAll('.set-row-desc')];
      return { helps: helps.length, orphan: helps.filter((e) => !e.closest('.panel')).length, shown: [...helps, ...descs].filter(vis).length,
        descs: descs.length, rowBtns: document.querySelectorAll('.set-row .help-btn').length,
        panelBtns: [...document.querySelectorAll('.panel-head .help-btn')].filter((x) => !x.hidden).length,
        panelsWithHelp: [...document.querySelectorAll('.panel')].filter((x) => x.querySelector(':scope .set-help')).length };
    });
    ok(r.orphan === 0 && r.shown === 0 && r.rowBtns === r.descs && r.panelBtns === r.panelsWithHelp, `${sec}: ${JSON.stringify(r)}`);
    if (sec === 'appearance' || sec === 'import') await p.screenshot({ path: `${OUT}/set-${sec}.png`, fullPage: true });
    if (sec === 'import') {
      await p.locator('.panel-head .help-btn:visible').first().click();
      ok(await p.locator('.panel.show-help .set-help').first().isVisible(), 'panel ? shows help');
      await p.locator('.set-row .help-btn').first().click();
      ok(await p.locator('.set-row.show-desc .set-row-desc').first().isVisible(), 'row ? shows description');
      await p.screenshot({ path: `${OUT}/set-import-open.png`, fullPage: true });
      // 点开说明后勾选项照常保存
      await p.locator('.opt', { hasText: '蓝灯（常驻）' }).click(); await p.waitForTimeout(600);
      const st = await (await fetch(B + '/api/state', { headers: { Authorization: 'Bearer ' + token } })).json();
      ok(JSON.stringify(st.settings.syncIgnore) === '["entryState","entryConst"]', 'toggle still saves: ' + JSON.stringify(st.settings.syncIgnore));
      ok(await p.locator('.panel.show-help .set-help').count() > 0, 'help stays open after redraw');
    }
  }
  console.log(errs.length ? 'ERR ' + errs.join(' | ') : 'no page errors');
  await b.close(); process.exit(fails ? 1 : 0);
})();
