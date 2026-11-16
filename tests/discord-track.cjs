// Discord 来源追踪：令牌只存服务器、读帖子标题、标题变了提醒、出错就停、设置页和详情页
const { chromium } = require('playwright');
const fs = require('fs');
const B = 'http://127.0.0.1:5199'; const MOCK = 'http://127.0.0.1:5197/discord';
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const send = async (method, p, body) => { const r = await fetch(B + p, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch { /* empty */ } return { status: r.status, j }; };
const items = async () => (await send('GET', '/api/state')).j.items;
const mock = (o) => fetch(`${MOCK}/__set`, { method: 'POST', body: JSON.stringify(o) });
const T1 = 'https://discord.com/channels/111111111111111111/222222222222222222';
const T2 = 'https://discord.com/channels/111111111111111111/333333333333333333/444444444444444444';
(async () => {
  const chars = (await items()).filter((i) => i.type === 'character');
  const [a, b, c] = chars;
  await mock({ '222222222222222222': '【角色卡】林雨眠 v1.0', '333333333333333333': '白夜 初版', '555555555555555555': 403, '666666666666666666': 429 });

  // ---- 令牌
  let r = await send('GET', '/api/discord');
  ok(r.j.enabled === false && r.j.hasToken === false && !('token' in r.j), 'off by default, no token');
  ok((await send('PUT', '/api/discord', { token: 'has space' })).status === 400, 'a token with spaces is refused');
  ok((await send('POST', '/api/discord/check', { id: a.id })).status === 400, 'nothing is checked without a token');
  r = await send('PUT', '/api/discord', { token: ' "good-token" ', enabled: true, every: 24 });
  ok(r.j.hasToken && r.j.enabled && !JSON.stringify(r.j).includes('good-token'), 'the token is stored and never sent back');
  const file = `${process.env.TV_TEST_WORK || `${__dirname}/.work`}/run/discord.json`;
  ok(fs.existsSync(file) && (fs.statSync(file).mode & 0o777) === 0o600 && !fs.readFileSync(`${file.replace('discord.json', 'db.json')}`, 'utf8').includes('good-token'), 'kept in its own file with mode 600, not in the database');
  ok(!JSON.stringify((await send('GET', '/api/state')).j).includes('good-token'), 'the page state does not carry it');

  // ---- 读标题
  ok((await send('POST', '/api/discord/check', { id: a.id })).status === 400, 'an item without a Discord link is not checked');
  await send('PATCH', `/api/items/${a.id}`, { source: T1 });
  await send('PATCH', `/api/items/${b.id}`, { source: T2 });
  r = await send('POST', '/api/discord/check', { id: a.id });
  ok(r.j.track?.title === '【角色卡】林雨眠 v1.0' && r.j.track.seen === r.j.track.title && !r.j.track.changed, `first check remembers the title (${JSON.stringify(r.j.track)})`);
  const log = await (await fetch(`${MOCK}/__log`)).json();
  ok(log.length === 1 && log[0].id === '222222222222222222' && log[0].method === 'GET' && log[0].auth === 'good-token', 'one read-only request per check');
  await mock({ '222222222222222222': '【角色卡】林雨眠 v2.0（已更新）' });
  r = await send('POST', '/api/discord/check', { id: a.id });
  ok(r.j.track.changed === true && r.j.track.seen === '【角色卡】林雨眠 v1.0' && r.j.track.title.includes('v2.0') && r.j.track.changedAt, 'a changed title is flagged');
  r = await send('POST', '/api/discord/check', { all: true });
  ok(r.j.queued === 2, 'check everything queues both');
  for (let i = 0; i < 40 && !(await items()).find((x) => x.id === b.id).track?.title; i++) await new Promise((res) => setTimeout(res, 150));
  ok((await items()).find((x) => x.id === b.id).track?.title === '白夜 初版', 'a message link is tracked by its thread');
  r = await send('GET', '/api/discord');
  ok(r.j.tracked === 2 && r.j.changed === 1 && r.j.lastRun > 0, `counts (${JSON.stringify(r.j)})`);

  // ---- 网页
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`${B}/#/library`);
  await p.waitForSelector('.lib-notice:has-text("来源帖标题变了")');
  await p.screenshot({ path: `${process.argv[2]}/notice.png` });
  await p.click('.lib-notice:has-text("来源帖标题变了") .btn:has-text("查看")');
  await p.waitForFunction(() => document.querySelectorAll('.card').length === 1);
  ok(true, 'the library says so and filters to the changed ones');
  await p.goto(`${B}/#/library?item=${a.id}`); await p.reload();
  await p.waitForSelector('.track-note');
  ok(/v1\.0/.test(await p.locator('.track-note s').innerText()) && /v2\.0/.test(await p.locator('.track-note b').innerText()) && (await p.locator('.track-note a.btn').getAttribute('href')) === T1, 'the detail page shows old and new title with a link to the thread');
  await p.screenshot({ path: `${process.argv[2]}/detail.png` });
  await p.click('.track-note .btn:has-text("看过了")');
  await p.waitForFunction(() => !document.querySelector('.track-note'));
  let it = (await items()).find((x) => x.id === a.id);
  ok(!it.track.changed && it.track.seen.includes('v2.0'), 'seen: the new title becomes the baseline');
  await p.goto(`${B}/#/settings/connect`); await p.reload();
  await p.waitForSelector('.panel:has-text("Discord 来源追踪") .track-stat');
  ok(/2 个条目/.test(await p.locator('.track-stat').innerText()) && await p.locator('.panel:has-text("Discord 来源追踪") input[type=password]').inputValue() === '', 'settings show the state and never the token');
  await p.locator('.panel:has-text("Discord 来源追踪")').scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${process.argv[2]}/settings.png` });

  // ---- 出错
  await send('PATCH', `/api/items/${c.id}`, { source: 'https://discord.com/channels/111111111111111111/555555555555555555' });
  r = await send('POST', '/api/discord/check', { id: c.id });
  ok(/看不到/.test(r.j.track?.error || '') && (await send('GET', '/api/discord')).j.paused === null, 'a thread you cannot see is that item\'s problem only');
  await send('PATCH', `/api/items/${c.id}`, { source: 'https://discord.com/channels/111111111111111111/666666666666666666' });
  ok(!(await items()).find((x) => x.id === c.id).track, 'changing the link forgets the old thread');
  r = await send('POST', '/api/discord/check', { id: c.id });
  const d1 = (await send('GET', '/api/discord')).j;
  ok(r.status === 409 && d1.paused?.until > Date.now() + 3000e3, 'rate limited: everything pauses for at least an hour');
  const n1 = (await (await fetch(`${MOCK}/__log`)).json()).length;
  ok((await send('POST', '/api/discord/check', { id: a.id })).status === 409 && (await (await fetch(`${MOCK}/__log`)).json()).length === n1, 'while paused nothing is sent');
  await send('PUT', '/api/discord', { token: 'bad-token', enabled: true });
  r = await send('POST', '/api/discord/check', { id: a.id });
  const d2 = (await send('GET', '/api/discord')).j;
  ok(r.status === 409 && d2.paused && !d2.paused.until && /令牌/.test(d2.paused.reason), 'a rejected token stops everything until a new one is set');
  r = await send('PUT', '/api/discord', { token: '' });
  ok(!r.j.hasToken && !r.j.enabled && !fs.readFileSync(file, 'utf8').includes('token":"b'), 'clearing the token removes it and switches tracking off');
  it = (await items()).find((x) => x.id === a.id);
  ok(it.track?.seen, 'titles already recorded are kept');
  ok(!errs.length, `no page errors ${errs.join(' | ')}`);
  await browser.close();
})().catch((e) => { console.log('FAIL crashed', e); process.exit(1); });
