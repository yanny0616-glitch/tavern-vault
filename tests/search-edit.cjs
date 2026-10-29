const { chromium } = require('playwright');
const B = 'http://127.0.0.1:5199'; const OUT = process.argv[2];
let fails = 0; const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fails++; };
(async () => {
  const { token } = await (await fetch(B + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'testpw' }) })).json();
  const H = { Authorization: `Bearer ${token}` };
  const preset = { name: '测试预设', temperature: 1, openai_max_context: 1000, prompts: [{ identifier: 'a', name: '提示A', content: 'aaa' }, { identifier: 'b', name: '提示B', content: 'bbb' }, { identifier: 'c', name: '提示C', content: 'ccc' }],
    prompt_order: [{ character_id: 100001, order: [{ identifier: 'b', enabled: true }, { identifier: 'a', enabled: false }] }], extensions: { regex_scripts: [{ scriptName: '附带的正则', findRegex: 'x', replaceString: '<b>y</b>' }] } };
  await fetch(B + '/api/items?filename=' + encodeURIComponent('测试预设.json'), { method: 'POST', headers: H, body: JSON.stringify(preset) });
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  const c = await b.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true });
  await c.addInitScript((t) => { if (window === top) localStorage.setItem('tv_token', t); }, token);
  const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(B + '/#/library'); await p.waitForSelector('.card');
  // 全文搜索
  await p.fill('.search-input', '刑侦卷宗'); await p.waitForSelector('.search-hit', { timeout: 5000 });
  const hit = await p.$eval('.search-hit', (e) => e.textContent);
  ok(/内嵌正则/.test(hit) && (await p.$$('.card')).length === 1, 'deep hit shown: ' + hit.slice(0, 60));
  ok(await p.$('.search-hit mark') !== null, 'snippet highlight present');
  await p.screenshot({ path: OUT + '/search-grid.png' });
  await p.fill('.search-input', '程砚 -刑侦'); await p.waitForTimeout(700);
  ok((await p.$$('.card')).length === 0, 'exclude term removes card');
  await p.fill('.search-input', ''); await p.waitForTimeout(400);
  ok(await p.$('.search-hit') === null && await p.$('.card-title mark') === null, 'highlight cleared when search empty');
  // 列表视图
  await p.click('button[title="切换视图"]'); await p.fill('.search-input', '刑侦卷宗'); await p.waitForSelector('.row-item .search-hit');
  await p.screenshot({ path: OUT + '/search-rows.png' });
  await p.click('button[title="切换视图"]'); await p.fill('.search-input', '');
  // 预设顺序
  await p.fill('.search-input', '测试预设'); await p.waitForTimeout(500);
  // 仓库每次只看一种类型：当前类型里没有，点提示去「预设」
  await p.click('.empty .btn:has-text("看预设")'); await p.click('.card'); await p.waitForSelector('.detail-sheet');
  await p.click('.tabs button:has-text("内容")'); await p.waitForSelector('.fold.entry');
  const rows = await p.$$eval('.fold.entry', (a) => a.map((x) => x.querySelector('.fold-title').textContent + (x.classList.contains('off') ? '(off)' : '') + ([...x.querySelectorAll('.chip-s')].map((c) => c.textContent).join(''))));
  ok(rows.slice(0, 3).join(',') === '提示B,提示A(off)关闭,提示C(off)未加入', 'preset shown in effective order: ' + rows.join(','));
  ok(await p.$('summary:has-text("附带正则")') !== null, 'preset regex section');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  // 编辑防丢稿
  await p.fill('.search-input', '程砚'); await p.waitForTimeout(500); if (await p.$('.empty .btn:has-text("看角色卡")')) await p.click('.empty .btn:has-text("看角色卡")'); await p.click('.card'); await p.waitForSelector('.detail-sheet');
  await p.click('button[title="更多操作"]');
  await p.click('text=编辑角色卡内容'); await p.waitForSelector('.sheet textarea');
  const ta = (await p.$$('.sheet.full textarea'))[0];
  await ta.fill('改过的描述 DRAFTTEST'); await p.waitForTimeout(800);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  ok(await p.$('.sheet.dialog:has-text("有还没保存的修改")') !== null, 'esc asks before discarding');
  await p.click('.sheet.dialog button:has-text("取消")'); await p.waitForTimeout(200);
  ok(await p.$('text=编辑 · 程砚') !== null, 'edit sheet still open after cancel');
  // 刷新页面（模拟意外关闭）后再打开，提示恢复
  await p.reload(); await p.waitForSelector('.card');
  await p.fill('.search-input', '程砚'); await p.waitForTimeout(500); if (await p.$('.empty .btn:has-text("看角色卡")')) await p.click('.empty .btn:has-text("看角色卡")'); await p.click('.card'); await p.waitForSelector('.detail-sheet');
  await p.click('button[title="更多操作"]');
  await p.click('text=编辑角色卡内容'); await p.waitForSelector('.sheet.dialog:has-text("恢复")', { timeout: 5000 });
  await p.screenshot({ path: OUT + '/draft.png' });
  await p.click('.sheet.dialog button:has-text("恢复")'); await p.waitForTimeout(300);
  ok((await (await p.$$('.sheet.full textarea'))[0].inputValue()) === '改过的描述 DRAFTTEST', 'draft restored');
  await p.locator('.sheet.full .sheet-x').last().click(); await p.waitForSelector('.sheet.dialog'); await p.click('.sheet.dialog button:has-text("放弃修改")'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('tv_draft')).length) === 0, 'draft removed after discard');
  console.log(errs.length ? 'ERR ' + errs.join(' | ') : 'no page errors');
  await b.close(); process.exit(fails ? 1 : 0);
})();
