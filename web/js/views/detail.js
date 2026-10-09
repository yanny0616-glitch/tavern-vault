// 条目详情：概览 / 内容 / 文件
import { h, clear, sheet, toast, confirmDialog, promptDialog, lightbox, fmtBytes, fmtDate, timeAgo, debounce, downloadBlob, switchEl } from '../ui.js';
import { api } from '../api.js';
import { bridge } from '../bridge.js';
import { state, typeMeta, TYPE_META, fieldsFor, reload, subscribe } from '../state.js';
import { coverEl, collectionName } from './common.js';
import { pickCollection } from './library.js';
import { importItemsToTavern } from './tavern.js';

const TOP_LEVEL_FIELDS = new Set(['source', 'author', 'version', 'rating']);

export function openDetail(id) {
    let tab = 'overview';
    let content = null; // 缓存的文件内容
    let contentSha = '';
    const s = sheet({ title: '', body: h('div'), full: true, onClose: () => unsub() });
    const unsub = subscribe(() => {
        const it = state.byId.get(id);
        if (!it) { s.close(); return; }
        // 主文件变化时重新加载内容
        const p = primary(it);
        if (p?.sha !== contentSha) content = null;
        const ae = document.activeElement;
        const typing = ae && s.el.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && ae.type !== 'checkbox';
        if (!typing) render();
    });

    const primary = (it) => it.files.find((f) => f.primary) || it.files[0];

    async function loadContent(it) {
        const p = primary(it);
        contentSha = p?.sha || '';
        content = await api.get(`/api/items/${id}/content`).catch((e) => ({ kind: 'error', error: e.message }));
        render();
    }

    function render() {
        const it = state.byId.get(id);
        if (!it) return;
        const tm = typeMeta(it.type);
        s.title.textContent = `${tm.icon} ${it.name}`;
        const tabs = [['overview', '概览'], ['content', '内容'], ['files', `文件 ${it.files.length}`]];
        const body = h('div', {},
            hero(it),
            h('div', { class: 'tabs' }, tabs.map(([k, label]) => h('button', { class: tab === k ? 'active' : '', onclick: () => { tab = k; render(); } }, label))),
            tab === 'overview' ? overview(it) : tab === 'content' ? contentTab(it) : filesTab(it));
        clear(s.body, body);
        if (!s.foot) {
            s.foot = h('div', { class: 'sheet-foot' });
            s.el.append(s.foot);
        }
        const p = primary(it);
        clear(s.foot,
            p ? h('a', { class: 'btn', href: api.fileUrl(p.sha, p.name, true), download: p.name }, '⬇️ 下载') : null,
            bridge.host ? h('button', { class: 'btn primary', onclick: () => importItemsToTavern([it]) }, '🍺 导入到酒馆') : null,
            it.deletedAt
                ? h('button', { class: 'btn', onclick: async () => { await api.post(`/api/items/${id}/restore`); toast('已恢复', 'ok'); } }, '♻️ 恢复')
                : h('button', { class: 'btn danger', onclick: async () => {
                    if (await confirmDialog(`把「${it.name}」移入回收站？`, { danger: true, ok: '删除' })) { await api.del(`/api/items/${id}`); toast('已移入回收站'); s.close(); }
                } }, '🗑️ 删除'));
    }

    // ---------- 头部 ----------
    function hero(it) {
        const tm = typeMeta(it.type);
        const c = it.meta?.card;
        const save = (patch) => api.patch(`/api/items/${id}`, patch).catch((e) => toast(e.message, 'err'));
        const stars = h('span', { class: 'stars' }, [1, 2, 3, 4, 5].map((n) => h('span', { class: n <= (it.rating || 0) ? 'on' : '', onclick: () => save({ rating: it.rating === n ? 0 : n }) }, '⭐')));
        return h('div', { class: 'detail-hero' },
            h('div', { class: 'detail-cover', onclick: () => it.cover && lightbox(api.fileUrl(it.cover)) }, coverEl(it)),
            h('div', { class: 'grow' },
                h('div', { class: 'detail-title' }, it.name),
                h('div', { class: 'row wrap', style: { marginBottom: '8px' } },
                    h('span', { class: 'badge', style: { background: `color-mix(in srgb, ${tm.color} 22%, transparent)`, color: tm.color } }, `${tm.icon} ${tm.label}`),
                    it.subtype ? h('span', { class: 'badge' }, it.subtype) : null,
                    it.origin === 'tavern' ? h('span', { class: 'badge ok' }, '来自酒馆') : null,
                    it.deletedAt ? h('span', { class: 'badge warn' }, '已删除') : null),
                h('div', { class: 'row', style: { marginBottom: '6px' } },
                    stars,
                    h('button', { class: 'btn sm ghost', onclick: () => save({ favorite: !it.favorite }) }, it.favorite ? '⭐ 已收藏' : '☆ 收藏')),
                it.author ? h('div', { class: 'muted small' }, '作者：', it.author) : null,
                c ? h('div', { class: 'muted small' }, [
                    c.characterVersion && `版本 ${c.characterVersion}`,
                    `${c.greetings} 条开场白`,
                    c.bookEntries && `世界书 ${c.bookEntries} 条`,
                    c.regexCount && `正则 ${c.regexCount}`,
                    c.scriptCount && `脚本 ${c.scriptCount}`,
                    `≈${c.estTokens} tokens`,
                ].filter(Boolean).join(' · ')) : null,
                h('div', { class: 'muted small' }, `添加于 ${fmtDate(it.createdAt)} · 更新 ${timeAgo(it.updatedAt)}`)));
    }

    // ---------- 概览 ----------
    function overview(it) {
        const save = debounce((patch) => api.patch(`/api/items/${id}`, patch).catch((e) => toast(e.message, 'err')), 500);
        const saveNow = (patch) => api.patch(`/api/items/${id}`, patch).catch((e) => toast(e.message, 'err'));

        const tagInput = h('input', {
            class: 'input', placeholder: '输入标签后回车', style: { flex: 1, minWidth: '120px', height: '32px', fontSize: '14px' },
            onkeydown: (e) => {
                if (e.key === 'Enter' && tagInput.value.trim()) {
                    const add = tagInput.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
                    saveNow({ tags: [...it.tags, ...add] });
                    tagInput.value = '';
                }
            },
        });
        const tagsSec = h('div', { class: 'section' }, h('h3', {}, '🏷️ 标签'),
            h('div', { class: 'row wrap' },
                it.tags.map((t) => h('span', { class: 'tag' }, t, h('span', { class: 'x', onclick: () => saveNow({ tags: it.tags.filter((x) => x !== t) }) }, '✕'))),
                tagInput));

        const colSec = h('div', { class: 'section' }, h('h3', {}, '📚 合集'),
            h('div', { class: 'row wrap' },
                it.collections.map((cid) => h('span', { class: 'tag' }, collectionName(cid) || '（已删除）', h('span', { class: 'x', onclick: () => saveNow({ collections: it.collections.filter((x) => x !== cid) }) }, '✕'))),
                h('button', { class: 'btn sm', onclick: () => pickCollection((cid) => { if (!it.collections.includes(cid)) saveNow({ collections: [...it.collections, cid] }); }) }, '＋ 加入合集')));

        // 基本信息 + 自定义字段
        const nameInput = h('input', { class: 'input', value: it.name, onchange: () => saveNow({ name: nameInput.value.trim() || it.name }) });
        const typeSel = h('select', { class: 'select', onchange: () => saveNow({ type: typeSel.value }) },
            Object.entries(TYPE_META).map(([k, v]) => h('option', { value: k, selected: it.type === k }, `${v.icon} ${v.label}`)));
        const descInput = h('textarea', { class: 'textarea', value: it.description, placeholder: '简介', oninput: () => save({ description: descInput.value }) });

        const fieldRows = fieldsFor(it.type).map((f) => {
            const top = TOP_LEVEL_FIELDS.has(f.id);
            const val = top ? it[f.id] : it.fields?.[f.id];
            const set = (v, now = false) => {
                const patch = top ? { [f.id]: v } : { fields: { ...it.fields, [f.id]: v } };
                (now ? saveNow : save)(patch);
                if (!top) it.fields = { ...it.fields, [f.id]: v };
            };
            return [h('label', {}, f.label), fieldInput(f, val, set)];
        });

        const infoSec = h('div', { class: 'section' }, h('h3', {}, '📋 信息'),
            h('div', { class: 'kv' },
                h('label', {}, '名称'), nameInput,
                h('label', {}, '类型'), typeSel,
                h('label', {}, '简介'), descInput,
                fieldRows.flat()));

        const notes = h('textarea', { class: 'textarea', value: it.notes, placeholder: '写点什么：玩法心得、搭配建议、修改记录……', style: { minHeight: '120px' }, oninput: () => save({ notes: notes.value }) });
        const notesSec = h('div', { class: 'section' }, h('h3', {}, '📝 笔记'), notes);

        return h('div', {}, quickInfo(it), tagsSec, colSec, infoSec, notesSec);
    }

    function quickInfo(it) {
        const m = it.meta || {};
        const stats = [];
        if (it.type === 'character' && m.card) {
            const c = m.card;
            stats.push(['开场白', c.greetings], ['世界书条目', c.bookEntries], ['内嵌正则', c.regexCount], ['内嵌脚本', c.scriptCount], ['估算 Token', c.estTokens]);
            if (m.image) stats.push(['图片尺寸', `${m.image.width}×${m.image.height}`]);
            stats.push(['卡片规范', c.spec?.replace('chara_card_', '').toUpperCase()]);
        } else if (it.type === 'worldbook') stats.push(['条目', m.entries], ['常驻', m.constant], ['禁用', m.disabled]);
        else if (it.type === 'preset') stats.push(['提示词', m.prompts], ['已启用', m.enabledPrompts], ['温度', m.temperature], ['上下文', m.maxContext], ['回复长度', m.maxTokens], ['类型', m.apiId]);
        else if (it.type === 'regex') stats.push(['脚本数', m.count || 1]);
        else if (it.type === 'quickreply') stats.push(['按钮数', m.count]);
        else if (it.type === 'chat') stats.push(['消息数', m.messages], ['角色', m.character], ['用户', m.user]);
        else if (m.image) stats.push(['图片尺寸', `${m.image.width}×${m.image.height}`]);
        const p = it.files.find((f) => f.primary) || it.files[0];
        if (p) stats.push(['文件大小', fmtBytes(p.size)]);
        const shown = stats.filter(([, v]) => v !== undefined && v !== null && v !== '');
        if (!shown.length) return null;
        const c = m.card;
        return h('div', { class: 'section' },
            h('div', { class: 'stat-grid' }, shown.map(([k, v]) => h('div', { class: 'stat' }, h('b', {}, String(v)), h('span', {}, k)))),
            c?.creatorNotesPreview ? h('div', { style: { marginTop: '12px' } }, h('div', { class: 'muted small', style: { marginBottom: '4px' } }, '作者注释'), h('div', { class: 'prose' }, c.creatorNotesPreview)) : null,
            c?.world ? h('div', { class: 'muted small', style: { marginTop: '8px' } }, '绑定世界书：', c.world) : null);
    }

    // ---------- 内容 ----------
    function contentTab(it) {
        if (!it.files.length) return h('div', { class: 'empty' }, '这个条目还没有文件');
        if (!content) { loadContent(it); return h('div', { class: 'empty' }, h('span', { class: 'spinner' })); }
        if (content.kind === 'error') return h('div', { class: 'empty' }, '加载失败：', content.error);
        if (content.kind === 'card') return cardView(it, content);
        if (content.kind === 'image') return h('div', {}, h('img', { src: api.fileUrl(content.file.sha), style: { maxWidth: '100%', borderRadius: '12px', margin: '0 auto' } }));
        if (content.kind === 'json') {
            const d = content.data;
            if (it.type === 'worldbook') return worldbookView(d);
            if (it.type === 'preset' && Array.isArray(d.prompts)) return presetView(d);
            if (it.type === 'regex') return regexView(Array.isArray(d) ? d : [d]);
            if (it.type === 'quickreply' && Array.isArray(d.qrList)) return qrView(d);
            if (it.type === 'theme') return themeView(d);
            return jsonView(d);
        }
        if (content.kind === 'text') return h('pre', { class: 'code' }, content.text);
        return h('div', { class: 'empty' }, '二进制文件，无法预览。可在「文件」页下载。');
    }

    function textBlock(title, text, open = false) {
        if (!text || !String(text).trim()) return null;
        return h('details', { class: 'fold', open }, h('summary', {}, title, h('span', { class: 'muted small', style: { marginLeft: 'auto', fontWeight: 400 } }, `${String(text).length} 字`)),
            h('div', { class: 'fold-body' }, h('div', { class: 'prose' }, text)));
    }

    function cardView(it, c) {
        const d = c.data || {};
        const ext = d.extensions || {};
        const book = d.character_book;
        const regex = ext.regex_scripts || [];
        const greetings = [d.first_mes, ...(d.alternate_greetings || [])].filter((x) => x != null);
        return h('div', {},
            h('div', { class: 'row', style: { marginBottom: '12px' } },
                h('span', { class: 'muted small grow' }, `${c.spec || ''}`),
                h('button', { class: 'btn sm', onclick: () => editCard(it, c) }, '✏️ 编辑角色卡'),
                h('button', { class: 'btn sm', onclick: () => downloadBlob(new Blob([JSON.stringify(c.card, null, 2)], { type: 'application/json' }), `${d.name || 'card'}.json`) }, '导出 JSON')),
            textBlock('📄 描述 Description', d.description, true),
            textBlock('🧠 性格 Personality', d.personality),
            textBlock('🌍 场景 Scenario', d.scenario),
            greetings.length ? h('details', { class: 'fold' }, h('summary', {}, `👋 开场白（${greetings.length}）`),
                h('div', { class: 'fold-body' }, greetings.map((g, i) => h('div', { style: { marginBottom: '10px' } },
                    h('div', { class: 'muted small', style: { marginBottom: '4px' } }, i === 0 ? '主开场白' : `备选 #${i}`), h('div', { class: 'prose' }, g))))) : null,
            textBlock('💬 对话示例', d.mes_example),
            textBlock('🧷 系统提示词', d.system_prompt),
            textBlock('📌 后置指令', d.post_history_instructions),
            textBlock('📎 深度提示词', ext.depth_prompt?.prompt),
            textBlock('🗒️ 作者注释 Creator Notes', d.creator_notes),
            book?.entries?.length ? h('details', { class: 'fold' }, h('summary', {}, `📖 内嵌世界书（${book.entries.length}）`), h('div', { class: 'fold-body' }, worldbookView(book))) : null,
            regex.length ? h('details', { class: 'fold' }, h('summary', {}, `🧩 内嵌正则（${regex.length}）`), h('div', { class: 'fold-body' }, regexView(regex))) : null,
            h('details', { class: 'fold' }, h('summary', {}, '🔧 原始 JSON'), h('div', { class: 'fold-body' }, h('pre', { class: 'code' }, JSON.stringify(c.card, null, 2)))));
    }

    function worldbookView(d) {
        const entries = Array.isArray(d.entries) ? d.entries : Object.values(d.entries || {});
        let q = '';
        const list = h('div');
        const draw = () => {
            const f = entries.filter((e) => !q || JSON.stringify([e.comment, e.key, e.keys, e.content]).toLowerCase().includes(q));
            clear(list, f.slice(0, 300).map((e) => {
                const keys = [].concat(e.key || e.keys || []).join(', ');
                const off = e.disable || e.enabled === false;
                return h('details', { class: 'fold' },
                    h('summary', {}, e.constant ? '🔵' : '🟢', h('span', { class: 'ellipsis grow', style: { opacity: off ? 0.5 : 1 } }, e.comment || e.name || keys || '(无标题)'),
                        off ? h('span', { class: 'badge' }, '禁用') : null),
                    h('div', { class: 'fold-body' },
                        keys ? h('div', { class: 'small muted', style: { marginBottom: '6px' } }, '关键词：', keys) : null,
                        h('div', { class: 'prose' }, e.content || '')));
            }), f.length > 300 ? h('div', { class: 'muted small' }, `仅显示前 300 条，共 ${f.length} 条`) : null);
        };
        draw();
        return h('div', {},
            h('input', { class: 'input', placeholder: `在 ${entries.length} 个条目中搜索…`, style: { marginBottom: '10px' }, oninput: (e) => { q = e.target.value.toLowerCase(); draw(); } }),
            list);
    }

    function presetView(d) {
        const order = d.prompt_order?.find((o) => o.character_id === 100001)?.order || d.prompt_order?.[0]?.order || [];
        const enabled = new Map(order.map((o) => [o.identifier, o.enabled]));
        const params = ['temperature', 'top_p', 'top_k', 'frequency_penalty', 'presence_penalty', 'repetition_penalty', 'openai_max_context', 'openai_max_tokens', 'stream_openai'].filter((k) => d[k] !== undefined);
        return h('div', {},
            h('div', { class: 'section' }, h('h3', {}, '参数'), h('div', { class: 'stat-grid' }, params.map((k) => h('div', { class: 'stat' }, h('b', {}, String(d[k])), h('span', {}, k))))),
            h('div', { class: 'section' }, h('h3', {}, `提示词（${d.prompts.length}）`),
                d.prompts.map((p) => h('details', { class: 'fold' },
                    h('summary', {}, enabled.get(p.identifier) === false ? '⚪' : '🟢', h('span', { class: 'ellipsis grow' }, p.name || p.identifier), p.role ? h('span', { class: 'badge' }, p.role) : null, p.marker ? h('span', { class: 'badge' }, 'marker') : null),
                    p.content ? h('div', { class: 'fold-body' }, h('div', { class: 'prose' }, p.content)) : null))),
            h('details', { class: 'fold' }, h('summary', {}, '🔧 原始 JSON'), h('div', { class: 'fold-body' }, h('pre', { class: 'code' }, JSON.stringify(d, null, 2)))));
    }

    function regexView(list) {
        return h('div', {}, list.map((r) => h('details', { class: 'fold' },
            h('summary', {}, r.disabled ? '⚪' : '🟢', h('span', { class: 'ellipsis grow' }, r.scriptName || '(未命名)')),
            h('div', { class: 'fold-body' },
                h('div', { class: 'muted small' }, '查找'), h('pre', { class: 'code' }, r.findRegex || ''),
                h('div', { class: 'muted small', style: { marginTop: '8px' } }, '替换为'), h('pre', { class: 'code' }, r.replaceString || '')))));
    }

    function qrView(d) {
        return h('div', {}, d.qrList.map((q) => h('details', { class: 'fold' }, h('summary', {}, '⚡', h('span', { class: 'grow' }, q.label || '(无标签)')), h('div', { class: 'fold-body' }, h('pre', { class: 'code' }, q.message || '')))));
    }

    function themeView(d) {
        const colors = Object.entries(d).filter(([, v]) => typeof v === 'string' && /^(#|rgba?\()/.test(v));
        return h('div', {},
            h('div', { class: 'section' }, h('h3', {}, '配色'), h('div', { class: 'row wrap' }, colors.map(([k, v]) => h('div', { class: 'row', style: { gap: '6px', marginRight: '10px' } },
                h('span', { style: { width: '22px', height: '22px', borderRadius: '6px', background: v, border: '1px solid var(--line-2)' } }), h('span', { class: 'small muted' }, k))))),
            jsonView(d));
    }

    function jsonView(d) {
        return h('pre', { class: 'code' }, JSON.stringify(d, null, 2));
    }

    // ---------- 编辑角色卡 ----------
    function editCard(it, c) {
        const d = structuredClone(c.data || {});
        const FIELDS = [
            ['name', '名称', 'input'], ['nickname', '昵称', 'input'], ['creator', '作者', 'input'], ['character_version', '版本', 'input'],
            ['description', '描述', 'textarea'], ['personality', '性格', 'textarea'], ['scenario', '场景', 'textarea'],
            ['first_mes', '主开场白', 'textarea'], ['mes_example', '对话示例', 'textarea'], ['system_prompt', '系统提示词', 'textarea'],
            ['post_history_instructions', '后置指令', 'textarea'], ['creator_notes', '作者注释', 'textarea'],
        ];
        const inputs = {};
        const tagsInput = h('input', { class: 'input', value: (d.tags || []).join(', ') });
        const greets = (d.alternate_greetings || []).slice();
        const greetBox = h('div');
        const drawGreets = () => clear(greetBox, greets.map((g, i) => h('div', { style: { marginBottom: '8px' } },
            h('div', { class: 'row' }, h('span', { class: 'muted small grow' }, `备选开场白 #${i + 1}`), h('button', { class: 'btn sm ghost danger', onclick: () => { greets.splice(i, 1); drawGreets(); } }, '删除')),
            h('textarea', { class: 'textarea', value: g, oninput: (e) => { greets[i] = e.target.value; } }))),
        h('button', { class: 'btn sm', onclick: () => { greets.push(''); drawGreets(); } }, '＋ 添加备选开场白'));
        drawGreets();
        const es = sheet({
            title: `编辑：${d.name}`, full: true,
            body: h('div', {},
                h('div', { class: 'muted small', style: { marginBottom: '12px' } }, '保存后会生成一个新版本文件（旧版本保留在「文件」页，可随时切回）。PNG 卡会保留原图片。'),
                h('div', { class: 'kv' }, FIELDS.map(([k, label, kind]) => {
                    inputs[k] = kind === 'input' ? h('input', { class: 'input', value: d[k] || '' }) : h('textarea', { class: 'textarea', value: d[k] || '', style: { minHeight: k === 'description' || k === 'first_mes' ? '180px' : '90px' } });
                    return [h('label', {}, label), inputs[k]];
                }).flat(), h('label', {}, '标签'), tagsInput, h('label', {}, '备选开场白'), greetBox)),
            foot: [
                h('button', { class: 'btn', onclick: () => es.close() }, '取消'),
                h('button', { class: 'btn primary', onclick: async (e) => {
                    e.target.disabled = true;
                    for (const [k] of FIELDS) d[k] = inputs[k].value;
                    d.tags = tagsInput.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
                    d.alternate_greetings = greets.filter((g) => g.trim());
                    try {
                        await api.put(`/api/items/${id}/card`, { card: { ...c.card, data: d } });
                        toast('已保存为新版本', 'ok');
                        content = null;
                        es.close();
                    } catch (err) { toast(err.message, 'err'); e.target.disabled = false; }
                } }, '💾 保存'),
            ],
        });
    }

    // ---------- 文件 ----------
    function filesTab(it) {
        const fileInput = h('input', { type: 'file', hidden: true, multiple: true, onchange: async () => {
            for (const f of fileInput.files) {
                try { await api.uploadVersion(id, f, { primary: asPrimary.checked }); } catch (e) { toast(e.message, 'err'); }
            }
            toast('上传完成', 'ok');
            fileInput.value = '';
        } });
        const asPrimary = h('input', { type: 'checkbox', checked: true });
        const sorted = [...it.files].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
        return h('div', {},
            h('div', { class: 'section' },
                h('h3', {}, '📁 文件与版本', h('span', { class: 'spacer' }), h('button', { class: 'btn sm primary', onclick: () => fileInput.click() }, '＋ 上传'), fileInput),
                h('label', { class: 'row small muted', style: { marginBottom: '6px' } }, asPrimary, '上传的文件设为主文件（新版本）；不勾选则作为附件保存'),
                sorted.map((f) => h('div', { class: 'file-row' },
                    h('div', { class: 'grow' },
                        h('div', { class: 'ellipsis', style: { fontWeight: 600 } }, f.primary ? '⭐ ' : '', f.name),
                        h('div', { class: 'muted small' }, `${fmtBytes(f.size)} · ${fmtDate(f.addedAt, true)}`, f.label ? ` · ${f.label}` : '')),
                    h('a', { class: 'btn sm icon', href: api.fileUrl(f.sha, f.name, true), download: f.name, title: '下载' }, '⬇'),
                    h('button', { class: 'btn sm', onclick: () => fileMenu(it, f) }, '⋯')))),
            h('div', { class: 'muted small' }, '提示：主文件决定条目的解析信息和「导入到酒馆」时使用的文件。'));
    }

    function fileMenu(it, f) {
        const m = sheet({
            title: f.name,
            body: h('div', { class: 'list' },
                !f.primary ? h('div', { class: 'list-row', onclick: async () => { m.close(); await api.patch(`/api/items/${id}/files/${f.id}`, { primary: true }); toast('已设为主文件', 'ok'); } }, '⭐ 设为主文件（切换到此版本）') : null,
                /^image\//.test(f.mime) ? h('div', { class: 'list-row', onclick: async () => { m.close(); await api.patch(`/api/items/${id}/files/${f.id}`, { asCover: true }); toast('已设为封面', 'ok'); } }, '🖼️ 设为封面') : null,
                h('div', { class: 'list-row', onclick: async () => {
                    m.close();
                    const label = await promptDialog('', { title: '版本备注', value: f.label });
                    if (label != null) await api.patch(`/api/items/${id}/files/${f.id}`, { label });
                } }, '✏️ 编辑备注'),
                h('div', { class: 'list-row', onclick: async () => {
                    m.close();
                    const name = await promptDialog('', { title: '重命名文件', value: f.name });
                    if (name) await api.patch(`/api/items/${id}/files/${f.id}`, { name });
                } }, '🔤 重命名'),
                h('div', { class: 'list-row', style: { color: 'var(--danger)' }, onclick: async () => {
                    m.close();
                    if (it.files.length === 1 && !(await confirmDialog('这是唯一的文件，删除后条目将没有文件。继续？', { danger: true }))) return;
                    if (it.files.length > 1 && !(await confirmDialog(`删除文件「${f.name}」？`, { danger: true }))) return;
                    await api.del(`/api/items/${id}/files/${f.id}`);
                    toast('已删除');
                } }, '🗑️ 删除此文件')),
        });
    }

    render();
}

/** 根据字段定义生成输入控件 */
export function fieldInput(f, val, set) {
    switch (f.kind) {
        case 'textarea': { const el = h('textarea', { class: 'textarea', value: val || '', oninput: () => set(el.value) }); return el; }
        case 'number': { const el = h('input', { class: 'input', type: 'number', value: val ?? '', oninput: () => set(el.value === '' ? null : Number(el.value)) }); return el; }
        case 'url': {
            const el = h('input', { class: 'input', type: 'url', value: val || '', placeholder: 'https://', oninput: () => set(el.value) });
            return h('div', { class: 'row' }, el, val ? h('a', { class: 'btn sm icon', href: val, target: '_blank', rel: 'noopener' }, '↗') : null);
        }
        case 'date': { const el = h('input', { class: 'input', type: 'date', value: val || '', onchange: () => set(el.value, true) }); return el; }
        case 'color': { const el = h('input', { class: 'input', type: 'color', value: val || '#c084fc', style: { width: '80px', padding: '2px' }, onchange: () => set(el.value, true) }); return el; }
        case 'select': {
            const el = h('select', { class: 'select', onchange: () => set(el.value, true) }, h('option', { value: '' }, '—'), (f.options || []).map((o) => h('option', { value: o, selected: val === o }, o)));
            return el;
        }
        case 'checkbox': return switchEl(Boolean(val), (v) => set(v, true));
        case 'rating': {
            const wrap = h('span', { class: 'stars' });
            const draw = (v) => clear(wrap, [1, 2, 3, 4, 5].map((n) => h('span', { class: n <= (v || 0) ? 'on' : '', onclick: () => { const nv = v === n ? 0 : n; set(nv, true); draw(nv); } }, '⭐')));
            draw(val);
            return wrap;
        }
        case 'tags': {
            const el = h('input', { class: 'input', value: Array.isArray(val) ? val.join(', ') : val || '', placeholder: '逗号分隔', onchange: () => set(el.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean), true) });
            return el;
        }
        default: { const el = h('input', { class: 'input', value: val ?? '', oninput: () => set(el.value) }); return el; }
    }
}
