// 插件和酒馆当前状态的联动：跳到正在聊的卡、改动提醒、新版本提醒、聊天归档、主题套用、抽卡开聊、换世界书
const { chromium } = require('playwright');
const V = 'http://127.0.0.1:5199';
const M = 'http://127.0.0.1:5198';
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const j = async (u, o) => (await fetch(u, o)).json();
const post = (u, body) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const items = async () => (await j(`${V}/api/state`)).items;
const upload = async (name, text) => (await fetch(`${V}/api/items?filename=${encodeURIComponent(name)}&mode=new`, { method: 'POST', body: Buffer.from(text) })).json();
const G = {};
(async () => {
  // ---- 接口：比对状态
  const lily = { spec: 'chara_card_v2', data: { name: '酒馆里的莉莉', description: '来自酒馆的角色', first_mes: '你好', creator: 'ST用户', tags: ['酒馆'] } };
  let r = await (await post(`${V}/api/tavern/status`, { kind: 'character', name: '酒馆里的莉莉', data: lily })).json();
  ok(r.status === 'new', 'a card the vault does not have is new');
  ok((await post(`${V}/api/tavern/status`, { kind: 'preset', name: 'x', data: {} })).status === 400, 'only cards and worldbooks are compared');

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 860 } });
  const page = await ctx.newPage(); G.page = page;
  const errs = []; G.errs = errs;
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  const shot = (n) => page.screenshot({ path: `${process.argv[2]}/${n}.png` });
  await page.goto(M + '/');
  await page.fill('#tv-url', 'http://localhost:5199');
  await page.click('#tv-connect');
  await page.waitForFunction(() => /已连接|失败/.test(document.querySelector('#tv-status').textContent));
  const notices = () => page.evaluate(() => window.__notices.map((n) => ({ kind: n.kind, msg: n.msg, can: Boolean(n.click) })));
  const setChat = (avatar, chatId, chat = []) => page.evaluate(([a, id, c]) => { const i = SillyTavern.getContext().characters.findIndex((x) => x.avatar === a); window.__st.characterId = i < 0 ? undefined : i; window.__st.chatId = id; window.__st.chat = c; }, [avatar, chatId, chat]);

  // ---- 设置项
  ok(await page.isChecked('#tv-jump') && await page.isChecked('#tv-updates') && await page.inputValue('#tv-sync') === 'ask' && await page.inputValue('#tv-chats') === 'off', 'defaults: jump on, remind on, chats off');

  // ---- 1. 打开卡匣：正在聊的卡还没收藏 → 问要不要收藏
  await setChat('lily.png', 'lily - 2026-01-12');
  await page.click('#tv-menu-item');
  const frame = await (await page.waitForSelector('#tv-panel iframe')).contentFrame();
  await frame.waitForSelector('.toast.act');
  ok(/酒馆里的莉莉/.test(await frame.locator('.toast.act').innerText()) && /还没收进卡匣/.test(await frame.locator('.toast.act').innerText()), 'opening the vault mentions the card being chatted with');
  await frame.click('.toast.act .toast-btn');
  await frame.waitForSelector('.detail-sheet');
  const L = (await items()).find((i) => i.name === '酒馆里的莉莉');
  ok(L && L.type === 'character' && L.origin === 'tavern', 'one tap collects it and opens it');
  await shot('collected');
  await frame.locator('.detail-sheet .sheet-x').click();
  await page.evaluate(() => document.querySelector('#tv-panel [data-act="close"]')?.click() || document.querySelector('#tv-panel').classList.remove('open'));

  // 换一张已经在卡匣里的卡 → 再打开直接跳到详情
  const other = (await items()).find((i) => i.type === 'character' && i.id !== L.id);
  await post(`${M}/api/characters/import-nope`, {});
  await page.evaluate(async ([name]) => { const c = SillyTavern.getContext(); c.characters.push({ avatar: 'other.png', name, shallow: true, data: {} }); }, [other.name]);
  await setChat('other.png', 'x');
  await page.click('#tv-menu-item');
  await frame.waitForFunction((n) => document.querySelector('.detail-sheet')?.textContent.includes(n), other.name);
  ok(true, 'reopening with another card jumps to its detail');
  await frame.locator('.detail-sheet .sheet-x').click();
  // 关掉开关就不跳
  await page.evaluate(() => { document.querySelector('#tv-panel').classList.remove('open'); const el = document.getElementById('tv-jump'); el.checked = false; el.dispatchEvent(new Event('change')); });
  await setChat('lily.png', 'lily - 2026-01-12');
  await page.click('#tv-menu-item');
  await page.waitForTimeout(700);
  ok(await frame.locator('.detail-sheet').count() === 0, 'with the option off nothing jumps');
  await page.evaluate(() => document.querySelector('#tv-panel').classList.remove('open'));

  // ---- 2. 酒馆里改了卡 → 提醒，点一下存成新版本
  r = await (await post(`${V}/api/tavern/status`, { kind: 'character', name: '酒馆里的莉莉', data: lily })).json();
  ok(r.status === 'synced' && r.itemId === L.id, 'a freshly collected card is in sync');
  await page.evaluate(() => { window.__notices.length = 0; });
  await page.evaluate(() => window.__cardbox.checkCurrent());
  ok((await notices()).length === 0, 'nothing to say when both sides match');
  await fetch(`${M}/__edit?q=${encodeURIComponent(JSON.stringify({ avatar: 'lily.png', description: '在酒馆里改过的描述' }))}`);
  await page.evaluate(() => window.__cardbox.checkCurrent());
  let ns = await notices();
  ok(ns.length === 1 && /改过了/.test(ns[0].msg) && ns[0].can, `an edit in the tavern is noticed (${JSON.stringify(ns)})`);
  await page.evaluate(() => window.__cardbox.checkCurrent());
  ok((await notices()).length === 1, 'the same edit is only mentioned once');
  await page.evaluate(() => window.__click(0));
  await page.waitForFunction(() => window.__notices.some((n) => n.kind === 'success'));
  let it = (await items()).find((i) => i.id === L.id);
  ok(it.files.length === 2 && /酒馆里改的/.test(it.files.find((f) => f.primary).label), 'tapping it stores a new version in the vault');
  await page.evaluate(() => { window.__notices.length = 0; });
  await page.evaluate(() => window.__cardbox.checkCurrent());
  ok((await notices()).length === 0, 'and then both sides match again');
  // 自动模式
  await page.selectOption('#tv-sync', 'auto');
  await fetch(`${M}/__edit?q=${encodeURIComponent(JSON.stringify({ avatar: 'lily.png', description: '又改了一次' }))}`);
  await page.evaluate(() => window.__cardbox.checkCurrent());
  await page.waitForFunction(() => window.__notices.some((n) => n.kind === 'success'));
  it = (await items()).find((i) => i.id === L.id);
  ok(it.files.length === 3, 'auto mode stores the new version without asking');
  // 不管
  await page.selectOption('#tv-sync', 'off');
  await page.evaluate(() => { document.getElementById('tv-updates').checked = false; document.getElementById('tv-updates').dispatchEvent(new Event('change')); window.__notices.length = 0; });
  await fetch(`${M}/__edit?q=${encodeURIComponent(JSON.stringify({ avatar: 'lily.png', description: '第三次' }))}`);
  await page.evaluate(() => window.__cardbox.checkCurrent());
  ok((await notices()).length === 0 && (await items()).find((i) => i.id === L.id).files.length === 3, 'off means off');
  await fetch(`${M}/__edit?q=${encodeURIComponent(JSON.stringify({ avatar: 'lily.png', description: '又改了一次' }))}`);

  // ---- 7. 卡匣里有新版本 → 提醒更新酒馆
  await page.evaluate(() => { document.getElementById('tv-updates').checked = true; document.getElementById('tv-updates').dispatchEvent(new Event('change')); });
  const cc = await j(`${V}/api/items/${L.id}/content`);
  await fetch(`${V}/api/items/${L.id}/card`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ card: { ...cc.card, data: { ...cc.data, description: '卡匣里的新描述' } } }) });
  await page.evaluate(() => window.__cardbox.checkCurrent());
  ns = await notices();
  ok(ns.length === 1 && /新版本/.test(ns[0].msg), `a newer version in the vault is announced (${JSON.stringify(ns)})`);
  await page.evaluate(() => window.__click(0));
  await page.waitForFunction(() => window.__notices.some((n) => n.kind === 'success'));
  ok((await j(`${M}/__state`)).chars['lily.png'].data.description === '卡匣里的新描述', 'tapping it updates the card in the tavern, same avatar');

  // 世界书改了
  const wb = (await j(`${M}/__state`)).worlds['酒馆世界书'];
  await upload('酒馆世界书.json', JSON.stringify(wb));
  const W = (await items()).find((i) => i.name === '酒馆世界书');
  await page.selectOption('#tv-sync', 'ask');
  await page.evaluate(() => { window.__notices.length = 0; });
  await post(`${M}/__setworld`, { name: '酒馆世界书', entry: 0, patch: { content: '酒馆搬到城西了' } });
  await page.evaluate(() => window.__cardbox.checkWorld('酒馆世界书'));
  ns = await notices();
  ok(ns.length === 1 && /世界书「酒馆世界书」/.test(ns[0].msg), 'an edited worldbook is noticed too');
  await page.evaluate(() => window.__click(0));
  await page.waitForFunction(() => window.__notices.some((n) => n.kind === 'success'));
  ok((await items()).find((i) => i.id === W.id).files.length === 2, 'and stored as a new version');

  // ---- 4. 聊天归档
  const chat = [{ name: '酒馆里的莉莉', is_user: false, mes: '你好', send_date: '2026-01-12' }, { name: '我', is_user: true, mes: '你好呀' }, { name: '酒馆里的莉莉', is_user: false, mes: '今天想去哪？' }];
  await setChat('lily.png', 'lily - 2026-01-12', chat);
  await page.evaluate(() => window.__emit('MESSAGE_RECEIVED'));
  ok(await page.evaluate(() => window.__cardbox.flushChat()) === null, 'chats are not stored unless switched on');
  await page.selectOption('#tv-chats', 'idle');
  await setChat('lily.png', 'lily - 2026-01-12', chat.slice(0, 1));
  await page.evaluate(() => window.__emit('MESSAGE_RECEIVED'));
  ok(await page.evaluate(() => window.__cardbox.flushChat()) === null, 'a chat with only the greeting is not stored');
  await setChat('lily.png', 'lily - 2026-01-12', chat);
  await page.evaluate(() => window.__emit('MESSAGE_RECEIVED'));
  r = await page.evaluate(() => window.__cardbox.flushChat());
  let C = (await items()).find((i) => i.type === 'chat' && i.tavernChat);
  ok(r?.status === 'created' && r.bound && C?.chatOf === L.id && C.meta?.messages === 3, `the chat is stored and bound to its card (${JSON.stringify(r)})`);
  await setChat('lily.png', 'lily - 2026-01-12', [...chat, { name: '我', is_user: true, mes: '去渡口' }]);
  await page.evaluate(() => window.__emit('MESSAGE_SENT'));
  // 切走聊天时马上存
  await page.evaluate(() => window.__emit('CHAT_CHANGED'));
  await page.waitForTimeout(600);
  const chats = (await items()).filter((i) => i.type === 'chat' && i.tavernChat);
  C = chats[0];
  ok(chats.length === 1 && C.files.length === 1 && C.meta?.messages === 4, 'the same chat is updated in place: one item, one file');
  await setChat('lily.png', 'lily - 2026-01-12', [...chat, { name: '我', is_user: true, mes: '去渡口' }]);
  await page.evaluate(() => window.__emit('MESSAGE_EDITED'));
  ok((await page.evaluate(() => window.__cardbox.flushChat()))?.status === 'same', 'unchanged content is not stored again');
  await fetch(`${V}/api/items/${C.id}`, { method: 'DELETE' });
  await page.evaluate(() => window.__emit('MESSAGE_EDITED'));
  ok((await page.evaluate(() => window.__cardbox.flushChat()))?.status === 'skipped', 'a chat deleted in the vault is not brought back');
  await page.selectOption('#tv-chats', 'off');

  // ---- 5. 主题：在酒馆里用这套
  const T = (await upload('夜航.json', JSON.stringify({ name: '夜航', main_text_color: 'rgba(230,230,240,1)', blur_strength: 8, chat_display: 1 }))).item;
  await page.evaluate(() => { document.getElementById('tv-jump').checked = false; });
  await page.click('#tv-menu-item');
  await frame.evaluate((id) => { const q = new URLSearchParams(location.hash.split('?')[1] || ''); q.set('item', id); location.hash = `#/library?${q}`; location.reload(); }, T.id);
  const f2 = await (await page.waitForSelector('#tv-panel iframe')).contentFrame();
  await f2.waitForSelector('.detail-sheet');
  await f2.locator('.detail-sheet .tabs button:has-text("内容")').click();
  await f2.waitForSelector('.st-theme-apply');
  await shot('theme-apply');
  await f2.click('.st-theme-apply');
  await page.waitForFunction(() => window.__theme === '夜航');
  ok(await page.evaluate(() => window.__imported?.blur_strength === 8 && !document.querySelector('#tv-panel').classList.contains('open')), 'the theme is imported through the tavern, selected, and the vault gets out of the way');
  await page.evaluate(() => { window.__theme = ''; window.__imported = null; });
  await page.click('#tv-menu-item');
  await f2.click('.st-theme-apply');
  await page.waitForFunction(() => window.__theme === '夜航');
  ok(await page.evaluate(() => window.__imported === null), 'a theme the tavern already has is just switched to, not imported twice');

  // ---- 3. 世界书套装 → 酒馆里绑定的世界书
  const book = (name, texts) => ({ name, extensions: {}, entries: texts.map((t, i) => ({ id: i, keys: [t], secondary_keys: [], comment: t, content: `${t}的内容`, enabled: true, insertion_order: 100, position: 'before_char', extensions: {} })) });
  await fetch(`${V}/api/items/${L.id}/card`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ card: { ...cc.card, data: { ...cc.data, character_book: book('原版', ['灯塔']) } } }) });
  await post(`${V}/api/items/${L.id}/booksets`, { from: 'current', name: '原版' });
  await post(`${V}/api/items/${L.id}/booksets`, { book: { entries: { 0: { uid: 0, key: ['剑'], content: '剑的内容', comment: '剑' }, 1: { uid: 1, key: ['盾'], content: '盾的内容', comment: '盾' } } }, name: '战斗线' });
  const w = await j(`${V}/api/items/${L.id}/booksets/current/world`);
  ok(w.name === '酒馆里的莉莉 - 原版' && w.world.entries[0].key[0] === '灯塔' && w.world.entries[0].uid === 0 && w.count === 1, `a set is handed out as a tavern world file (${JSON.stringify(w).slice(0, 160)})`);
  await page.click('#tv-menu-item');
  await f2.evaluate((id) => { const q = new URLSearchParams(location.hash.split('?')[1] || ''); q.set('item', id); location.hash = `#/library?${q}`; location.reload(); }, L.id);
  const f3 = await (await page.waitForSelector('#tv-panel iframe')).contentFrame();
  await f3.waitForSelector('.detail-sheet');
  await f3.locator('.detail-sheet .tabs button:has-text("内容")').click();
  await f3.click('.card-booksets');
  await f3.waitForSelector('.bookset-tavern');
  await shot('booksets-tavern');
  await f3.click('.bookset-row:has-text("战斗线") .btn:has-text("用这套")');
  await page.waitForFunction(() => window.__st.fields.length === 1);
  const st = await j(`${M}/__state`);
  ok(JSON.stringify(await page.evaluate(() => window.__st.fields[0])) === JSON.stringify(['lily.png', 'world', '酒馆里的莉莉 - 战斗线']) && st.worlds['酒馆里的莉莉 - 战斗线']?.entries[1].key[0] === '盾', 'switching a set also imports it into the tavern and binds it to the card there');
  ok((await j(`${V}/api/items/${L.id}/content`)).data.character_book.entries.length === 2, 'and the vault card carries the same set');
  // 只换酒馆里的
  await f3.waitForSelector('.bookset-row.active:has-text("战斗线")');
  await f3.click('.bookset-row:has-text("原版") .bookset-link');
  await page.waitForFunction(() => window.__st.fields.length === 2);
  ok(await page.evaluate(() => window.__st.fields[1][2]) === '酒馆里的莉莉 - 原版' && (await j(`${V}/api/items/${L.id}/content`)).data.character_book.entries.length === 2, 'the tavern side can be switched on its own');

  // ---- 6. 抽卡 → 直接开聊
  await f3.evaluate(() => { const q = new URLSearchParams(location.hash.split('?')[1] || ''); q.delete('item'); location.hash = `#/library?${q}`; location.reload(); });
  const f4 = await (await page.waitForSelector('#tv-panel iframe')).contentFrame();
  await f4.waitForSelector('.card');
  await f4.fill('.search-input', other.name);
  await f4.waitForFunction(() => document.querySelectorAll('.card').length === 1);
  await f4.click('button[title*="抽"]');
  await f4.click('.sheet .btn:has-text("就这一个"), .sheet .btn:has-text("随便抽一张")');
  await f4.waitForSelector('.draw-chat');
  await shot('draw-chat');
  const before = Object.keys((await j(`${M}/__state`)).chars).length;
  await page.evaluate(() => { const c = SillyTavern.getContext(); const i = c.characters.findIndex((x) => x.avatar === 'other.png'); if (i >= 0) c.characters.splice(i, 1); });
  await f4.click('.draw-chat');
  await page.waitForFunction(() => window.__st.selected.length === 1);
  const after = (await j(`${M}/__state`)).chars;
  const sel = await page.evaluate(() => window.__st.selected[0]);
  ok(Object.keys(after).length === before + 1 && after[sel]?.data?.name === other.name && await page.evaluate(() => !document.querySelector('#tv-panel').classList.contains('open')), `a drawn card not yet in the tavern is imported, then its chat opens (${sel})`);

  ok(!errs.length, `no page errors ${errs.join(' | ')}`);
  await browser.close();
})().catch(async (e) => { console.log('FAIL crashed', e, G.errs); try { await G.page.screenshot({ path: `${process.argv[2]}/crash.png` }); } catch { /* ignore */ } process.exit(1); });
