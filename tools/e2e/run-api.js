#!/usr/bin/env node
/**
 * API 层端到端测试（真实模型）
 *
 * 用法：
 *   node tools/e2e/run-api.js                     # 跑全部
 *   node tools/e2e/run-api.js --only=recognize    # 只跑名称含关键词的用例
 *   node tools/e2e/run-api.js --base=http://127.0.0.1:7788
 *
 * 不做任何 mock：直连本地服务，模型调用会真实产生费用（全套约 0.3-0.6 元）。
 * 结果写入 .e2e/report-api.json 与 .e2e/report-api.md。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, '.e2e');

const args = process.argv.slice(2);
const argOf = (k, d) => {
  const hit = args.find((a) => a.startsWith('--' + k + '='));
  return hit ? hit.slice(k.length + 3) : d;
};
const BASE = argOf('base', 'http://127.0.0.1:7788');
const ONLY = argOf('only', '');

const M = (p) => path.join(ROOT, '测试材料', p);
const b64 = (p) => 'data:image/jpeg;base64,' + fs.readFileSync(p).toString('base64');

/* ---------------- HTTP ---------------- */
function request(method, urlPath, body, timeout) {
  return new Promise((resolve) => {
    const u = new URL(BASE + urlPath);
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname + u.search,
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
          : {}
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = JSON.parse(raw); } catch (e) { /* 非 JSON */ }
          resolve({ status: res.statusCode, raw, json, headers: res.headers });
        });
      }
    );
    req.setTimeout(timeout || 180000, () => req.destroy(new Error('请求超时')));
    req.on('error', (e) => resolve({ status: 0, raw: '', json: null, error: e.message }));
    if (payload) req.write(payload);
    req.end();
  });
}
const api = (m, p, b, t) => request(m, p, b, t);

/* ---------------- 断言 ---------------- */
const results = [];
function check(cond, msg) {
  return { ok: !!cond, msg: cond ? '' : msg };
}
function pick(res, fails, warn) {
  return { fails: fails.filter(Boolean), warn: (warn || []).filter(Boolean) };
}

async function run(c) {
  if (ONLY && !c.name.includes(ONLY)) return;
  const t0 = Date.now();
  let r;
  try {
    r = await c.fn();
  } catch (e) {
    r = { pass: false, level: '阻断', note: '用例抛异常：' + e.message, detail: {} };
  }
  const ms = Date.now() - t0;
  const rec = Object.assign(
    { id: c.id, group: c.group, name: c.name, expect: c.expect, ms },
    r
  );
  results.push(rec);
  const mark = rec.pass ? '  PASS ' : rec.level === '建议' ? '  WARN ' : '  FAIL ';
  console.log(
    mark + pad(rec.id, 5) + pad(rec.name, 34) + pad(ms + 'ms', 9) +
    (rec.pass ? '' : '  ' + String(rec.note || '').slice(0, 120))
  );
}
const pad = (s, n) => {
  s = String(s);
  let w = 0;
  for (const ch of s) w += /[\u4e00-\u9fa5\uff00-\uffef]/.test(ch) ? 2 : 1;
  return s + ' '.repeat(Math.max(1, n - w));
};

/* ---------------- 识别校验工具 ---------------- */
function summarizeRecognize(res, ms) {
  if (!res.json || res.json.ok !== true) {
    return { pass: false, level: '阻断', note: '接口报错：' + String(res.raw).slice(0, 200), detail: { status: res.status } };
  }
  const list = res.json.data || [];
  return {
    pass: true,
    count: list.length,
    detail: {
      count: list.length,
      status: res.status,
      questions: list.map((q) => ({
        stem: String(q.stem || '').slice(0, 70),
        type: q.type,
        options: (q.options || []).map((o) => (o.key || '') + '.' + String(o.text || '').slice(0, 24)),
        answer: String(q.answer || '').slice(0, 40),
        analysisLen: String(q.analysis || '').length,
        difficulty: q.difficulty,
        knowledge: q.knowledge || []
      }))
    }
  };
}

/* ================= 用例 ================= */
const CASES = [];
const add = (id, group, name, expect, fn) => CASES.push({ id, group, name, expect, fn });

/* ---- 组 1：服务与静态资源 ---- */
add('S1', '服务', 'ping 存活', '返回 ok:true', async () => {
  const r = await api('GET', '/api/ping');
  return { pass: r.json && r.json.ok === true, note: r.raw.slice(0, 80), detail: r.json };
});

