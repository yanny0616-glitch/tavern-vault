const { chromium } = require('playwright');
const fs = require('fs');
const B = 'http://127.0.0.1:5199'; const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
let fails = 0; const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fails++; };
(async () => {
  const { token } = await (await fetch(B + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'testpw' }) })).json();
  const H = { Authorization: 'Bearer ' + token };
  const up = await (await fetch(B + '/api/items?filename=yutang.json', { method: 'POST', headers: H, body: fs.readFileSync(__dirname + '/fixtures/雨棠.json') })).json();
  const cardId = up.item?.id || up.items?.[0]?.id || up.id; ok(!!cardId, 'test card uploaded ' + cardId);
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  const c = await b.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true, acceptDownloads: true });
  await c.addInitScript((t) => localStorage.setItem('tv_token', t), token);
  const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await p.goto(B + '/#/library'); await p.waitForSelector('.card, .row-item');
  // ---- 3 重复条目 ----
  await p.waitForSelector('.lib-notice:not([hidden])', { timeout: 5000 }).catch(() => {});
  const notice = await p.$eval('.lib-notice:not(.warn)', (e) => (e.hidden ? '' : e.textContent)).catch(() => '');
  ok(/发现 \d+ 组/.test(notice), 'duplicate notice: ' + notice);
  await p.click('.lib-notice .btn:not(.ghost)'); await p.waitForSelector('.dup-group');
  const groups = await p.$$eval('.dup-group', (a) => a.map((g) => [g.querySelector('.chip-s').textContent, g.querySelector('h3').textContent, g.querySelectorAll('.dup-row').length]));
  console.log('  groups', JSON.stringify(groups));
  ok(groups.some((g) => g[1].startsWith('许知年') && g[2] === 4) && groups.some((g) => g[1] === '宋清和' && g[2] === 2), 'expected groups found');
  await p.screenshot({ path: OUT + '/dupes.png', fullPage: false });
  // 宋清和：换保留对象到第二个，然后合并
  const lu = (await p.$$('.dup-group')).find(async () => true);
  const luIdx = groups.findIndex((g) => g[1] === '宋清和');
  const luG = (await p.$$('.dup-group'))[luIdx];
  await (await luG.$$('.dup-radio'))[1].click();
  ok(await luG.$eval('.dup-row:nth-child(2)', (e) => e.classList.contains('keep')), 'keep switched to second');
  await (await luG.$('.row-actions .btn.primary')).click();
  await p.waitForSelector('.overlay .sheet.dialog, .sheet.dialog'); await p.click('.sheet.dialog .btn.primary');
  await p.waitForFunction(() => ![...document.querySelectorAll('.dup-group h3')].some((h) => h.textContent === '宋清和'), null, { timeout: 5000 }).catch(() => {});
  ok(!(await p.$$eval('.dup-group h3', (a) => a.map((x) => x.textContent))).includes('宋清和'), 'merged group disappeared after merge');
  // 许知年：不合并其中一个 → 部分合并
  let zg = (await p.$$('.dup-group'))[0]; const zname = await zg.$eval('h3', (e) => e.textContent);
  await (await zg.$$('.row-check'))[2].click();
  const lbl = await zg.$eval('.row-actions .btn.primary', (e) => e.textContent);
  ok(/合并 2 个/.test(lbl), 'partial selection label: ' + lbl);
  await (await zg.$('.row-actions .btn.ghost')).click(); // 不是重复
  await p.waitForTimeout(600);
  const left = await p.$$eval('.dup-group', (a) => a.length);
  ok(left === groups.length - 2, `after merge + ignore, ${left} groups left`);
  await p.keyboard.press('Escape');
  const st = await (await fetch(B + '/api/state', { headers: H })).json();
  ok(st.settings.dupIgnore.length === 1, 'ignore persisted on server');
  await p.goto(B + '/#/trash'); await p.waitForSelector('.row-item');
  ok((await p.textContent('.page')).includes('已合并到「宋清和」'), 'trash shows merged-into');
  // ---- 8 时间分组 ----
  await p.goto(B + '/#/library'); await p.waitForSelector('.card');
  await p.click('.tb-actions-inner .btn[title="筛选与排序"]'); await p.click('.sheet .opt:has-text("按添加时间分组")'); await p.keyboard.press('Escape');
  const tg = await p.$$eval('.time-group', (a) => a.map((x) => x.textContent));
  ok(tg.length >= 1 && tg[0].startsWith('今天'), 'time groups: ' + tg.join(' / '));
  await p.screenshot({ path: OUT + '/timegroups.png' });
  // ---- 5 / 4 详情 ----
  await p.fill('.search-input', '雨棠'); await p.waitForTimeout(400); await p.click('.card'); await p.waitForSelector('.detail-sheet');
  await p.waitForSelector('.greet'); await p.waitForSelector('.greet-head .btn[title="全屏阅读"]');
  await p.click('.greet-head .btn[title="全屏阅读"]'); await p.waitForSelector('.read-sheet .st-frame');
  await p.waitForTimeout(800);
  const f1 = await p.$('.read-sheet .st-frame'); const fr = await f1.contentFrame();
  const ftext = await fr.evaluate(() => document.body.innerText);
  ok(/心情：平静 · 天气：小雨 · 雨棠/.test(ftext) && !ftext.includes('<status>'), 'styled greeting rendered: ' + ftext.replace(/\n/g, ' | ').slice(0, 80));
  ok(await fr.evaluate(() => !!document.querySelector('em')), 'markdown *action* rendered as em');
  ok((await p.title()) !== 'PWNED' && (await p.title()) !== 'PWNED2' && !(await fr.evaluate(() => document.body.dataset.ran)), 'scripts / onerror in preview did not run');
  const fh = await f1.evaluate((e) => e.getBoundingClientRect().height); ok(fh > 40 && fh < 600 && fh !== 60, 'frame auto height ' + fh);
  await p.screenshot({ path: OUT + '/reader-styled.png' });
  await p.click('.read-mode .seg-item:has-text("文字")');
  ok(await p.$eval('.read-sheet .read-full', (e) => e.textContent.includes('<status>')), 'text mode shows raw text');
  await p.click('.read-mode .seg-item:has-text("酒馆效果")');
  await p.click('.read-sheet .sheet-foot .btn:has-text("下一条")');
  ok((await p.textContent('.read-sheet .sheet-head h2')) === '备选开场白 1' && (await p.textContent('.read-count')) === '2 / 3', 'next greeting');
  await p.keyboard.press('ArrowRight');
  ok((await p.textContent('.read-count')) === '3 / 3', 'arrow key paging');
  const before = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--read-zoom').trim());
  await p.click('.read-tools .btn[title="字大一点"]');
  const after = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--read-zoom').trim());
  ok(before === '1' && after === '1.1' && (await p.textContent('.read-tools-label')) === '110%', `font size ${before} → ${after}`);
  await p.click('.read-tools .btn[title="字小一点"]');
  await p.keyboard.press('Escape');
  ok(await p.$('.detail-sheet') && !(await p.$('.read-sheet')), 'Escape closes only reader');
  // 内容页：对话示例跳段 + 正则预览
  await p.click('.tabs button:has-text("内容")'); await p.waitForSelector('.read-sec');
  await p.click('#sec-' + cardId + '-example .read-head .btn'); await p.waitForSelector('.read-sheet .read-jump');
  const opts = await p.$$eval('.read-jump option', (a) => a.length); ok(opts === 3, 'dialog segment jump has 3 options');
  await p.selectOption('.read-jump', '2'); await p.waitForTimeout(300);
  const seg3 = await p.$$eval('.read-sheet .dlg', (a) => { const sb = document.querySelector('.read-sheet .sheet-body'); return { off: Math.round(a[2].getBoundingClientRect().top - sb.getBoundingClientRect().top), bottom: sb.scrollTop + sb.clientHeight >= sb.scrollHeight - 2, top: sb.scrollTop }; });
  ok(seg3.top > 0 && ((seg3.off >= 0 && seg3.off < 40) || seg3.bottom), 'jumped to segment 3 ' + JSON.stringify(seg3));
  await p.selectOption('.read-jump', '1'); await p.waitForTimeout(200);
  const seg2 = await p.$$eval('.read-sheet .dlg', (a) => Math.round(a[1].getBoundingClientRect().top - document.querySelector('.read-sheet .sheet-body').getBoundingClientRect().top));
  ok(seg2 >= 0 && seg2 < 40, 'jumped to segment 2 (offset ' + seg2 + ')');
  await p.keyboard.press('Escape');
  await p.click('#sec-' + cardId + '-regex summary:has-text("状态栏美化")'); await p.waitForSelector('#sec-' + cardId + '-regex .st-frame');
  await p.waitForTimeout(600);
  const chips = await p.$$eval('#sec-' + cardId + '-regex .chips-row .chip-s', (a) => a.map((x) => x.textContent));
  ok(chips.includes('作用于AI 输出') && chips.includes('只改显示') && chips.includes('深度 ≤ 2'), 'regex chips ' + chips.join(','));
  const rf = await (await p.$('#sec-' + cardId + '-regex .st-frame')).contentFrame();
  ok(/心情：平静/.test(await rf.evaluate(() => document.body.innerText)), 'regex preview uses first greeting as sample');
  const info = await p.textContent('#sec-' + cardId + '-regex .st-preview .muted');
  ok(/匹配到 1 处/.test(info), 'preview info: ' + info);
  await p.click('#sec-' + cardId + '-regex .st-sample-box summary');
  await p.fill('#sec-' + cardId + '-regex .st-sample', '没有状态栏的文本'); await p.waitForTimeout(500);
  ok(/没有匹配/.test(await p.textContent('#sec-' + cardId + '-regex .st-preview .muted')), 'custom sample without match');
  await p.screenshot({ path: OUT + '/regex.png', fullPage: false });
  await (await p.$('#sec-' + cardId + '-regex')).screenshot({ path: OUT + '/regex-sec.png' });
  // ---- 6 封面收藏 ----
  await p.click('.tabs button:has-text("文件")'); await p.waitForSelector('.panel .cover-grid, .panel h3:has-text("封面")');
  await p.evaluate(async ({ id, token }) => {
    const mk = async (color, type) => { const cv = document.createElement('canvas'); cv.width = 300; cv.height = 400; const x = cv.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, 300, 400); return new Promise((r) => cv.toBlob(r, type, 0.9)); };
    for (const [n, col, t] of [['a.jpg', '#c33', 'image/jpeg'], ['b.png', '#36c', 'image/png']]) await fetch(`/api/items/${id}/files?filename=${n}&primary=0&label=封面收藏`, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: await mk(col, t) });
  }, { id: cardId, token });
  await p.waitForFunction(() => document.querySelectorAll('.cover-tile').length === 2, null, { timeout: 5000 });
  ok(true, '2 cover tiles shown');
  const vers = await p.$$eval('.file-ver', (a) => a.length); ok(vers <= 1, 'attachment PNG not counted as a card version (' + vers + ' version badges)');
  await (await p.$$('.cover-tile'))[0].click();
  await p.waitForFunction(() => document.querySelector('.cover-tile.on'), null, { timeout: 4000 });
  ok(await p.$eval('.cover-tile.on', (e) => !!e.querySelector('.cover-on')), 'jpeg set as cover');
  await p.screenshot({ path: OUT + '/covers.png' });
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('.panel .btn:has-text("导出 PNG")')]);
  const fp = OUT + '/export.png'; await dl.saveAs(fp);
  const buf = fs.readFileSync(fp);
  ok(buf.slice(1, 4).toString() === 'PNG', 'export is PNG');
  const chunks = {}; for (let o = 8; o < buf.length;) { const len = buf.readUInt32BE(o); const t = buf.slice(o + 4, o + 8).toString(); if (t === 'tEXt') { const d = buf.slice(o + 8, o + 8 + len); const z = d.indexOf(0); chunks[d.slice(0, z).toString()] = Buffer.from(d.slice(z + 1).toString(), 'base64').toString('utf8'); } o += 12 + len; }
  const v3 = JSON.parse(chunks.ccv3 || '{}'); const v2 = JSON.parse(chunks.chara || '{}');
  ok(v3.data?.name === '雨棠' && v3.spec === 'chara_card_v3' && v2.spec === 'chara_card_v2' && v2.data.extensions.regex_scripts.length === 3, 'PNG has ccv3 + chara with full card');
  // re-import exported PNG → recognized as same card (duplicate)
  const re = await (await fetch(B + '/api/items?filename=export.png', { method: 'POST', headers: H, body: buf })).json();
  ok(re.status === 'duplicate' || re.duplicate || re.conflict || JSON.stringify(re).includes(cardId), 'exported PNG re-imports as the same card: ' + JSON.stringify(re).slice(0, 120));
  console.log(errs.length ? 'ERRORS ' + JSON.stringify(errs) : 'no page errors');
  await b.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
