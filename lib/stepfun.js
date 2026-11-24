'use strict';
/**
 * 阶跃星辰（StepFun）调用封装：OpenAI 兼容协议，只用 Node 内置 https。
 * 内置模型（界面上不提供切换）：
 *   识图 step-1o-turbo-vision（专用视觉模型，响应最快）
 *   文本 step-3.5-flash（最便宜、最快）
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { extractJSON, repairTruncatedJSON, normDifficulty } = require('./util');
const store = require('./db');
const cfg = require('./config');

// 官方刊例价（元 / 百万 tokens，2026-11 核对），仅用于本地费用估算展示
const PRICES = {
  'step-3.5-flash': { in: 0.7, out: 2.1, cacheIn: 0.14 },
  'step-3.7-flash': { in: 1.35, out: 8.1, cacheIn: 0.27 },
  'step-1o-turbo-vision': { in: 2.5, out: 8, cacheIn: 0.5 },
  'step-5-preview': { in: 7, out: 20, cacheIn: 0.7 }
};

// 记录哪些模型不接受 reasoning_effort，避免每次都先吃一次 400
const noReasoningModels = new Set();

function priceOf(model) {
  return PRICES[model] || { in: 3, out: 10 };
}

function estimateCost(model, promptTokens, completionTokens) {
  const p = priceOf(model);
  return (promptTokens / 1e6) * p.in + (completionTokens / 1e6) * p.out;
}

function request(urlString, { method = 'POST', headers = {}, body = null, timeout = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlString);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + (u.search || ''),
      method,
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        clearTimeout(deadline);
        resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') });
      });
    });
    // 绝对时限：上游只要一直有心跳数据，socket 空闲超时就永远不会触发，
    // 界面就会一直转圈。这里用墙钟兜底，到点直接掐断。
    const deadline = setTimeout(() => {
      const e = new Error('模型响应超时（超过 ' + Math.round(timeout / 1000) + ' 秒），请检查网络或换用更快模型');
      e.code = 'ETIMEDOUT';
      req.destroy(e);
    }, timeout);
    req.setTimeout(timeout, () => {
      const e = new Error('模型响应超时（超过 ' + Math.round(timeout / 1000) + ' 秒），请检查网络或换用更快模型');
      e.code = 'ETIMEDOUT';
      req.destroy(e);
    });
    req.on('error', (e) => {
      clearTimeout(deadline);
      if (e && e.code === 'ETIMEDOUT') return reject(e);
      reject(new Error('连接模型服务失败：' + (e && e.message)));
    });
    if (body) req.write(body);
    req.end();
  });
}

function friendlyError(status, text) {
  let detail = '';
  try {
    const j = JSON.parse(text);
    detail = (j.error && (j.error.message || j.error.code)) || j.message || '';
  } catch (_) {
    detail = String(text || '').slice(0, 200);
  }
  if (status === 401 || status === 403) return new Error('API Key 无效或没有权限，请在「设置」里核对后重试');
  if (status === 429) return new Error('调用太频繁或余额不足，请稍等一会再试');
  if (status === 404) return new Error('模型名称不存在，请在「设置」里换一个模型');
  if (status >= 500) return new Error('模型服务暂时不可用，请稍后重试');
  return new Error('模型返回异常（' + status + '）：' + (detail || '未知原因'));
}

/**
 * 校验模型服务地址。
 * 必须用 https：http 会把 Authorization 里的 API Key 明文发到网络上。
 * 只有本机地址（本地 mock 模型）允许 http。
 */
function safeBaseUrl(raw) {
  const url = String(raw || 'https://api.stepfun.com/v1').trim().replace(/\/+$/, '');
  let u;
  try {
    u = new URL(url);
  } catch (e) {
    throw Object.assign(new Error('模型服务地址格式不正确，请在「设置」里重新填写'), { statusCode: 400 });
  }
  if (u.protocol === 'https:') return url;
  if (u.protocol === 'http:') {
    const h = u.hostname.toLowerCase();
    if (h === '127.0.0.1' || h === 'localhost' || h === '::1') return url;
    throw Object.assign(new Error('模型服务地址必须用 https：http 会把 API Key 明文发出去（只有本机地址可以用 http）'), { statusCode: 400 });
  }
  throw Object.assign(new Error('模型服务地址只支持 http / https'), { statusCode: 400 });
}

