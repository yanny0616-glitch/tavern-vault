// 替用户在 Discord 帖子里用一次社区 bot 的斜杠命令（比如 /获取作品），把 bot 回的「只有你能看到」的消息
// 原样转给网页：有哪些按钮、下拉框、文件链接。点哪个按钮、选哪个版本、存哪些文件都由用户在网页上决定，
// 这里不替用户做任何选择。用完就断开，不常驻。
import zlib from 'node:zlib';
import { clientHeaders, clientProps, CLIENT_UA } from './discord.js';

const api = () => (process.env.TV_DISCORD_API || 'https://discord.com/api/v9').replace(/\/v10$/, '/v9').replace(/\/+$/, '');
const gateway = () => process.env.TV_DISCORD_GATEWAY || 'wss://gateway.discord.gg/?v=9&encoding=json';
const EPOCH = 1420070400000n;
const nonce = () => String((BigInt(Date.now()) - EPOCH) << 22n);
const LINK = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/g;

/** 把一条消息整理成网页要显示的样子 */
export function viewOf(msg) {
    const v = { content: String(msg?.content || ''), embeds: [], components: [], files: [], loading: Boolean((msg?.flags || 0) & 128) };
    if (!msg) return v;
    const texts = [v.content];
    for (const e of msg.embeds || []) {
        const fields = (e.fields || []).map((f) => ({ name: String(f.name || ''), value: String(f.value || '') }));
        v.embeds.push({ title: String(e.title || ''), description: String(e.description || ''), fields, footer: String(e.footer?.text || ''), image: e.image?.proxy_url || e.image?.url || e.thumbnail?.proxy_url || e.thumbnail?.url || '' });
        texts.push(e.title, e.description, ...fields.flatMap((f) => [f.name, f.value]));
    }
    const walk = (list) => {
        for (const c of list || []) {
            if (c.type === 2) v.components.push({ kind: c.url ? 'link' : 'button', id: c.custom_id || '', url: c.url || '', label: String(c.label || c.emoji?.name || '按钮'), style: c.style || 2, disabled: Boolean(c.disabled) });
            else if (c.type === 3) v.components.push({ kind: 'select', id: c.custom_id || '', placeholder: String(c.placeholder || ''), disabled: Boolean(c.disabled), options: (c.options || []).map((o) => ({ label: String(o.label || o.value), value: String(o.value), description: String(o.description || '') })) });
            else if (c.type === 10 && c.content) { v.embeds.push({ title: '', description: String(c.content), fields: [], footer: '', image: '' }); texts.push(c.content); }
            if (c.components) walk(c.components);
            if (c.accessory) walk([c.accessory]);
        }
    };
    walk(msg.components);
    const seen = new Set();
    const add = (name, url, size = '') => { if (!/^https?:\/\//.test(url) || seen.has(url)) return; seen.add(url); v.files.push({ name: String(name).trim().slice(0, 200), url, size }); };
    for (const a of msg.attachments || []) add(a.filename || 'file', a.url, a.size ? `${(a.size / 1024).toFixed(1)} KB` : '');
    for (const t of texts) {
        for (const m of String(t || '').matchAll(LINK)) {
            // 只收看起来是文件的链接：名字带扩展名
            if (/\.[a-z0-9]{2,5}$/i.test(m[1].trim())) add(m[1], m[2], (String(t).slice(m.index + m[0].length, m.index + m[0].length + 30).match(/[\d.]+\s*[KMG]B/i) || [''])[0]);
        }
    }
    return v;
}

export class BotSession {
    constructor({ token, guild, channel }) {
        Object.assign(this, { token, guild, channel });
        this.rev = 0;           // 消息每变一次加一
        this.msg = null;        // bot 现在显示的那条消息
        this.appId = '';
        this.events = [];       // 收到过哪些事件，出问题时给用户看
        this.error = '';
        this.closed = false;
        this.waiters = new Set();
        this.touched = Date.now();
    }

    bump() { this.rev += 1; for (const w of this.waiters) w(); this.waiters.clear(); }

    /** 等到消息有变化（rev 比给的大），或者超时 */
    wait(rev, ms) {
        if (this.rev > rev || this.closed) return Promise.resolve();
        return new Promise((res) => { const t = setTimeout(done, ms); const w = () => done(); function done() { clearTimeout(t); res(); } this.waiters.add(w); });
    }

    async rest(method, path, body) {
        const res = await fetch(api() + path, { method, headers: { ...(await clientHeaders()), Authorization: this.token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
        if (res.status === 204) return null;
        const j = await res.json().catch(() => null);
        if (!res.ok) throw Object.assign(new Error(res.status === 401 ? '令牌失效或被 Discord 拒绝' : res.status === 429 ? '被 Discord 限流，过一阵再试' : `Discord 返回 ${res.status}${j?.message ? `：${j.message}` : ''}${j?.code ? `（${j.code}）` : ''}`), { status: res.status, code: j?.code, detail: j?.errors ? JSON.stringify(j.errors).slice(0, 600) : '' });
        return j;
    }

    /** 连上 Discord 并登录，拿到 session_id */
    async open() {
        const props = await clientProps();
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(gateway(), { headers: { 'User-Agent': CLIENT_UA, Origin: 'https://discord.com', 'Accept-Language': 'zh-CN,zh;q=0.9' } });
            this.ws = ws;
            ws.binaryType = 'arraybuffer';
            let seq = null; let beat = 0; let ready = false;
            const fail = (m) => { this.error = m; if (!ready) reject(new Error(m)); this.close(); };
            const timer = setTimeout(() => fail('连接 Discord 超时'), 25000);
            ws.onmessage = (ev) => {
                let p;
                try { p = JSON.parse(typeof ev.data === 'string' ? ev.data : zlib.inflateSync(Buffer.from(ev.data)).toString('utf8')); } catch { return; }
                if (p.s != null) seq = p.s;
                if (p.op === 10) {
                    beat = setInterval(() => { try { ws.send(JSON.stringify({ op: 1, d: seq })); } catch { /* 已断开 */ } }, p.d.heartbeat_interval);
                    this.beat = beat;
                    ws.send(JSON.stringify({ op: 2, d: { token: this.token, capabilities: 22525, properties: props, presence: { status: 'unknown', since: 0, activities: [], afk: false }, compress: false, client_state: { guild_versions: {} } } }));
                } else if (p.op === 9) fail('Discord 拒绝了这次登录（会话无效）');
                else if (p.op === 0) {
                    if (p.t === 'READY') { this.sessionId = p.d.session_id; ready = true; clearTimeout(timer); resolve(); return; }
                    if (this.events.length < 60 && !/^(PRESENCE|TYPING|GUILD_MEMBER|VOICE|READY_SUPPLEMENTAL|SESSIONS_REPLACE|PASSIVE)/.test(p.t)) this.events.push(p.t);
                    this.onEvent(p.t, p.d);
                }
            };
            ws.onclose = (ev) => {
                clearTimeout(timer);
                const why = { 4004: '令牌无效', 4013: '登录参数不被接受（4013）', 4014: '登录参数不被接受（4014）' }[ev.code] || (ev.code && ev.code !== 1000 ? `连接被 Discord 关闭（${ev.code}${ev.reason ? ` ${ev.reason}` : ''}）` : '');
                if (!ready) reject(new Error(why || '连接 Discord 失败'));
                else if (why && !this.closed) this.error = why;
                this.close();
            };
            ws.onerror = () => { /* onclose 里统一处理 */ };
        });
    }

    onEvent(t, d) {
        if (t === 'INTERACTION_FAILURE' && d?.nonce === this.nonce) { this.error = 'bot 没有响应这次操作'; this.bump(); return; }
        // 点了按钮后 bot 弹出的表单（比如「输入提取口令」）
        if (t === 'INTERACTION_MODAL_CREATE') {
            if (!d || (d.nonce ? d.nonce !== this.nonce : d.channel_id !== this.channel)) return;
            this.modal = d;
            this.bump();
            return;
        }
        if (t !== 'MESSAGE_CREATE' && t !== 'MESSAGE_UPDATE') return;
        if (!d || d.channel_id !== this.channel) return;
        if (t === 'MESSAGE_CREATE') {
            const mine = (d.nonce && d.nonce === this.nonce) || (this.started && d.author?.id === this.appId && ((d.flags || 0) & 64));
            if (!mine) return;
            this.msg = d;
        } else {
            if (!this.msg || d.id !== this.msg.id) return;
            this.msg = { ...this.msg, ...d };
        }
        this.bump();
    }

    /** 在这个帖子里找到叫这个名字的斜杠命令并使用 */
    async command(name) {
        // 「命令名@bot 名」：同一个社区里几个 bot 的命令重名时，用 @ 指明是哪个 bot 的
        const [want, bot = ''] = String(name || '').trim().replace(/^\//, '').split('@').map((x) => x.trim());
        let index;
        try { index = await this.rest('GET', `/guilds/${this.guild}/application-command-index`); } catch (e) { e.message = `读这个社区的命令列表时，${e.message}`; throw e; }
        const all = (index?.application_commands || []).filter((c) => c.type === 1);
        const appName = new Map((index?.applications || []).map((x) => [String(x.id), String(x.name || '')]));
        let hits = all.filter((c) => c.name === want);
        if (!hits.length) hits = all.filter((c) => Object.values(c.name_localizations || {}).includes(want));
        const names = [...new Set(hits.map((c) => appName.get(String(c.application_id)) || String(c.application_id)))];
        if (bot) hits = hits.filter((c) => (appName.get(String(c.application_id)) || '').toLowerCase() === bot.toLowerCase() || String(c.application_id) === bot);
        if (bot && !hits.length && names.length) throw new Error(`「/${want}」不是「${bot}」的命令。有这个命令的 bot：${names.join('、')}`);
        // 重名时不替用户猜：选错 bot 轻则没权限，重则用错命令
        if (hits.length > 1) throw new Error(`这个社区有 ${names.length} 个 bot 的命令都叫「/${want}」：${names.join('、')}。在命令后面加上 @bot 名再试，比如「${want}@${names[names.length - 1]}」`);
        const cmd = hits[0];
        if (!cmd) throw Object.assign(new Error(`这个社区里没有找到「/${want}」这个命令`), { commands: [...new Set(all.map((c) => c.name))].slice(0, 40) });
        if ((cmd.options || []).some((o) => o.required)) throw new Error(`「/${want}」需要填参数，这里用不了`);
        this.appId = cmd.application_id;
        this.nonce = nonce();
        this.started = true;
        // 社区自己的命令（不是 bot 的全局命令）要带上 guild_id
        const data = { version: String(cmd.version), id: String(cmd.id), name: cmd.name, type: 1, options: [], application_command: cmd, attachments: [] };
        if (cmd.guild_id) data.guild_id = String(cmd.guild_id);
        try {
            await this.rest('POST', '/interactions', { type: 2, application_id: String(cmd.application_id), guild_id: this.guild, channel_id: this.channel, session_id: this.sessionId, nonce: this.nonce, data });
        } catch (e) { e.message = `发送「/${cmd.name}」时，${e.message}`; throw e; }
    }

    /** 点一个按钮，或者在下拉框里选一项 */
    async act(customId, values) {
        if (!this.msg) throw new Error('bot 还没有回消息');
        this.modal = null;
        const data = Array.isArray(values) ? { component_type: 3, custom_id: customId, type: 3, values } : { component_type: 2, custom_id: customId };
        this.nonce = nonce();
        this.touched = Date.now();
        await this.rest('POST', '/interactions', {
            type: 3, application_id: this.msg.application_id || this.msg.author?.id || this.appId, guild_id: this.guild, channel_id: this.channel, session_id: this.sessionId, nonce: this.nonce,
            message_flags: this.msg.flags || 0, message_id: this.msg.id, data,
        });
    }

    /** 表单里要填的文字框 */
    modalView() {
        if (!this.modal) return null;
        const fields = []; let other = false;
        const walk = (c, label = '') => {
            if (!c) return;
            if (c.type === 4) fields.push({ id: String(c.custom_id), label: String(c.label || label || ''), placeholder: String(c.placeholder || ''), value: String(c.value || ''), required: c.required !== false, min: c.min_length || 0, max: c.max_length || 4000, long: c.style === 2 });
            else if (c.type === 1) for (const x of c.components || []) walk(x, label);
            else if (c.type === 18) walk(c.component, String(c.label || ''));
            else if (c.type !== 10) other = true;
        };
        for (const c of this.modal.components || []) walk(c);
        return { title: String(this.modal.title || ''), fields, other };
    }

    /** 提交表单。values：{ 文字框 id: 填的内容 } */
    async submit(values) {
        const m = this.modal;
        if (!m) throw new Error('表单已经不在了，重新点一下按钮');
        const fill = (c) => {
            if (c.type === 4) return { type: 4, custom_id: c.custom_id, value: String(values[c.custom_id] ?? '') };
            if (c.type === 1) return { type: 1, ...(c.id != null ? { id: c.id } : {}), components: (c.components || []).map(fill) };
            if (c.type === 18) return { type: 18, ...(c.id != null ? { id: c.id } : {}), component: fill(c.component) };
            return c;
        };
        this.nonce = nonce();
        this.touched = Date.now();
        await this.rest('POST', '/interactions', {
            type: 5, application_id: String(m.application?.id || this.appId), guild_id: this.guild, channel_id: this.channel, session_id: this.sessionId, nonce: this.nonce,
            data: { id: String(m.id), custom_id: m.custom_id, components: (m.components || []).map(fill) },
        });
        this.modal = null;
        this.bump();
    }

    /** 读帖子里楼主写的内容（只读），给用户找口令用：首楼、楼主在前几楼的发言、标注（置顶）的消息 */
    async starter() {
        const textOf = (m) => {
            const parts = [String(m?.content || '')];
            for (const e of m?.embeds || []) parts.push(String(e.title || ''), String(e.description || ''), ...(e.fields || []).map((f) => `${f.name || ''} ${f.value || ''}`));
            return parts.filter(Boolean).join('\n');
        };
        const out = []; const seen = new Set();
        const add = (where, m) => { if (!m?.id || seen.has(m.id)) return; seen.add(m.id); const t = textOf(m).trim(); if (t) out.push({ where, text: t.slice(0, 6000) }); };
        // 帖子的首楼和帖子本身是同一个 id。普通账号不能按 id 单独读一条消息，所以从「首楼前一位」往后读一页，首楼就在里面
        let early = [];
        try { early = await this.rest('GET', `/channels/${this.channel}/messages?after=${BigInt(this.channel) - 1n}&limit=20`); } catch (e) { if (e.status === 401 || e.status === 429) throw e; e.message = `读帖子内容时，${e.message}`; throw e; }
        early = (Array.isArray(early) ? early : []).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
        const first = early.find((m) => m.id === this.channel) || early[0];
        const owner = first?.author?.id;
        const hasFirst = first?.id === this.channel;
        early.forEach((m, i) => { if (m === first) add(hasFirst ? '首楼' : '最早一楼', m); else if (owner && m.author?.id === owner) add(`第 ${i + (hasFirst ? 1 : 2)} 楼`, m); });
        let pins = [];
        try { pins = await this.rest('GET', `/channels/${this.channel}/pins`); } catch (e) { if (e.status === 401 || e.status === 429) throw e; }
        for (const m of Array.isArray(pins) ? pins : pins?.items?.map((x) => x.message) || []) add('标注', m);
        return out.slice(0, 12);
    }

    view() { return { rev: this.rev, error: this.error, closed: this.closed, events: this.events, modal: this.modalView(), ...viewOf(this.msg) }; }

    close() {
        if (this.closed) return;
        this.closed = true;
        clearInterval(this.beat);
        try { this.ws?.close(1000); } catch { /* 已断开 */ }
        this.bump();
    }
}
