#!/usr/bin/env node
'use strict';
/**
 * 一键打包脚本。
 *
 *   node tools/build.js            打包 Windows + Mac，并生成三个发布压缩包
 *   node tools/build.js win        只打 Windows（含图标注入）
 *   node tools/build.js mac        只打 Mac（Apple 芯片 + Intel）
 *   node tools/build.js zip        只把 dist 里已有的程序打成发布压缩包
 *
 * 之所以用 Node 脚本而不是 bat 里串命令：
 *   1) 中文文件名在 cmd 里容易乱码；
 *   2) pkg 在 Windows 上直接调用需要 shell，容易出引号问题；
 *   3) 打完还要注入图标、生成 zip，串起来一目了然。
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PKG_BIN = path.join(ROOT, 'node_modules', '@yao-pkg', 'pkg', 'lib-es5', 'bin.js');

const WIN_EXE = path.join(DIST, '题库与讲义系统-win.exe');
const MAC_ARM = path.join(DIST, '题库与讲义系统-mac-Apple芯片');
const MAC_X64 = path.join(DIST, '题库与讲义系统-mac-Intel');

function log(msg) {
  console.log('\n' + '='.repeat(58) + '\n  ' + msg + '\n' + '='.repeat(58));
}

function ensurePkg() {
  if (!fs.existsSync(PKG_BIN)) {
    console.error('\n[错误] 没找到打包工具 pkg，请先在本目录执行：npm install\n');
    process.exit(1);
  }
  fs.mkdirSync(DIST, { recursive: true });
}

/** 调用 pkg，返回产物路径 */
function pkg(target, outName, extraArgs) {
  const rel = 'dist/' + outName;
  const args = [PKG_BIN, '.', '--targets', target].concat(extraArgs || [], ['--output', rel]);
  console.log('\n> pkg ' + target + '  ->  ' + rel);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('\n[失败] ' + target + ' 打包失败，上面的输出里有原因。\n');
    process.exit(r.status || 1);
  }
  const file = path.join(DIST, outName);
  if (!fs.existsSync(file)) {
    console.error('\n[失败] 打包命令返回成功，但没有生成 ' + file + '\n');
    process.exit(1);
  }
  const mb = (fs.statSync(file).size / 1048576).toFixed(1);
  console.log('  √ 已生成 ' + outName + '  ' + mb + ' MB');
  return file;
}

/**
 * 把项目根目录的 data\ 同步到 dist\data\。
 *
 * 为什么要这一步：打包出来的 exe 读的是「自己所在文件夹的 data」。
 * 如果 dist 下没有 data，第一次双击就会新建一个空库 —— 老师会发现
 * 「我的 API Key 和题库全没了」，其实数据好好地躺在项目根目录里。
 * 所以打包时把当前数据带过去，exe 一启动就是有题有 Key 的状态。
 *
 * 只在 dist\data 是空的（没有题、没有 Key）时才覆盖，
 * 免得把老师自己用出来的独立数据冲掉。
 */
function syncDataToDist() {
  const src = path.join(ROOT, 'data');
  const dst = path.join(DIST, 'data');
  const srcDb = path.join(src, 'db.json');
  if (!fs.existsSync(srcDb)) return;
  let srcData;
  try { srcData = JSON.parse(fs.readFileSync(srcDb, 'utf8')); } catch (e) { return; }
  const hasContent = (srcData.questions || []).length || (srcData.lectures || []).length ||
    (srcData.gallery || []).length || (srcData.settings && srcData.settings.apiKey);
  if (!hasContent) { console.log('  · 项目根 data 里没有题也没有 Key，跳过数据同步'); return; }

  const dstDb = path.join(dst, 'db.json');
  if (fs.existsSync(dstDb)) {
    let dstData;
    try { dstData = JSON.parse(fs.readFileSync(dstDb, 'utf8')); } catch (e) { dstData = null; }
    const dstHas = dstData && ((dstData.questions || []).length || (dstData.lectures || []).length ||
      (dstData.gallery || []).length || (dstData.settings && dstData.settings.apiKey));
    if (dstHas) { console.log('  · dist\\data 里已有自己的数据，保持不动（不覆盖）'); return; }
  }

  fs.mkdirSync(dst, { recursive: true });
  fs.copyFileSync(srcDb, dstDb);
  const srcUploads = path.join(src, 'uploads');
  if (fs.existsSync(srcUploads)) {
    fs.mkdirSync(path.join(dst, 'uploads'), { recursive: true });
    for (const f of fs.readdirSync(srcUploads)) {
      const to = path.join(dst, 'uploads', f);
      if (!fs.existsSync(to)) fs.copyFileSync(path.join(srcUploads, f), to);
    }
  }
  console.log('  √ 已把项目根的 data\\ 同步到 dist\\data\\（题目、Key、图片一并带上）');
}

function buildWin() {
  log('1/3  打包 Windows 版');
  const exe = pkg('node22-win-x64', '题库与讲义系统-win.exe');

  log('2/3  给 exe 写入图标和文件属性');
  const r = spawnSync(process.execPath, [path.join(__dirname, 'inject-icon.js'), exe], {
    cwd: ROOT,
    stdio: 'inherit'
  });
  if (r.status !== 0) {
    // 图标失败不影响程序能否运行，提示但不算整体失败
    console.warn('\n[提示] 图标注入失败，程序仍可正常使用，只是显示默认图标。\n');
  }

  log('3/3  把当前题库和 Key 同步到 dist\\data\\');
  syncDataToDist();
}

function buildMac() {
  // mac 包只能在 macOS 上构建：pkg 会报 "only for 'win'"，electron-builder 会报
  // "supported only on macOS"。这不是配置能绕过去的，直接给出可执行的提示。
  if (process.platform !== 'darwin') {
    console.error('\n[错误] mac 包必须在 macOS 上打包。');
    console.error('  pkg：Not able to build for \'macos\' here, only for \'win\'');
    console.error('  electron-builder：Build for macOS is supported only on macOS');
    console.error('\n  在 Mac 上打开项目目录后执行：');
    console.error('    chmod +x tools/build-mac.sh');
    console.error('    ./tools/build-mac.sh');
    console.error('\n  或者用一台 Mac / CI 的 macOS 机器跑。\n');
    process.exit(1);
  }
  log('1/2  打包 Mac（Apple 芯片 / arm64）');
  pkg('node22-macos-arm64', '题库与讲义系统-mac-Apple芯片');

  log('2/2  打包 Mac（Intel / x64）');
  pkg('node22-macos-x64', '题库与讲义系统-mac-Intel');
}

function buildZips() {
  log('生成发布压缩包');
  const r = spawnSync(process.execPath, [path.join(__dirname, 'build-package.js')], {
    cwd: ROOT,
    stdio: 'inherit'
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

const mode = (process.argv[2] || 'all').toLowerCase();
ensurePkg();

if (mode === 'win') {
  buildWin();
  buildZips();
} else if (mode === 'mac') {
  buildMac();
  buildZips();
} else if (mode === 'zip') {
  buildZips();
} else if (mode === 'all') {
  buildWin();
  buildMac();
  buildZips();
} else {
  console.error('用法：node tools/build.js [win|mac|zip|all]');
  process.exit(1);
}

log('全部完成');
console.log('  程序产物：' + DIST);
console.log('  发布压缩包：' + path.join(DIST, '发布包'));
console.log('');