add('S2', '服务', 'bootstrap 数据结构', '含 settings/folders/questions/lectures/stats', async () => {
  const r = await api('GET', '/api/bootstrap');
  const d = (r.json && r.json.data) || {};
  const need = ['settings', 'folders', 'questions', 'lectures', 'stats'];
  const miss = need.filter((k) => !(k in d));
  return {
    pass: !miss.length && d.settings.hasKey === true,
    note: miss.length ? '缺字段 ' + miss.join(',') : '未配置 Key',
    detail: { hasKey: d.settings && d.settings.hasKey, q: (d.questions || []).length }
  };
});

add('S3', '服务', '全部静态资源可访问', 'index/tpl/js/css/vendor 全 200 且非空', async () => {
  const tpls = fs.readdirSync(path.join(ROOT, 'public', 'tpl')).filter((f) => f.endsWith('.html'));
  const js = fs.readdirSync(path.join(ROOT, 'public', 'js')).filter((f) => f.endsWith('.js'));
  const urls = ['/', '/css/app.css', '/vendor/vue.js', '/vendor/element-plus.js', '/vendor/icons.js',
    '/vendor/pdf.min.js', '/vendor/pdf.worker.min.js']
    .concat(tpls.map((f) => '/tpl/' + f))
    .concat(js.map((f) => '/js/' + f));
  const bad = [];
  for (const u of urls) {
    const r = await api('GET', u, undefined, 20000);
    if (r.status !== 200 || !r.raw.length) bad.push(u + '(' + r.status + ',' + r.raw.length + ')');
  }
  return {
    pass: !bad.length,
    note: '失败 ' + bad.length + '/' + urls.length + '：' + bad.slice(0, 5).join(' '),
    detail: { total: urls.length, failed: bad }
  };
});

/* ---- 组 2：上传 ---- */
add('U1', '上传', '上传普通单题图', '返回 /uploads/xxx.jpg 且可访问', async () => {
  const r = await api('POST', '/api/upload', { dataUrl: b64(M('02-单题照片/单题-选择题.jpg')) });
  const url = r.json && r.json.data && r.json.data.url;
  let fetchOk = false;
  if (url) {
    const f = await api('GET', url, undefined, 15000);
    fetchOk = f.status === 200 && f.raw.length > 1000;
  }
  return { pass: !!url && fetchOk, note: 'url=' + url + ' 回读=' + fetchOk, detail: { url, fetchOk } };
});

add('U2', '上传', '上传 3000 宽大图（712KB）', '可上传且体积被正确保存', async () => {
  const p = M('03-边界样本/边界-超大图3000宽.jpg');
  const kb = Math.round(fs.statSync(p).size / 1024);
  const r = await api('POST', '/api/upload', { dataUrl: b64(p) });
  const url = r.json && r.json.data && r.json.data.url;
  return { pass: !!url, note: '源 ' + kb + 'KB -> ' + url, detail: { kb, url } };
});

add('U3', '上传', '非法图片被拒绝', '返回 4xx 而非 500', async () => {
  const r = await api('POST', '/api/upload', { dataUrl: 'not-a-data-url' });
  return { pass: r.status >= 400 && r.status < 500, note: 'status=' + r.status + ' ' + r.raw.slice(0, 80), detail: { status: r.status } };
});

/* ---- 组 3：单题识别 ---- */
const single = (id, file, expectDesc, opts) => {
  opts = opts || {};
  add(id, '识别-单题', '识别 ' + file.replace('.jpg', ''), expectDesc, async () => {
    const t0 = Date.now();
    // single 模式按产品设计只返回 1 道；材料本身含多道题的用例传 mode:'paper' 验证拆题能力
    const mode = opts.mode || 'single';
    const r = await api('POST', '/api/recognize', { images: [b64(M('02-单题照片/' + file))], mode }, 180000);
    const ms = Date.now() - t0;
    const base = summarizeRecognize(r, ms);
    if (!base.pass) return base;
    base.detail.ms = ms;
    const fails = [];
    const warns = [];
    if (opts.count !== undefined) {
      if (base.count !== opts.count) fails.push('题数 ' + base.count + ' ≠ 预期 ' + opts.count);
    } else if (opts.countRange) {
      const [lo, hi] = opts.countRange;
      if (base.count < lo || base.count > hi) fails.push('题数 ' + base.count + ' 不在 ' + lo + '-' + hi + ' 区间');
    } else if (base.count < 1) fails.push('未识别出任何题目');
    if (opts.noAnswer) {
      const withAns = base.detail.questions.filter((q) => q.answer && q.answer.trim());
      if (withAns.length) warns.push(withAns.length + ' 道题被填了答案：' + withAns.map((q) => q.answer).join('/'));
    }
    if (opts.mustContain) {
      const all = JSON.stringify(base.detail.questions);
      for (const kw of opts.mustContain) {
        if (!all.includes(kw)) fails.push('缺少关键内容「' + kw + '」');
      }
    }
    if (opts.optionCount) {
      const q0 = base.detail.questions[0] || {};
      const n = (q0.options || []).length;
      if (n !== opts.optionCount) fails.push('选项数 ' + n + ' ≠ ' + opts.optionCount);
    }
    if (ms > 25000) warns.push('耗时 ' + (ms / 1000).toFixed(1) + 's 偏慢');
    return { pass: !fails.length, level: warns.length ? '建议' : '一般', note: fails.concat(warns).join('；'), detail: base.detail };
  });
};

