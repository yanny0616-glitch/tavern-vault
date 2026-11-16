// 聊天记录导入时猜角色卡、抽卡记录、对比后逐项合并、世界书插入位置、统计清库存、智能合集、批量改名改作者
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path'); const os = require('os');
const B = 'http://127.0.0.1:5199';
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const J = async (p) => (await fetch(B + p)).json();
const send = (method, p, body) => fetch(B + p, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const upload = async (name, text) => (await fetch(`${B}/api/items?filename=${encodeURIComponent(name)}&mode=new`, { method: 'POST', body: Buffer.from(text) })).json();
const card = (name, extra) => JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: { name, description: `${name}的描述`, personality: '', scenario: '', first_mes: `${name}的开场白`, mes_example: '', creator: '虚构作者', tags: [], alternate_greetings: [], ...extra } });
const item = async (id) => (await J('/api/state')).items.find((i) => i.id === id);
let page = null;
(async () => {
  const book = (content) => ({ name: '', entries: [{ id: 0, keys: ['灯塔'], secondary_keys: [], comment: '灯塔', content, enabled: true, insertion_order: 100, position: 'before_char', extensions: {} }], extensions: {} });
  const A = (await upload('合并甲.json', card('合并甲', { character_book: book('甲的灯塔') }))).item;
  const Bc = (await upload('合并乙.json', card('合并乙', { scenario: '乙独有的场景', character_book: book('乙的灯塔') }))).item;
  ok(A?.type === 'character' && Bc?.type === 'character', 'fixtures: two cards');

  // ---- 打开记录
  const before = await item(A.id);
  ok(!before.openedAt, 'a new item has never been opened');
  const op = await (await send('POST', `/api/items/${A.id}/opened`)).json();
  const after = await item(A.id);
  ok(op.opens === 1 && after.openedAt && after.updatedAt === before.updatedAt, 'opening is recorded without touching the update time');

  // ---- 批量改名、改作者（接口）
  await send('POST', '/api/batch', { ids: [A.id, Bc.id], action: 'rename', value: { find: '合并', replace: '并', prefix: '【测】', suffix: '' } });
  ok((await item(A.id)).name === '【测】并甲' && (await item(Bc.id)).name === '【测】并乙', 'batch rename: find/replace then prefix');
  await send('POST', '/api/batch', { ids: [A.id], action: 'rename', value: { find: '【测】并甲', replace: '' } });
  ok((await item(A.id)).name === '【测】并甲', 'a rename that would leave an empty name is skipped');
  await send('POST', '/api/batch', { ids: [A.id, Bc.id], action: 'rename', value: { find: '【测】并', replace: '合并' } });
  await send('POST', '/api/batch', { ids: [A.id, Bc.id], action: 'setAuthor', value: '  新作者 ' });
  ok((await item(A.id)).author === '新作者' && (await item(Bc.id)).author === '新作者', 'batch author');

  // ---- 智能合集（接口）
  await send('PATCH', `/api/items/${A.id}`, { tags: ['古风', '慢热'], rating: 5 });
  await send('PATCH', `/api/items/${Bc.id}`, { tags: ['古风'], rating: 3 });
  const sc = await (await send('POST', '/api/collections', { name: '高分古风', rule: { tagsIn: ['古风', ' 古风 '], tagsOut: ['古风', '现代'], minRating: 4, type: 'nope', junk: 1 } })).json();
  ok(JSON.stringify(sc.rule) === JSON.stringify({ tagsIn: ['古风'], tagsOut: ['现代'], minRating: 4 }), `rule cleaned (${JSON.stringify(sc.rule)})`);
  const mc = await (await send('POST', '/api/collections', { name: '手动的', rule: {} })).json();
  ok(!('rule' in mc), 'an empty rule makes an ordinary collection');
  await send('POST', '/api/batch', { ids: [A.id, Bc.id], action: 'addCollection', value: mc.id });
  await send('PATCH', `/api/collections/${mc.id}`, { rule: { fav: true } });
  ok(!(await item(A.id)).collections.includes(mc.id), 'turning a collection smart drops its hand-picked members');
  await send('PATCH', `/api/collections/${mc.id}`, { rule: null });
  ok(!('rule' in (await J('/api/state')).collections.find((c) => c.id === mc.id)), 'and the rule can be removed again');

  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  const c = await b.newContext({ viewport: { width: 1200, height: 900 } });
  await c.addInitScript(() => { if (!localStorage.getItem('tv_prefs')) localStorage.setItem('tv_prefs', JSON.stringify({ detailTab: 'content', detailTabOther: 'content' })); });
  const p = await c.newPage(); page = p; const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const typeTab = async (label) => { await p.click(`.seg-item:has-text("${label}")`); await p.waitForTimeout(300); };
  const lib = async (label) => { await p.goto(B + '/#/library'); await p.reload(); await p.waitForSelector('.seg-item'); if (label) await typeTab(label); };

  // ---- 智能合集（界面）
  await p.goto(B + '/#/collections'); await p.waitForSelector('.shelf');
  ok((await p.textContent('.shelf:has-text("高分古风")')).includes('1 件') && await p.locator('.shelf:has-text("高分古风") .shelf-auto').count() === 1, 'smart shelf counts matching items and is marked automatic');
  await p.click('.topbar .btn:has-text("新建")'); await p.waitForSelector('.sheet .rule-switch');
  await p.fill('.sheet input[placeholder="合集名称"]', '古风全部');
  await p.click('.sheet .rule-switch .switch'); await p.waitForSelector('.rule-box .rule-type');
  await p.click('.sheet-foot .btn:has-text("保存")'); await p.waitForTimeout(300);
  ok(await p.locator('.sheet .rule-box').count() === 1, 'a smart collection needs at least one condition');
  await p.click('.rule-tags .btn'); await p.waitForSelector('.sheet:has-text("条件里的标签") .tag-opt');
  await p.click('.sheet:has-text("条件里的标签") .tag-opt:has-text("古风")');
  await p.click('.sheet:has-text("条件里的标签") .sheet-foot .btn:has-text("确定")'); await p.waitForTimeout(300);
  ok((await p.textContent('.rule-hit')).includes('2 件'), `live count of matches (${await p.textContent('.rule-hit')})`);
  await p.click('.sheet-foot .btn:has-text("保存")'); await p.waitForTimeout(700);
  await p.click('.shelf:has-text("古风全部")'); await p.waitForSelector('.card, .row-item');
  ok(await p.locator('.card').count() === 2, 'opening the smart shelf lists the matching items');
  await send('PATCH', `/api/items/${Bc.id}`, { tags: [] }); await p.waitForTimeout(900);
  ok(await p.locator('.card').count() === 1, 'an item leaves by itself when it no longer matches');
  await send('PATCH', `/api/items/${Bc.id}`, { tags: ['古风'] });

  // ---- 批量改名（界面）
  await lib('角色卡');
  await p.click('button[title="多选"]');
  await p.click('.card:has-text("合并甲")'); await p.click('.card:has-text("合并乙")');
  await p.click('.selbar :text("更多")'); await p.click('.menu-item:has-text("批量改名")'); await p.waitForSelector('.rename-preview');
  ok(await p.locator('.sheet-foot .btn:has-text("改名")').isDisabled(), 'nothing to do until something changes');
  await p.fill('.sheet input[placeholder="加在最后面"]', ' v2'); await p.waitForTimeout(150);
  ok((await p.textContent('.rename-preview')).includes('会改 2 项') && (await p.textContent('.rename-row >> nth=0')).includes('v2'), 'preview shows the new names');
  await p.fill('.sheet input[placeholder="加在最后面"]', ''); await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  // ---- 对比后逐项合并
  await p.click('.selbar :text("更多")'); await p.click('.menu-item:has-text("并排对比")'); await p.waitForSelector('.cmp-row.diff');
  await p.click('.cmp-foot .btn:has-text("逐项合并")'); await p.waitForSelector('.cmp-pick');
  const labels = await p.locator('.merging .cmp-row.diff .cmp-label').allTextContents();
  ok(['描述', '场景', '主开场白', '内嵌世界书'].every((l) => labels.includes(l)), `rows that differ can be picked, including a book with the same titles (${labels})`);
  const left = (await p.textContent('.cmp-head .cmp-cell >> nth=0')).includes('合并甲') ? 0 : 1;
  const tgt = left === 0 ? A : Bc; const other = left === 0 ? Bc : A;
  ok(await p.locator('.cmp-head .cmp-cell >> nth=0').locator('.cmp-target.active').count() === 1 && await p.locator('.cmp-pick.on').count() === labels.length, 'starts with everything kept from the card being saved to');
  for (const l of ['场景', '内嵌世界书']) await p.locator(`.merging .cmp-row:has(.cmp-label:text-is("${l}")) .cmp-pick`).nth(1).click();
  await p.click('.cmp-foot .btn:has-text("保存合并结果")'); await p.waitForTimeout(1200);
  const td = (await J(`/api/items/${tgt.id}/content`)).data; const od = (await J(`/api/items/${other.id}/content`)).data;
  ok(td.scenario === od.scenario && td.character_book.entries[0].content === od.character_book.entries[0].content && td.description !== od.description && td.first_mes !== od.first_mes, 'picked fields come from the other card, the rest stay');
  ok((await item(tgt.id)).files.length === 2 && (await item(other.id)).files.length === 1, 'saved as a new version of the chosen card only');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  // ---- 世界书插入位置
  await lib('角色卡');
  await p.click(`.card:has-text("${tgt.name}")`); await p.waitForSelector('.detail-sheet');
  await p.locator('.detail-sheet .tabs button:has-text("内容")').click(); await p.waitForTimeout(400);
  await p.click('.detail-sheet button[title="更多操作"]');
  await p.click('.menu-item:has-text("编辑内嵌世界书")'); await p.waitForSelector('.book-edit-item');
  await p.click('.book-edit-toggle'); await p.waitForSelector('.book-pos');
  ok(await p.locator('.book-pos').inputValue() === '0' && await p.locator('.book-depth').count() === 0, 'position read from the card style (before_char)');
  await p.selectOption('.book-pos', '4'); await p.waitForSelector('.book-depth');
  await p.fill('.book-depth', '2'); await p.waitForTimeout(100);
  await p.click('.sheet-foot .btn:has-text("保存")'); await p.waitForTimeout(1200);
  const e1 = (await J(`/api/items/${tgt.id}/content`)).data.character_book.entries[0];
  ok(e1.extensions.position === 4 && e1.extensions.depth === 2 && e1.position === 'after_char', `depth position saved the way cards store it (${JSON.stringify([e1.position, e1.extensions])})`);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  ok((await item(tgt.id)).opens >= 1, 'opening the detail page was recorded');

  // 独立世界书：数字位置
  const wbUp = (await upload('位置测试.json', JSON.stringify({ entries: { 0: { uid: 0, key: ['海'], keysecondary: [], comment: '海', content: '海的设定', constant: false, selective: true, order: 100, position: 1, disable: false } } }))).item;
  await lib('世界书');
  await p.click('.card:has-text("位置测试"), .row-item:has-text("位置测试")'); await p.waitForSelector('.reader-tools .btn:has-text("编辑条目")');
  await p.click('.reader-tools .btn:has-text("编辑条目")'); await p.waitForSelector('.book-edit-item');
  await p.click('.book-edit-toggle'); await p.waitForSelector('.book-pos');
  ok(await p.locator('.book-pos').inputValue() === '1', 'numeric position read from a world-book file');
  await p.selectOption('.book-pos', '4'); await p.waitForSelector('.book-depth'); await p.fill('.book-depth', '6');
  await p.click('.sheet-foot .btn:has-text("保存")'); await p.waitForTimeout(1000);
  const w1 = (await J(`/api/items/${wbUp.id}/content`)).data.entries[0];
  ok(w1.position === 4 && w1.depth === 6 && !w1.extensions, 'saved as number + depth in the file style');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  // ---- 导入聊天记录时猜角色卡
  const chat = [JSON.stringify({ user_name: '阿雪', character_name: other.name }), JSON.stringify({ name: other.name, is_user: false, mes: '你好' })].join('\n');
  const tmp = path.join(os.tmpdir(), `聊天猜卡-${Date.now()}.jsonl`); fs.writeFileSync(tmp, chat);
  await lib('角色卡');
  await p.click('.topbar .btn:has-text("添加")'); await p.waitForSelector('.drop');
  await p.setInputFiles('.drop input[type=file]:not([webkitdirectory])', [tmp]);
  await p.waitForSelector('.import-row .btn:has-text("绑定这张卡")', { timeout: 8000 });
  ok((await p.textContent('.import-row')).includes(`像是「${other.name}」的聊天记录`), 'importer guesses the card from the name in the chat log');
  await p.click('.import-row .btn:has-text("绑定这张卡")'); await p.waitForTimeout(800);
  const chatItem = (await J('/api/state')).items.find((i) => i.type === 'chat' && i.name.startsWith('聊天猜卡'));
  ok(chatItem?.chatOf === other.id && (await p.textContent('.import-row')).includes('已绑定到角色卡'), 'one click binds it');
  fs.rmSync(tmp, { force: true });
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  // ---- 抽卡记录
  await lib('角色卡');
  await p.evaluate(() => localStorage.removeItem('tv_draws'));
  const total = await p.locator('.card').count();
  await p.click('button[title="抽一张"]'); await p.waitForSelector('.draw-empty');
  await p.click('.draw-opts .switch'); await p.waitForTimeout(100);
  const names = [];
  for (let i = 0; i < total; i++) { await p.click('.sheet .btn:has-text("随便抽一张"), .sheet .btn:has-text("就这一个")'); await p.waitForTimeout(100); names.push(await p.textContent('.draw-card b')); }
  ok(new Set(names).size === total, `every card once (${total})`);
  await p.click('.sheet .btn:has-text("随便抽一张"), .sheet .btn:has-text("就这一个")'); await p.waitForTimeout(150);
  ok((await p.textContent('.draw-out')).includes('今天都抽过了') && await p.evaluate(() => JSON.parse(localStorage.getItem('tv_draws')).length) === total, 'with the switch on, cards drawn today do not come up again');
  await p.click('.draw-opts .btn:has-text("抽卡记录")'); await p.waitForSelector('.draw-log-row');
  ok(await p.locator('.draw-log-row').count() === total && (await p.textContent('.draw-day .sub-label')).includes(`今天 · ${total} 张`), 'history lists what was drawn, grouped by day');
  await p.click('.draw-log-row >> nth=0'); await p.waitForSelector('.detail-sheet');
  ok(true, 'a history row opens the item');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  // ---- 统计：清库存
  await p.goto(B + '/#/stats'); await p.waitForSelector('.stat-clean');
  const st = (await J('/api/state')).items.filter((i) => !i.deletedAt);
  const un = st.filter((i) => !i.openedAt).length;
  ok((await p.textContent('.stat-clean .clean-act >> nth=0')).includes(String(un)) && (await p.textContent('.stat-new h3')).includes(String(st.length)), `shows how many were never opened (${un}) and how many are new`);
  ok(await p.locator('.stat-toptags .bar-row').count() >= 1 && (await p.textContent('.stat-toptags .bars')).includes('古风'), 'top tags as bars');
  await p.click('.stat-clean .clean-act >> nth=0'); await p.waitForSelector('.seg-item'); await p.waitForTimeout(400);
  ok((await p.textContent('.page, body')).includes('没打开过'), 'jumps to the library with the filter on');

  ok(!errs.length, `no page errors ${errs.join(' | ')}`);
  await b.close();
})().catch(async (e) => { console.log('FAIL crashed', e.message.split('\n').slice(0, 4).join(' / ')); if (page) await page.screenshot({ path: __dirname + '/.work/logs/merge-smart-stats-crash.png' }).catch(() => {}); process.exit(1); });
