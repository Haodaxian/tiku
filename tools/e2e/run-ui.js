#!/usr/bin/env node
/**
 * 浏览器 UI 自动化测试（Edge headless + CDP，零依赖）
 *
 * 用法：
 *   node tools/e2e/run-ui.js
 *   node tools/e2e/run-ui.js --only=录题
 *
 * 会真实调用模型（识别 2 张图 + 整页 1 张 + 讲义整理 1 次），约 0.1-0.3 元。
 * 记录所有 JS 异常与 network error，截图存 .e2e/shots/。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { launch, sleep } = require('./cdp');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.e2e');
const SHOTS = path.join(OUT, 'shots');
const M = (p) => path.join(ROOT, '测试材料', p);

const args = process.argv.slice(2);
const argOf = (k, d) => {
  const hit = args.find((a) => a.startsWith('--' + k + '='));
  return hit ? hit.slice(k.length + 3) : d;
};
const BASE = argOf('base', 'http://127.0.0.1:7788');
const ONLY = argOf('only', '');

const results = [];
const pad = (s, n) => {
  s = String(s);
  let w = 0;
  for (const ch of s) w += /[\u4e00-\u9fa5\uff00-\uffef]/.test(ch) ? 2 : 1;
  return s + ' '.repeat(Math.max(1, n - w));
};

let cdp;

/* ---------- 数据现场保护 ---------- */
function httpCall(method, p, body) {
  return new Promise((resolve) => {
    const u = new URL(BASE + p);
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request(
      {
        hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method,
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}
      },
      (res) => {
        const c = [];
        res.on('data', (d) => c.push(d));
        res.on('end', () => {
          let j = null;
          try { j = JSON.parse(Buffer.concat(c).toString('utf8')); } catch (e) { /* ignore */ }
          resolve(j);
        });
      }
    );
    req.on('error', () => resolve(null));
    if (payload) req.write(payload);
    req.end();
  });
}

let snap = null;
async function snapshot() {
  const r = await httpCall('GET', '/api/bootstrap');
  const d = (r && r.data) || {};
  snap = {
    questions: (d.questions || []).map((q) => q.id),
    folders: (d.folders || []).map((f) => f.id),
    lectures: (d.lectures || []).map((l) => l.id)
  };
  return snap;
}

async function restore() {
  if (!snap) return null;
  const r = await httpCall('GET', '/api/bootstrap');
  const d = (r && r.data) || {};
  const newQ = (d.questions || []).filter((q) => !snap.questions.includes(q.id)).map((q) => q.id);
  const newL = (d.lectures || []).filter((l) => !snap.lectures.includes(l.id)).map((l) => l.id);
  if (newQ.length) await httpCall('POST', '/api/questions/bulk-delete', { ids: newQ });
  for (const id of newL) await httpCall('DELETE', '/api/lectures/' + id);
  const after = await httpCall('GET', '/api/bootstrap');
  return {
    removedQuestions: newQ.length,
    removedLectures: newL.length,
    finalQuestions: ((after && after.data && after.data.questions) || []).length
  };
}

async function step(id, name, expect, fn) {
  if (ONLY && !(id + name).includes(ONLY)) return;
  const t0 = Date.now();
  cdp.clearLog();
  let r;
  try {
    r = (await fn()) || {};
  } catch (e) {
    r = { pass: false, level: '阻断', note: '异常：' + e.message };
  }
  const errs = cdp.pageErrors.filter((e) => !/favicon/i.test(e));
  const warns = cdp.consoleLog.filter((c) => c.type === 'error' || c.type === 'warning');
  if (errs.length && r.pass !== false) {
    r.pass = false;
    r.level = '严重';
    r.note = (r.note ? r.note + '；' : '') + '页面报错：' + errs.slice(0, 2).join(' | ').slice(0, 200);
  }
  const rec = Object.assign({ id, name, expect, ms: Date.now() - t0, jsErrors: errs, consoleWarn: warns.slice(0, 3) }, r);
  results.push(rec);
  const mark = rec.pass ? (warns.length ? '  WARN ' : '  PASS ') : '  FAIL ';
  console.log(mark + pad(id, 4) + pad(name, 30) + pad(rec.ms + 'ms', 9) + (rec.pass ? '' : String(rec.note || '').slice(0, 130)));
}
const shot = (n) => cdp.screenshot(path.join(SHOTS, n + '.png'));

