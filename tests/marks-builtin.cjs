// 封面角标：风格自带的类型 / 收藏并进角标设置，可以放到某个角、隐藏、调先后；每个角只显示排最前的一个；来源有更新
const { chromium } = require('playwright');
const B = 'http://127.0.0.1:5199';
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const send = async (method, p, body) => (await fetch(B + p, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
(async () => {
  const st = await (await fetch(`${B}/api/state`)).json();
  const a = st.items.find((i) => i.type === 'character');
  await send('PATCH', `/api/items/${a.id}`, { favorite: true, tags: ['现代', '校园'] });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const card = `.card[data-id="${a.id}"]`;
  const lib = async () => { await p.goto(`${B}/#/library`); await p.reload(); await p.waitForSelector('.card'); };
  const rule = (src) => p.locator(`.mark-rule[data-src="${src}"]`);
  const settings = async () => { await p.goto(`${B}/#/settings/browse`); await p.reload(); await p.waitForSelector('.mark-rule'); };

  await lib();
  const sel = await p.evaluate(() => (document.querySelector('.card')?.dataset.id ? '.card[data-id' : null));
  const C = sel ? card : `.card:has(.card-title:text-is("${a.name}"))`;
  ok(await p.locator(`${C} .card-type`).count() === 1 && await p.locator(`${C} .card-fav`).count() === 1 && await p.locator(`${C} .badge-type`).count() === 0, 'by default the type and the favourite star follow the skin');

  await settings();
  ok(await rule('type').count() === 1 && await rule('fav').count() === 1 && /跟随风格/.test(await rule('type').locator('.mark-rule-pos').innerText()), 'the two built-in marks are listed, following the skin');
  // 类型放到左下，和「版本数」同一个角
  await rule('type').locator('.pos-cell').nth(2).click();
  await p.waitForFunction(() => /左下/.test(document.querySelector('.mark-rule[data-src="type"] .mark-rule-pos')?.textContent || ''));
  ok(/左下 · 第 1 个/.test(await rule('type').locator('.mark-rule-pos').innerText()) && /左下 · 第 2 个/.test(await rule('ver').locator('.mark-rule-pos').innerText()), 'marks sharing a corner say which comes first');
  await rule('fav').locator('.btn[title="不显示这个角标"]').click();
  await p.waitForFunction(() => document.querySelector('.mark-rule[data-src="fav"]')?.classList.contains('off'));
  await p.locator('.panel:has(.mark-rule)').scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${process.argv[2]}/settings.png` });
  await lib();
  ok(await p.locator(`${C} .card-type`).count() === 0 && await p.locator(`${C} .corner-bl .badge-type`).count() === 1 && await p.locator(`${C} .card-fav`).count() === 0, 'the type is now an ordinary mark in that corner; the hidden star is gone');
  await p.screenshot({ path: `${process.argv[2]}/cards.png` });

  // 每个角只显示排最前的一个：加「标签」到左下，排到最前
  await settings();
  await p.locator('.btn:has-text("添加角标")').click();
  await p.locator('.menu-item:has-text("标签（这张卡自己的）")').click();
  await p.waitForSelector('.mark-rule[data-src="tags"]');
  await rule('tags').locator('.pos-cell').nth(2).click();
  await p.waitForFunction(() => /左下/.test(document.querySelector('.mark-rule[data-src="tags"] .mark-rule-pos')?.textContent || ''));
  await lib();
  ok(await p.locator(`${C} .corner-bl > span:not(.badge-more)`).count() >= 2, 'several marks stack in one corner');
  await settings();
  await p.locator('.set-row:has-text("每个角只显示排最前的一个") .switch').click();
  await lib();
  ok(await p.locator(`${C} .corner-bl > span`).count() === 1 && await p.locator(`${C} .corner-bl .badge-type`).count() === 1, 'with the option on only the first one that applies is shown');
  // 把类型排到后面：标签先
  await settings();
  for (let i = 0; i < 8 && !(await rule('type').locator('.mark-rule-ord button').nth(1).isDisabled()); i++) { await rule('type').locator('.mark-rule-ord button').nth(1).click(); await p.waitForTimeout(150); }
  await lib();
  ok(await p.locator(`${C} .corner-bl > span`).count() === 1 && await p.locator(`${C} .corner-bl .badge-tag`).count() === 1, 'moving a mark down lets the next one take the corner');
  const other = st.items.find((i) => i.type === 'character' && i.id !== a.id && !i.tags.length);
  if (other) ok(await p.locator(`.card:has(.card-title:text-is("${other.name}")) .corner-bl .badge-tag`).count() === 0, 'a card without tags falls through to the next mark');
  // 恢复默认
  await settings();
  await p.locator('.btn:has-text("恢复默认")').click();
  await p.waitForFunction(() => /跟随风格/.test(document.querySelector('.mark-rule[data-src="type"] .mark-rule-pos')?.textContent || ''));
  ok(await rule('track').count() === 1, 'defaults bring the built-ins back to the skin and include "source updated"');
  ok(!errs.length, `no page errors ${errs.join(' | ')}`);
  await browser.close();
})().catch((e) => { console.log('FAIL crashed', e); process.exit(1); });
