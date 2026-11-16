// 来源链接：Discord 帖子链接点开时去唤起 App（discord://-/channels/…），唤不起来会提示改用网页；其它链接照常打开
const { chromium } = require('playwright');
const B = 'http://127.0.0.1:5199';
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
(async () => {
  const st = await (await fetch(`${B}/api/state`)).json();
  const a = st.items.find((i) => i.type === 'character');
  await fetch(`${B}/api/items/${a.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'https://discord.com/channels/111111111111111111/222222222222222222/' }) });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`${B}/#/library?item=${a.id}`); await p.reload();
  await p.waitForSelector('.detail-sheet a.info-link[title="在 Discord 中打开"]');
  const got = await p.evaluate(async () => {
    const mod = await import('/js/source-links.js');
    return [mod.discordAppUrl('https://discord.com/channels/111111111111111111/222222222222222222/'), mod.discordAppUrl('https://discord.com/channels/1/2/3?x=1'), mod.discordAppUrl('https://example.com/channels/1/2'), mod.discordAppUrl('https://discord.com/invite/abc')];
  });
  ok(got[0] === 'discord://-/channels/111111111111111111/222222222222222222' && got[1] === 'discord://-/channels/1/2/3' && got[2] === '' && got[3] === '', `only Discord channel links become app links (${got})`);
  // 无头浏览器里没有 Discord：点了以后页面还在前台，应该提示
  await p.locator('.detail-sheet a.info-link[title="在 Discord 中打开"]').click();
  await p.waitForSelector('.toast:has-text("没能唤起 Discord")', { timeout: 6000 });
  ok(true, 'when the app does not take over, the page says so and points to the web link');
  ok(await p.locator('.detail-sheet a.info-link:has-text("网页打开")').getAttribute('href') === 'https://discord.com/channels/111111111111111111/222222222222222222/', 'the web link stays the original address');
  ok(!errs.length, `no page errors ${errs.join(' | ')}`);
  await browser.close();
})().catch((e) => { console.log('FAIL crashed', e); process.exit(1); });
