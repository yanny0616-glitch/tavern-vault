// 自定义主题的数据格式、校验和生成样式。网页和服务端共用，这里不能碰 DOM。
//
// 一套主题 = 选一套内置风格当底稿（决定版式和结构）+ 自己改的部分：
//   light / dark  两套颜色
//   vars          形状和字体（圆角、标题字号、字体……），浅色深色共用
//   css           高级样式：直接写 CSS，想改哪里改哪里

export const BASE_SKINS = ['atelier', 'minimal', 'sakura', 'ink', 'neon'];

/** 颜色变量：[名字, 说明]。浅色、深色各一套 */
export const COLOR_VARS = [
    ['bg', '页面背景'],
    ['surface', '卡片、面板、弹窗的底色'],
    ['surface-2', '输入框、次一级的底色'],
    ['text', '正文文字'],
    ['text-2', '次要文字'],
    ['text-3', '提示、说明文字'],
    ['line', '细分隔线'],
    ['line-2', '较深的线、边框'],
    ['accent', '强调色：按钮、选中状态'],
    ['accent-2', '第二强调色：渐变、点缀'],
    ['on-accent', '强调色上面的文字'],
    ['danger', '危险、删除'],
    ['ok', '成功、通过'],
    ['warn', '提醒'],
];

/** 形状和字体：[名字, 说明, 种类, 额外]。px 的额外是 [最小, 最大] */
export const SHAPE_VARS = [
    ['radius', '圆角：卡片、面板', 'px', [0, 40]],
    ['radius-sm', '圆角：按钮、输入框', 'px', [0, 30]],
    ['radius-lg', '圆角：弹窗', 'px', [0, 48]],
    ['title-size', '页面大标题字号', 'px', [16, 44]],
    ['title-weight', '大标题粗细', 'weight'],
    ['cover-ratio', '封面比例（宽 / 高）', 'ratio'],
    ['font', '正文字体', 'font'],
    ['font-head', '标题字体', 'font'],
    ['shadow', '卡片阴影', 'text'],
    ['shadow-lg', '弹窗阴影', 'text'],
];
export const FONT_PRESETS = [
    ['系统默认', '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif'],
    ['圆体', '"SF Pro Rounded", ui-rounded, -apple-system, "PingFang SC", "Hiragino Maru Gothic ProN", "Microsoft YaHei", sans-serif'],
    ['宋体', '"Songti SC", "Noto Serif SC", "Source Han Serif SC", STSong, SimSun, Georgia, serif'],
    ['楷体', '"Kaiti SC", STKaiti, KaiTi, "Songti SC", serif'],
    ['等宽', 'ui-monospace, "SF Mono", Menlo, Consolas, "PingFang SC", "Microsoft YaHei", monospace'],
];
export const RATIOS = ['3 / 4', '2 / 3', '1 / 1', '4 / 5', '9 / 16'];

export const MAX_THEMES = 20;
export const MAX_CSS = 40000;
const COLOR_KEYS = new Set(COLOR_VARS.map(([k]) => k));
const SHAPE = new Map(SHAPE_VARS.map((x) => [x[0], x]));

