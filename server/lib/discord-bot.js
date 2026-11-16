// 替用户在 Discord 帖子里用一次社区 bot 的斜杠命令（比如 /获取作品），把 bot 回的「只有你能看到」的消息
// 原样转给网页：有哪些按钮、下拉框、文件链接。点哪个按钮、选哪个版本、存哪些文件都由用户在网页上决定，
// 这里不替用户做任何选择。用完就断开，不常驻。
import zlib from 'node:zlib';

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
        const res = await fetch(api() + path, { method, headers: { Authorization: this.token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
        if (res.status === 204) return null;
        const j = await res.json().catch(() => null);
        if (!res.ok) throw Object.assign(new Error(res.status === 401 ? '令牌失效或被 Discord 拒绝' : res.status === 429 ? '被 Discord 限流，过一阵再试' : `Discord 返回 ${res.status}${j?.message ? `：${j.message}` : ''}`), { status: res.status });
        return j;
    }

    /** 连上 Discord 并登录，拿到 session_id */
    open() {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(gateway());
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
                    ws.send(JSON.stringify({ op: 2, d: { token: this.token, properties: { os: 'Windows', browser: 'Chrome', device: '' }, presence: { status: 'unknown', since: 0, activities: [], afk: false }, compress: false } }));
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
        const want = String(name || '').trim().replace(/^\//, '');
        let index;
        try { index = await this.rest('GET', `/guilds/${this.guild}/application-command-index`); } catch (e) { if (e.status === 401 || e.status === 429) throw e; index = await this.rest('GET', `/channels/${this.channel}/application-command-index`); }
        const all = (index?.application_commands || []).filter((c) => c.type === 1);
        const cmd = all.find((c) => c.name === want) || all.find((c) => Object.values(c.name_localizations || {}).includes(want));
        if (!cmd) throw Object.assign(new Error(`这个社区里没有找到「/${want}」这个命令`), { commands: [...new Set(all.map((c) => c.name))].slice(0, 40) });
        if ((cmd.options || []).some((o) => o.required)) throw new Error(`「/${want}」需要填参数，这里用不了`);
        this.appId = cmd.application_id;
        this.nonce = nonce();
        this.started = true;
        await this.rest('POST', '/interactions', {
            type: 2, application_id: cmd.application_id, guild_id: this.guild, channel_id: this.channel, session_id: this.sessionId, nonce: this.nonce,
            data: { version: String(cmd.version), id: String(cmd.id), name: cmd.name, type: 1, options: [], application_command: cmd, attachments: [] },
        });
    }

    /** 点一个按钮，或者在下拉框里选一项 */
    async act(customId, values) {
        if (!this.msg) throw new Error('bot 还没有回消息');
        const data = Array.isArray(values) ? { component_type: 3, custom_id: customId, type: 3, values } : { component_type: 2, custom_id: customId };
        this.nonce = nonce();
        this.touched = Date.now();
        await this.rest('POST', '/interactions', {
            type: 3, application_id: this.msg.application_id || this.msg.author?.id || this.appId, guild_id: this.guild, channel_id: this.channel, session_id: this.sessionId, nonce: this.nonce,
            message_flags: this.msg.flags || 0, message_id: this.msg.id, data,
        });
    }

    view() { return { rev: this.rev, error: this.error, closed: this.closed, events: this.events, ...viewOf(this.msg) }; }

    close() {
        if (this.closed) return;
        this.closed = true;
        clearInterval(this.beat);
        try { this.ws?.close(1000); } catch { /* 已断开 */ }
        this.bump();
    }
}