async function chat({ model, messages, temperature = 0.2, maxTokens = 4096, json = true, extra = null, timeout = 90000 }) {
  const settings = store.db().settings;
  const apiKey = String(settings.apiKey || '').trim();
  if (!apiKey) throw Object.assign(new Error('还没有配置 API Key，请先到「设置」里填写阶跃星辰的 Key'), { statusCode: 400 });

  const base = safeBaseUrl(settings.baseUrl);
  const startedAt = Date.now();

  function buildPayload(useJson, useExtra) {
    const p = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false
    };
    if (useExtra && extra) Object.assign(p, extra);
    if (useJson) p.response_format = { type: 'json_object' };
    return Buffer.from(JSON.stringify(p), 'utf8');
  }

  const doCall = (useJson, useExtra) => {
    const body = buildPayload(useJson, useExtra);
    return request(base + '/chat/completions', {
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length,
        Authorization: 'Bearer ' + apiKey
      },
      body,
      timeout
    });
  };

  const useJson = !!json;
  const useExtra = !!(extra && Object.keys(extra).length) && !noReasoningModels.has(model);

  let res;
  try {
    res = await doCall(useJson, useExtra);
    if (res.status >= 500 || res.status === 429) {
      await new Promise((r) => setTimeout(r, 1000));
      res = await doCall(useJson, useExtra);
    }
  } catch (e) {
    // 超时多半是图片太大或网络慢，重试只会让用户多等一轮，直接报错更实在
    if (e && e.code === 'ETIMEDOUT') throw e;
    // 只有"连接根本没建立"的错误才值得重试。
    // 原来对任何异常都重发一次：如果请求其实已经送到模型服务端、只是回包丢了，
    // 这次重试会被计费两次，而且第二次再抛错时原始原因也丢了，界面只看到一句笼统的失败。
    const connErr = e && (e.code === 'ECONNREFUSED' || e.code === 'EAI_AGAIN' || e.code === 'ENOTFOUND' || e.code === 'EPIPE');
    if (!connErr) throw e;
    try {
      res = await doCall(useJson, useExtra);
    } catch (e2) {
      throw Object.assign(new Error('连接模型服务失败：' + (e2 && e2.message ? e2.message : String(e2))), { cause: e });
    }
  }

  // 兼容性降级：模型不接受某个参数时，逐项去掉再试，避免直接失败
  if (res.status === 400) {
    if (useExtra) {
      noReasoningModels.add(model);
      res = await doCall(useJson, false);
    }
    if (res.status === 400 && useJson) {
      res = await doCall(false, false);
    }
  }

  if (res.status !== 200) throw friendlyError(res.status, res.text);

  let data;
  try { data = JSON.parse(res.text); } catch (e) { throw new Error('模型返回内容无法解析，请重试'); }
  const choice = (data.choices && data.choices[0]) || null;
  if (!choice) throw new Error('模型没有返回结果，请重试');
  const content = (choice.message && choice.message.content) || '';
  const usage = data.usage || {};
  const promptTokens = usage.prompt_tokens || 0;
  const completionTokens = usage.completion_tokens || 0;
  const durationMs = Date.now() - startedAt;

  store.addUsage({
    ts: Date.now(),
    model,
    promptTokens,
    completionTokens,
    cost: Number(estimateCost(model, promptTokens, completionTokens).toFixed(4)),
    durationMs
  });

  return {
    content,
    usage: { promptTokens, completionTokens },
    durationMs,
    finishReason: (choice.finish_reason || '') + ''
  };
}

/* ---------------- 提示词 ---------------- */

const RECOGNIZE_SYSTEM = '你是一位资深中学教师的题目录入助手，擅长把试卷、教辅、板书照片准确转成结构化题目数据。你只输出 JSON，不输出任何解释。';

