// 重复条目：找出可能是同一个东西的条目，选一个保留，其余并进去
import { h, clear, toast, sheet, btn, icon, confirmDialog, fmtDate, emptyState } from '../ui.js';
import { api } from '../api.js';
import { state, live, typeMeta, subscribe } from '../state.js';
import { coverImg } from '../thumbs.js';
import { openDetail } from './detail.js';

// 和服务端导入时判断同名的规则一致：去掉扩展名、版本号、副本标记
const stripVer = (s) => String(s || '').toLowerCase()
    .replace(/\.(png|json|charx|jsonl|txt|md|js|css|webp|jpe?g|gif|zip|ya?ml)$/i, '')
    .replace(/[\s_\-]*[(（[【]\s*(?:v(?:er(?:sion)?)?\.?\s*\d+(?:\.\d+)*[a-z]?|\d+|副本|copy)\s*[)）\]】]\s*$/i, '')
    .replace(/[\s_\-]+v(?:er(?:sion)?)?\.?\s*\d+(?:\.\d+)*[a-z]?$/i, '')
    .replace(/[\s_\-]*(?:副本|copy)$/i, '')
    .trim();
const normName = (s) => stripVer(s).replace(/[\s_\-·・]+/g, ' ').trim();
/** 设置里的「衍生版本分隔符」：名字里带这些符号的（如「蔚轶-31」）是不同的衍生版本，名字完全一样才算重复 */
export const hasDerivSep = (s, seps = state.settings.dupSeparators || []) => seps.some((c) => (c === '·' ? /[·・•]/.test(s) : s.includes(c)));
// 名字比较用的键：衍生版本按原名；其余更宽松，名字末尾多一两位数字（「周承奕1」）也算相近
const looseName = (s) => {
    const base = stripVer(s);
    return hasDerivSep(base) ? `=${base}` : normName(s).replace(/(\D)\s*\d{1,2}$/, '$1').trim();
};
const primaryOf = (it) => it.files?.find((f) => f.primary) || it.files?.[0];
const groupKey = (ids) => [...ids].sort().join(',');
const authorOk = (a, b) => !a.author || !b.author || normName(a.author) === normName(b.author);

const REASONS = {
    same: ['内容完全相同', 'ok'],
    name: ['同名', ''],
    similar: ['名字相近', 'warn'],
};

/** 返回 [{ key, reason, items }]，已标记「不是重复」的组不返回 */
export function findDuplicates() {
    const items = live();
    const parent = new Map(items.map((it) => [it.id, it.id]));
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra, rb); };
    const buckets = new Map();
    const put = (key, it) => { if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(it); };
    for (const it of items) {
        const f = primaryOf(it);
        if (f?.sha) put(`sha:${f.sha}`, it);
        if (f?.sig) put(`sig:${it.type}:${f.sig}`, it);
        const n = looseName(it.name);
        if (n) put(`name:${it.type}:${n}`, it);
    }
    for (const [key, list] of buckets) {
        if (list.length < 2) continue;
        const strict = !key.startsWith('name:'); // 文件或内容相同的不看作者
        list.forEach((it, i) => { for (const o of list.slice(0, i)) if (strict || authorOk(it, o)) { union(it.id, o.id); break; } });
    }
    const groups = new Map();
    for (const it of items) {
        const r = find(it.id);
        if (!groups.has(r)) groups.set(r, []);
        groups.get(r).push(it);
    }
    const ignored = new Set(state.settings.dupIgnore || []);
    const out = [];
    for (const list of groups.values()) {
        if (list.length < 2) continue;
        const key = groupKey(list.map((it) => it.id));
        if (ignored.has(key)) continue;
        const sigs = new Set(list.map((it) => primaryOf(it)?.sig || primaryOf(it)?.sha || it.id));
        const names = new Set(list.map((it) => normName(it.name)));
        const reason = sigs.size === 1 ? 'same' : names.size === 1 ? 'name' : 'similar';
        out.push({ key, reason, items: list.sort(byKeep) });
    }
    return out.sort((a, b) => Object.keys(REASONS).indexOf(a.reason) - Object.keys(REASONS).indexOf(b.reason) || a.items[0].name.localeCompare(b.items[0].name, 'zh'));
}

// 默认保留：文件多的、整理过的（标签、备注、评分、收藏）、最近更新的
const score = (it) => it.files.length * 100 + (it.favorite ? 20 : 0) + (it.rating || 0) * 4 + it.tags.length * 2 + (it.notes ? 5 : 0) + (it.ai ? 5 : 0);
const byKeep = (a, b) => score(b) - score(a) || String(b.updatedAt).localeCompare(String(a.updatedAt));

async function ignoreGroups(keys) {
    const list = [...new Set([...(state.settings.dupIgnore || []), ...keys])];
    await api.put('/api/settings', { dupIgnore: list });
    state.settings.dupIgnore = list;
}