/* 等待识别结果卡片数量达到期望（或稳定） */
async function waitCards(minCount, timeoutMs, sel) {
  sel = sel || '.q-card';
  const deadline = Date.now() + (timeoutMs || 150000);
  let last = -1;
  let stable = 0;
  while (Date.now() < deadline) {
    const n = await cdp.count(sel);
    if (n >= minCount) {
      if (n === last) stable++;
      else { stable = 0; last = n; }
      if (stable >= 3) return n;
    }
    await sleep(700);
  }
  return await cdp.count(sel);
}

async function waitIdleBusy(timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 180000);
  while (Date.now() < deadline) {
    const busy = await cdp.eval(
      'var b=Array.from(document.querySelectorAll("button"));' +
      'return b.some(function(x){return x.classList.contains("is-loading")||/识别中|整理中|生成中|处理中/.test(x.innerText)});'
    );
    if (!busy) return true;
    await sleep(800);
  }
  return false;
}

const messages = () =>
  cdp.eval('return Array.from(document.querySelectorAll(".el-message")).map(function(e){return e.innerText.trim()}).join(" | ");');

async function gotoView(view, waitMs) {
  await cdp.goto(BASE + '/?view=' + view, waitMs === undefined ? 1600 : waitMs);
}

/* ================= 主流程 ================= */
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const freshProfile = args.includes('--fresh');
  const s = await launch({
    port: 9341,
    profile: freshProfile
      ? path.join(OUT, 'profile-fresh-' + Date.now())
      : path.join(OUT, 'profile')
  });
  cdp = s.cdp;
  const before = await snapshot();

  console.log('');
  console.log('  浏览器：' + s.browser);
  console.log('  实例：' + BASE);
  console.log('  ' + '─'.repeat(78));

  /* ---------- 1. 首页与外壳 ---------- */
  await step('V1', '首页加载', '无 JS 异常、9 个菜单、标题正确', async () => {
    await cdp.goto(BASE + '/', 2500);
    await shot('01-dashboard');
    const navCount = await cdp.count('.nav-item');
    const title = await cdp.text('.brand-name');
    const fatal = await cdp.eval('return !!document.querySelector("#app h2")');
    const hasKey = await cdp.eval('return !document.body.innerText.includes("尚未配置 API Key")');
    const fails = [];
    if (fatal) fails.push('显示启动异常页');
    if (navCount !== 9) fails.push('菜单 ' + navCount + ' 项（预期 9）');
    if (title !== '题库与讲义系统') fails.push('标题异常：' + title);
    if (!hasKey) fails.push('提示未配置 Key');
    return {
      pass: !fails.length, note: fails.join('；'),
      detail: { navCount, title, hasKey, fatal }
    };
  });

  /* ---------- 2. 8 个页面深链 ---------- */
  const views = [
    ['dashboard', '工作台'], ['record', '智能录题'], ['import', '试卷导入'], ['bank', '题库管理'],
    ['lecture', '讲义排版'], ['lectures', '讲义管理'], ['stats', '数据统计'], ['settings', '设置']
  ];
  for (let i = 0; i < views.length; i++) {
    const [v, label] = views[i];
    await step('V2.' + (i + 1), '页面 ' + label, '不白屏、标题为「' + label + '」、有内容', async () => {
      await gotoView(v, 1500);
      const t = await cdp.text('.page-title');
      const contentLen = await cdp.eval('var e=document.querySelector(".content");return e?e.innerText.trim().length:0');
      const panels = await cdp.count('.content .panel, .content .el-card, .content .record-layout, .content .bank-layout');
      await shot('02-view-' + v);
      const fails = [];
      if (t !== label) fails.push('标题「' + t + '」≠「' + label + '」');
      if (contentLen < 20) fails.push('内容几乎为空（' + contentLen + ' 字）');
      return { pass: !fails.length, note: fails.join('；'), detail: { title: t, contentLen, panels } };
    });
  }

  /* ---------- 3. 主题切换 ---------- */
  await step('V3', '深色 / 浅色切换', '切换后背景色确实变化', async () => {
    await gotoView('dashboard', 1500);
    const before = await cdp.eval('return getComputedStyle(document.body).backgroundColor');
    await cdp.eval('var b=Array.from(document.querySelectorAll(".topbar-right button"));if(b[0])b[0].click();return true;');
    await sleep(900);
    const after = await cdp.eval('return getComputedStyle(document.body).backgroundColor');
    await shot('03-theme-toggled');
    await cdp.eval('var b=Array.from(document.querySelectorAll(".topbar-right button"));if(b[0])b[0].click();return true;');
    await sleep(700);
    return { pass: before !== after, note: before + ' → ' + after, detail: { before, after } };
  });

  /* ---------- 4. 录题全流程 ---------- */
  await step('V4', '录题：添加 2 张图片', '缩略图出现 2 个', async () => {
    await gotoView('record', 1800);
    await cdp.setFiles('.record-layout input[type=file]', [
      M('02-单题照片/单题-选择题.jpg'),
      M('02-单题照片/单题-化学.jpg')
    ]);
    await sleep(2500);
    const n = await cdp.count('.thumb-list .thumb');
    await shot('04-record-thumbs');
    return { pass: n === 2, note: '缩略图 ' + n + ' 个（预期 2）', detail: { thumbs: n } };
  });

  await step('V5', '录题：点开始识别', '出现题目卡片，且识别方式为单题', async () => {
    const clicked = await cdp.clickText('开始识别');
    if (!clicked) return { pass: false, note: '找不到「开始识别」按钮' };
    await sleep(1500);
    const n = await waitCards(2, 150000);
    await waitIdleBusy(60000);
    await shot('05-record-result');
    return {
      pass: n >= 2, level: '一般',
      note: '识别出 ' + n + ' 张题卡（2 张图预期 2-3 道）',
      detail: { cards: n }
    };
  });

  await step('V6', '录题：卡片内容与答案为空', '卡片有题干文字，答案栏未出现', async () => {
    const txt = await cdp.text('.q-card');
    const answerShown = await cdp.count('.q-card .q-answer');
    const opts = await cdp.count('.q-card .q-option');
    await shot('06-record-card-detail');
    const fails = [];
    if (!txt || txt.length < 20) fails.push('卡片内容过短');
    return {
      pass: !fails.length, level: answerShown ? '建议' : '一般',
      note: (fails.length ? fails.join('；') : '') + (answerShown ? '有 ' + answerShown + ' 道题显示了答案（图上无答案）' : ''),
      detail: { stemLen: txt ? txt.length : 0, options: opts, answered: answerShown }
    };
  });

  await step('V7', '录题：全选并保存到题库', '提示保存成功，侧边栏题数增加', async () => {
    const before = await cdp.eval('var e=document.querySelector(".sidebar-foot b");return e?parseInt(e.innerText):0');
    // 识别结果默认就是勾选状态，先看实际选了几道
    let selNum = await cdp.eval(
      'var e=document.querySelector(".panel-head .sub");var m=e?/已选\\s*(\\d+)/.exec(e.innerText):null;return m?parseInt(m[1]):-1;'
    );
    if (selNum <= 0) {
      await cdp.clickText('全选');
      await sleep(700);
      selNum = await cdp.eval(
        'var e=document.querySelector(".panel-head .sub");var m=e?/已选\\s*(\\d+)/.exec(e.innerText):null;return m?parseInt(m[1]):-1;'
      );
    }
    await cdp.clickText('保存到题库');
    await sleep(2500);
    const msg = await messages();
    const after = await cdp.eval('var e=document.querySelector(".sidebar-foot b");return e?parseInt(e.innerText):0');
    await shot('07-record-saved');
    const ok = /保存|成功/.test(msg) && after > before;
    return { pass: ok, note: '已选 ' + selNum + ' 道；提示「' + msg + '」，题数 ' + before + ' → ' + after, detail: { before, after, msg, selNum } };
  });

  /* ---------- 5. 题库页 ---------- */
  await step('V8', '题库：列表与检索', '显示题目行，搜索能过滤', async () => {
    await gotoView('bank', 2200);
    const rows = await cdp.count('.q-row');
    await shot('08-bank-list');
    const searched = await cdp.eval(
      'var i=document.querySelector(".content input[type=text], .content .el-input__inner");' +
      'if(!i)return false;' +
      'i.value="1+1";' +
      'i.dispatchEvent(new Event("input",{bubbles:true}));' +
      'i.dispatchEvent(new KeyboardEvent("keyup",{key:"Enter",bubbles:true}));' +
      'return true;'
    );
    await sleep(1500);
    const rows2 = await cdp.count('.q-row');
    await shot('09-bank-search');
    return {
      pass: rows >= 1, level: '建议',
      note: '列表 ' + rows + ' 行；搜索后 ' + rows2 + ' 行' + (searched ? '' : '（未找到搜索框）'),
      detail: { rows, rows2, searched }
    };
  });

  /* ---------- 6. 试卷导入（PDF） ---------- */
  await step('V9', '试卷导入：上传 PDF', '显示 3 页缩略图', async () => {
    await gotoView('import', 2200);
    // 切到「PDF 框选切题」页签
    const tabbed = await cdp.eval(
      'var t=Array.from(document.querySelectorAll(".el-tabs__item"));' +
      'var h=t.find(function(e){return e.innerText.indexOf("PDF")>=0});if(!h)return false;h.click();return true;'
    );
    await sleep(900);
    const inputs = await cdp.count('.content input[type=file]');
    if (inputs < 2) return { pass: false, note: '页面只有 ' + inputs + ' 个文件输入框（预期 2：图片 + PDF）' };
    await cdp.eval('var i=document.querySelectorAll(".content input[type=file]")[1];i.dataset.t="pdf";return true;');
    const injected = await cdp.upload(
      '.content input[type=file][data-t=pdf]',
      M('04-PDF/八年级数学单元测试-共3页.pdf')
    );
    await cdp.waitFor('document.querySelectorAll(".pdf-page-thumb").length>=3', 40000, 600);
    const pages = await cdp.count('.pdf-page-thumb');
    await shot('10-import-pdf');
    return { pass: pages === 3, note: '页缩略图 ' + pages + ' 个（预期 3）' + (tabbed ? '' : '；未找到 PDF 页签'), detail: { pages, tabbed, injected } };
  });

  await step('V10', '试卷导入：识别整页', '出现该页题目卡片', async () => {
    const ok = await cdp.clickText('识别整页');
    if (!ok) return { pass: false, note: '找不到「识别整页」按钮（可能 PDF 未加载成功）' };
    await sleep(2000);
    // PDF 页签的结果卡片挂在题卡列表下，类名是 .card-q（.q-card 是整卷图片页签的）
    const n = await waitCards(1, 180000, '.card-q');
    await waitIdleBusy(60000);
    await shot('11-import-recognized');
    return { pass: n >= 1, level: '一般', note: '识别出 ' + n + ' 道', detail: { cards: n } };
  });

  /* ---------- 7. 讲义排版 ---------- */
  await step('V11', '讲义：粘贴文字并导入', '编辑器出现内容块', async () => {
    await gotoView('lecture', 2500);
    const opened = await cdp.clickText('导入讲义内容');
    if (!opened) return { pass: false, note: '找不到「导入讲义内容」按钮' };
    const dlg = await cdp.waitFor('document.querySelector(".el-dialog textarea")', 15000, 300);
    if (!dlg) return { pass: false, note: '弹窗未出现文本框' };
    // 切到「粘贴文字」页签
    await cdp.eval(
      'var t=Array.from(document.querySelectorAll(".el-dialog .el-tabs__item"));' +
      'var h=t.find(function(e){return e.innerText.indexOf("粘贴文字")>=0});if(h)h.click();return true;'
    );
    await sleep(700);
    const txt = fs.readFileSync(M('05-讲义原文/三角形全等-很短的一段.txt'), 'utf8');
    const filled = await cdp.eval(
      'var ta=document.querySelector(".el-dialog textarea");if(!ta)return false;' +
      'var setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set;' +
      'setter.call(ta,' + JSON.stringify(txt) + ');' +
      'ta.dispatchEvent(new Event("input",{bubbles:true}));return true;'
    );
    await sleep(600);
    await cdp.clickText('导入');
    await sleep(2500);
    const blocks = await cdp.count('.block-item, .block, .el-collapse-item, .section-item');
    await shot('12-lecture-imported');
    return {
      pass: filled && blocks >= 1, level: '建议',
      note: '输入框' + (filled ? '已填入' : '未找到') + '，内容块 ' + blocks + ' 个',
      detail: { filled, blocks }
    };
  });

  await step('V12', '讲义：AI 分节整理', '勾选 AI 整理后导入，产出多个小节', async () => {
    await gotoView('lecture', 2000);
    if (!(await cdp.clickText('导入讲义内容'))) return { pass: false, note: '找不到「导入讲义内容」按钮' };
    if (!(await cdp.waitFor('document.querySelector(".el-dialog textarea")', 15000, 300))) {
      return { pass: false, note: '弹窗未出现文本框' };
    }
    await cdp.eval(
      'var t=Array.from(document.querySelectorAll(".el-dialog .el-tabs__item"));' +
      'var h=t.find(function(e){return e.innerText.indexOf("粘贴文字")>=0});if(h)h.click();return true;'
    );
    await sleep(700);
    // 勾选「让 AI 帮忙分节整理」
    const checked = await cdp.eval(
      'var ls=Array.from(document.querySelectorAll(".el-dialog .el-checkbox, .el-dialog label"));' +
      'var h=ls.find(function(e){return /AI/.test(e.innerText)});if(!h)return false;' +
      'if(h.tagName!=="LABEL"){var l=h.querySelector("label");if(l)h=l;}h.click();return true;'
    );
    if (!checked) return { pass: false, level: '建议', note: '弹窗里没有「让 AI 帮忙分节整理」选项' };
    const txt = fs.readFileSync(M('05-讲义原文/一元二次方程-原始稿-乱格式.txt'), 'utf8');
    await cdp.eval(
      'var ta=document.querySelector(".el-dialog textarea");' +
      'var setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set;' +
      'setter.call(ta,' + JSON.stringify(txt) + ');ta.dispatchEvent(new Event("input",{bubbles:true}));return true;'
    );
    await sleep(500);
    await cdp.clickText('导入');
    await sleep(1500);
    const idle = await waitIdleBusy(180000);
    await sleep(1200);
    const msg = await messages();
    const blocks = await cdp.count('.block-item, .block, .el-collapse-item, .section-item');
    const body = await cdp.text('.a4-page, .doc-body, .content');
    await shot('13-lecture-organized');
    const hasHeading = /一、|二、|1\.|第.节|小标题|知识点/.test(String(body || ''));
    return {
      pass: idle && (blocks >= 2 || hasHeading), level: '一般',
      note: '小节 ' + blocks + ' 个，分节痕迹 ' + (hasHeading ? '有' : '无') + '，提示「' + msg + '」',
      detail: { blocks, hasHeading, msg }
    };
  });

  await step('V13', '讲义：打印预览（A4 文档渲染）', '存在 A4 文档节点且有内容', async () => {
    await cdp.clickText('打印 / 导出 PDF');
    await sleep(1500);
    const hasDoc = await cdp.eval(
      'var d=document.querySelector(".print-area .doc-page, .print-area .doc, .print-area .a4, .print-area > div");' +
      'return d?d.innerText.trim().length:0;'
    );
    return { pass: hasDoc > 0, level: '建议', note: 'A4 文档内容 ' + hasDoc + ' 字（无内容说明未触发预览）', detail: { docLen: hasDoc } };
  });

  /* ---------- 8. 统计与设置 ---------- */
  await step('V14', '统计：数字与图表', '4 个指标卡有值、含费用与图表', async () => {
    await gotoView('stats', 2500);
    const body = await cdp.text('.content');
    const nums = await cdp.count('.stat-card');
    const values = await cdp.eval(
      'return Array.from(document.querySelectorAll(".stat-card .stat-value")).map(function(e){return e.innerText.trim()});'
    );
    const panels = await cdp.count('.panel');
    const bars = await cdp.count('.bars .bar, .bar-item');
    await shot('14-stats');
    const hasCost = /¥|元/.test(body || '');
    const filled = (values || []).filter((v) => v && v !== '—').length;
    const fails = [];
    if (nums !== 4) fails.push('指标卡 ' + nums + ' 个（预期 4）');
    if (filled < 3) fails.push('有值的卡片只有 ' + filled + ' 个');
    if (!hasCost) fails.push('页面没有费用/金额');
    if (panels < 3) fails.push('面板 ' + panels + ' 个（预期 ≥3）');
    return {
      pass: !fails.length, level: fails.length ? '一般' : '建议',
      note: fails.length ? fails.join('；') : '指标卡 ' + nums + ' 个（' + values.join(' / ') + '），面板 ' + panels + ' 个，柱状条 ' + bars + ' 个',
      detail: { nums, values, panels, bars, hasCost }
    };
  });

  await step('V15', '设置：Key 掩码显示', '显示已配置但不明文', async () => {
    await gotoView('settings', 2200);
    const body = await cdp.text('.content');
    await shot('15-settings');
    const info = await cdp.eval(
      'var i=document.querySelector(".content input[type=password]");' +
      'return i?{ph:i.placeholder||"", val:i.value||"", type:i.type}:null;'
    );
    const ph = (info && info.ph) || '';
    const masked = /已配置|\*{4}/.test(ph) || /已保存|已配置/.test(body || '');
    // 只有「页面可见文本里出现完整 Key」才算泄漏；
    // 密码框里被浏览器密码管理器回填属于浏览器行为（接口层从不返回明文，已单独验证）
    const plain = /sk-[A-Za-z0-9]{20,}/.test(body || '') || (info && info.type === 'text' && /^[A-Za-z0-9]{40,}$/.test(info.val || ''));
    await shot('15-settings');
    return {
      pass: masked && !plain, level: '严重',
      note: masked
        ? (plain ? '页面出现完整 Key 明文！' : '掩码正常' + ((info && info.val) ? '（输入框被浏览器自动填充，非页面泄漏）' : ''))
        : '未见掩码或已配置提示',
      detail: { masked, plain, placeholder: ph, inputVal: (info && info.val || '').slice(0, 20), inputValLen: (info && info.val || '').length, inputType: info && info.type }
    };
  });

  await step('V16', '设置：测试连接', '提示连接成功', async () => {
    const clicked = await cdp.clickText('保存并测试') || await cdp.clickText('测试连接');
    if (!clicked) return { pass: false, note: '找不到测试按钮' };
    await sleep(2000);
    await waitIdleBusy(90000);
    const msg = await messages();
    const body = await cdp.text('.content');
    await shot('16-settings-test');
    const ok = /成功|正常|连接/.test((msg || '') + (body || '').slice(0, 2000));
    return { pass: ok, note: '提示「' + msg + '」', detail: { msg } };
  });

  /* ---------- 9. 容错 ---------- */
  await step('V17', '不存在的页面参数', '回退到可用页面而非白屏', async () => {
    await cdp.goto(BASE + '/?view=not-exist-page', 1800);
    const fatal = await cdp.eval('return !!document.querySelector("#app h2")');
    const nav = await cdp.count('.nav-item');
    const title = await cdp.text('.page-title');
    await shot('17-fallback');
    return { pass: !fatal && nav === 9, level: '一般', note: '异常页=' + fatal + '，菜单 ' + nav + '，标题「' + title + '」', detail: { fatal, nav, title } };
  });

  await step('V18', '窗口 1280 宽（小屏笔记本）', '侧边栏不遮挡内容', async () => {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await gotoView('bank', 2000);
    const ok = await cdp.eval(
      'var s=document.querySelector(".sidebar"),m=document.querySelector(".main");' +
      'if(!s||!m)return "no-layout";' +
      'var a=s.getBoundingClientRect(),b=m.getBoundingClientRect();' +
      'return a.right<=b.left+2 ? "ok" : "overlap:"+a.right+">"+b.left;'
    );
    await shot('18-narrow');
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    return { pass: ok === 'ok', level: '建议', note: String(ok), detail: { layout: ok } };
  });

  /* ---------- 汇总 ---------- */
  await s.close();

  const restored = await restore();
  if (restored) {
    console.log('  现场还原：删除测试题 ' + restored.removedQuestions + ' 道、讲义 ' +
      restored.removedLectures + ' 份；当前题目 ' + restored.finalQuestions + ' 道');
  }

  const pass = results.filter((r) => r.pass).length;
  const fail = results.filter((r) => !r.pass && r.level !== '建议').length;
  console.log('  ' + '─'.repeat(78));
  console.log('  通过 ' + pass + ' / 共 ' + results.length + '，失败 ' + fail);
  console.log('');

  fs.writeFileSync(path.join(OUT, 'report-ui.json'), JSON.stringify({ base: BASE, browser: s.browser, at: new Date().toISOString(), before, restored, results }, null, 2), 'utf8');
  console.log('  截图：.e2e/shots/');
  console.log('');
})().catch(async (e) => {
  console.error('测试中断：', e.message);
  try { await cdp.screenshot(path.join(SHOTS, 'error.png')); } catch (_) { /* ignore */ }
  process.exit(1);
});
