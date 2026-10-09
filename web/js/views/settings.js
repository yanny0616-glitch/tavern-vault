// 设置
import { h, clear, toast, confirmDialog, choiceDialog, sheet, downloadBlob, switchEl, icon, btn, fmtBytes } from '../ui.js';
import { api } from '../api.js';
import { bridge } from '../bridge.js';
import { state, savePrefs, applyAccent, reload, TYPE_META, SKINS } from '../state.js';
import { SORTS } from './library.js';
import { topbar, ensureView } from './common.js';
import { aiSettings } from './ai.js';

const KINDS = { text: '单行文本', textarea: '多行文本', number: '数字', url: '链接', date: '日期', select: '下拉选择', tags: '标签列表', checkbox: '开关', rating: '星级评分', color: '颜色' };
const PLUGIN_REPO = 'https://github.com/yanny0616-glitch/tavern-vault';
const ACCENTS = ['', '#8b4a2b', '#007aff', '#d4a24c', '#e0607e', '#c23a2b', '#22d3ee', '#2f8f6f', '#8a5cb8'];

const SECTIONS = [
    { key: 'appearance', title: '外观', icon: 'palette', desc: () => `${SKINS[state.settings.skin]?.name || '典藏'} · ${{ auto: '跟随系统', light: '浅色', dark: '深色' }[state.prefs.mode || 'auto']}`, render: appearance },
    { key: 'browse', title: '浏览', icon: 'grid', desc: () => '打开页面、卡片显示、详情页', render: browse },
    { key: 'import', title: '导入', icon: 'upload', desc: () => `同时上传 ${state.prefs.uploadConc || 3} 个 · 同名${CONFLICTS[state.prefs.conflict] || CONFLICTS.ask}`, render: importPrefs },
    { key: 'fields', title: '自定义字段', icon: 'sliders', desc: () => `${state.fields.filter((f) => !f.hidden).length} 个字段在用`, render: fieldsSection },
    { key: 'ai', title: 'AI 助手', icon: 'sparkles', desc: () => (state.settings.ai?.ready ? '已配置' : '还没有配置'), render: () => panel('AI 助手', 'sparkles', null, aiSettings()) },
    { key: 'connect', title: '连接与设备', icon: 'beer', desc: () => (bridge.host ? `已连接 ${bridge.host.host}` : '酒馆插件、iPhone'), render: () => [connection(), shortcut()] },
    { key: 'security', title: '访问密码', icon: 'lock', desc: () => (state.settings.auth ? '已启用' : '未设置'), render: security },
    { key: 'data', title: '数据与存储', icon: 'database', desc: () => `${state.stats?.total ?? 0} 项 · ${fmtBytes(state.stats?.bytes || 0)}`, render: data },
    { key: 'about', title: '关于', icon: 'info', desc: () => `v${state.settings.version || '1.0.0'}`, render: about },
];
const CONFLICTS = { ask: '每次询问', version: '存为新版本', new: '另存为新条目', skip: '跳过' };
const wideMq = matchMedia('(min-width: 900px)');
let lastSec = null;

const rerender = () => renderSettings(document.querySelector('main.main'));
wideMq.addEventListener?.('change', () => { if (document.documentElement.dataset.route === 'settings') rerender(); });

