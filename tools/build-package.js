// 把 dist 里的程序打成给老师用的免安装压缩包（输出到 dist/发布包/）
const fs = require('fs');
const path = require('path');
const { writeZip } = require('./zip');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, '发布包');

const WIN_EXE = path.join(DIST, '题库与讲义系统-win.exe');
const MAC_ARM = path.join(DIST, '题库与讲义系统-mac-Apple芯片');
const MAC_X64 = path.join(DIST, '题库与讲义系统-mac-Intel');
const MAC_LAUNCH = path.join(DIST, '启动-Mac.command');
const DOC_WIN = path.join(DIST, '使用说明-必读.txt');
const DOC_MAC = path.join(DIST, '使用说明-必读-Mac.txt');

const jobs = [
  {
    name: 'Windows',
    out: path.join(OUT, '题库与讲义系统-Windows免安装.zip'),
    entries: () => [
      { rel: '题库与讲义系统/题库与讲义系统.exe', file: WIN_EXE, mode: 0o100755 },
      { rel: '题库与讲义系统/使用说明-必读.txt', file: DOC_WIN, mode: 0o100644 }
    ]
  },
  {
    name: 'Mac-Apple芯片',
    out: path.join(OUT, '题库与讲义系统-Mac-Apple芯片.zip'),
    entries: () => [
      { rel: '题库与讲义系统/启动-Mac.command', file: MAC_LAUNCH, mode: 0o100755 },
      { rel: '题库与讲义系统/题库与讲义系统-mac-Apple芯片', file: MAC_ARM, mode: 0o100755 },
      { rel: '题库与讲义系统/使用说明-必读.txt', file: DOC_MAC, mode: 0o100644 }
    ]
  },
  {
    name: 'Mac-Intel',
    out: path.join(OUT, '题库与讲义系统-Mac-Intel.zip'),
    entries: () => [
      { rel: '题库与讲义系统/启动-Mac.command', file: MAC_LAUNCH, mode: 0o100755 },
      { rel: '题库与讲义系统/题库与讲义系统-mac-Intel', file: MAC_X64, mode: 0o100755 },
      { rel: '题库与讲义系统/使用说明-必读.txt', file: DOC_MAC, mode: 0o100644 }
    ]
  }
];

fs.mkdirSync(OUT, { recursive: true });

let made = 0;
for (const job of jobs) {
  const entries = job.entries();
  const missing = entries.filter((e) => !fs.existsSync(e.file)).map((e) => path.basename(e.file));
  if (missing.length) {
    console.log('  跳过 ' + job.name + '：还没打包（缺 ' + missing.join('、') + '）');
    continue;
  }
  const size = writeZip(job.out, entries);
  console.log('  √ ' + path.basename(job.out) + '  ' + (size / 1048576).toFixed(1) + ' MB  (' + entries.length + ' 个文件)');
  made++;
}

if (!made) {
  console.log('\n  一个包都没生成。请先执行：node tools/build.js win');
  process.exit(1);
}
console.log('\n  输出目录：' + OUT);
