// 自定义主题：拿一套内置风格当底稿，改颜色、形状、字体，再加自己写的样式。
// 还可以生成一份「任务书」交给任何一个 AI 去设计，把它的回答贴回来导入。
import { h, clear, sheet, toast, icon, btn, confirmDialog, downloadBlob, debounce } from '../ui.js';
import { api } from '../api.js';
import { state, SKINS, applyAccent, reload } from '../state.js';
import { BASE_SKINS, COLOR_VARS, SHAPE_VARS, FONT_PRESETS, RATIOS, MAX_THEMES, cleanTheme, cssProblems, contrastIssues, packTheme, parseThemeText } from '../themecore.js';

const themes = () => (Array.isArray(state.settings.themes) ? state.settings.themes : []);
const newId = () => Math.random().toString(36).slice(2, 12);
const blank = (base = 'atelier') => ({ id: newId(), name: '我的主题', base: BASE_SKINS.includes(base) ? base : 'atelier', light: {}, dark: {}, vars: {}, css: '' });

async function saveThemes(list, active) {
    await api.put('/api/settings', { themes: list, theme: active });
    state.settings.themes = list;
    state.settings.theme = active;
    const t = list.find((x) => x.id === active);
    if (t) state.settings.skin = t.base;
    applyAccent();
    reload().catch(() => {});
}

/** 任意颜色写法 → #rrggbb（给系统的取色器用）；认不出就给灰色 */
function toHex(v) {
    try {
        const ctx = toHex.ctx || (toHex.ctx = document.createElement('canvas').getContext('2d'));
        ctx.fillStyle = '#888888';
        ctx.fillStyle = String(v || '').trim();
        const s = ctx.fillStyle;
        if (/^#[0-9a-f]{6}$/i.test(s)) return s;
        const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s);
        if (m) return `#${[1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('')}`;
    } catch { /* ignore */ }
    return '#888888';
}
const cssVar = (k) => getComputedStyle(document.documentElement).getPropertyValue(`--${k}`).trim();

// 设计时最常动的部件。任务书和编辑器里的提示都用这一份
const PARTS = [
    ['.topbar', '每一页顶上的标题栏'], ['.tb-title', '标题栏里的大标题'], ['.tb-kicker', '大标题上面的小字'],
    ['.sidebar', '电脑上左边的导航栏'], ['.nav-item / .nav-item.active', '导航里的一项 / 当前这项'], ['.tabbar', '手机底部的导航栏'],
    ['.seg-item / .seg-item.active', '类型分段（角色卡、世界书……）'], ['.search .search-input', '搜索框'],
    ['.card', '仓库里的一张卡片'], ['.card-media', '卡片的封面区域'], ['.card-title / .card-sub', '卡片的名称 / 小字'], ['.card-type', '封面上的类型角标'],
    ['.row-item', '列表视图里的一行'], ['.panel', '设置、统计里的面板'], ['.panel-head h3', '面板标题'],
    ['.btn / .btn.primary / .btn.ghost / .btn.danger', '按钮：普通 / 主要 / 无边框 / 危险'],
    ['.input / .textarea / .select', '输入框、下拉框'], ['.opt / .opt.active', '选项按钮 / 选中的'], ['.switch', '开关'],
    ['.tag', '标签'], ['.chip-s', '小标记'], ['.pill', '筛选条件的胶囊'],
    ['.sheet', '弹出的面板'], ['.sheet-head / .sheet-foot', '弹出面板的标题栏 / 底部按钮区'], ['.overlay', '弹出面板后面的遮罩'],
    ['.hero', '详情页顶部的大图区域'], ['.tabs button / .tabs button.active', '详情页的页签'], ['.toast', '底部弹出的提示'],
];

