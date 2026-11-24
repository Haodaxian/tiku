'use strict';
/**
 * 题库与讲义系统 · 本地版服务
 * 零 npm 依赖：只用 Node 内置模块。双击启动文件即可运行。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// 让窗口标题看起来像老师能懂的东西，而不是 node/路径名
try { process.title = '题库与讲义系统（关掉此窗口即退出）'; } catch (_) {}

const store = require('./lib/db');
const cfg = require('./lib/config');
const sf = require('./lib/stepfun');
const docx = require('./lib/docx');
const { buildZip } = require('./lib/zip');
const { mimeOf, uid, readBody, send, ok, fail, sanitizeRichHtml, htmlToText,
  DIFFICULTIES, MASTERY_LEVELS, normDifficulty, normMastery } = require('./lib/util');

const PUBLIC_DIR = cfg.PUBLIC_DIR;
const PORT_START = Number(process.env.TIKU_PORT || 7788);
const HOST = '127.0.0.1';
const NO_OPEN = process.argv.includes('--no-open');
/** 单张图片体积上限（12MB）：base64 之后还要在内存里翻倍，太大的图没有实际意义 */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/* ---------------- 静态资源 ---------------- */

// 打包后程序内资源是只读快照，统一读成内存再返回（首页与脚本都很小，无需流式）
const fileCache = new Map();

function readAsset(file) {
  const key = file + '|' + (fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0);
  if (fileCache.has(key)) return fileCache.get(key);
  const buf = fs.readFileSync(file);
  if (fileCache.size > 60) fileCache.clear();
  fileCache.set(key, buf);
  return buf;
}

function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch (e) {
    // 畸形百分号编码（如 /%zz）会让 decodeURIComponent 抛 URIError，
    // 以前这里直接抛出到请求之外，响应永远发不出去，浏览器就一直转圈。
    return send(res, 400, '请求地址不合法');
  }
  if (rel === '/' || rel === '') rel = '/index.html';

  if (rel.startsWith('/uploads/')) {
    const file = store.uploadPath(rel.slice('/uploads/'.length));
    if (!fs.existsSync(file)) return send(res, 404, '图片不存在');
    // 目录本身不能当图片读（EISDIR），否则请求挂死
    if (fs.statSync(file).isDirectory()) return send(res, 404, '图片不存在');
    return sendFile(res, file, req);
  }

  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(PUBLIC_DIR, safe);
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, '拒绝访问');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(rel)) return send(res, 404, '资源不存在');
    return sendFile(res, path.join(PUBLIC_DIR, 'index.html'), req);
  }
  return sendFile(res, file, req);
}

function sendFile(res, file, req) {
  const ext = path.extname(file).toLowerCase();
  const buf = readAsset(file);
  const st = fs.statSync(file);

  // 静态脚本必须每次校验：升级后若浏览器仍用旧 JS，会出现“已修复但用户还报错”
  if (ext === '.html') {
    res.writeHead(200, {
      'Content-Type': mimeOf(file),
      'Content-Length': buf.length,
      'Cache-Control': 'no-store'
    });
    return res.end(buf);
  }

  const etag = '"' + st.size.toString(16) + '-' + Math.round(st.mtimeMs).toString(16) + '"';
  if (req && req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
    return res.end();
  }
  res.writeHead(200, {
    'Content-Type': mimeOf(file),
    'Content-Length': buf.length,
    'Cache-Control': 'no-cache',
    ETag: etag
  });
  res.end(buf);
}

/* ---------------- 业务接口 ---------------- */

function publicSettings(s) {
  const key = String(s.apiKey || '');
  return {
    hasKey: !!key,
    keyMask: key ? key.slice(0, 4) + '****' + key.slice(-4) : '',
    baseUrl: s.baseUrl,
    visionModel: cfg.VISION_MODEL,
    textModel: cfg.TEXT_MODEL,
    models: cfg.MODEL_LABELS,
    dataDir: store.DATA_DIR,
    theme: s.theme,
    school: s.school,
    teacher: s.teacher,
    lectureDensity: s.lectureDensity,
    lastSubject: s.lastSubject,
    lastGrade: s.lastGrade,
    // 数据文件损坏过时把现场信息带出去，界面必须明确告警，不能让老师以为题库本来就是空的
    corrupted: store.corruptInfo()
  };
}

function bootstrap() {
  const d = store.db();
  return {
    settings: publicSettings(d.settings),
    folders: d.folders,
    questions: d.questions,
    gallery: d.gallery,
    lectures: d.lectures.map((l) => ({
      id: l.id, title: l.title, subject: l.subject, grade: l.grade,
      updatedAt: l.updatedAt, createdAt: l.createdAt,
      sectionCount: (l.sections || []).length,
      questionCount: (l.sections || []).reduce((n, s) => n + (s.blocks || []).filter((b) => b.type === 'question').length, 0)
    })),
    stats: buildStats(d),
    version: 1
  };
}

