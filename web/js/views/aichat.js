// AI 对话：多轮聊天，可以指定藏馆里的条目当参考资料；对话存在服务器，回复在后台生成
import { h, clear, toast, sheet, btn, icon, confirmDialog, promptDialog, timeAgo, emptyState } from '../ui.js';
import { api } from '../api.js';
import { state, live } from '../state.js';
import { typeBadge } from './common.js';
import { coverImg } from '../thumbs.js';
import { mdLite } from '../richtext.js';
import { openDetail } from './detail.js';
import { diffView } from './diff.js';

const MAX_REFS = 5;
const EDIT_BLOCK = /```[ \t]*tv-edit[ \t]*\r?\n[\s\S]*?\r?\n?[ \t]*```/g;
const ROUNDS = [[6, '最近 6 轮'], [12, '最近 12 轮'], [24, '最近 24 轮'], [0, '全部']];
const SCOPES = [['full', '完整', '读取全部内容（世界书、所有开场白），问细节时用'], ['standard', '标准', '只读主要内容和世界书摘要，省 token']];
const IDEAS_REF = ['这张卡的设定有没有前后矛盾的地方？', '总结一下人设和玩法，适合什么样的聊天？', '开场白还能怎么改得更吸引人？', '世界书里有没有重复或者触发不了的条目？'];
const IDEAS = ['写角色卡时，描述、性格、场景各该写些什么？', '世界书条目的关键词怎么设比较好？', '怎么让角色说话更有个性？'];

// SSE：服务器生成完回复会推送 aichat 事件
const listeners = new Set();
export function handleAiChatEvent(data) { for (const fn of listeners) fn(data); }

let opened = null;

