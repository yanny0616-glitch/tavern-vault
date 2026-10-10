const { chromium } = require('playwright');
const B = 'http://127.0.0.1:5199'; const OUT = process.argv[2];
let fails = 0; const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fails++; };
(async () => {
  const { token } = await (await fetch(B + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'testpw' }) })).json();
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  const c = await b.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true });
  await c.addInitScript((t) => localStorage.setItem('tv_token', t), token);
  const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') console.log('  console:', m.text().slice(0, 120), JSON.stringify(m.location()).slice(0, 120)); });
  const open = async (name) => { while (await p.$('.overlay')) { await p.keyboard.press('Escape'); await p.waitForTimeout(150); } await p.goto(B + '/#/library'); await p.waitForSelector('.card'); await p.fill('.search-input', name); await p.waitForTimeout(400); await p.click('.card'); await p.waitForSelector('.detail-sheet'); };
  await open('程砚');
  await p.waitForSelector('.greet-head .btn[title="全屏阅读"]'); await p.click('.greet-head .btn[title="全屏阅读"]');
  await p.waitForSelector('.read-sheet .st-frame'); await p.waitForTimeout(1500);
  const info = await p.$$eval('.read-sheet .st-frame', (fs) => fs.map((f) => ({ h: f.getBoundingClientRect().height, sb: f.getAttribute('sandbox'), txt: (() => { try { return f.contentDocument.body.innerText.slice(0, 60); } catch { return 'opaque'; } })() })));
  console.log(JSON.stringify(info));
  ok(info.length >= 1 && info.some((x) => x.h > 200) && !info.some((x) => /```/.test(x.txt)), 'fenced html rendered as page (no ``` text)');
  ok(await p.$('.st-tip') !== null, 'tip about scripts shown');
  await p.screenshot({ path: OUT + '/fence-noscript.png' });
  await p.check('.read-script input'); await p.waitForTimeout(2500);
  const info2 = await p.$$eval('.read-sheet .st-frame', (fs) => fs.map((f) => ({ h: Math.round(f.getBoundingClientRect().height), sb: f.getAttribute('sandbox') })));
  console.log(JSON.stringify(info2));
  ok(info2.every((x) => x.sb === 'allow-scripts') && info2.some((x) => x.h > 200), 'scripts mode: sandbox allow-scripts only, height reported via postMessage');
  ok(await p.evaluate(() => localStorage.getItem('tv_token')) === token && (await p.title()) !== 'PWNED', 'parent intact');
  await p.screenshot({ path: OUT + '/fence-script.png' });
  // 脚本里尝试读父页面 / localStorage 都应失败
  const leak = await p.evaluate(() => new Promise((r) => {
    const f = document.createElement('iframe'); f.setAttribute('sandbox', 'allow-scripts');
    f.srcdoc = '<script>let o={};try{o.p=!!parent.document}catch(e){o.p="blocked"}try{o.ls=localStorage.getItem("tv_token")}catch(e){o.ls="blocked"}parent.postMessage({leak:o},"*")<\/script>';
    addEventListener('message', (e) => { if (e.data?.leak) r(e.data.leak); }); document.body.append(f);
  }));
  ok(leak.p === 'blocked' && leak.ls === 'blocked', 'sandboxed scripts cannot read parent or token: ' + JSON.stringify(leak));
  await p.uncheck('.read-script input'); await p.keyboard.press('Escape');
  // 许知年：状态栏正则预览
  await open('许知年');
  await p.click('.tabs button:has-text("内容")'); await p.waitForSelector('.read-sec');
  await p.click('.read-sec[id$="-regex"] summary'); await p.waitForSelector('.st-preview .st-frame'); await p.waitForTimeout(1200);
  const rh = await p.$$eval('.st-preview .st-frame', (fs) => fs.map((f) => Math.round(f.getBoundingClientRect().height)));
  ok(rh.some((x) => x > 150), 'regex fenced status bar rendered, heights ' + rh);
  await (await p.$('.st-preview')).screenshot({ path: OUT + '/fence-regex.png' });
  console.log(errs.length ? 'ERR ' + errs.join(' | ') : 'no page errors');
  await b.close(); process.exit(fails ? 1 : 0);
})();