function buildStats(d) {
  const now = Date.now();
  const monthStart = new Date();
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const monthUsage = d.usage.filter((u) => u.ts >= monthStart.getTime());
  const byType = {};
  const byDifficulty = {};
  const byKnowledge = {};
  const byMastery = { 生疏: 0, 模糊: 0, 掌握: 0, 未标记: 0 };
  let favoriteCount = 0;
  let totalViews = 0;
  for (const q of d.questions) {
    byType[q.type || '其他'] = (byType[q.type || '其他'] || 0) + 1;
    byDifficulty[q.difficulty || '中等'] = (byDifficulty[q.difficulty || '中等'] || 0) + 1;
    for (const k of q.knowledge || []) byKnowledge[k] = (byKnowledge[k] || 0) + 1;
    if (q.favorite) favoriteCount++;
    totalViews += Number(q.viewCount) || 0;
    const m = q.mastery || '';
    byMastery[m && MASTERY_LEVELS.indexOf(m) >= 0 ? m : '未标记']++;
  }
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(now - i * 86400000);
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
    const end = start + 86400000;
    last7.push({
      label: (day.getMonth() + 1) + '/' + day.getDate(),
      count: d.questions.filter((q) => q.createdAt >= start && q.createdAt < end).length
    });
  }
  const tokens = monthUsage.reduce((n, u) => n + (u.promptTokens || 0) + (u.completionTokens || 0), 0);
  const cost = monthUsage.reduce((n, u) => n + (u.cost || 0), 0);

  // 响应速度统计：按模型看平均耗时，方便在速度和价格之间取舍
  const durs = monthUsage.map((u) => u.durationMs).filter(Boolean);
  const avgMs = durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0;
  const modelMap = {};
  for (const u of monthUsage) {
    const m = modelMap[u.model] || (modelMap[u.model] = { model: u.model, calls: 0, tokens: 0, cost: 0, ms: 0, timed: 0 });
    m.calls += 1;
    m.tokens += (u.promptTokens || 0) + (u.completionTokens || 0);
    m.cost += u.cost || 0;
    if (u.durationMs) { m.ms += u.durationMs; m.timed += 1; }
  }
  const byModel = Object.values(modelMap)
    .map((m) => ({
      model: m.model,
      calls: m.calls,
      tokens: m.tokens,
      avgSec: m.timed ? Number((m.ms / m.timed / 1000).toFixed(1)) : 0,
      cost: Number(m.cost.toFixed(2))
    }))
    .sort((a, b) => b.calls - a.calls);

  return {
    questionCount: d.questions.length,
    lectureCount: d.lectures.length,
    withAnswer: d.questions.filter((q) => (q.answer || '').trim()).length,
    favoriteCount,
    totalViews,
    avgViews: d.questions.length ? Number((totalViews / d.questions.length).toFixed(2)) : 0,
    byMastery,
    monthCalls: monthUsage.length,
    monthTokens: tokens,
    monthCost: Number(cost.toFixed(2)),
    avgSec: Number((avgMs / 1000).toFixed(1)),
    byModel,
    byType,
    byDifficulty,
    topKnowledge: Object.entries(byKnowledge).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, count]) => ({ name, count })),
    last7
  };
}

/** 把前端传来的 dataURL 落盘，返回可访问地址 */
function persistDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!m) return '';
  // 扩展名必须跟真实格式对上：以前 gif/bmp 一律存成 .jpg，
  // 浏览器按 image/jpeg 去解码 GIF/BMP，图必然裂掉。
  const extMap = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
    'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp'
  };
  const ext = extMap[String(m[1]).toLowerCase()];
  if (!ext) return '';
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_IMAGE_BYTES) return '';
  return store.saveImage(buf, ext);
}

const routes = [];
function route(method, pattern, handler) { routes.push({ method, pattern, handler }); }

route('GET', /^\/api\/bootstrap$/, async () => bootstrap());
route('GET', /^\/api\/ping$/, async () => ({ app: 'tiku-lecture', version: 1 }));

route('POST', /^\/api\/settings$/, async (ctx) => {
  const d = store.db();
  const body = ctx.body || {};
  const s = d.settings;
  if (typeof body.apiKey === 'string' && body.apiKey.trim()) s.apiKey = body.apiKey.trim();
  if (body.clearKey) s.apiKey = '';
  for (const k of ['theme', 'school', 'teacher', 'lectureDensity', 'lastSubject', 'lastGrade']) {
    if (typeof body[k] === 'string') s[k] = body[k];
  }
  // 地址要校验：写坏了可以改，写成 http 就等于把 API Key 明文发出去
  if (typeof body.baseUrl === 'string') s.baseUrl = sf.safeBaseUrl(body.baseUrl);
  store.persist(10);
  return publicSettings(s);
});

route('POST', /^\/api\/test-key$/, async (ctx) => {
  const body = ctx.body || {};
  const d = store.db();
  const backupKey = d.settings.apiKey;
  const backupUrl = d.settings.baseUrl;
  if (body.apiKey) d.settings.apiKey = String(body.apiKey).trim();
  if (body.baseUrl) d.settings.baseUrl = sf.safeBaseUrl(body.baseUrl);
  const model = body.model || cfg.VISION_MODEL;
  try {
    const { content } = await sf.chat({
      model,
      messages: [{ role: 'user', content: '只回复两个字：正常' }],
      maxTokens: 32,
      json: false,
      temperature: 0
    });
    // 测通了就把新 Key 落盘。原来只在失败时回滚、成功时只留在内存里，
    // 结果界面显示"已保存"、重启后 Key 却没了。
    store.persist(10);
    return { ok: true, message: '连接成功，模型回复：' + String(content).trim().slice(0, 30) };
  } catch (e) {
    if (body.apiKey) d.settings.apiKey = backupKey;
    if (body.baseUrl) d.settings.baseUrl = backupUrl;
    throw e;
  }
});

route('POST', /^\/api\/recognize$/, async (ctx) => {
  const body = ctx.body || {};
  const images = Array.isArray(body.images) ? body.images : (body.image ? [body.image] : []);
  if (!images.length) throw Object.assign(new Error('请先添加图片'), { statusCode: 400 });
  const keep = body.keepImage !== false;
  const savedUrls = images.map((d) => (keep ? persistDataUrl(d) : ''));
  const hint = {
    subject: String(body.subject || '').trim(),
    grade: String(body.grade || '').trim()
  };
  const questions = await sf.recognize({ images, mode: body.mode || 'single', hint });
  const primaryImage = savedUrls[0] || '';
  return questions.map((q) => Object.assign({}, q, {
    id: uid('q'),
    // 图形框选坐标以原图为基准，前端按 figures.bbox 从原图裁剪成独立图片
    image: q.hasImage ? primaryImage : '',
    sourceImage: primaryImage,
    fromImage: primaryImage,
    figures: (q.figures || []).map((f) => Object.assign({ id: uid('fig') }, f))
  }));
});

