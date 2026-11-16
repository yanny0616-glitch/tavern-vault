// 自定义主题：校验、保存、套用、编辑器实时预览、任务书、导入 AI 的回答、?notheme 逃生
const { chromium } = require('playwright');
const B = 'http://127.0.0.1:5199';
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const J = async (p) => (await fetch(B + p)).json();
const put = (body) => fetch(`${B}/api/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const settings = async () => (await J('/api/state')).settings;
(async () => {
  // ---- 接口：校验
  const good = { id: 'themeaaa1', name: '  雨夜  ', base: 'ink', light: { bg: '#101820', text: '#f0f0f0', junk: 'x', accent: 'red; } body { display:none' }, dark: { bg: '#000000' }, vars: { radius: '99', 'title-weight': 650, 'cover-ratio': '1/1', nope: 1 }, css: '.card { border: 2px solid var(--accent); }' };
  let r = await put({ themes: [good], theme: 'themeaaa1' });
  ok(r.ok, 'a theme can be saved');
  let s = await settings();
  const t = s.themes[0];
  ok(t.name === '雨夜' && t.base === 'ink' && !('junk' in t.light) && !('accent' in t.light) && t.light.bg === '#101820', `colors cleaned (${JSON.stringify(t.light)})`);
  ok(t.vars.radius === '40px' && t.vars['title-weight'] === '700' && t.vars['cover-ratio'] === '1 / 1' && !('nope' in t.vars), `shape values clamped (${JSON.stringify(t.vars)})`);
  ok(s.theme === 'themeaaa1' && s.skin === 'ink', 'the active theme is stored and the skin follows its base');
  for (const css of ['@import "x.css";', '.a { background: url(http://x/y.png) }', '.a { background: url(/api/state) }', '.a { color: red', '</style><script>1</script>']) {
    r = await put({ themes: [{ ...good, css }], theme: 'themeaaa1' });
    ok(r.status === 400, `rejected: ${css.slice(0, 24)}`);
  }
  ok((await settings()).themes[0].css === good.css, 'a rejected save leaves the stored theme alone');
  r = await put({ theme: 'nosuchtheme' });
  ok((await settings()).theme === '', 'an unknown theme id falls back to the built-in skin');
  await put({ theme: 'themeaaa1' });

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const shot = (n) => p.screenshot({ path: `${process.argv[2]}/${n}.png` });
  const cssVar = (k) => p.evaluate((kk) => getComputedStyle(document.documentElement).getPropertyValue(`--${kk}`).trim(), k);

  // ---- 套用
  await p.goto(`${B}/#/library`);
  await p.waitForSelector('.card');
  ok(await p.evaluate(() => document.documentElement.dataset.theme) === 'themeaaa1', 'the page carries the theme id');
  ok(await p.evaluate(() => document.documentElement.dataset.skin) === 'ink', 'and the base skin');
  await p.evaluate(() => { document.documentElement.dataset.mode = 'light'; });
  ok((await cssVar('bg')) === '#101820' && (await cssVar('radius')) === '40px', 'theme variables win over the skin');
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('.card')).borderTopWidth) === '2px', 'custom css applies');
  ok(await p.evaluate(() => JSON.parse(localStorage.tv_theme || '{}').id) === 'themeaaa1', 'cached for the first paint');
  await shot('applied');

  // ---- 逃生口
  await p.goto(`${B}/?notheme#/library`);
  await p.waitForSelector('.card');
  ok(!(await p.evaluate(() => document.documentElement.dataset.theme)) && (await cssVar('bg')) !== '#101820', '?notheme skips the custom theme');

  // ---- 设置页：我的主题
  await p.goto(`${B}/#/settings`);
  await p.reload();
  await p.waitForSelector('.theme-opt');
  ok(await p.locator('.theme-opt.active').count() === 1 && await p.locator('.skin-opt.active:not(.theme-opt)').count() === 0, 'the custom theme is the one marked active');
  await shot('settings');

  // ---- 编辑器
  await p.click('.theme-edit-btn');
  await p.waitForSelector('.theme-sheet .theme-colors');
  ok(await p.locator('.theme-color').count() === 14, 'every color variable is listed');
  const bgInput = p.locator('.theme-val[data-k="bg"]');
  ok(await bgInput.inputValue() === '#101820', 'own colors are filled in');
  await bgInput.fill('#223344');
  await bgInput.dispatchEvent('change');
  await p.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#223344');
  ok(true, 'editing a color shows on the page at once');
  // 对比度提醒
  const tx = p.locator('.theme-val[data-k="text"]');
  await tx.fill('#2a3a4a');
  await tx.dispatchEvent('change');
  await p.waitForSelector('.theme-warn .note');
  ok(/看不清/.test(await p.locator('.theme-warn').innerText()), 'low contrast is pointed out');
  await tx.fill('#f5f5f5');
  await tx.dispatchEvent('change');
  // 形状
  await p.click('.theme-tabs .opt:has-text("形状和字体")');
  await p.waitForSelector('.field[data-k="radius"] input[type=range]');
  await p.locator('.field[data-k="radius"] input[type=range]').fill('6');
  await p.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--radius').trim() === '6px');
  ok(true, 'the radius slider applies live');
  await p.locator('.field[data-k="font-head"] select').selectOption({ label: '宋体' });
  await p.waitForFunction(() => /Songti/.test(getComputedStyle(document.documentElement).getPropertyValue('--font-head')));
  ok(true, 'a font preset applies live');
  // 高级样式
  await p.click('.theme-tabs .opt:has-text("高级样式")');
  await p.fill('.theme-css', '.panel { outline: 3px solid var(--accent); }\n@import "evil.css";');
  await p.waitForSelector('.theme-warn .note.warn');
  ok(/https:\/\//.test(await p.locator('.theme-warn').innerText()) && /evil\.css/.test(await p.locator('.theme-warn').innerText()), 'a bad address is named');
  await p.click('.theme-sheet .btn.primary:has-text("保存并使用")');
  await p.waitForSelector('.toast');
  ok((await settings()).themes[0].css === good.css, 'and it cannot be saved');
  await p.fill('.theme-css', '.panel { outline: 3px solid var(--accent); }');
  await p.waitForFunction(() => getComputedStyle(document.querySelector('.theme-sample .panel')).outlineWidth === '3px');
  ok(true, 'valid css applies live to the sample');
  await shot('editor');
  // 看整页
  await p.click('.theme-sheet .btn:has-text("看整页")');
  await p.waitForSelector('.theme-peek');
  ok(!(await p.locator('.theme-sheet').isVisible()), 'peek hides the editor');
  await p.click('.theme-peek');
  ok(await p.locator('.theme-sheet').isVisible(), 'and brings it back');
  await p.click('.theme-sheet .btn.primary:has-text("保存并使用")');
  await p.waitForFunction(() => !document.querySelector('.theme-sheet'));
  s = await settings();
  ok(s.themes[0].light.bg === '#223344' && s.themes[0].vars.radius === '6px' && /Songti/.test(s.themes[0].vars['font-head']) && /outline/.test(s.themes[0].css), 'the edited theme is saved');

  // ---- 取消还原
  await p.waitForSelector('.theme-edit-btn');
  await p.click('.theme-edit-btn');
  await p.waitForSelector('.theme-val[data-k="bg"]');
  await p.locator('.theme-val[data-k="bg"]').fill('#ff0000');
  await p.locator('.theme-val[data-k="bg"]').dispatchEvent('change');
  await p.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#ff0000');
  await p.click('.theme-sheet .btn:has-text("取消")');
  await p.click('.dialog .btn.danger, .sheet .btn.danger:has-text("放弃")');
  await p.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#223344');
  ok(true, 'cancelling puts the saved theme back');

  // ---- 换回内置风格
  await p.waitForFunction(() => !document.querySelector('.theme-sheet'));
  await p.click('.skin-opt:not(.theme-opt) >> nth=0');
  await p.waitForFunction(() => !document.documentElement.dataset.theme);
  s = await settings();
  ok(s.theme === '' && s.themes.length === 1, 'picking a built-in skin turns the theme off but keeps it');

  // ---- 任务书
  await p.click('.btn:has-text("让 AI 设计")');
  await p.waitForSelector('.brief-out');
  await p.fill('.sheet input[placeholder*="起个名字"]', '咖啡馆');
  await p.fill('.sheet textarea[placeholder*="想要什么感觉"]', '暖黄的灯和木头');
  const brief = await p.locator('.brief-out').inputValue();
  ok(/暖黄的灯和木头/.test(brief) && /--accent/.test(brief) && /\.card/.test(brief) && /"kind": "theme"/.test(brief) && /咖啡馆/.test(brief), 'the brief carries the wish, variables, parts and answer format');
  ok(/https:\/\//.test(brief) && /不能带任何脚本/.test(brief) && /4\.5/.test(brief) && /素底/.test(await p.locator('.sheet .opts').first().innerText()), 'and the rules; the plain base is offered');
  await p.click('.btn:has-text("复制任务书")');
  await p.waitForFunction(() => navigator.clipboard.readText().then((x) => x.includes('暖黄的灯和木头')));
  ok(true, 'the brief is copied');
  await shot('brief');
  // AI 的回答：前后带说明文字，主题在代码块里
  const answer = '好的，这套主题走暖色。\n\n```json\n' + JSON.stringify({ app: 'cardbox', kind: 'theme', name: '咖啡馆', base: 'atelier', light: { bg: '#f6efe4', surface: '#fffaf2', text: '#3a2a1c', accent: '#b5651d', 'on-accent': '#ffffff' }, dark: { bg: '#1c1510', surface: '#2a2018', text: '#f1e6d6', accent: '#e0a060', 'on-accent': '#1c1510' }, vars: { radius: '18px', 'title-size': '28px' }, css: '.tb-title { letter-spacing: .06em; }' }, null, 2) + '\n```\n\n希望你喜欢。';
  await p.fill('.brief-in', answer);
  await p.click('.btn.primary:has-text("导入这套主题")');
  await p.waitForSelector('.theme-sheet');
  await p.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--radius').trim() === '18px');
  ok(await p.locator('.theme-sheet input[placeholder="主题名称"]').inputValue() === '咖啡馆', 'the answer opens in the editor for a look first');
  ok((await settings()).themes.length === 1, 'nothing is saved until the user says so');
  await p.click('.theme-sheet .btn.primary:has-text("保存并使用")');
  await p.waitForFunction(() => !document.querySelector('.theme-sheet'));
  s = await settings();
  ok(s.themes.length === 2 && s.themes[1].name === '咖啡馆' && s.theme === s.themes[1].id && s.skin === 'atelier', 'the imported theme is saved and in use');
  await p.waitForFunction(() => document.querySelectorAll('.theme-opt').length === 2);
  await shot('two-themes');

  // ---- 带外部资源的主题：先列出要访问的网站，同意才导入
  await p.click('.btn:has-text("让 AI 设计")');
  await p.waitForSelector('.brief-in');
  const ext = { name: '外链', base: 'plain', light: { bg: '#ffffff', text: '#111111' }, css: '@import "https://fonts.example.org/css?family=X";\n@font-face { font-family: "Y"; src: url("https://cdn.example.net/y.woff2"); }\nbody { background-image: url(https://img.example.com/a.png); }\n.card { outline: 1px solid red; }' };
  await p.fill('.brief-in', JSON.stringify(ext));
  await p.click('.btn.primary:has-text("导入这套主题")');
  await p.waitForSelector('.dialog:has-text("外部资源")');
  const asked = await p.locator('.dialog').innerText();
  ok(/fonts\.example\.org/.test(asked) && /cdn\.example\.net/.test(asked) && /img\.example\.com/.test(asked), 'importing a theme with outside resources lists every site first');
  await p.click('.dialog .btn:has-text("取消")');
  await p.waitForFunction(() => !document.querySelector('.dialog'));
  ok(!(await p.locator('.theme-sheet').count()) && (await settings()).themes.length === 2, 'saying no imports nothing');
  await p.click('.btn.primary:has-text("导入这套主题")');
  await p.click('.dialog .btn.primary');
  await p.waitForSelector('.theme-sheet .theme-hosts');
  ok(/img\.example\.com/.test(await p.locator('.theme-hosts').innerText()), 'the editor keeps showing which sites a theme reaches');
  ok(await p.evaluate(() => document.documentElement.dataset.skin) === 'plain' && await p.evaluate(() => getComputedStyle(document.body).backgroundImage.includes('img.example.com')), 'the plain base and the outside image are applied');
  ok(await p.evaluate(() => document.getElementById('tv-theme').textContent.trimStart().startsWith('@import')), '@import is moved to the top so it takes effect');
  await p.click('.theme-sheet .btn.primary:has-text("保存并使用")');
  await p.waitForFunction(() => !document.querySelector('.theme-sheet'));
  s = await settings();
  ok(s.themes.length === 3 && s.themes[2].base === 'plain' && /@font-face/.test(s.themes[2].css) && s.skin === 'atelier', 'saved; the plain base is not stored as a built-in skin');
  await p.evaluate(() => { document.documentElement.dataset.mode = 'dark'; });
  ok(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()) === '#1e1e22', 'the plain base has its own dark colors');
  await shot('plain');

  // ---- 手机宽度
  await p.setViewportSize({ width: 390, height: 780 });
  await p.goto(`${B}/#/settings/appearance`);
  await p.reload();
  await p.waitForSelector('.theme-edit-btn');
  await p.locator('.theme-edit-btn').first().click();
  await p.waitForSelector('.theme-colors');
  await p.waitForTimeout(500);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && [...document.querySelectorAll('.theme-sheet .theme-color')].every((el) => el.getBoundingClientRect().right <= window.innerWidth + 1)), 'the editor fits a phone');
  await shot('phone');

  ok(!errs.length, `no page errors ${errs.join(' | ')}`);
  await browser.close();
})().catch((e) => { console.log('FAIL crashed', e); process.exit(1); });
