// 搜索范围、从角色卡拆出内嵌世界书 / 正则、全屏阅读记住位置
const { chromium } = require('playwright');
const B = 'http://127.0.0.1:5199';
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
let H = {};
const J = async (path) => (await fetch(B + path, { headers: H })).json();
const post = (path, body) => fetch(B + path, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
(async () => {
  const { token } = await (await post('/api/login', { password: 'testpw' })).json();
  H = { Authorization: 'Bearer ' + token };
  const items = (await J('/api/state')).items.filter((i) => i.type === 'character' && !i.deletedAt);
  // 找一张有世界书、正则的卡，和开场白最长的卡
  let card = null; let long = null;
  for (const it of items) {
    const c = await J(`/api/items/${it.id}/content`);
    const d = c.data || {};
    const book = d.character_book?.entries || [];
    const rx = d.extensions?.regex_scripts || [];
    if (!card && book.length && rx.length > 1) card = { it, d, key: book[0].keys[0], bookN: book.length, rxN: rx.length };
    const g = String(d.first_mes || '').length;
    if (!long || g > long.g) long = { it, g };
  }
  ok(card && long, `fixtures: card with book+regex (${card?.it.name}), longest greeting ${long?.g}`);

  // ---- 搜索范围（接口）
  const hit = async (q, scope) => Object.keys((await J(`/api/search?q=${encodeURIComponent(q)}${scope ? `&in=${scope}` : ''}`)).hits);
  const all = await hit(card.key);
  ok(all.includes(card.it.id), 'book keyword found with no scope');
  ok((await hit(card.key, 'book')).includes(card.it.id), 'found when only searching world books');
  ok(!(await hit(card.key, 'name,greet,persona,desc,info')).includes(card.it.id), 'not found when world books are left out');
  ok((await hit(card.it.name, 'name')).includes(card.it.id), 'name scope finds by name');
  ok((await hit(card.key, 'bogus')).length === all.length, 'unknown scope is ignored (same as all)');
  const neg = await hit(`${card.it.name} -${card.key}`, 'name');
  ok(neg.includes(card.it.id), 'excluded word only counts inside the chosen scope');

  // ---- 拆出（接口）
  const r1 = await (await post(`/api/items/${card.it.id}/extract`, { part: 'book', save: true })).json();
  ok(r1.status === 'created' && r1.item.type === 'worldbook' && r1.count === card.bookN, `book saved as a world book item (${r1.item?.type}, ${r1.count})`);
  const wb = await J(`/api/items/${r1.item.id}/content`);
  ok(JSON.stringify(wb).includes(card.key), 'saved world book keeps the entry keyword');
  const r2 = await (await post(`/api/items/${card.it.id}/extract`, { part: 'book', save: true })).json();
  ok(r2.status === 'duplicate' && r2.item.id === r1.item.id, 'extracting again does not make a second copy');
  const dl = await post(`/api/items/${card.it.id}/extract`, { part: 'regex' });
  const arr = await dl.json();
  ok(/attachment/.test(dl.headers.get('content-disposition') || '') && Array.isArray(arr) && arr.length === card.rxN, 'regex downloads as a file with every script');
  const r3 = await (await post(`/api/items/${card.it.id}/extract`, { part: 'regex', save: true })).json();
  ok(r3.status === 'created' && r3.item.type === 'regex', `regex saved as a regex item (${r3.item?.type})`);
  const before = await J(`/api/items/${card.it.id}/content`);
  ok((before.data.character_book?.entries || []).length === card.bookN, 'the card itself is unchanged');
  const none = await post(`/api/items/${r1.item.id}/extract`, { part: 'book' });
  ok(none.status === 400, 'non-card items are refused');

  // ---- 界面
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  const c = await b.newContext({ viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true });
  await c.addInitScript((t) => localStorage.setItem('tv_token', t), token);
  await c.addInitScript(() => { if (!localStorage.getItem('tv_prefs')) localStorage.setItem('tv_prefs', JSON.stringify({ detailTab: 'content', readZoom: 200, cols: 2 })); });
  const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(B + '/#/library'); await p.waitForSelector('.card');
  await p.fill('.search-input', card.key); await p.waitForTimeout(700);
  const shown = () => p.locator('.card').count();
  const n0 = await shown();
  ok(n0 >= 1, `search shows results (${n0})`);
  await p.click('button[title="筛选与排序"]');
  await p.click('.sheet .form-group:has-text("搜索范围") .opt:has-text("名称")'); await p.waitForTimeout(700);
  await p.click('.sheet-foot .btn:has-text("完成")');
  ok(await shown() === 0, 'narrowed to names: the book-only match disappears');
  ok(await p.locator('.active-filters .pill:has-text("只搜：名称")').count() === 1, 'a pill says the search is narrowed');
  ok(JSON.parse(await p.evaluate(() => localStorage.getItem('tv_prefs'))).searchIn.join() === 'name', 'scope remembered on this device');
  await p.click('.active-filters .pill:has-text("只搜")'); await p.waitForTimeout(700);
  ok(await shown() === n0, 'clearing the pill searches everything again');

  // 拆出按钮和对话框
  await p.fill('.search-input', card.it.name); await p.waitForTimeout(600);
  await p.click(`.card:has-text("${card.it.name}")`); await p.waitForSelector('.read-sec');
  await p.click('.read-sec:has-text("内嵌正则") .read-head button:has-text("拆出")');
  await p.waitForSelector('.sheet.choice');
  ok(await p.locator('.sheet.choice .btn:has-text("下载文件")').count() === 1 && await p.locator('.sheet.choice .btn:has-text("存为正则条目")').count() === 1, 'extract dialog offers download and save');
  await p.click('.sheet.choice .btn:has-text("存为正则条目")'); await p.waitForTimeout(600);
  ok((await p.textContent('#toasts')).includes('之前已经拆出过'), 'saving the same regex again reports it already exists');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  // ---- 阅读位置
  await p.goto(B + '/#/library'); await p.waitForSelector('.search-input');
  await p.fill('.search-input', long.it.name); await p.waitForTimeout(600);
  await p.click(`.card:has-text("${long.it.name}")`); await p.waitForSelector('.read-sec');
  const openRead = async () => { await p.click('.read-sec:has-text("开场白") .read-head button:has-text("全屏阅读")'); await p.waitForSelector('.read-sheet .read-full'); await p.waitForTimeout(600); };
  const body = '.read-sheet .sheet-body';
  await openRead();
  // 换成纯文字，高度是确定的
  if (await p.locator('.read-sheet .read-mode .seg-item:has-text("文字")').count()) { await p.click('.read-sheet .read-mode .seg-item:has-text("文字")'); await p.waitForTimeout(300); }
  const max = await p.$eval(body, (e) => e.scrollHeight - e.clientHeight);
  ok(max > 200, `reading page is scrollable (${max})`);
  ok(await p.locator('.read-resume').count() === 0, 'first time: no resume hint');
  await p.$eval(body, (e) => { e.scrollTop = Math.round((e.scrollHeight - e.clientHeight) * 0.5); }); await p.waitForTimeout(600);
  await p.click('.read-sheet .sheet-x'); await p.waitForTimeout(300);
  await openRead();
  const y = await p.$eval(body, (e) => e.scrollTop / (e.scrollHeight - e.clientHeight));
  ok(Math.abs(y - 0.5) < 0.05, `reopened at the same place (${y.toFixed(3)})`);
  ok(await p.locator('.read-resume:has-text("从头读")').count() === 1, 'offers to start over');
  await p.click('.read-resume:has-text("从头读")'); await p.waitForTimeout(500);
  ok(await p.$eval(body, (e) => e.scrollTop) === 0, 'start over goes to the top');
  // 翻到后面一条再关掉：下次从第一条打开时提示上次读到哪条
  if (await p.locator('.read-sheet .sheet-foot .btn:has-text("下一条")').count()) {
    await p.click('.read-sheet .sheet-foot .btn:has-text("下一条")'); await p.waitForTimeout(300);
    await p.click('.read-sheet .sheet-x'); await p.waitForTimeout(300);
    await openRead();
    ok(await p.locator('.read-resume:has-text("上次读到第 2 条")').count() === 1, 'hints which greeting was open last time');
    await p.click('.read-resume:has-text("上次读到第 2 条")'); await p.waitForTimeout(300);
    ok((await p.textContent('.read-sheet .read-count')).trim().startsWith('2 /'), 'the hint jumps there');
  }
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
})();