function recognizePrompt(mode, hint) {
  const single = mode !== 'paper';
  const scope = single
    ? '图片是老师从教辅/试卷上框选出来的一块内容（可能是完整一道题，也可能只是题目的一部分，甚至只有选项或图注）。' +
      '你的任务是把这块里的文字照实转写出来，输出 1 条题目：questions 数组里只能有 1 条。'
    : '图片是一整页试卷或教辅，含多道题，按从上到下、从左到右的顺序逐题识别，不合并、不漏题。';
  const h = hint || {};
  const hintLine = (h.subject || h.grade)
    ? '0. 老师已指定这套材料属于「' + [h.grade, h.subject].filter(Boolean).join(' · ') + '」，所有题目的 subject / grade 统一按这个填。'
    : '';
  return [
    scope,
    // 框选场景必须明确「不许返回空」：否则模型看到半道题、只有选项、
    // 或一块图文混排，就会套用「图片不是题目」的规则返回 []，老师只能拿到图片。
    single ? '1. 只要这块区域里有任何可读文字（题干、小问、选项、图注、说明都算），就必须输出 1 条题目，把文字照实写进 stem，绝对不要返回空数组。' : null,
    single ? '2. 不要按题号或小问再拆成多条，也不要把图中没框到的相邻题目写进来。' : null,
    hintLine,
    hintLine ? '' : null,
    '规则：',
    '1. 题干完整保留原文，填空横线一律保留为 ____（4 个下划线）；不解题、不补全、不编造，图中没有答案就留空。',
    '2. 选择题把选项拆到 options，key 用 A/B/C/D；非选择题 options 为空数组。',
    '3. 公式用简洁符号：x²、√3、a/b、(a+b)/2、∠A=60°、≤、≠、π、H₂O、CO₂↑、△ABC；分式实在不好写时用 \\frac{a}{b}。',
    '4. 图形单独标注：几何图、函数图像、电路图、表格、示意图这类无法用文字表达的图形，写进 figures 数组即可；题干里不要写 [图1]、[图2] 这类占位符，也不要写「如图1所示」之外的图注文字，图形位置由系统按 figures 顺序排版。',
    '   figures 里 bbox 用归一化坐标 [x,y,w,h]，取值 0~1：x/y 是图形左上角相对整张图片的宽高比例，w/h 是图形相对宽高。',
    '   bbox 必须只框几何图形本身（线条、坐标轴、刻度、图注如「图1」），框的上边沿不能压到题干或选项文字行；如果一个框里同时有文字和图形，就把上边界下移到文字行下方。宁可偏紧，也不要偏松。',
    '5. type 只能是：单选题、多选题、填空题、判断题、解答题、其他；difficulty 只能是：很简单、简单、中等、较难、很难。',
    '6. knowledge 给 1-10 个知识点短词，例如 ["一元二次方程","判别式"]；一道题同时考查多个知识点时必须全部打上，不要只挑最显眼的那一个。',
    '7. 尽量判断 subject（学科，如「初中数学」「高中物理」）与 grade（年级，如「八年级」「九年级」），判断不出就留空字符串。',
    '8. no 是纸面上印的题号（如 "3"、"12"、"(2)"），没有就留空字符串。',
    '9. 忽略页眉、页脚、页码、水印、二维码、广告文字。',
    '10. 表格（频数分布表、价目表、数据表）是题目的组成部分：整张表只属于一道题，表头与行名列名（如「分组（分）」「频数（人）」「票种」「单价」）绝对不要当成独立题目输出；表内数据用「组值:数值」形式转写进题干。',
    // 整页模式才允许返回空；框选模式下一律要求输出（见开头 single 分支的强约束）
    single ? null : '11. 图片不是题目时——通知、公告、纯文字材料、整页只有手写解答没有任何题目——questions 必须返回空数组 []，绝对不要把整段文字硬凑成一道题。',
    '12. 只为图片中真实存在的题目输出条目，宁可少，也不要凭空生成。',
    '',
    '只输出 JSON：',
    '{"questions":[{"no":"12","stem":"如图所示，电阻甲的阻值为 ____","type":"单选题","options":[{"key":"A","text":""}],"answer":"","analysis":"","knowledge":["知识点"],"difficulty":"中等","subject":"初中物理","grade":"九年级","figures":[{"label":"图1","desc":"I-U 图像","bbox":[0.62,0.18,0.3,0.35]}]}]}'
  ].filter((l) => l !== null).join('\n');
}