export function renderSettings(root) {
    const refs = ensureView(root, 'settings', () => {
        const nav = h('nav', { class: 'set-nav' });
        const content = h('div', { class: 'set-content stack' });
        const layout = h('div', { class: 'set-layout' }, nav, content);
        root.append(topbar('设置', { kicker: 'Preferences' }), h('div', { class: 'page' }, layout));
        return { nav, content, layout };
    });
    if (refs.content.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    const key = location.hash.split('?')[0].split('/')[2] || '';
    // 手机：先显示分类列表，点进去是单独一页；电脑：左边分类，右边内容
    const sec = SECTIONS.find((x) => x.key === key) || (wideMq.matches ? SECTIONS[0] : null);
    refs.layout.classList.toggle('has-sec', !!key);
    clear(refs.nav, h('div', { class: 'rows' }, SECTIONS.map((x) => h('a', { class: `row-item set-nav-item ${sec === x ? 'selected' : ''}`, href: `#/settings/${x.key}` },
        h('div', { class: 'row-thumb' }, icon(x.icon, { size: 19 })),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, h('span', {}, x.title)), h('div', { class: 'row-sub' }, h('span', {}, x.desc()))),
        icon('chevronRight', { size: 16, cls: 'row-chev' })))),
    h('div', { class: 'footnote' }, `TavernVault v${state.settings.version || '1.0.0'} · ${bridge.host ? `已连接 ${bridge.host.host}` : '独立网页模式'}`));
    if (!sec) { clear(refs.content); lastSec = null; return; }
    clear(refs.content,
        h('div', { class: 'set-head' },
            h('a', { class: 'set-back', href: '#/settings' }, icon('chevronLeft', { size: 18 }), h('span', {}, '设置')),
            h('h2', { class: 'set-title' }, sec.title)),
        sec.render());
    if (lastSec !== sec.key) window.scrollTo(0, 0);
    lastSec = sec.key;
}

function panel(title, ic, head, ...children) {
    return h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, icon(ic, { size: 16 }), h('h3', {}, title), head ? h('span', { class: 'grow' }) : null, head), children);
}

/** 一行设置：左边名称和说明，右边开关 / 选项 */
function setRow(label, desc, control) {
    return h('div', { class: `set-row ${control.classList?.contains('switch') ? 'inline' : ''}` },
        h('div', { class: 'set-row-text' }, h('div', { class: 'set-row-label' }, label), desc ? h('div', { class: 'set-row-desc' }, desc) : null),
        h('div', { class: 'set-row-ctl' }, control));
}
function seg(value, options, onPick) {
    return h('div', { class: 'opts' }, options.map(([v, label, ic]) => h('button', { class: `opt ${value === v ? 'active' : ''}`, onclick: () => onPick(v) }, ic ? icon(ic, { size: 14 }) : null, label)));
}
function setPref(patch) {
    Object.assign(state.prefs, patch);
    savePrefs();
    applyAccent();
    rerender();
}
const deviceNote = () => h('div', { class: 'muted small set-note' }, icon('phone', { size: 13 }), h('span', {}, '这一页的设置只对这台设备生效，手机和电脑可以分别设置。'));

function skinPreview(key) {
    const mode = document.documentElement.dataset.mode;
    return h('div', { class: 'skin-pv', dataset: { skin: key, mode } },
        h('div', { class: 'pv-top' }, h('span', { class: 'pv-kicker' }, SKINS[key].en), h('span', { class: 'pv-title' }, '藏馆')),
        h('div', { class: 'pv-tabs' }, h('i', { class: 'on' }), h('i'), h('i')),
        h('div', { class: 'pv-cards' },
            h('div', { class: 'pv-card' }, h('div', { class: 'pv-img' }), h('b')),
            h('div', { class: 'pv-card pv-doc' }, h('div', { class: 'pv-lines' }, h('i'), h('i'), h('i')), h('b'))),
        h('div', { class: 'pv-nav' }, h('i', { class: 'on' }), h('i'), h('i'), h('i')));
}

