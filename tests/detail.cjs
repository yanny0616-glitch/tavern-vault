const { chromium } = require('playwright');
const B = 'http://127.0.0.1:5199'; const SP = process.argv[2];
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const item = async (n) => (await (await fetch(B + '/api/state')).json()).items.find((i) => i.name === n);
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  const c = await b.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true });
  const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(B + '/#/library'); await p.waitForSelector('.card');
  // 每行 3 个
  await p.click('button[title="筛选与排序"]');
  await p.click('.sheet .opt:has-text("3 个")');
  await p.click('.sheet-foot button:has-text("完成")');
  const cols = await p.evaluate(() => getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length);
  ok(cols === 3, `3 per row → ${cols} columns`);
  await p.screenshot({ path: `${SP}/cols3.png` });
  // 编辑资料
  await p.click('.card:has-text("白夜")'); await p.waitForSelector('.detail-sheet');
  const before = await item('白夜');
  await p.click('.sheet-foot button:has-text("编辑资料")');
  await p.waitForSelector('.edit-sheet');
  await p.fill('.edit-sheet textarea[placeholder^="一句话"]', '新的简介');
  await p.fill('.edit-sheet input[placeholder="输入标签，回车添加"]', '测试标签'); await p.keyboard.press('Enter');
  await p.locator('.edit-sheet .tag-sug').first().click();
  ok(JSON.stringify(await item('白夜')) === JSON.stringify(before), 'nothing saved before 保存');
  // 取消时提示
  await p.click('.edit-sheet .sheet-foot button:has-text("取消")');
  await p.waitForSelector('.sheet.dialog');
  await p.click('.sheet.dialog .sheet-foot button:not(:has-text("放弃"))');
  ok(await p.locator('.edit-sheet').count() === 1, 'cancel asks before discarding');
  await p.click('.edit-sheet .sheet-foot button:has-text("保存")');
  await p.waitForSelector('.edit-sheet', { state: 'detached' });
  await p.waitForTimeout(400);
  const after = await item('白夜');
  ok(after.description === '新的简介' && after.tags.includes('测试标签') && after.tags.length === before.tags.length + 2, `saved: ${after.description} / ${after.tags}`);
  ok(await p.locator('.detail-sheet .lead:has-text("新的简介")').count() === 1 && await p.locator('.hero-tags .tag:has-text("测试标签")').count() === 1, 'preview updated');
  // 点标签 → 仓库按标签筛选
  await p.click('.hero-tags .tag:has-text("测试标签")');
  await p.waitForSelector('.detail-sheet', { state: 'detached' });
  ok(await p.locator('.pill:has-text("测试标签")').count() === 1 && await p.locator('.card').count() === 1, 'tag click filters library');
  // 更多菜单
  await p.click('.card:has-text("白夜")'); await p.click('.head-extra button');
  await p.waitForSelector('.menu-item:has-text("编辑角色卡内容")');
  ok(true, 'more menu');
  console.log(errs.join('\n') || 'no errors'); await b.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
