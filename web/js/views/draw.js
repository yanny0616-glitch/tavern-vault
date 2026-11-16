// 抽一张：从仓库当前筛选出来的条目里随便抽，或者说一句想找什么样的让 AI 挑
import { h, clear, sheet, toast, icon, btn, switchEl, confirmDialog } from '../ui.js';
import { api } from '../api.js';
import { state, typeMeta, savePrefs } from '../state.js';
import { coverImg } from '../thumbs.js';
import { openDetail } from './detail.js';
import { aiReady } from './ai.js';
import { bridge } from '../bridge.js';
import { startChat } from './nowchat.js';


// 抽卡记录：只存在这台设备的浏览器里。[{ id, at, ai }]，新的在前
const LOG_KEY = 'tv_draws';
const LOG_MAX = 300;
function readLog() {
    try { const v = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => x && typeof x.id === 'string' && Number.isFinite(x.at)) : []; } catch { return []; }
}
function writeLog(list) { try { localStorage.setItem(LOG_KEY, JSON.stringify(list.slice(0, LOG_MAX))); } catch { /* 存不下就算了 */ } }
function addLog(ids, ai = false) { const at = Date.now(); writeLog([...ids.map((id) => ({ id, at, ...(ai ? { ai: true } : {}) })), ...readLog()]); }
const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dayLabel = (key) => (key === dayKey(Date.now()) ? '今天' : key === dayKey(Date.now() - 86400000) ? '昨天' : key);
const todayIds = () => { const k = dayKey(Date.now()); return new Set(readLog().filter((x) => dayKey(x.at) === k).map((x) => x.id)); };

/** 抽卡记录：按天分开，点一个打开 */
function openLog(onOpen) {
    const body = h('div', { class: 'stack' });
    const s = sheet({ title: '抽卡记录', body });
    const draw = () => {
        const log = readLog();
        if (!log.length) { clear(body, h('div', { class: 'muted draw-none' }, '还没有抽过。')); return; }
        const days = [];
        for (const x of log) { const k = dayKey(x.at); if (days[days.length - 1]?.k !== k) days.push({ k, list: [] }); days[days.length - 1].list.push(x); }
        clear(body,
            h('div', { class: 'muted small' }, `只记在这台设备上，最多留 ${LOG_MAX} 条。`),
            days.map(({ k, list }) => h('div', { class: 'draw-day' },
                h('div', { class: 'sub-label' }, `${dayLabel(k)} · ${list.length} 张`),
                h('div', { class: 'rows' }, list.map((x) => {
                    const it = state.byId.get(x.id);
                    const gone = !it || it.deletedAt;
                    const time = new Date(x.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    return h('button', { class: `row-item draw-log-row ${gone ? 'gone' : ''}`, disabled: gone, onclick: () => { s.close(); onOpen(it.id); } },
                        h('div', { class: 'row-thumb', style: { '--tc': typeMeta(it?.type).color } }, it?.cover ? coverImg(it) : icon(typeMeta(it?.type).icon, { size: 18 })),
                        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, h('span', {}, gone ? '（已经不在仓库里）' : it.name), x.ai ? h('span', { class: 'chip-s info' }, 'AI 挑的') : null),
                            h('div', { class: 'row-sub' }, h('span', {}, time))));
                })))),
            btn('清空记录', { icon: 'trash', cls: 'ghost danger', onclick: async () => { if (await confirmDialog('清空这台设备上的抽卡记录？', { danger: true, ok: '清空' })) { writeLog([]); draw(); } } }));
    };
    draw();
}