/** 文本拆题：JSON 题卡、PDF / MD 文档导入都走这里，比逐张识图便宜很多 */
route('POST', /^\/api\/questions\/parse-text$/, async (ctx) => {
  const body = ctx.body || {};
  const hint = { subject: String(body.subject || '').trim(), grade: String(body.grade || '').trim() };
  const r = await sf.parseTextQuestions({ text: body.text, hint });
  const questions = r.questions.map((q) => Object.assign({}, q, {
    id: uid('q'),
    figures: (q.figures || []).map((f) => Object.assign({ id: uid('fig') }, f))
  }));
  return { questions, truncated: r.truncated };
});

/** 举一反三：按原题生成变式题 */
route('POST', /^\/api\/questions\/similar$/, async (ctx) => {
  const body = ctx.body || {};
  if (!String(body.stem || '').trim()) throw Object.assign(new Error('题干为空'), { statusCode: 400 });
  const list = await sf.similarQuestions({
    stem: body.stem,
    options: body.options || [],
    knowledge: body.knowledge || [],
    count: body.count
  });
  return list.map((q) => Object.assign({}, q, { id: uid('q'), similarOf: body.id || '' }));
});

route('POST', /^\/api\/solve$/, async (ctx) => {
  const body = ctx.body || {};
  if (!String(body.stem || '').trim()) throw Object.assign(new Error('题干为空'), { statusCode: 400 });
  return sf.solve({ stem: body.stem, options: body.options || [] });
});

route('POST', /^\/api\/upload$/, async (ctx) => {
  const url = persistDataUrl((ctx.body || {}).dataUrl);
  if (!url) throw Object.assign(new Error('图片格式不支持'), { statusCode: 400 });
  return { url };
});

/* ---------- 图库：跨题目复用的图形 ---------- */
function cleanGalleryItem(raw, old) {
  const base = old || { id: uid('g'), createdAt: Date.now() };
  const url = String(raw.url || base.url || '').trim();
  if (!url) throw Object.assign(new Error('图片地址为空'), { statusCode: 400 });
  return {
    id: base.id,
    url,
    label: String(raw.label == null ? base.label || '' : raw.label).trim().slice(0, 40),
    tags: Array.isArray(raw.tags)
      ? raw.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8)
      : (base.tags || []),
    createdAt: base.createdAt
  };
}

route('POST', /^\/api\/gallery$/, async (ctx) => {
  const d = store.db();
  const body = ctx.body || {};
  const url = body.dataUrl ? persistDataUrl(body.dataUrl) : String(body.url || '').trim();
  const item = cleanGalleryItem({ url, label: body.label, tags: body.tags });
  d.gallery.unshift(item);
  store.persist(10);
  return item;
});

route('PUT', /^\/api\/gallery\/([\w-]+)$/, async (ctx) => {
  const d = store.db();
  const i = d.gallery.findIndex((x) => x.id === ctx.params[0]);
  if (i < 0) throw Object.assign(new Error('图库图片不存在'), { statusCode: 404 });
  d.gallery[i] = cleanGalleryItem(ctx.body || {}, d.gallery[i]);
  store.persist(10);
  return d.gallery[i];
});

route('DELETE', /^\/api\/gallery\/([\w-]+)$/, async (ctx) => {
  const d = store.db();
  const i = d.gallery.findIndex((x) => x.id === ctx.params[0]);
  if (i < 0) throw Object.assign(new Error('图库图片不存在'), { statusCode: 404 });
  d.gallery.splice(i, 1);
  store.persist(10);
  return { total: d.gallery.length };
});