function appearance() {
    const current = SKINS[state.settings.skin] ? state.settings.skin : 'atelier';
    const title = h('input', { class: 'input', value: state.settings.title || '', placeholder: '酒馆藏馆', onchange: () => api.put('/api/settings', { title: title.value }) });
    return [
        panel('风格', 'palette', null,
            h('div', { class: 'skin-grid' }, Object.entries(SKINS).map(([k, v]) => h('button', {
                class: `skin-opt ${current === k ? 'active' : ''}`,
                onclick: async () => {
                    state.settings.skin = k;
                    applyAccent();
                    await api.put('/api/settings', { skin: k });
                },
            }, skinPreview(k), h('div', { class: 'skin-name' }, h('b', {}, v.name), h('span', {}, v.desc)), current === k ? h('span', { class: 'skin-check' }, icon('check', { size: 13, stroke: 3 })) : null))),
            h('div', { class: 'muted small' }, '风格、强调色和仓库名称对所有设备生效（网页和酒馆插件里一致）。'),
            setRow('强调色', '按钮、选中状态等使用的颜色', h('div', { class: 'color-picker' }, ACCENTS.map((c) => h('button', {
                class: `${(state.settings.accent || '') === c ? 'active' : ''} ${c ? '' : 'auto'}`, style: { '--sw': c || 'var(--accent)' }, title: c || '跟随风格',
                onclick: () => api.put('/api/settings', { accent: c }),
            })))),
            setRow('仓库名称', '显示在浏览器标签和登录页上', title)),
        panel('这台设备', 'monitor', null,
            setRow('明暗', null, seg(state.prefs.mode || 'auto', [['auto', '跟随系统', 'monitor'], ['light', '浅色', 'sun'], ['dark', '深色', 'moon']], (v) => setPref({ mode: v }))),
            setRow('阅读字号', '详情页里简介、开场白、角色卡内容的文字大小', seg(state.prefs.readSize || 'md', [['sm', '小'], ['md', '标准'], ['lg', '大'], ['xl', '特大']], (v) => setPref({ readSize: v }))),
            setRow('减少动画', '关闭弹出、切换时的过渡动画，旧手机上更跟手', switchEl(!!state.prefs.reduceMotion, (v) => setPref({ reduceMotion: v })))),
    ];
}

function browse() {
    const p = state.prefs;
    const viewVal = p.view === 'list' ? 'list' : p.dense ? 'dense' : 'grid';
    const cols = h('select', { class: 'select', onchange: () => setPref({ cols: Number(cols.value) }) },
        [0, 1, 2, 3, 4, 5, 6].map((n) => h('option', { value: n, selected: (p.cols || 0) === n }, n ? `${n} 个` : '自动')));
    const sort = h('select', { class: 'select', onchange: () => setPref({ sort: sort.value }) },
        Object.entries(SORTS).map(([k, [label]]) => h('option', { value: k, selected: (p.sort || 'updated') === k }, label)));
    const userName = h('input', { class: 'input', value: p.userName || '', placeholder: '你', maxlength: 20, onchange: () => setPref({ userName: userName.value.trim() }) });
    return [
        deviceNote(),
        panel('打开与视图', 'grid', null,
            setRow('打开时进入', null, seg(p.start || 'library', [['library', '仓库'], ['collections', '合集'], ['stats', '统计']], (v) => setPref({ start: v }))),
            setRow('仓库视图', null, seg(viewVal, [['grid', '卡片', 'grid'], ['dense', '紧凑', 'grid3'], ['list', '列表', 'list']], (v) => setPref({ view: v === 'list' ? 'list' : 'grid', dense: v === 'dense' }))),
            setRow('每行显示', '卡片视图下每行放几个，「自动」按屏幕宽度决定', cols),
            setRow('默认排序', null, sort)),
        panel('卡片上显示', 'image', null,
            setRow('标签', null, switchEl(p.showTags !== false, (v) => setPref({ showTags: v }))),
            setRow('评分', null, switchEl(p.showRating !== false, (v) => setPref({ showRating: v }))),
            setRow('编号', '卡片角上的 No.001', switchEl(p.showNo !== false, (v) => setPref({ showNo: v }))),
            setRow('模糊 NSFW 封面', '资料里勾了 NSFW 的条目，在列表里模糊封面；打开详情时正常显示', switchEl(!!p.blurNsfw, (v) => setPref({ blurNsfw: v })))),
        panel('详情页', 'fileText', null,
            setRow('打开时先显示', null, seg(p.detailTab === 'content' ? 'content' : 'overview', [['overview', '介绍'], ['content', '内容']], (v) => setPref({ detailTab: v }))),
            setRow('{{user}} 显示为', '角色卡里出现 {{user}} 的地方替换成这个称呼', userName)),
    ];
}

function importPrefs() {
    const p = state.prefs;
    return [
        panel('这台设备', 'upload', null,
            setRow('同时上传', '一次导入很多文件时同时传几个；网络不稳定可以调小', seg(Number(p.uploadConc) || 3, [1, 2, 3, 4, 5, 6].map((n) => [n, String(n)]), (v) => setPref({ uploadConc: v }))),
            setRow('同名条目', '导入的文件和已有条目同名但内容不同时怎么处理。内容完全一样的会自动跳过', seg(CONFLICTS[p.conflict] ? p.conflict : 'ask', Object.entries(CONFLICTS), (v) => setPref({ conflict: v })))),
        syncExcludePanel(),
    ];
}

