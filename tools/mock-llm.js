// 本地模拟模型服务：用来验证「识别 → 解析 → 入库」整条链路，不消耗真实额度
const http = require('http');

const RECOGNIZE_REPLY = {
  questions: [
    {
      stem: '如图 1，在 △ABC 中，∠A=60°，AB=4，AC=6，则 BC 的长为（  ）',
      type: '单选题',
      options: [
        { key: 'A', text: '2√7' },
        { key: 'B', text: '4' },
        { key: 'C', text: '2√13' },
        { key: 'D', text: '6' }
      ],
      answer: '',
      analysis: '',
      knowledge: ['余弦定理', '解三角形'],
      difficulty: '中等',
      subject: '初中数学',
      grade: '九年级',
      no: '12',
      hasImage: true,
      figures: [
        { label: '图1', desc: '三角形示意图', bbox: [0.55, 0.15, 0.35, 0.4] }
      ]
    },
    {
      stem: '把 2x² - 4x + 1 配方后得到 ____。',
      type: '填空题',
      options: [],
      answer: '',
      analysis: '',
      knowledge: ['配方法'],
      difficulty: '中等',
      hasImage: false
    }
  ]
};

const SOLVE_REPLY = {
  answer: '2√7',
  analysis: '由余弦定理 BC²=AB²+AC²-2·AB·AC·cosA=16+36-2×4×6×0.5=28，所以 BC=2√7。',
  knowledge: ['余弦定理'],
  difficulty: '中等'
};

const ORGANIZE_REPLY = {
  title: '一元二次方程 复习讲义',
  sections: [
    { heading: '一、定义', blocks: [{ type: 'text', content: '只含一个未知数，且最高次数为 2 的整式方程叫一元二次方程。' }, { type: 'points', items: ['一般形式 ax²+bx+c=0', '条件 a≠0'] }] },
    { heading: '二、解法', blocks: [{ type: 'points', items: ['直接开平方法', '配方法', '公式法'] }, { type: 'formula', content: 'x = (-b ± √(b²-4ac)) / 2a' }] }
  ]
};

const PARSE_TEXT_REPLY = {
  questions: [
    {
      no: '1',
      stem: '若 x² - 5x + 6 = 0，则 x 的值为（  ）',
      type: '单选题',
      options: [{ key: 'A', text: '2 或 3' }, { key: 'B', text: '-2 或 -3' }, { key: 'C', text: '1 或 6' }, { key: 'D', text: '0 或 5' }],
      answer: 'A',
      analysis: '因式分解得 (x-2)(x-3)=0。',
      knowledge: ['一元二次方程', '因式分解'],
      difficulty: '简单',
      subject: '初中数学',
      grade: '九年级'
    },
    {
      no: '2',
      stem: '已知方程 x² + 2x + m = 0 有两个相等实根，则 m = ____。',
      type: '填空题',
      options: [],
      answer: '1',
      analysis: '判别式 Δ = 4 - 4m = 0，所以 m = 1。',
      knowledge: ['判别式'],
      difficulty: '中等',
      subject: '初中数学',
      grade: '九年级'
    }
  ]
};

const SIMILAR_REPLY = {
  questions: [
    {
      stem: '若 x² - 7x + 12 = 0，则 x 的值为（  ）',
      type: '单选题',
      options: [{ key: 'A', text: '3 或 4' }, { key: 'B', text: '-3 或 -4' }, { key: 'C', text: '2 或 6' }, { key: 'D', text: '1 或 12' }],
      knowledge: ['一元二次方程'],
      difficulty: '简单'
    },
    {
      stem: '已知 x² - 6x + k = 0 有两个相等实根，则 k = ____。',
      type: '填空题',
      options: [],
      knowledge: ['判别式'],
      difficulty: '中等'
    }
  ]
};

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let payload = {};
    try { payload = JSON.parse(body); } catch (e) {}
    const text = JSON.stringify(payload.messages || '');
    let reply = RECOGNIZE_REPLY;
    if (text.indexOf('解答下面这道题') >= 0) reply = SOLVE_REPLY;
    else if (text.indexOf('整理成讲义结构') >= 0) reply = ORGANIZE_REPLY;
    else if (text.indexOf('把下面的文字材料拆成题目') >= 0) reply = PARSE_TEXT_REPLY;
    else if (text.indexOf('同考点、同题型的变式题') >= 0) reply = SIMILAR_REPLY;
    else if (text.indexOf('只回复两个字') >= 0) reply = '正常';

    const content = typeof reply === 'string' ? reply : JSON.stringify(reply);
    const out = {
      id: 'mock',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1580, completion_tokens: 420, total_tokens: 2000 }
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out));
  });
});

server.listen(7999, '127.0.0.1', () => console.log('mock 模型服务已启动 http://127.0.0.1:7999/v1'));