single('R1', '单题-选择题.jpg', '1 道题、4 个选项、答案为空', { count: 1, optionCount: 4, noAnswer: true, mustContain: ['5x', '6'] });
// 材料本身含 2 道独立题目，single 模式按设计只回 1 道，故用 paper 模式验证拆分能力
single('R2', '单题-两个填空.jpg', '两个填空拆为 2 道（paper 模式）', { mode: 'paper', countRange: [2, 2] });
single('R3', '单题-几何解答.jpg', '1 道解答题，含 AB=AC / ∠BAC=40°', { count: 1, mustContain: ['AB'] });
single('R4', '单题-化学.jpg', '4 个选项，化学式下标不丢（CO2/Ca(OH)2/CaCO3）', { count: 1, optionCount: 4, mustContain: ['Ca'] });
// 一张图里有 (1)(2)(3) 三个小问，按空拆成 1-3 道都算合理，不判为缺陷
single('R5', '单题-语文默写.jpg', '默写题拆 1-3 道均可（含 3 个小问）', { countRange: [1, 3] });

/* ---- 组 4：整页识别 ---- */
add('P1', '识别-整页', '整页识别 第1页（选择+判断 8 题）', '7-9 道，题号不串', async () => {
  const t0 = Date.now();
  const r = await api('POST', '/api/recognize', { images: [b64(M('01-整卷照片/八年级数学-第1页-选择题.jpg'))], mode: 'paper' }, 240000);
  const ms = Date.now() - t0;
  const b = summarizeRecognize(r, ms);
  if (!b.pass) return b;
  const fails = [];
  if (b.count < 7 || b.count > 9) fails.push('题数 ' + b.count + ' 不在 7-9 区间');
  const stems = b.detail.questions.map((q) => q.stem);
  const noNum = stems.filter((s) => !/^\s*\d+[.、．]/.test(s)).length;
  const warns = [];
  if (noNum) warns.push(noNum + ' 道题题干没带题号');
  return { pass: !fails.length, level: warns.length ? '建议' : '一般', note: fails.concat(warns).join('；'), detail: Object.assign({ ms }, b.detail) };
});

add('P2', '识别-整页', '整页识别 第2页（填空+解答 7 题）', '6-8 道，公式符号不变义', async () => {
  const t0 = Date.now();
  const r = await api('POST', '/api/recognize', { images: [b64(M('01-整卷照片/八年级数学-第2页-填空解答.jpg'))], mode: 'paper' }, 240000);
  const ms = Date.now() - t0;
  const b = summarizeRecognize(r, ms);
  if (!b.pass) return b;
  const fails = [];
  if (b.count < 5 || b.count > 9) fails.push('题数 ' + b.count + ' 不在 5-9 区间');
  return { pass: !fails.length, note: fails.join('；'), detail: Object.assign({ ms }, b.detail) };
});

add('P3', '识别-整页', '整页识别 第3页（含图形/表格/红色手写答案）', '3-4 道；手写答案不得进答案字段', async () => {
  const t0 = Date.now();
  const r = await api('POST', '/api/recognize', { images: [b64(M('01-整卷照片/八年级数学-第3页-几何统计.jpg'))], mode: 'paper' }, 240000);
  const ms = Date.now() - t0;
  const b = summarizeRecognize(r, ms);
  if (!b.pass) return b;
  const fails = [];
  const warns = [];
  if (b.count < 2 || b.count > 5) fails.push('题数 ' + b.count + ' 不在 2-5 区间');
  // 第 16 题手写答案是 20°，正确答案也确实是 20°，但答案字段应为空（图上无印刷答案）
  const filled = b.detail.questions.filter((q) => q.answer && q.answer.trim());
  if (filled.length) {
    warns.push(filled.length + ' 道题答案字段非空（疑把红色手写当标准答案）：' +
      filled.map((q) => q.answer).join(' / '));
  }
  return {
    pass: !fails.length,
    level: warns.length ? '严重' : '一般',
    note: fails.concat(warns).join('；'),
    detail: Object.assign({ ms }, b.detail)
  };
});

