// 模拟 AI 服务：OpenAI 兼容 + Claude 两种格式
import http from 'node:http';
const log = [];
// 对话：回显收到了几轮、参考了哪些条目，方便测试检查发出去的内容
function chatReply(system, turns) {
    const refs = [...system.matchAll(/<item id="\d+" type="[^"]*" name="([^"]*)">/g)].map((m) => m[1]);
    const last = turns[turns.length - 1]?.content || '';
    if (last.includes('EDITME')) return '把开场白改得更有悬念，第一条备选开场白也顺了一下，再加一条新的。\n\n```tv-edit\n{"item": 1, "changes": [{"field": "first_mes", "value": "*门被推开，带进一阵冷雨*\n她没有抬头：「你迟到了三年。」"}, {"field": "alternate_greetings", "index": 1, "value": "新的备选开场一"}, {"field": "alternate_greetings", "add": true, "value": "新增的开场"}, {"field": "book", "index": 1, "value": "月影城是一座漂浮在云上的城市，每到月圆会下沉一尺。"}, {"field": "alternate_greetings", "index": 9, "value": "不存在"},]}\n```';
    if (last.includes('BADEDIT')) return '给你改好了。\n\n```tv-edit\n{"item": 1, "changes": [ 这不是 JSON\n```';
    return `收到第 ${turns.filter((t) => t.role === 'user').length} 轮：${last.slice(0, 40)}\n参考：${refs.join('、') || '无'}\n\n**结论**：没有发现矛盾。\n- 第一点\n- 第二点`;
}
const isOrganize = (system) => system.includes('"summary":"简介"');
function reply(system, user) {
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
                    if (usr.includes('SLOWME')) return setTimeout(() => send(200, { model: j.model, choices: [{ message: { content: chatReply(sys, turns) }, finish_reason: 'stop' }], usage: {} }), 4000);
                    return send(200, { model: j.model, choices: [{ message: { content: chatReply(sys, turns) }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
                }
                return send(200, { model: j.model, choices: [{ message: { content: reply(sys, usr) }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
            }
            if (u === '/v1/messages') {
                if (JSON.stringify(j.messages).includes('FAILME')) return send(500, { error: { message: 'upstream exploded' } });
                const text = (j.system || '').includes('酒馆藏馆」里的 AI 助手') ? chatReply(j.system, j.messages) : reply(j.system || '', j.messages[0].content);
                return send(200, { model: j.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 50 } });
            }
            send(404, { error: 'nope' });
        }, 500);
    });
}).listen(5197, '127.0.0.1', () => console.log('mock ai on 5197'));
