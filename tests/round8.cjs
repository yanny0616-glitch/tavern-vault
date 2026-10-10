const { chromium } = require('playwright');
const B = 'http://127.0.0.1:5199'; const OUT = process.argv[2];
let fails = 0; const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fails++; };
(async () => {
  const { token } = await (await fetch(B + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'testpw' }) })).json();
  const H = { Authorization: `Bearer ${token}` };
  const J = async (m, u, b) => (await fetch(B + u, { method: m, headers: { ...H, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })).json();
  const state = () => J('GET', '/api/state');
  // 准备：一个用逗号连起来的标签、一个可合并的标签
  let st = await state(); const live = st.items.filter((i) => !i.deletedAt && i.type === 'character');
  await J('POST', '/api/batch', { ids: [live[0].id], action: 'addTags', value: ['甜宠，破镜重圆、HE'] });
  await J('POST', '/api/batch', { ids: [live[1].id, live[2].id], action: 'addTags', value: ['古言'] });
  await J('POST', '/api/batch', { ids: [live[3].id], action: 'addTags', value: ['古风言情'] });

  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  const c = await b.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await c.addInitScript((t) => { if (window === top) localStorage.setItem('tv_token', t); }, token);
  const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const cdp = await c.newCDPSession(p);
  const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });

  // ---- 8 标签管理 ----
  await p.goto(B + '/#/settings/tags'); await p.waitForSelector('.tag-admin-row');
  ok(await p.locator('.tag-admin-row', { hasText: '古言' }).locator('.fold-count').innerText() === '2', 'tag count shown');
  await p.screenshot({ path: OUT + '/tags.png', fullPage: true });
  await p.click('.note button:has-text("全部拆开")'); await p.waitForTimeout(900);
  st = await state(); let t0 = st.items.find((i) => i.id === live[0].id).tags;
  ok(['甜宠', '破镜重圆', 'HE'].every((t) => t0.includes(t)) && !t0.some((t) => /，|、/.test(t)), 'split all: ' + t0.join('|'));
  // 改名成已有的 → 合并
  p.once('dialog', () => {});
  await p.locator('.tag-admin-row', { hasText: '古风言情' }).locator('button[title="改名 / 合并"]').click();
  await p.fill('.sheet input.input', '古言'); await p.click('.sheet-foot button:has-text("改名")');
  await p.click('.sheet-foot button:has-text("合并")'); await p.waitForTimeout(900);
  st = await state();
  ok(st.items.filter((i) => i.tags.includes('古言')).length === 3 && !st.items.some((i) => i.tags.includes('古风言情')), 'rename to existing merges');
  await p.locator('.tag-admin-row', { hasText: 'HE' }).first().locator('button[title="删除"]').click();
  await p.click('.sheet-foot button:has-text("删除")'); await p.waitForTimeout(900);
  st = await state(); ok(!st.items.some((i) => i.tags.includes('HE')), 'delete tag');
  // 点标签名 → 仓库按标签筛选
  await p.locator('.tag-admin-name', { hasText: '古言' }).click(); await p.waitForSelector('.lib-content .card');
  ok(await p.$$eval('.lib-content .card', (a) => a.length) === 3, 'tag name opens filtered library');
  // 导入选项：只收已有的
  await J('PUT', '/api/settings', { cardTags: 'known' });
  const card = (name, tags, extra = {}) => Buffer.from(JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: { name, description: '测试', first_mes: '你好', tags, extensions: extra } }));
  const up = async (buf, fn, q = '') => (await fetch(`${B}/api/items?filename=${encodeURIComponent(fn)}&mode=new${q}`, { method: 'POST', headers: H, body: buf })).json();
  let r = await up(card('标签测试一', ['古言', '完全没见过的标签，另一个']), 'tag1.json');
  ok(JSON.stringify(r.item?.tags) === '["古言"]', 'cardTags=known keeps only existing: ' + JSON.stringify(r.item?.tags));
  await J('PUT', '/api/settings', { cardTags: 'none' });
  r = await up(card('标签测试二', ['古言']), 'tag2.json'); ok(r.item?.tags?.length === 0, 'cardTags=none');
  await J('PUT', '/api/settings', { cardTags: 'all' });
  r = await up(card('标签测试三', ['甲，乙']), 'tag3.json'); ok(JSON.stringify(r.item?.tags) === '["甲","乙"]', 'cardTags=all splits joined tags');

  // ---- q 写入整理信息并读回 ----
  const src = live[4];
  await J('PATCH', `/api/items/${src.id}`, { rating: 4, favorite: true, notes: '我的笔记', tags: ['自己的标签'] });
  const pf = src.files.find((f) => f.primary);
  let raw = Buffer.from(await (await fetch(`${B}/api/files/${pf.sha}?item=${src.id}&token=${token}`)).arrayBuffer());
  ok(!raw.toString('latin1').includes('tavern_vault') && !(raw[0] === 0x7b && raw.toString().includes('tavern_vault')), 'export meta off → file untouched');
  await J('PUT', '/api/settings', { exportMeta: true });
  raw = Buffer.from(await (await fetch(`${B}/api/files/${pf.sha}?item=${src.id}&token=${token}`)).arrayBuffer());
  r = await up(raw, pf.name.replace(/(\.\w+)$/, '-导回$1'));
  ok(r.status === 'created' && r.item.rating === 4 && r.item.favorite === true && r.item.notes === '我的笔记' && JSON.stringify(r.item.tags) === '["自己的标签"]', 'meta written and read back: ' + JSON.stringify({ s: r.status, rating: r.item?.rating, fav: r.item?.favorite, tags: r.item?.tags }));
  st = await state(); const same = st.items.find((i) => i.id === src.id);
  ok(same.files.find((f) => f.primary).sig === st.items.find((i) => i.id === r.item.id).files[0].sig, 'content fingerprint unchanged by meta');
  await J('PUT', '/api/settings', { exportMeta: false });

  // ---- o 角标 ----
  { const v = live[5]; const vf = v.files.find((f) => f.primary);
    const vb = Buffer.from(await (await fetch(`${B}/api/files/${vf.sha}?token=${token}`)).arrayBuffer());
    const c2 = JSON.parse(JSON.stringify(require('fs').existsSync('/nonexistent') ? {} : {}));
    const content = await J('GET', `/api/items/${v.id}/content`); const cd = structuredClone(content.card); (cd.data || cd).description += '（新版）';
    await fetch(`${B}/api/items/${v.id}/card`, { method: 'PUT', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ card: cd }) }); }
  st = await state();
  await p.goto(B + '/#/library'); await p.reload(); await p.waitForSelector('.lib-content .card'); await p.waitForTimeout(400);
  const multi = st.items.filter((i) => !i.deletedAt && i.files.filter((f) => f.primary || f.sig).length > 1);
  if (multi.length) ok(await p.locator(`.lib-content [data-id="${multi[0].id}"] .badge-ver`).innerText() === `${multi[0].files.filter((f) => f.primary || f.sig).length} 版`, 'version badge');
  else console.log('SKIP no multi-version item');
  console.log('DBG', await p.evaluate((id) => ({ inDom: !!document.querySelector(`.lib-content [data-id="${id}"]`), dupes: document.querySelectorAll('.badge-dupe').length, vers: document.querySelectorAll('.badge-ver').length, notice: document.querySelector('.lib-notice:not(.warn)')?.textContent }), r.item.id));
  ok(await p.locator(`.lib-content [data-id="${r.item.id}"] .badge-dupe`).count() === 1, 'duplicate badge on re-imported copy');
  await p.screenshot({ path: OUT + '/badges.png' });

  // ---- p 返回手势、下拉关闭 ----
  const hashBefore = await p.evaluate(() => location.hash);
  await p.locator('.lib-content .card').first().click(); await p.waitForSelector('.detail-sheet');
  await p.goBack(); await p.waitForTimeout(300);
  ok(await p.$('.detail-sheet') === null && await p.evaluate(() => location.hash) === hashBefore, 'back closes detail, stays on library');
  await p.locator('.lib-content .card').first().click(); await p.waitForSelector('.detail-sheet');
  await p.click('.detail-sheet .sheet-x'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !history.state?.tvSheet), 'closing by X removes the history step');
  // 关弹窗后马上跳页：不能被退回去
  await p.click('button[title="筛选与排序"]'); await p.waitForSelector('.tag-opt');
  await p.click('button:has-text("管理标签")'); await p.waitForTimeout(600);
  ok(await p.evaluate(() => location.hash) === '#/settings/tags', 'close-then-navigate keeps new page: ' + await p.evaluate(() => location.hash));
  await p.goto(B + '/#/library'); await p.waitForSelector('.lib-content .card');
  // 下拉关闭
  await p.locator('.lib-content .card').first().click(); await p.waitForSelector('.detail-sheet'); await p.waitForTimeout(400);
  const hb = await p.locator('.detail-sheet .sheet-grip').boundingBox();
  await touch('touchStart', hb.x + hb.width / 2, hb.y + 2);
  for (let i = 1; i <= 8; i++) await touch('touchMove', hb.x + hb.width / 2, hb.y + 2 + i * 30);
  await touch('touchEnd'); await p.waitForTimeout(500);
  ok(await p.$('.detail-sheet') === null, 'drag down closes sheet');
  await p.locator('.lib-content .card').first().click(); await p.waitForSelector('.detail-sheet'); await p.waitForTimeout(400);
  await touch('touchStart', hb.x + hb.width / 2, hb.y + 2); await touch('touchMove', hb.x + hb.width / 2, hb.y + 30); await touch('touchEnd'); await p.waitForTimeout(400);
  ok(await p.$('.detail-sheet') !== null, 'small drag snaps back');
  // ---- token、内嵌世界书名称 ----
  ok(/Token：常驻/.test(await p.locator('.token-line').innerText()), 'token breakdown: ' + await p.locator('.token-line').innerText());
  await p.screenshot({ path: OUT + '/detail-tokens.png' });
  // 有未保存修改：返回先问，选继续编辑后弹窗还在，再返回还会问
  await p.click('.detail-sheet button:has-text("编辑资料")'); await p.waitForSelector('.sheet h2:has-text("编辑")');
  await p.locator('.sheet .edit-form input.input').first().fill('改了名字没保存');
  await p.goBack(); await p.waitForSelector('.sheet.dialog');
  await p.locator('.sheet.dialog .sheet-foot button').first().click(); await p.waitForTimeout(400);
  ok(await p.locator('.sheet h2:has-text("编辑")').count() === 1, 'unsaved edit: back asks, keep editing keeps sheet');
  await p.goBack(); await p.waitForTimeout(300);
  ok(await p.locator('.sheet.dialog').count() === 1, 'second back asks again');
  console.log(errs.length ? 'ERR ' + errs.join(' | ') : 'no page errors');
  await b.close(); process.exit(fails ? 1 : 0);
})();
