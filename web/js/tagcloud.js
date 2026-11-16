// 标签列表：标签多了以后不再是一整面墙。
// 筛选面板、批量打标签、编辑条目时挑标签都用这个，只是每个标签按钮长什么样由调用的地方决定。
import { h, clear, icon } from './ui.js';
import { state, savePrefs, tagGroups } from './state.js';

const RARE_KEEP = 24; // 没建分类时，先显示用得多的这么多个，其余收起来

/**
 * 把标签画进 box。
 * @param {HTMLElement} box
 * @param {object} o
 * @param {[string, number][]} o.tags   标签和使用次数（按次数从多到少）
 * @param {(tag: string, count: number) => Node} o.chip  画一个标签按钮
 * @param {string} [o.q]                在找的文字：有的话直接列出匹配的，不分类
 * @param {Set<string>} [o.picked]      已经选中的：单独放在最上面一行，所在的分类自动展开
 * @param {{ rare?: boolean, sort?: 'count' | 'name' }} o.ui  这个面板自己的展开 / 排序状态（调用方保存）
 * @param {() => void} o.redraw         展开、收起后重画
 * @param {string} [o.empty]            找不到时显示的话
 */
export function tagCloud(box, { tags, chip, q = '', picked = new Set(), ui, redraw, empty = '没有匹配的标签' }) {
    const k = q.trim().toLowerCase();
    const byName = ui.sort === 'name';
    const sorted = byName ? [...tags].sort((a, b) => a[0].localeCompare(b[0], 'zh')) : tags;
    const row = (list) => h('div', { class: 'opts tag-opts' }, list.map(([t, n]) => chip(t, n)));
    box.classList.add('tag-cloud');

    if (k) {
        const shown = sorted.filter(([t]) => t.toLowerCase().includes(k));
        clear(box, shown.length ? row(shown.slice(0, 300)) : h('span', { class: 'muted small' }, empty),
            shown.length > 300 ? h('div', { class: 'muted small' }, `还有 ${shown.length - 300} 个，再多输几个字`) : null);
        return;
    }

    const count = new Map(tags);
    const pickedRow = picked.size ? h('div', { class: 'tag-picked' }, h('span', { class: 'sub-label' }, `已选 ${picked.size}`),
        row([...picked].map((t) => [t, count.get(t) || 0]))) : null;

    const groups = tagGroups();
    if (groups.length) {
        // 按分类收起来，点分类名展开
        const open = new Set(Array.isArray(state.prefs.tagGroupOpen) ? state.prefs.tagGroupOpen : []);
        const grouped = new Set(groups.flatMap((g) => g.tags));
        const sec = (key, name, own) => {
            if (!own.length) return null;
            const sel = own.filter(([t]) => picked.has(t)).length;
            const isOpen = open.has(key);
            return h('div', { class: `tag-group ${isOpen ? 'open' : ''}` },
                h('button', { class: 'tag-group-head', onclick: () => {
                    if (open.has(key)) open.delete(key); else open.add(key);
                    state.prefs.tagGroupOpen = [...open];
                    savePrefs();
                    redraw();
                } }, icon(isOpen ? 'chevronDown' : 'chevronRight', { size: 14 }), h('span', { class: 'tag-group-name' }, name), h('span', { class: 'opt-n' }, sel ? `已选 ${sel} · ${own.length}` : own.length)),
                isOpen ? row(own) : null);
        };
        const inGroup = (g) => { const set = new Set(g.tags); return sorted.filter(([t]) => set.has(t)); };
        clear(box, pickedRow, h('div', { class: 'tag-groups' },
            groups.map((g) => sec(`g:${g.name}`, g.name, inGroup(g))),
            sec('~rest', '未分类', sorted.filter(([t]) => !grouped.has(t)))));
        return;
    }

    // 没建分类：用得多的先显示，用得少的收在后面
    if (byName || tags.length <= RARE_KEEP + 6) { clear(box, pickedRow, row(sorted)); return; }
    const often = tags.filter(([, n]) => n > 1);
    const head = (often.length >= 8 ? often : tags).slice(0, Math.max(RARE_KEEP, Math.min(often.length, 40)));
    const shownSet = new Set(head.map(([t]) => t));
    const rest = tags.filter(([t]) => !shownSet.has(t));
    clear(box, pickedRow, row(head),
        rest.length ? h('button', { class: 'tag-more', onclick: () => { ui.rare = !ui.rare; redraw(); } },
            icon(ui.rare ? 'chevronDown' : 'chevronRight', { size: 14 }), h('span', {}, ui.rare ? `收起用得少的 ${rest.length} 个` : `还有 ${rest.length} 个用得少的标签`)) : null,
        rest.length && ui.rare ? row(rest) : null);
}