/** 导出 Word：题干转纯文本，图形按 /uploads 读盘后作为图片嵌进 docx */
route('POST', /^\/api\/export\/docx$/, async (ctx) => {
  const body = ctx.body || {};
  const list = Array.isArray(body.questions) ? body.questions : [];
  if (!list.length) throw Object.assign(new Error('没有可导出的题目'), { statusCode: 400 });
  const blocks = [];
  const title = String(body.title || '试卷').trim();
  if (body.school) blocks.push({ text: body.school, size: 11, align: 'center', spaceAfter: 40 });
  blocks.push({ text: title, size: 16, bold: true, align: 'center', spaceAfter: 60 });
  if (body.subtitle) blocks.push({ text: body.subtitle, size: 10.5, align: 'center', spaceAfter: 160 });
  if (body.studentInfo) {
    blocks.push({ text: '班级：__________　姓名：__________　学号：__________　得分：__________', size: 10.5, spaceAfter: 200 });
  }

  function imageBlock(url, hint) {
    if (!url || url.indexOf('/uploads/') !== 0) return null;
    const file = store.uploadPath(url.slice('/uploads/'.length));
    if (!fs.existsSync(file)) return null;
    const ext = path.extname(file).slice(1).toLowerCase() || 'png';
    const data = fs.readFileSync(file);
    // 必须带上真实尺寸：不给的话 docx 一律按 300×200 渲染，几何图会被压成扁条
    const size = (hint && hint.width > 0 && hint.height > 0) ? hint : imageSize(data);
    return { image: { data, ext, width: size.width, height: size.height }, align: 'center', spaceAfter: 100 };
  }

  list.forEach((q, i) => {
    const no = q.no || String(i + 1);
    const html = String(q.stemHtml || '');
    const stem = htmlToText(html) || String(q.stem || '');
    blocks.push({ text: no + '. ' + stem.replace(/\s+/g, ' ').trim() + (q.type ? '（' + q.type + '）' : ''), size: 11, spaceAfter: 60 });

    // 题干 HTML 里的内嵌图先抽出来，题干文字之后再统一嵌图（Word 不认 HTML 里的 <img>）
    const inline = [];
    const re = /<img[^>]*src="([^"]+)"[^>]*>/gi;
    let m;
    while ((m = re.exec(html))) inline.push(m[1]);
    // 图形库里的图带着记录过的尺寸，优先用；题干内嵌图则现读文件头判断
    const figureUrls = (q.figures || []).map((f) => ({ url: f.url || f.src || '', hint: { width: f.width, height: f.height } })).filter((f) => f.url);
    const seen = new Set();
    for (const item of inline.map((url) => ({ url, hint: null })).concat(figureUrls)) {
      if (!item.url || seen.has(item.url)) continue;
      seen.add(item.url);
      const b = imageBlock(item.url, item.hint);
      if (b) blocks.push(b);
    }

    for (const o of q.options || []) blocks.push({ text: '　　' + o.key + '. ' + o.text, size: 10.5, spaceAfter: 30 });
    if (!(q.options || []).length && body.answerLines !== 0) {
      blocks.push({ text: '　\n'.repeat(Number(body.answerLines) || 2), size: 11, spaceAfter: 80 });
    }
  });
  if (body.withAnswer) {
    blocks.push({ text: '参考答案与解析', size: 13, bold: true, spaceAfter: 100 });
    list.forEach((q, i) => {
      const no = q.no || String(i + 1);
      blocks.push({ text: no + '. ' + (q.answer || '（略）'), size: 11, spaceAfter: 40 });
      if (q.analysis) blocks.push({ text: q.analysis, size: 10.5, spaceAfter: 100 });
    });
  }
  const buf = docx.buildDocx(blocks);
  return { filename: title.replace(/[\\/:*?"<>|]/g, '') + '.docx', base64: buf.toString('base64') };
});

route('POST', /^\/api\/import\/docx$/, async (ctx) => {
  const body = ctx.body || {};
  if (!body.base64) throw Object.assign(new Error('没有收到文件内容'), { statusCode: 400 });
  const buf = Buffer.from(String(body.base64).replace(/^data:[^,]+,/, ''), 'base64');
  const paras = docx.docxToParagraphs(buf);
  return { paragraphs: paras, text: docx.paragraphsToText(paras), count: paras.length };
});

route('POST', /^\/api\/lecture\/organize$/, async (ctx) => {
  const body = ctx.body || {};
  if (!String(body.text || '').trim()) throw Object.assign(new Error('讲义内容为空'), { statusCode: 400 });
  return sf.organizeLecture({ text: body.text });
});

const QUESTION_TEXT_FIELDS = [
  'type', 'difficulty', 'subject', 'grade',
  'source', 'folderId', 'image', 'chapter', 'region', 'year', 'no', 'material'
];

/**
 * 题卡里的内嵌图片（base64 data URI）在保存时解码落盘，
 * 题卡里只留 /uploads/xxx，db.json 不会被 base64 撑爆。
 */
const DATA_URL_RE = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i;
const MAX_INLINE_IMAGE = 3 * 1024 * 1024;   // base64 字符上限，约 2.2MB 原图

/** 从图片字节里读宽高，导出 Word 时要靠它算图片尺寸 */
function imageSize(buf) {
  try {
    if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {   // PNG
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (buf.length > 10 && buf.slice(0, 3).toString('latin1') === 'GIF') {   // GIF
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {   // JPEG
      let off = 2;
      while (off + 9 < buf.length) {
        if (buf[off] !== 0xff) { off++; continue; }
        const marker = buf[off + 1];
        const len = buf.readUInt16BE(off + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: buf.readUInt16BE(off + 7), height: buf.readUInt16BE(off + 5) };
        }
        off += 2 + len;
      }
    }
  } catch (e) { /* 读不出就当没有尺寸 */ }
  return { width: 0, height: 0 };
}

/**
 * 把 base64 data URI 解码存到 uploads/，返回本地路径；
 * 不是 data URI 或解码失败时原样返回。
 */
function materializeInlineImage(url) {
  if (!url || !/^data:/i.test(url)) return { url: url, width: 0, height: 0 };
  const m = DATA_URL_RE.exec(url);
  if (!m) return { url: '', width: 0, height: 0 };
  const b64 = url.slice(m[0].length).replace(/\s+/g, '');
  if (!b64 || b64.length > MAX_INLINE_IMAGE) return { url: '', width: 0, height: 0 };
  let buf;
  try { buf = Buffer.from(b64, 'base64'); } catch (e) { return { url: '', width: 0, height: 0 }; }
  if (!buf.length) return { url: '', width: 0, height: 0 };
  const type = m[1].toLowerCase();
  const ext = type === 'jpeg' ? 'jpg' : type;
  try {
    const local = store.saveImage(buf, ext);
    const size = imageSize(buf);
    return { url: local, width: size.width, height: size.height };
  } catch (e) {
    return { url: '', width: 0, height: 0 };
  }
}

function cleanFigure(f, i) {
  if (!f || typeof f !== 'object') return null;
  let url = String(f.url || '').trim();
  let src = String(f.src || '').trim();
  let width = Number(f.width) || 0;
  let height = Number(f.height) || 0;

  // 内嵌图片：解码落盘，换成本地路径
  if (/^data:/i.test(url)) {
    const r = materializeInlineImage(url);
    url = r.url; src = '';
    if (r.width) { width = r.width; height = r.height; }
  } else if (/^data:/i.test(src)) {
    const r = materializeInlineImage(src);
    src = r.url; url = '';
    if (r.width) { width = r.width; height = r.height; }
  }

  const desc = String(f.desc || '').slice(0, 120);
  // 只有文字描述没有图片的图形（例如 Skill 只给了 label+desc）也要留住，别整条丢掉
  if (!url && !src && !desc) return null;
  return {
    id: String(f.id || uid('fig')),
    label: String(f.label || ('图' + (i + 1))).slice(0, 12),
    desc,
    url,
    src,
    bbox: Array.isArray(f.bbox) ? f.bbox.slice(0, 4).map(Number) : null,
    width,
    height
  };
}

/**
 * 题干既可以纯文本也可以富文本：stemHtml 存编辑器产出的 HTML（白名单净化），
 * stem 始终保留一份纯文本，供搜索、模型调用和旧界面使用。
 */
function applyStem(q, raw) {
  const html = sanitizeRichHtml(raw.stemHtml || '');
  const plainFromHtml = htmlToText(html);
  const plain = String(raw.stem == null ? '' : raw.stem).trim() || plainFromHtml;
  q.stem = plain;
  // 纯图片题干（一个文字都没有、只有一张图）也要留住：
  // 原来用 htmlToText(html) 判空，没有文字就被整条丢弃，题看着存上了其实没存。
  const hasImg = /<img\b/i.test(html);
  q.stemHtml = html && (plainFromHtml || hasImg) ? html : '';
  return q;
}

/** 把前端提交的题目整理成统一的存储结构，避免各接口字段漂移 */
function normalizeQuestionPayload(raw, fallbackFolder) {
  const out = {};
  for (const k of QUESTION_TEXT_FIELDS) out[k] = String(raw[k] == null ? '' : raw[k]).trim();
  applyStem(out, raw);
  out.answer = String(raw.answer == null ? '' : raw.answer).trim();
  out.analysis = String(raw.analysis == null ? '' : raw.analysis).trim();
  out.options = Array.isArray(raw.options)
    ? raw.options.map((o, i) => ({
      key: String((o && o.key) || String.fromCharCode(65 + i)).slice(0, 2),
      text: String((o && o.text) || '').trim()
    })).filter((o) => o.text)
    : [];
  out.knowledge = Array.isArray(raw.knowledge)
    ? raw.knowledge.map((k) => String(k).trim()).filter(Boolean).slice(0, 10)
    : [];
  out.tags = Array.isArray(raw.tags)
    ? raw.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 12)
    : [];
  out.figures = (Array.isArray(raw.figures) ? raw.figures : []).map(cleanFigure).filter(Boolean).slice(0, 8);
  if (!out.type) out.type = '其他';
  out.difficulty = normDifficulty(out.difficulty);
  out.favorite = raw.favorite ? 1 : 0;
  out.mastery = normMastery(raw.mastery);
  out.viewCount = Math.max(0, Number(raw.viewCount) || 0);
  out.folderId = out.folderId || fallbackFolder;
  return out;
}

route('POST', /^\/api\/questions\/save$/, async (ctx) => {
  const d = store.db();
  const body = ctx.body || {};
  const list = Array.isArray(body.questions) ? body.questions : [];
  const folderId = body.folderId || (d.folders[0] && d.folders[0].id) || 'f_default';
  let added = 0;
  let skipped = 0;
  const now = Date.now();
  for (const raw of list) {
    const q = normalizeQuestionPayload(raw || {}, folderId);
    // 纯图片题（没有文字、只有图）也是一道题，不能当成空题丢掉
    if (!q.stem && !q.stemHtml) { skipped++; continue; }
    const dup = d.questions.find((x) => x.stem === q.stem && (x.answer || '') === q.answer);
    if (dup && !body.allowDuplicate) { skipped++; continue; }
    d.questions.push(Object.assign({}, q, {
      id: raw.id || uid('q'),
      createdAt: raw.createdAt || now,
      updatedAt: now
    }));
    added++;
  }
  store.persist(10);
  return { added, skipped, total: d.questions.length };
});

route('PUT', /^\/api\/questions\/([\w-]+)$/, async (ctx) => {
  const d = store.db();
  const q = d.questions.find((x) => x.id === ctx.params[0]);
  if (!q) throw Object.assign(new Error('题目不存在'), { statusCode: 404 });
  const body = ctx.body || {};
  for (const k of QUESTION_TEXT_FIELDS) {
    if (typeof body[k] === 'string') q[k] = body[k];
  }
  if (typeof body.stemHtml === 'string' || typeof body.stem === 'string') {
    applyStem(q, {
      stem: typeof body.stem === 'string' ? body.stem : q.stem,
      stemHtml: typeof body.stemHtml === 'string' ? body.stemHtml : q.stemHtml
    });
  }
  if (typeof body.answer === 'string') q.answer = body.answer.trim();
  if (typeof body.analysis === 'string') q.analysis = body.analysis.trim();
  if (Array.isArray(body.options)) {
    q.options = body.options.map((o, i) => ({
      key: String((o && o.key) || String.fromCharCode(65 + i)).slice(0, 2),
      text: String((o && o.text) || '').trim()
    })).filter((o) => o.text);
  }
  if (Array.isArray(body.knowledge)) q.knowledge = body.knowledge.map((k) => String(k).trim()).filter(Boolean).slice(0, 10);
  if (Array.isArray(body.tags)) q.tags = body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 12);
  if (Array.isArray(body.figures)) q.figures = body.figures.map(cleanFigure).filter(Boolean).slice(0, 8);
  if (typeof body.favorite !== 'undefined') q.favorite = body.favorite ? 1 : 0;
  if (typeof body.mastery !== 'undefined') q.mastery = normMastery(body.mastery);
  if (!q.type) q.type = '其他';
  q.difficulty = normDifficulty(q.difficulty);
  if (typeof q.viewCount !== 'number') q.viewCount = 0;
  q.updatedAt = Date.now();
  store.persist(10);
  return q;
});

