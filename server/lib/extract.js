// 从角色卡里拆出内嵌的世界书 / 正则，变成可以单独使用的文件
import { entriesOf } from '../../web/js/cardfmt.js';

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (v == null ? '' : String(v));
const keysOf = (v) => (Array.isArray(v) ? v.map(str) : str(v).split(',').map((s) => s.trim())).filter(Boolean);
const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d);
const pick = (...vs) => vs.find((v) => v !== undefined && v !== null);

/**
 * 角色卡里的世界书条目 → 酒馆世界书文件里的条目。
 * 卡里的写法（keys / insertion_order / enabled，细项放在 extensions 里）和世界书文件的写法（key / order / disable）不一样，
 * 两种都认；认不出的字段原样带上，不丢信息。
 */
function toWorldEntry(e, i) {
    const x = e.extensions && typeof e.extensions === 'object' ? e.extensions : {};
    const position = typeof e.position === 'number' ? e.position : num(x.position, e.position === 'before_char' ? 0 : 1);
    const { keys: _k, secondary_keys: _s, insertion_order: _o, enabled: _e, extensions: _x, id: _i, name: _n, ...rest } = e;
    return {
        ...rest,
        uid: i,
        key: keysOf(pick(e.key, e.keys)),
        keysecondary: keysOf(pick(e.keysecondary, e.secondary_keys)),
        comment: str(pick(e.comment, e.name, '')),
        content: str(e.content),
        constant: Boolean(e.constant),
        selective: pick(e.selective, true) !== false,
        order: num(pick(e.order, e.insertion_order), 100),
        position,
        disable: e.disable !== undefined ? Boolean(e.disable) : e.enabled === false,
        displayIndex: num(pick(e.displayIndex, x.display_index), i),
        probability: num(pick(e.probability, x.probability), 100),
        useProbability: pick(e.useProbability, x.useProbability, true) !== false,
        depth: num(pick(e.depth, x.depth), 4),
        selectiveLogic: num(pick(e.selectiveLogic, x.selectiveLogic), 0),
        excludeRecursion: Boolean(pick(e.excludeRecursion, x.exclude_recursion)),
        preventRecursion: Boolean(pick(e.preventRecursion, x.prevent_recursion)),
        delayUntilRecursion: pick(e.delayUntilRecursion, x.delay_until_recursion, false),
        group: str(pick(e.group, x.group, '')),
        groupOverride: Boolean(pick(e.groupOverride, x.group_override)),
        groupWeight: num(pick(e.groupWeight, x.group_weight), 100),
        scanDepth: pick(e.scanDepth, x.scan_depth, null),
        caseSensitive: pick(e.caseSensitive, x.case_sensitive, null),
        matchWholeWords: pick(e.matchWholeWords, x.match_whole_words, null),
        useGroupScoring: pick(e.useGroupScoring, x.use_group_scoring, null),
        automationId: str(pick(e.automationId, x.automation_id, '')),
        role: pick(e.role, x.role, null),
        vectorized: Boolean(pick(e.vectorized, x.vectorized)),
        sticky: pick(e.sticky, x.sticky, null),
        cooldown: pick(e.cooldown, x.cooldown, null),
        delay: pick(e.delay, x.delay, null),
        addMemo: true,
    };
}

/**
 * @param d 角色卡的 data；part: 'book' | 'regex'；cardName 用来起文件名
 * @returns {{ filename: string, obj: any, count: number } | null} 卡里没有这部分时是 null
 */
export function extractPart(d, part, cardName) {
    const base = str(cardName).trim() || '角色卡';
    if (part === 'book') {
        const list = entriesOf(d?.character_book).filter((e) => e && typeof e === 'object');
        if (!list.length) return null;
        const name = str(d.character_book.name).trim() || `${base} 的世界书`;
        const entries = {};
        list.forEach((e, i) => { entries[i] = toWorldEntry(e, i); });
        return { filename: `${name}.json`, obj: { name, entries }, count: list.length };
    }
    if (part === 'regex') {
        const list = arr(d?.extensions?.regex_scripts).filter((r) => r && typeof r === 'object');
        if (!list.length) return null;
        // 只有一条时存成酒馆能直接导入的单个脚本；多条存成一组
        const one = list.length === 1;
        return { filename: `${one ? str(list[0].scriptName).trim() || `${base} 的正则` : `${base} 的正则`}.json`, obj: one ? list[0] : list, count: list.length };
    }
    return null;
}
