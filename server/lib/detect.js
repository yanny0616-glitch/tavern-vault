// 资源类型识别与元数据解析
import path from 'node:path';
import { isPng, readPngInfo, extractCardFromPng } from './png.js';
import { readZip } from './zip.js';
import { entriesOf, entryKeys, effectivePrompts, presetRegex, cardTokens } from '../../web/js/cardfmt.js';

export const TYPES = {
    character: '角色卡',
    worldbook: '世界书',
    preset: '预设',
    regex: '正则',
    script: '脚本',
    quickreply: '快速回复',
    theme: '主题',
    extension: '扩展',
    background: '背景/图片',
    chat: '聊天记录',
    prompt: '提示词',
    other: '其他',
};

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp']);

export function mimeOf(filename) {
    const ext = path.extname(filename || '').toLowerCase();
    return ({
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
        '.gif': 'image/gif', '.avif': 'image/avif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
        '.json': 'application/json', '.jsonl': 'application/jsonl', '.txt': 'text/plain; charset=utf-8',
        '.md': 'text/markdown; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
        '.html': 'text/html; charset=utf-8', '.zip': 'application/zip', '.yaml': 'text/yaml; charset=utf-8',
        '.yml': 'text/yaml; charset=utf-8', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.charx': 'application/zip',
    })[ext] || 'application/octet-stream';
}

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const arr = (v) => (Array.isArray(v) ? v : []);

/** 规范化 V1/V2/V3 角色卡，输出 data 层 */
export function normalizeCard(card) {
    if (!card || typeof card !== 'object') return null;
    const data = card.data && typeof card.data === 'object' ? card.data : card;
    return { spec: card.spec || (card.data ? 'chara_card_v2' : 'chara_card_v1'), spec_version: card.spec_version || '', data };
}

export function summarizeCard(card) {
    const n = normalizeCard(card);
    if (!n) return null;
    const d = n.data;
    const book = d.character_book && typeof d.character_book === 'object' ? d.character_book : null;
    const ext = d.extensions && typeof d.extensions === 'object' ? d.extensions : {};
    const regex = arr(ext.regex_scripts);
    const helperScripts = arr(ext.TavernHelper_scripts?.scripts || ext.TavernHelper_scripts || ext.tavern_helper?.scripts || ext.tavern_helper);
    const textLen = ['description', 'personality', 'scenario', 'first_mes', 'mes_example', 'system_prompt', 'post_history_instructions']
        .reduce((s, k) => s + str(d[k]).length, 0);
    return {
        spec: n.spec,
        specVersion: str(n.spec_version),
        name: str(d.name),
        nickname: str(d.nickname),
        creator: str(d.creator),
        characterVersion: str(d.character_version),
        tags: arr(d.tags).map(str).filter(Boolean),
        descriptionPreview: str(d.description).slice(0, 300),
        creatorNotesPreview: str(d.creator_notes).slice(0, 500),
        firstMesPreview: str(d.first_mes).slice(0, 300),
        greetings: 1 + arr(d.alternate_greetings).length,
        groupGreetings: arr(d.group_only_greetings).length,
        hasScenario: Boolean(str(d.scenario).trim()),
        hasExamples: Boolean(str(d.mes_example).trim()),
        hasSystemPrompt: Boolean(str(d.system_prompt).trim()),
        hasDepthPrompt: Boolean(str(ext.depth_prompt?.prompt).trim()),
        bookName: book ? str(book.name) : '',
        bookEntries: entriesOf(book).length,
        world: str(ext.world),
        regexCount: regex.length,
        scriptCount: helperScripts.length,
        talkativeness: ext.talkativeness ?? null,
        fav: Boolean(ext.fav),
        estTokens: cardTokens(d)?.total || 0,
        tokens: cardTokens(d),
        textLength: textLen,
    };
}

function cardSearchText(card) {
    const d = normalizeCard(card)?.data || {};
    return [d.name, d.creator, d.description, d.personality, d.scenario, d.creator_notes, arr(d.tags).join(' ')]
        .map(str).join('\n').slice(0, 4000);
}