function dataUrlToImagePart(dataUrl, withDetail) {
  const part = { type: 'image_url', image_url: { url: dataUrl } };
  if (withDetail) part.image_url.detail = 'high';
  return part;
}

/** 识别一张或多张图片里的题目 */
async function recognize({ images, mode = 'single', model, hint }) {
  const useModel = model || cfg.VISION_MODEL;
  if (!Array.isArray(images) || !images.length) throw Object.assign(new Error('没有收到图片'), { statusCode: 400 });
  if (images.length > 20) throw Object.assign(new Error('一次最多识别 20 张，请分批处理'), { statusCode: 400 });

  // 整页试卷小字多，开 detail（按图片实际尺寸计费，一张约多几厘钱）；单题区域图字大，用默认档更快
  const withDetail = mode === 'paper';
  const content = images.map((d) => dataUrlToImagePart(d, withDetail));
  content.push({ type: 'text', text: recognizePrompt(mode, hint) });

  const { content: reply, durationMs } = await chat({
    model: useModel,
    messages: [
      { role: 'system', content: RECOGNIZE_SYSTEM },
      { role: 'user', content }
    ],
    temperature: 0.1,
    // 一道题的 JSON 一般 300-800 tokens，整页 2000 左右；留 4096 足够且不会拖慢生成
    maxTokens: mode === 'paper' ? 4096 : 2048,
    timeout: 60000
  });
  void durationMs;

  const parsed = extractJSON(reply);
  let list = Array.isArray(parsed) ? parsed : (parsed.questions || []);
  if (!Array.isArray(list)) list = [];
  const out = list.map(normalizeQuestion).filter((q) => q && q.stem).map((q) => {
    if (hint && hint.subject) q.subject = q.subject || hint.subject;
    if (hint && hint.grade) q.grade = q.grade || hint.grade;
    return q;
  });
  // 框选出来的一整道题只留第一条：模型偶尔会把小问或页边邻题也拆出来，
  // 那部分不是老师框选的内容，多出来反而要人工删。
  if (mode !== 'paper') return out.slice(0, 1);
  return out;
}

/**
 * 从纯文本（Markdown、txt、从 Word 提取的文本）里拆题：比视觉识别便宜得多，
 * 适合「题卡 JSON / PDF、MD 文档导入」这类已经带文字的场景。
 */
async function parseTextQuestions({ text, hint }) {
  const useModel = cfg.TEXT_MODEL;
  const src = String(text || '').trim();
  if (!src) throw Object.assign(new Error('内容为空'), { statusCode: 400 });
  const sliced = src.slice(0, 14000);
  const { content, finishReason } = await chat({
    model: useModel,
    messages: [
      { role: 'system', content: '你是教研组的题目录入助手，能把一篇文字材料拆成一道一道结构化的题目。你只输出 JSON。' },
      {
        role: 'user',
        content: '把下面的文字材料拆成题目。要求：\n' +
          '1. 一题一条，按原文顺序；识别题号（如「1.」「(2)」）、题型、选项。\n' +
          '2. 题干保留原文，不要改写、不要补答案；原文里有「答案：」「解析：」就分别放到 answer / analysis。\n' +
          '3. 填空题的横线一律写成 ____（4 个下划线），原文里的空位不能吞掉、不能写成省略号或空格；公式用 x²、√3、a/b 这类写法，不要 LaTeX。\n' +
          '4. type 只能是：单选题、多选题、填空题、判断题、解答题、其他；difficulty 只能是：很简单、简单、中等、较难、很难。\n' +
          '5. 每道题给 1-10 个 knowledge 知识点短词；一道题同时考查多个知识点时必须全部打上。\n' +
          (hint && (hint.subject || hint.grade)
            ? '6. 所有题目的 subject / grade 统一填「' + [hint.grade, hint.subject].filter(Boolean).join(' · ') + '」。\n'
            : '6. 能判断就填 subject（如「初中数学」）和 grade（如「八年级」），判断不出留空。\n') +
          '7. 如果材料里没有题目（比如纯讲义正文），questions 返回空数组。\n' +
          '只输出 JSON：{"questions":[{"no":"1","stem":"","type":"单选题","options":[{"key":"A","text":""}],"answer":"","analysis":"","knowledge":[],"difficulty":"中等","subject":"","grade":""}]}\n\n' +
          '材料：\n' + sliced
      }
    ],
    temperature: 0.1,
    maxTokens: 8192,
    timeout: 120000
  });

  let j;
  let truncated = false;
  try {
    j = extractJSON(content);
  } catch (e) {
    const salvaged = repairTruncatedJSON(content);
    if (!salvaged) {
      if (finishReason === 'length') {
        throw Object.assign(new Error('材料太长，一次拆不完。可以分成几段分别导入'), { statusCode: 400 });
      }
      throw e;
    }
    j = salvaged;
    truncated = true;
  }
  const list = Array.isArray(j.questions) ? j.questions : (Array.isArray(j) ? j : []);
  return {
    truncated,
    questions: list.map(normalizeQuestion)
      .filter((q) => q && q.stem)
      .map((q) => {
        if (hint && hint.subject) q.subject = q.subject || hint.subject;
        if (hint && hint.grade) q.grade = q.grade || hint.grade;
        return q;
      })
  };
}

