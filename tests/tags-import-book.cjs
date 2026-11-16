// 标签分类、导入清单（先看再导入）、编辑内嵌世界书
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path'); const os = require('os');
const B = 'http://127.0.0.1:5199';
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
let H = {};
const J = async (p) => (await fetch(B + p, { headers: H })).json();
const send = (method, p, body) => fetch(B + p, { method, headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const newCard = (name) => ({ spec: 'chara_card_v2', spec_version: '2.0', data: { name, description: `${name}是测试用的虚构角色。`, first_mes: '你好。', tags: [], character_book: { name: '', entries: [] }, extensions: {} } });
(async () => {
  const { token } = await (await send('POST', '/api/login', { password: 'testpw' })).json();
  H = { Authorization: 'Bearer ' + token };
  const st0 = await J('/api/state');
  const tagCount = {};
  for (const it of st0.items) if (!it.deletedAt) for (const t of it.tags) tagCount[t] = (tagCount[t] || 0) + 1;
  const tags = Object.keys(tagCount);
  ok(tags.length >= 3, `fixtures have tags (${tags.length})`);
  const [t1, t2, t3] = tags;

  // ---- 标签分类（接口）
  const g1 = await (await send('PUT', '/api/tags/groups', { groups: [{ name: '题材', tags: [t1, t2, t1] }, { name: '题材', tags: [t3] }, { name: '  ', tags: [] }, { name: '来源', tags: [t2] }] })).json();
  ok(g1.groups.length === 2 && g1.groups[0].tags.join() === [t1, t2].join() && g1.groups[1].name === '来源', 'groups cleaned: no duplicate names, no blank, tags de-duplicated');
  ok(JSON.stringify((await J('/api/state')).settings.tagGroups) === JSON.stringify(g1.groups), 'groups come back with the state');
  await send('POST', '/api/tags/replace', { ops: [{ from: [t2], to: ['改名后的标签'] }] });
  const g2 = (await J('/api/state')).settings.tagGroups;
  ok(g2[0].tags.includes('改名后的标签') && !g2[0].tags.includes(t2) && g2[1].tags.join() === '改名后的标签', 'renaming a tag renames it inside the groups (it sits in two groups)');
  await send('POST', '/api/tags/replace', { ops: [{ from: ['改名后的标签'], to: [t2] }] });

  // ---- 导入清单（接口）
  const before = (await J('/api/state')).items.length;
  const up = async (name, obj, q = '') => (await fetch(`${B}/api/items?filename=${encodeURIComponent(name)}${q}`, { method: 'POST', headers: H, body: Buffer.from(JSON.stringify(obj)) })).json();
  const r1 = await up('清单测试甲.json', newCard('清单测试甲'), '&review=1');
  ok(r1.status === 'review' && r1.detected.type === 'character' && r1.detected.name === '清单测试甲' && !r1.item, `new file only reviewed (${r1.status})`);
  ok((await J('/api/state')).items.length === before, 'nothing written while reviewing');
  const existing = st0.items.find((i) => i.type === 'character' && !i.deletedAt);
  const sameName = await up('同名.json', newCard(existing.name), '&review=1&match=version');
  ok(sameName.status === 'conflict', `same name still asks even when the default is "new version" (${sameName.status})`);
  const done = await (await send('POST', '/api/ingest/resolve', { sha: r1.sha, filename: r1.filename, action: 'new', type: 'prompt' })).json();
  ok(done.status === 'created' && done.item.type === 'prompt', `confirmed with a changed type (${done.item?.type})`);
  ok((await up('清单测试甲.json', newCard('清单测试甲'), '&review=1')).status === 'duplicate', 'reviewing the same file again says it already exists');

  // ---- 界面
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  const c = await b.newContext({ viewport: { width: 1200, height: 900 } });
  await c.addInitScript((t) => localStorage.setItem('tv_token', t), token);
  await c.addInitScript(() => { if (!localStorage.getItem('tv_prefs')) localStorage.setItem('tv_prefs', JSON.stringify({ detailTab: 'content' })); });
  const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));

  // 筛选面板按分类收起
  await p.goto(B + '/#/library'); await p.waitForSelector('.card, .row-item');
  await p.click('button[title="筛选与排序"]'); await p.waitForSelector('.tag-group');
  const heads = await p.$$eval('.tag-group-head .tag-group-name', (els) => els.map((e) => e.textContent));
  ok(heads.join() === '题材,来源,未分类', `filter sheet lists groups then the rest (${heads.join()})`);
  ok(await p.locator('.tag-group .tag-opt').count() === 0, 'groups start collapsed');
  await p.click('.tag-group-head:has-text("题材")'); await p.waitForTimeout(150);
  ok(await p.locator('.tag-group.open .tag-opt').count() === 2, 'opening a group shows its tags');
  await p.click(`.tag-group.open .tag-opt:has-text("${t1}")`); await p.waitForTimeout(300);
  ok(await p.locator(`.active-filters .pill:has-text("#${t1}")`).count() === 1, 'picking a tag inside a group filters the library');
  await p.click('.sheet-foot .btn:has-text("重置")'); await p.click('.sheet-foot .btn:has-text("完成")');

  // 设置里建分类
  await p.goto(B + '/#/settings/tags'); await p.waitForSelector('.panel:has-text("标签分类")');
  ok(await p.locator('.panel:has-text("标签分类") .tag-admin-row').count() === 2, 'settings list the groups');
  await p.click('.panel:has-text("标签分类") .btn:has-text("新建分类")');
  await p.fill('.sheet.dialog input', '性格'); await p.keyboard.press('Enter');
  await p.waitForSelector('.sheet:has-text("里的标签") .tag-opt');
  await p.click(`.sheet:has-text("里的标签") .tag-opt:has-text("${t3}")`);
  await p.click('.sheet:has-text("里的标签") .sheet-foot .btn:has-text("保存")'); await p.waitForTimeout(500);
  const g3 = (await J('/api/state')).settings.tagGroups;
  ok(g3.length === 3 && g3[2].name === '性格' && g3[2].tags.join() === t3, `new group saved with the picked tag (${JSON.stringify(g3[2])})`);
  await p.click('.panel:has-text("标签分类") .tag-admin-row:has-text("性格") .btn[title="上移"]'); await p.waitForTimeout(400);
  ok((await J('/api/state')).settings.tagGroups[1].name === '性格', 'groups can be reordered');

  // 导入清单
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-review-'));
  const f1 = path.join(dir, '清单测试乙.json'); const f2 = path.join(dir, '清单测试丙.json');
  fs.writeFileSync(f1, JSON.stringify(newCard('清单测试乙'))); fs.writeFileSync(f2, JSON.stringify(newCard('清单测试丙')));
  await p.goto(B + '/#/library'); await p.waitForSelector('.card, .row-item');
  await p.click('.btn:has-text("添加")'); await p.waitForSelector('.drop');
  await p.click('details.fold summary:has-text("导入选项")');
  await p.click('.check-line:has-text("先列出清单")');
  await p.setInputFiles('.drop input[type=file]:not([webkitdirectory])', [f1, f2]);
  await p.waitForSelector('.import-row .review-type'); await p.waitForTimeout(600);
  ok(await p.locator('.import-row .review-type').count() === 2, 'both new files wait in the list');
  ok((await p.textContent('.import-summary')).includes('还没有导入') && (await p.textContent('.import-bulk')).includes('2 个新文件待确认'), 'summary says nothing is imported yet');
  const names = async () => (await J('/api/state')).items.map((i) => i.name);
  ok(!(await names()).includes('清单测试乙'), 'not in the library yet');
  await p.click('.import-row:has-text("清单测试丙") .btn:has-text("移出")'); await p.waitForTimeout(400);
  await p.selectOption('.import-row:has-text("清单测试乙") .review-type', 'prompt'); await p.waitForTimeout(200);
  ok((await p.textContent('.import-row:has-text("清单测试乙") .row-sub')).includes('改成'), 'row shows the changed type');
  await p.click('.import-bulk .btn:has-text("导入这 1 项")'); await p.waitForTimeout(900);
  const after = (await J('/api/state')).items;
  ok(after.find((i) => i.name === '清单测试乙')?.type === 'prompt' && !after.some((i) => i.name === '清单测试丙'), 'confirmed one with the new type, the removed one stayed out');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  // 编辑内嵌世界书
  let card = null;
  // 名字不能和别的条目重复或互相包含，不然点卡片会点到别的
  const uniq = (it) => after.filter((x) => !x.deletedAt && x.name.includes(it.name)).length === 1;
  for (const it of after.filter((i) => i.type === 'character' && !i.deletedAt && uniq(i))) {
    const d = (await J(`/api/items/${it.id}/content`)).data || {};
    if ((d.character_book?.entries || []).length >= 3) { card = { it, n: d.character_book.entries.length, second: d.character_book.entries[1].comment }; break; }
  }
  await p.goto(B + '/#/library'); await p.waitForSelector('.search-input');
  await p.fill('.search-input', card.it.name); await p.waitForTimeout(700);
  await p.click(`.card:has-text("${card.it.name}")`); await p.waitForSelector('.read-sec');
  await p.click('.read-sec:has-text("内嵌世界书") .read-head .btn:has-text("编辑")'); await p.waitForSelector('.book-edit-item');
  ok(await p.locator('.book-edit-item').count() === card.n, `editor lists every entry (${card.n})`);
  await p.click('.book-edit-item >> nth=0 >> .btn[title="删除这个条目"]');
  await p.click('.sheet .btn:has-text("添加条目")'); await p.waitForSelector('.book-edit-item.open');
  const open = '.book-edit-item.open';
  await p.fill(`${open} .field:has-text("标题") input`, '新加的条目');
  await p.fill(`${open} .field:has-text("关键词") >> nth=0 >> input`, '钥匙甲，钥匙乙');
  await p.fill(`${open} textarea`, '这是新条目的内容。');
  for (let i = 0; i < card.n - 1; i++) await p.click(`${open} .btn[title="上移"]`);
  await p.click('.book-edit-item >> nth=1 >> .switch');
  await p.click('.sheet-foot .btn:has-text("保存")'); await p.waitForTimeout(900);
  const d2 = (await J(`/api/items/${card.it.id}/content`)).data;
  const es = d2.character_book.entries;
  ok(es.length === card.n && es[0].comment === '新加的条目' && es[0].keys.join() === '钥匙甲,钥匙乙' && es[0].content === '这是新条目的内容。', `added entry saved first with its keywords (${es.length}, ${es[0].comment})`);
  ok(es[1].comment === card.second && es[1].enabled === false, 'deleted the old first entry, and the next one was switched off');
  const it2 = (await J('/api/state')).items.find((i) => i.id === card.it.id);
  ok(it2.files.length === card.it.files.length + 1, 'saved as a new version, the old one is kept');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
  fs.rmSync(dir, { recursive: true, force: true });
})();