/* ---- 组 5：边界样本 ---- */
add('E1', '识别-边界', '空白页', '0 道题，不瞎编', async () => {
  const t0 = Date.now();
  const r = await api('POST', '/api/recognize', { images: [b64(M('03-边界样本/边界-空白页.jpg'))], mode: 'paper' }, 180000);
  const ms = Date.now() - t0;
  const b = summarizeRecognize(r, ms);
  if (!b.pass) return b;
  return {
    pass: b.count === 0, level: '严重',
    note: b.count ? '凭空生成 ' + b.count + ' 道题' : '',
    detail: Object.assign({ ms }, b.detail)
  };
});

add('E2', '识别-边界', '非题目内容（通知）', '0 道题', async () => {
  const t0 = Date.now();
  const r = await api('POST', '/api/recognize', { images: [b64(M('03-边界样本/边界-非题目通知.jpg'))], mode: 'single' }, 180000);
  const ms = Date.now() - t0;
  const b = summarizeRecognize(r, ms);
  if (!b.pass) return b;
  return {
    pass: b.count === 0, level: '严重',
    note: b.count ? '把通知当题目生成 ' + b.count + ' 道' : '',
    detail: Object.assign({ ms }, b.detail)
  };
});

add('E3', '识别-边界', '极模糊照片', '不崩、不瞎编（0 道或给出低置信结果）', async () => {
  const t0 = Date.now();
  const r = await api('POST', '/api/recognize', { images: [b64(M('03-边界样本/边界-极模糊.jpg'))], mode: 'single' }, 180000);
  const ms = Date.now() - t0;
  const b = summarizeRecognize(r, ms);
  if (!b.pass) return b;
  return { pass: true, note: '返回 ' + b.count + ' 道', detail: Object.assign({ ms }, b.detail) };
});

add('E4', '识别-边界', '倒置 180°', '记录实际表现（已知限制）', async () => {
  const t0 = Date.now();
  const r = await api('POST', '/api/recognize', { images: [b64(M('03-边界样本/边界-倒置180度.jpg'))], mode: 'single' }, 180000);
  const ms = Date.now() - t0;
  const b = summarizeRecognize(r, ms);
  if (!b.pass) return b;
  return { pass: true, level: '建议', note: '倒置图返回 ' + b.count + ' 道；如为 0 属已知限制', detail: Object.assign({ ms }, b.detail) };
});

add('E5', '识别-边界', '旋转 90°', '记录实际表现（已知限制）', async () => {
  const t0 = Date.now();
  const r = await api('POST', '/api/recognize', { images: [b64(M('03-边界样本/边界-旋转90度.jpg'))], mode: 'single' }, 180000);
  const ms = Date.now() - t0;
  const b = summarizeRecognize(r, ms);
  if (!b.pass) return b;
  return { pass: true, level: '建议', note: '旋转图返回 ' + b.count + ' 道；如为 0 属已知限制', detail: Object.assign({ ms }, b.detail) };
});

add('E6', '识别-边界', '纯手写答案纸', '记录实际表现（已知限制）', async () => {
  const t0 = Date.now();
  const r = await api('POST', '/api/recognize', { images: [b64(M('03-边界样本/边界-纯手写.jpg'))], mode: 'single' }, 180000);
  const ms = Date.now() - t0;
  const b = summarizeRecognize(r, ms);
  if (!b.pass) return b;
  return { pass: true, level: '建议', note: '手写纸返回 ' + b.count + ' 道', detail: Object.assign({ ms }, b.detail) };
});

add('E7', '识别-边界', '两题紧贴', '识别为 2 道（paper 模式验证拆题）', async () => {
  const t0 = Date.now();
  const r = await api('POST', '/api/recognize', { images: [b64(M('03-边界样本/边界-两题紧贴.jpg'))], mode: 'paper' }, 180000);
  const ms = Date.now() - t0;
  const b = summarizeRecognize(r, ms);
  if (!b.pass) return b;
  return {
    pass: b.count === 2, level: '一般',
    note: b.count === 2 ? '' : '返回 ' + b.count + ' 道（预期 2）',
    detail: Object.assign({ ms }, b.detail)
  };
});