/** 举一反三：给一道题生成同考点的变式题（只生成题干与选项，答案留空） */
async function similarQuestions({ stem, options, knowledge, count }) {
  const n = Math.max(1, Math.min(5, Number(count) || 3));
  const optText = (options || []).map((o) => o.key + '. ' + o.text).join('\n');
  const { content } = await chat({
    model: cfg.TEXT_MODEL,
    messages: [
      { role: 'system', content: '你是命题经验丰富的中学教师，擅长围绕同一考点出变式题。只输出 JSON。' },
      {
        role: 'user',
        content: '下面是一道原题，请再出 ' + n + ' 道同考点、同题型的变式题。\n' +
          '要求：数据换成新的、考法保持一致；不要照抄原题；不要给答案和解析；公式用 x²、√3 这类写法。\n\n' +
          '原题：\n' + stem + (optText ? '\n选项：\n' + optText : '') +
          '\n知识点：' + ((knowledge || []).join('、') || '（未标注）') +
          '\n\n输出：{"questions":[{"stem":"","type":"","options":[{"key":"A","text":""}],"knowledge":[],"difficulty":"中等"}]}'
      }
    ],
    temperature: 0.85,
    maxTokens: 4096,
    timeout: 90000
  });
  const j = extractJSON(content);
  const list = Array.isArray(j.questions) ? j.questions : [];
  return list.map(normalizeQuestion).filter((q) => q && q.stem).slice(0, n);
}

/**
 * 剥掉题干开头的整题题号（「12.」「12、」「12)」「12：」「第12题」「No.12」），
 * 题号回填到 no 字段。模型经常把卷面题号混进题干，这里做确定性兜底，不依赖提示词自觉。
 * 安全边界：数字限 1~3 位（不误伤「2020.」年份）；「3.5」这类小数不剥（点后紧跟数字放过）；
 * 「(1)」「(2)」是小问编号，按约定不剥——解析和答案常按小问引用。
 */
function stripLeadingNo(stem) {
  const s = String(stem || '');
  const m = s.match(/^\s*(?:第\s*(\d{1,3})\s*(?:小题|题)?\s*[：:.、)）]?\s*|No\.?\s*(\d{1,3})\s*[：:.、)）]?\s*|(\d{1,3})\s*(?:[、)）：：]|\.(?!\d))\s*)/);
  if (!m) return { stem: s, no: '' };
  return { stem: s.slice(m[0].length).trim(), no: m[1] || m[2] || m[3] || '' };
}

/**
 * 去掉题干里的图注占位。
 * 提示词已经要求不写 [图1]，但模型仍会把纸面图注（「图1」「如图1所示」单独成行）
 * 当正文转写进来；这类孤立的图注行对读者没有意义，图形本身由 figures 排版。
 * 只删「单独成行、且整行就是一个图号」的行，正文里夹着的「如图 1 所示」保留。
 */