/** 给 AI 的任务书：说明界面是什么、能改什么、不能动什么、答卷长什么样 */
export function themeBrief({ name, base, wish }) {
    const cur = (list) => list.map(([k, label]) => `  --${k}　${label}`).join('\n');
    return [
        '请帮我为一个网页应用设计一套界面主题。请完整读完下面的说明，再按最后的格式回答。',
        '',
        '【应用是什么】',
        '「卡匣」是一个收藏管理工具，用来存放和整理角色卡、世界书、预设等文件。界面有：顶部标题栏和搜索框、类型分段、封面卡片组成的网格、列表、设置面板、从底部或中间弹出的面板。电脑上左边有导航栏，手机上导航在底部。',
        '',
        '【主题怎么生效】',
        `主题建立在一套内置风格之上，这次的底稿是「${SKINS[base]?.name || base}」（${SKINS[base]?.desc || ''}）。底稿决定版式和结构，主题在它上面改三样东西：`,
        '1. 颜色变量：浅色、深色各一套，两套都要给。',
        '2. 形状和字体变量：浅色深色共用。',
        '3. 高级样式：一段 CSS，可以改任何部件的外观。',
        '',
        '【颜色变量】（light 和 dark 各写一套，值用 #rrggbb 或 rgba()）',
        cur(COLOR_VARS),
        '',
        '【形状和字体变量】（写在 vars 里）',
        '  --radius / --radius-sm / --radius-lg　圆角，像素，如 "14px"',
        '  --title-size　大标题字号，像素，16～44',
        '  --title-weight　大标题粗细，300～900 的整百',
        `  --cover-ratio　封面比例，宽 / 高，如 ${RATIOS.map((r) => `"${r}"`).join('、')}`,
        '  --font / --font-head　正文 / 标题字体，只能用系统里常见的字体，写成字体列表',
        '  --shadow / --shadow-lg　卡片 / 弹窗的阴影，box-shadow 的写法',
        '',
        '【高级样式里可以改的部件】（选择器 → 是什么）',
        ...PARTS.map(([sel, what]) => `  ${sel}　${what}`),
        '写高级样式时，颜色尽量用上面的变量（如 var(--accent)），这样浅色深色都能跟着变。只在深色下生效的规则，前面加 html[data-mode="dark"]。',
        '',
        '【不能做的事】',
        '- 不能用 @import、url()、@font-face，不能加载任何图片、字体、网络资源。要图案就用渐变（linear-gradient、radial-gradient）画。',
        '- 不要改部件的排列方式和尺寸：不要写 display、position、float、width、height、grid、flex 相关的属性，也不要隐藏任何部件。可以改的是颜色、背景、边框、圆角、阴影、字体、字重、字距、内边距的小幅调整、过渡动画。',
        '- 正文和背景的对比度至少 4.5:1，强调色和它上面的文字至少 3:1，浅色深色都要满足。',
        '- 不要用 !important，除非不用就盖不过底稿。',
        '',
        '【我想要的风格】',
        wish?.trim() || '（没有特别要求，请你自己定一个统一、耐看的方向，并在回答开头用一句话说明。）',
        '',
        '【回答格式】',
        '先用一两句话说明设计思路，然后给出一个 JSON 代码块，只有这一个代码块，格式如下（没改的变量可以不写）：',
        '```json',
        JSON.stringify({ app: 'cardbox', kind: 'theme', name: name?.trim() || '主题名称', base, light: { bg: '#……', surface: '#……', text: '#……', accent: '#……' }, dark: { bg: '#……', surface: '#……', text: '#……', accent: '#……' }, vars: { radius: '14px', 'title-size': '26px' }, css: '/* 高级样式，写成一个字符串，换行用 \\n */' }, null, 2),
        '```',
    ].join('\n');
}