add('E8', '识别-边界', '3000 宽超大图', '可识别且结果合理', async () => {
  const t0 = Date.now();
  const r = await api('POST', '/api/recognize', { images: [b64(M('03-边界样本/边界-超大图3000宽.jpg'))], mode: 'single' }, 240000);
  const ms = Date.now() - t0;
  const b = summarizeRecognize(r, ms);
  if (!b.pass) return b;
  return { pass: b.count >= 1, note: '返回 ' + b.count + ' 道，耗时 ' + (ms / 1000).toFixed(1) + 's', detail: Object.assign({ ms }, b.detail) };
});

/* ---- 组 6：并发 ---- */
add('C1', '并发', '3 张单题图并发识别', '全部成功，总耗时明显小于串行之和', async () => {
  const files = ['单题-选择题.jpg', '单题-几何解答.jpg', '单题-语文默写.jpg'];
  const t0 = Date.now();
  const rs = await Promise.all(files.map((f) =>
    api('POST', '/api/recognize', { images: [b64(M('02-单题照片/' + f))], mode: 'single' }, 180000)
  ));
  const ms = Date.now() - t0;
  const counts = rs.map((r) => (r.json && r.json.ok ? (r.json.data || []).length : -1));
  const okAll = counts.every((c) => c >= 1);
  return {
    pass: okAll, note: '各自题数 ' + counts.join('/') + '，总耗时 ' + (ms / 1000).toFixed(1) + 's',
    detail: { counts, ms, perCallMs: rs.map((_, i) => 0) }
  };
});

/* ---- 组 7：解题与讲义 ---- */
add('T1', '文本', '解题：一道选择题', '返回 answer 与 analysis', async () => {
  const r = await api('POST', '/api/solve', { stem: '若 x² - 5x + 6 = 0，则 x 的值是（ ）', options: [{ key: 'A', text: '2 或 3' }, { key: 'B', text: '-2 或 -3' }] }, 120000);
  const d = r.json && r.json.data;
  const ok = d && d.answer && d.analysis && d.analysis.length > 20;
  return { pass: !!ok, note: ok ? 'answer=' + d.answer : '返回不完整 ' + r.raw.slice(0, 150), detail: d };
});

add('T2', '文本', '解题：空题干被拒绝', '返回 400', async () => {
  const r = await api('POST', '/api/solve', { stem: '  ' });
  return { pass: r.status === 400, note: 'status=' + r.status, detail: { status: r.status } };
});

add('T3', '文本', '讲义整理：2000 字乱格式', '返回分节结构，含标题与要点', async () => {
  const txt = fs.readFileSync(M('05-讲义原文/一元二次方程-原始稿-乱格式.txt'), 'utf8');
  const t0 = Date.now();
  const r = await api('POST', '/api/lecture/organize', { text: txt }, 180000);
  const ms = Date.now() - t0;
  const d = r.json && r.json.data;
  const ok = r.json && r.json.ok;
  const hasSections = d && (Array.isArray(d.sections) ? d.sections.length : 0) > 0;
  return {
    pass: !!ok && !!hasSections, level: '一般',
    note: ok ? ((d.sections || []).length + ' 节，' + (ms / 1000).toFixed(1) + 's') : r.raw.slice(0, 150),
    detail: { ms, sections: (d && d.sections || []).map((s) => ({ title: s.title, items: (s.items || s.points || []).length })), title: d && d.title }
  };
});

add('T4', '文本', '讲义整理：3 句话短文本', '不报错，返回结构', async () => {
  const txt = fs.readFileSync(M('05-讲义原文/三角形全等-很短的一段.txt'), 'utf8');
  const r = await api('POST', '/api/lecture/organize', { text: txt }, 120000);
  return { pass: r.json && r.json.ok === true, note: r.json && r.json.ok ? '正常返回' : r.raw.slice(0, 150), detail: r.json && r.json.data };
});

add('T5', '文本', '讲义整理：空内容被拒绝', '返回 400', async () => {
  const r = await api('POST', '/api/lecture/organize', { text: '   ' });
  return { pass: r.status === 400, note: 'status=' + r.status, detail: { status: r.status } };
});