/** @param list 仓库里当前看到的条目（已经按类型、筛选、搜索缩小过） */
export function openDraw(list) {
    const pool = list.filter((it) => !it.deletedAt);
    const label = typeMeta(pool[0]?.type).label || '条目';
    const seen = new Set(); // 这次打开抽到过的，抽完一轮之前不重复
    const out = h('div', { class: 'draw-out' });
    const s = sheet({ title: '抽一张', body: h('div', { class: 'stack' }) });

    // 在酒馆里打开时，角色卡可以直接开聊（酒馆里还没有就先导入）
    const canChat = (it) => it.type === 'character' && bridge.has('openChat') && it.files.length > 0;
    const card = (it, reason) => h('div', { class: 'draw-item' }, cardBtn(it, reason),
        canChat(it) ? btn('直接开聊', { icon: 'message', cls: 'sm primary draw-chat', title: '关掉卡匣，在酒馆里打开和它的聊天；酒馆里还没有这张卡会先导入', onclick: async (e) => { e.currentTarget.disabled = true; await startChat(it); } }) : null);
    const cardBtn = (it, reason) => h('button', { class: 'draw-card', style: { '--tc': typeMeta(it.type).color }, onclick: () => { s.close(); setTimeout(() => openDetail(it.id), 200); } },
        h('div', { class: 'draw-cover' }, it.cover ? coverImg(it) : icon(typeMeta(it.type).icon, { size: 26 })),
        h('div', { class: 'draw-info' },
            h('b', {}, it.name),
            reason ? h('div', { class: 'draw-reason' }, icon('sparkles', { size: 13 }), h('span', {}, reason)) : null,
            it.tags.length ? h('div', { class: 'draw-tags' }, it.tags.slice(0, 6).map((t) => h('span', { class: 'chip-s' }, t))) : null,
            h('div', { class: 'draw-desc' }, it.ai?.summary || it.description || it.notes || '还没有简介'),
            h('span', { class: 'draw-open' }, '点开看看', icon('chevronRight', { size: 13 }))));

    let skipToday = state.prefs.drawSkipToday === true;
    const roll = () => {
        const today = skipToday ? todayIds() : new Set();
        const can = pool.filter((it) => !today.has(it.id));
        if (!can.length) {
            clear(out, h('div', { class: 'muted draw-none' }, `这 ${pool.length} 个今天都抽过了。关掉下面的开关可以再抽，或者换个筛选范围。`));
            return;
        }
        let left = can.filter((it) => !seen.has(it.id));
        if (!left.length) { seen.clear(); left = can; if (can.length > 1) toast('都抽过一遍了，重新开始', 'ok'); }
        const it = left[Math.floor(Math.random() * left.length)];
        seen.add(it.id);
        addLog([it.id]);
        const done = skipToday ? pool.length - can.length + 1 : seen.size;
        clear(out, card(it), h('div', { class: 'muted small draw-count' }, skipToday ? `今天第 ${done} / ${pool.length} 个` : `第 ${done} / ${pool.length} 个`));
    };

    const want = h('input', { class: 'input', placeholder: '比如：轻松日常、慢热、有反转', maxlength: 300, onkeydown: (e) => { if (e.key === 'Enter') ask(); } });
    const askBtn = btn('让 AI 挑', { icon: 'sparkles', onclick: () => ask() });
    const pickN = [1, 3, 5, 10].includes(state.prefs.drawAiCount) ? state.prefs.drawAiCount : 3;
    const countSel = h('select', { class: 'select draw-ai-n', title: '挑几张', onchange: () => { state.prefs.drawAiCount = Number(countSel.value); savePrefs(); } }, [1, 3, 5, 10].map((k) => h('option', { value: k, selected: k === pickN }, `挑 ${k} 张`)));
    async function ask() {
        const v = want.value.trim();
        if (!v) { want.focus(); return; }
        askBtn.disabled = true;
        clear(out, h('div', { class: 'loading' }, h('span', { class: 'spinner' }), h('span', {}, 'AI 正在挑')));
        try {
            const body = { ids: pool.map((it) => it.id), want: v, count: Number(countSel.value) || 3 };
            let r = await api.post('/api/ai/recommend', body);
            // 候选太多一次看不完：先问一句，再分批初选、汇总
            if (r.needSplit) {
                if (!(await confirmDialog(`这次有 ${r.total} 个候选，AI 一次看不完。可以分 ${r.batches} 批先各挑几个，再汇总挑出最后的，一共发 ${r.requests} 次请求。也可以先在仓库里筛选，缩小范围。`, { title: '候选太多', ok: `分 ${r.batches} 批挑` }))) { clear(out, h('div', { class: 'muted draw-none' }, '没有挑。先在仓库里筛选或搜索，缩小范围再试。')); return; }
                clear(out, h('div', { class: 'loading' }, h('span', { class: 'spinner' }), h('span', {}, `AI 正在分 ${r.batches} 批挑，要等一会儿`)));
                r = await api.post('/api/ai/recommend', { ...body, split: true });
            }
            const picks = r.picks.map((x) => [state.byId.get(x.id), x.reason]).filter(([it]) => it);
            if (picks.length) addLog(picks.map(([it]) => it.id), true);
            clear(out, picks.length ? picks.map(([it, reason]) => card(it, reason)) : h('div', { class: 'muted draw-none' }, '这些里面没有特别合适的。换个说法，或者放宽仓库里的筛选再试。'));
        } catch (e) {
            clear(out, h('div', { class: 'note warn' }, icon('alert', { size: 15 }), h('span', {}, e.message)));
        } finally { askBtn.disabled = false; }
    }

    clear(s.body,
        h('div', { class: 'muted small' }, `从仓库里现在看到的 ${pool.length} 个${label}里挑。想换范围，先在仓库里筛选或搜索。`),
        out,
        btn(pool.length > 1 ? '随便抽一张' : '就这一个', { icon: 'dice', cls: 'primary block', onclick: roll }),
        h('div', { class: 'draw-opts' },
            h('label', { class: 'check-line grow' }, switchEl(skipToday, (v) => { skipToday = v; state.prefs.drawSkipToday = v; savePrefs(); }), h('span', {}, '今天抽过的不再抽')),
            btn('抽卡记录', { icon: 'clock', cls: 'sm ghost', onclick: () => openLog((id) => { s.close(); setTimeout(() => openDetail(id), 200); }) })),
        aiReady() ? h('div', { class: 'draw-ai' },
            h('div', { class: 'form-label' }, '或者说说想找什么样的'),
            h('div', { class: 'draw-ai-row' }, want, countSel, askBtn),
            h('div', { class: 'muted small' }, '只把名称、标签、简介和笔记发给 AI，不发文件内容。候选太多时会先问你要不要分批挑。')) : null);
    clear(out, h('div', { class: 'draw-empty' }, icon('dice', { size: 30, stroke: 1.5 }), h('span', {}, '不知道看哪张？抽一张试试')));
}