/** 检查一份要导入的主题，有问题先问；没问题或用户同意后打开编辑器让他看效果再保存 */
async function importTheme(raw, fallbackName = '') {
    let t;
    try {
        const o = parseThemeText(raw);
        t = cleanTheme({ ...o, id: newId(), name: o.name || fallbackName });
    } catch (e) { toast(e.message, 'err'); return false; }
    if (!Object.keys(t.light).length && !Object.keys(t.dark).length && !Object.keys(t.vars).length && !t.css.trim()) { toast('这份主题里没有可以用的内容', 'err'); return false; }
    const bad = contrastIssues(t);
    if (bad.length && !(await confirmDialog(`这套主题有 ${bad.length} 处可能看不清：\n${bad.map((b) => `${b.mode === 'dark' ? '深色' : '浅色'}：${b.what}，对比度 ${b.ratio}`).join('\n')}\n\n可以先导入，在编辑器里调。`, { title: '对比度偏低', ok: '还是导入' }))) return false;
    editTheme(t, { isNew: true });
    return true;
}

/** 让 AI 设计：生成任务书 → 复制给 AI → 把回答贴回来 */
export function openThemeBrief() {
    let base = SKINS[state.settings.skin] ? state.settings.skin : 'atelier';
    const name = h('input', { class: 'input', placeholder: '给主题起个名字，比如「雨夜」', maxlength: 30, oninput: () => draw() });
    const wish = h('textarea', { class: 'textarea', rows: 3, placeholder: '想要什么感觉？比如：深夜咖啡馆，暖黄的灯，木头和奶油色；标题用宋体', oninput: () => draw() });
    const out = h('textarea', { class: 'textarea code brief-out', readOnly: true, spellcheck: false });
    const answer = h('textarea', { class: 'textarea code brief-in', spellcheck: false, placeholder: '把 AI 的整段回答粘贴到这里（带着说明文字也行，会自动找出里面的主题数据）' });
    const baseBox = h('div', { class: 'opts' });
    const draw = () => {
        clear(baseBox, BASE_SKINS.map((k) => h('button', { class: `opt ${base === k ? 'active' : ''}`, title: SKINS[k].desc, onclick: () => { base = k; draw(); } }, SKINS[k].name)));
        out.value = themeBrief({ name: name.value, base, wish: wish.value });
    };
    const s = sheet({
        title: '让 AI 设计一套主题', full: true,
        body: h('div', { class: 'stack' },
            h('div', { class: 'note' }, icon('info', { size: 15 }), '这里不会调用你配置的 AI 服务。它生成一份任务书，你复制给任何一个 AI（网页版的也行），再把回答贴回来。'),
            h('div', { class: 'fields' },
                h('div', { class: 'field wide' }, h('label', {}, '1. 选一套底稿（决定版式和结构）'), baseBox),
                h('div', { class: 'field wide' }, h('label', {}, '2. 名字和想要的风格'), name, wish),
                h('div', { class: 'field wide' }, h('label', {}, '3. 把这份任务书复制给 AI'), out,
                    h('div', { class: 'row-actions' }, btn('复制任务书', { icon: 'copy', cls: 'primary sm', onclick: async () => {
                        try { await navigator.clipboard.writeText(out.value); toast('已复制，去贴给 AI 吧', 'ok'); } catch { out.select(); toast('自动复制没成功，已经帮你全选了，按 Ctrl+C 或长按复制', 'err'); }
                    } }))),
                h('div', { class: 'field wide' }, h('label', {}, '4. 把 AI 的回答贴回来'), answer,
                    h('div', { class: 'muted small' }, '导入前会检查：不允许加载外部资源，看不清的配色会提醒。导入后先看效果，满意再保存。')))),
        foot: [btn('关闭', { onclick: () => s.close() }),
            btn('导入这套主题', { icon: 'check', cls: 'primary', onclick: async () => {
                if (!answer.value.trim()) { toast('先把 AI 的回答贴进来', 'err'); answer.focus(); return; }
                if (await importTheme(answer.value, name.value)) s.close();
            } })],
    });
    draw();
}

