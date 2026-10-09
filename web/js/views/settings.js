// 设置
import { h, clear, toast, confirmDialog, sheet, downloadBlob, switchEl } from '../ui.js';
import { api } from '../api.js';
import { bridge } from '../bridge.js';
import { state, savePrefs, applyAccent, TYPE_META } from '../state.js';
import { topbar, ensureView } from './common.js';

const KINDS = { text: '单行文本', textarea: '多行文本', number: '数字', url: '链接', date: '日期', select: '下拉选择', tags: '标签列表', checkbox: '开关', rating: '星级评分', color: '颜色' };
const ACCENTS = ['#c084fc', '#818cf8', '#60a5fa', '#2dd4bf', '#34d399', '#facc15', '#fb923c', '#f472b6', '#fb7185'];

export function renderSettings(root) {
    const refs = ensureView(root, 'settings', () => {
        const content = h('div');
        root.append(topbar('设置'), h('div', { class: 'page' }, content));
        return { content };
    });
    // 编辑字段时不要被实时刷新打断
    if (refs.content.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    clear(refs.content, appearance(), fieldsSection(), security(), connection(), shortcut(), data(),
        h('div', { class: 'muted small', style: { textAlign: 'center', margin: '20px 0' } }, `TavernVault v${state.settings.version || '1.0.0'} · ${bridge.host ? `已连接 ${bridge.host.host}` : '独立网页模式'}`));
}

function appearance() {
    const title = h('input', { class: 'input', value: state.settings.title || '', onchange: () => api.put('/api/settings', { title: title.value }) });
    const themeSel = h('select', { class: 'select', onchange: () => { state.prefs.theme = themeSel.value; savePrefs(); applyAccent(); } },
        [['auto', '跟随系统'], ['dark', '深色'], ['light', '浅色']].map(([v, l]) => h('option', { value: v, selected: state.prefs.theme === v }, l)));
    return h('div', { class: 'section' }, h('h3', {}, '🎨 外观'),
        h('div', { class: 'kv' },
            h('label', {}, '仓库名称'), title,
            h('label', {}, '主题'), themeSel,
            h('label', {}, '强调色'), h('div', { class: 'row wrap' }, ACCENTS.map((c) => h('button', {
                class: 'btn sm icon', style: { background: c, outline: state.settings.accent === c ? '3px solid var(--text)' : 'none', outlineOffset: '2px' },
                onclick: async () => { await api.put('/api/settings', { accent: c }); },
            })))));
}

function fieldsSection() {
    const fields = structuredClone(state.fields);
    const list = h('div');
    let dirty = false;
    const saveBtn = h('button', { class: 'btn sm primary', disabled: true, onclick: async () => {
        await api.put('/api/fields', { fields });
        dirty = false;
        saveBtn.disabled = true;
        toast('字段已保存', 'ok');
    } }, '保存');
    const mark = () => { dirty = true; saveBtn.disabled = false; };

    const draw = () => clear(list, fields.map((f, i) => h('div', { class: 'field-row' },
        h('div', {},
            h('div', { style: { fontWeight: 600 } }, f.label, f.builtin ? h('span', { class: 'badge', style: { marginLeft: '6px' } }, '内置') : null),
            h('div', { class: 'muted small' }, KINDS[f.kind] || f.kind, ' · ', f.types?.length ? f.types.map((t) => TYPE_META[t]?.label).join('、') : '所有类型')),
        h('div', { class: 'row' }, h('span', { class: 'small muted' }, '显示'), switchEl(!f.hidden, (v) => { f.hidden = !v; mark(); })),
        h('div', { class: 'row acts' },
            h('button', { class: 'btn sm icon', disabled: i === 0, onclick: () => { [fields[i - 1], fields[i]] = [fields[i], fields[i - 1]]; mark(); draw(); } }, '↑'),
            h('button', { class: 'btn sm icon', disabled: i === fields.length - 1, onclick: () => { [fields[i + 1], fields[i]] = [fields[i], fields[i + 1]]; mark(); draw(); } }, '↓'),
            h('button', { class: 'btn sm', onclick: () => editField(f, (nf) => { fields[i] = nf; mark(); draw(); }) }, '编辑'),
            !f.builtin ? h('button', { class: 'btn sm danger', onclick: () => { fields.splice(i, 1); mark(); draw(); } }, '删除') : null))));
    draw();

    return h('div', { class: 'section' },
        h('h3', {}, '🧩 自定义字段', h('span', { class: 'spacer' }),
            h('button', { class: 'btn sm', onclick: () => editField({ id: `f_${Date.now().toString(36)}`, label: '', kind: 'text', types: [], options: [] }, (nf) => { fields.push(nf); mark(); draw(); }) }, '＋ 新增'),
            saveBtn),
        h('div', { class: 'muted small', style: { marginBottom: '6px' } }, '决定每个条目详情里要记录哪些信息。可以限定只对某些类型显示（例如只给角色卡加「推荐模型」）。'),
        list,
        h('div', { style: { marginTop: '10px' } }, h('button', { class: 'btn sm ghost', onclick: async () => {
            if (await confirmDialog('恢复为默认字段？（已填写的数据不会丢失，只是字段定义会重置）')) { await api.post('/api/fields/reset'); toast('已恢复默认'); }
        } }, '恢复默认字段')));
}

function editField(f, onSave) {
    const nf = structuredClone(f);
    const label = h('input', { class: 'input', value: nf.label, placeholder: '字段名称，例如「推荐模型」' });
    const kind = h('select', { class: 'select', disabled: nf.builtin, onchange: () => { optRow.hidden = kind.value !== 'select'; } },
        Object.entries(KINDS).map(([k, l]) => h('option', { value: k, selected: nf.kind === k }, l)));
    const options = h('textarea', { class: 'textarea', value: (nf.options || []).join('\n'), placeholder: '每行一个选项' });
    const optRow = h('div', { hidden: nf.kind !== 'select', style: { gridColumn: '1 / -1' } }, h('div', { class: 'muted small', style: { margin: '6px 0 4px' } }, '选项'), options);
    const types = new Set(nf.types || []);
    const typeBox = h('div', { class: 'check-group' }, Object.entries(TYPE_META).map(([k, v]) => {
        const cb = h('input', { type: 'checkbox', checked: types.has(k), onchange: () => (cb.checked ? types.add(k) : types.delete(k)) });
        return h('label', {}, cb, `${v.icon} ${v.label}`);
    }));
    const s = sheet({
        title: f.label ? `编辑字段：${f.label}` : '新增字段',
        body: h('div', { class: 'kv' },
            h('label', {}, '名称'), label,
            h('label', {}, '类型'), kind,
            optRow,
            h('label', {}, '适用于'), h('div', {}, typeBox, h('div', { class: 'muted small', style: { marginTop: '4px' } }, '都不勾选 = 所有类型'))),
        foot: [h('button', { class: 'btn', onclick: () => s.close() }, '取消'), h('button', { class: 'btn primary', onclick: () => {
            if (!label.value.trim()) { toast('请输入字段名称', 'err'); return; }
            nf.label = label.value.trim();
            nf.kind = kind.value;
            nf.options = options.value.split('\n').map((x) => x.trim()).filter(Boolean);
            nf.types = [...types];
            onSave(nf);
            s.close();
        } }, '确定')],
    });
}

function security() {
    const pw = h('input', { class: 'input', type: 'password', placeholder: state.settings.auth ? '输入新密码' : '设置访问密码（至少 4 位）', autocomplete: 'new-password' });
    return h('div', { class: 'section' }, h('h3', {}, '🔒 访问密码'),
        h('div', { class: 'muted small', style: { marginBottom: '8px' } }, state.settings.auth ? '✅ 已启用密码保护。修改密码后，所有设备（包括酒馆插件）需要重新登录/填写新密码。' : '⚠️ 当前没有密码，任何知道网址的人都能访问。部署到公网前务必设置！'),
        h('div', { class: 'row' }, pw,
            h('button', { class: 'btn primary', onclick: async () => {
                if (pw.value.length < 4) { toast('密码至少 4 位', 'err'); return; }
                const { token } = await api.post('/api/password', { password: pw.value });
                api.setToken(token);
                toast('密码已更新', 'ok');
                pw.value = '';
            } }, state.settings.auth ? '修改' : '启用')),
        state.settings.auth ? h('div', { class: 'row', style: { marginTop: '10px' } },
            h('button', { class: 'btn sm', onclick: () => { api.setToken(''); location.reload(); } }, '退出登录'),
            h('button', { class: 'btn sm danger', onclick: async () => {
                if (!(await confirmDialog('关闭密码保护？公网部署时非常不安全。', { danger: true }))) return;
                await api.post('/api/password', { password: '' });
                api.setToken('');
                toast('已关闭密码');
            } }, '关闭密码')) : null);
}

function copyBox(text) {
    return h('div', { class: 'copy-box' }, h('code', {}, text), h('button', { class: 'btn sm', onclick: async () => {
        try { await navigator.clipboard.writeText(text); toast('已复制', 'ok'); } catch { toast('复制失败，请手动复制', 'err'); }
    } }, '复制'));
}

function connection() {
    return h('div', { class: 'section' }, h('h3', {}, '🍺 连接酒馆插件'),
        h('div', { class: 'small', style: { marginBottom: '8px' } }, '在 SillyTavern / TauriTavern 里安装「TavernVault」插件后，在插件设置中填入：'),
        h('div', { class: 'muted small' }, '服务器地址'), copyBox(location.origin),
        h('div', { class: 'muted small', style: { marginTop: '8px' } }, '访问密码：就是上面设置的密码'),
        h('div', { class: 'muted small', style: { marginTop: '10px' } }, 'iOS 上的 TauriTavern 请使用 https:// 地址（例如通过 Cloudflare Tunnel 绑定的域名）。'),
        h('a', { class: 'btn sm', style: { marginTop: '10px' }, href: '/api/extension.zip', download: 'tavern-vault-extension.zip' }, '⬇️ 下载插件压缩包（桌面版手动安装用）'));
}

function shortcut() {
    return h('div', { class: 'section' }, h('h3', {}, '📱 iPhone 小技巧'),
        h('ol', { class: 'small', style: { margin: 0, paddingLeft: '18px', lineHeight: 1.9 } },
            h('li', {}, '用 Safari 打开本页 → 分享 → 「添加到主屏幕」，就能像 App 一样使用。'),
            h('li', {}, '「快捷指令」分享上传：新建快捷指令 → 打开「在共享表单中显示」并接收「文件、图像」→ 添加「获取 URL 内容」动作：'),
            h('li', { style: { listStyle: 'none' } }, copyBox(`${location.origin}/api/items?filename=快捷指令上传`)),
            h('li', { style: { listStyle: 'none' } }, '方法选 POST，请求体选「文件」并选择「快捷指令输入」；', state.settings.auth ? '头部添加 Authorization = Bearer <令牌>（令牌见下方）。' : ''),
            h('li', {}, '之后在任何 App 里分享角色卡/文件 → 选这个快捷指令即可直接存进藏馆。')),
        state.settings.auth ? h('details', { class: 'fold', style: { marginTop: '10px' } }, h('summary', {}, '🔑 显示访问令牌'), h('div', { class: 'fold-body' }, copyBox(api.token))) : null);
}

function data() {
    return h('div', { class: 'section' }, h('h3', {}, '💾 数据'),
        h('div', { class: 'row wrap' },
            h('button', { class: 'btn', onclick: async (e) => {
                e.target.disabled = true;
                try { downloadBlob(await api.req('GET', '/api/backup', undefined, { blob: true }), `TavernVault-backup-${new Date().toISOString().slice(0, 10)}.zip`); } catch (err) { toast(err.message, 'err'); }
                e.target.disabled = false;
            } }, '⬇️ 下载完整备份'),
            h('button', { class: 'btn', onclick: async () => { const r = await api.post('/api/maintenance/gc'); toast(`已清理 ${r.removed} 个无用文件`, 'ok'); } }, '🧹 清理无用文件'),
            h('a', { class: 'btn', href: '#/trash' }, '🗑️ 回收站')),
        h('div', { class: 'muted small', style: { marginTop: '8px' } }, '备份 ZIP 中包含 db.json 和 files 目录，解压到服务端的 data 目录即可恢复。'));
}