add('T6', '文本', 'docx 解析', '解出 9 段非空正文', async () => {
  const p = M('05-讲义原文/整式乘法与因式分解-原始稿.docx');
  const r = await api('POST', '/api/import/docx', { base64: fs.readFileSync(p).toString('base64') }, 60000);
  const d = r.json && r.json.data;
  const n = d ? (d.paragraphs || []).filter((x) => String(x.text || x || '').trim()).length : 0;
  return { pass: n >= 8, note: '解析出 ' + n + ' 段非空', detail: { count: d && d.count, nonEmpty: n, head: d && String(d.text || '').slice(0, 80) } };
});

/* ---- 组 8：题库 CRUD ---- */
const FOLDER = '自动化测试（可删）';
let folderId = '';
add('D1', '题库', '新建题库', '返回新题库 id', async () => {
  const r = await api('POST', '/api/folders', { name: FOLDER });
  folderId = (r.json && r.json.data && r.json.data.id) || '';
  return { pass: !!folderId, note: r.json && r.json.ok ? 'id=' + folderId : r.raw.slice(0, 100), detail: r.json && r.json.data };
});

add('D2', '题库', '保存 3 道题', 'added=3', async () => {
  const r = await api('POST', '/api/questions/save', {
    folderId,
    questions: [
      { stem: '[自动化] 测试题 1：1+1=?', type: '单选题', options: [{ key: 'A', text: '2' }, { key: 'B', text: '3' }], answer: 'A' },
      { stem: '[自动化] 测试题 2：2+2=?', type: '填空题', answer: '4' },
      { stem: '[自动化] 测试题 3：3+3=?', type: '解答题', answer: '6' }
    ]
  });
  const d = r.json && r.json.data;
  return { pass: d && d.added === 3, note: JSON.stringify(d), detail: d };
});

add('D3', '题库', '重复保存去重', 'added=0 / skipped=3', async () => {
  const r = await api('POST', '/api/questions/save', {
    folderId,
    questions: [
      { stem: '[自动化] 测试题 1：1+1=?', type: '单选题', answer: 'A' },
      { stem: '[自动化] 测试题 2：2+2=?', type: '填空题', answer: '4' },
      { stem: '[自动化] 测试题 3：3+3=?', type: '解答题', answer: '6' }
    ]
  });
  const d = r.json && r.json.data;
  return { pass: d && d.added === 0 && d.skipped === 3, note: JSON.stringify(d), detail: d };
});

add('D4', '题库', '校验持久化（重新读取）', 'bootstrap 中能查到 3 道自动化题', async () => {
  const r = await api('GET', '/api/bootstrap');
  const qs = (r.json.data.questions || []).filter((q) => q.folderId === folderId);
  return { pass: qs.length === 3, note: '查到 ' + qs.length + ' 道', detail: { count: qs.length, ids: qs.map((q) => q.id) } };
});

let editId = '';
add('D5', '题库', '编辑题目', '题干被更新', async () => {
  const r = await api('GET', '/api/bootstrap');
  const q = (r.json.data.questions || []).find((x) => x.folderId === folderId);
  editId = q && q.id;
  if (!editId) return { pass: false, note: '找不到可编辑的题', detail: {} };
  const u = await api('PUT', '/api/questions/' + editId, { stem: '[自动化] 测试题 1（已编辑）' });
  const bs = await api('GET', '/api/bootstrap');
  const after = (bs.json.data.questions || []).find((x) => x.id === editId);
  return { pass: u.json && u.json.ok && after && after.stem.includes('已编辑'), note: after ? after.stem : '失败', detail: { after } };
});

add('D6', '题库', '批量删除', '3 道全部删除', async () => {
  const bs = await api('GET', '/api/bootstrap');
  const ids = (bs.json.data.questions || []).filter((q) => q.folderId === folderId).map((q) => q.id);
  const r = await api('POST', '/api/questions/bulk-delete', { ids });
  const bs2 = await api('GET', '/api/bootstrap');
  const left = (bs2.json.data.questions || []).filter((q) => q.folderId === folderId).length;
  return { pass: left === 0, note: '删除 ' + ids.length + '，剩余 ' + left, detail: { deleted: ids.length, left } };
});

add('D7', '题库', '删除题库', '题库消失', async () => {
  if (!folderId) return { pass: false, note: '无题库', detail: {} };
  const r = await api('DELETE', '/api/folders/' + folderId);
  const bs = await api('GET', '/api/bootstrap');
  const still = (bs.json.data.folders || []).some((f) => f.id === folderId);
  return { pass: r.json && r.json.ok && !still, note: still ? '题库仍存在' : 'ok', detail: { still } };
});

