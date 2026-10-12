// 往下滚：仓库页顶栏收起标题行、「+」藏起来，往上滑恢复；「+」只在仓库和合集页；暗夜酒馆两处排版
const { chromium } = require('playwright');
const B = 'http://127.0.0.1:5199'; const OUT = process.argv[2];
let fails = 0; const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fails++; };
(async () => {
  const { token } = await (await fetch(B + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'testpw' }) })).json();
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  const errs = [];
  const open = async (skin) => {
    const c = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await c.addInitScript(([t, s]) => { localStorage.setItem('tv_token', t); localStorage.setItem('tv_skin', s); localStorage.setItem('tv_prefs', JSON.stringify({ mode: 'dark' })); }, [token, skin]);
    await fetch(B + '/api/settings', { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ skin }) });
    const p = await c.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    return p;
  };
  const scrollTo = async (p, y) => { await p.evaluate((v) => window.scrollTo(0, v), y); await p.waitForTimeout(80); };
  const info = (p) => p.evaluate(() => {
    const r = (s) => document.querySelector(s)?.getBoundingClientRect();
    const fab = document.querySelector('.fab'); const cs = fab && getComputedStyle(fab);
    return { down: document.documentElement.classList.contains('scrolling-down'), title: r('.main > .topbar .tb-title')?.bottom, search: r('.main > .topbar .search')?.top, fabShown: !!cs && cs.display !== 'none' && cs.opacity === '1', fabDisplay: cs?.display };
  });

  for (const skin of ['atelier', 'tavern']) {
    const p = await open(skin);
    await p.goto(B + '/#/library'); await p.waitForSelector('.card'); await p.waitForTimeout(400);
    let s = await info(p);
    ok(!s.down && s.title > 0 && s.fabShown, `${skin}: expanded at top`);
    for (let y = 100; y <= 1500; y += 100) await scrollTo(p, y);
    await p.waitForTimeout(400);
    // 收起后同一张卡的位置不应跳动
    const cardTop = () => p.evaluate(() => document.querySelectorAll('.card')[6].getBoundingClientRect().top);
    s = await info(p);
    ok(s.down && s.title <= 0 && s.search >= 0 && s.search < 60, `${skin}: title row pushed out, search stays: ${JSON.stringify(s)}`);
    ok(!s.fabShown, `${skin}: + hidden while scrolling down`);
    await p.screenshot({ path: `${OUT}/${skin}-down.png` });
    const t0 = await cardTop(); await scrollTo(p, 1520); const t1 = await cardTop();
    ok(Math.abs(t0 - 20 - t1) < 2, `${skin}: content does not jump (${t0} -> ${t1})`);
    await scrollTo(p, 1400); await p.waitForTimeout(400);
    s = await info(p);
    ok(!s.down && s.title > 0 && s.fabShown, `${skin}: scrolling up restores`);
    await p.screenshot({ path: `${OUT}/${skin}-up.png` });
    if (skin === 'tavern') {
      await scrollTo(p, 0);
      const right = await p.evaluate(() => document.querySelector('.main > .topbar .tb-actions').getBoundingClientRect().right);
      ok(right > 393 - 30, 'tavern: topbar icons at the right edge: ' + right);
      await p.click('.card >> nth=3'); await p.waitForSelector('.detail-sheet .fact'); await p.waitForTimeout(300);
      const cut = await p.evaluate(() => [...document.querySelectorAll('.detail-sheet .fact b')].filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent));
      ok(!cut.length, 'tavern: no truncated detail numbers: ' + cut.join(','));
      await p.locator('.detail-sheet .fact').first().scrollIntoViewIfNeeded();
      await p.screenshot({ path: `${OUT}/tavern-facts.png` });
      await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    }
    for (const [r, want] of [['stats', false], ['settings', false], ['collections', true], ['library', true]]) {
      await p.goto(B + '/#/' + r); await p.waitForTimeout(500);
      ok(((await info(p)).fabDisplay !== 'none') === want, `${skin}: + on ${r} ${want ? 'shown' : 'hidden'}`);
    }
    await p.context().close();
  }
  console.log(errs.length ? 'ERR ' + errs.join(' | ') : 'no page errors');
  ok(!errs.length, 'no page errors');
  await b.close(); process.exit(fails ? 1 : 0);
})();