/** 编辑一套主题。改动马上套在整个界面上看效果，取消就还原 */
export function editTheme(orig = null, { isNew = !orig } = {}) {
    const t = structuredClone(orig || blank(SKINS[state.settings.skin] ? state.settings.skin : 'atelier'));
    for (const k of ['light', 'dark', 'vars']) if (!t[k] || typeof t[k] !== 'object') t[k] = {};
    let tab = 'color';
    let mode = document.documentElement.dataset.mode === 'dark' ? 'dark' : 'light';
    let saved = false;
    const before = JSON.stringify(t);
    const apply = () => { state.themeDraft = t; state.themeDraftMode = mode; applyAccent(); };
    const applySoon = debounce(apply, 120);
    const body = h('div', { class: 'theme-edit' });
    const warn = h('div', { class: 'theme-warn' });
    const end = () => { state.themeDraft = null; state.themeDraftMode = null; applyAccent(); peekBtn?.remove(); };

    // 样例：编辑器挡住了页面，这里放几个常见部件，改了马上能看到
    const sample = () => h('div', { class: 'theme-sample' },
        h('div', { class: 'panel' },
            h('div', { class: 'panel-head' }, icon('palette', { size: 16 }), h('h3', {}, '样例')),
            h('div', {}, '正文文字 ', h('span', { style: { color: 'var(--text-2)' } }, '次要文字 '), h('span', { style: { color: 'var(--text-3)' } }, '提示文字')),
            h('div', { class: 'row-actions wrap' }, btn('主要按钮', { cls: 'primary sm' }), btn('普通按钮', { cls: 'sm' }), btn('危险', { cls: 'danger sm' }),
                h('span', { class: 'tag' }, '标签'), h('span', { class: 'chip-s ok' }, '通过'), h('span', { class: 'chip-s warn' }, '提醒'), h('span', { class: 'chip-s info' }, '说明')),
            h('div', { class: 'opts' }, h('button', { class: 'opt active' }, '选中的'), h('button', { class: 'opt' }, '没选的')),
            h('input', { class: 'input', placeholder: '输入框' })));

    const drawWarn = () => {
        const bad = contrastIssues(t);
        const css = cssProblems(t.css);
        clear(warn,
            css.length ? h('div', { class: 'note warn' }, icon('alert', { size: 15 }), h('span', {}, `高级样式有问题，改好才能保存：${css.join('；')}`)) : null,
            bad.length ? h('div', { class: 'note' }, icon('eye', { size: 15 }), h('span', {}, `可能看不清：${bad.map((b) => `${b.mode === 'dark' ? '深色' : '浅色'}的${b.what}（对比度 ${b.ratio}）`).join('；')}`)) : null);
    };
    const changed = () => { applySoon(); drawWarn(); };

    function colorTab() {
        const set = t[mode];
        return [
            h('div', { class: 'toolbar-row' }, h('span', { class: 'sub-label grow' }, '正在改'),
                h('div', { class: 'opts' }, [['light', '浅色', 'sun'], ['dark', '深色', 'moon']].map(([m, label, ic]) => h('button', { class: `opt ${mode === m ? 'active' : ''}`, onclick: () => { mode = m; apply(); draw(); } }, icon(ic, { size: 14 }), label)))),
            h('div', { class: 'muted small' }, '没改的颜色跟着底稿走。界面已经切到你正在改的那一套，关掉编辑器会切回去。'),
            h('div', { class: 'theme-colors' }, COLOR_VARS.map(([k, label]) => {
                const own = k in set;
                const text = h('input', { class: 'input sm theme-val', value: set[k] || '', placeholder: '跟随底稿', spellcheck: false, dataset: { k },
                    // 重画放到事件之后：正在处理输入框自己的事件时把它换掉，浏览器会报错
                    onchange: () => { const v = text.value.trim(); if (v) set[k] = v; else delete set[k]; apply(); setTimeout(draw, 0); } });
                const pick = h('input', { type: 'color', class: 'theme-pick', value: toHex(set[k] || cssVar(k)), title: label,
                    oninput: () => { set[k] = pick.value; text.value = pick.value; row.classList.add('own'); changed(); } });
                const row = h('div', { class: `theme-color ${own ? 'own' : ''}` }, pick,
                    h('div', { class: 'theme-color-name' }, h('b', {}, label), h('span', { class: 'muted small' }, `--${k}`)), text,
                    own ? h('button', { class: 'btn ghost sm icon', title: '改回跟随底稿', onclick: () => { delete set[k]; apply(); draw(); } }, icon('restore', { size: 14 })) : h('span', { class: 'theme-nil' }));
                return row;
            })),
        ];
    }

    function shapeTab() {
        const v = t.vars;
        const setVar = (k, val) => { if (val === '' || val == null) delete v[k]; else v[k] = val; changed(); };
        return h('div', { class: 'fields' }, SHAPE_VARS.map(([k, label, kind, extra]) => {
            let ctl;
            if (kind === 'px') {
                const cur = parseFloat(v[k] ?? cssVar(k)) || 0;
                const num = h('span', { class: 'theme-num' }, k in v ? v[k] : '跟随底稿');
                const range = h('input', { type: 'range', min: extra[0], max: extra[1], step: 1, value: cur, oninput: () => { num.textContent = `${range.value}px`; setVar(k, `${range.value}px`); } });
                ctl = h('div', { class: 'theme-range' }, range, num, k in v ? h('button', { class: 'btn ghost sm icon', title: '改回跟随底稿', onclick: () => { delete v[k]; apply(); draw(); } }, icon('restore', { size: 14 })) : null);
            } else if (kind === 'weight') {
                ctl = h('select', { class: 'select', onchange: (e) => setVar(k, e.target.value) }, h('option', { value: '' }, '跟随底稿'), [300, 400, 500, 600, 700, 800, 900].map((n) => h('option', { value: n, selected: String(v[k]) === String(n) }, n)));
            } else if (kind === 'ratio') {
                ctl = h('select', { class: 'select', onchange: (e) => setVar(k, e.target.value) }, h('option', { value: '' }, '跟随底稿'), RATIOS.map((r) => h('option', { value: r, selected: v[k] === r }, r.replace(' / ', ' : '))));
            } else if (kind === 'font') {
                const preset = FONT_PRESETS.find(([, stack]) => stack === v[k]);
                const custom = h('input', { class: 'input', value: v[k] && !preset ? v[k] : '', placeholder: '字体列表，如 "LXGW WenKai", serif', hidden: !(v[k] && !preset), spellcheck: false, onchange: () => setVar(k, custom.value.trim()) });
                const sel = h('select', { class: 'select', onchange: () => {
                    custom.hidden = sel.value !== '~';
                    if (sel.value === '~') { custom.focus(); return; }
                    setVar(k, sel.value);
                } }, h('option', { value: '' }, '跟随底稿'), FONT_PRESETS.map(([name, stack]) => h('option', { value: stack, selected: v[k] === stack }, name)), h('option', { value: '~', selected: Boolean(v[k] && !preset) }, '自己写'));
                ctl = h('div', { class: 'stack-s' }, sel, custom);
            } else {
                const input = h('input', { class: 'input', value: v[k] || '', placeholder: '跟随底稿；写法同 box-shadow', spellcheck: false, onchange: () => setVar(k, input.value.trim()) });
                ctl = input;
            }
            return h('div', { class: `field ${kind === 'text' || kind === 'font' ? 'wide' : ''}`, dataset: { k } }, h('label', {}, label), ctl);
        }));
    }

    function cssTab() {
        const ta = h('textarea', { class: 'textarea code theme-css', spellcheck: false, value: t.css, placeholder: '/* 例：卡片加一圈描边，标题换个颜色 */\n.card { border: 2px solid var(--accent); }\n.tb-title { color: var(--accent); letter-spacing: .08em; }\n\n/* 只在深色下生效 */\nhtml[data-mode="dark"] .card { box-shadow: 0 0 18px -6px var(--accent); }',
            oninput: () => { t.css = ta.value; if (!cssProblems(t.css).length) applySoon(); drawWarn(); } });
        return [
            h('div', { class: 'muted small' }, '这里写的 CSS 只在用这套主题时生效，想改哪个部件就写它的选择器。颜色尽量用变量（var(--accent) 这样），浅色深色都能跟着变。不能加载外部的图片和字体。'),
            ta,
            h('details', { class: 'fold' }, h('summary', {}, icon('chevronRight', { size: 14, cls: 'fold-chev' }), h('span', { class: 'fold-title' }, '常用部件的选择器')),
                h('div', { class: 'fold-body theme-parts' }, PARTS.map(([sel, what]) => h('div', { class: 'theme-part' }, h('code', {}, sel), h('span', { class: 'muted' }, what))))),
            h('div', { class: 'muted small' }, `万一把界面改得点不到设置了：在地址后面加上 ?notheme 再打开，这一次不会套自定义主题。`),
        ];
    }

    const tools = () => h('div', { class: 'row-actions wrap theme-tools' },
            !isNew ? btn('删除', { icon: 'trash', cls: 'sm ghost danger', onclick: async () => {
                if (!(await confirmDialog(`删除主题「${t.name}」？`, { danger: true, ok: '删除' }))) return;
                try { await saveThemes(themes().filter((x) => x.id !== t.id), state.settings.theme === t.id ? '' : state.settings.theme || ''); saved = true; s.close(); toast('已删除', 'ok'); } catch (e) { toast(e.message, 'err'); }
            } }) : null,
            btn('导出', { icon: 'download', cls: 'sm ghost', onclick: () => downloadBlob(new Blob([JSON.stringify(packTheme(t), null, 2)], { type: 'application/json' }), `Cardbox-主题-${t.name || '未命名'}.json`) }),
            btn('看整页', { icon: 'eye', cls: 'sm', onclick: peek }));
    const nameInput = h('input', { class: 'input', value: t.name, maxlength: 30, placeholder: '主题名称', oninput: () => { t.name = nameInput.value; } });
    function draw() {
        const baseSel = h('select', { class: 'select theme-base', onchange: () => { t.base = baseSel.value; apply(); draw(); } }, BASE_SKINS.map((k) => h('option', { value: k, selected: t.base === k }, `${SKINS[k].name} · ${SKINS[k].desc}`)));
        clear(body,
            h('div', { class: 'fields' },
                h('div', { class: 'field' }, h('label', {}, '名称'), nameInput),
                h('div', { class: 'field' }, h('label', {}, '底稿（决定版式和结构）'), baseSel)),
            sample(),
            tools(),
            warn,
            h('div', { class: 'opts theme-tabs' }, [['color', '颜色', 'palette'], ['shape', '形状和字体', 'type'], ['css', '高级样式', 'braces']].map(([k, label, ic]) => h('button', { class: `opt ${tab === k ? 'active' : ''}`, onclick: () => { tab = k; draw(); } }, icon(ic, { size: 14 }), label, k === 'css' && t.css.trim() ? h('span', { class: 'opt-n' }, `${t.css.split('\n').length} 行`) : null))),
            h('div', { class: 'theme-tab stack' }, tab === 'color' ? colorTab() : tab === 'shape' ? shapeTab() : cssTab()));
        drawWarn();
    }

    // 看整页：先把编辑器藏起来，留一个按钮回来
    let peekBtn = null;
    const peek = () => {
        const ov = s.el.closest('.overlay') || s.el;
        ov.style.display = 'none';
        peekBtn = h('button', { class: 'btn primary theme-peek', onclick: () => { ov.style.display = ''; peekBtn.remove(); peekBtn = null; } }, icon('pencil', { size: 15 }), '回到编辑');
        document.body.append(peekBtn);
    };

    const s = sheet({
        title: isNew ? '新建主题' : `编辑主题 · ${t.name}`, full: true, body,
        onClose: () => { if (!saved) end(); else { state.themeDraft = null; state.themeDraftMode = null; applyAccent(); } },
        beforeClose: async () => saved || JSON.stringify(t) === before && !isNew || confirmDialog('这套主题还没保存，确定放弃？', { ok: '放弃', danger: true }),
        foot: [
            btn('取消', { onclick: () => s.tryClose() }),
            btn('保存并使用', { icon: 'check', cls: 'primary', onclick: async (e) => {
                const b = e.currentTarget;
                let clean;
                try { clean = cleanTheme(t); } catch (err) { toast(err.message, 'err'); tab = 'css'; draw(); return; }
                const list = themes().some((x) => x.id === clean.id) ? themes().map((x) => (x.id === clean.id ? clean : x)) : [...themes(), clean];
                if (list.length > MAX_THEMES) { toast(`最多存 ${MAX_THEMES} 套主题，先删掉几套`, 'err'); return; }
                b.disabled = true;
                try { await saveThemes(list, clean.id); saved = true; s.close(); toast(`已保存，正在用「${clean.name}」`, 'ok'); } catch (err) { toast(err.message, 'err'); b.disabled = false; }
            } }),
        ],
    });
    s.el.classList.add('theme-sheet');
    draw();
    apply();
}