function detectJson(obj, filename) {
    const base = path.basename(filename, path.extname(filename));
    if (Array.isArray(obj)) {
        if (obj.length && obj.every((x) => x && typeof x === 'object' && 'findRegex' in x)) {
            return { type: 'regex', subtype: 'bundle', name: base, meta: { count: obj.length, scripts: obj.map((x) => str(x.scriptName)).slice(0, 50) } };
        }
        return { type: 'other', subtype: 'json-array', name: base, meta: { count: obj.length } };
    }
    if (!obj || typeof obj !== 'object') return { type: 'other', name: base, meta: {} };

    // 角色卡
    if (/^chara_card_v[23]$/.test(obj.spec || '') || (obj.data && (obj.data.first_mes !== undefined || obj.data.description !== undefined) && obj.data.name)
        || (obj.name && obj.first_mes !== undefined && (obj.description !== undefined || obj.personality !== undefined))) {
        const s = summarizeCard(obj);
        return {
            type: 'character', subtype: s.spec, name: s.name || base, author: s.creator, version: s.characterVersion,
            tags: s.tags, description: s.creatorNotesPreview || s.descriptionPreview, meta: { card: s }, searchText: cardSearchText(obj),
        };
    }
    // 世界书
    if (obj.entries && typeof obj.entries === 'object') {
        const entries = entriesOf(obj);
        const keys = [];
        for (const e of entries.slice(0, 300)) {
            const name = str(e.comment || e.name || entryKeys(e)[0]);
            if (name) keys.push(name);
        }
        return {
            type: 'worldbook', name: str(obj.name) || base, description: str(obj.description),
            meta: { entries: entries.length, constant: entries.filter((e) => e.constant).length, disabled: entries.filter((e) => e.disable || e.enabled === false).length, titles: keys.slice(0, 100) },
            searchText: keys.join(' ').slice(0, 4000),
        };
    }
    // 单条正则
    if ('findRegex' in obj && 'replaceString' in obj) {
        return { type: 'regex', subtype: 'single', name: str(obj.scriptName) || base, meta: { findRegex: str(obj.findRegex).slice(0, 300), placement: obj.placement || [] } };
    }
    // 快速回复
    if (Array.isArray(obj.qrList)) {
        return { type: 'quickreply', name: str(obj.name) || base, meta: { count: obj.qrList.length, labels: obj.qrList.map((q) => str(q.label)).slice(0, 50) } };
    }
    // 主题
    if ('main_text_color' in obj || 'blur_strength' in obj || 'chat_display' in obj) {
        return { type: 'theme', name: str(obj.name) || base, meta: { colors: ['main_text_color', 'italics_text_color', 'quote_text_color', 'blur_tint_color', 'chat_tint_color', 'user_mes_blur_tint_color', 'bot_mes_blur_tint_color'].map((k) => obj[k]).filter(Boolean) } };
    }
    // 酒馆助手脚本 / 脚本库
    if ((obj.type === 'script' || obj.type === 'folder') && ('content' in obj || 'scripts' in obj || 'value' in obj)) {
        return { type: 'script', subtype: 'tavern-helper', name: str(obj.name) || base, description: str(obj.info), meta: { scriptType: obj.type, count: arr(obj.scripts || obj.value).length || 1 } };
    }
    if (Array.isArray(obj.scripts) && obj.scripts.some((x) => x && 'content' in x)) {
        return { type: 'script', subtype: 'tavern-helper', name: str(obj.name) || base, meta: { count: obj.scripts.length } };
    }
    // 预设
    if (Array.isArray(obj.prompts) || Array.isArray(obj.prompt_order) || 'chat_completion_source' in obj || ('temperature' in obj && 'openai_max_context' in obj)) {
        const prompts = arr(obj.prompts);
        const eff = effectivePrompts(obj);
        return {
            type: 'preset', subtype: 'openai', name: str(obj.name) || base,
            meta: { apiId: 'openai', prompts: prompts.length, enabledPrompts: eff.filter((x) => x.enabled).length, regexCount: presetRegex(obj).length, temperature: obj.temperature, maxContext: obj.openai_max_context, maxTokens: obj.openai_max_tokens, promptNames: eff.map((x) => str(x.p.name)).filter(Boolean).slice(0, 80) },
            searchText: prompts.map((p) => `${str(p.name)} ${str(p.content).slice(0, 200)}`).join('\n').slice(0, 4000),
        };
    }
    if ('input_sequence' in obj && 'output_sequence' in obj) return { type: 'preset', subtype: 'instruct', name: str(obj.name) || base, meta: { apiId: 'instruct' } };
    if ('story_string' in obj) return { type: 'preset', subtype: 'context', name: str(obj.name) || base, meta: { apiId: 'context' } };
    if ('rep_pen' in obj || 'rep_pen_range' in obj) return { type: 'preset', subtype: 'textgen', name: str(obj.name) || base, meta: { apiId: 'textgenerationwebui', temperature: obj.temp ?? obj.temperature } };
    if (typeof obj.content === 'string' && typeof obj.name === 'string' && Object.keys(obj).length <= 4) {
        return { type: 'preset', subtype: 'sysprompt', name: obj.name || base, meta: { apiId: 'sysprompt' } };
    }
    // 扩展 manifest
    if (obj.display_name && (obj.js || obj.loading_order !== undefined)) {
        return { type: 'extension', name: str(obj.display_name), author: str(obj.author), version: str(obj.version), meta: {} };
    }
    return { type: 'other', subtype: 'json', name: str(obj.name) || base, meta: { keys: Object.keys(obj).slice(0, 30) } };
}

