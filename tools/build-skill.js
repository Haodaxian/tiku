#!/usr/bin/env node
'use strict';
/**
 * 把 public/skills/tiku-json 打成可分发的 zip。
 *
 *   node tools/build-skill.js
 *
 * 产物：dist/tiku-json-skill.zip（解压后是 tiku-json/ 目录，直接放进智能体的 skills 目录）
 */
const fs = require('fs');
const path = require('path');
const { buildZip } = require('../lib/zip');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public', 'skills', 'tiku-json');
const OUT = path.join(ROOT, 'dist', 'tiku-json-skill.zip');

if (!fs.existsSync(SRC)) {
  console.error('[错误] 找不到 Skill 目录：' + SRC);
  process.exit(1);
}

const files = fs.readdirSync(SRC).filter((f) => fs.statSync(path.join(SRC, f)).isFile()).sort();
if (!files.length) {
  console.error('[错误] Skill 目录是空的：' + SRC);
  process.exit(1);
}

const zip = buildZip(files.map((f) => ({
  name: 'tiku-json/' + f,
  data: fs.readFileSync(path.join(SRC, f))
})));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, zip);

console.log('已生成：' + OUT);
console.log('大小：' + (zip.length / 1024).toFixed(1) + ' KB，包含：');
files.forEach((f) => console.log('  tiku-json/' + f));
