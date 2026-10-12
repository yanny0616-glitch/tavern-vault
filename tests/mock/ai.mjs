// 模拟 AI 服务：OpenAI 兼容 + Claude 两种格式
import http from 'node:http';
const log = [];
// 对话：回显收到了几轮、参考了哪些条目，方便测试检查发出去的内容
function chatReply(system, turns) {
    const refs = [...system.matchAll(/<item id="\d+" type="[^"]*" name="([^"]*)">/g)].map((m) => m[1]);
    const last = turns[turns.length - 1]?.content || '';
    if (last.includes('EDITME')) return '把开场白改得更有悬念，第一条备选开场白也顺了一下，再加一条新的。\n\n```tv-edit\n{"item": 1, "changes": [{"field": "first_mes", "value": "*门被推开，带进一阵冷雨*\n她没有抬头：「你迟到了三年。」"}, {"field": "alternate_greetings", "index": 1, "value": "新的备选开场一"}, {"field": "alternate_greetings", "add": true, "value": "新增的开场"}, {"field": "book", "index": 1, "value": "月影城是一座漂浮在云上的城市，每到月圆会下沉一尺。"}, {"field": "alternate_greetings", "index": 9, "value": "不存在"},]}\n```';
    if (last.includes('EDITWB')) return '学院概况补了地点，院长改了标题，加了一条图书馆。\n\n```tv-edit\n{"item": 1, "changes": [{"field": "entry", "index": 1, "value": "艾尔德魔法学院建于千年前，\n坐落在浮空岛上。", "keys": ["学院", "艾尔德"]}, {"field": "entry", "index": 2, "title": "古龙院长"}, {"field": "entry", "add": true, "title": "图书馆", "keys": ["图书馆", "禁书区"], "value": "图书馆的禁书区只在午夜开放。"}, {"field": "entry", "index": 7, "value": "x"}]}\n```';
    if (last.includes('EDITPRESET')) return '文风那段写具体了。\n\n```tv-edit\n{"item": 1, "changes": [{"field": "prompt", "index": 2, "value": "文风：克制、细腻，\n多写动作少写心理。"}, {"field": "first_mes", "value": "x"}]}\n```';
    if (last.includes('BADEDIT')) return '给你改好了。\n\n```tv-edit\n{"item": 1, "changes": [ 这不是 JSON\n```';
    return `收到第 ${turns.filter((t) => t.role === 'user').length} 轮：${last.slice(0, 40)}\n参考：${refs.join('、') || '无'}\n\n**结论**：没有发现矛盾。\n- 第一点\n- 第二点`;
}
const isOrganize = (system) => system.includes('"summary":"简介"');
function reply(system, user) {
    // 标签合并建议：现代+都市（正常）、重复出现的标签（应被去掉）、不存在的标签（应被去掉）、合并成新名字
    if (system.includes('整理收藏库的标签')) {
        log.push({ tagMerge: user });
        return JSON.stringify({ groups: [
            { to: '现代', from: ['都市', '不存在的标签'], reason: '都是现代都市背景' },
            { to: '奇幻', from: ['现代'], reason: '重复使用了「现代」' },
            { to: '温婉', from: ['温柔'], reason: '同一个意思' },
            { to: '校园', from: [], reason: '空的' },
        ] });
    }
    if (isOrganize(system) && system.includes('"items":[')) {
        const items = [...user.matchAll(/<item id="(\d+)"[^>]*>\n([\s\S]*?)\n<\/item>/g)];
        log.push({ batch: items.length });
        return JSON.stringify({ items: items.filter((m) => !m[2].includes('DROPME')).reverse().map((m) => ({ id: m[1], tags: ['合并', '奇幻'], summary: `第${m[1]}项：${(m[2].match(/名称：(.+)/) || [])[1] || '?'}` })) });
    }
    if (isOrganize(system)) {
        const name = (user.match(/名称：(.+)/) || [])[1] || '?';
        const lib = ((user.match(/现有标签（按使用次数排序）：(.+)/) || [])[1] || '').split('、').filter(Boolean);
        const tags = [...lib.slice(0, 2), name.includes('星澜') ? '雨夜' : '原创', '奇幻'];
        const wantFields = /nsfw（/.test(user);
        return '```json\n' + JSON.stringify({ tags, summary: `${name}：一段关于雨夜酒馆的温柔故事，附带完整世界观设定。`, fields: wantFields ? { nsfw: false, language: '中文', bogus: 1 } : {} }).replace(/}$/, ',}') + '\n```';
    }
    if (system.includes('版本之间的差异')) {
        return JSON.stringify({ summary: '新版本重写了描述并增加了一条备选开场白，人设更偏雨夜氛围。', points: ['描述改写：加入雨夜和旧伞的细节', '开场白改为收伞进门的场景', '标签新增「雨夜」'], cautions: ['内嵌世界书被删掉了，相关设定不会再触发'] });
    }
    return '成功';
}
http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
        const u = req.url.split('?')[0];
        const send = (st, o) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
        // 流式返回：每次几个字。SLOWME 慢慢吐（用来测停止），CUTME 吐一半断开连接
        const stream = (text, { anthropic = false, model = 'mock', gap = 40, cut = false } = {}) => {
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            const ev = (type, o) => res.write(anthropic ? `event: ${type}\ndata: ${JSON.stringify({ type, ...o })}\n\n` : `data: ${JSON.stringify(o)}\n\n`);
            if (anthropic) ev('message_start', { message: { model, usage: { input_tokens: 100 } } });
            const parts = text.match(/[\s\S]{1,6}/g) || [];
            let i = 0;
            const tick = () => {
                if (cut && i >= parts.length / 2) { res.destroy(); return; }
                if (i >= parts.length) {
                    if (anthropic) { ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 50 } }); ev('message_stop', {}); }
                    else { ev('', { model, choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50 } }); res.write('data: [DONE]\n\n'); }
                    res.end();
                    return;
                }
                const t = parts[i++];
                if (anthropic) ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: t } });
                else ev('', { model, choices: [{ delta: { content: t }, finish_reason: null }] });
                setTimeout(tick, gap);
            };
            tick();
        };
        if (u === '/__last') return send(200, log.slice(-5));
        const anth = u.startsWith('/v1/messages') || (u === '/v1/models' && req.headers['x-api-key']);
        const key = anth ? req.headers['x-api-key'] : (req.headers.authorization || '').replace('Bearer ', '');
        if (key !== 'sk-test-1234') return send(401, { error: { message: `invalid key ${key}` } });
        // 模拟中转站：几十个模型，带厂商前缀，测试搜索和分组
        if (u === '/v1/models') return send(200, { data: ['mock-small', 'mock-large', ...['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o3-mini'].map((m) => `openai/${m}`), ...['claude-sonnet-4', 'claude-opus-4', 'claude-haiku-4'].map((m) => `anthropic/${m}`), 'deepseek-chat', 'deepseek-reasoner', 'qwen-max', 'qwen-plus', 'qwen-turbo', 'gemini-2.5-pro', 'gemini-2.5-flash', 'glm-4-plus', 'moonshot-v1-128k'].map((id) => ({ id })) });
        const j = JSON.parse(body || '{}');
        log.push({ path: u, body: j });
        setTimeout(() => {
            if (u === '/v1/chat/completions') {
                const sys = j.messages.find((m) => m.role === 'system')?.content || '';
                const usr = [...j.messages].reverse().find((m) => m.role === 'user')?.content || '';
                if (usr.includes('FAILME')) return send(500, { error: { message: 'upstream exploded' } });
                if (usr.includes('TRUNCME')) return send(200, { model: j.model, choices: [{ message: { content: '{"tags":["奇幻"],"summary":"写到一半' }, finish_reason: 'length' }], usage: {} });
                if (usr.includes('QUOTEME')) return send(200, { model: j.model, choices: [{ message: { content: '{"tags":["奇幻",],"summary":"他读完了“雨夜”这本书",}' }, finish_reason: 'stop' }], usage: {} });
                const turns = j.messages.filter((m) => m.role !== 'system');
                if (sys.includes('酒馆藏馆」里的 AI 助手')) {
                    if (j.stream && !usr.includes('NOSTREAM')) return stream(usr.includes('SLOWME') ? `慢慢说：${'这是很长的一段回复。'.repeat(40)}` : chatReply(sys, turns), { model: j.model, gap: usr.includes('SLOWME') ? 150 : 30, cut: usr.includes('CUTME') });
                    if (usr.includes('SLOWME')) return setTimeout(() => send(200, { model: j.model, choices: [{ message: { content: chatReply(sys, turns) }, finish_reason: 'stop' }], usage: {} }), 4000);
                    return send(200, { model: j.model, choices: [{ message: { content: chatReply(sys, turns) }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
                }
                return send(200, { model: j.model, choices: [{ message: { content: reply(sys, usr) }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
            }
            if (u === '/v1/messages') {
                if (JSON.stringify(j.messages).includes('FAILME')) return send(500, { error: { message: 'upstream exploded' } });
                const text = (j.system || '').includes('酒馆藏馆」里的 AI 助手') ? chatReply(j.system, j.messages) : reply(j.system || '', j.messages[0].content);
                if (j.stream) return stream(text, { anthropic: true, model: j.model });
                return send(200, { model: j.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 50 } });
            }
            send(404, { error: 'nope' });
        }, 500);
    });
}).listen(5197, '127.0.0.1', () => console.log('mock ai on 5197'));