/**
 * 识别一个文件
 * @returns {{type, subtype?, name, description?, author?, version?, tags?, meta, searchText?, isCover?: boolean, card?: object}}
 */
export function detectFile(buf, filename) {
    const ext = path.extname(filename || '').toLowerCase();
    const base = path.basename(filename || 'untitled', ext);

    if (isPng(buf)) {
        const card = extractCardFromPng(buf);
        const { width, height } = readPngInfo(buf);
        if (card) {
            const s = summarizeCard(card);
            return {
                type: 'character', subtype: s.spec, name: s.name || base, author: s.creator, version: s.characterVersion,
                tags: s.tags, description: s.creatorNotesPreview || s.descriptionPreview, meta: { card: s, image: { width, height } },
                searchText: cardSearchText(card), isCover: true,
            };
        }
        return { type: 'background', name: base, meta: { image: { width, height } }, isCover: true };
    }
    if (IMAGE_EXT.has(ext)) return { type: 'background', name: base, meta: {}, isCover: true };
    if (ext === '.charx') {
        try {
            const entry = readZip(buf).find((e) => e.name.toLowerCase() === 'card.json');
            if (entry) {
                const det = detectJson(JSON.parse(entry.read().toString('utf8')), `${base}.json`);
                if (det.type === 'character') return { ...det, subtype: 'charx' };
            }
        } catch { /* 当作普通附件 */ }
        return { type: 'character', subtype: 'charx', name: base, meta: {} };
    }
    if (ext === '.zip') return { type: 'extension', subtype: 'zip', name: base, meta: {} };
    if (ext === '.js' || ext === '.mjs' || ext === '.ts') return { type: 'script', subtype: 'js', name: base, meta: { lines: buf.toString('utf8').split('\n').length }, searchText: buf.toString('utf8').slice(0, 2000) };
    if (ext === '.css') return { type: 'theme', subtype: 'css', name: base, meta: {} };
    if (ext === '.jsonl') {
        const lines = buf.toString('utf8').split('\n').filter((l) => l.trim());
        let header = {};
        try { header = JSON.parse(lines[0]); } catch { /* ignore */ }
        return { type: 'chat', name: base, meta: { messages: Math.max(0, lines.length - 1), character: str(header.character_name), user: str(header.user_name) } };
    }
    if (ext === '.txt' || ext === '.md') {
        const text = buf.toString('utf8');
        return { type: 'prompt', name: base, meta: { chars: text.length }, searchText: text.slice(0, 4000) };
    }
    if (ext === '.json' || buf[0] === 0x7b || buf[0] === 0x5b) {
        try {
            const obj = JSON.parse(buf.toString('utf8').replace(/^﻿/, ''));
            return detectJson(obj, filename || 'untitled.json');
        } catch {
            return { type: 'other', name: base, meta: { invalidJson: true } };
        }
    }
    return { type: 'other', name: base, meta: {} };
}
