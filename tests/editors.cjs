// 预设条目编辑、正则编辑（卡内 / 单独文件）、一张卡挂多套世界书、酒馆主题预览
const { chromium } = require('playwright');
const B = 'http://127.0.0.1:5199';
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const J = async (p) => (await fetch(B + p)).json();
const send = (method, p, body) => fetch(B + p, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const upload = async (name, text) => (await fetch(`${B}/api/items?filename=${encodeURIComponent(name)}&mode=new`, { method: 'POST', body: Buffer.from(text) })).json();
const item = async (id) => (await J('/api/state')).items.find((i) => i.id === id);
const content = (id) => J(`/api/items/${id}/content`);

const cardBook = (name, texts) => ({ name, extensions: {}, entries: texts.map((t, i) => ({ id: i, keys: [t], secondary_keys: [], comment: t, content: `${t}的内容`, enabled: true, constant: false, selective: true, insertion_order: 100, position: 'before_char', extensions: {} })) });
const card = (name, extra) => JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: { name, description: `${name}的描述`, personality: '', scenario: '', first_mes: `${name}的开场白`, mes_example: '', alternate_greetings: [], tags: [], creator: '虚构作者', extensions: {}, ...extra } });
const worldFile = (name, texts) => JSON.stringify({ name, entries: Object.fromEntries(texts.map((t, i) => [i, { uid: i, key: [t], keysecondary: [], comment: t, content: `${t}的内容`, constant: i === 0, selective: true, order: 50 + i, position: i === 1 ? 4 : 0, depth: 2, disable: false, probability: 80, useProbability: true, group: '甲组' }])) });
const preset = JSON.stringify({
  temperature: 0.9, top_p: 0.95, openai_max_tokens: 800, stream_openai: true,
  prompts: [
    { identifier: 'main', name: '主提示词', system_prompt: true, role: 'system', content: '你是一个写故事的人。' },
    { identifier: 'chatHistory', name: '聊天记录', system_prompt: true, marker: true },
    { identifier: 'custom-a', name: '文风', role: 'system', content: '句子短一点。', system_prompt: false, marker: false, injection_position: 0 },
    { identifier: 'custom-b', name: '禁词', role: 'system', content: '不要用「仿佛」。', system_prompt: false, marker: false, injection_position: 0 },
    { identifier: 'spare', name: '备用', role: 'user', content: '没放进顺序的。', system_prompt: false, marker: false },
  ],
  prompt_order: [
    { character_id: 100000, order: [{ identifier: 'main', enabled: true }, { identifier: 'custom-b', enabled: true }] },
    { character_id: 100001, order: [{ identifier: 'main', enabled: true }, { identifier: 'custom-a', enabled: true, keepme: 1 }, { identifier: 'chatHistory', enabled: true }, { identifier: 'custom-b', enabled: false }] },
  ],
});
const script = (name, find, rep) => ({ id: `id-${name}`, scriptName: name, findRegex: find, replaceString: rep, trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null });
const stTheme = JSON.stringify({ name: '夜航', blur_strength: 8, main_text_color: 'rgba(230, 230, 240, 1)', italics_text_color: 'rgba(150, 160, 190, 1)', underline_text_color: 'rgba(120, 220, 180, 1)', quote_text_color: 'rgba(255, 190, 90, 1)', blur_tint_color: 'rgba(20, 24, 40, 0.9)', chat_tint_color: 'rgba(16, 18, 30, 0.6)', user_mes_blur_tint_color: 'rgba(40, 60, 90, 0.8)', bot_mes_blur_tint_color: 'rgba(30, 30, 50, 0.8)', shadow_color: 'rgba(0, 0, 0, 1)', border_color: 'rgba(120, 140, 200, 0.4)', shadow_width: 1, font_scale: 1.1, chat_display: 1, avatar_style: 2, chat_width: 60, custom_css: '@import url("https://example.com/font.css");\n.mes { border-radius: 22px !important; }\n#chat { background-image: url(https://example.com/bg.png); }' });