/** 一个变量的值能不能用：不能带出声明之外去，也不能拉外部资源 */
export function cleanValue(v) {
    const s = String(v ?? '').trim().slice(0, 300);
    if (!s || /[;{}<>\\]|\/\*|url\s*\(|expression\s*\(|@|javascript:/i.test(s)) return '';
    return s;
}

/** 高级样式里不允许的东西。返回问题列表，空的就是可以用 */
export function cssProblems(css) {
    const s = String(css ?? '');
    const out = [];
    if (s.length > MAX_CSS) out.push(`样式太长了（${s.length} 字），最多 ${MAX_CSS} 字`);
    if (/@import/i.test(s)) out.push('不能用 @import 引入别的样式');
    if (/url\s*\(/i.test(s)) out.push('不能用 url() 加载图片、字体等资源');
    if (/@font-face/i.test(s)) out.push('不能用 @font-face 加载字体');
    if (/expression\s*\(|javascript:|behavior\s*:|-moz-binding/i.test(s)) out.push('不能带脚本');
    if (/<\s*\/?\s*(style|script)/i.test(s)) out.push('不能带 <style> 或 <script> 标签');
    let depth = 0;
    for (const ch of s.replace(/\/\*[\s\S]*?\*\//g, '')) { if (ch === '{') depth++; else if (ch === '}') depth--; if (depth < 0) break; }
    if (depth !== 0) out.push('花括号没有配对，检查一下是不是少写或多写了 { }');
    return out;
}

function cleanColors(o) {
    const out = {};
    for (const [k, v] of Object.entries(o && typeof o === 'object' && !Array.isArray(o) ? o : {})) {
        if (!COLOR_KEYS.has(k)) continue;
        const c = cleanValue(v);
        if (c) out[k] = c;
    }
    return out;
}
function cleanShape(o) {
    const out = {};
    for (const [k, v] of Object.entries(o && typeof o === 'object' && !Array.isArray(o) ? o : {})) {
        const def = SHAPE.get(k);
        if (!def) continue;
        const [, , kind, extra] = def;
        if (kind === 'px') { const n = Math.round(parseFloat(v)); if (Number.isFinite(n)) out[k] = `${Math.min(extra[1], Math.max(extra[0], n))}px`; }
        else if (kind === 'weight') { const n = Math.round(Number(v) / 100) * 100; if (n >= 300 && n <= 900) out[k] = String(n); }
        else if (kind === 'ratio') { const m = /^\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*$/.exec(String(v)); if (m && Number(m[1]) && Number(m[2])) out[k] = `${Number(m[1])} / ${Number(m[2])}`; }
        else { const c = cleanValue(v); if (c) out[k] = c; }
    }
    return out;
}

/** 校验一套主题。不合格的值直接去掉；高级样式有问题就抛出，说清楚是什么问题 */
export function cleanTheme(t) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) throw new Error('主题数据不对');
    const css = String(t.css ?? '').replace(/\r\n?/g, '\n');
    const bad = cssProblems(css);
    if (bad.length) throw new Error(`高级样式有问题：${bad.join('；')}`);
    return {
        id: /^[a-z0-9]{4,24}$/.test(String(t.id || '')) ? String(t.id) : Math.random().toString(36).slice(2, 12),
        name: String(t.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 30) || '我的主题',
        base: BASE_SKINS.includes(t.base) ? t.base : 'atelier',
        light: cleanColors(t.light),
        dark: cleanColors(t.dark),
        vars: cleanShape(t.vars),
        css,
    };
}
export function cleanThemes(list) {
    const out = [];
    const seen = new Set();
    for (const t of (Array.isArray(list) ? list : []).slice(0, MAX_THEMES)) {
        const c = cleanTheme(t);
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push(c);
    }
    return out;
}

/** 主题 → 真正生效的样式。挂在 html[data-theme] 上，盖过底稿风格的变量 */
export function themeCss(t) {
    const decl = (o) => Object.entries(o || {}).map(([k, v]) => `--${k}: ${v};`).join(' ');
    const sel = `html[data-theme="${t.id}"]`;
    return [
        `${sel} { ${decl(t.vars)} ${decl(t.light)} }`,
        Object.keys(t.dark || {}).length ? `${sel}[data-mode="dark"] { ${decl(t.dark)} }` : '',
        t.css || '',
    ].filter(Boolean).join('\n');
}

// ---------------- 对比度 ----------------
function rgb(c) {
    const s = String(c || '').trim();
    let m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) return [...m[1]].map((x) => parseInt(x + x, 16));
    m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
    if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
    if (m) return [1, 2, 3].map((i) => Math.min(255, Number(m[i])));
    return null;
}
/** 两个颜色的对比度（1～21）。认不出的写法返回 null */
export function contrast(a, b) {
    const x = rgb(a);
    const y = rgb(b);
    if (!x || !y) return null;
    const lum = (c) => { const [r, g, bl] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
    const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p);
    return (hi + 0.05) / (lo + 0.05);
}
/** 看不清的组合：[{ mode, what, ratio }]。只查主题自己写了、又认得出的颜色 */
export function contrastIssues(t) {
    const out = [];
    for (const mode of ['light', 'dark']) {
        const c = t[mode] || {};
        const check = (fg, bg, what, min) => { const r = contrast(c[fg], c[bg]); if (r != null && r < min) out.push({ mode, what, ratio: Math.round(r * 10) / 10 }); };
        check('text', 'bg', '正文和背景', 4.5);
        check('text', 'surface', '正文和卡片底色', 4.5);
        check('text-2', 'surface', '次要文字和卡片底色', 3);
        check('on-accent', 'accent', '强调色和它上面的文字', 3);
    }
    return out;
}

// ---------------- 导入导出 ----------------
export const packTheme = (t) => ({ app: 'cardbox', kind: 'theme', name: t.name, base: t.base, light: t.light, dark: t.dark, vars: t.vars, css: t.css });
/** 从文件内容或 AI 的回答里取出主题：可以是纯 JSON，也可以夹在别的文字或代码块里 */
export function parseThemeText(text) {
    const s = String(text ?? '');
    const tries = [s];
    for (const m of s.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) tries.push(m[1]);
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a >= 0 && b > a) tries.push(s.slice(a, b + 1));
    for (const x of tries) {
        let o;
        try { o = JSON.parse(x.trim()); } catch { continue; }
        if (o && typeof o === 'object' && !Array.isArray(o) && (o.light || o.dark || o.vars || typeof o.css === 'string')) return o;
    }
    throw new Error('没找到主题数据。要的是一段 JSON，里面有 light、dark、vars、css 这几项');
}
