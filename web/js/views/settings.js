// 设置
import { h, clear, toast, confirmDialog, sheet, downloadBlob, switchEl, icon, btn } from '../ui.js';
import { api } from '../api.js';
import { bridge } from '../bridge.js';
import { state, savePrefs, applyAccent, TYPE_META, SKINS } from '../state.js';
import { topbar, ensureView } from './common.js';

const KINDS = { text: '单行文本', textarea: '多行文本', number: '数字', url: '链接', date: '日期', select: '下拉选择', tags: '标签列表', checkbox: '开关', rating: '星级评分', color: '颜色' };
const ACCENTS = ['', '#8b4a2b', '#007aff', '#d4a24c', '#e0607e', '#c23a2b', '#22d3ee', '#2f8f6f', '#8a5cb8'];

export function renderSettings(root) {
    const refs = ensureView(root, 'settings', () => {
        const content = h('div', { class: 'stack' });
        root.append(topbar('设置', { kicker: 'Preferences' }), h('div', { class: 'page' }, content));
        return { content };
    });
    if (refs.content.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    clear(refs.content, appearance(), fieldsSection(), security(), connection(), shortcut(), data(),
        h('div', { class: 'footnote' }, `TavernVault v${state.settings.version || '1.0.0'} · ${bridge.host ? `已连接 ${bridge.host.host}` : '独立网页模式'}`));
}

function panel(title, ic, head, ...children) {
    return h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, icon(ic, { size: 16 }), h('h3', {}, title), head ? h('span', { class: 'grow' }) : null, head), children);
}

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
    const title = h('input', { class: 'input', value: state.settings.title || '', onchange: () => api.put('/api/settings', { title: title.value }) });
    const modeOpt = (v, label, ic) => h('button', { class: `opt ${(state.prefs.mode || 'auto') === v ? 'active' : ''}`, onclick: () => { state.prefs.mode = v; savePrefs(); applyAccent(); renderSettings(document.querySelector('main.main')); } }, icon(ic, { size: 14 }), label);
    return panel('外观', 'palette', null,
        h('div', { class: 'form-label' }, '风格'),
        h('div', { class: 'skin-grid' }, Object.entries(SKINS).map(([k, v]) => h('button', {
            class: `skin-opt ${current === k ? 'active' : ''}`,
            onclick: async () => {
                state.settings.skin = k;
                applyAccent();
                await api.put('/api/settings', { skin: k });
            },
        }, skinPreview(k), h('div', { class: 'skin-name' }, h('b', {}, v.name), h('span', {}, v.desc)), current === k ? h('span', { class: 'skin-check' }, icon('check', { size: 13, stroke: 3 })) : null))),
        h('div', { class: 'muted small' }, '风格对所有设备生效（网页和酒馆插件里一致），明暗模式每台设备单独设置。'),
        h('div', { class: 'fields', style: { marginTop: '14px' } },
            h('div', { class: 'field wide' }, h('label', {}, '明暗'), h('div', { class: 'opts' }, modeOpt('auto', '跟随系统', 'monitor'), modeOpt('light', '浅色', 'sun'), modeOpt('dark', '深色', 'moon'))),
            h('div', { class: 'field wide' }, h('label', {}, '强调色'), h('div', { class: 'color-picker' }, ACCENTS.map((c) => h('button', {
                class: `${(state.settings.accent || '') === c ? 'active' : ''} ${c ? '' : 'auto'}`, style: { '--sw': c || 'var(--accent)' }, title: c || '跟随风格',
                onclick: () => api.put('/api/settings', { accent: c }),
            })))),
            h('div', { class: 'field wide' }, h('label', {}, '仓库名称'), title)));
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
    return panel('自定义字段', 'sliders', h('div', { class: 'row-actions' },
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
        h('div', { class: 'small' }, '在 SillyTavern / TauriTavern 安装 TavernVault 插件后，在插件设置里填入：'),
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
    return panel('数据', 'database', null,
        h('div', { class: 'row-actions wrap' },
            btn('下载完整备份', { icon: 'download', onclick: async (e) => {
                const b = e.currentTarget;
                b.disabled = true;
                try { downloadBlob(await api.req('GET', '/api/backup', undefined, { blob: true }), `TavernVault-backup-${new Date().toISOString().slice(0, 10)}.zip`); } catch (err) { toast(err.message, 'err'); }
                b.disabled = false;
            } }),
            btn('清理无用文件', { icon: 'eraser', onclick: async () => { const r = await api.post('/api/maintenance/gc'); toast(`已清理 ${r.removed} 个文件`, 'ok'); } }),
            btn('回收站', { icon: 'trash', href: '#/trash' })),
        h('div', { class: 'muted small' }, '备份 ZIP 包含 db.json 和 files 目录，解压到服务端的 data 目录即可恢复。'));
}
