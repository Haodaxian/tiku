// 生成一个最小可用的 .docx，用于验证导入解析（不依赖任何第三方库）
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const paras = [
  '第一章 一元二次方程',
  '只含有一个未知数，并且未知数的最高次数是 2 的整式方程，叫做一元二次方程。',
  '一般形式为 ax² + bx + c = 0（a≠0）。',
  '',
  '第二章 解法',
  '1. 直接开平方法：适用于 (x+m)² = n 的形式。',
  '2. 配方法：把左边配成完全平方。',
  '3. 公式法：x = (-b ± √(b²-4ac)) / 2a。'
];

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
  paras.map((p) => '<w:p><w:r><w:t xml:space="preserve">' + esc(p) + '</w:t></w:r></w:p>').join('') +
  '</w:body></w:document>';

const data = Buffer.from(xml, 'utf8');
const nameBuf = Buffer.from('word/document.xml', 'utf8');
const crc = zlib.crc32 ? zlib.crc32(data) : 0;

const local = Buffer.alloc(30);
local.writeUInt32LE(0x04034b50, 0);
local.writeUInt16LE(20, 4);
local.writeUInt16LE(0, 6);
local.writeUInt16LE(0, 8);       // 不压缩
local.writeUInt16LE(0, 10);
local.writeUInt16LE(0, 12);
local.writeUInt32LE(crc >>> 0, 14);
local.writeUInt32LE(data.length, 18);
local.writeUInt32LE(data.length, 22);
local.writeUInt16LE(nameBuf.length, 26);
local.writeUInt16LE(0, 28);
const localBlock = Buffer.concat([local, nameBuf, data]);

const cen = Buffer.alloc(46);
cen.writeUInt32LE(0x02014b50, 0);
cen.writeUInt16LE(20, 4);
cen.writeUInt16LE(20, 6);
cen.writeUInt16LE(0, 8);
cen.writeUInt16LE(0, 10);
cen.writeUInt16LE(0, 12);
cen.writeUInt16LE(0, 14);
cen.writeUInt32LE(crc >>> 0, 16);
cen.writeUInt32LE(data.length, 20);
cen.writeUInt32LE(data.length, 24);
cen.writeUInt16LE(nameBuf.length, 28);
cen.writeUInt16LE(0, 30);
cen.writeUInt16LE(0, 32);
cen.writeUInt16LE(0, 34);
cen.writeUInt16LE(0, 36);
cen.writeUInt32LE(0, 38);
cen.writeUInt32LE(0, 42);
const cenBlock = Buffer.concat([cen, nameBuf]);

const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(1, 8);
eocd.writeUInt16LE(1, 10);
eocd.writeUInt32LE(cenBlock.length, 12);
eocd.writeUInt32LE(localBlock.length, 16);
eocd.writeUInt16LE(0, 20);

const out = Buffer.concat([localBlock, cenBlock, eocd]);
const file = path.join(__dirname, 'sample.docx');
fs.writeFileSync(file, out);
console.log('生成 ' + file + '（' + out.length + ' 字节）');