/**
 * 题目标记：收藏 / 掌握度 / 浏览次数。
 * 前端列表里点星标、点掌握度标签走这个接口，不用整题提交。
 */
route('POST', /^\/api\/questions\/([\w-]+)\/meta$/, async (ctx) => {
  const d = store.db();
  const q = d.questions.find((x) => x.id === ctx.params[0]);
  if (!q) throw Object.assign(new Error('题目不存在'), { statusCode: 404 });
  const body = ctx.body || {};
  if (typeof body.favorite !== 'undefined') q.favorite = body.favorite ? 1 : 0;
  if (typeof body.mastery !== 'undefined') q.mastery = normMastery(body.mastery);
  if (body.view) {
    q.viewCount = (Number(q.viewCount) || 0) + 1;
    q.lastViewedAt = Date.now();
  }
  q.updatedAt = Date.now();
  store.persist(60);
  return { id: q.id, favorite: q.favorite || 0, mastery: q.mastery || '', viewCount: q.viewCount || 0 };
});

/** 批量改属性：题型、难度、学科、年级、题库、增删知识点/标签 */
route('POST', /^\/api\/questions\/bulk-update$/, async (ctx) => {
  const d = store.db();
  const body = ctx.body || {};
  const ids = new Set(Array.isArray(body.ids) ? body.ids : []);
  if (!ids.size) throw Object.assign(new Error('请先勾选题目'), { statusCode: 400 });
  const patch = body.patch || {};
  const addKnowledge = (patch.addKnowledge || []).map((k) => String(k).trim()).filter(Boolean);
  const addTags = (patch.addTags || []).map((t) => String(t).trim()).filter(Boolean);
  let changed = 0;
  for (const q of d.questions) {
    if (!ids.has(q.id)) continue;
    for (const k of ['type', 'difficulty', 'subject', 'grade', 'folderId', 'source', 'year', 'region', 'chapter']) {
      if (typeof patch[k] === 'string' && patch[k].trim()) q[k] = patch[k].trim();
    }
    if (patch.difficulty) q.difficulty = normDifficulty(q.difficulty);
    if (typeof patch.favorite !== 'undefined') q.favorite = patch.favorite ? 1 : 0;
    if (typeof patch.mastery !== 'undefined') q.mastery = normMastery(patch.mastery);
    if (addKnowledge.length) {
      const set = new Set(q.knowledge || []);
      addKnowledge.forEach((k) => set.add(k));
      q.knowledge = Array.from(set).slice(0, 10);
    }
    if (addTags.length) {
      const set = new Set(q.tags || []);
      addTags.forEach((t) => set.add(t));
      q.tags = Array.from(set).slice(0, 12);
    }
    q.updatedAt = Date.now();
    changed++;
  }
  store.persist(10);
  return { changed };
});

