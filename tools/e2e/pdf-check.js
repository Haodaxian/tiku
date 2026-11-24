/**
 * PDF 上传专项诊断：看看到底卡在哪一步。
 */
const path = require('path');
const fs = require('fs');
const { launch, sleep } = require('./cdp');

const ROOT = path.join(__dirname, '..', '..');
const BASE = process.env.BASE || 'http://127.0.0.1:7788';
const PDF = path.join(ROOT, '测试材料', '04-PDF', '八年级数学单元测试-共3页.pdf');

(async () => {
  const s = await launch({ port: 9361, profile: path.join(ROOT, '.e2e', 'profile-pdf-' + Date.now()) });
  const cdp = s.cdp;
  cdp.clearLog();

  await cdp.goto(BASE + '/?view=import', 2500);
  console.log('pdfjsLib =', await cdp.eval('return typeof window.pdfjsLib'));
  console.log('workerSrc =', await cdp.eval('return (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions.workerSrc) || "(空)"'));

  // 切到 PDF 页签
  const tabs = await cdp.eval('return Array.from(document.querySelectorAll(".el-tabs__item")).map(function(e){return e.innerText})');
  console.log('页签：', tabs);
  await cdp.eval(
    'var t=Array.from(document.querySelectorAll(".el-tabs__item"));' +
    'var h=t.find(function(e){return e.innerText.indexOf("PDF")>=0});if(h)h.click();return true;'
  );
  await sleep(1000);

  const inputs = await cdp.eval('return document.querySelectorAll(".content input[type=file]").length');
  console.log('文件输入框数量：', inputs);

  await cdp.eval('document.querySelectorAll(".content input[type=file]")[1].dataset.t="pdf";return true;');
  console.log('开始塞入 PDF：' + path.basename(PDF) + ' (' + Math.round(fs.statSync(PDF).size / 1024) + 'KB)');
  const injected = await cdp.injectFile('.content input[type=file][data-t=pdf]', PDF, 'application/pdf');
  console.log('injectFile 返回 files.length =', injected);

  console.log('塞入后 files.length =', await cdp.eval(
    'var i=document.querySelectorAll(".content input[type=file]")[1];return i.files?i.files.length:-1'
  ));
  console.log('input 是否可见:', await cdp.eval(
    'var i=document.querySelectorAll(".content input[type=file]")[1];var r=i.getBoundingClientRect();return r.width+"x"+r.height'
  ));
  // 手动补一次 change 事件
  console.log('手动派发 change：', await cdp.eval(
    'var i=document.querySelectorAll(".content input[type=file]")[1];i.dispatchEvent(new Event("change",{bubbles:true}));return true;'
  ));

  for (let i = 1; i <= 12; i++) {
    await sleep(2000);
    const st = await cdp.eval(
      'return {thumbs: document.querySelectorAll(".pdf-page-thumb").length,' +
      'loading: document.body.innerText.indexOf("正在打开")>=0,' +
      'name: (document.querySelector(".pdf-workspace")||{}).innerText ? document.querySelector(".pdf-workspace").innerText.slice(0,60) : ""};'
    );
    console.log('  ' + (i * 2) + 's 缩略图=' + st.thumbs + ' 加载中=' + st.loading + (st.name ? ' 区:' + st.name.replace(/\n/g, ' ') : ''));
    if (st.thumbs > 0) break;
  }

  console.log('--- 页面报错 ---');
  console.log(cdp.pageErrors.length ? cdp.pageErrors.join('\n') : '(无)');
  console.log('--- 控制台 ---');
  console.log(cdp.consoleLog.slice(-12).map((c) => c.type + ': ' + c.text.slice(0, 160)).join('\n') || '(无)');

  await cdp.screenshot(path.join(ROOT, '.e2e', 'inspect-pdf.png'));
  await s.close();
})();