/** 从酒馆同步时排除的世界书条目（所有设备共用） */
function syncExcludePanel() {
    const rules = [...(state.settings.syncExclude || [])];
    const save = async (next) => {
        await api.put('/api/settings', { syncExclude: next });
        toast('已保存', 'ok');
    };
    const input = h('input', { class: 'input', placeholder: '条目标题里的文字，例如 TavernDB-ACU', maxlength: 60, onkeydown: (e) => { if (e.key === 'Enter') add(); } });
    const add = () => {
        const v = input.value.trim();
        if (!v) return;
        if (!rules.includes(v)) save([...rules, v]);
        input.value = '';
    };
    return panel('从酒馆同步时排除', 'beer', null,
        h('div', { class: 'muted small' }, '酒馆保存角色卡时，会把角色主绑定的世界书整本写进卡里，总结类脚本（例如「数据库」）写进这本世界书的条目也会跟着进来。'
            + '标题包含下面任一文字的条目，在从酒馆收藏、存为新版本、对比和判断是否同步时都会去掉；酒馆里的数据不受影响。对所有设备生效。'),
        h('div', { class: 'rule-list' }, rules.length
            ? rules.map((r) => h('span', { class: 'rule-chip' }, h('code', {}, r), h('button', { title: '删除', onclick: () => save(rules.filter((x) => x !== r)) }, icon('x', { size: 12 }))))
            : h('span', { class: 'muted small' }, '没有规则，酒馆世界书里的条目会全部同步')),
        h('div', { class: 'input-group' }, input, btn('添加', { icon: 'plus', onclick: add })),
        h('div', { class: 'row-actions' }, btn('恢复默认', { cls: 'sm ghost', onclick: () => save(['TavernDB-ACU']) })));
}

function fieldsSection() {
    const fields = structuredClone(state.fields);
    const list = h('div', { class: 'field-list' });
    const saveBtn = btn('保存', { cls: 'sm primary', disabled: true, onclick: async () => {
        await api.put('/api/fields', { fields });
        saveBtn.disabled = true;
        toast('字段已保存', 'ok');
    } });
    const mark = () => { saveBtn.disabled = false; };
    const draw = () => clear(list, fields.map((f, i) => h('div', { class: `field-def ${f.hidden ? 'off' : ''}` },
        h('div', { class: 'grow min0' },
            h('div', { class: 'field-def-name' }, f.label, f.builtin ? h('span', { class: 'chip-s' }, '内置') : null),
            h('div', { class: 'field-def-meta' }, KINDS[f.kind] || f.kind, ' · ', f.types?.length ? f.types.map((t) => TYPE_META[t]?.label).join('、') : '所有类型')),
        switchEl(!f.hidden, (v) => { f.hidden = !v; mark(); draw(); }),
        h('div', { class: 'field-def-acts' },
            btn('', { icon: 'arrowUp', cls: 'sm ghost', disabled: i === 0, onclick: () => { [fields[i - 1], fields[i]] = [fields[i], fields[i - 1]]; mark(); draw(); } }),
            btn('', { icon: 'arrowDown', cls: 'sm ghost', disabled: i === fields.length - 1, onclick: () => { [fields[i + 1], fields[i]] = [fields[i], fields[i + 1]]; mark(); draw(); } }),
            btn('', { icon: 'pencil', cls: 'sm ghost', onclick: () => editField(f, (nf) => { fields[i] = nf; mark(); draw(); }) }),
            !f.builtin ? btn('', { icon: 'trash', cls: 'sm ghost danger', onclick: () => { fields.splice(i, 1); mark(); draw(); } }) : null))));
    draw();
    return panel('字段列表', 'sliders', h('div', { class: 'row-actions' },
        btn('新增', { icon: 'plus', cls: 'sm', onclick: () => editField({ id: `f_${Date.now().toString(36)}`, label: '', kind: 'text', types: [], options: [] }, (nf) => { fields.push(nf); mark(); draw(); }) }),
        saveBtn),
    h('div', { class: 'muted small' }, '决定每个条目详情里记录哪些信息。可以限定只对某些类型显示，例如只给角色卡加「推荐模型」。'),
    list,
    btn('恢复默认字段', { icon: 'restore', cls: 'sm ghost', onclick: async () => {
        if (await confirmDialog('恢复为默认字段？已填写的数据不会丢失，只是字段定义会重置。')) { await api.post('/api/fields/reset'); toast('已恢复默认'); }
    } }));
}

