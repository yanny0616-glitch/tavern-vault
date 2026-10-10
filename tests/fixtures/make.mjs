// 生成测试用的数据目录（全是虚构的卡，不含任何真实藏馆内容）
//   seed: fixtures/samples 里的各类样例文件，无密码
//   sec:  seed + 密码 testpw
//   perf: 约 45 张虚构角色卡（大世界书、多开场白、正则、重复卡、回收站），密码 testpw
// 用法：node tests/fixtures/make.mjs <输出目录>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { writeCardToPng } from '../../server/lib/png.js';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SERVER = path.resolve(HERE, '../../server/server.js');
const OUT = path.resolve(process.argv[2] || path.join(HERE, '../.work/data'));
const PORT = 5189;
const B = `http://127.0.0.1:${PORT}`;

// ---- 小工具 ----
let seed = 20261010;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const range = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

function solidPng(w, h, hue) {
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) {
        raw[y * (w * 3 + 1)] = 0;
        for (let x = 0; x < w; x++) {
            const o = y * (w * 3 + 1) + 1 + x * 3; const t = (x + y) / (w + h);
            raw[o] = (hue * 7 + 80 * t) & 255; raw[o + 1] = (hue * 13 + 120 * (1 - t)) & 255; raw[o + 2] = (hue * 29 + 60) & 255;
        }
    }
    const chunk = (type, data) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const td = Buffer.concat([Buffer.from(type), data]);
        const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td));
        return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const PLACES = ['雾港', '长明城', '北境哨站', '旧书街', '临江茶楼', '钟楼', '海底车站', '雪原驿站', '南城夜市', '山间道观'];
const TRAITS = ['沉默寡言', '嘴硬心软', '温和有礼', '冷静克制', '爱开玩笑', '固执', '细心', '不擅表达', '好奇心重', '护短'];
const JOBS = ['调香师', '书店老板', '退役军医', '修钟匠', '茶楼掌柜', '画师', '驿站信使', '道观弟子', '天文台学徒', '旧物商人'];
const TAGS = ['古风', '现代', '奇幻', '悬疑', '日常', '治愈', '校园', '末世', '男性', '女性', '多人卡', '世界观'];
const para = (name) => `${name}是${pick(PLACES)}的${pick(JOBS)}，${pick(TRAITS)}，也${pick(TRAITS)}。每逢雨天，${name}会把门口的灯多点一会儿，等着迟归的人。` +
    `关于${pick(PLACES)}的旧事，${name}知道得比谁都多，却很少主动提起。`;
const paras = (name, n) => Array.from({ length: n }, () => para(name)).join('\n\n');

function card(name, o = {}) {
    const g = o.greetings ?? range(1, 30); const b = o.book ?? range(3, 45); const r = o.regex ?? range(0, 15);
    const greetings = Array.from({ length: g }, (_, i) => `*${pick(PLACES)}，第 ${i + 1} 个开场* ${paras(name, range(2, 8))}`);
    if (o.firstMes) greetings[0] = o.firstMes;
    const regex = Array.from({ length: r }, (_, i) => ({ scriptName: `美化 ${i + 1}`, findRegex: `/<p${i}>(.*?)<\\/p${i}>/g`, replaceString: `<span class="p${i}">$1</span>`, placement: [2] }));
    if (o.regexExtra) regex.unshift(...o.regexExtra);
    return {
        spec: 'chara_card_v3', spec_version: '3.0',
        data: {
            name, description: o.description ?? paras(name, range(6, 20)), personality: `${pick(TRAITS)}、${pick(TRAITS)}`,
            scenario: `故事发生在${pick(PLACES)}。`, first_mes: greetings[0], alternate_greetings: greetings.slice(1),
            mes_example: `<START>\n{{user}}: 你好\n{{char}}: *抬头* 来了啊。`, creator: o.creator ?? pick(['虚构作者甲', '虚构作者乙', '虚构作者丙']),
            character_version: o.version ?? `${range(1, 3)}.${range(0, 9)}`, tags: o.tags ?? [], creator_notes: o.notes ?? `${name}的作者说明：建议搭配长上下文模型。`,
            character_book: { name: `${name}的世界`, entries: Array.from({ length: b }, (_, i) => ({ keys: [`${pick(PLACES)}${i}`], content: paras(name, 1), comment: `条目 ${i + 1}`, constant: rnd() < 0.2, enabled: true })) },
            extensions: { regex_scripts: regex },
        },
    };
}

const FENCE_PAGE = '```html\n<!DOCTYPE html><html><head><style>body{margin:0;font-family:serif;background:#1d2230;color:#e8e4da}.box{padding:24px;min-height:320px}h2{margin:0 0 12px}button{margin-top:16px}</style></head>' +
    '<body><div class="box"><h2>第七号档案</h2><p>雨下了一整夜，档案室的灯还亮着。</p><p id="page">第 1 页</p><button onclick="document.getElementById(\'page\').textContent=\'第 2 页\'">下一页</button></div>' +
    '<script>document.querySelector("h2").dataset.ready = "1";</script></body></html>\n```';
const STATUS_BAR = '```html\n<div style="min-height:180px;padding:16px;border-radius:12px;background:#2b2f3a;color:#f2efe6;font-family:sans-serif"><b>状态</b><div style="margin-top:8px">$1</div><div style="margin-top:8px">时间：深夜</div></div>\n```';

