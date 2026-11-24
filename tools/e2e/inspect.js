/**
 * 单页诊断探针：打开指定页面，打印关键 DOM 状态。
 * 用法：node tools/e2e/inspect.js settings
 */
const path = require('path');
const { launch, sleep } = require('./cdp');

const BASE = process.env.BASE || 'http://127.0.0.1:7788';
const view = process.argv[2] || 'settings';

(async () => {
  const s = await launch({ port: 9351, profile: path.join(__dirname, '..', '..', '.e2e', 'profile-inspect-' + Date.now()) });
  const cdp = s.cdp;
  await cdp.goto(BASE + '/?view=' + view, 2500);

  if (view === 'settings') {
    const info = await cdp.eval(
      'var i=document.querySelector(".content input[type=password]");' +
      'if(!i)return {none:true};' +
      'return {type:i.type, val:i.value, valLen:(i.value||"").length, ph:i.placeholder, phLen:(i.placeholder||"").length, cls:i.className};'
    );
    console.log('密码框：', JSON.stringify(info, null, 2));
    const body = await cdp.text('.content');
    const m = (body || '').match(/sk-[A-Za-z0-9]{20,}/g);
    console.log('页面文本中 sk- 片段：', m ? m.map((x) => x.slice(0, 12) + '…') : '无');
    console.log('页面文本前 300 字：', (body || '').slice(0, 300).replace(/\n/g, ' | '));
  }

  if (view === 'bank') {
    const st = await cdp.eval(
      'return {' +
      'rows: document.querySelectorAll(".el-table__row").length,' +
      'trs: document.querySelectorAll(".content tr").length,' +
      'empty: (document.querySelector(".el-table__empty-text")||{}).innerText || "",' +
      'cards: document.querySelectorAll(".q-row, .qitem, .bank-item").length,' +
      'txt: (document.querySelector(".content")||{}).innerText ? document.querySelector(".content").innerText.slice(0,400) : ""' +
      '};'
    );
    console.log('题库页：', JSON.stringify(st, null, 2));
  }

  if (view === 'import') {
    const tab = await cdp.eval(
      'var t=Array.from(document.querySelectorAll(".el-tabs__item"));' +
      'var h=t.find(function(e){return e.innerText.indexOf("PDF")>=0});if(h)h.click();return t.map(function(e){return e.innerText});'
    );
    console.log('页签：', tab);
    await sleep(1200);
    const st = await cdp.eval(
      'return {inputs: document.querySelectorAll(".content input[type=file]").length,' +
      'thumbs: document.querySelectorAll(".pdf-page-thumb").length,' +
      'hasPdfJs: typeof window.pdfjsLib,' +
      'canvas: document.querySelectorAll(".pdf-canvas canvas").length};'
    );
    console.log('PDF 区：', JSON.stringify(st, null, 2));
  }

  await cdp.screenshot(path.join(__dirname, '..', '..', '.e2e', 'inspect-' + view + '.png'));
  await s.close();
})();