function editField(f, onSave) {
    const nf = structuredClone(f);
    const label = h('input', { class: 'input', value: nf.label, placeholder: '例如「推荐模型」' });
    const options = h('textarea', { class: 'textarea', value: (nf.options || []).join('\n'), placeholder: '每行一个选项' });
    const optRow = h('div', { class: 'field wide', hidden: nf.kind !== 'select' }, h('label', {}, '选项'), options);
    const kind = h('select', { class: 'select', disabled: nf.builtin, onchange: () => { optRow.hidden = kind.value !== 'select'; } },
        Object.entries(KINDS).map(([k, l]) => h('option', { value: k, selected: nf.kind === k }, l)));
    const types = new Set(nf.types || []);
    const typeBox = h('div', { class: 'opts' });
    const drawTypes = () => clear(typeBox, Object.entries(TYPE_META).map(([k, v]) => h('button', { class: `opt ${types.has(k) ? 'active' : ''}`, onclick: () => { types.has(k) ? types.delete(k) : types.add(k); drawTypes(); } }, icon(v.icon, { size: 13 }), v.label)));
    drawTypes();
    const s = sheet({
        title: f.label ? `编辑字段 · ${f.label}` : '新增字段',
        body: h('div', { class: 'fields' },
            h('div', { class: 'field' }, h('label', {}, '名称'), label),
            h('div', { class: 'field' }, h('label', {}, '类型'), kind),
            optRow,
            h('div', { class: 'field wide' }, h('label', {}, '适用于（都不选 = 所有类型）'), typeBox)),
        foot: [btn('取消', { onclick: () => s.close() }), btn('确定', { icon: 'check', cls: 'primary', onclick: () => {
            if (!label.value.trim()) { toast('请输入字段名称', 'err'); return; }
            Object.assign(nf, { label: label.value.trim(), kind: kind.value, options: options.value.split('\n').map((x) => x.trim()).filter(Boolean), types: [...types] });
            onSave(nf);
            s.close();
        } })],
    });
}

function security() {
    const pw = h('input', { class: 'input', type: 'password', placeholder: state.settings.auth ? '新密码' : '设置访问密码（至少 4 位）', autocomplete: 'new-password' });
    return panel('访问密码', 'lock', null,
        h('div', { class: `note ${state.settings.auth ? 'ok' : 'warn'}` }, icon(state.settings.auth ? 'checkCircle' : 'alert', { size: 15 }),
            state.settings.auth ? '已启用密码保护。修改密码后，所有设备（包括酒馆插件）需要重新登录。' : '当前没有密码，任何知道网址的人都能访问。部署到公网前务必设置。'),
        h('div', { class: 'input-group' }, pw, btn(state.settings.auth ? '修改' : '启用', { cls: 'primary', onclick: async () => {
            if (pw.value.length < 4) { toast('密码至少 4 位', 'err'); return; }
            const { token } = await api.post('/api/password', { password: pw.value });
            api.setToken(token);
            toast('密码已更新', 'ok');
            pw.value = '';
        } })),
        state.settings.auth ? h('div', { class: 'row-actions' },
            btn('退出登录', { icon: 'logout', cls: 'sm', onclick: () => { api.setToken(''); location.reload(); } }),
            btn('关闭密码', { cls: 'sm ghost danger', onclick: async () => {
                if (!(await confirmDialog('关闭密码保护？公网部署时非常不安全。', { danger: true }))) return;
                await api.post('/api/password', { password: '' });
                api.setToken('');
                toast('已关闭密码');
            } })) : null);
}

function copyBox(text) {
    return h('div', { class: 'copy-box' }, h('code', {}, text), btn('', { icon: 'copy', cls: 'sm', title: '复制', onclick: async () => {
        try { await navigator.clipboard.writeText(text); toast('已复制', 'ok'); } catch { toast('复制失败，请手动复制', 'err'); }
    } }));
}

