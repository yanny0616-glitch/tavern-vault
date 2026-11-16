// 预设条目、正则的编辑器，和「一张卡挂多套世界书」的管理面板。保存都是生成新版本，旧的留在「文件」页。
import { h, clear, sheet, toast, icon, btn, switchEl, confirmDialog, choiceDialog, promptDialog, fmtDate, fmtBytes } from '../ui.js';
import { api } from '../api.js';
import { state, userLabel } from '../state.js';
import { effectivePrompts, promptOrderOf, estTokens } from '../cardfmt.js';
import { parseRegex, runRegex, PLACEMENT } from '../stview.js';

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`);
const field = (label, node, wide = true) => h('div', { class: `field ${wide ? 'wide' : ''}` }, h('label', {}, label), node);

/**
 * 一列可以展开编辑的条目：开关、上移下移、删除。预设和正则共用。
 * titleOf / chipsOf / isOn / setOn / canRemove / form 都是 (条目) => …
 */
function listEditor({ list, titleOf, chipsOf = () => null, subOf = () => '', isOn, setOn, canRemove = () => true, form, empty, onRemove = () => {} }) {
    const box = h('div', { class: 'book-edit' });
    const openSet = new Set();
    const move = (i, d) => { [list[i], list[i + d]] = [list[i + d], list[i]]; draw(); };
    function draw() {
        clear(box, list.length ? list.map((e, i) => {
            const open = openSet.has(e);
            const head = h('div', { class: 'book-edit-head' },
                h('button', { class: 'book-edit-toggle', title: open ? '收起' : '展开编辑', onclick: () => { if (open) openSet.delete(e); else openSet.add(e); draw(); } },
                    icon(open ? 'chevronDown' : 'chevronRight', { size: 14 }),
                    h('span', { class: 'book-edit-title' }, titleOf(e, i)), chipsOf(e),
                    subOf(e) ? h('span', { class: 'muted small book-edit-keys' }, subOf(e)) : null),
                switchEl(isOn(e), (v) => { setOn(e, v); draw(); }),
                btn('', { icon: 'arrowUp', cls: 'sm ghost icon', title: '上移', disabled: i === 0, onclick: () => move(i, -1) }),
                btn('', { icon: 'arrowDown', cls: 'sm ghost icon', title: '下移', disabled: i === list.length - 1, onclick: () => move(i, 1) }),
                canRemove(e) ? btn('', { icon: 'trash', cls: 'sm ghost icon danger', title: '删除', onclick: () => { list.splice(i, 1); openSet.delete(e); onRemove(e); draw(); } }) : h('span', { class: 'edit-nodel', title: '酒馆自带的条目，不能删，可以关掉' }));
            return h('div', { class: `book-edit-item ${open ? 'open' : ''} ${isOn(e) ? '' : 'off'}` }, head, open ? h('div', { class: 'fields' }, form(e, draw)) : null);
        }) : h('div', { class: 'muted small' }, empty));
    }
    return { box, draw, open: (e) => { openSet.add(e); draw(); box.lastElementChild?.scrollIntoView({ block: 'nearest' }); }, closeAll: () => { openSet.clear(); draw(); } };
}

/** 编辑器的外壳：没改就直接关，改了没存要问一句 */
function editorSheet({ title, note, tools, box, snap, save }) {
    let initial = '';
    const s = sheet({
        title, full: true,
        beforeClose: async () => snap() === initial || confirmDialog('有还没保存的修改，确定放弃？', { ok: '放弃修改', danger: true }),
        body: h('div', { class: 'stack' }, h('div', { class: 'note' }, icon('info', { size: 15 }), h('span', {}, note)), tools, box),
        foot: [
            btn('取消', { onclick: () => s.tryClose() }),
            btn('保存', { icon: 'check', cls: 'primary', onclick: async (ev) => {
                const b = ev.currentTarget;
                if (snap() === initial) { s.close(); return; }
                b.disabled = true;
                try { await save(); toast('已保存为新版本', 'ok'); initial = snap(); s.close(); } catch (err) { toast(err.message, 'err'); b.disabled = false; }
            } }),
        ],
    });
    s.el.classList.add('edit-sheet');
    return { sheet: s, ready: () => { initial = snap(); } };
}

// ---------------- 预设 ----------------
const PARAMS = [
    ['temperature', '温度'], ['top_p', 'Top P'], ['top_k', 'Top K'], ['frequency_penalty', '频率惩罚'], ['presence_penalty', '存在惩罚'], ['repetition_penalty', '重复惩罚'],
    ['openai_max_context', '上下文长度'], ['openai_max_tokens', '回复长度上限'],
];
const ROLES = [['system', '系统'], ['user', '用户'], ['assistant', 'AI']];

/** 编辑预设：条目的开关、先后、名称、角色、内容，增删自己加的条目，还有几个常用参数 */
export function editPreset(it, content, done = () => {}) {
    const d = structuredClone(content.data || {});
    const rows = effectivePrompts(d).map((r) => ({ ...r }));
    const removed = new Set();
    const params = PARAMS.filter(([k]) => typeof d[k] === 'number');
    const paramBox = params.length ? h('div', { class: 'fields preset-params' }, params.map(([k, label]) => field(label, h('input', { class: 'input', type: 'number', step: 'any', value: d[k], dataset: { k },
        oninput: (e) => { const n = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(n)) d[k] = n; } }), false))) : null;
    const count = h('span', { class: 'sub-label grow' });
    const ed = listEditor({
        list: rows,
        titleOf: (r) => r.p.name || r.p.identifier || '（未命名）',
        chipsOf: (r) => [r.p.marker ? h('span', { class: 'chip-s' }, '占位') : null, r.p.injection_position === 1 ? h('span', { class: 'chip-s' }, `深度 ${r.p.injection_depth ?? 4}`) : null],
        subOf: (r) => (r.p.marker ? '' : `约 ${estTokens(r.p.content)} token`),
        isOn: (r) => r.enabled,
        setOn: (r, v) => { r.enabled = v; r.used = true; },
        // 酒馆自带的（主提示词、占位条目等）删了预设会出问题，只让删自己加的
        canRemove: (r) => !r.p.marker && !r.p.system_prompt,
        onRemove: (r) => removed.add(r.p),
        empty: '这份预设里没有条目。',
        form: (r, redraw) => {
            const p = r.p;
            if (p.marker) return [field('名称', h('input', { class: 'input', value: p.name || '', oninput: (e) => { p.name = e.target.value; } })),
                h('div', { class: 'field wide muted small' }, '这是占位条目：它的内容由酒馆在聊天时填进去（角色描述、世界书、聊天记录等），这里只能改它的先后和开关。')];
            return [
                field('名称', h('input', { class: 'input preset-name', value: p.name || '', oninput: (e) => { p.name = e.target.value; } })),
                field('内容', h('textarea', { class: 'textarea preset-content', value: String(p.content ?? ''), style: { minHeight: '180px' }, oninput: (e) => { p.content = e.target.value; } })),
                field('以谁的身份发送', h('select', { class: 'select preset-role', onchange: (e) => { p.role = e.target.value; } }, ROLES.map(([v, label]) => h('option', { value: v, selected: (p.role || 'system') === v }, label))), false),
                field('放在哪里', h('select', { class: 'select preset-pos', onchange: (e) => { p.injection_position = Number(e.target.value); if (p.injection_position === 1 && p.injection_depth == null) p.injection_depth = 4; redraw(); } },
                    h('option', { value: 0, selected: p.injection_position !== 1 }, '按列表里的先后'), h('option', { value: 1, selected: p.injection_position === 1 }, '聊天记录里的指定深度')), false),
                p.injection_position === 1 ? field('深度', h('input', { class: 'input preset-depth', type: 'number', min: 0, value: p.injection_depth ?? 4, title: '0 是最新一条消息之后，数字越大越靠前', oninput: (e) => { p.injection_depth = Math.max(0, Math.round(Number(e.target.value)) || 0); } }), false) : null,
            ];
        },
    });
    const draw = ed.draw;
    ed.draw = () => { draw(); count.textContent = `${rows.length} 个条目 · ${rows.filter((r) => r.enabled).length} 个启用`; };
    const add = () => {
        const r = { p: { identifier: uuid(), name: '新条目', role: 'system', content: '', system_prompt: false, marker: false, injection_position: 0, injection_depth: 4, forbid_overrides: false }, enabled: true, used: true };
        rows.push(r);
        ed.open(r);
        count.textContent = `${rows.length} 个条目 · ${rows.filter((x) => x.enabled).length} 个启用`;
    };
    const snap = () => JSON.stringify([rows, params.map(([k]) => d[k])]);
    const { ready } = editorSheet({
        title: `编辑预设 · ${it.name}`,
        note: '保存后生成新版本，旧版本保留在「文件」页，可随时切回。开关和上下箭头决定酒馆里实际的启用状态和先后。',
        tools: [paramBox, h('div', { class: 'toolbar-row' }, count, btn('添加条目', { icon: 'plus', cls: 'sm', onclick: add }))],
        box: ed.box, snap,
        save: async () => {
            const order = promptOrderOf(d);
            const used = rows.filter((r) => r.used);
            if (order) {
                // 顺序表里原来那一项可能带着别的字段，照原样留着，只改先后和开关
                const old = new Map(order.map((o) => [o?.identifier, o]));
                order.splice(0, order.length, ...used.map((r) => ({ ...(old.get(r.p.identifier) || {}), identifier: r.p.identifier, enabled: r.enabled })));
            } else rows.forEach((r) => { r.p.enabled = r.enabled; });
            const gone = new Set([...removed].map((p) => p.identifier));
            for (const g of Array.isArray(d.prompt_order) ? d.prompt_order : []) if (g && Array.isArray(g.order) && g.order !== order) g.order = g.order.filter((o) => !gone.has(o?.identifier));
            // 没出现在列表里的（标识重复的）原样留着，不丢东西
            const others = (content.data.prompts || []).filter((p) => p && typeof p === 'object' && !rows.some((r) => r.p.identifier === p.identifier) && !gone.has(p.identifier));
            d.prompts = [...rows.map((r) => r.p), ...others];
            await api.put(`/api/items/${it.id}/json`, { data: d });
            done();
        },
    });
    ed.draw();
    ready();
}

// ---------------- 正则 ----------------
const blankRegex = () => ({ id: uuid(), scriptName: '', findRegex: '', replaceString: '', trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null });
const isScript = (r) => r && typeof r === 'object' && !Array.isArray(r) && typeof r.findRegex === 'string';
/** 从一份 JSON 里找出正则脚本：单条、一组，或者角色卡 / 预设里附带的 */
function scriptsIn(o) {
    if (isScript(o)) return [o];
    if (Array.isArray(o)) return o.filter(isScript);
    const inner = o?.data?.extensions?.regex_scripts || o?.extensions?.regex_scripts;
    return Array.isArray(inner) ? inner.filter(isScript) : [];
}

/** 选卡匣里的一个条目。返回选中的条目，取消是 null */
function pickItem(type, title, { skip = '' } = {}) {
    return new Promise((resolve) => {
        let picked = null;
        let q = '';
        const all = state.items.filter((x) => x.type === type && !x.deletedAt && x.id !== skip && x.files.length).sort((a, b) => a.name.localeCompare(b.name, 'zh'));
        const list = h('div', { class: 'rows' });
        const draw = () => {
            const k = q.trim().toLowerCase();
            const shown = all.filter((x) => !k || x.name.toLowerCase().includes(k)).slice(0, 80);
            clear(list, shown.length ? shown.map((x) => h('button', { class: 'row-item pick-row', onclick: () => { picked = x; s.close(); } },
                h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, h('span', {}, x.name)), h('div', { class: 'row-sub' }, h('span', {}, [x.author, fmtDate(x.updatedAt)].filter(Boolean).join(' · ')))))) : h('div', { class: 'muted small' }, all.length ? '没有匹配的' : '卡匣里还没有这类条目'));
        };
        const find = h('input', { class: 'input search-input', type: 'search', placeholder: '搜索', oninput: () => { q = find.value; draw(); } });
        const s = sheet({ title, full: true, onClose: () => resolve(picked), body: h('div', { class: 'stack-s' }, h('label', { class: 'search inline' }, icon('search', { size: 15 }), find), list) });
        draw();
    });
}

/**
 * 编辑正则：角色卡里内嵌的、预设里附带的，或者单独的正则文件。
 * content 是详情页读到的内容；角色卡走 /card，其它走 /json
 */
export function editRegex(it, content, done = () => {}) {
    const inCard = content.kind === 'card';
    const d = structuredClone(content.data || {});
    const standalone = !inCard && it.type === 'regex';
    const wasArray = Array.isArray(d);
    const source = standalone ? (wasArray ? d : [d]) : Array.isArray(d.extensions?.regex_scripts) ? d.extensions.regex_scripts : [];
    const rest = source.filter((r) => !isScript(r)); // 读不懂的原样留着
    const list = source.filter(isScript);
    const names = { char: (inCard && d.name) || '角色', user: userLabel() };
    const count = h('span', { class: 'sub-label grow' });
    const tests = new WeakMap();
    const ed = listEditor({
        list,
        titleOf: (r, i) => r.scriptName || `正则 ${i + 1}`,
        chipsOf: (r) => (r.findRegex && !parseRegex(r.findRegex) ? h('span', { class: 'chip-s warn' }, '写法有误') : null),
        subOf: (r) => (r.placement || []).map((p) => PLACEMENT[p]).filter(Boolean).join('、'),
        isOn: (r) => !r.disabled,
        setOn: (r, v) => { r.disabled = !v; },
        empty: '还没有正则。可以新建一条，或者从文件、卡匣里导入。',
        form: (r) => {
            const err = h('div', { class: 'regex-err small' });
            const out = h('pre', { class: 'code regex-out' });
            const sample = h('textarea', { class: 'textarea regex-sample', rows: 2, placeholder: '写一段文字试试这条正则', value: tests.get(r) || '', oninput: () => { tests.set(r, sample.value); run(); } });
            const run = () => {
                err.textContent = r.findRegex && !parseRegex(r.findRegex) ? '这个写法浏览器认不出来，检查括号、斜杠有没有配对' : '';
                if (!sample.value) { out.hidden = true; return; }
                const res = runRegex(sample.value, r, names);
                out.hidden = false;
                out.textContent = res.error ? res.error : res.hits ? res.out : '（没有匹配到，文字不变）';
                out.dataset.hits = res.hits || 0;
            };
            const place = Object.entries(PLACEMENT).map(([k, label]) => {
                const n = Number(k);
                const box = h('input', { type: 'checkbox', checked: (r.placement || []).includes(n), onchange: () => { const set = new Set(r.placement || []); if (box.checked) set.add(n); else set.delete(n); r.placement = [...set].sort((a, b) => a - b); } });
                return h('label', { class: 'check-line' }, box, h('span', {}, label));
            });
            const flag = (key, label) => { const box = h('input', { type: 'checkbox', checked: Boolean(r[key]), onchange: () => { r[key] = box.checked; } }); return h('label', { class: 'check-line' }, box, h('span', {}, label)); };
            const depth = (key, label) => field(label, h('input', { class: 'input', type: 'number', min: 0, placeholder: '不限', value: r[key] ?? '', oninput: (e) => { r[key] = e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value)) || 0); } }), false);
            const node = [
                field('名称', h('input', { class: 'input regex-name', value: r.scriptName || '', oninput: (e) => { r.scriptName = e.target.value; } })),
                field('查找', [h('textarea', { class: 'textarea code regex-find', rows: 2, spellcheck: false, value: r.findRegex || '', placeholder: '/要找的内容/g', oninput: (e) => { r.findRegex = e.target.value; run(); } }), err]),
                field('替换为', h('textarea', { class: 'textarea code regex-replace', spellcheck: false, value: String(r.replaceString ?? ''), style: { minHeight: '120px' }, placeholder: '留空就是删掉匹配到的内容；$1 是第一个括号里的内容，{{match}} 是整段匹配', oninput: (e) => { r.replaceString = e.target.value; run(); } })),
                field('作用于', h('div', { class: 'check-grid' }, place)),
                field('其它', h('div', { class: 'check-grid' }, flag('markdownOnly', '只改显示'), flag('promptOnly', '只改发给 AI 的内容'), flag('runOnEdit', '编辑消息时也运行'))),
                depth('minDepth', '最小深度'), depth('maxDepth', '最大深度'),
                field('从匹配内容里去掉的文字', h('textarea', { class: 'textarea', rows: 2, placeholder: '可选，一行一个', value: (r.trimStrings || []).join('\n'), oninput: (e) => { r.trimStrings = e.target.value.split('\n').filter(Boolean); run(); } })),
                field('试一试', [sample, out]),
            ];
            run();
            return node;
        },
    });
    const draw = ed.draw;
    const tally = () => { count.textContent = `${list.length} 条正则 · ${list.filter((r) => !r.disabled).length} 条启用`; };
    ed.draw = () => { draw(); tally(); };
    const addMany = (found, from) => {
        if (!found.length) { toast(`${from}里没有找到正则`, 'err'); return; }
        // 导入的给新的 id，免得和原来的撞上
        for (const r of found) list.push({ ...structuredClone(r), id: uuid() });
        ed.draw();
        toast(`加了 ${found.length} 条`, 'ok');
    };
    const file = h('input', { type: 'file', accept: '.json,application/json', multiple: true, hidden: true, onchange: async () => {
        const found = [];
        for (const f of [...file.files]) { try { found.push(...scriptsIn(JSON.parse((await f.text()).replace(/^﻿/, '')))); } catch { /* 不是 JSON，跳过 */ } }
        file.value = '';
        addMany(found, '文件');
    } });
    const fromLibrary = async () => {
        const x = await pickItem('regex', '从卡匣里选正则', { skip: it.id });
        if (!x) return;
        try { const c = await api.get(`/api/items/${x.id}/content`); addMany(scriptsIn(c.data), `「${x.name}」`); } catch (e) { toast(e.message, 'err'); }
    };
    const snap = () => JSON.stringify(list);
    const { ready } = editorSheet({
        title: `编辑正则 · ${it.name}`,
        note: inCard ? '这些正则跟着角色卡走，导入酒馆时会一起带上。保存后生成新版本，旧版本保留在「文件」页。' : '保存后生成新版本，旧版本保留在「文件」页，可随时切回。',
        tools: h('div', { class: 'toolbar-row' }, count,
            btn('新建', { icon: 'plus', cls: 'sm', onclick: () => { const r = blankRegex(); list.push(r); ed.open(r); tally(); } }),
            btn('从文件导入', { icon: 'upload', cls: 'sm ghost', onclick: () => file.click() }),
            btn('从卡匣里选', { icon: 'archive', cls: 'sm ghost', onclick: fromLibrary }), file),
        box: ed.box, snap,
        save: async () => {
            const bad = list.find((r) => !r.findRegex || !parseRegex(r.findRegex));
            if (bad) throw new Error(`「${bad.scriptName || '未命名的正则'}」的查找内容${bad.findRegex ? '写法有误' : '还是空的'}，改好或删掉再保存`);
            const all = [...list, ...rest];
            if (standalone) {
                if (!all.length) throw new Error('至少要留一条正则；不要了可以直接删除这个条目');
                await api.put(`/api/items/${it.id}/json`, { data: wasArray || all.length !== 1 ? all : all[0] });
            } else {
                if (all.length || d.extensions?.regex_scripts) d.extensions = { ...(d.extensions || {}), regex_scripts: all };
                if (inCard) await api.put(`/api/items/${it.id}/card`, { card: { ...content.card, data: d } });
                else await api.put(`/api/items/${it.id}/json`, { data: d });
            }
            done();
        },
    });
    ed.draw();
    ready();
}

// ---------------- 一张卡挂多套世界书 ----------------
/** 管理一张角色卡名下的几套世界书：存、换、改名、删 */
export async function openBookSets(it, done = () => {}) {
    let info;
    try { info = await api.get(`/api/items/${it.id}/booksets`); } catch (e) { toast(e.message, 'err'); return; }
    const body = h('div', { class: 'stack booksets' });
    const base = `/api/items/${it.id}/booksets`;
    const run = async (fn, okMsg) => {
        try { const r = await fn(); if (r?.sets) info = r; else info = await api.get(base); done(); draw(); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg, 'ok'); } catch (e) { toast(e.message, 'err'); }
    };
    const saveCurrent = async () => {
        const name = await promptDialog('给卡里现在这套起个名字，方便以后认出来。', { value: info.current?.name || '', placeholder: '比如：原版、日常线、战斗线', title: '存成一套' });
        if (name == null) return;
        run(() => api.post(base, { from: 'current', name: name.trim() }), '存好了');
    };
    const use = async (set) => {
        let keep = '';
        const unsaved = info.current && !info.sets.some((x) => x.same);
        if (unsaved) {
            const c = await choiceDialog(`卡里现在这套（${info.current.count} 条）还没存过。换掉以后，它只能从「文件」页的旧版本里找回来。`,
                [{ key: 'drop', label: '直接换' }, { key: 'keep', label: '先存起来再换', cls: 'primary' }], { title: set ? `换成「${set.name}」` : '去掉世界书' });
            if (!c) return;
            if (c === 'keep') {
                const name = await promptDialog('给现在这套起个名字。', { value: info.current.name || '原来的一套', title: '先存起来' });
                if (name == null) return;
                keep = name.trim() || '原来的一套';
            }
        } else if (!set && !(await confirmDialog('把世界书从这张卡里去掉？存着的几套不受影响，随时可以换回来。', { ok: '去掉' }))) return;
        run(() => api.post(`${base}/${set ? set.id : 'none'}/use`, { keep }), set ? `卡里现在是「${set.name}」，已存为新版本` : '卡里现在不带世界书，已存为新版本');
    };
    const rename = async (set) => {
        const name = await promptDialog('', { value: set.name, title: '改名' });
        if (name == null || !name.trim() || name.trim() === set.name) return;
        run(() => api.patch(`/api/items/${it.id}/files/${set.id}`, { label: name.trim().slice(0, 60) }));
    };
    const remove = async (set) => {
        if (!(await confirmDialog(`删除「${set.name}」这一套？${set.same ? '卡里正在用的不受影响。' : ''}`, { danger: true, ok: '删除' }))) return;
        run(() => api.del(`/api/items/${it.id}/files/${set.id}`), '已删除');
    };
    const added = (r) => (r.existed ? '这一套之前已经存过了，内容一样' : '加好了');
    const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async () => {
        const f = file.files[0];
        file.value = '';
        if (!f) return;
        let book;
        try { book = JSON.parse((await f.text()).replace(/^﻿/, '')); } catch { toast('这个文件读不出来，要的是世界书的 JSON 文件', 'err'); return; }
        run(() => api.post(base, { book, name: f.name.replace(/\.json$/i, '') }), added);
    } });
    const fromLibrary = async () => {
        const x = await pickItem('worldbook', '从卡匣里选一本世界书');
        if (x) run(() => api.post(base, { itemId: x.id }), added);
    };
    function draw() {
        const cur = info.current;
        const curSet = info.sets.find((x) => x.same);
        clear(body,
            h('div', { class: 'note' }, icon('info', { size: 15 }), h('span', {}, '一张卡可以存好几套世界书，要用哪套就换哪套。酒馆里生效的是卡里当前这一套；换的时候把选中的那套写进卡里，存成一个新版本。')),
            h('section', { class: 'panel bookset-cur' },
                h('div', { class: 'panel-head' }, icon('book', { size: 16 }), h('h3', {}, '卡里现在的'), h('span', { class: 'grow' }),
                    cur && !curSet ? btn('存成一套', { icon: 'plus', cls: 'sm primary', onclick: saveCurrent }) : null,
                    cur ? btn('去掉', { cls: 'sm ghost', title: '卡里不带世界书', onclick: () => use(null) }) : null),
                cur ? h('div', {}, h('b', {}, curSet?.name || cur.name || '（没有名字）'), h('span', { class: 'muted' }, ` · ${cur.count} 条`), curSet ? null : h('span', { class: 'chip-s warn bookset-unsaved' }, '还没存成一套'))
                    : h('div', { class: 'muted' }, '这张卡里现在没有世界书。')),
            h('div', { class: 'toolbar-row' }, h('span', { class: 'sub-label grow' }, `存着的 · ${info.sets.length} 套`),
                btn('从卡匣里选', { icon: 'archive', cls: 'sm', onclick: fromLibrary }), btn('上传文件', { icon: 'upload', cls: 'sm', onclick: () => file.click() }), file),
            info.sets.length ? h('div', { class: 'bookset-list' }, info.sets.map((set) => h('div', { class: `bookset-row ${set.same ? 'active' : ''}` },
                h('div', { class: 'grow min0' },
                    h('div', { class: 'bookset-name' }, h('b', {}, set.name), set.same ? h('span', { class: 'chip-s ok' }, '正在用') : null),
                    h('div', { class: 'muted small' }, `${set.count} 条 · ${fmtBytes(set.size)} · ${fmtDate(set.addedAt, true)}`)),
                set.same ? null : btn('用这套', { icon: 'check', cls: 'sm primary', onclick: () => use(set) }),
                btn('', { icon: 'pencil', cls: 'sm ghost icon', title: '改名', onclick: () => rename(set) }),
                btn('', { icon: 'trash', cls: 'sm ghost icon danger', title: '删除这一套', onclick: () => remove(set) }))))
                : h('div', { class: 'muted small' }, '还没有存着的。可以把卡里现在这套存起来，或者从卡匣、文件里加。'));
    }
    sheet({ title: `世界书 · ${it.name}`, full: true, body });
    draw();
}