export function openDuplicates() {
    const body = h('div', { class: 'stack' });
    const s = sheet({ title: '重复条目', body, full: true, onClose: () => unsub() });
    const draw = () => {
        if (!document.body.contains(s.el)) return;
        const groups = findDuplicates();
        if (!groups.length) {
            clear(body, emptyState('check', '没有发现重复的条目', '同一个文件、内容相同、或同类型同名（作者不冲突）的条目会出现在这里。标记过「不是重复」的不会再提示。',
                (state.settings.dupIgnore || []).length ? btn('重新显示已忽略的', { cls: 'sm', onclick: async () => { await api.put('/api/settings', { dupIgnore: [] }); state.settings.dupIgnore = []; draw(); } }) : null));
            return;
        }
        clear(body,
            h('div', { class: 'muted small' }, `发现 ${groups.length} 组。合并时，选中的条目会保留，其它条目的文件作为旧版本并进去，标签、合集、备注、评分也会合在一起，原条目移到回收站，随时可以恢复。`),
            groups.map((g) => groupPanel(g, draw)));
    };
    draw();
    // 合并后数据刷新，重新计算（数据没变时 reload 不会通知）
    const unsub = subscribe(draw);
}

function groupPanel(g, redraw) {
    let keep = g.items[0].id;
    const pick = new Set(g.items.map((it) => it.id));
    const sameNewest = h('input', { type: 'checkbox', checked: g.reason !== 'same' });
    const list = h('div', { class: 'dup-list' });
    const mergeBtn = btn('合并', { icon: 'merge', cls: 'sm primary' });
    const draw = () => {
        const keepIt = g.items.find((it) => it.id === keep);
        const keepSig = primaryOf(keepIt)?.sig;
        clear(list, g.items.map((it) => {
            const f = primaryOf(it);
            const isKeep = it.id === keep;
            const on = pick.has(it.id);
            return h('div', { class: `dup-row ${isKeep ? 'keep' : ''} ${on ? '' : 'off'}` },
                h('button', { class: `dup-radio ${isKeep ? 'on' : ''}`, title: '保留这个', onclick: () => { keep = it.id; pick.add(it.id); draw(); } }),
                h('div', { class: 'row-thumb' }, it.cover ? coverImg(it) : icon(typeMeta(it.type).icon, { size: 18 })),
                h('div', { class: 'grow min0' },
                    h('div', { class: 'dup-name' }, h('span', { class: 'min0' }, it.name),
                        isKeep ? h('span', { class: 'chip-s ok' }, '保留') : !on ? h('span', { class: 'chip-s' }, '不合并') : null,
                        !isKeep && keepSig && f?.sig === keepSig ? h('span', { class: 'chip-s' }, '内容相同') : null),
                    h('div', { class: 'file-meta dup-meta' }, [
                        it.author ? `作者 ${it.author.split('\n')[0].slice(0, 16)}` : '',
                        `${it.files.length} 个文件`,
                        fmtDate(it.createdAt, true),
                        it.tags.length ? `${it.tags.length} 个标签` : '',
                        it.notes ? '有备注' : '',
                    ].filter(Boolean).join(' · '))),
                btn('', { icon: 'eye', cls: 'sm ghost', title: '查看详情', onclick: () => openDetail(it.id) }),
                isKeep ? h('span', { class: 'dup-check-space' }) : h('button', { class: `row-check ${on ? 'on' : ''}`, title: on ? '不合并这个' : '合并这个', onclick: () => { on ? pick.delete(it.id) : pick.add(it.id); draw(); } }, icon('check', { size: 13, stroke: 3 })));
        }));
        const n = [...pick].filter((id) => id !== keep).length;
        mergeBtn.disabled = !n;
        mergeBtn.lastChild.textContent = n ? `合并 ${n} 个到保留的条目` : '合并';
    };
    mergeBtn.onclick = async () => {
        const keepIt = g.items.find((it) => it.id === keep);
        const sources = [...pick].filter((id) => id !== keep);
        if (!(await confirmDialog(`把 ${sources.length} 个条目合并进「${keepIt.name}」？它们的文件会作为旧版本保留，原条目移到回收站。`, { ok: '合并', title: '合并重复条目' }))) return;
        try {
            const r = await api.post('/api/items/merge', { target: keep, sources, newest: sameNewest.checked });
            toast(`已合并 ${r.merged} 个条目${r.files ? `，并入 ${r.files} 个文件` : ''}`, 'ok');
            // 只合并了一部分：剩下的那几个标记为不是重复，避免再次出现
            const rest = g.items.filter((it) => !pick.has(it.id)).map((it) => it.id);
            if (rest.length >= 1) await ignoreGroups([groupKey([keep, ...rest])]);
        } catch (e) { toast(e.message, 'err'); return; }
    };
    draw();
    const [label, tone] = REASONS[g.reason];
    return h('section', { class: 'panel dup-group' },
        h('div', { class: 'panel-head' }, h('span', { class: `chip-s ${tone}` }, label), h('h3', { class: 'min0' }, g.items[0].name), h('span', { class: 'muted small' }, `${g.items.length} 个`)),
        list,
        g.reason !== 'same' ? h('label', { class: 'check-line' }, sameNewest, h('span', {}, '当前版本换成最新导入的文件（名字、标签等不变）')) : null,
        h('div', { class: 'row-actions' },
            btn('不是重复', { cls: 'sm ghost', onclick: async () => { await ignoreGroups([g.key]); toast('这组以后不再提示'); redraw(); } }),
            mergeBtn));
}