function connection() {
    return panel('连接酒馆插件', 'beer', null,
        h('div', { class: 'sub-label' }, '插件安装地址'), copyBox(PLUGIN_REPO),
        h('div', { class: 'muted small' }, '在 SillyTavern / TauriTavern 里：扩展 → 安装扩展 → 粘贴这个地址。已经装过的，在扩展管理里点更新。'),
        h('div', { class: 'small' }, '装好后在插件设置里填入：'),
        h('div', { class: 'sub-label' }, '服务器地址'), copyBox(location.origin),
        h('div', { class: 'muted small' }, '密码就是上面设置的访问密码。iOS 版 TauriTavern 需要 https 地址。'),
        btn('下载插件压缩包', { icon: 'download', cls: 'sm', href: '/api/extension.zip', download: 'tavern-vault-extension.zip' }));
}

function shortcut() {
    return panel('iPhone 使用', 'phone', null,
        h('ol', { class: 'steps' },
            h('li', {}, 'Safari 打开本页 → 分享 → 添加到主屏幕，像 App 一样使用。'),
            h('li', {}, '快捷指令分享上传：新建快捷指令，开启「在共享表单中显示」并接收文件和图像，添加「获取 URL 内容」：'),
            h('li', { class: 'plain' }, copyBox(`${location.origin}/api/items?filename=快捷指令上传`)),
            h('li', { class: 'plain' }, '方法选 POST，请求体选「文件」并选择快捷指令输入。', state.settings.auth ? '头部添加 Authorization，值为 Bearer 加空格加访问令牌。' : ''),
            h('li', {}, '之后在任何 App 里分享文件，选这个快捷指令，就会直接存进藏馆。')),
        state.settings.auth ? h('details', { class: 'fold' }, h('summary', {}, icon('chevronRight', { size: 14, cls: 'fold-chev' }), icon('key', { size: 15 }), h('span', { class: 'fold-title' }, '显示访问令牌')), h('div', { class: 'fold-body' }, copyBox(api.token))) : null);
}

function data() {
    const st = state.stats || {};
    const storage = h('div', { class: 'storage' }, h('span', { class: 'muted small' }, '正在统计…'));
    api.get('/api/storage').then((r) => clear(storage,
        h('div', { class: 'facts' },
            h('div', { class: 'fact' }, h('b', {}, fmtBytes(r.blobs)), h('span', {}, `文件（${st.files ?? 0} 个）`)),
            h('div', { class: 'fact' }, h('b', {}, fmtBytes(r.thumbs)), h('span', {}, `缩略图（${r.thumbCount} 张）`)),
            h('div', { class: 'fact' }, h('b', {}, fmtBytes(r.db)), h('span', {}, '数据库'))))).catch((e) => clear(storage, h('span', { class: 'muted small' }, e.message)));
    const days = state.settings.trashDays || 0;
    return [
        panel('备份与还原', 'database', null,
            h('div', { class: 'row-actions wrap' },
                btn('下载完整备份', { icon: 'download', cls: 'primary', onclick: async (e) => {
                    const b = e.currentTarget;
                    b.disabled = true;
                    try { downloadBlob(await api.req('GET', '/api/backup', undefined, { blob: true }), `TavernVault-backup-${new Date().toISOString().slice(0, 10)}.zip`); } catch (err) { toast(err.message, 'err'); }
                    b.disabled = false;
                } }),
                btn('从备份还原', { icon: 'restore', onclick: () => restoreInput.click() }), restoreInput),
            h('div', { class: 'muted small' }, '备份 ZIP 包含全部条目、合集、字段和所有版本的文件（不含缩略图和 AI 密钥）。还原前会自动保存一份当前数据库，放在服务端 data/restore-points 目录。')),
        panel('回收站', 'trash', btn(`打开回收站${st.trash ? ` · ${st.trash}` : ''}`, { cls: 'sm', href: '#/trash' }),
            setRow('自动清空', '删除超过这个天数的条目会被彻底清除，文件一起删掉。对所有设备生效', seg(days, [[0, '不自动'], [7, '7 天'], [30, '30 天'], [90, '90 天']], async (v) => {
                if (v && st.trash && !(await confirmDialog(`开启后，回收站里超过 ${v} 天的条目会立即被彻底删除，无法恢复。继续？`, { danger: true, ok: '开启' }))) return;
                await api.put('/api/settings', { trashDays: v });
                toast(v ? `已设为 ${v} 天自动清空` : '已关闭自动清空', 'ok');
            }))),
        panel('存储', 'box', null, storage,
            h('div', { class: 'row-actions wrap' },
                btn('清理无用文件', { icon: 'eraser', cls: 'sm', onclick: async () => { const r = await api.post('/api/maintenance/gc'); toast(`已清理 ${r.removed} 个文件`, 'ok'); rerender(); } }),
                btn('重建缩略图', { icon: 'refresh', cls: 'sm', onclick: async () => {
                    if (!(await confirmDialog('删除全部缩略图？之后浏览仓库时会按原图重新生成，第一次加载会慢一些。'))) return;
                    const r = await api.del('/api/thumbs');
                    toast(`已删除 ${r.removed} 张缩略图`, 'ok');
                    await reload();
                    rerender();
                } })),
            h('div', { class: 'muted small' }, '「清理无用文件」会删掉已经没有条目引用的文件（例如彻底删除后剩下的）。')),
    ];
}

