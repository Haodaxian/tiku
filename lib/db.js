'use strict';
/**
 * 极简数据层：单个 JSON 文件 + 原子写。
 * 纯个人本地使用，数据量在万级题目内完全够用，无需数据库。
 */
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const DATA_DIR = cfg.DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const BACKUP_DIR = path.join(DATA_DIR, 'backup');

const DEFAULT_SETTINGS = {
  apiKey: '',
  baseUrl: 'https://api.stepfun.com/v1',
  visionModel: cfg.VISION_MODEL,
  textModel: cfg.TEXT_MODEL,
  theme: 'light',
  school: '',
  teacher: '',
  lectureDensity: 'single',
  lastSubject: '',
  lastGrade: '',
  autoSaveRaw: true
};

const EMPTY = {
  version: 1,
  settings: Object.assign({}, DEFAULT_SETTINGS),
  folders: [
    { id: 'f_default', name: '我的题库', parentId: '', tags: [], createdAt: Date.now() }
  ],
  questions: [],
  lectures: [],
  gallery: [],
  usage: []
};

let cache = null;
let writeTimer = null;
let writing = false;
// 数据文件损坏时的现场记录：损坏事实必须让老师看见，不能悄悄以空库蒙混过去
let corrupt = null;

/** 本地时间戳（备份文件名用，不能用 UTC，否则本地凌晨会落到前一天） */
function localStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    '-' + p(d.getHours()) + '-' + p(d.getMinutes()) + '-' + p(d.getSeconds());
}

/** 本地日期 YYYY-MM-DD */
function localDay() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function ensureDirs() {
  for (const d of [DATA_DIR, UPLOAD_DIR, BACKUP_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

function normalize(db) {
  const out = Object.assign({}, EMPTY, db || {});
  out.settings = Object.assign({}, DEFAULT_SETTINGS, out.settings || {});
  // 模型写死，老数据里存的旧模型名一并纠正
  out.settings.visionModel = cfg.VISION_MODEL;
  out.settings.textModel = cfg.TEXT_MODEL;
  out.folders = Array.isArray(out.folders) && out.folders.length
    ? out.folders
    : EMPTY.folders.map((f) => Object.assign({}, f, { tags: (f.tags || []).slice() }));
  out.questions = Array.isArray(out.questions) ? out.questions : [];
  out.lectures = Array.isArray(out.lectures) ? out.lectures : [];
  out.gallery = Array.isArray(out.gallery) ? out.gallery : [];
  out.usage = Array.isArray(out.usage) ? out.usage : [];
  // 迁移：老题库是平铺的，没有父级和标签，这里补齐（不影响已有题目）
  const ids = new Set(out.folders.map((f) => f.id));
  out.folders = out.folders.map((f) => Object.assign({}, f, {
    parentId: ids.has(f.parentId) ? f.parentId : '',
    tags: Array.isArray(f.tags) ? f.tags.map(String).filter(Boolean) : []
  }));
  // 父级链自检：出现环就把该题库提到顶层，避免树上无限递归
  const byId = new Map(out.folders.map((f) => [f.id, f]));
  for (const f of out.folders) {
    const seen = new Set([f.id]);
    let pid = f.parentId;
    while (pid) {
      if (seen.has(pid)) { f.parentId = ''; break; }
      seen.add(pid);
      const parent = byId.get(pid);
      if (!parent) { f.parentId = ''; break; }
      pid = parent.parentId;
    }
  }
  return out;
}

function load() {
  if (cache) return cache;
  ensureDirs();
  if (!fs.existsSync(DB_FILE)) {
    cache = normalize(null);
    flushSync();
    return cache;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    if (!raw.trim()) throw new Error('数据文件内容为空');
    cache = normalize(JSON.parse(raw || '{}'));
  } catch (e) {
    // 数据文件坏了：先把原始字节完整保留下来（.broken 副本），再以空库启动。
    // 关键点：绝不能在这里把空库写回 db.json —— 那样老师会发现"题库凭空没了"却找不到原因。
    // 同时记下损坏事实，由界面明确告警并引导从备份恢复。
    const bad = DB_FILE + '.broken-' + localStamp();
    try { fs.copyFileSync(DB_FILE, bad); } catch (_) {}
    corrupt = {
      file: path.basename(bad),
      reason: e.message,
      at: Date.now(),
      // 保留一份原始内容，便于人工核对
      backupHint: 'data 目录下的 ' + path.basename(bad) + ' 是损坏前的原始内容，可手工改回 db.json'
    };
    console.error('[数据] db.json 读取失败：' + e.message);
    console.error('[数据] 原始内容已保留为 ' + bad + '，请在「设置」页从备份恢复，或把该文件改名回 db.json');
    cache = normalize(null);
  }
  return cache;
}

/** 数据文件是否损坏过（有现场可找回） */
function corruptInfo() {
  return corrupt ? Object.assign({}, corrupt) : null;
}

/** 恢复备份成功后清掉告警 */
function clearCorrupt() {
  corrupt = null;
}

function flushSync() {
  if (!cache) return;
  ensureDirs();
  const tmp = DB_FILE + '.tmp';
  const text = JSON.stringify(cache, null, 1);
  // 必须 fsync：断电或强制结束进程时，未落盘的内容会留下 0 字节 db.json，
  // 而 0 字节文件下次启动会被判成损坏，等于整库丢失。
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, text, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, DB_FILE);
}

/** 合并多次写入，避免每加一道题都落盘 */
function persist(delay) {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    if (writing) { persist(50); return; }
    writing = true;
    try { flushSync(); } catch (e) { console.error('[数据] 保存失败:', e.message); }
    writing = false;
  }, delay === undefined ? 200 : delay);
}

