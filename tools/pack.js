// 打包为 zip（自己写，保证中文文件名用 UTF-8 标记，解压不乱码）
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '..', 'deliverables', '题库讲义系统-本地版-v1.0.zip');
const EXCLUDE = new Set(['tools', 'node_modules', '.git', 'data/backup']);
const EXECUTABLE = new Set(['启动-Mac.command']);

function walk(dir, base) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = base ? base + '/' + name : name;
    if (EXCLUDE.has(rel) || EXCLUDE.has(name)) continue;
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...walk(full, rel));
    else out.push({ rel, full, size: st.size, mode: st.mode });
  }
  return out;
}

function dosTime(d) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((Math.floor(d.getSeconds() / 2)) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

const files = walk(ROOT, '');
const locals = [];
const centrals = [];
let offset = 0;
const now = new Date();

for (const f of files) {
  const data = fs.readFileSync(f.full);
  const comp = zlib.deflateRawSync(data, { level: 9 });
  const nameBuf = Buffer.from(f.rel, 'utf8');
  const crc = (zlib.crc32 ? zlib.crc32(data) : 0) >>> 0;
  const { time, date } = dosTime(now);
  const isExec = EXECUTABLE.has(f.rel);
  const extAttr = ((isExec ? 0o100755 : 0o100644) << 16) >>> 0;

  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(0x0800, 6);          // UTF-8 文件名
  lh.writeUInt16LE(8, 8);               // deflate
  lh.writeUInt16LE(time, 10);
  lh.writeUInt16LE(date, 12);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(comp.length, 18);
  lh.writeUInt32LE(data.length, 22);
  lh.writeUInt16LE(nameBuf.length, 26);
  lh.writeUInt16LE(0, 28);
  locals.push(lh, nameBuf, comp);

  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(0x0314, 4);          // made by unix
  ch.writeUInt16LE(20, 6);
  ch.writeUInt16LE(0x0800, 8);
  ch.writeUInt16LE(8, 10);
  ch.writeUInt16LE(time, 12);
  ch.writeUInt16LE(date, 14);
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(comp.length, 20);
  ch.writeUInt32LE(data.length, 24);
  ch.writeUInt16LE(nameBuf.length, 28);
  ch.writeUInt16LE(0, 30);
  ch.writeUInt16LE(0, 32);
  ch.writeUInt16LE(0, 34);
  ch.writeUInt16LE(0, 36);
  ch.writeUInt32LE(extAttr, 38);
  ch.writeUInt32LE(offset, 42);
  centrals.push(ch, nameBuf);

  offset += 30 + nameBuf.length + comp.length;
}

const cenBuf = Buffer.concat(centrals);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(files.length, 8);
eocd.writeUInt16LE(files.length, 10);
eocd.writeUInt32LE(cenBuf.length, 12);
eocd.writeUInt32LE(offset, 16);
eocd.writeUInt16LE(0, 20);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([Buffer.concat(locals), cenBuf, eocd]));

console.log('打包完成：' + OUT);
console.log('文件数 ' + files.length + '，大小 ' + (fs.statSync(OUT).size / 1048576).toFixed(2) + ' MB');
for (const f of files.slice(0, 40)) console.log('  ' + f.rel + '  ' + f.size + 'B');