/** 外观页里「我的主题」那一块 */
export function themesPanel({ preview, rerender }) {
    const list = themes();
    const active = state.settings.theme || '';
    const file = h('input', { type: 'file', accept: '.json,application/json,text/plain', hidden: true, onchange: async () => {
        const f = file.files[0];
        file.value = '';
        if (f) importTheme(await f.text(), f.name.replace(/\.[^.]+$/, '').replace(/^Cardbox-主题-/, ''));
    } });
    const use = async (id) => { try { await saveThemes(list, id); rerender(); } catch (e) { toast(e.message, 'err'); } };
    return [
        list.length ? h('div', { class: 'skin-grid theme-grid' }, list.map((t) => {
            const mode = document.documentElement.dataset.mode === 'dark' ? 'dark' : 'light';
            const pv = preview(t.base);
            const vars = { ...t.vars, ...t.light, ...(mode === 'dark' ? t.dark : {}) };
            for (const [k, v] of Object.entries(vars)) pv.style.setProperty(`--${k}`, v);
            return h('div', { class: `skin-opt theme-opt ${active === t.id ? 'active' : ''}`, role: 'button', tabindex: 0, onclick: () => use(t.id) },
                pv, h('div', { class: 'skin-name' }, h('b', {}, t.name), h('span', {}, `底稿：${SKINS[t.base]?.name || t.base}${t.css.trim() ? ' · 有高级样式' : ''}`)),
                active === t.id ? h('span', { class: 'skin-check' }, icon('check', { size: 13, stroke: 3 })) : null,
                h('button', { class: 'btn sm ghost icon theme-edit-btn', title: '编辑这套主题', onclick: (e) => { e.stopPropagation(); editTheme(t); } }, icon('pencil', { size: 14 })));
        })) : h('div', { class: 'muted small' }, '还没有自己的主题。可以拿一套内置风格当底稿改，也可以让 AI 帮你设计。'),
        h('div', { class: 'row-actions wrap' },
            btn('新建主题', { icon: 'plus', cls: 'sm', onclick: () => editTheme(null) }),
            btn('让 AI 设计', { icon: 'sparkles', cls: 'sm', onclick: () => openThemeBrief() }),
            btn('导入主题文件', { icon: 'upload', cls: 'sm ghost', onclick: () => file.click() }),
            file),
    ];
}