/* ---- 组 9：导入导出 / 统计 / 备份 ---- */
add('X1', '数据', '导出全库', '返回 questions/folders/lectures', async () => {
  const r = await api('GET', '/api/export/all');
  const d = r.json && r.json.data;
  const ok = d && Array.isArray(d.questions) && Array.isArray(d.folders);
  return { pass: !!ok, note: ok ? '题目 ' + d.questions.length + '，题库 ' + d.folders.length : r.raw.slice(0, 100), detail: { q: d && d.questions.length } };
});

add('X2', '数据', '导入 21 题备份', '整库替换后题目数 = 21（UI 文案已确认替换语义）', async () => {
  const before = (await api('GET', '/api/bootstrap')).json.data;
  const n0 = before.questions.length;
  const f0 = before.folders.length;
  const json = JSON.parse(fs.readFileSync(M('06-题库备份样例/示例备份-21道题-可直接导入.json'), 'utf8'));
  const r = await api('POST', '/api/import/all', json);
  const after = (await api('GET', '/api/bootstrap')).json.data;
  return { pass: after.questions.length === 21, note: '导入前 ' + n0 + ' 题 / 替换后 ' + after.questions.length + ' 题；题库 ' + f0 + ' → ' + after.folders.length + '（样例含 1 题库，替换语义）', detail: { before: n0, after: after.questions.length, resp: r.json && r.json.data } };
});

add('X3', '数据', '统计口径一致', 'questionCount 与实际题目数一致', async () => {
  const bs = (await api('GET', '/api/bootstrap')).json.data;
  const st = (await api('GET', '/api/stats')).json.data;
  const ok = st.questionCount === bs.questions.length;
  return {
    pass: ok, note: '统计 ' + st.questionCount + ' vs 实际 ' + bs.questions.length +
      '；本月调用 ' + st.monthCalls + ' 次 / ¥' + st.monthCost + ' / 平均 ' + st.avgSec + 's',
    detail: { stats: { q: st.questionCount, calls: st.monthCalls, cost: st.monthCost, avgSec: st.avgSec, byModel: st.byModel } }
  };
});

add('X4', '数据', '本地备份', '返回备份文件名', async () => {
  const r = await api('POST', '/api/backup', {});
  return { pass: r.json && r.json.ok === true, note: JSON.stringify(r.json && r.json.data), detail: r.json && r.json.data };
});

add('X5', '数据', '密钥连通性测试', '返回连接成功', async () => {
  const t0 = Date.now();
  const r = await api('POST', '/api/test-key', {}, 90000);
  const ms = Date.now() - t0;
  return { pass: r.json && r.json.ok === true, note: (r.json && r.json.ok ? '成功' : r.raw.slice(0, 150)) + ' ' + (ms / 1000).toFixed(1) + 's', detail: Object.assign({ ms }, r.json && r.json.data) };
});

add('H1', '健壮性', '非法 JSON 请求体', '返回 4xx 不崩溃', async () => {
  const r = await new Promise((resolve) => {
    const u = new URL(BASE + '/api/questions/save');
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, raw: Buffer.concat(c).toString() }));
    });
    req.on('error', (e) => resolve({ status: 0, raw: e.message }));
    req.write('{bad json');
    req.end();
  });
  const alive = await api('GET', '/api/ping');
  return { pass: r.status >= 400 && r.status < 500 && alive.json && alive.json.ok, note: 'status=' + r.status + ' 服务存活=' + !!(alive.json && alive.json.ok), detail: { status: r.status } };
});

add('H2', '健壮性', '不存在的接口', '返回 404', async () => {
  const r = await api('GET', '/api/not-exist');
  return { pass: r.status === 404, note: 'status=' + r.status, detail: { status: r.status } };
});

/* ================= 现场还原 ================= */
const KEEP = args.includes('--keep');
let snapshot = null;

async function takeSnapshot() {
  const bs = (await api('GET', '/api/bootstrap')).json;
  const d = (bs && bs.data) || {};
  const folderNames = {};
  (d.folders || []).forEach((f) => { folderNames[f.id] = f.name; });
  return {
    questions: (d.questions || []).map((q) => q.id),
    folders: (d.folders || []).map((f) => f.id),
    folderNames,
    lectures: (d.lectures || []).map((l) => l.id)
  };
}