route('DELETE', /^\/api\/questions\/([\w-]+)$/, async (ctx) => {
  const d = store.db();
  const i = d.questions.findIndex((x) => x.id === ctx.params[0]);
  if (i < 0) throw Object.assign(new Error('题目不存在'), { statusCode: 404 });
  d.questions.splice(i, 1);
  store.persist(10);
  return { total: d.questions.length };
});

route('POST', /^\/api\/questions\/bulk-delete$/, async (ctx) => {
  const d = store.db();
  const ids = new Set((ctx.body || {}).ids || []);
  const before = d.questions.length;
  d.questions = d.questions.filter((q) => !ids.has(q.id));
  store.persist(10);
  return { removed: before - d.questions.length, total: d.questions.length };
});

/** 题库（文件夹）：支持父子级和标签 */
function cleanFolderInput(d, body, selfId) {
  const name = String(body.name || '').trim();
  if (!name) throw Object.assign(new Error('请输入题库名称'), { statusCode: 400 });
  let parentId = String(body.parentId || '').trim();
  if (parentId === selfId) parentId = '';
  if (parentId && !d.folders.some((f) => f.id === parentId)) parentId = '';
  // 不能把题库挂到自己的子孙下面：一旦成环，这几个题库在界面上会彻底消失
  if (parentId && isDescendant(d, parentId, selfId)) {
    throw Object.assign(new Error('不能把题库移到它自己的下级里，会形成循环'), { statusCode: 400 });
  }
  const tags = (Array.isArray(body.tags) ? body.tags : String(body.tags || '').split(/[,，、;；\s]+/))
    .map((t) => String(t).trim()).filter(Boolean).slice(0, 12);
  return { name, parentId, tags };
}

/** candidate 是否是 ancestorId 的后代（含自己）：用于阻止题库成环 */
function isDescendant(d, candidateId, ancestorId) {
  if (!candidateId || !ancestorId) return false;
  const byId = new Map(d.folders.map((f) => [f.id, f]));
  let pid = candidateId;
  const seen = new Set();
  while (pid) {
    if (pid === ancestorId) return true;
    if (seen.has(pid)) return false; // 已经是环，视为不是后代（下面统一纠环）
    seen.add(pid);
    const parent = byId.get(pid);
    if (!parent) return false;
    pid = parent.parentId || '';
  }
  return false;
}

