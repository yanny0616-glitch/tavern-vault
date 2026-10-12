// 标签整理界面：多选合并、AI 合并建议、同义词
const { chromium } = require('playwright');
const B = 'http://127.0.0.1:5199'; const OUT = process.argv[2];
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const j = async (m, u, b) => (await fetch(B + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })).json();
(async () => {
  await j('PUT', '/api/ai/config', { profiles: [{ id: 'm', name: 'mock', format: 'openai', baseUrl: 'http://127.0.0.1:5197/v1', apiKey: 'sk-test-1234', model: 'mock-small' }], active: 'm' });
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  const c = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await c.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '#toasts{opacity:.0001}'; document.head.append(s); }); });
  const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(B + '/#/settings/tags'); await p.waitForSelector('.tag-admin-row');
  const names = async () => (await p.locator('.tag-admin-name .min0').allTextContents());
  // 多选合并
  await p.click('button:has-text("多选合并")');
  ok(await p.locator('.tag-admin-row .row-check').count() === 7 && /点标签选择/.test(await p.textContent('.tag-sel-bar')), 'select mode shows checkboxes');
  await p.click('.tag-admin-name:has-text("都市")'); await p.click('.tag-admin-name:has-text("现代")');
  ok(/已选 2 个/.test(await p.textContent('.tag-sel-bar')), 'two tags selected');
  await p.screenshot({ path: `${OUT}/1-select.png` });
  await p.click('.tag-sel-bar button:has-text("合并 2 个")');
  await p.waitForSelector('.sheet:has-text("合并标签")');
  ok(/现代/.test(await p.textContent('.sheet:has-text("合并标签") .opt.active')), 'most used tag preselected');
  await p.screenshot({ path: `${OUT}/2-merge.png` });
  await p.click('.sheet:has-text("合并标签") .sheet-foot button:has-text("合并")');
  await p.waitForFunction(() => ![...document.querySelectorAll('.tag-admin-name .min0')].some((x) => x.textContent === '都市'));
  ok(!(await names()).includes('都市') && await p.locator('.tag-sel-bar:not([hidden])').count() === 0, 'merged, select mode closed');
  ok(/都市 → 现代/.test(await p.textContent('.panel:has-text("同义词")')), 'alias listed');
  // AI 建议
  await p.click('button:has-text("AI 找可合并的")');
  await p.waitForSelector('.sheet:has-text("AI 合并建议") .tag-sug');
  // 都市已经并掉了，「现代 ← 都市」那组不再出现；「奇幻 ← 现代」不合理，取消勾选
  ok(await p.locator('.tag-sug').count() === 2 && /奇幻/.test(await p.locator('.tag-sug').nth(0).textContent()) && /温婉/.test(await p.locator('.tag-sug').nth(1).textContent()) && /新标签/.test(await p.locator('.tag-sug').nth(1).textContent()), 'AI suggestions shown (stale group dropped)');
  await p.locator('.tag-sug').nth(0).locator('.row-check').click();
  ok(await p.locator('.tag-sug.off').count() === 1, 'unchecked group dimmed');
  await p.screenshot({ path: `${OUT}/3-ai.png` });
  await p.click('.sheet:has-text("AI 合并建议") .sheet-foot button:has-text("合并选中的 1 组")');
  await p.waitForFunction(() => [...document.querySelectorAll('.tag-admin-name .min0')].some((x) => x.textContent === '温婉'));
  ok(!(await names()).includes('温柔') && (await names()).includes('现代') && (await names()).includes('奇幻'), 'only checked AI group applied');
  await p.screenshot({ path: `${OUT}/4-after.png`, fullPage: true });
  // 同义词：删除、手动添加
  await p.locator('.panel:has-text("同义词") .rule-chip:has-text("都市 → 现代") button').click();
  await p.waitForFunction(() => !/都市 → 现代/.test(document.querySelector('.panel.set-panel:last-of-type, body').textContent));
  await p.fill('.panel:has-text("同义词") input[placeholder^="旧写法"]', 'modern');
  await p.fill('.panel:has-text("同义词") input[placeholder^="换成"]', '现代');
  await p.click('.panel:has-text("同义词") button:has-text("添加")');
  await p.waitForFunction(() => /modern → 现代/.test(document.body.textContent));
  const al = (await j('GET', '/api/state')).settings.tagAliases;
  ok(!al['都市'] && al.modern === '现代' && al['温柔'] === '温婉', 'aliases saved: ' + JSON.stringify(al));
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
})();
