#!/usr/bin/env node
/**
 * 题卡 JSON 校验器（零依赖，可单独拷走）。
 *
 *   node validate.mjs 题卡.json
 *
 * 通过：打印 "OK <题数>"，退出码 0
 * 不通过：逐条打印问题，退出码 1
 */
import fs from 'node:fs';

const TYPES = ['单选题', '多选题', '填空题', '判断题', '解答题', '计算题', '应用题', '实验探究题', '简答题', '阅读理解题', '图表分析题', '作文题', '完形填空题', '其他'];
const DIFFS = ['简单', '中等', '较难'];
const MAX_KNOWLEDGE = 10;
const MAX_FIGURES = 8;
const MAX_DATA_URL = 1.2 * 1024 * 1024;   // 单张内嵌图 base64 上限
const BLANK = '____';                       // 填空横线标准写法

const file = process.argv[2];
if (!file) {
  console.error('用法：node validate.mjs <题卡.json>');
  process.exit(2);
}

let raw;
try {
  raw = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error('JSON 解析失败：' + e.message);
  process.exit(1);
}

const list = Array.isArray(raw) ? raw
  : (raw && Array.isArray(raw.questions) ? raw.questions
    : (raw && Array.isArray(raw.data) ? raw.data : null));

if (!list) {
  console.error('顶层必须是数组，或带 questions / data 数组的对象');
  process.exit(1);
}

const problems = [];
const warnings = [];
const seenStem = new Map();

/** 校验 base64 data URI：格式 + base64 合法性 + 体积 */
function checkDataUrl(url, at, fi) {
  const m = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,([A-Za-z0-9+/=\s]+)$/i.exec(url);
  if (!m) {
    problems.push(at + '：figures[' + fi + '].url 不是合法的图片 data URI（应为 data:image/png;base64,...）');
    return;
  }
  const b64 = m[2].replace(/\s+/g, '');
  if (b64.length > MAX_DATA_URL) {
    problems.push(at + '：figures[' + fi + '] 内嵌图太大（base64 ' +
      (b64.length / 1024 / 1024).toFixed(2) + 'MB > 1.2MB），请把图裁小一点');
    return;
  }
  if (b64.length % 4 !== 0) {
    problems.push(at + '：figures[' + fi + '] base64 长度不合法（不是 4 的倍数）');
    return;
  }
  // 头部字节校验，避免明显损坏的 base64
  try {
    const head = Buffer.from(b64.slice(0, 32), 'base64');
    const ok = m[1].toLowerCase() === 'png' ? (head[0] === 0x89 && head[1] === 0x50)
      : m[1].toLowerCase() === 'gif' ? head.slice(0, 3).toString('latin1') === 'GIF'
      : m[1].toLowerCase() === 'webp' ? head.slice(0, 4).toString('latin1') === 'RIFF'
      : head[0] === 0xff && head[1] === 0xd8;   // jpeg / bmp 走这里只做粗判
    if (!ok) problems.push(at + '：figures[' + fi + '] base64 解出来的不是 ' + m[1] + ' 图片');
  } catch (e) {
    problems.push(at + '：figures[' + fi + '] base64 解码失败');
  }
}

