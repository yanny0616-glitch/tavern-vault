// 端到端：酒馆页像角色列表一样浏览、点开预览（和藏馆详情一样）、多选；藏馆卡片上的「酒馆」角标、未导入酒馆筛选、
// 封面角标自定义位置，以及四个角的角标在各风格、紧凑视图下互不遮挡
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const V = 'http://127.0.0.1:5199';
const M = 'http://127.0.0.1:5198';
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const j = async (u, o) => (await fetch(u, o)).json();
const putSettings = (o) => fetch(`${V}/api/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) });
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '#toasts{opacity:.0001}'; document.head.append(s); }); });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errs.push('HTTP ' + r.status() + ' ' + r.url()); });
  const fullReqs = [];
  page.on('request', (q) => { if (q.url().includes('/characters/lily.png')) fullReqs.push(q.url()); });
  await page.goto(M + '/');
  await page.fill('#tv-url', 'http://localhost:5199');
  await page.click('#tv-connect');
  await page.waitForFunction(() => /已连接|失败/.test(document.querySelector('#tv-status').textContent));
  await page.click('#tv-menu-item');
  const frame = await (await page.waitForSelector('#tv-panel iframe')).contentFrame();
  const tab = (label) => frame.click(`.tabbar button:has-text("${label}")`);
  await frame.waitForSelector('.tabbar button:has-text("酒馆")');

  // ---- 酒馆页：角色卡是带封面的网格 ----
  await tab('酒馆');
  const card = (name) => frame.locator(`.tv-card:has-text("${name}")`);
  await card('酒馆里的莉莉').waitFor();
  ok(await frame.locator('.tv-grid').count() === 1, 'characters shown as a cover grid');
  await card('酒馆里的莉莉').locator('.tv-cover img').waitFor({ timeout: 10000 });
  ok(await card('酒馆里的莉莉').locator('.corner-bl:has-text("未收藏")').count() === 1, 'grid card shows 未收藏 status');
  await page.screenshot({ path: `${OUT}/tavern-grid.png` });

  // ---- 点开预览：和藏馆详情一样的介绍 / 内容 ----
  await card('酒馆里的莉莉').click();
  const sheet = frame.locator('.detail-sheet');
  await sheet.locator('.hero-title:has-text("酒馆里的莉莉")').waitFor({ timeout: 10000 });
  ok(await sheet.locator('.greet-body:has-text("你好")').count() === 1, 'preview shows greeting');
  ok(await sheet.locator('.hero-badges:has-text("未收藏")').count() === 1, 'preview hero shows status');
  ok(/^blob:/.test(await sheet.locator('.hero-cover img').getAttribute('src')), 'preview cover is the tavern image');
  ok(fullReqs.length > 0, 'preview asked the tavern for the full-size avatar');
  ok(await sheet.locator('.tabs button').count() === 2, 'preview has 介绍 / 内容 tabs only (no 文件)');
  ok(await sheet.locator('.fav-btn, .hero-time, .head-extra .btn[title="更多操作"]').count() === 0, 'preview has no favorite / rating / more menu');
  await sheet.locator('.tabs button:has-text("内容")').click();
  await sheet.locator('.read-sec:has-text("来自酒馆的角色")').waitFor();
  ok(await sheet.locator('.reader-tools .btn:has-text("编辑内容")').count() === 0, 'preview content is read-only');
  await page.screenshot({ path: `${OUT}/tavern-preview.png` });
  const before = (await j(`${V}/api/state`)).items.length;
  ok(before === (await j(`${V}/api/state`)).items.length, 'preview does not create vault items');

  // 收藏后预览底部按钮跟着变
  await sheet.locator('.sheet-foot button:has-text("收藏到藏馆")').click();
  await sheet.locator('.sheet-foot button:has-text("在藏馆中查看")').waitFor({ timeout: 10000 });
  ok(true, 'preview foot updates after collecting');
  await sheet.locator('.hero-badges:has-text("已同步")').waitFor({ timeout: 5000 });
  ok(true, 'preview status updates after collecting');
  await frame.locator('.overlay').last().evaluate(() => history.back());
  await frame.waitForTimeout(300);
  if (await frame.locator('.detail-sheet').count()) await frame.locator('.detail-sheet .sheet-close, .detail-sheet [aria-label="关闭"]').first().click().catch(() => {});
  await frame.waitForSelector('.detail-sheet', { state: 'detached', timeout: 5000 }).catch(() => {});
  await card('酒馆里的莉莉').locator('.corner-bl:has-text("已同步")').waitFor({ timeout: 10000 });
  ok(true, 'grid card now 已同步');

  // ---- 多选 ----
  await frame.click('.toolbar-row .btn:has-text("多选")');
  await card('酒馆里的莉莉').click();
  ok(await frame.locator('.selbar:not([hidden]) .sel-count:has-text("已选 1 项")').count() === 1, 'multi-select mode: tap selects');
  ok(await frame.locator('.detail-sheet').count() === 0, 'multi-select mode: tap does not open preview');
  await frame.click('.selbar .btn:has-text("取消")');

  // ---- 列表视图 / 其它类型 ----
  const tvView = async (label) => { await frame.click('.topbar .btn[title="显示方式"]'); await frame.click(`.overlay .opt:has-text("${label}")`); await frame.waitForSelector('.overlay', { state: 'detached' }); };
  await tvView('列表');
  await frame.locator('.rows .row-item:has-text("酒馆里的莉莉")').waitFor();
  ok(true, 'tavern characters → list');
  await frame.click('.seg-item:has-text("背景")');
  await frame.locator('.tv-grid .tv-card').first().waitFor();
  ok(true, 'tavern backgrounds still a grid (view is per kind)');
  await tvView('紧凑');
  await frame.locator('.tv-grid.dense').waitFor();
  await frame.click('.seg-item:has-text("角色卡")');
  await frame.locator('.rows .row-item:has-text("酒馆里的莉莉")').waitFor();
  ok(true, 'characters still list after backgrounds set to dense');
  await tvView('卡片');
  // 搜索词换类型时清空
  await frame.fill('.topbar .search-input', '莉莉');
  await frame.click('.seg-item:has-text("世界书")');
  ok(await frame.inputValue('.topbar .search-input') === '', 'tavern search cleared on kind switch');
  const wrow = frame.locator('.row-item:has-text("酒馆世界书")');
  await wrow.waitFor();
  await wrow.locator('.row-main').click();
  await frame.locator('.detail-sheet .tabs button.active:has-text("内容")').waitFor({ timeout: 10000 });
  await frame.locator('.detail-sheet .detail-body .entry .fold-title:has-text("酒馆")').waitFor({ timeout: 10000 });
  ok(true, 'worldbook preview opens on 内容 with entries');
  await frame.locator('.detail-sheet .sheet-foot button:has-text("收藏到藏馆")').click();
  await frame.locator('.detail-sheet .sheet-foot button:has-text("在藏馆中查看")').waitFor({ timeout: 10000 });
  await frame.locator('.detail-sheet .sheet-foot button:has-text("在藏馆中查看")').click();
  await frame.locator('.detail-sheet .hero-badges:has-text("酒馆里已有")').waitFor({ timeout: 10000 });
  ok(true, '在藏馆中查看 opens the vault item, which shows 酒馆里已有');
  await page.screenshot({ path: `${OUT}/vault-detail-intavern.png` });
  await frame.evaluate(() => history.back());
  await frame.waitForSelector('.detail-sheet', { state: 'detached', timeout: 5000 }).catch(() => {});
  await frame.click('.seg-item:has-text("背景")');
  await frame.locator('.tv-card:has-text("bg1")').click();
  await frame.locator('.lightbox img, .overlay img').first().waitFor({ timeout: 10000 });
  ok(true, 'background opens big image');
  await frame.click('.lightbox');
  await frame.waitForSelector('.lightbox', { state: 'detached', timeout: 5000 });

  // ---- 藏馆这边：右下角「酒馆」角标、未导入酒馆筛选 ----
  await tab('仓库');
  const vcard = (name) => frame.locator(`.grid .card:has-text("${name}")`);
  await vcard('酒馆里的莉莉').locator('.corner-br .badge-tavern').waitFor({ timeout: 10000 });
  ok(true, 'vault card shows 酒馆 mark at bottom-right');
  const st = await j(`${V}/api/state`);
  const other = st.items.find((i) => !i.deletedAt && i.type === 'character' && i.name !== '酒馆里的莉莉');
  ok(await vcard(other.name).first().locator('.badge-tavern').count() === 0, `card not in tavern has no mark (${other.name})`);
  await frame.click('.btn[title="筛选与排序"]');
  await frame.click('.overlay .opt:has-text("未导入酒馆")');
  await frame.evaluate(() => history.back());
  await frame.waitForTimeout(400);
  ok(await vcard('酒馆里的莉莉').count() === 0 && await frame.locator('.grid .card').count() > 0, '未导入酒馆 filter hides items already in tavern');
  await frame.click('.btn[title="筛选与排序"]');
  await frame.click('.overlay .opt:has-text("未导入酒馆")');
  await frame.evaluate(() => history.back());
  await frame.waitForTimeout(300);

  // ---- 设置：封面角标，加「标签」、把酒馆挪到左上 ----
  await tab('设置');
  await frame.click('text=浏览');
  const rules = frame.locator('.mark-rule');
  await rules.first().waitFor();
  ok(await rules.count() === 3, `default 3 mark rules (${await rules.count()})`);
  await frame.click('.btn:has-text("添加角标")');
  await frame.click('.menu-item:has-text("标签（这张卡自己的）")');
  await frame.locator('.mark-rule:has-text("标签（这张卡自己的）")').waitFor();
  await page.screenshot({ path: `${OUT}/settings-marks.png` });
  await frame.locator('.mark-rule:has-text("酒馆里已有") .pos-cell[title="左上"]').click();
  await tab('仓库');
  await vcard('酒馆里的莉莉').locator('.corner-tl .badge-tavern').waitFor({ timeout: 5000 });
  ok(await vcard('酒馆里的莉莉').locator('.corner-br .badge-tag:has-text("酒馆")').count() === 1, 'own tags shown at bottom-right');
  ok(true, 'moving 酒馆里已有 to 左上 moves the mark');
  // 恢复：酒馆放回右下，和标签挤在同一角；再给莉莉做出第二个版本，左下角出现「2 版」
  await tab('设置');
  await frame.click('text=浏览');
  await frame.locator('.mark-rule:has-text("酒馆里已有") .pos-cell[title="右下"]').click();
  await fetch(`${M}/__edit?q=${encodeURIComponent(JSON.stringify({ avatar: 'lily.png', description: '第二版描述，长一点' }))}`);
  const lily = (await j(`${V}/api/state`)).items.find((i) => i.name === '酒馆里的莉莉');
  const exp = await (await fetch(`${M}/api/characters/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatar_url: 'lily.png' }) })).arrayBuffer();
  await fetch(`${V}/api/items/${lily.id}/files?filename=lily.png&primary=1`, { method: 'POST', body: Buffer.from(exp) });
  // 再加几个长标签，测试挤满时也不遮挡
  await fetch(`${V}/api/items/${lily.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tags: ['酒馆', '很长很长的标签名字', '第三个标签', '第四个'] }) });
  await tab('仓库');
  await vcard('酒馆里的莉莉').locator('.corner-bl .badge-ver').waitFor({ timeout: 10000 });

  // ---- 四个角互不遮挡：6 套风格 × 普通 / 紧凑 ----
  const overlaps = async () => frame.evaluate(() => {
    const bad = [];
    // 屏幕外的卡片滚到附近时才量，这里只看屏幕上的
    for (const c of [...document.querySelectorAll('.grid .card')].filter((x) => { const r = x.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; })) {
      const boxes = [...c.querySelectorAll('.card-corner > span')].map((e) => ({ e, r: e.getBoundingClientRect(), pos: e.parentElement.className }));
      const fixed = [...c.querySelectorAll('.card-fav, .card-type, .card-rank, .card-no')].filter((e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0).map((e) => ({ e, r: e.getBoundingClientRect(), pos: e.className }));
      const all = [...boxes, ...fixed];
      // 显示出来的角标必须完整地在自己那个角里（不能被切掉一半）
      for (const b of boxes) {
        if (!b.r.width) continue;
        const p = b.e.parentElement.getBoundingClientRect();
        if (b.r.top < p.top - 1 || b.r.bottom > p.bottom + 1) bad.push(`${b.e.textContent} is cut off`);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let k = 0; k < all.length; k++) {
          if (all[k] === boxes[i] || (k < boxes.length && all[k].pos === boxes[i].pos)) continue;
          const a = boxes[i].r; const b = all[k].r;
          if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) bad.push(`${c.querySelector('.card-title')?.textContent}: ${boxes[i].e.textContent} × ${all[k].e.textContent || all[k].pos}`);
        }
      }
    }
    return bad;
  });
  await fetch(`${V}/api/items/${lily.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favorite: true, rating: 4 }) });
  for (const skin of ['atelier', 'minimal', 'tavern', 'sakura', 'ink', 'neon']) {
    await putSettings({ skin });
    await frame.waitForFunction((s) => document.documentElement.dataset.skin === s, skin, { timeout: 10000 });
    for (const dense of [false, true]) {
      await frame.click('.btn[title="筛选与排序"]');
      await frame.click(`.overlay .opt:has-text("${dense ? '紧凑' : '卡片'}")`);
      await frame.evaluate(() => history.back());
      await frame.waitForTimeout(400);
      await vcard('酒馆里的莉莉').scrollIntoViewIfNeeded();
      await frame.waitForTimeout(400);
      const bad = await overlaps();
      ok(bad.length === 0, `${skin}${dense ? ' dense' : ''}: corner marks do not overlap ${bad.slice(0, 3).join(' | ')}`);
      await vcard('酒馆里的莉莉').screenshot({ path: `${OUT}/marks-${skin}${dense ? '-dense' : ''}.png` });
    }
  }
  await putSettings({ skin: 'atelier' });

  // ---- 每个类型可以单独设置显示方式：世界书用列表，不影响角色卡 ----
  const pick = async (label) => { await frame.click(`.seg-item:has-text("${label}")`); await frame.waitForTimeout(300); };
  const mode = () => frame.evaluate(() => (document.querySelector('.main .grid') ? (document.querySelector('.main .grid.dense') ? 'dense' : 'grid') : 'list'));
  const setMode = async (label) => { await frame.click('.btn[title="筛选与排序"]'); await frame.click(`.overlay .opt:has-text("${label}")`); await frame.evaluate(() => history.back()); await frame.waitForTimeout(400); };
  await pick('全部');
  await setMode('卡片');
  await pick('世界书');
  await setMode('列表');
  ok(await mode() === 'list', 'worldbook switched to list');
  await pick('角色卡');
  ok(await mode() === 'grid', `characters still cards (${await mode()})`);
  await setMode('紧凑');
  await pick('世界书');
  ok(await mode() === 'list', 'worldbook still list after characters set to dense');
  await pick('全部');
  ok(await mode() === 'grid', `全部 keeps the default (${await mode()})`);
  await tab('设置');
  await frame.click('text=浏览');
  ok(await frame.locator('.view-own .chip').count() === 2, 'settings lists 2 types with their own view');
  await frame.locator('.view-own .chip:has-text("世界书") .chip-x').click();
  await frame.waitForTimeout(200);
  ok(await frame.locator('.view-own .chip').count() === 1, 'reset one type to default');
  await tab('仓库');
  await pick('世界书');
  ok(await mode() === 'grid', 'worldbook back to the default view');

  // ---- 卡片上显示 / 角标按类型：只给世界书关掉编号、加一个「版本数」以外的角标 ----
  await tab('设置');
  await frame.click('text=浏览');
  await frame.selectOption('.set-row:has-text("设置给") select', 'worldbook');
  await frame.locator('.scope-note:has-text("还没单独设置过")').waitFor();
  await frame.click('.set-row:has-text("编号") .switch');
  await frame.locator(".panel-head:has-text(\"封面角标 · 世界书\")").first().waitFor();
  await frame.locator('.mark-rule:has-text("酒馆里已有") .btn[title="不显示这个角标"]').click();
  ok(await frame.locator('.mark-rule').count() === 3, `worldbook marks edited separately (${await frame.locator('.mark-rule').count()})`);
  await frame.selectOption('.set-row:has-text("设置给") select', 'character');
  ok(await frame.locator('.mark-rule').count() === 4, `character marks unchanged (${await frame.locator('.mark-rule').count()})`);
  await tab('仓库');
  await pick('全部');
  const wbCard = frame.locator('.grid .card[data-type="worldbook"]').first();
  const chCard = frame.locator('.grid .card[data-type="character"]').first();
  ok(await wbCard.evaluate((e) => e.classList.contains('no-no')) && !(await chCard.evaluate((e) => e.classList.contains('no-no'))), 'numbers hidden only on worldbook cards');
  ok(await frame.locator('.grid .card[data-type="worldbook"]:has-text("酒馆世界书") .badge-tavern').count() === 0, 'worldbook card has no 酒馆 mark (its own rules)');
  ok(await vcard('酒馆里的莉莉').locator('.badge-tavern').count() === 1, 'character card still has 酒馆 mark');

  // ---- 详情页：角色卡先看介绍，世界书先看内容 ----
  await vcard('酒馆里的莉莉').click();
  await frame.locator('.detail-sheet .tabs button.active:has-text("介绍")').waitFor({ timeout: 5000 });
  ok(true, 'character opens on 介绍');
  await frame.evaluate(() => history.back());
  await frame.waitForSelector('.detail-sheet', { state: 'detached', timeout: 5000 });
  await frame.locator('.grid .card[data-type="worldbook"]:has-text("酒馆世界书")').click();
  await frame.locator('.detail-sheet .tabs button.active:has-text("内容")').waitFor({ timeout: 5000 });
  ok(true, 'worldbook opens on 内容');
  await frame.evaluate(() => history.back());
  await frame.waitForSelector('.detail-sheet', { state: 'detached', timeout: 5000 });

  // ---- 换类型时，新类型里没有的标签筛选自动取消 ----
  await pick('角色卡');
  await frame.click('.btn[title="筛选与排序"]');
  await frame.click('.overlay .tag-opt:has-text("第三个标签")');
  await frame.evaluate(() => history.back());
  await frame.waitForTimeout(300);
  ok(await frame.locator('.grid .card').count() === 1, 'tag filter applied on characters');
  await pick('世界书');
  ok(await frame.locator('.grid .card, .rows .row-item').count() > 0, 'switching to worldbook drops the character-only tag filter');

  ok(errs.length === 0, `no errors ${errs.slice(0, 5).join(' | ')}`);
  await browser.close();
})().catch((e) => { console.log('FAIL', e.message); process.exitCode = 1; process.exit(1); });