const G = {};
(async () => {
  const C = (await upload('套装卡.json', card('套装卡', { character_book: cardBook('原版', ['灯塔', '渡口']), extensions: { regex_scripts: [script('去星号', '/\\*/g', '')] } }))).item;
  const W = (await upload('战斗线.json', worldFile('战斗线', ['剑', '盾', '马']))).item;
  const P = (await upload('测试预设.json', preset)).item;
  const R = (await upload('单条正则.json', JSON.stringify(script('状态栏', '/<st>(.*?)<\\/st>/g', '[$1]')))).item;
  const R2 = (await upload('一组正则.json', JSON.stringify([script('甲', '/甲/g', 'A'), script('乙', '/乙/g', 'B')]))).item;
  const T = (await upload('夜航.json', stTheme)).item;
  ok(C.type === 'character' && W.type === 'worldbook' && P.type === 'preset' && R.type === 'regex' && R2.type === 'regex' && T.type === 'theme', `fixtures (${[C, W, P, R, R2, T].map((x) => x?.type)})`);

  // ================= 接口 =================
  // ---- 多套世界书
  let bs = await J(`/api/items/${C.id}/booksets`);
  ok(bs.current?.count === 2 && bs.current.name === '原版' && bs.sets.length === 0, 'a card starts with its own book and no sets');
  bs = await (await send('POST', `/api/items/${C.id}/booksets`, { from: 'current', name: '原版' })).json();
  ok(bs.sets.length === 1 && bs.sets[0].same && bs.sets[0].count === 2 && !bs.existed, 'the current book is stored as a set and marked as the one in use');
  bs = await (await send('POST', `/api/items/${C.id}/booksets`, { from: 'current', name: '又存一次' })).json();
  ok(bs.sets.length === 1 && bs.existed, 'storing the same book again does not make a second copy');
  bs = await (await send('POST', `/api/items/${C.id}/booksets`, { itemId: W.id })).json();
  const battle = bs.sets.find((x) => x.name === '战斗线');
  ok(bs.sets.length === 2 && battle?.count === 3 && !battle.same, 'a worldbook from the library becomes a set, named after it');
  ok((await send('POST', `/api/items/${C.id}/booksets`, { itemId: P.id })).status === 400, 'a preset is not a worldbook');
  ok((await send('POST', `/api/items/${C.id}/booksets`, { book: { hello: 1 } })).status === 400, 'nor is a random object');
  ok((await send('POST', `/api/items/${W.id}/booksets`, { from: 'current' })).status === 400, 'only cards carry sets');
  let it = await item(C.id);
  const verBefore = it.files.filter((f) => !f.bookset).length;
  ok(it.files.filter((f) => f.bookset).length === 2 && it.files.filter((f) => f.bookset).every((f) => !f.primary && !f.sig), 'sets are attachments, never the main file, never a version');
  ok((await send('PATCH', `/api/items/${C.id}/files/${battle.id}`, { primary: true })).status === 400, 'a set cannot be made the main file');
  // 换用
  let r = await (await send('POST', `/api/items/${C.id}/booksets/${battle.id}/use`, {})).json();
  ok(r.sets.find((x) => x.id === battle.id).same && !r.sets.find((x) => x.name === '原版').same && r.current.count === 3, 'switching puts the chosen set into the card');
  let cc = await content(C.id);
  const e1 = cc.data.character_book.entries[1];
  ok(cc.data.character_book.entries.length === 3 && e1.keys[0] === '盾' && e1.enabled === true && e1.insertion_order === 51 && e1.extensions.position === 4 && e1.extensions.depth === 2 && e1.extensions.probability === 80 && e1.extensions.group === '甲组' && e1.position === 'after_char', `world-file entries are rewritten the way cards store them (${JSON.stringify(e1).slice(0, 200)})`);
  ok(cc.data.character_book.entries[0].constant === true && cc.data.character_book.entries[0].position === 'before_char', 'constant and position survive');
  ok(cc.data.extensions.regex_scripts.length === 1 && cc.data.description === '套装卡的描述', 'the rest of the card is untouched');
  it = await item(C.id);
  ok(it.files.filter((f) => !f.bookset).length === verBefore + 1 && /换世界书/.test(it.files.find((f) => f.primary).label), 'switching makes a new version');
  // 卡里的改了、没存过 → keep
  const d2 = structuredClone(cc.data); d2.character_book.entries.push({ id: 9, keys: ['新条目'], content: '手改的', enabled: true, insertion_order: 100, position: 'before_char', extensions: {} });
  await send('PUT', `/api/items/${C.id}/card`, { card: { ...cc.card, data: d2 } });
  bs = await J(`/api/items/${C.id}/booksets`);
  ok(bs.current.count === 4 && !bs.sets.some((x) => x.same), 'an edited book matches no stored set');
  const orig = bs.sets.find((x) => x.name === '原版');
  r = await (await send('POST', `/api/items/${C.id}/booksets/${orig.id}/use`, { keep: '手改过的战斗线' })).json();
  ok(r.sets.length === 3 && r.sets.find((x) => x.name === '手改过的战斗线')?.count === 4 && r.sets.find((x) => x.id === orig.id).same, 'the unsaved book is kept as a new set before switching');
  r = await (await send('POST', `/api/items/${C.id}/booksets/none/use`, {})).json();
  ok(r.current === null && !(await content(C.id)).data.character_book, 'the book can be taken out of the card');
  await send('POST', `/api/items/${C.id}/booksets/${orig.id}/use`, {});
  // 删除套装不动主文件；全部主文件没了套装也跟着清
  const kept = (await J(`/api/items/${C.id}/booksets`)).sets.find((x) => x.name === '手改过的战斗线');
  await fetch(`${B}/api/items/${C.id}/files/${kept.id}`, { method: 'DELETE' });
  it = await item(C.id);
  ok(it.files.filter((f) => f.bookset).length === 2 && it.files.some((f) => f.primary && !f.bookset), 'deleting a set leaves the card alone');
  const X = (await upload('临时卡.json', card('临时卡', { character_book: cardBook('甲', ['一']) }))).item;
  await send('POST', `/api/items/${X.id}/booksets`, { from: 'current', name: '甲' });
  for (const f of (await item(X.id)).files.filter((f) => !f.bookset)) await fetch(`${B}/api/items/${X.id}/files/${f.id}`, { method: 'DELETE' });
  ok((await item(X.id)).files.length === 0, 'when the card file itself is deleted, its sets go too (a set never becomes the main file)');

  // ---- 预设 / 正则保存
  ok((await send('PUT', `/api/items/${P.id}/json`, { data: { prompts: 'x' } })).status === 400, 'a broken preset is refused');
  ok((await send('PUT', `/api/items/${R.id}/json`, { data: [] })).status === 400, 'a regex file cannot be emptied');
  ok((await send('PUT', `/api/items/${R.id}/json`, { data: [{ scriptName: 'x' }] })).status === 400, 'a script needs a pattern');
  ok((await send('PUT', `/api/items/${T.id}/json`, { data: {} })).status === 400, 'themes are not edited this way');

  // ================= 界面 =================
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage(); G.p = p;
  const errs = []; G.errs = errs;
  p.on('pageerror', (e) => errs.push(e.message));
  const shot = (n) => p.screenshot({ path: `${process.argv[2]}/${n}.png` });
  const open = async (x) => {
    await p.goto(`${B}/#/library?item=${x.id}`); await p.reload();
    await p.waitForSelector('.detail-sheet');
    await p.locator('.detail-sheet .tabs button:has-text("内容")').click();
  };
  const saveSheet = async () => { await p.click('.edit-sheet .sheet-foot .btn.primary'); await p.waitForFunction(() => !document.querySelector('.edit-sheet')); };

  // ---- 预设
  await open(P);
  await p.click('.detail-sheet .btn:has-text("编辑条目")');
  await p.waitForSelector('.edit-sheet .book-edit-item');
  const rowTitles = () => p.locator('.edit-sheet .book-edit-title').allInnerTexts();
  ok(JSON.stringify(await rowTitles()) === JSON.stringify(['主提示词', '文风', '聊天记录', '禁词', '备用']), `rows follow the real order (${await rowTitles()})`);
  ok(await p.locator('.edit-sheet .book-edit-item.off').count() === 2, 'switched-off and unused prompts are shown as off');
  ok(await p.locator('.edit-sheet .book-edit-item:has-text("主提示词") .btn.danger').count() === 0 && await p.locator('.edit-sheet .book-edit-item:has-text("文风") .btn.danger').count() === 1, 'built-in prompts cannot be deleted, own ones can');
  await shot('preset');
  // 改内容、角色、深度
  await p.click('.edit-sheet .book-edit-item:has-text("文风") .book-edit-toggle');
  await p.fill('.preset-content', '句子短一点，少用形容词。');
  await p.selectOption('.preset-role', 'user');
  await p.selectOption('.preset-pos', '1');
  await p.fill('.preset-depth', '2');
  await p.click('.edit-sheet .book-edit-item.open .book-edit-toggle');
  // 占位条目不能改内容
  await p.click('.edit-sheet .book-edit-item:has-text("聊天记录") .book-edit-toggle');
  ok(await p.locator('.edit-sheet .book-edit-item.open textarea').count() === 0, 'a marker has no content to edit');
  await p.click('.edit-sheet .book-edit-item.open .book-edit-toggle');
  // 开关：禁词打开；备用（没在顺序里）打开 = 加入
  await p.click('.edit-sheet .book-edit-item:has-text("禁词") .switch');
  await p.click('.edit-sheet .book-edit-item:has-text("备用") .switch');
  // 文风下移一格（到聊天记录后面）
  await p.click('.edit-sheet .book-edit-item:has-text("文风") button[title="下移"]');
  // 删掉禁词
  await p.click('.edit-sheet .book-edit-item:has-text("禁词") .btn.danger');
  // 新加一条
  await p.click('.edit-sheet .btn:has-text("添加条目")');
  await p.fill('.edit-sheet .book-edit-item.open .preset-name', '结尾提醒');
  await p.fill('.edit-sheet .book-edit-item.open .preset-content', '每次回复不超过三段。');
  // 参数
  await p.fill('.preset-params input[data-k="temperature"]', '1.15');
  await saveSheet();
  let pd = (await content(P.id)).data;
  const main = pd.prompt_order.find((g) => g.character_id === 100001).order;
  ok(JSON.stringify(main.map((o) => [o.identifier.length > 20 ? 'NEW' : o.identifier, o.enabled])) === JSON.stringify([['main', true], ['chatHistory', true], ['custom-a', true], ['spare', true], ['NEW', true]]), `order and switches written to prompt_order (${JSON.stringify(main)})`);
  ok(main.find((o) => o.identifier === 'custom-a').keepme === 1, 'extra fields on an order entry are kept');
  ok(!pd.prompts.some((x) => x.identifier === 'custom-b') && !pd.prompt_order[0].order.some((o) => o.identifier === 'custom-b'), 'a deleted prompt is gone from every order list');
  const a = pd.prompts.find((x) => x.identifier === 'custom-a');
  ok(a.content === '句子短一点，少用形容词。' && a.role === 'user' && a.injection_position === 1 && a.injection_depth === 2, 'content, role and depth saved');
  const added = pd.prompts.find((x) => x.name === '结尾提醒');
  ok(added && added.content === '每次回复不超过三段。' && added.identifier.length > 20 && added.system_prompt === false, 'the new prompt is in the preset');
  ok(pd.temperature === 1.15 && pd.top_p === 0.95 && pd.stream_openai === true, 'parameters saved, untouched fields kept');
  ok((await item(P.id)).files.length === 2 && (await item(P.id)).type === 'preset', 'saved as a new version, still a preset');
  // 没改就关：不产生版本
  await p.waitForSelector('.detail-sheet .fold-title:has-text("结尾提醒")');
  await p.click('.detail-sheet .btn:has-text("编辑条目")');
  await p.waitForSelector('.edit-sheet .book-edit-item');
  ok((await rowTitles()).join() === '主提示词,聊天记录,文风,备用,结尾提醒', 'reopening shows the saved order');
  await saveSheet();
  ok((await item(P.id)).files.length === 2, 'saving without changes makes no version');

  // ---- 卡内正则
  await open(C);
  await p.click('.detail-sheet .card-regex');
  await p.waitForSelector('.edit-sheet .book-edit-item');
  ok((await rowTitles()).join() === '去星号', 'the card\'s embedded regex is listed');
  await p.click('.edit-sheet .toolbar-row .btn:has-text("新建")');
  await p.fill('.regex-name', '括号变书名号');
  await p.fill('.regex-find', '/\\((.+?)/g(');
  ok(await p.locator('.regex-err').innerText() !== '' && await p.locator('.edit-sheet .chip-s.warn').count() === 0, 'a bad pattern is flagged while typing');
  await p.click('.edit-sheet .sheet-foot .btn.primary');
  await p.waitForSelector('.toast');
  ok(await p.locator('.edit-sheet').count() === 1 && (await content(C.id)).data.extensions.regex_scripts.length === 1, 'and cannot be saved');
  await p.fill('.regex-find', '/\\((.+?)\\)/g');
  await p.fill('.regex-replace', '《$1》');
  await p.fill('.regex-sample', '他翻开(山海经)和(水经注)。');
  ok(await p.locator('.regex-out').innerText() === '他翻开《山海经》和《水经注》。', `the try-it box runs the script (${await p.locator('.regex-out').innerText()})`);
  await p.locator('.edit-sheet .book-edit-item.open .check-line:has-text("用户输入") input').check();
  await p.locator('.edit-sheet .book-edit-item.open .check-line:has-text("只改发给 AI 的内容") input').check();
  await shot('regex');
  // 从文件导入一组
  await p.setInputFiles('.edit-sheet input[type=file]', { name: '导入.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([script('导入甲', '/甲/g', 'A'), { nope: 1 }])) });
  await p.waitForFunction(() => document.querySelectorAll('.edit-sheet .book-edit-item').length === 3);
  // 从卡匣里选
  await p.click('.edit-sheet .btn:has-text("从卡匣里选")');
  await p.click('.pick-row:has-text("一组正则")');
  await p.waitForFunction(() => document.querySelectorAll('.edit-sheet .book-edit-item').length === 5);
  // 关掉第一条
  await p.click('.edit-sheet .book-edit-item:has-text("去星号") .switch');
  await saveSheet();
  let rs = (await content(C.id)).data.extensions.regex_scripts;
  ok(rs.map((x) => x.scriptName).join() === '去星号,括号变书名号,导入甲,甲,乙' && rs[0].disabled === true, `card regex saved (${rs.map((x) => x.scriptName)})`);
  ok(rs[1].replaceString === '《$1》' && JSON.stringify(rs[1].placement) === '[1,2]' && rs[1].promptOnly === true && new Set(rs.map((x) => x.id)).size === 5, 'fields saved, imported scripts get their own ids');
  ok((await content(C.id)).data.character_book.entries.length === 2, 'the card\'s book is untouched by a regex edit');

  // ---- 单独的正则文件：单条保持单条
  await open(R);
  await p.click('.detail-sheet .reader-tools .btn:has-text("编辑")');
  await p.waitForSelector('.edit-sheet .book-edit-item');
  await p.click('.edit-sheet .book-edit-toggle');
  await p.fill('.regex-replace', '【$1】');
  await saveSheet();
  let rd = (await content(R.id)).data;
  ok(!Array.isArray(rd) && rd.replaceString === '【$1】' && (await item(R.id)).type === 'regex', 'a single-script file stays a single script');
  // 预设里附带的正则
  await open(P);
  await p.click('.detail-sheet .reader-tools .btn:has-text("正则")');
  await p.waitForSelector('.edit-sheet');
  await p.click('.edit-sheet .toolbar-row .btn:has-text("新建")');
  await p.fill('.regex-name', '预设带的');
  await p.fill('.regex-find', '/x/g');
  await saveSheet();
  pd = (await content(P.id)).data;
  ok(pd.extensions.regex_scripts.length === 1 && pd.prompts.length === 5, 'a preset can carry regex too');

  // ---- 多套世界书（界面）
  await open(C);
  await p.waitForSelector('.card-booksets');
  ok(/3 套|2 套/.test(await p.locator('.card-booksets').innerText()), `the button shows how many sets (${await p.locator('.card-booksets').innerText()})`);
  await p.click('.card-booksets');
  await p.waitForSelector('.bookset-row');
  ok(await p.locator('.bookset-row').count() === 2 && await p.locator('.bookset-row.active:has-text("原版")').count() === 1, 'sets are listed, the one in use is marked');
  await shot('booksets');
  await p.click('.bookset-row:has-text("战斗线") .btn:has-text("用这套")');
  await p.waitForSelector('.bookset-row.active:has-text("战斗线")');
  ok((await content(C.id)).data.character_book.entries.length === 3, 'one click switches (the current one was already stored, so no question)');
  // 上传一个世界书文件
  await p.setInputFiles('.booksets input[type=file]', { name: '日常线.json', mimeType: 'application/json', buffer: Buffer.from(worldFile('', ['茶', '猫'])) });
  await p.waitForFunction(() => document.querySelectorAll('.bookset-row').length === 3);
  ok(await p.locator('.bookset-row:has-text("日常线")').count() === 1, 'an uploaded file is named after the file');
  // 改名
  await p.click('.bookset-row:has-text("日常线") button[title="改名"]');
  await p.fill('.dialog input', '日常');
  await p.click('.dialog .btn.primary');
  await p.waitForFunction(() => [...document.querySelectorAll('.bookset-name b')].some((b) => b.textContent === '日常'));
  ok(true, 'rename');
  // 删除
  await p.click('.bookset-row:has-text("日常") button[title="删除这一套"]');
  await p.click('.dialog .btn.danger');
  await p.waitForFunction(() => document.querySelectorAll('.bookset-row').length === 2);
  ok(true, 'delete');
  // 卡里的改掉（没存过）→ 换的时候会问
  cc = await content(C.id);
  const d3 = structuredClone(cc.data); d3.character_book.entries[0].content = '改过了';
  await send('PUT', `/api/items/${C.id}/card`, { card: { ...cc.card, data: d3 } });
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.querySelector('.booksets'));
  await p.click('.card-booksets');
  await p.waitForSelector('.bookset-unsaved');
  await p.click('.bookset-row:has-text("原版") .btn:has-text("用这套")');
  await p.waitForSelector('.dialog.choice');
  await p.click('.dialog.choice .btn.primary');
  await p.waitForSelector('.dialog:not(.choice) input');
  await p.fill('.dialog:not(.choice) input', '改过的战斗线');
  await p.click('.dialog:not(.choice) .btn.primary');
  await p.waitForFunction(() => document.querySelectorAll('.bookset-row').length === 3);
  bs = await J(`/api/items/${C.id}/booksets`);
  ok(bs.sets.find((x) => x.name === '改过的战斗线') && bs.sets.find((x) => x.name === '原版').same, 'an unsaved book is offered to be stored first');
  await p.keyboard.press('Escape');
  // 文件页不列套装
  await p.locator('.detail-sheet .tabs button:has-text("文件")').click();
  await p.waitForSelector('.file-row');
  it = await item(C.id);
  await p.waitForFunction((n) => document.querySelectorAll('.file-row').length === n, it.files.filter((f) => !f.bookset).length).catch(() => {});
  ok(await p.locator('.file-row').count() === it.files.filter((f) => !f.bookset).length && it.files.some((f) => f.bookset), 'the files tab lists versions only, not the sets');

  // ---- 酒馆主题预览
  await open(T);
  await p.waitForSelector('.st-theme-frame');
  const fr = p.frameLocator('.st-theme-frame');
  await fr.locator('.mes').first().waitFor();
  const css = (sel, prop) => fr.locator(sel).first().evaluate((el, pr) => getComputedStyle(el)[pr], prop);
  ok(await fr.locator('.mes').count() === 3 && await fr.locator('body.bubblechat').count() === 1, 'a mock chat in the theme\'s chat style');
  ok(await css('.mes_text', 'color') === 'rgb(230, 230, 240)' && await css('.mes_text q', 'color') === 'rgb(255, 190, 90)' && await css('.mes_text em', 'color') === 'rgb(150, 160, 190)', 'text, quote and italics colors come from the theme');
  ok(await css('.mes[is_user="true"]', 'backgroundColor') === 'rgba(40, 60, 90, 0.8)' && await css('.mes[is_user="false"]', 'backgroundColor') === 'rgba(30, 30, 50, 0.8)', 'user and character bubbles use their own tint');
  ok(await css('.mes_text', 'fontSize') === '16.5px' && await css('.avatar', 'borderRadius') === '10px', 'font scale and avatar shape apply');
  ok(await css('.mes', 'borderRadius') === '22px', 'the theme\'s custom css applies');
  ok(await css('#chat', 'backgroundImage') === 'none' || !(await p.evaluate(() => performance.getEntriesByType('resource').some((e) => e.name.includes('example.com')))), 'nothing is fetched from outside');
  ok(await p.locator('.st-theme-frame').getAttribute('sandbox') === '', 'the preview runs no scripts');
  await shot('st-theme');
  await p.locator('.st-theme-pv').locator('xpath=..').locator('.check-line input').uncheck();
  await p.frameLocator('.st-theme-frame').locator('.mes').first().waitFor();
  ok(await p.frameLocator('.st-theme-frame').locator('.mes').first().evaluate((el) => getComputedStyle(el).borderRadius) === '10px', 'custom css can be switched off');

  // ---- 手机宽度
  await p.setViewportSize({ width: 390, height: 780 });
  await open(C);
  await p.click('.detail-sheet .card-regex');
  await p.waitForSelector('.edit-sheet .book-edit-item');
  await p.locator('.edit-sheet .book-edit-toggle').nth(1).click();
  await p.waitForTimeout(400);
  ok(await p.evaluate(() => [...document.querySelectorAll('.edit-sheet .book-edit-item, .edit-sheet .field')].every((el) => el.getBoundingClientRect().right <= window.innerWidth + 1)), 'the regex editor fits a phone');
  await shot('regex-phone');
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.querySelector('.edit-sheet'));
  await p.click('.card-booksets');
  await p.waitForSelector('.bookset-row');
  await p.waitForTimeout(400);
  ok(await p.evaluate(() => [...document.querySelectorAll('.bookset-row, .bookset-row .btn')].every((el) => el.getBoundingClientRect().right <= window.innerWidth + 1)), 'the sets panel fits a phone');
  await shot('booksets-phone');

  ok(!errs.length, `no page errors ${errs.join(' | ')}`);
  await browser.close();
})().catch(async (e) => { console.log('FAIL crashed', e, G.errs); try { await G.p.screenshot({ path: `${process.argv[2]}/crash.png` }); } catch { /* ignore */ } process.exit(1); });
