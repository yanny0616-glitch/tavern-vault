// Discord 来源追踪：用用户自己填的 Discord 令牌，定期读一下来源帖子的标题，标题变了就提醒。
// 只读：只调用「读这个频道 / 帖子的信息」一个接口，不发消息、不点任何东西。
// 令牌存在 discord.json（权限 600），不进 db.json、不进备份、不下发给网页。
import fs from 'node:fs';
import path from 'node:path';

const api = () => (process.env.TV_DISCORD_API || 'https://discord.com/api/v9').replace(/\/+$/, '');
export const EVERY = [6, 24, 72, 168]; // 多少小时查一次

// 和网页版 Discord 发出的请求保持一样的客户端标识。不带这些的请求一眼就能看出不是正常客户端。
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const real = () => !process.env.TV_DISCORD_API;
let build = { n: 673869, at: 0 };
/** 网页版当前的版本号：从登录页读（不带令牌），12 小时读一次；读不到就用上次的 */
async function buildNumber() {
    if (!real() || Date.now() - build.at < 12 * 3600e3) return build.n;
    build.at = Date.now();
    try {
        const res = await fetch('https://discord.com/login', { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' }, signal: AbortSignal.timeout(10000) });
        const m = /"BUILD_NUMBER":"(\d{5,8})"/.exec(await res.text());
        if (m) build.n = Number(m[1]);
    } catch { /* 用旧的 */ }
    return build.n;
}
/** 登录网关时报的客户端信息 */
export async function clientProps() {
    return {
        os: 'Windows', browser: 'Chrome', device: '', system_locale: 'zh-CN', has_client_mods: false,
        browser_user_agent: UA, browser_version: '141.0.0.0', os_version: '10',
        referrer: '', referring_domain: '', referrer_current: '', referring_domain_current: '',
        release_channel: 'stable', client_build_number: await buildNumber(), client_event_source: null,
    };
}
/** 每个请求都带的头 */
export async function clientHeaders() {
    return {
        'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'zh-CN,zh;q=0.9',
        Origin: 'https://discord.com', Referer: 'https://discord.com/channels/@me',
        'X-Discord-Locale': 'zh-CN', 'X-Discord-Timezone': 'Asia/Shanghai', 'X-Debug-Options': 'bugReporterEnabled',
        'X-Super-Properties': Buffer.from(JSON.stringify(await clientProps())).toString('base64'),
    };
}
export const CLIENT_UA = UA;

/** 来源链接是不是 Discord 的帖子 / 消息链接；是的话取出服务器、频道（帖子）、消息的 id */
export function parseSource(url) {
    const m = /^https?:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d{5,25})\/(\d{5,25})(?:\/(\d{5,25}))?/.exec(String(url || '').trim());
    return m ? { guild: m[1], channel: m[2], message: m[3] || '' } : null;
}

export class DiscordTrack {
    constructor(dir) {
        this.path = path.join(dir, 'discord.json');
        this.data = { enabled: false, token: '', every: 24, paused: null, lastRun: 0 };
        try { this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.path, 'utf8')) }; } catch { /* 首次使用 */ }
    }

    save() {
        const tmp = `${this.path}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
        fs.renameSync(tmp, this.path);
    }

    /** 给网页看的：有没有令牌，但不给令牌本身 */
    public() {
        const { enabled, every, lastRun } = this.data;
        return { enabled, every, lastRun, hasToken: Boolean(this.data.token), paused: this.paused };
    }

    /** 当前是不是停着：令牌失效一直停到重新填；被限流停到指定时间 */
    get paused() {
        const p = this.data.paused;
        if (!p) return null;
        if (p.until && p.until <= Date.now()) return null;
        return p;
    }

    get ready() { return Boolean(this.data.enabled && this.data.token && !this.paused); }

    update(body = {}) {
        const d = this.data;
        if ('enabled' in body) d.enabled = body.enabled === true;
        if ('every' in body && EVERY.includes(Number(body.every))) d.every = Number(body.every);
        if ('token' in body) {
            const t = String(body.token ?? '').trim().replace(/^["']|["']$/g, '');
            if (t && (t.length > 200 || /\s/.test(t))) throw Object.assign(new Error('令牌格式不对'), { status: 400 });
            d.token = t;
            d.paused = null;
            if (!t) d.enabled = false;
        }
        if (body.resume === true) d.paused = null;
        this.save();
    }

    pause(reason, until = 0) {
        this.data.paused = { reason, at: Date.now(), until };
        this.save();
    }

    /**
     * 读帖子现在的标题。出错时抛出 Error：
     * e.global 为真表示整个追踪都该停（令牌失效、被限流），否则只是这一个帖子的问题
     */
    async title(channelId) {
        let res;
        try {
            res = await fetch(`${api()}/channels/${channelId}`, { headers: { ...(await clientHeaders()), Authorization: this.data.token }, signal: AbortSignal.timeout(15000) });
        } catch (e) {
            throw new Error(e.name === 'TimeoutError' ? '连接 Discord 超时' : '连不上 Discord');
        }
        if (res.status === 401) {
            this.pause('令牌失效或被 Discord 拒绝，已停止检查。重新填令牌后才会继续。');
            throw Object.assign(new Error('令牌失效或被 Discord 拒绝'), { global: true });
        }
        if (res.status === 429) {
            const j = await res.json().catch(() => ({}));
            const wait = Math.max(3600, Number(j.retry_after) || 0);
            this.pause('请求太频繁，被 Discord 限流了，过一阵自动恢复。', Date.now() + wait * 1000);
            throw Object.assign(new Error('被 Discord 限流'), { global: true });
        }
        if (res.status === 403) throw new Error('这个账号看不到这个帖子');
        if (res.status === 404) throw new Error('帖子不存在或已被删除');
        if (!res.ok) throw new Error(`Discord 返回 ${res.status}`);
        const j = await res.json().catch(() => null);
        const name = String(j?.name || '').trim();
        if (!name) throw new Error('没读到帖子标题');
        return name.slice(0, 300);
    }
}
