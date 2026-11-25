'use strict';
const crypto = require('crypto');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
  '.map': 'application/json; charset=utf-8'
};

function mimeOf(p) {
  const i = String(p).lastIndexOf('.');
  return MIME[String(p).slice(i).toLowerCase()] || 'application/octet-stream';
}

function sha1(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const max = limit || 20 * 1024 * 1024;
    let size = 0;
    let over = false;
    const chunks = [];
    req.on('data', (c) => {
      if (over) return;
      size += c.length;
      if (size > max) {
        over = true;
        // 不能直接 destroy：那样客户端只拿到连接重置，看不到"内容太大"这个原因。
        // 这里停止收数据，把 413 交给上层正常返回。
        req.pause();
        reject(Object.assign(new Error('请求内容过大（上限 ' + Math.round(max / 1024 / 1024) + 'MB），请分批处理'), { statusCode: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      if (!raw.length) return resolve({});
      const text = raw.toString('utf8');
      try {
        return resolve(JSON.parse(text));
      } catch (e) {
        // 本程序所有接口都收 JSON；不是合法 JSON 就明确报错，不要当成空对象糊弄过去
        const type = String(req.headers['content-type'] || '');
        const hint = type && !type.includes('application/json') ? '（期望 application/json）' : '';
        reject(Object.assign(new Error('请求内容格式不正确' + hint), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body, headers) {
  const h = Object.assign({ 'Cache-Control': 'no-store' }, headers || {});
  let payload;
  if (Buffer.isBuffer(body)) {
    payload = body;
  } else if (typeof body === 'string') {
    payload = Buffer.from(body, 'utf8');
    h['Content-Type'] = h['Content-Type'] || 'text/plain; charset=utf-8';
  } else {
    payload = Buffer.from(JSON.stringify(body), 'utf8');
    h['Content-Type'] = 'application/json; charset=utf-8';
  }
  h['Content-Length'] = payload.length;
  res.writeHead(status, h);
  res.end(payload);
}

function ok(res, data) {
  send(res, 200, { ok: true, data: data === undefined ? null : data });
}

function fail(res, err) {
  const status = (err && err.statusCode) || 500;
  const message = (err && err.message) || '服务处理失败';
  send(res, status, { ok: false, message });
}

/** 从模型回复里稳健地抽取 JSON（兼容 ```json 包裹、前后夹带说明文字） */
function extractJSON(text) {
  if (!text) throw new Error('模型没有返回内容');
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  if (s.startsWith('{') || s.startsWith('[')) {
    try { return JSON.parse(s); } catch (e) { /* 继续尝试截取 */ }
  }
  const start = s.search(/[{[]/);
  if (start < 0) throw new Error('模型返回内容不是有效数据，请重试');
  const end = matchEnd(s, start);
  if (end > start) {
    const slice = s.slice(start, end + 1);
    try { return JSON.parse(slice); } catch (e) { /* 落到统一报错 */ }
  }
  throw new Error('模型返回内容不完整，请重试');
}

/** 从 start 处的 { 或 [ 出发，返回与之配对的右括号下标；不配对返回 -1（正确处理嵌套与字符串） */
function matchEnd(s, start) {
  const stack = [s[start]];
  let inStr = false;
  let esc = false;
  for (let i = start + 1; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return -1;
      if (!stack.length) return i;
    }
  }
  return -1;
}

/**
 * 模型输出被 max_tokens 截断时的抢救：从后往前找完整的对象边界，补上缺失的括号再解析。
 * 宁可少给最后一节，也不要让用户整篇白等。
 */
function repairTruncatedJSON(text) {
  if (!text) return null;
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.search(/[{[]/);
  if (start < 0) return null;
  s = s.slice(start);

  const cuts = [];
  for (let i = s.length - 1; i > 0 && cuts.length < 300; i--) {
    if (s[i] === '}') cuts.push(i);
  }
  for (const cut of cuts) {
    const head = s.slice(0, cut + 1);
    const closers = pendingClosers(head);
    if (closers === null) continue;
    try {
      const j = JSON.parse(head + closers);
      if (j && typeof j === 'object') return j;
    } catch (e) { /* 换更靠前的切点 */ }
  }
  return null;
}

/** 返回闭合 head 里所有未闭合括号所需的字符串；遇到括号错配或字符串未闭合返回 null */
function pendingClosers(head) {
  const stack = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < head.length; i++) {
    const ch = head[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return null;
    }
  }
  if (inStr) return null;
  return stack.reverse().join('');
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * 题干富文本白名单净化：只保留排版类标签与安全属性。
 * 编辑器里插图形时用 <img src="/uploads/xxx">，因此 img 只允许本站 /uploads/ 路径。
 */
const RICH_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'sub', 'sup', 'br', 'span', 'div', 'p', 'img']);

/**
 * 行内样式白名单：只放行这几个排版属性，且每个值都要通过各自的格式校验。
 * 目的是让编辑器的 A+/A-（font-size）等字号设置保存后不丢，
 * 同时避免 style 成为新的注入面（url()、expression() 之类一律进不来）。
 */
const STYLE_PROPS = {
  'font-size': /^(?:\d{1,3}(?:\.\d+)?(?:px|pt|em|rem|%)?|smaller|larger|inherit)$/i,
  'color': /^(?:#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\([0-9,\s.%]{1,40}\))$/i,
  'background-color': /^(?:#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\([0-9,\s.%]{1,40}\))$/i,
  'font-weight': /^(?:normal|bold|bolder|lighter|[1-9]00)$/i,
  'font-style': /^(?:normal|italic|oblique)$/i,
  'text-align': /^(?:left|right|center|justify)$/i,
  'text-decoration': /^(?:none|underline|line-through|overline)$/i,
  'line-height': /^(?:\d{1,3}(?:\.\d+)?(?:px|pt|em|rem|%)?)$/i,
  'vertical-align': /^(?:baseline|top|middle|bottom|sub|super|text-top|text-bottom|[+-]?\d{1,3}(?:\.\d+)?%?)$/i
};

/** 从原始 style 串里挑出安全的属性值，非法的一律丢掉 */
function sanitizeStyle(raw) {
  if (!raw) return '';
  const out = [];
  const re = /([-a-zA-Z]+)\s*:\s*([^;]+)/g;
  let m;
  while ((m = re.exec(raw))) {
    const prop = m[1].trim().toLowerCase();
    const val = m[2].trim();
    const rule = STYLE_PROPS[prop];
    if (!rule) continue;
    if (!rule.test(val)) continue;
    out.push(prop + ':' + val);
    if (out.length >= 6) break;
  }
  return out.join(';');
}

/**
 * 图片只允许限制显示宽度（题图不能撑破版心），
 * 只认 px 数字，其它一律丢掉。
 */
function sanitizeImgStyle(raw) {
  if (!raw) return '';
  const out = [];
  const re = /(max-)?width\s*:\s*(\d{1,4})\s*px/gi;
  let m;
  while ((m = re.exec(raw))) {
    const v = Math.min(1200, Math.max(20, Number(m[2])));
    out.push((m[1] ? 'max-width' : 'width') + ':' + v + 'px');
    if (out.length >= 2) break;
  }
  const layout = /(?:^|;)\s*(display|margin-left|margin-top|max-width)\s*:\s*([^;]+)/gi;
  while ((m = layout.exec(raw))) {
    const prop = m[1].toLowerCase(), val = m[2].trim();
    if (prop === 'display' && val === 'block') out.push('display:block');
    if (/^margin-(left|top)$/.test(prop) && /^\d{1,4}px$/.test(val)) {
      out.push(prop + ':' + Math.min(2000, parseInt(val, 10)) + 'px');
    }
    if (prop === 'max-width' && /^calc\(100% - \d{1,4}px\)$/.test(val)) out.push(prop + ':' + val);
  }
  return out.join(';');
}

function sanitizeRichHtml(html) {
  if (!html) return '';
  let s = String(html);
  // 先去掉脚本/样式块整体
  s = s.replace(/<(script|style|iframe|object|embed|link|meta)[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<\/?(script|style|iframe|object|embed|link|meta)[^>]*>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');

  s = s.replace(/<([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g, (m, rawTag, rawAttrs) => {
    const tag = rawTag.toLowerCase();
    if (!RICH_TAGS.has(tag)) return '';
    if (tag === 'br') return '<br>';
    const attrs = [];
    if (tag === 'img') {
      const src = (rawAttrs.match(/\ssrc\s*=\s*("([^"]*)"|'([^']*)')/i) || []);
      const url = (src[2] || src[3] || '').trim();
      if (!/^\/uploads\/[A-Za-z0-9._-]+$/.test(url)) return '';
      attrs.push('src="' + url + '"');
      if (/\sdata-fig\s*=/.test(rawAttrs)) attrs.push('data-fig="1"');
      if (/\sdata-w\s*=/.test(rawAttrs)) {
        const w = Number((rawAttrs.match(/\sdata-w\s*=\s*"?(\d+)/) || [])[1]);
        if (w > 0 && w < 2000) attrs.push('data-w="' + w + '"');
      }
      // 题图显示宽度：只放行 max-width/width 的 px 数值
      const sty = (rawAttrs.match(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i) || []);
      const styleVal = sanitizeImgStyle(sty[2] || sty[3] || '');
      const freeX = rawAttrs.match(/\sdata-x\s*=\s*"(\d+(?:\.\d+)?)"/);
      if (freeX) {
        const x = Math.min(95, Number(freeX[1]));
        const y = Math.min(10000, Number((rawAttrs.match(/\sdata-y\s*=\s*"(\d+)"/) || [])[1]) || 0);
        const h = Math.min(2000, Number((rawAttrs.match(/\sdata-h\s*=\s*"(\d+)"/) || [])[1]) || 100);
        attrs.push('data-x="' + x + '"', 'data-y="' + y + '"', 'data-h="' + h + '"');
        const widthOnly = styleVal.split(';').filter((v) => /^width:/.test(v)).join(';');
        attrs.push('style="' + (widthOnly ? widthOnly + ';' : '') + 'position:absolute;left:' + x + '%;top:' + y + 'px;margin:0;display:block;max-width:' + (100-x) + '%"');
      } else if (styleVal) attrs.push('style="' + styleVal + '"');
      return '<img ' + attrs.join(' ') + '>';
    }
    if (tag === 'span' || tag === 'div' || tag === 'p') {
      const cls = (rawAttrs.match(/\sclass\s*=\s*("([^"]*)"|'([^']*)')/i) || []);
      const clsVal = (cls[2] || cls[3] || '').trim();
      if (clsVal && /^[A-Za-z0-9 _-]{1,60}$/.test(clsVal)) attrs.push('class="' + clsVal + '"');
      // 字号等排版属性要留下来，否则编辑器里 A+/A- 保存后就被丢掉
      const sty = (rawAttrs.match(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i) || []);
      const styleVal = sanitizeStyle(sty[2] || sty[3] || '');
      if (styleVal) attrs.push('style="' + styleVal + '"');
    }
    return '<' + tag + (attrs.length ? ' ' + attrs.join(' ') : '') + '>';
  });

  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g, (m, rawTag) => {
    const tag = rawTag.toLowerCase();
    if (!RICH_TAGS.has(tag)) return '';
    if (m.startsWith('</')) return '</' + tag + '>';
    return m;
  });

  // 只保留换行类标签，其余裸文本不处理
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/javascript:/gi, '');
  return s.slice(0, 20000).trim();
}

/** 富文本转纯文本，用于搜索与模型输入 */
function htmlToText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p)>/gi, '\n')
    .replace(/<img[^>]*data-fig[^>]*>/gi, ' [图] ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ---------------- 难度（5 档）与掌握度 ---------------- */

/** 难度 5 档：数值 1~5 对应下面这 5 个标签 */
const DIFFICULTIES = ['很简单', '简单', '中等', '较难', '很难'];

/** 掌握度：留空表示没标记 */
const MASTERY_LEVELS = ['生疏', '模糊', '掌握'];

/** 难度别名归一：老数据、模型输出、手工输入都能落到这 5 档里 */
const DIFF_ALIAS = {
  '很简单': '很简单', '容易': '简单', '基础': '很简单', '入门': '很简单',
  '简单': '简单', '较易': '简单', 'easy': '简单',
  '中等': '中等', '中': '中等', '一般': '中等', '适中': '中等', '普通': '中等', 'medium': '中等',
  '较难': '较难', '偏难': '较难', '难': '较难', 'hard': '较难',
  '很难': '很难', '困难': '很难', '极难': '很难', '特难': '很难'
};

function normDifficulty(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '中等';
  if (DIFFICULTIES.indexOf(s) >= 0) return s;
  if (/^[1-5]$/.test(s)) return DIFFICULTIES[Number(s) - 1];
  const alias = DIFF_ALIAS[s] || DIFF_ALIAS[s.toLowerCase()];
  if (alias) return alias;
  if (s.indexOf('很') >= 0) {
    return (s.indexOf('简单') >= 0 || s.indexOf('容易') >= 0) ? '很简单' : '很难';
  }
  if (s.indexOf('难') >= 0) return '较难';
  if (s.indexOf('简单') >= 0 || s.indexOf('容易') >= 0) return '简单';
  return '中等';
}

function normMastery(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (MASTERY_LEVELS.indexOf(s) >= 0) return s;
  if (s.indexOf('生疏') >= 0 || s.indexOf('不会') >= 0 || s.indexOf('未掌握') >= 0) return '生疏';
  if (s.indexOf('模糊') >= 0 || s.indexOf('半会') >= 0 || s.indexOf('一般') >= 0) return '模糊';
  if (s.indexOf('掌握') >= 0 || s.indexOf('熟练') >= 0 || s.indexOf('会') >= 0) return '掌握';
  return '';
}

module.exports = {
  mimeOf, sha1, uid, readBody, send, ok, fail, extractJSON, repairTruncatedJSON, sleep,
  sanitizeRichHtml, htmlToText, DIFFICULTIES, MASTERY_LEVELS, normDifficulty, normMastery
};
