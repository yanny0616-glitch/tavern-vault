// 衍生版本分隔符：叶岚-31 / 叶岚-34 / 叶岚·30 默认算相近；选了 - 和 · 后不算重复，叶岚-v2 仍和叶岚算同一张
const { chromium } = require('playwright');
const B = 'http://127.0.0.1:5199'; const O = process.argv[2];
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const j = async (m, u, b) => (await fetch(B + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })).json();
(async () => {
  await j('PUT', '/api/settings', { dupSeparators: [], dupIgnore: [] });
  const names = ['叶岚-31', '叶岚-34', '叶岚·30', '秦既白·重置版', '秦既白·重置版-v2'];
  for (const n of names) {
    const card = { spec: 'chara_card_v2', spec_version: '2.0', data: { name: n, description: `测试卡 ${n} ${Math.random()}`, first_mes: 'hi' } };
    await (await fetch(`${B}/api/items?filename=${encodeURIComponent(n)}.json&match=new`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: JSON.stringify(card) })).json();
  }
  // 导入同名规则：选了分隔符后，「叶岚-35」不会被当成「叶岚-34」的同名条目
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  const c = await b.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true });
  const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const groups = async () => { const d = await p.evaluate(() => [...document.querySelectorAll('.card')].filter((c) => c.querySelector('.badge-dupe')).map((c) => c.querySelector('.card-title')?.textContent.trim())); return [d.sort().join('+')]; };
  await p.goto(B + '/#/library'); await p.waitForSelector('.card'); await p.waitForTimeout(500);
  const g0 = await groups();
  ok(g0.some((g) => g.includes('叶岚-31') && g.includes('叶岚-34') && g.includes('叶岚·30')), `default: 叶岚 numbered names grouped (${g0.join(' | ')})`);
  await p.goto(B + '/#/settings/import'); await p.waitForSelector('.set-row:has-text("衍生版本的分隔符")');
  await p.click('.sep-opt:text-is("-")'); await p.waitForTimeout(300);
  await p.click('.sep-opt:text-is("·")'); await p.waitForTimeout(300);
  ok(JSON.stringify((await j('GET', '/api/state')).settings.dupSeparators) === '["-","·"]', 'separators saved on server');
  await p.locator('.set-row:has-text("衍生版本的分隔符")').scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${O}/sep-settings.png` });
  await p.goto(B + '/#/library'); await p.waitForSelector('.card'); await p.waitForTimeout(400);
  const g1 = await groups();
  ok(!g1.some((g) => g.includes('叶岚')), `with - and ·: 叶岚 variants not duplicates (${g1.join(' | ')})`);
  ok(g1[0].includes('秦既白·重置版+秦既白·重置版-v2'), 'version marker -v2 still counts as same card');
  ok(await p.locator('.card:has-text("叶岚-31") .badge-dupe').count() === 0, 'no 可能重复 badge on 叶岚-31');
  { const card = { spec: 'chara_card_v2', spec_version: '2.0', data: { name: '叶岚·31', description: 'x' + Math.random(), first_mes: 'hi' } };
    const r = await (await fetch(`${B}/api/items?filename=${encodeURIComponent('叶岚·31')}.json&match=ask`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: JSON.stringify(card) })).json();
    ok(r.status !== 'conflict', `import 叶岚·31 not treated as same-name of 叶岚-31 (${r.status})`); }
  // 自定义符号
  await p.goto(B + '/#/settings/import'); await p.waitForSelector('.sep-input');
  await p.fill('.sep-input', '＆'); await p.click('.set-row:has-text("衍生版本的分隔符") button:has-text("添加")'); await p.waitForTimeout(300);
  ok((await j('GET', '/api/state')).settings.dupSeparators.includes('＆'), 'custom separator added');
  console.log(errs.join('\n') || 'no errors');
  await b.close();
})();