/** 把题库父子关系里的环解开：出现环的题库提到顶层，保证界面上都还能看到 */
function repairFolderTree(folders) {
  const list = Array.isArray(folders) ? folders : [];
  const byId = new Map(list.map((f) => [f.id, f]));
  for (const f of list) {
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
  return list;
}

route('POST', /^\/api\/folders$/, async (ctx) => {
  const d = store.db();
  const body = ctx.body || {};
  const input = cleanFolderInput(d, body, '');
  const f = { id: uid('f'), name: input.name, parentId: input.parentId, tags: input.tags, createdAt: Date.now() };
  d.folders.push(f);
  store.persist(10);
  return f;
});

route('PUT', /^\/api\/folders\/([\w-]+)$/, async (ctx) => {
  const d = store.db();
  const f = d.folders.find((x) => x.id === ctx.params[0]);
  if (!f) throw Object.assign(new Error('题库不存在'), { statusCode: 404 });
  const body = ctx.body || {};
  if (body.name !== undefined || body.parentId !== undefined || body.tags !== undefined) {
    const input = cleanFolderInput(d, { name: body.name !== undefined ? body.name : f.name, parentId: body.parentId !== undefined ? body.parentId : f.parentId, tags: body.tags !== undefined ? body.tags : f.tags }, f.id);
    f.name = input.name;
    f.parentId = input.parentId;
    f.tags = input.tags;
  }
  store.persist(10);
  return f;
});

route('DELETE', /^\/api\/folders\/([\w-]+)$/, async (ctx) => {
  const d = store.db();
  const id = ctx.params[0];
  if (d.folders.length <= 1) throw Object.assign(new Error('至少要保留一个题库'), { statusCode: 400 });
  const victim = d.folders.find((f) => f.id === id);
  if (!victim) throw Object.assign(new Error('题库不存在'), { statusCode: 404 });
  d.folders = d.folders.filter((f) => f.id !== id);
  // 子题库不级联删除，提升到被删题库的父级，避免误删一整棵树
  d.folders.forEach((f) => { if (f.parentId === id) f.parentId = victim.parentId || ''; });
  const fallback = d.folders[0].id;
  d.questions.forEach((q) => { if (q.folderId === id) q.folderId = fallback; });
  store.persist(10);
  return { folders: d.folders };
});

route('POST', /^\/api\/lectures\/save$/, async (ctx) => {
  const d = store.db();
  const body = ctx.body || {};
  const now = Date.now();
  let lec = d.lectures.find((l) => l.id === body.id);
  const payload = {
    title: String(body.title || '未命名讲义').trim(),
    subject: String(body.subject || '').trim(),
    grade: String(body.grade || '').trim(),
    sections: Array.isArray(body.sections) ? body.sections : [],
    config: body.config || {},
    updatedAt: now
  };
  if (lec) Object.assign(lec, payload);
  else {
    lec = Object.assign({ id: uid('l'), createdAt: now }, payload);
    d.lectures.push(lec);
  }
  store.persist(10);
  return lec;
});

route('GET', /^\/api\/lectures\/([\w-]+)$/, async (ctx) => {
  const d = store.db();
  const l = d.lectures.find((x) => x.id === ctx.params[0]);
  if (!l) throw Object.assign(new Error('讲义不存在'), { statusCode: 404 });
  return l;
});

route('DELETE', /^\/api\/lectures\/([\w-]+)$/, async (ctx) => {
  const d = store.db();
  d.lectures = d.lectures.filter((x) => x.id !== ctx.params[0]);
  store.persist(10);
  return { total: d.lectures.length };
});

route('GET', /^\/api\/stats$/, async () => buildStats(store.db()));

/**
 * 题卡 Skill 包：把 public/skills 下的文件打成一个 zip 给用户下载，
 * 装到外部智能体里让它把材料转成本系统的题卡 JSON（省掉平台模型额度）。
 */
route('GET', /^\/api\/skill\/tiku-json\.zip$/, async (ctx) => {
  const dir = path.join(PUBLIC_DIR, 'skills', 'tiku-json');
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort()
    : [];
  if (!files.length) throw Object.assign(new Error('Skill 文件缺失，请重新安装程序'), { statusCode: 404 });
  const zip = buildZip(files.map((f) => ({
    name: 'tiku-json/' + f,
    data: fs.readFileSync(path.join(dir, f))
  })));
  ctx.res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Length': zip.length,
    'Content-Disposition': 'attachment; filename="tiku-json.zip"',
    'Cache-Control': 'no-store'
  });
  ctx.res.end(zip);
});

route('GET', /^\/api\/export\/all$/, async () => {
  const d = store.db();
  return {
    exportedAt: new Date().toISOString(),
    questions: d.questions, lectures: d.lectures, folders: d.folders, gallery: d.gallery
  };
});

route('POST', /^\/api\/import\/all$/, async (ctx) => {
  const body = ctx.body || {};
  if (!Array.isArray(body.questions)) throw Object.assign(new Error('备份文件格式不对'), { statusCode: 400 });
  const d = store.db();
  // 整库替换前先留一份现场，误操作还能找回
  const safety = store.safetyBackup('before-restore');
  if (Array.isArray(body.folders) && body.folders.length) {
    d.folders = repairFolderTree(body.folders);
  }
  // 备份文件必须重新走一遍富文本白名单：备份可能来自别处或被人改过，
  // 直接把 stemHtml 塞进库里，界面 v-html 渲染时就会执行脚本（存储型 XSS）。
  const folderId = (d.folders[0] && d.folders[0].id) || 'f_default';
  d.questions = body.questions.map((raw) => {
    const r = raw || {};
    const q = normalizeQuestionPayload(r, folderId);
    q.id = String(r.id || uid('q'));
    q.createdAt = r.createdAt || Date.now();
    q.updatedAt = r.updatedAt || q.createdAt;
    return q;
  });
  d.lectures = Array.isArray(body.lectures) ? body.lectures : [];
  if (Array.isArray(body.gallery)) d.gallery = body.gallery;
  d.usage = Array.isArray(body.usage) ? body.usage : d.usage;
  store.persist(10);
  store.clearCorrupt();
  return { questions: d.questions.length, lectures: d.lectures.length, safetyBackup: safety };
});

route('POST', /^\/api\/backup$/, async () => {
  store.flushNow();
  store.dailyBackup();
  return { ok: true, dir: path.join(store.DATA_DIR, 'backup') };
});

/* ---------------- 服务器 ---------------- */

const server = http.createServer((req, res) => {
  // 整个请求处理都放进 handle：静态资源分支以前在 try 之外，
  // 一旦抛异常（比如畸形百分号编码）响应永远发不出去，浏览器就一直转圈。
  handleRequest(req, res).catch((e) => {
    console.error('[请求错误] ' + (req.method || '') + ' ' + (req.url || '') + ' → ' + (e && e.message));
    if (!res.writableEnded) {
      try { fail(res, e); } catch (_) { try { res.end(); } catch (_) {} }
    }
  });
});

