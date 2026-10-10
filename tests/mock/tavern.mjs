// 模拟 SillyTavern 宿主（有状态），用于测试插件桥：收藏、比对、覆盖导入
import http from 'node:http';
import fs from 'node:fs';
import { writeCardToPng, extractCardFromPng } from '../../server/lib/png.js';
const EXT = new URL('../../extension', import.meta.url).pathname;
const base = fs.readFileSync(new URL('../fixtures/samples/base.png', import.meta.url));
const received = [];
// 角色卡：avatar → 卡片对象
const chars = new Map([['lily.png', { spec: 'chara_card_v2', data: { name: '酒馆里的莉莉', description: '来自酒馆的角色', first_mes: '你好', creator: 'ST用户', tags: ['酒馆'] } }]]);
const worlds = new Map([['酒馆世界书', { entries: { 0: { uid: 0, key: ['酒馆'], content: '酒馆在城东', comment: '酒馆' } } }]]);
const settings = {
    openai_setting_names: ['我的预设'], openai_settings: [JSON.stringify({ temperature: 0.8, openai_max_context: 100000, prompts: [{ identifier: 'main', name: 'Main', content: 'hi' }] })],
    instruct: [{ name: 'ChatML', input_sequence: '<|im_start|>user', output_sequence: '<|im_start|>assistant' }], context: [], sysprompt: [],
    themes: [{ name: '酒馆暗色', main_text_color: '#fff', blur_strength: 5 }], quickReplyPresets: [{ name: 'QR套装', qrList: [{ label: 'a', message: 'b' }] }],
};
const charObj = (avatar) => { const c = chars.get(avatar); return { avatar, name: c.data.name, ...c.data, data: c.data, json_data: JSON.stringify(c) }; };
function multipart(req, body) {
    const b = (req.headers['content-type'] || '').match(/boundary=(.+)$/)?.[1];
    const out = {};
    if (!b) return out;
    const sep = Buffer.from(`--${b}`);
    let pos = body.indexOf(sep);
    while (pos >= 0) {
        const next = body.indexOf(sep, pos + sep.length);
        if (next < 0) break;
        const part = body.subarray(pos + sep.length + 2, next - 2);
        const hEnd = part.indexOf('\r\n\r\n');
        const head = part.subarray(0, hEnd).toString();
        const name = head.match(/name="([^"]+)"/)?.[1];
        const filename = head.match(/filename="([^"]*)"/)?.[1];
        const data = part.subarray(hEnd + 4);
        out[name] = filename != null ? { filename, data } : data.toString();
        pos = next;
    }
    return out;
}
const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/ext/style.css"></head><body>
<div id="extensionsMenu"></div><div id="extensions_settings2"></div>
<script>
window.jQuery = (fn) => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn) : fn());
window.toastr = { info: console.log, warning: console.log, error: console.log, success: console.log };
const es = { regex: [{ id: 'r1', scriptName: '酒馆正则', findRegex: '/a/g', replaceString: 'b' }] };
window.__saved = 0;
let chars = [];
async function loadChars() { chars = (await (await fetch('/__chars')).json()).map((c) => ({ avatar: c.avatar, name: c.name, shallow: true, data: { creator: c.creator, tags: c.tags } })); }
loadChars();
window.SillyTavern = { getContext: () => ({
  characters: chars,
  extensionSettings: es, saveSettingsDebounced: () => { window.__saved++; },
  getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'x' }),
  getCharacters: async () => { window.__refreshed = true; await loadChars(); },
  eventSource: { on() {} }, event_types: {},
}) };
</script>
<script type="module" src="/ext/index.js"></script></body></html>`;
http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://x');
    const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    const jbody = () => { try { return JSON.parse(body.toString() || '{}'); } catch { return {}; } };
    if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(page); }
    if (url.pathname.startsWith('/ext/')) { const f = `${EXT}/${url.pathname.slice(5)}`; res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/css' }); return res.end(fs.readFileSync(f)); }
    if (url.pathname === '/thumbnail') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(base); }
    if (url.pathname === '/__chars') return json([...chars.keys()].map((a) => ({ avatar: a, name: chars.get(a).data.name, creator: chars.get(a).data.creator, tags: chars.get(a).data.tags })));
    if (url.pathname === '/__state') return json({ chars: Object.fromEntries(chars), worlds: Object.fromEntries(worlds), received });
    if (url.pathname === '/__setworld') { const { name, entry, patch } = jbody(); Object.assign(worlds.get(name).entries[entry], patch); return json({ ok: true }); }
    if (url.pathname === '/__set') { const { avatar, data } = jbody(); Object.assign(chars.get(avatar).data, data); return json({ ok: true }); }
    if (url.pathname === '/__edit') { const { avatar, description } = JSON.parse(url.searchParams.get('q')); chars.get(avatar).data.description = description; return json({ ok: true }); }
    if (url.pathname === '/api/settings/get') return json({ ...settings, world_names: [...worlds.keys()] });
    if (url.pathname === '/api/worldinfo/get') return json(worlds.get(jbody().name) || { entries: {} });
    if (url.pathname === '/api/characters/get') return json(charObj(jbody().avatar_url));
    if (url.pathname === '/api/characters/export') { const c = chars.get(jbody().avatar_url); res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(await writeCardToPng(base, c)); }
    if (url.pathname === '/api/backgrounds/all') return json(['bg1.png']);
    if (url.pathname === '/backgrounds/bg1.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(base); }
    if (url.pathname === '/__received') return json(received);
    if (url.pathname.startsWith('/api/')) {
        const isMp = (req.headers['content-type'] || '').includes('multipart');
        const mp = isMp ? multipart(req, body) : {};
        received.push({ path: url.pathname, ct: req.headers['content-type'], size: body.length, csrf: req.headers['x-csrf-token'], json: (req.headers['content-type'] || '').includes('json') ? jbody() : undefined, fields: isMp ? Object.fromEntries(Object.entries(mp).map(([k, v]) => [k, typeof v === 'string' ? v : `<file ${v.filename} ${v.data.length}B>`])) : undefined });
        if (url.pathname === '/api/characters/import' && mp.avatar) {
            const card = extractCardFromPng(mp.avatar.data);
            let avatar = mp.preserved_name;
            if (!avatar) { const stem = (card?.data?.name || 'char').replace(/\s/g, '_'); avatar = `${stem}.png`; let i = 1; while (chars.has(avatar)) avatar = `${stem}${i++}.png`; }
            chars.set(avatar, card);
            return json({ file_name: avatar.replace(/\.png$/, '') });
        }
        if (url.pathname === '/api/worldinfo/import' && mp.avatar) {
            worlds.set(mp.avatar.filename.replace(/\.json$/, ''), JSON.parse(mp.avatar.data.toString()));
            return json({ name: mp.avatar.filename });
        }
        return json({ ok: true, file_name: 'x' });
    }
    res.writeHead(404); res.end();
}).listen(5198, '127.0.0.1', () => console.log('mock st on 5198'));