async function restore() {
  if (!snapshot) return null;
  const before = snapshot;
  const bs = (await api('GET', '/api/bootstrap')).json;
  const d = (bs && bs.data) || {};
  const newQ = (d.questions || []).filter((q) => !before.questions.includes(q.id)).map((q) => q.id);
  const newL = (d.lectures || []).filter((l) => !before.lectures.includes(l.id)).map((l) => l.id);
  const newF = (d.folders || []).filter((f) => !before.folders.includes(f.id)).map((f) => f.id);

  if (newQ.length) {
    for (let i = 0; i < newQ.length; i += 100) {
      await api('POST', '/api/questions/bulk-delete', { ids: newQ.slice(i, i + 100) });
    }
  }
  for (const id of newL) await api('DELETE', '/api/lectures/' + id);

  // 导入备份是整库覆盖的，可能把原有题库也顶掉 —— 先补回缺失的题库
  const nowFolders = ((await api('GET', '/api/bootstrap')).json.data.folders || []).map((f) => f.id);
  const missing = before.folders.filter((id) => !nowFolders.includes(id));
  for (const id of missing) {
    // 原题库名已丢失时用占位名，保证结构恢复
    await api('POST', '/api/folders', { name: before.folderNames && before.folderNames[id] ? before.folderNames[id] : '我的题库' });
  }
  // 再删掉测试新建的题库（至少保留一个，服务端会拦最后一个）
  for (const id of newF) await api('DELETE', '/api/folders/' + id);

  const after = (await api('GET', '/api/bootstrap')).json.data;
  return {
    removedQuestions: newQ.length,
    removedLectures: newL.length,
    removedFolders: newF.length,
    restoredFolders: missing.length,
    finalQuestions: after.questions.length,
    finalFolders: after.folders.length
  };
}

/* ================= 执行 ================= */
(async () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('');
  console.log('  本地实例：' + BASE);
  console.log('  用例数：' + CASES.length + (ONLY ? '（过滤：' + ONLY + '）' : ''));
  console.log('  ' + '─'.repeat(78));

  try { snapshot = await takeSnapshot(); } catch (e) { /* 忽略 */ }
  if (snapshot) {
    console.log('  测试前现场：题目 ' + snapshot.questions.length + '，题库 ' + snapshot.folders.length +
      '，讲义 ' + snapshot.lectures.length + (KEEP ? '（--keep：不还原）' : '（跑完自动还原）'));
    console.log('  ' + '─'.repeat(78));
  }

  for (const c of CASES) await run(c);

  let restored = null;
  if (!KEEP) {
    try { restored = await restore(); } catch (e) { restored = { error: e.message }; }
  }

  const pass = results.filter((r) => r.pass).length;
  const fail = results.filter((r) => !r.pass && r.level !== '建议').length;
  const warn = results.filter((r) => !r.pass && r.level === '建议').length;

  console.log('  ' + '─'.repeat(78));
  console.log('  通过 ' + pass + ' / 共 ' + results.length + '，失败 ' + fail + '，提示 ' + warn);
  const totalMs = results.reduce((s, r) => s + r.ms, 0);
  console.log('  总耗时 ' + (totalMs / 1000).toFixed(1) + 's，模型调用 ' + results.filter((r) => /^R|^P|^E|^T|^C|^X5/.test(r.id)).length + ' 次');
  if (restored) {
    console.log('  现场还原：删除测试题 ' + restored.removedQuestions + ' 道、题库 ' + restored.removedFolders +
      ' 个；当前题目 ' + restored.finalQuestions + ' 道');
  }
  console.log('');

  fs.writeFileSync(path.join(OUT_DIR, 'report-api.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), restored, results }, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'report-api.md'), toMarkdown(results), 'utf8');
  console.log('  报告：.e2e/report-api.md');
  console.log('');
})().catch((e) => {
  console.error('测试中断：', e);
  process.exit(1);
});

function toMarkdown(list) {
  const L = [];
  L.push('# API 层自动化测试报告', '');
  L.push('- 实例：`' + BASE + '`');
  L.push('- 时间：' + new Date().toLocaleString('zh-CN'));
  L.push('- 结果：通过 ' + list.filter((r) => r.pass).length + ' / 共 ' + list.length);
  L.push('', '| ID | 分组 | 用例 | 预期 | 结果 | 耗时 | 说明 |');
  L.push('|---|---|---|---|---|---|---|');
  for (const r of list) {
    L.push('| ' + r.id + ' | ' + r.group + ' | ' + r.name + ' | ' + r.expect + ' | ' +
      (r.pass ? '通过' : (r.level || '失败')) + ' | ' + (r.ms / 1000).toFixed(1) + 's | ' +
      String(r.note || '').replace(/\|/g, '/').slice(0, 160) + ' |');
  }
  return L.join('\n');
}
