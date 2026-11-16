// 并排对比：2～3 个条目一列一个，逐项摆在一起看；可以只看不一样的地方
import { h, clear, sheet, icon, btn, switchEl, toast } from '../ui.js';
import { api } from '../api.js';
import { state, typeMeta, savePrefs } from '../state.js';
import { entriesOf, entryKeys } from '../cardfmt.js';
import { coverImg } from '../thumbs.js';
import { openDiff } from './diff.js';

const str = (v) => (v == null ? '' : String(v)).trim();
const arr = (v) => (Array.isArray(v) ? v : []);
const bookTitles = (book) => entriesOf(book).map((e) => str(e?.comment || e?.name) || entryKeys(e)[0] || '(未命名)');

/** 一个条目 → [[行名, 文字, 备注]]。文字用来比较和显示，备注（字数、条数）只显示 */
function rowsOf(it, c) {
    const out = [
        ['作者', str(it.author)],
        ['版本', str(it.version)],
        ['标签', [...it.tags].sort((a, b) => a.localeCompare(b, 'zh')).join('、')],
    ];
    const text = (label, v) => { const t = str(v); out.push([label, t, t ? `${t.length} 字` : '']); };
    const list = (label, items, unit = '条') => out.push([label, items.join('\n'), items.length ? `${items.length} ${unit}` : '']);
    if (c?.kind === 'card') {
        const d = c.data || {};
        text('描述', d.description); text('性格', d.personality); text('场景', d.scenario);
        text('主开场白', d.first_mes);
        const alt = arr(d.alternate_greetings).map(str).filter(Boolean);
        out.push(['备选开场白', alt.map((g, i) => `【${i + 1}】${g}`).join('\n\n'), alt.length ? `${alt.length} 条` : '']);
        text('对话示例', d.mes_example); text('系统提示词', d.system_prompt); text('后置指令', d.post_history_instructions);
        text('作者注释', d.creator_notes);
        list('内嵌世界书', bookTitles(d.character_book));
        list('内嵌正则', arr(d.extensions?.regex_scripts).map((r) => str(r?.scriptName) || '(未命名)'));
    } else if (c?.kind === 'json' && it.type === 'worldbook') {
        list('条目', bookTitles(c.data));
    } else if (c?.kind === 'json' && it.type === 'preset' && Array.isArray(c.data?.prompts)) {
        list('提示词', c.data.prompts.map((p) => str(p?.name) || '(未命名)'));
    } else if (c?.kind === 'json' && it.type === 'regex') {
        list('脚本', (Array.isArray(c.data) ? c.data : [c.data]).map((r) => str(r?.scriptName) || '(未命名)'));
    } else if (c?.kind === 'text') {
        text('内容', c.text);
    }
    out.push(['简介', str(it.description)], ['笔记', str(it.notes)]);
    return out;
}