async function handleRequest(req, res) {
  const startedAt = Date.now();
  const url = new URL(req.url, 'http://' + (req.headers.host || HOST));
  const pathname = url.pathname;

  // 只允许本机访问
  const remote = req.socket.remoteAddress || '';
  if (!/^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/.test(remote)) {
    return send(res, 403, { ok: false, message: '仅允许本机访问' });
  }

  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  const matched = routes.filter((r) => r.method === req.method && r.pattern.test(pathname));
  if (!matched.length) return send(res, 404, { ok: false, message: '接口不存在：' + pathname });

  const ctx = { req, res, params: pathname.match(matched[0].pattern).slice(1), query: url.searchParams };
  if (req.method !== 'GET') ctx.body = await readBody(req);
  const data = await matched[0].handler(ctx);
  if (!res.writableEnded) ok(res, data);
  const ms = Date.now() - startedAt;
  if (ms > 1500) console.log('[慢] ' + req.method + ' ' + pathname + ' ' + ms + 'ms');
}

function openBrowser(url) {
  if (NO_OPEN) return;
  try {
    const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: true });
    child.unref();
  } catch (_) { /* 打不开就算了，链接已经打印出来了 */ }
}

function probeRunning(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port, path: '/api/ping', timeout: 2500 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')).data.app === 'tiku-lecture'); }
        catch (_) { resolve(false); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

/** 在端口区间里找出已经在跑的实例（用于重复启动时直接打开它的页面） */
async function findRunningInstance() {
  for (let p = PORT_START; p < PORT_START + 10; p++) {
    if (await probeRunning(p)) return 'http://' + HOST + ':' + p;
  }
  return '';
}

/* ---- 运行锁：同一数据目录只允许一个实例写入 ---- */

/**
 * 启动服务。
 * 直接双击运行时（本文件是主模块）自动调用；
 * 被 Electron 加载时由主进程调用 boot({ noOpen: true })，返回值告诉它实际端口。
 */
async function boot(options) {
  const o = options || {};
  const noOpen = !!(o.noOpen || NO_OPEN);
  const lock = store.acquireLock();
  if (!lock.ok) {
    const url = await findRunningInstance();
    console.log('');
    console.log('  程序已经在运行（数据目录正被进程 ' + lock.pid + ' 使用）' + (url ? '：' + url : ''));
    if (noOpen) {
      if (o.onAlreadyRunning) o.onAlreadyRunning(url);
      return { status: 'already-running', url: url, port: 0 };
    }
    if (url) openBrowser(url);
    console.log('  没有同时启动第二个，避免两边同时写数据。');
    console.log('');
    process.exit(0);
    return { status: 'already-running', url: url, port: 0 };
  }
  const port = await listen(PORT_START, 0, { noOpen: noOpen, quiet: !!o.quiet });
  return { status: port ? 'started' : 'already-running', port: port, url: port ? ('http://' + HOST + ':' + port) : '' };
}

function listen(port, attempt, options) {
  const o = options || {};
  return new Promise((resolve, reject) => {
    server.once('error', async (e) => {
      if (e.code === 'EADDRINUSE' && attempt < 10) {
        // 已经开过一份：直接把页面打开，不再启动第二个进程，避免两边同时写数据
        if (await probeRunning(port)) {
          console.log('\n  程序已经在运行，正在为你打开页面：http://' + HOST + ':' + port + '\n');
          if (!o.noOpen) {
            openBrowser('http://' + HOST + ':' + port);
            setTimeout(() => process.exit(0), 800);
          }
          resolve(0);
          return;
        }
        console.log('端口 ' + port + ' 已被占用，换用 ' + (port + 1));
        resolve(await listen(port + 1, attempt + 1, o));
        return;
      }
      console.error('启动失败：' + e.message);
      if (o.noOpen) { reject(e); return; }
      process.exit(1);
    });
    server.listen(port, HOST, () => {
      const url = 'http://' + HOST + ':' + port;
      store.dailyBackup();
      // 程序连续开着跨天时也要留下当天的备份，不能只在启动时打一次
      store.startAutoBackup();
      if (!o.quiet) {
        console.log('');
        console.log('  ┌────────────────────────────────────────────┐');
        console.log('  │   题库与讲义系统 · 个人版  已启动          │');
        console.log('  └────────────────────────────────────────────┘');
        console.log('  浏览器会自动打开；没打开就手动访问：' + url);
        console.log('  数据目录：' + store.DATA_DIR);
        console.log('  用完直接关掉这个黑色窗口就行，数据已自动保存');
        console.log('');
      }
      if (!o.noOpen) openBrowser(url);
      resolve(port);
    });
  });
}

process.on('SIGINT', () => {
  console.log('\n正在保存数据…');
  store.flushNow();
  store.releaseLock();
  process.exit(0);
});
process.on('SIGTERM', () => {
  store.flushNow();
  store.releaseLock();
  process.exit(0);
});
process.on('exit', () => { store.releaseLock(); });
process.on('uncaughtException', (e) => {
  console.error('[未捕获异常] ' + (e && e.message));
  console.error('  程序会继续运行，但请留意这个问题；如果界面已经异常，可以关掉重开。');
});
process.on('unhandledRejection', (e) => {
  console.error('[未处理的异步错误] ' + (e && e.message));
});

store.db();

/**
 * 直接运行（双击 exe / node server.js）时自动启动；
 * 被 Electron 主进程加载时（TIKU_EMBEDDED=1）由主进程调用 boot()，
 * 否则会开两个服务、抢同一个端口。
 */
if (!process.env.TIKU_EMBEDDED) {
  boot();
}

module.exports = { boot, server, HOST };
