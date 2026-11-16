// 下拉框：电脑上弹自己画的列表（跟着主题），选了马上生效；设置页选完「设置给」立刻重画
const { chromium } = require('playwright');
const B = 'http://127.0.0.1:5199';
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`${B}/#/settings/browse`);
  const sel = p.locator('.panel:has(h3:text-is("卡片上显示")) select');
  await sel.waitFor();
  await sel.click();
  await p.waitForSelector('.dd-menu');
  ok(await p.locator('.dd-item').count() === await sel.locator('option').count() && await p.locator('.dd-item.sel').innerText() === '默认（所有类型）', 'clicking a select opens the themed list with the current one marked');
  const bg = await p.evaluate(() => [getComputedStyle(document.querySelector('.dd-menu')).backgroundColor, getComputedStyle(document.querySelector('.select')).backgroundColor]);
  ok(bg[0] === bg[1], `the list uses the theme surface (${bg})`);
  await p.screenshot({ path: `${process.argv[2]}/open.png` });
  await p.locator('.dd-item', { hasText: '世界书' }).click();
  await p.waitForSelector('.scope-note');
  ok(await p.locator('.dd-menu').count() === 0 && /世界书/.test(await p.locator('.scope-note').innerText()), 'choosing redraws the page right away');
  const sel2 = p.locator('.panel:has(h3:text-is("卡片上显示")) select');
  ok(await sel2.inputValue() === 'worldbook' && await p.locator('.panel:has(h3:text-is("卡片上显示")) .set-row').count() === 4, 'the select shows the chosen type and the shared options are gone');
  // 键盘
  await sel2.focus();
  await p.keyboard.press('Enter');
  await p.waitForSelector('.dd-menu');
  await p.keyboard.press('ArrowUp');
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => /角色卡/.test(document.querySelector('.scope-note')?.textContent || ''));
  ok(true, 'keyboard: enter opens, arrows move, enter picks');
  const sel3 = p.locator('.panel:has(h3:text-is("卡片上显示")) select');
  await sel3.click();
  await p.keyboard.press('Escape');
  ok(await p.locator('.dd-menu').count() === 0 && await sel3.inputValue() === 'character', 'escape closes without changing');
  await sel3.click();
  await p.mouse.click(30, 500);
  ok(await p.locator('.dd-menu').count() === 0, 'clicking elsewhere closes it');
  // 弹窗里的下拉框：列表在弹窗上面
  await p.goto(`${B}/#/library`);
  await p.reload();
  await p.waitForSelector('.card');
  const inSheet = await p.evaluate(() => { const o = document.createElement('div'); o.className = 'overlay'; o.style.cssText = getComputedStyle(document.documentElement).cssText; document.body.append(o); const z = Number(getComputedStyle(o).zIndex) || 0; o.remove(); return z; });
  ok(inSheet < 4000, `the list sits above overlays (${inSheet})`);
  // 触屏：还是系统的
  const m = await (await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })).newPage();
  await m.goto(`${B}/#/settings/browse`);
  await m.locator('select').first().waitFor();
  await m.locator('select').first().dispatchEvent('mousedown');
  ok(await m.locator('.dd-menu').count() === 0, 'touch devices keep the system picker');
  ok(!errs.length, `no page errors ${errs.join(' | ')}`);
  await browser.close();
})().catch((e) => { console.log('FAIL crashed', e); process.exit(1); });