// 两张角色卡合并时能逐项挑的内容：行名 → 卡数据里的字段
const field = (k) => [(d) => d[k], (d, v) => { if (v === undefined) delete d[k]; else d[k] = v; }];
const MERGE = {
    描述: field('description'), 性格: field('personality'), 场景: field('scenario'), 主开场白: field('first_mes'),
    备选开场白: field('alternate_greetings'), 对话示例: field('mes_example'), 系统提示词: field('system_prompt'),
    后置指令: field('post_history_instructions'), 作者注释: field('creator_notes'), 内嵌世界书: field('character_book'),
    内嵌正则: [(d) => d.extensions?.regex_scripts, (d, v) => {
        const ext = { ...(d.extensions && typeof d.extensions === 'object' ? d.extensions : {}) };
        if (v === undefined) delete ext.regex_scripts; else ext.regex_scripts = v;
        d.extensions = ext;
    }],
};
const sameData = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** @param items 2～3 个条目 */
export function openCompare(items) {
    const cols = items.slice(0, 3);
    const body = h('div', { class: 'cmp' }, h('div', { class: 'loading' }, h('span', { class: 'spinner' }), h('span', {}, '正在读取')));
    let onlyDiff = state.prefs.cmpOnlyDiff === true;
    let data = null;
    let contents = null;
    // 合并：两张角色卡逐项挑用哪边的，存成其中一张的新版本
    let merging = false;
    let target = 0;          // 存到哪一张
    const choice = {};       // 行名 → 用第几列的
    const pf = (it) => it.files.find((f) => f.primary) || it.files[0];
    const toggle = h('label', { class: 'check-line cmp-toggle' }, switchEl(onlyDiff, (v) => { onlyDiff = v; state.prefs.cmpOnlyDiff = v; savePrefs(); draw(); }), h('span', {}, '只看不一样的'));
    const foot = h('div', { class: 'cmp-foot' });
    const s = sheet({ title: `并排对比 ${cols.length} 项`, body, full: true, headExtra: toggle, foot: cols.length === 2 && cols.every(pf) ? [foot] : null });
    s.el.classList.add('cmp-sheet');
    const canMerge = () => cols.length === 2 && contents?.every((c) => c?.kind === 'card' && c.card) && cols.every((it) => !it.deletedAt);
    const mergeRows = () => Object.keys(MERGE).filter((l) => !sameData(MERGE[l][0](contents[0].data || {}), MERGE[l][0](contents[1].data || {})));
    function drawFoot() {
        if (merging) {
            clear(foot, h('span', { class: 'grow muted small' }, `每一项点一下要留的那边，存成「${cols[target].name}」的新版本，旧版本还在。`),
                btn('取消', { onclick: () => { merging = false; draw(); } }),
                btn('保存合并结果', { icon: 'check', cls: 'primary', onclick: saveMerge }));
            return;
        }
        clear(foot, h('span', { class: 'grow muted small' }, '想看具体改了哪几行：'),
            btn('逐行对比', { icon: 'layers', onclick: () => openDiff({ sha: pf(cols[0]).sha, name: pf(cols[0]).name, label: cols[0].name }, { sha: pf(cols[1]).sha, name: pf(cols[1]).name, label: cols[1].name }, { title: '逐行对比' }) }),
            canMerge() && mergeRows().length ? btn('逐项合并', { icon: 'merge', cls: 'primary', onclick: () => { merging = true; for (const l of mergeRows()) choice[l] = target; draw(); } }) : null);
    }
    async function saveMerge(ev) {
        const b = ev.currentTarget;
        const merged = structuredClone(contents[target].data || {});
        let n = 0;
        for (const l of mergeRows()) {
            if (choice[l] === target) continue;
            const v = MERGE[l][0](contents[choice[l]].data || {});
            MERGE[l][1](merged, v === undefined ? undefined : structuredClone(v));
            n++;
        }
        if (!n) { toast('每一项都留的是这张卡自己的，没有要改的', 'ok'); return; }
        b.disabled = true;
        try {
            await api.put(`/api/items/${cols[target].id}/card`, { card: { ...contents[target].card, data: merged } });
            toast(`已合并 ${n} 项，存成「${cols[target].name}」的新版本`, 'ok');
            s.close();
        } catch (e) { toast(e.message, 'err'); b.disabled = false; }
    }

    function draw() {
        if (!data) return;
        drawFoot();
        toggle.hidden = merging;
        if (merging) { drawMerge(); return; }
        // 行名取并集，保持第一次出现的顺序
        const labels = [];
        for (const rows of data) for (const [l] of rows) if (!labels.includes(l)) labels.push(l);
        const cell = (rows, l) => rows.find((r) => r[0] === l) || [l, '', ''];
        const lines = labels.map((l) => { const cells = data.map((rows) => cell(rows, l)); return { l, cells, same: cells.every((x) => x[1] === cells[0][1]), empty: cells.every((x) => !x[1]) }; })
            .filter((x) => !x.empty);
        const shown = lines.filter((x) => !onlyDiff || !x.same);
        const diffN = lines.filter((x) => !x.same).length;
        clear(body,
            h('div', { class: 'cmp-grid', style: { '--n': cols.length } },
                h('div', { class: 'cmp-row cmp-head' }, h('div', { class: 'cmp-label' }, `${diffN} 处不同`),
                    cols.map((it) => h('div', { class: 'cmp-cell' },
                        h('div', { class: 'cmp-cover', style: { '--tc': typeMeta(it.type).color } }, it.cover ? coverImg(it) : icon(typeMeta(it.type).icon, { size: 20 })),
                        h('div', { class: 'cmp-name' }, h('b', {}, it.name), h('span', { class: 'muted small' }, typeMeta(it.type).label))))),
                shown.map(({ l, cells, same }) => h('div', { class: `cmp-row ${same ? 'same' : 'diff'}` },
                    h('div', { class: 'cmp-label' }, l, same ? h('span', { class: 'chip-s' }, '相同') : null),
                    cells.map(([, v, note]) => {
                        const long = v.length > 220 || v.split('\n').length > 6;
                        const box = h('div', { class: `cmp-text ${long ? 'clamped' : ''}` }, v || h('span', { class: 'muted' }, '（没有）'));
                        return h('div', { class: 'cmp-cell' }, note ? h('div', { class: 'cmp-note' }, note) : null, box,
                            long ? h('button', { class: 'cmp-more', onclick: (e) => { const on = box.classList.toggle('clamped'); e.currentTarget.textContent = on ? '展开' : '收起'; } }, '展开') : null);
                    })))),
            !shown.length ? h('div', { class: 'muted cmp-empty' }, lines.length ? '这几项在能比较的内容上完全一样。' : '没有可以比较的内容。') : null);
    }

    function drawMerge() {
        const labels = mergeRows();
        const cellOf = (i, l) => data[i].find((r) => r[0] === l) || [l, '', ''];
        const setTarget = (i) => { for (const l of labels) if (choice[l] === target) choice[l] = i; target = i; draw(); };
        clear(body,
            h('div', { class: 'cmp-grid merging', style: { '--n': 2 } },
                h('div', { class: 'cmp-row cmp-head' }, h('div', { class: 'cmp-label' }, `${labels.length} 项可以挑`),
                    cols.map((it, i) => h('div', { class: 'cmp-cell' },
                        h('div', { class: 'cmp-cover', style: { '--tc': typeMeta(it.type).color } }, it.cover ? coverImg(it) : icon(typeMeta(it.type).icon, { size: 20 })),
                        h('div', { class: 'cmp-name' }, h('b', {}, it.name),
                            h('button', { class: `cmp-target ${target === i ? 'active' : ''}`, onclick: () => setTarget(i) }, target === i ? [icon('check', { size: 12, stroke: 3 }), '存到这张'] : '改存到这张'))))),
                labels.map((l) => h('div', { class: 'cmp-row diff' },
                    h('div', { class: 'cmp-label' }, l),
                    [0, 1].map((i) => {
                        const [, v, note] = cellOf(i, l);
                        const same = v === cellOf(1 - i, l)[1];
                        const on = choice[l] === i;
                        const long = v.length > 220 || v.split('\n').length > 6;
                        return h('button', { class: `cmp-cell cmp-pick ${on ? 'on' : ''}`, onclick: () => { choice[l] = i; draw(); } },
                            h('div', { class: 'cmp-pick-head' }, h('span', { class: 'cmp-radio' }, on ? icon('check', { size: 12, stroke: 3 }) : null), h('span', {}, on ? '留这边' : '点一下留这边'), note ? h('span', { class: 'cmp-note' }, note) : null),
                            h('div', { class: `cmp-text ${long ? 'clamped' : ''}` }, v || h('span', { class: 'muted' }, '（没有）')),
                            same && v ? h('div', { class: 'muted small' }, '名称一样，里面的内容不一样') : null);
                    })))),
            h('div', { class: 'muted small cmp-merge-note' }, '只合并角色卡文件里的内容。卡匣里的标签、简介、笔记、评分不动。'));
    }

    Promise.all(cols.map((it) => (pf(it) ? api.get(`/api/items/${it.id}/content`).catch(() => null) : null))).then((got) => {
        if (!s.el.isConnected) return;
        contents = got;
        data = cols.map((it, i) => rowsOf(it, got[i]));
        draw();
    });
}