function stripFigureCaptions(stem) {
  return String(stem || '')
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      // 图1 / 图 1 / [图1] / （图1） / 如图1 / 如图 1 所示 这类整行图注
      if (/^(?:如)?图\s*\d{1,2}(?:\s*所示)?[：:。、]?$/i.test(t)) return false;
      if (/^[(（\[]\s*图\s*\d{1,2}\s*[)）\]]$/i.test(t)) return false;
      return true;
    })
    .join('\n')
    .replace(/\[\s*图\s*\d{1,2}\s*\]/g, '')   // 行内残留的 [图1] 占位直接去掉
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeQuestion(q) {
  if (!q || typeof q !== 'object') return null;
  const type = ['单选题', '多选题', '填空题', '判断题', '解答题', '其他'].includes(q.type) ? q.type : '其他';
  let options = Array.isArray(q.options) ? q.options : [];
  options = options.map((o, i) => {
    if (typeof o === 'string') return { key: String.fromCharCode(65 + i), text: o };
    return { key: String((o && o.key) || String.fromCharCode(65 + i)).slice(0, 2), text: String((o && (o.text || o.value)) || '') };
  }).filter((o) => o.text);
  const knowledge = Array.isArray(q.knowledge)
    ? q.knowledge.map((k) => String(k).trim()).filter(Boolean)
    : String(q.knowledge || '').split(/[,，、;；\s]+/).map((s) => s.trim()).filter(Boolean);
  const figures = (Array.isArray(q.figures) ? q.figures : []).map((f) => {
    const box = Array.isArray(f && f.bbox) ? f.bbox.map(Number) : [];
    if (box.length !== 4 || box.some((n) => !Number.isFinite(n))) return null;
    const clamped = box.map((n) => Math.min(1, Math.max(0, n)));
    if (clamped[2] <= 0.01 || clamped[3] <= 0.01) return null;
    return {
      label: String((f && f.label) || '').trim(),
      desc: String((f && f.desc) || '').trim(),
      bbox: clamped
    };
  }).filter(Boolean).slice(0, 6);
  const stripped = stripLeadingNo(String(q.stem || q.question || '').trim());
  const rawNo = String(q.no || '').trim();
  return {
    no: (rawNo || stripped.no).slice(0, 10),
    stem: stripFigureCaptions(stripped.stem),
    type,
    options,
    answer: String(q.answer || '').trim(),
    analysis: String(q.analysis || '').trim(),
    knowledge: knowledge.slice(0, 10),
    difficulty: normDifficulty(q.difficulty),
    subject: String(q.subject || '').trim().slice(0, 20),
    grade: String(q.grade || '').trim().slice(0, 20),
    // 兼容旧字段：模型只说看图而没给框选时，仍保留图片，让用户自己框
    hasImage: !!q.hasImage || figures.length > 0,
    figures
  };
}

/* ---------------- 文字类能力 ---------------- */

/** 补全答案与解析 */
async function solve({ stem, options, model }) {
  const useModel = model || cfg.TEXT_MODEL;
  const optText = (options || []).map((o) => o.key + '. ' + o.text).join('\n');
  // 数一下题干里有几个空：填空题要按空逐个给答案，挤成一整句老师没法核对
  const blankCount = (String(stem || '').match(/_{2,}/g) || []).length;
  const isFill = blankCount > 0 && !optText;
  const fillRule = isFill
    ? '\n这是一道有 ' + blankCount + ' 个空的填空题：answer 必须按空的顺序返回数组，' +
      '每个空一个元素，例如 {"answer":["3","0.5","能"]}；只有 1 个空时也返回数组。' +
      '解析里分别说明每个空为什么填这个值。'
    : '';
  const answerShape = isFill ? '["第一个空的答案","第二个空的答案"]' : '"最终答案"';
  const { content } = await chat({
    model: useModel,
    messages: [
      { role: 'system', content: '你是中学教师，解题严谨，讲解分步、口语化，只输出 JSON。' },
      {
        role: 'user',
        content: '请解答下面这道题，给出答案和解析。\n\n题目：\n' + stem + (optText ? '\n选项：\n' + optText : '') +
          '\n\n解析要求：分步骤写清楚关键思路，不超过 200 字，不要使用 LaTeX 复杂语法，公式用 x²、√3、a/b 这类写法。' +
          fillRule +
          '\n输出：{"answer":' + answerShape + ',"analysis":"解析","knowledge":["知识点"],"difficulty":"很简单|简单|中等|较难|很难"}'
      }
    ],
    temperature: 0.3,
    maxTokens: 1024,
    timeout: 60000
  });
  const j = extractJSON(content);
  let answer;
  if (Array.isArray(j.answer)) {
    // 数组：按空拼成「① 3　② 0.5」这种一行一条，既结构化又能直接读
    answer = j.answer.map((a, i) => {
      const t = String(a == null ? '' : a).trim();
      if (!t) return '';
      return blankCount > 1 ? '（' + (i + 1) + '）' + t : t;
    }).filter(Boolean).join('\n');
  } else {
    answer = String(j.answer || '').trim();
  }
  return {
    answer,
    analysis: String(j.analysis || '').trim(),
    knowledge: Array.isArray(j.knowledge) ? j.knowledge.map(String).slice(0, 5) : [],
    difficulty: normDifficulty(j.difficulty)
  };
}