function flushNow() {
  if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
  flushSync();
}

/** 每日备份命名 db-YYYY-MM-DD.json；安全快照命名 db-<label>-<时间戳>.json，两类清理互不牵连 */
const DAILY_RE = /^db-\d{4}-\d{2}-\d{2}\.json$/;

/** 每日备份一份，最多保留 7 份（只清每日备份，不动安全快照） */
function dailyBackup() {
  try {
    ensureDirs();
    // 用本地日期：原来用 UTC 日期，本地凌晨 0~8 点启动会算成前一天，
    // 而前一天的备份已存在就直接跳过 —— 结果当天根本没有备份。
    const day = localDay();
    const file = path.join(BACKUP_DIR, 'db-' + day + '.json');
    if (fs.existsSync(file)) return;
    flushNow();
    fs.copyFileSync(DB_FILE, file);
    const files = fs.readdirSync(BACKUP_DIR).filter((f) => DAILY_RE.test(f)).sort();
    while (files.length > 7) {
      const old = files.shift();
      try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch (_) {}
    }
  } catch (e) { /* 备份失败不影响主流程 */ }
}

let backupTimer = null;

/** 定时备份：程序连续开着跨天时也要留下当天的备份，不能只在启动时打一次 */
function startAutoBackup(intervalMs) {
  if (backupTimer) return;
  const tick = () => { try { dailyBackup(); } catch (_) {} };
  backupTimer = setInterval(tick, intervalMs || 6 * 60 * 60 * 1000);
  if (backupTimer.unref) backupTimer.unref();
}

/** 危险操作前的现场快照（例如整库恢复），文件名带时间戳，不与每日备份混用 */
function safetyBackup(label) {
  try {
    ensureDirs();
    flushNow();
    const stamp = localStamp();
    const name = 'db-' + (label || 'auto') + '-' + stamp + '.json';
    fs.copyFileSync(DB_FILE, path.join(BACKUP_DIR, name));
    const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('db-') && !DAILY_RE.test(f)).sort();
    while (files.length > 20) {
      try { fs.unlinkSync(path.join(BACKUP_DIR, files.shift())); } catch (_) {}
    }
    return name;
  } catch (e) {
    return null;
  }
}

function db() { return load(); }

/* ---------------- 运行锁 ----------------
   同一个数据目录只允许一个进程写入。
   单靠"端口被占用就换个端口"来防重复启动并不可靠：探测超时会误判成"没人在跑"，
   于是第二个实例换端口启动，两个进程同时写 db.json，后写的整库快照会覆盖先写的数据。
   这里用 pid 锁文件做硬保证。 */

const LOCK_FILE = path.join(DATA_DIR, 'app.lock');

/** 进程是否还活着 */
function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e && e.code === 'EPERM';
  }
}

/**
 * 尝试获取运行锁。
 * 返回 { ok: true } 表示抢到了；{ ok: false, pid } 表示已有实例在用这个数据目录。
 */
function acquireLock() {
  ensureDirs();
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const prev = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8') || '{}');
      const pid = Number(prev.pid);
      if (pid && pid !== process.pid && isAlive(pid)) {
        return { ok: false, pid, startedAt: prev.startedAt };
      }
    }
  } catch (_) { /* 锁文件坏了就当没有，重新抢 */ }
  try {
    fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, startedAt: Date.now() }, null, 1), 'utf8');
  } catch (_) { /* 抢不到锁也不能让程序起不来 */ }
  return { ok: true };
}

/** 退出时释放锁（只删自己的，别人正在跑的不动） */
function releaseLock() {
  try {
    const cur = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8') || '{}');
    if (Number(cur.pid) === process.pid) fs.unlinkSync(LOCK_FILE);
  } catch (_) {}
}

function saveImage(buffer, ext) {
  ensureDirs();
  const crypto = require('crypto');
  const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 20);
  const name = hash + '.' + (ext || 'jpg').replace(/^\./, '');
  const file = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, buffer);
  return '/uploads/' + name;
}

function uploadPath(name) {
  return path.join(UPLOAD_DIR, path.basename(name));
}

function addUsage(entry) {
  const d = db();
  d.usage.push(entry);
  if (d.usage.length > 5000) d.usage = d.usage.slice(-4000);
  persist();
}

module.exports = {
  db, persist, flushNow, dailyBackup, startAutoBackup, safetyBackup, saveImage, uploadPath, addUsage,
  corruptInfo, clearCorrupt, acquireLock, releaseLock,
  DEFAULT_SETTINGS, DATA_DIR, UPLOAD_DIR
};