function perfCards() {
    const list = [];
    const add = (name, o, q = {}) => list.push({ name, card: card(name, o), ...q });
    const status = { creator: '虚构作者甲', firstMes: '*推开门* 你来了。\n<status>心情:平静|天气:小雨</status>', regexExtra: [{ scriptName: '状态栏', findRegex: '/<status>(.*?)<\\/status>/g', replaceString: STATUS_BAR, placement: [2] }] };
    // 重复组：许知年 ×2 + 许知年1 ×2（名字去掉数字后相同），宋清和 ×2，秦既白 / 秦既白·并蒂霜
    const xz = card('许知年', { ...status, greetings: 8, book: 14, regex: 1 });
    list.push({ name: '许知年', card: xz }, { name: '许知年', card: { ...xz, data: { ...xz.data, character_version: '1.1' } }, q: '&match=new' });
    const xz1 = card('许知年1', { ...status, greetings: 7, book: 14, regex: 1 });
    list.push({ name: '许知年1', card: xz1 }, { name: '许知年1', card: { ...xz1, data: { ...xz1.data, character_version: '1.1' } }, q: '&match=new' });
    add('宋清和', { creator: '虚构作者乙', greetings: 14, book: 19, regex: 4 });
    add('宋清和', { creator: '虚构作者乙', greetings: 13, book: 15, regex: 4 }, { q: '&match=new' });
    add('秦既白', { creator: '虚构作者丙', greetings: 10, book: 13, regex: 1 });
    add('秦既白·并蒂霜', { creator: '虚构作者丙', greetings: 12, book: 14, regex: 1 });
    // 程砚：开场白是带脚本的 ```html 网页；有一条正则叫「刑侦卷宗」（只在这一张卡里）
    add('程砚', { firstMes: `*灯还亮着*\n${FENCE_PAGE}`, greetings: 11, book: 25, regex: 4, tags: ['悬疑'],
        regexExtra: [{ scriptName: '刑侦卷宗样式', findRegex: '/<case>(.*?)<\\/case>/g', replaceString: '<div class="case">$1</div>', placement: [2] }] });
    add('Rowan', { greetings: 9, book: 8, regex: 2, description: paras('Rowan', 14) });
    // 很长的作者说明（折叠测试用）
    add('长夜书简', { notes: paras('长夜书简', 30), greetings: 3, book: 5, regex: 0 });
    add('世界后台引擎', { greetings: 1, book: 0, regex: 4 });
    const more = ['顾行舟', '白露', '闻笙', '林砚秋', '谢迟', '温既明', '沈听澜', '陆照', '姜晚', '韩惊鹊', '苏木', '叶知秋', '周默', '唐岁', '江枫眠',
        '许鹤', '程野', '岑夏', '方寸', '裴昭', '霍听雪', '晏归', '纪南', '池鱼', '贺朝', '鹿鸣', '宁远', '邵棠', '夏蝉', '卫青崖'];
    for (const n of more) add(n, { tags: rnd() < 0.3 ? [pick(TAGS), pick(TAGS)] : [] });
    return list;
}

// ---- 用真实的服务端导入，保证数据结构和线上一致 ----
async function withServer(dir, fn) {
    fs.mkdirSync(dir, { recursive: true });
    const p = spawn(process.execPath, [SERVER], { env: { ...process.env, TV_HOST: '127.0.0.1', TV_PORT: String(PORT), TV_DATA: dir }, stdio: 'ignore' });
    try {
        for (let i = 0; ; i++) {
            try { if ((await fetch(B + '/api/health')).ok) break; } catch { /* 还没起来 */ }
            if (i > 100) throw new Error('测试数据生成：服务没起来');
            await new Promise((r) => setTimeout(r, 100));
        }
        await fn();
    } finally {
        p.kill(); await new Promise((r) => p.once('exit', r));
    }
}
let token = '';
const api = async (method, url, body, raw) => {
    const r = await fetch(B + url, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(raw ? {} : { 'Content-Type': 'application/json' }) }, body: raw ? body : body ? JSON.stringify(body) : undefined });
    const j = await r.json(); if (!r.ok) throw new Error(`${method} ${url}: ${j.error || r.status}`); return j;
};
const upload = (name, buf, q = '') => api('POST', `/api/items?filename=${encodeURIComponent(name)}${q}`, buf, true);

fs.rmSync(OUT, { recursive: true, force: true });
const SAMPLES = path.join(HERE, 'samples');

await withServer(path.join(OUT, 'seed'), async () => {
    token = '';
    for (const f of fs.readdirSync(SAMPLES).sort()) await upload(f, fs.readFileSync(path.join(SAMPLES, f)));
});
fs.cpSync(path.join(OUT, 'seed'), path.join(OUT, 'sec'), { recursive: true });
await withServer(path.join(OUT, 'sec'), async () => { token = ''; await api('POST', '/api/password', { password: 'testpw' }); });

await withServer(path.join(OUT, 'perf'), async () => {
    token = ''; token = (await api('POST', '/api/password', { password: 'testpw' })).token;
    let hue = 0;
    for (const c of perfCards()) {
        const png = await writeCardToPng(solidPng(240, 360, hue++), c.card);
        await upload(`${c.name}.png`, png, c.q || '');
    }
    // 回收站里放一张
    const r = await upload('雨夜来客.json', Buffer.from(JSON.stringify(card('雨夜来客', { tags: ['古风'] }))));
    const id = r.item?.id || r.results?.[0]?.item?.id || r.id;
    await api('DELETE', `/api/items/${id}`);
});
for (const d of ['seed', 'sec', 'perf']) fs.rmSync(path.join(OUT, d, 'backups'), { recursive: true, force: true });
const n = (d) => Object.keys(JSON.parse(fs.readFileSync(path.join(OUT, d, 'db.json'))).items).length;
console.log(`测试数据已生成：seed ${n('seed')} 项，sec ${n('sec')} 项，perf ${n('perf')} 项 → ${OUT}`);