/** 把杂乱文本整理成讲义结构（分节 + 段落 + 要点） */
async function organizeLecture({ text, model }) {
  const useModel = model || cfg.TEXT_MODEL;
  const src = String(text || '').slice(0, 12000);
  const { content, finishReason } = await chat({
    model: useModel,
    messages: [
      { role: 'system', content: '你是教研组的讲义编辑，擅长把零散的教学材料整理成清晰的讲义结构。只输出 JSON，不要解释、不要代码块标记、不要缩进换行。' },
      {
        role: 'user',
        content: '把下面的教学材料整理成讲义结构。要求：\n' +
          '1. 保留原文全部知识点，不要删减内容、不要自行编造新知识。\n' +
          '2. 按内容合理分成 2-6 个小节，每节给小标题（不超过 12 字）。\n' +
          '3. 每节下的段落用 type 区分：text（讲解正文）、points（要点列表，items 数组）、formula（公式行）、example（例题）。\n' +
          '4. 文字平实，符合教师讲课口吻。\n' +
          '5. 输出必须紧凑：不要空格缩进，不要多余换行；公式直接写 x^2、a≠0 这样的纯文本，不要用 $ 或 LaTeX。\n\n' +
          '输出格式：\n' +
          '{"title":"讲义标题","sections":[{"heading":"小节标题","blocks":[{"type":"text","content":"段落"},{"type":"points","items":["要点1","要点2"]},{"type":"formula","content":"x^2+2x+1=0"}]}]}\n\n' +
          '材料：\n' + src
      }
    ],
    temperature: 0.3,
    maxTokens: 8192,
    timeout: 120000
  });

  let j;
  let truncated = false;
  try {
    j = extractJSON(content);
  } catch (e) {
    // 输出触顶被截断时，保住已经生成的小节，别让用户白等一场
    const salvaged = repairTruncatedJSON(content);
    if (!salvaged) {
      if (finishReason === 'length') {
        throw Object.assign(new Error('这份材料太长，模型一次整理不完。可以把它拆成两段分别导入，或取消勾选「让 AI 帮忙分节整理」直接导入原文'), { statusCode: 400 });
      }
      throw e;
    }
    j = salvaged;
    truncated = true;
  }

  const sections = Array.isArray(j.sections) ? j.sections : [];
  return {
    title: String(j.title || '').trim(),
    truncated,
    sections: sections.map((s) => ({
      heading: String(s.heading || '').trim(),
      blocks: (Array.isArray(s.blocks) ? s.blocks : []).map((b) => ({
        type: ['text', 'points', 'formula', 'example'].includes(b.type) ? b.type : 'text',
        content: String(b.content || '').trim(),
        items: Array.isArray(b.items) ? b.items.map(String) : []
      })).filter((b) => b.content || (b.items && b.items.length))
    })).filter((s) => s.blocks.length || s.heading)
  };
}

module.exports = {
  recognize, parseTextQuestions, similarQuestions, solve, organizeLecture, chat,
  PRICES, priceOf, estimateCost, RECOGNIZE_SYSTEM, recognizePrompt, dataUrlToImagePart,
  safeBaseUrl
};