list.forEach((q, i) => {
  const at = '第 ' + (i + 1) + ' 题';
  if (!q || typeof q !== 'object') { problems.push(at + '：不是对象'); return; }

  const stem = String(q.stem || q.题干 || '').trim();
  if (!stem) problems.push(at + '：stem 为空（导入时会被跳过）');
  else {
    if (seenStem.has(stem)) problems.push(at + '：题干与第 ' + (seenStem.get(stem) + 1) + ' 题重复');
    else seenStem.set(stem, i);
    if (/\$[^$]+\$|\\frac|\\sqrt|\\[a-zA-Z]+\{/.test(stem)) {
      problems.push(at + '：题干里有 LaTeX，请改用 x²、√3、a/b 这类纯文本写法');
    }
    // 横线写法检查
    if (/_{1,3}(?!_)/.test(stem) && !stem.includes(BLANK)) {
      warnings.push(at + '：题干里的横线不是 4 个下划线，统一写成 ' + BLANK);
    }
    if (/[…]{1,}|\.{3,}/.test(stem) && !stem.includes(BLANK)) {
      warnings.push(at + '：题干里有省略号/点号，可能原本是填空横线，请补成 ' + BLANK);
    }
  }

  const type = String(q.type || q.题型 || '').trim();
  if (!TYPES.includes(type)) problems.push(at + '：type 必须是 ' + TYPES.join(' / ') + '，当前是「' + type + '」');

  const diff = String(q.difficulty || q.难度 || '').trim();
  if (diff && !DIFFS.includes(diff)) problems.push(at + '：difficulty 必须是 简单 / 中等 / 较难，当前是「' + diff + '」');

  const opts = Array.isArray(q.options) ? q.options : [];
  const isChoice = type === '单选题' || type === '多选题';
  if (isChoice && opts.length < 2) problems.push(at + '：选择题至少要 2 个选项');
  const keys = new Set();
  opts.forEach((o, oi) => {
    const key = String((o && o.key) || '').trim();
    const text = String((o && o.text) || '').trim();
    if (!text) problems.push(at + '：选项 ' + (key || oi + 1) + ' 没有内容');
    if (key) {
      if (keys.has(key)) problems.push(at + '：选项 key 重复「' + key + '」');
      keys.add(key);
    }
  });

  const answer = String(q.answer || q.答案 || '').trim();
  if (type === '判断题' && answer && !['正确', '错误', '对', '错'].includes(answer)) {
    problems.push(at + '：判断题答案建议写「正确」或「错误」，当前是「' + answer + '」');
  }
  if (isChoice && answer && !/^[A-Z]+$/.test(answer)) {
    problems.push(at + '：选择题答案建议只写字母（如 A、AC），当前是「' + answer + '」');
  }

  // 填空题必须有横线
  if (type === '填空题' && stem && !stem.includes(BLANK)) {
    problems.push(at + '：填空题题干里没有 ' + BLANK + '（4 个下划线），横线多半被抽取时吞掉了');
  }

  // 知识点：数量与类型
  const knowledge = q.knowledge || q.知识点;
  if (knowledge != null && !Array.isArray(knowledge) && typeof knowledge !== 'string') {
    problems.push(at + '：knowledge 应为字符串数组');
  } else {
    const arr = Array.isArray(knowledge)
      ? knowledge
      : (typeof knowledge === 'string' ? knowledge.split(/[,，、;；\s]+/) : []);
    const clean = arr.map((k) => String(k).trim()).filter(Boolean);
    if (clean.length > MAX_KNOWLEDGE) {
      problems.push(at + '：knowledge 有 ' + clean.length + ' 个，超过 ' + MAX_KNOWLEDGE + ' 个上限');
    }
    if (!clean.length) {
      warnings.push(at + '：没有 knowledge 标签，题库按知识点检索时会漏掉这道题');
    }
  }

  const figs = Array.isArray(q.figures) ? q.figures : [];
  if (figs.length > MAX_FIGURES) {
    problems.push(at + '：figures 有 ' + figs.length + ' 张，超过 ' + MAX_FIGURES + ' 张上限');
  }
  figs.forEach((f, fi) => {
    const label = String((f && f.label) || '').trim();
    const desc = String((f && f.desc) || '').trim();
    if (!label && !desc) problems.push(at + '：figures[' + fi + '] 既没有 label 也没有 desc');
    if (f && f.bbox && !Array.isArray(f.bbox)) problems.push(at + '：figures[' + fi + '].bbox 必须是 4 个数字的数组');
    if (!desc) problems.push(at + '：figures[' + fi + '] 缺少 desc，导入后用户无法知道这里该是什么图');
    const url = String((f && (f.url || f.src)) || '').trim();
    if (url.startsWith('data:')) checkDataUrl(url, at, fi);
    else if (url && !/^\/uploads\/[A-Za-z0-9._-]+$/.test(url)) {
      warnings.push(at + '：figures[' + fi + '].url 既不是 data URI 也不是 /uploads/ 路径，导入后可能显示不出来');
    }
  });
  const placeholders = (stem.match(/\[图\d+\]/g) || []).length;
  if (figs.length && placeholders === 0) {
    problems.push(at + '：有 figures 但题干里没有 [图1] 这类占位符');
  }
});

// 顶层 answers 与题目一一对应
if (raw && !Array.isArray(raw) && Array.isArray(raw.answers)) {
  if (raw.answers.length !== list.length) {
    problems.push('顶层 answers 有 ' + raw.answers.length + ' 条，questions 有 ' + list.length +
      ' 道，答案与题目没有一一对应');
  }
}

if (problems.length) {
  problems.forEach((p) => console.error('- ' + p));
  if (warnings.length) {
    console.error('');
    warnings.forEach((w) => console.error('~ ' + w));
  }
  console.error('\n共 ' + list.length + ' 道题，' + problems.length + ' 个问题，' + warnings.length + ' 个提醒');
  process.exit(1);
}

if (warnings.length) {
  warnings.forEach((w) => console.log('~ ' + w));
}
const withFig = list.filter((q) => Array.isArray(q.figures) && q.figures.length).length;
const withImg = list.filter((q) => Array.isArray(q.figures) &&
  q.figures.some((f) => String((f && (f.url || f.src)) || '').startsWith('data:'))).length;
const withAns = list.filter((q) => String((q && (q.answer || q.答案)) || '').trim()).length;
console.log('OK ' + list.length +
  (withFig ? '（' + withFig + ' 道含图' + (withImg ? '，其中 ' + withImg + ' 道内嵌了图片' : '') + '）' : '') +
  (withAns ? '，' + withAns + ' 道含答案' : ''));