/** 打开对话窗口。refs：指定的条目；id：打开已有的对话 */
export function openAiChat({ refs = [], id = null } = {}) {
    if (!state.settings.ai?.ready) { toast('先到「设置 → AI 助手」添加 AI 服务', 'err'); return null; }
    if (opened) opened.close();
    refs = refs.filter((x) => state.byId.has(x));
    if (refs.length > MAX_REFS) { toast(`一次最多指定 ${MAX_REFS} 项，已取前 ${MAX_REFS} 项`); refs = refs.slice(0, MAX_REFS); }

    // cur：当前对话；还没发第一条消息时 id 为空，只存在网页里
    let cur = blank(refs);
    let view = 'chat'; // chat | history
    let profiles = [];
    let showOpts = false;
    let pollTimer = null;
    let historyQ = '';

    const msgs = h('div', { class: 'chat-msgs' });
    const input = h('textarea', { class: 'textarea chat-input', rows: 1, maxlength: 12000, placeholder: '想问什么就写在这里', oninput: () => grow(), onkeydown: (e) => {
        // 电脑上 Enter 发送，Shift+Enter 换行；手机键盘的回车只换行
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); send(); }
    } });
    const sendBtn = h('button', { class: 'btn primary icon chat-send', title: '发送', onclick: () => (cur.pending ? stop() : send()) });
    const refsRow = h('div', { class: 'chat-refs' });
    const optsBox = h('div', { class: 'chat-opts', hidden: true });
    const compose = h('div', { class: 'chat-compose' }, refsRow, optsBox, h('div', { class: 'chat-inputrow' }, input, sendBtn));
    const histBtn = btn('', { icon: 'clock', cls: 'ghost icon', title: '历史对话', onclick: () => { view = view === 'history' ? 'chat' : 'history'; draw(); } });
    const newBtn = btn('', { icon: 'plus', cls: 'ghost icon', title: '新对话', onclick: () => { cur = blank([]); view = 'chat'; draw(); input.focus(); } });
    const s = sheet({
        title: '', body: msgs, full: true, headExtra: h('div', { class: 'chat-head-acts' }, histBtn, newBtn),
        onClose: () => { listeners.delete(onEvent); clearTimeout(pollTimer); opened = null; },
    });
    s.el.classList.add('ai-chat');
    const foot = h('div', { class: 'sheet-foot chat-foot' }, compose);
    s.el.append(foot);
    opened = s;

    function blank(r) { return { id: '', title: '新对话', refs: r, scope: 'full', rounds: 12, profile: '', messages: [], pending: false }; }
    function grow() { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 180)}px`; }

    const onEvent = (d) => {
        if (d.id === cur.id && d.stream) {
            // 正在生成：接上新增的部分；中间漏了就重新取全文
            if (cur.pending && (cur.partial || '').length === d.stream.at) { cur.partial = (cur.partial || '') + d.stream.add; drawLive(); } else refresh();
        } else if (d.id === cur.id) refresh();
        else if (view === 'history' && !d.stream) draw();
    };
    listeners.add(onEvent);

    api.get('/api/ai/config').then((c) => { profiles = c.profiles; if (showOpts) drawOpts(); }).catch(() => {});

    async function refresh() {
        if (!cur.id) return;
        try {
            const sc = s.body;
            const atBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80;
            cur = await api.get(`/api/ai/chats/${cur.id}`);
            drawMessages(atBottom);
        } catch (e) { toast(e.message, 'err'); }
        schedulePoll();
    }
    // 万一 SSE 断了：回复中时隔几秒查一次
    function schedulePoll() {
        clearTimeout(pollTimer);
        if (cur.pending) pollTimer = setTimeout(refresh, 4000);
    }

    async function save(patch) {
        Object.assign(cur, patch);
        if (cur.id) {
            try { cur = await api.patch(`/api/ai/chats/${cur.id}`, patch); } catch (e) { toast(e.message, 'err'); }
        }
        draw();
    }

    async function send(text = input.value) {
        text = text.trim();
        if (!text || cur.pending) return;
        sendBtn.disabled = true;
        try {
            cur = cur.id
                ? await api.post(`/api/ai/chats/${cur.id}/send`, { text })
                : await api.post('/api/ai/chats', { text, refs: cur.refs, scope: cur.scope, rounds: cur.rounds, profile: cur.profile });
            input.value = '';
            grow();
            draw(true);
            schedulePoll();
        } catch (e) { toast(e.message, 'err'); }
        sendBtn.disabled = false;
    }
    async function retry() {
        try { cur = await api.post(`/api/ai/chats/${cur.id}/send`, { retry: true }); draw(true); schedulePoll(); } catch (e) { toast(e.message, 'err'); }
    }
    async function stop() {
        try { await api.post(`/api/ai/chats/${cur.id}/stop`); } catch (e) { toast(e.message, 'err'); }
    }

    // ---------------- 绘制 ----------------
    function draw(scrollEnd = false) {
        s.title.textContent = view === 'history' ? '历史对话' : cur.title || '新对话';
        histBtn.classList.toggle('active', view === 'history');
        foot.hidden = view === 'history';
        if (view === 'history') { drawHistory(); return; }
        drawRefs();
        if (showOpts) drawOpts();
        optsBox.hidden = !showOpts;
        drawMessages(scrollEnd);
    }

    function drawMessages(scrollEnd) {
        const list = cur.messages;
        clear(sendBtn, icon(cur.pending ? 'square' : 'arrowUp', { size: 18 }));
        sendBtn.title = cur.pending ? '停止' : '发送';
        sendBtn.classList.toggle('stop', Boolean(cur.pending));
        if (!list.length) {
            const ideas = cur.refs.length ? IDEAS_REF : IDEAS;
            clear(msgs, h('div', { class: 'chat-empty' },
                icon('message', { size: 28 }),
                h('div', { class: 'chat-empty-title' }, cur.refs.length ? `已指定 ${cur.refs.length} 项，问问${cur.refs.length > 1 ? '它们' : '它'}吧` : '和 AI 聊聊你的收藏'),
                h('div', { class: 'muted small' }, cur.refs.length
                    ? '每次发送时会读取这些条目当前的内容一起发给 AI，回复里会尽量指出出处。'
                    : '点下方「指定条目」把角色卡、世界书等加进来，AI 才能看到它们的内容。'),
                h('div', { class: 'chat-ideas' }, ideas.map((t) => h('button', { class: 'chat-idea', onclick: () => send(t) }, t)))));
        } else {
            const lastIdx = list.length - 1;
            liveBox = cur.pending ? h('div', { class: 'chat-bubble' }) : null;
            clear(msgs, list.map((m, i) => bubble(m, i === lastIdx)), liveBox ? h('div', { class: 'chat-msg ai pending' }, liveBox) : null);
            if (liveBox) drawLive(false);
        }
        if (scrollEnd) requestAnimationFrame(() => { s.body.scrollTop = s.body.scrollHeight; });
    }

    // 正在生成的回复：边收边显示；修改块要等写完才显示成卡片，写的过程中先藏起来
    let liveBox = null;
    function drawLive(follow = true) {
        if (!liveBox) return;
        const sc = s.body;
        const atBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80;
        const text = (cur.partial || '').replace(EDIT_BLOCK, '').replace(/```[ \t]*tv-edit[\s\S]*$/, '').trim();
        const writingEdit = /```[ \t]*tv-edit/.test(cur.partial || '');
        if (!text) clear(liveBox, h('span', { class: 'spinner sm' }), h('span', { class: 'muted' }, writingEdit ? '正在写修改建议…' : '正在回复，可以先关掉，回复好了会保存在这里'));
        else {
            // 光标接在最后一个字后面：放进最后一段（列表、引用往里找到最后一项）
            const md = mdLite(text);
            let last = md.lastElementChild;
            while (last?.lastElementChild && /^(UL|OL|BLOCKQUOTE)$/.test(last.tagName)) last = last.lastElementChild;
            (last && last.tagName !== 'PRE' ? last : md).append(h('span', { class: 'chat-caret' }));
            clear(liveBox, md, writingEdit ? h('div', { class: 'muted small' }, '正在写修改建议…') : null);
        }
        if (follow && atBottom) sc.scrollTop = sc.scrollHeight;
    }

    function bubble(m, isLast) {
        if (m.role === 'user') return h('div', { class: 'chat-msg user' }, h('div', { class: 'chat-bubble' }, m.text));
        if (m.error) {
            return h('div', { class: 'chat-msg ai' }, h('div', { class: 'note warn chat-err' }, icon('alert', { size: 15 }),
                h('span', { class: 'grow' }, m.error),
                isLast && !cur.pending ? btn('重试', { icon: 'refresh', cls: 'sm', onclick: retry }) : null));
        }
        const shown = m.edits?.length ? m.text.replace(EDIT_BLOCK, '').trim() : m.text;
        return h('div', { class: 'chat-msg ai' },
            shown ? h('div', { class: 'chat-bubble' }, mdLite(shown)) : null,
            (m.edits || []).map((e) => editCard(m, e)),
            m.stopped ? h('div', { class: 'muted small chat-note' }, `${m.stopped}，上面是已经生成的部分。`) : null,
            m.truncated ? h('div', { class: 'muted small chat-note' }, '回复写到一半被截断了。可以让它「继续」，或者在 AI 服务设置里调大「最大输出 tokens」。') : null,
            h('div', { class: 'chat-meta' },
                h('span', {}, [m.model, m.at ? timeAgo(m.at) : ''].filter(Boolean).join(' · ')),
                h('button', { class: 'btn ghost sm icon', title: '复制', onclick: () => copy(m.text) }, icon('copy', { size: 14 }))));
    }

    // ---------------- 修改建议：预览、应用、撤销 ----------------
    function editCard(m, e) {
        const done = m.applied?.[e.block];
        const live = done && !done.undoneAt;
        const it = state.byId.get(e.itemId);
        return h('div', { class: `chat-edit ${live ? 'applied' : ''}` },
            h('div', { class: 'chat-edit-head' }, icon(live ? 'checkCircle' : 'pencil', { size: 16 }),
                h('span', { class: 'grow' }, live ? `已存成「${it?.name || e.name}」的新版本` : `修改建议 · ${e.name || '?'}`)),
            e.labels.length ? h('div', { class: 'chat-edit-labels' }, e.labels.map((l) => h('span', { class: 'chip-s' }, l))) : null,
            e.error ? h('div', { class: 'muted small' }, e.error) : null,
            done?.undoneAt && !live ? h('div', { class: 'muted small' }, '已撤销，可以重新应用') : null,
            e.error ? null : h('div', { class: 'chat-edit-acts' },
                btn('预览改动', { icon: 'eye', cls: 'sm', onclick: () => previewEdit(m, e) }),
                live ? btn('查看', { icon: 'external', cls: 'sm ghost', onclick: () => openDetail(e.itemId) }) : null,
                live ? btn('撤销', { icon: 'restore', cls: 'sm', onclick: (ev) => editAction(m, e, 'undo', ev.currentTarget) })
                    : btn('应用', { icon: 'check', cls: 'sm primary', onclick: (ev) => editAction(m, e, 'apply', ev.currentTarget) })));
    }

    async function editAction(m, e, action, b) {
        if (b) b.disabled = true;
        try {
            const r = await api.post(`/api/ai/chats/${cur.id}/edit`, { msg: m.id, block: e.block, action });
            toast(action === 'apply' ? `已存成新版本，原来的版本还在${r.errors?.length ? `（${r.errors.length} 处没能应用）` : ''}` : r.note || '已撤销，换回了原来的版本', 'ok');
            cur = await api.get(`/api/ai/chats/${cur.id}`);
            drawMessages(false);
            return r;
        } catch (err) { toast(err.message, 'err'); if (b) b.disabled = false; return null; }
    }

    function previewEdit(m, e) {
        const body = h('div', { class: 'loading' }, h('span', { class: 'spinner' }));
        const foot = h('div', { class: 'sheet-foot' });
        const ps = sheet({ title: `改动预览 · ${e.name}`, body, full: true });
        ps.el.append(foot);
        foot.hidden = true;
        api.post(`/api/ai/chats/${cur.id}/edit`, { msg: m.id, block: e.block, action: 'preview' }).then((r) => {
            const changed = r.diffs.filter((d) => d.changed);
            clear(body, h('div', { class: 'stack-s' },
                h('div', { class: 'muted small' }, r.applied ? '这个修改已经应用了。撤销会删掉 AI 改出的版本，换回原来的版本。' : `和「${r.name}」现在的内容比较。应用后存成一个新版本，原来的版本保留，随时可以撤销或在「文件」里切回去。`),
                r.errors.map((x) => h('div', { class: 'note warn' }, icon('alert', { size: 15 }), h('span', {}, x))),
                changed.map((d) => h('section', { class: 'panel chat-edit-diff' },
                    h('div', { class: 'sub-label' }, d.label, h('span', { class: 'muted' }, ` · ${d.before.length} → ${d.after.length} 字`)),
                    d.before ? diffView(d.before, d.after) : h('pre', { class: 'code' }, d.after))),
                r.diffs.filter((d) => !d.changed).map((d) => h('div', { class: 'muted small' }, `「${d.label}」内容没有变化`))));
            foot.hidden = false;
            clear(foot, btn('关闭', { onclick: () => ps.close() }),
                r.applied ? btn('撤销', { icon: 'restore', onclick: async (ev) => { if (await editAction(m, e, 'undo', ev.currentTarget)) ps.close(); } })
                    : changed.length ? btn('应用', { icon: 'check', cls: 'primary', onclick: async (ev) => { if (await editAction(m, e, 'apply', ev.currentTarget)) ps.close(); } }) : null);
        }).catch((err) => clear(body, h('div', { class: 'note warn' }, err.message)));
    }

    async function copy(text) {
        try { await navigator.clipboard.writeText(text); toast('已复制', 'ok'); } catch { toast('复制失败，可以长按文字选择', 'err'); }
    }

    function drawRefs() {
        const items = cur.refs.map((x) => state.byId.get(x)).filter(Boolean);
        clear(refsRow,
            items.map((it) => h('span', { class: 'chat-ref' },
                h('button', { class: 'chat-ref-name', title: '查看', onclick: () => openDetail(it.id) }, it.name),
                h('button', { class: 'chat-ref-x', title: '移除', 'aria-label': '移除', onclick: () => save({ refs: cur.refs.filter((x) => x !== it.id) }) }, icon('x', { size: 13 })))),
            items.length < MAX_REFS ? h('button', { class: 'chat-chip', onclick: pickRefs }, icon('plus', { size: 14 }), h('span', {}, items.length ? '指定条目' : '指定条目（让 AI 看到卡的内容）')) : null,
            h('button', { class: `chat-chip ${showOpts ? 'on' : ''}`, title: '读取范围、带上几轮对话', onclick: () => { showOpts = !showOpts; draw(); } }, icon('sliders', { size: 14 }), h('span', {}, '设置')));
    }

    function drawOpts() {
        const seg = (list, val, onPick) => h('div', { class: 'opts' }, list.map(([v, label]) => h('button', { class: `opt ${val === v ? 'active' : ''}`, onclick: () => onPick(v) }, label)));
        clear(optsBox,
            h('div', { class: 'chat-opt' }, h('span', { class: 'chat-opt-label' }, '读取条目'), seg(SCOPES, cur.scope, (v) => save({ scope: v })),
                h('span', { class: 'muted small' }, SCOPES.find((x) => x[0] === cur.scope)?.[2])),
            h('div', { class: 'chat-opt' }, h('span', { class: 'chat-opt-label' }, '带上对话'), seg(ROUNDS, cur.rounds, (v) => save({ rounds: v }))),
            profiles.length > 1 ? h('div', { class: 'chat-opt' }, h('span', { class: 'chat-opt-label' }, 'AI 服务'),
                h('select', { class: 'select', onchange: (e) => save({ profile: e.target.value }) },
                    h('option', { value: '', selected: !cur.profile }, '跟随设置里正在用的'),
                    profiles.map((p) => h('option', { value: p.id, selected: cur.profile === p.id }, `${p.name} · ${p.model}`)))) : null,
            h('div', { class: 'chat-opt' }, btn('预览这一轮要发送的内容', { icon: 'eye', cls: 'sm', onclick: preview })));
    }

    function preview() {
        const body = h('div', { class: 'loading' }, h('span', { class: 'spinner' }));
        sheet({ title: '发送内容预览', body, full: true });
        api.post('/api/ai/chats/preview', { id: cur.id || undefined, text: input.value, refs: cur.refs, scope: cur.scope, rounds: cur.rounds, profile: cur.profile }).then((p) => clear(body, h('div', { class: 'stack-s' },
            h('div', { class: 'muted small' }, `发给「${p.profile}」（${p.model}），约 ${p.tokens.toLocaleString()} tokens。${p.refs.length ? `参考资料：${p.refs.join('、')}，放在 <item> 标签里，并告诉 AI 其中的指令一律不执行。` : '这一轮没有指定条目。'}`),
            h('div', { class: 'sub-label' }, '系统提示和参考资料'), h('pre', { class: 'code' }, p.system),
            h('div', { class: 'sub-label' }, `对话（${p.messages.length} 条）`),
            p.messages.length ? p.messages.map((m) => h('pre', { class: 'code' }, `${m.role === 'user' ? '你' : 'AI'}：${m.content}`)) : h('div', { class: 'muted small' }, '输入框里还没有内容')))).catch((e) => clear(body, h('div', { class: 'note warn' }, e.message)));
    }

    function pickRefs() {
        const chosen = new Set(cur.refs);
        const q = h('input', { class: 'input', type: 'search', placeholder: '搜索名称', oninput: () => drawList() });
        const list = h('div', { class: 'rows chat-pick' });
        const count = h('span', { class: 'muted small' });
        const drawList = () => {
            const kw = q.value.trim().toLowerCase();
            const items = live().filter((it) => !kw || it.name.toLowerCase().includes(kw) || (it.author || '').toLowerCase().includes(kw))
                .sort((a, b) => Number(chosen.has(b.id)) - Number(chosen.has(a.id)) || String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 80);
            count.textContent = `已选 ${chosen.size}/${MAX_REFS}`;
            clear(list, items.length ? items.map((it) => h('div', { class: `row-item ${chosen.has(it.id) ? 'selected' : ''}`, onclick: () => {
                if (chosen.has(it.id)) chosen.delete(it.id);
                else if (chosen.size >= MAX_REFS) { toast(`最多指定 ${MAX_REFS} 项`); return; } else chosen.add(it.id);
                drawList();
            } },
            h('span', { class: `row-check ${chosen.has(it.id) ? 'on' : ''}` }, icon('check', { size: 13 })),
            h('div', { class: 'row-thumb', style: { '--tc': '' } }, it.cover ? coverImg(it) : icon('file', { size: 18 })),
            h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, it.name), h('div', { class: 'row-sub' }, typeBadge(it.type), it.author ? h('span', {}, it.author) : null))))
                : emptyState('search', '没有找到', ''));
        };
        drawList();
        const ps = sheet({
            title: '指定条目', body: h('div', { class: 'stack-s' }, q, list),
            foot: [count, h('span', { class: 'grow' }), btn('确定', { icon: 'check', cls: 'primary', onclick: () => { ps.close(); save({ refs: [...chosen] }); } })],
        });
        if (!matchMedia('(pointer: coarse)').matches) q.focus();
    }

    async function drawHistory() {
        clear(msgs, h('div', { class: 'loading' }, h('span', { class: 'spinner' })));
        let sessions = [];
        try { ({ sessions } = await api.get('/api/ai/chats')); } catch (e) { clear(msgs, h('div', { class: 'note warn' }, e.message)); return; }
        if (view !== 'history') return;
        const q = h('input', { class: 'input', type: 'search', placeholder: '搜索标题', value: historyQ, oninput: () => { historyQ = q.value; drawRows(); } });
        const rows = h('div', { class: 'rows' });
        const drawRows = () => {
            const kw = historyQ.trim().toLowerCase();
            const list = sessions.filter((x) => !kw || x.title.toLowerCase().includes(kw) || x.last.toLowerCase().includes(kw))
                .sort((a, b) => Number(b.fav) - Number(a.fav) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
            clear(rows, list.length ? list.map((x) => h('div', { class: `row-item chat-hist ${x.id === cur.id ? 'active' : ''}`, onclick: async () => {
                try { cur = await api.get(`/api/ai/chats/${x.id}`); view = 'chat'; draw(true); schedulePoll(); } catch (e) { toast(e.message, 'err'); }
            } },
            h('div', { class: 'row-main' },
                h('div', { class: 'row-title' }, x.fav ? icon('star', { size: 13, cls: 'chat-fav' }) : null, h('span', {}, x.title), x.pending ? h('span', { class: 'spinner sm' }) : null),
                h('div', { class: 'row-sub' }, h('span', {}, `${x.count} 轮 · ${timeAgo(x.updatedAt)}`), x.refs.length ? h('span', {}, `参考 ${x.refs.map((r) => state.byId.get(r)?.name).filter(Boolean).join('、') || `${x.refs.length} 项`}`) : null),
                x.last ? h('div', { class: 'muted small chat-last' }, x.last) : null),
            h('div', { class: 'row-actions', onclick: (e) => e.stopPropagation() },
                btn('', { icon: 'star', cls: `ghost icon sm ${x.fav ? 'on' : ''}`, title: x.fav ? '取消收藏' : '收藏（收藏的对话不会被自动清理）', onclick: async () => { await api.patch(`/api/ai/chats/${x.id}`, { fav: !x.fav }); x.fav = !x.fav; drawRows(); } }),
                btn('', { icon: 'pencil', cls: 'ghost icon sm', title: '重命名', onclick: async () => {
                    const t = await promptDialog('', { title: '重命名对话', value: x.title });
                    if (!t?.trim()) return;
                    await api.patch(`/api/ai/chats/${x.id}`, { title: t });
                    x.title = t.trim();
                    if (x.id === cur.id) cur.title = x.title;
                    drawRows();
                } }),
                btn('', { icon: 'trash', cls: 'ghost icon sm danger', title: '删除', onclick: async () => {
                    if (!(await confirmDialog(`删除对话「${x.title}」？`, { danger: true, ok: '删除' }))) return;
                    await api.del(`/api/ai/chats/${x.id}`);
                    sessions = sessions.filter((y) => y.id !== x.id);
                    if (x.id === cur.id) cur = blank([]);
                    drawRows();
                } }))))
                : emptyState('message', kw ? '没有找到' : '还没有对话', kw ? '' : '发出第一条消息后，对话会保存在这里。'));
        };
        drawRows();
        clear(msgs, h('div', { class: 'stack-s chat-history' }, h('div', { class: 'chat-hist-top' }, q, btn('新对话', { icon: 'plus', cls: 'sm', onclick: () => newBtn.click() })), rows));
    }

    draw();
    if (!matchMedia('(pointer: coarse)').matches) input.focus();
    return s;
}
