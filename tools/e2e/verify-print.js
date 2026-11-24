#!/usr/bin/env node
/** 验证打印输出：纸面内容是否只含试卷、卷头是否像真实校内试卷 */
const fs = require('fs');
const path = require('path');
const { launch, sleep } = require('./cdp');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.e2e', 'shots');
const BASE = 'http://127.0.0.1:7788';

const PAPER = {
  title: '八年级数学单元测试',
  subject: '数学',
  grade: '八年级',
  sections: [{
    id: 's1',
    heading: '一、选择题（每题 3 分，共 12 分）',
    blocks: [
      {
        id: 'q1', type: 'question', typeLabel: '单选题',
        stem: '若 $x^2-5x+6=0$，则 $x$ 的值是（　　）',
        options: [{ key: 'A', text: '2 或 3' }, { key: 'B', text: '−2 或 −3' }, { key: 'C', text: '1 或 6' }, { key: 'D', text: '−1 或 −6' }],
        answer: 'A', analysis: '因式分解得 (x−2)(x−3)=0。'
      },
      {
        id: 'q2', type: 'question', typeLabel: '单选题',
        stem: '下列图形中，既是轴对称图形又是中心对称图形的是（　　）',
        options: [{ key: 'A', text: '等边三角形' }, { key: 'B', text: '平行四边形' }, { key: 'C', text: '圆' }, { key: 'D', text: '正五边形' }],
        answer: 'C', analysis: '圆同时满足两个条件。'
      }
    ]
  }, {
    id: 's2',
    heading: '二、解答题（共 8 分）',
    blocks: [
      {
        id: 'q3', type: 'question', typeLabel: '解答题',
        stem: '如图，在 △ABC 中，AB=AC，∠BAC=40°，求 ∠B 的度数。',
        options: [], answer: '70°', analysis: '等边对等角，(180°−40°)÷2=70°。'
      }
    ]
  }]
};

const CFG = {
  columns: 1, fontSize: 14, lineHeight: 1.9, answerArea: 'line', answerLines: 3,
  showStudentInfo: true, examInfo: '满分 100 分　考试时间 90 分钟',
  showMeta: true, school: '郑州市第七中学', teacher: '王老师',
  showDate: false, showAnswer: false, showFooter: true, showSubtitle: true
};

const BANNED = ['题库与讲义系统', 'Step-', 'step-1', 'Turbo', '模型', '127.0.0.1', 'localhost'];

(async () => {
  const b = await launch({
    port: 9500 + Math.floor(Math.random() * 80),
    profile: path.join(ROOT, '.e2e', 'profile-' + Date.now())
  });
  const cdp = b.cdp;
  try {
    await cdp.goto(BASE + '/?view=lecture', 2500);

    // 场景一：没点「打印」，直接在任意页面按 Ctrl+P —— 不能是空白页
    await cdp.send('Emulation.setEmulatedMedia', { media: 'print' });
    await sleep(600);
    const normalText = await cdp.text('.content');
    await cdp.screenshot(path.join(OUT, 'print-normal-page.png'));
    console.log('普通页面打印时可见文字长度：' + String(normalText || '').trim().length);
    await cdp.send('Emulation.setEmulatedMedia', { media: 'screen' });
    await sleep(400);

    // 场景二：讲义页点「打印」

    // 直接往 store 里放一份试卷（TK 是全局对象），并打上打印标记
    await cdp.eval(
      'TK.store.printTarget = { lecture: ' + JSON.stringify(PAPER) + ', config: ' + JSON.stringify(CFG) + ' };' +
      'document.body.classList.add("print-ready");' +
      'document.title = "题库与讲义系统";return true;'
    );
    await sleep(900);

    // 检查打印区文本
    const text = await cdp.text('.print-area');
    console.log('—— 打印区文本 ——');
    console.log(String(text).replace(/\n{2,}/g, '\n').slice(0, 700));

    const hits = BANNED.filter((w) => String(text).indexOf(w) >= 0);
    console.log('\n违禁词命中：', hits.length ? hits.join(', ') : '无');

    const info = await cdp.eval(
      'var p=document.querySelector(".print-area .paper");' +
      'var h=document.querySelector(".print-area .doc-header");' +
      'return JSON.stringify({hasPaper:!!p, hasHeader:!!h,' +
      'title:(document.querySelector(".print-area .doc-title")||{}).innerText,' +
      'school:(document.querySelector(".print-area .doc-school")||{}).innerText,' +
      'meta:(document.querySelector(".print-area .doc-meta")||{}).innerText,' +
      'exam:(document.querySelector(".print-area .doc-exam")||{}).innerText,' +
      'finish:(document.querySelector(".print-area .doc-finish")||{}).innerText});'
    );
    console.log('\n—— 卷头结构 ——');
    console.log(JSON.stringify(JSON.parse(info), null, 2));

    // 切到打印媒体，截图看实际纸面
    await cdp.send('Emulation.setEmulatedMedia', { media: 'print' });
    await sleep(700);
    await cdp.screenshot(path.join(OUT, 'print-preview.png'));

    // 生成 PDF（关闭页眉页脚，模拟"理想打印"）
    const pdf = await cdp.send('Page.printToPDF', {
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0
    });
    const pdfPath = path.join(ROOT, '.e2e', 'paper-sample.pdf');
    fs.writeFileSync(pdfPath, Buffer.from(pdf.data, 'base64'));
    console.log('\nPDF 已生成：' + pdfPath + '（' + Math.round(fs.statSync(pdfPath).size / 1024) + ' KB）');

    console.log('\n结论：' + (hits.length === 0 ? '纸面干净，无系统名/模型名' : '仍有可疑内容：' + hits.join(',')));
  } catch (e) {
    console.error('失败:', e.message);
  } finally {
    await b.close();
  }
})();
