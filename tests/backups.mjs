// 服务器备份：文件夹格式、硬链接共用、下载 ZIP、旧 ZIP 转换（坏的保留）、数据库损坏时从备份恢复
// 用数据目录的一份拷贝直接调用 lib/backups.js，不经过 HTTP
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Store } from '../server/lib/store.js';
import { createBackups, recoverDb } from '../server/lib/backups.js';
import { buildZip, readZip } from '../server/lib/zip.js';

const SRC = process.argv[2];
let fails = 0;
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fails++; };
const T = fs.mkdtempSync(path.join(path.dirname(SRC), 'bk-'));
fs.cpSync(path.join(SRC, 'db.json'), path.join(T, 'db.json'));
fs.cpSync(path.join(SRC, 'files'), path.join(T, 'files'), { recursive: true });
const store = new Store(T);
const DIR = path.join(T, 'backups');
const b = createBackups({ dir: DIR, store });
const ino = (p) => fs.statSync(p).ino;
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const anyBlob = Object.values(store.db.items).flatMap((i) => i.files.map((f) => f.sha))[0];

const n1 = b.make('auto');
const d1 = path.join(DIR, n1.replace(/\.zip$/, ''));
ok(fs.statSync(d1).isDirectory() && fs.existsSync(path.join(d1, 'db.json')), 'backup stored as folder: ' + n1);
ok(ino(path.join(d1, 'files', anyBlob.slice(0, 2), anyBlob)) === ino(store.blobPath(anyBlob)), 'files are hardlinks to the vault files');
const l = b.list();
ok(l.length === 1 && l[0].name === n1 && l[0].auto && l[0].size > 1000, 'listed with logical size');
const z = readZip(b.zip(n1));
const e = b.entries(n1);
ok(z.length === e.length && z[0].name === 'db.json' && !z.some((x) => x.name === 'backup.json'), `download zip has ${z.length} entries, db.json first, no internal meta`);
ok(z.every((x) => !x.name.startsWith('files/') || sha(x.read()) === x.name.slice(-64)), 'zip file contents intact');

await new Promise((r) => setTimeout(r, 1100));
store.db.items[Object.keys(store.db.items)[0]].notes = 'changed'; store.save(); store.flush();
const n2 = b.make('auto');
const disk = b.disk();
ok(b.list().length === 2 && disk.extra < 4 * fs.statSync(path.join(T, 'db.json')).size, `second backup shares files (total ${disk.total}, extra ${disk.extra})`);

// 旧格式 ZIP：一份正常的、一份文件内容被改过的、一份带着仓库里已经没有的文件
const good = 'TavernVault-manual-20200101-000000.zip';
fs.writeFileSync(path.join(DIR, good), b.zip(n1));
const extraBuf = Buffer.from('only in old backup');
const extra = 'TavernVault-auto-20200102-000000.zip';
fs.writeFileSync(path.join(DIR, extra), buildZip([...z.map((x) => ({ name: x.name, data: x.read() })), { name: `files/${sha(extraBuf).slice(0, 2)}/${sha(extraBuf)}`, data: extraBuf }]));
const bad = 'TavernVault-auto-20200103-000000.zip';
// 仓库里有的文件，即使 ZIP 里那份坏了也能从仓库链接回来；仓库里也没有、内容又对不上的才算坏
const fake = sha(Buffer.from('original content'));
fs.writeFileSync(path.join(DIR, bad), buildZip([...z.map((x) => ({ name: x.name, data: x.read() })), { name: `files/${fake.slice(0, 2)}/${fake}`, data: Buffer.from('tampered') }]));
const old = new Date('2020-01-01T08:00:00Z');
for (const n of [good, extra, bad]) fs.utimesSync(path.join(DIR, n), old, old);
const logs = [];
const b2 = createBackups({ dir: DIR, store, log: (m) => logs.push(m) });
ok(b2.migrate() === 2, 'two old zips converted');
ok(!fs.existsSync(path.join(DIR, good)) && fs.statSync(path.join(DIR, good.replace('.zip', ''))).isDirectory(), 'good zip replaced by folder');
ok(fs.existsSync(path.join(DIR, bad)) && !fs.existsSync(path.join(DIR, bad.replace('.zip', ''))) && logs.some((m) => m.includes(bad) && m.includes('保留')), 'tampered zip kept as is');
ok(ino(path.join(DIR, good.replace('.zip', ''), 'files', anyBlob.slice(0, 2), anyBlob)) === ino(store.blobPath(anyBlob)), 'converted backup links to vault files');
const ex = path.join(DIR, extra.replace('.zip', ''), 'files', sha(extraBuf).slice(0, 2), sha(extraBuf));
ok(fs.readFileSync(ex).equals(extraBuf), 'file missing from the vault written from the zip');
ok(b2.list().find((x) => x.name === good)?.at === old.toISOString(), 'converted backup keeps its original time');
ok(JSON.stringify(b2.readDb(good)) === JSON.stringify(JSON.parse(z[0].read().toString('utf8'))), 'converted db.json identical');
ok(b2.list().length === 5 && b2.list().some((x) => x.name === bad), 'list shows folders and the remaining zip');
ok(readZip(b2.zip(bad)).length === z.length + 1, 'remaining zip still downloadable');

// 数据库坏了：从最近一份备份恢复（最近的是文件夹格式）
fs.writeFileSync(path.join(T, 'db.json'), '{broken');
const r = recoverDb(DIR);
ok(r && r.from.includes(n2.replace('.zip', '')) && Object.values(r.db.items).some((i) => i.notes === 'changed'), 'recover from newest folder backup: ' + r?.from);
const s2 = new Store(T, { recover: () => recoverDb(DIR) });
ok(Object.keys(s2.db.items).length === Object.keys(store.db.items).length, 'store recovers from folder backup');

ok(b2.remove(n1) && !fs.existsSync(d1) && fs.existsSync(store.blobPath(anyBlob)), 'remove backup keeps vault files');
ok(!b2.locate('../db.json.zip') && !b2.remove('x.zip'), 'bad names rejected');
fs.rmSync(T, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