function about() {
    return panel('TavernVault 酒馆藏馆', 'info', null,
        h('div', { class: 'facts' },
            h('div', { class: 'fact' }, h('b', {}, `v${state.settings.version || '1.0.0'}`), h('span', {}, '服务端版本')),
            h('div', { class: 'fact' }, h('b', {}, bridge.host ? '酒馆内' : '网页'), h('span', {}, bridge.host ? `已连接 ${bridge.host.host}` : '独立网页模式'))),
        h('div', { class: 'sub-label' }, '项目地址'), copyBox(PLUGIN_REPO),
        h('div', { class: 'muted small' }, '界面图标来自 Lucide（ISC 许可）。'));
}

const restoreInput = h('input', { type: 'file', accept: '.zip,application/zip', hidden: true, onchange: () => { const f = restoreInput.files[0]; restoreInput.value = ''; if (f) restoreFrom(f); } });

async function restoreFrom(file) {
    const mode = await choiceDialog(
        h('div', { class: 'stack-s' },
            h('div', {}, `从「${file.name}」还原。`),
            h('div', { class: 'muted small' }, '合并：保留现有内容，加入备份里没有的条目；两边都有的保留较新的一份，并补齐历史版本。'),
            h('div', { class: 'muted small' }, '替换：用备份完全替换现有条目、合集和字段（密码和风格设置不变）。')),
        [{ key: 'replace', label: '替换', cls: 'danger' }, { key: 'merge', label: '合并', cls: 'primary' }],
        { title: '从备份还原' });
    if (!mode) return;
    if (mode === 'replace' && !(await confirmDialog('替换会清空当前所有条目，改为备份里的内容。继续？', { danger: true, ok: '替换' }))) return;
    const bar = h('i', { style: { width: '0%' } });
    const label = h('div', { class: 'progress-label' }, '正在上传备份');
    const s = sheet({ title: '还原中', body: h('div', { class: 'stack-s' }, h('div', { class: 'progress' }, bar), label) });
    try {
        const r = await api.restore(file, mode, (p) => { bar.style.width = `${p * 100}%`; label.textContent = p < 1 ? `正在上传 ${Math.round(p * 100)}%` : '正在写入文件…'; });
        bar.style.width = '100%';
        label.textContent = `完成：新增 ${r.added} 项${r.updated ? `，更新 ${r.updated} 项` : ''}${r.kept ? `，${r.kept} 项保留本地较新版本` : ''}，文件 ${r.files} 个${r.bad ? `，${r.bad} 个文件校验失败已跳过` : ''}`;
        toast('还原完成', 'ok');
    } catch (e) {
        label.textContent = `还原失败：${e.message}`;
        toast(e.message, 'err');
    }
    s.body.append(btn('关闭', { cls: 'block', onclick: () => s.close() }));
}
