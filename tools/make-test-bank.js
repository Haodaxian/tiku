#!/usr/bin/env node
'use strict';
/**
 * 生成测试题库：各题型 + 部分带图，用来检验「生成试卷」的版式。
 *
 * 插图由 tools/png-draw.js 程序绘制（不联网、不找素材），保证图文相符。
 * 题目通过接口保存，走的是和平时录题完全一样的入库流程。
 *
 * 用法：
 *   node tools/make-test-bank.js                     # 存到默认数据目录
 *   node tools/make-test-bank.js --port=7790         # 指定服务端口
 *   node tools/make-test-bank.js --host=127.0.0.1
 *   node tools/make-test-bank.js --preview           # 只打印题目清单，不入库
 *
 * @author zz_lxf
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const draw = require('./png-draw');

const args = process.argv.slice(2);
const argOf = (k, d) => {
  const hit = args.find((a) => a.startsWith('--' + k + '='));
  return hit ? hit.slice(k.length + 3) : d;
};
const PORT = Number(argOf('port', process.env.TIKU_PORT || 7788));
const HOST = argOf('host', '127.0.0.1');
const PREVIEW = args.includes('--preview');

const ROOT = path.join(__dirname, '..');

/* ---------------- HTTP ---------------- */
function request(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request({
      hostname: HOST, port: PORT, path: pathname, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(raw); } catch (e) { /* 非 JSON */ }
        if (json && json.ok) return resolve(json.data);
        reject(new Error((json && json.message) || raw.slice(0, 200)));
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function post(pathname, body) { return request('POST', pathname, body); }
function get(pathname) { return request('GET', pathname); }

/* ---------------- 插图落盘 ---------------- */
const UPLOAD_DIR = path.join(ROOT, 'uploads-test');
const figures = [];

function saveFigure(name, canvas, desc, label) {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const file = name + '.png';
  const buf = canvas.toPNG();
  fs.writeFileSync(path.join(UPLOAD_DIR, file), buf);
  const url = '/uploads/' + file;
  const fig = { id: 'fig_' + name, label: label || '图1', desc, url, width: canvas.w, height: canvas.h };
  figures.push(fig);
  return fig;
}

/** 生成一道带图题：题干里内嵌图片，同时挂到图形库 */
function withFigure(question, canvas, figDesc) {
  const fig = saveFigure(question.id + '_fig', canvas, figDesc, '图1');
  question.stemHtml = question.stem + '<br><img src="' + fig.url + '" data-fig="1" data-w="260">';
  question.figures = [fig];
  return question;
}

/* ---------------- 题目数据 ---------------- */

const QUESTIONS = [];

/** 加一道题 */
function q(o) {
  o.id = 'q_test_' + (QUESTIONS.length + 1) + '_' + Math.random().toString(36).slice(2, 6);
  o.options = o.options || [];
  o.knowledge = o.knowledge || [];
  o.tags = o.tags || [];
  o.figures = o.figures || [];
  o.answer = o.answer || '';
  o.analysis = o.analysis || '';
  o.source = o.source || '测试卷';
  o.year = o.year || '2026';
  o.region = o.region || '郑州市';
  o.chapter = o.chapter || '';
  o.difficulty = o.difficulty || '中等';
  o.grade = o.grade || '八年级';
  o.subject = o.subject || '数学';
  QUESTIONS.push(o);
  return o;
}

/* ===== 物理（7 道，3 道带图） ===== */

q({
  type: '单选题', subject: '物理', difficulty: '简单',
  stem: '下列关于惯性的说法，正确的是（　　）',
  options: [
    { key: 'A', text: '物体运动得越快，惯性越大' },
    { key: 'B', text: '静止的物体没有惯性' },
    { key: 'C', text: '惯性是物体保持原有运动状态的性质' },
    { key: 'D', text: '受力与否决定有没有惯性' }
  ],
  answer: 'C',
  analysis: '惯性是物体保持原来运动状态不变的性质，一切物体在任何情况下都有惯性，与速度、受力、质量无关。',
  knowledge: ['牛顿第一定律', '惯性'], tags: ['力学', '基础']
});

q({
  type: '单选题', subject: '物理', difficulty: '中等',
  stem: '如图所示电路中，电源电压保持不变。闭合开关后，滑动变阻器的滑片向右移动，灯泡的亮度将（　　）',
  options: [
    { key: 'A', text: '变亮' },
    { key: 'B', text: '变暗' },
    { key: 'C', text: '不变' },
    { key: 'D', text: '无法判断' }
  ],
  answer: 'B',
  analysis: '滑片右移时接入电路的电阻变大，电路总电阻变大，电流减小，灯泡变暗。',
  knowledge: ['欧姆定律', '动态电路'], tags: ['电学']
});
withFigure(QUESTIONS[QUESTIONS.length - 1], draw.circuitDiagram(560), '电路图：电源、开关、定值电阻、滑动变阻器与灯泡串联');

q({
  type: '填空题', subject: '物理', difficulty: '简单',
  stem: '一个物体受到 30 N 的水平拉力，在水平面上匀速直线运动，则它受到的摩擦力大小为 ______ N，方向是 ______。',
  answer: '30；水平向左',
  analysis: '匀速直线运动时合力为零，摩擦力与拉力是一对平衡力，大小相等、方向相反。',
  knowledge: ['二力平衡', '摩擦力'], tags: ['力学']
});

q({
  type: '填空题', subject: '物理', difficulty: '较难',
  stem: '如图是光从空气射入玻璃时的折射情况。图中 ______ 是法线，折射角 ______ 反射角（选填"大于""小于"或"等于"）。',
  answer: '竖直虚线；小于',
  analysis: '过入射点垂直于界面的那条虚线是法线；光从空气斜射入玻璃时折射角小于入射角（此处入射角等于反射角）。',
  knowledge: ['光的折射', '光的反射'], tags: ['光学']
});
withFigure(QUESTIONS[QUESTIONS.length - 1], draw.lightPath(560), '光路图：界面上方为空气，下方为玻璃，含法线、入射光线、反射光线与折射光线');

q({
  type: '解答题', subject: '物理', difficulty: '较难',
  stem: '如图所示，杠杆处于水平平衡状态。已知支点O到A点的距离为 20 cm，到B点的距离为 30 cm，A点悬挂的物体重 90 N，求B点所挂钩码的重力。',
  answer: '60 N',
  analysis: '由杠杆平衡条件 F₁L₁ = F₂L₂，得 90 N × 20 cm = F₂ × 30 cm，解得 F₂ = 60 N。',
  knowledge: ['杠杆平衡条件'], tags: ['力学', '计算']
});
withFigure(QUESTIONS[QUESTIONS.length - 1], draw.lever(560), '杠杆示意图：水平杠杆，O 为支点，左端 A 悬挂重物，右端 B 悬挂钩码');

q({
  type: '实验探究题', subject: '物理', difficulty: '中等',
  stem: '在探究"电流与电压、电阻的关系"实验中：\n（1）实验器材除了电源、开关、导线外，还需要 ______ 和 ______；\n（2）滑动变阻器的作用是 ______；\n（3）若闭合开关后电流表无示数，电压表示数接近电源电压，故障可能是 ______（选填"灯泡短路"或"灯泡断路"）。',
  answer: '电流表；电压表；改变待测电阻两端电压（多次测量取平均值）；灯泡断路',
  analysis: '电压表与待测电阻并联、电流表串联；滑动变阻器用于改变电阻两端电压；电压表示数接近电源电压说明与电压表并联的元件断路。',
  knowledge: ['欧姆定律', '实验探究'], tags: ['电学', '实验']
});

/* ===== 数学（13 道，4 道带图） ===== */

q({
  type: '单选题', subject: '数学', difficulty: '简单',
  stem: '下列各数中，最小的数是（　　）',
  options: [
    { key: 'A', text: '−2' },
    { key: 'B', text: '−0.5' },
    { key: 'C', text: '0' },
    { key: 'D', text: '1' }
  ],
  answer: 'A',
  analysis: '在数轴上，越靠左的数越小，故 −2 最小。',
  knowledge: ['有理数大小比较'], tags: ['数与式']
});

q({
  type: '单选题', subject: '数学', difficulty: '中等',
  stem: '如图是二次函数 y = x² − 2x − 3 的图象，下列结论错误的是（　　）',
  options: [
    { key: 'A', text: '开口向上，对称轴为直线 x = 1' },
    { key: 'B', text: '与 x 轴的交点为 −1 和 3' },
    { key: 'C', text: '当 x = 1 时，y 的值最小' },
    { key: 'D', text: '当 x > 0 时，y 随 x 增大而增大' }
  ],
  answer: 'D',
  analysis: '当 x > 1 时 y 才随 x 增大而增大，0 < x < 1 时 y 反而减小，故 D 错误。',
  knowledge: ['二次函数'], tags: ['函数']
});
withFigure(QUESTIONS[QUESTIONS.length - 1], draw.parabolaAxes(520), '二次函数 y = x² − 2x − 3 的图象');

q({
  type: '单选题', subject: '数学', difficulty: '简单',
  stem: '在如图所示的数轴上，点 A 表示的数是（　　）',
  options: [
    { key: 'A', text: '−2' },
    { key: 'B', text: '−0.5' },
    { key: 'C', text: '0.5' },
    { key: 'D', text: '2' }
  ],
  answer: 'B',
  analysis: '数轴上右边的数比左边的大，点 A 位于原点与 −1 之间，表示 −0.5。',
  knowledge: ['数轴', '有理数'], tags: ['数与式']
});
withFigure(QUESTIONS[QUESTIONS.length - 1], draw.numberLine(560), '数轴示意图，标出了点 A');

q({
  type: '多选题', subject: '数学', difficulty: '较难',
  stem: '已知 a > 0，b < 0，且 a + b < 0，则下列结论正确的是（　　）',
  options: [
    { key: 'A', text: 'a < −b' },
    { key: 'B', text: 'ab < 0' },
    { key: 'C', text: 'a ÷ b < 0' },
    { key: 'D', text: 'a² > b²' }
  ],
  answer: 'ABC',
  analysis: 'a + b < 0 且 b < 0 移项得 a < −b，A 正确；a、b 异号，ab < 0、a÷b < 0，B、C 正确；D 无法确定。',
  knowledge: ['有理数运算', '不等式'], tags: ['数与式']
});

q({
  type: '填空题', subject: '数学', difficulty: '简单',
  stem: '计算：√9 + (−2)² − |−3| = ______。',
  answer: '10',
  analysis: '√9 = 3，(−2)² = 4，|−3| = 3，故 3 + 4 − 3 = 10。',
  knowledge: ['实数运算'], tags: ['数与式']
});

q({
  type: '填空题', subject: '数学', difficulty: '中等',
  stem: '如图，在 Rt△ABC 中，∠C = 90°，AC = 6，BC = 8，则斜边 AB 的长为 ______。',
  answer: '10',
  analysis: '由勾股定理 AB = √(AC² + BC²) = √(36 + 64) = 10。',
  knowledge: ['勾股定理'], tags: ['三角形']
});
withFigure(QUESTIONS[QUESTIONS.length - 1], draw.triangleABC(460), '直角三角形 ABC，∠C = 90°，AC = 6，BC = 8');

q({
  type: '填空题', subject: '数学', difficulty: '较难',
  stem: '一个圆柱形容器的底面半径为 3 cm，高为 8 cm，将它装满水后倒入一个底面半径为 4 cm 的圆锥形容器中（水不溢出），圆锥的高为 ______ cm。',
  answer: '6',
  analysis: 'V柱 = π×3²×8 = 72π，V锥 = (1/3)π×4²×h = (16/3)πh，令两者相等得 h = 6。',
  knowledge: ['圆柱与圆锥体积'], tags: ['立体几何']
});

q({
  type: '解答题', subject: '数学', difficulty: '中等',
  stem: '计算：\n（1）(−2)² + 3 × (−1)³ ÷ 2；\n（2）解方程 x/2 − 1 = (x − 4)/3。',
  answer: '（1）−1/2；（2）x = −2',
  analysis: '（1）4 + 3×(−1)÷2 = 4 − 1.5 = −0.5；（2）去分母得 3x − 6 = 2x − 8，解得 x = −2。',
  knowledge: ['实数运算', '一元一次方程'], tags: ['数与式', '方程']
});

q({
  type: '解答题', subject: '数学', difficulty: '较难',
  stem: '如图，⊙O 的半径为 5，弦 AB 距圆心 O 的距离为 3，求弦 AB 的长。',
  answer: '8',
  analysis: '过 O 作 OC ⊥ AB 于 C，由垂径定理得 AC = BC = √(5² − 3²) = 4，所以 AB = 2×4 = 8。',
  knowledge: ['垂径定理', '勾股定理'], tags: ['圆']
});
withFigure(QUESTIONS[QUESTIONS.length - 1], draw.circleTangent(460), '圆 O 与弦 AB，半径 5，圆心到弦的距离为 3');

q({
  type: '解答题', subject: '数学', difficulty: '较难',
  stem: '某商店购进一批文具，进价每件 20 元。市场调查发现：售价每件 25 元时每天可售出 250 件，售价每涨 1 元每天少售 10 件。设售价定为每件 x 元，每天利润为 w 元。\n（1）用 x 表示 w；\n（2）售价定为多少时每天利润最大？最大利润是多少？',
  answer: '（1）w = (x − 20)[250 − 10(x − 25)] = −10x² + 700x − 5000；（2）x = 35 元时利润最大，为 2250 元',
  analysis: '销量为 250 − 10(x − 25)，利润 = (x − 20)×销量，配方得 w = −10(x − 35)² + 2250。',
  knowledge: ['二次函数最值', '销售问题'], tags: ['函数', '应用题']
});

q({
  type: '解答题', subject: '数学', difficulty: '较难',
  stem: '在一个不透明的袋子里装有 4 个红球和 6 个白球，它们除颜色外完全相同。\n（1）从中随机摸出一个球，摸到红球的概率是多少？\n（2）若要使摸到白球的概率为 3/5，需要在袋中再放入几个白球？',
  answer: '（1）2/5；（2）再放入 2 个白球',
  analysis: '（1）4 ÷ 10 = 2/5；（2）设放入 x 个白球，则 (6+x)/(10+x) = 3/5，解得 x = 2。',
  knowledge: ['概率'], tags: ['统计与概率']
});

q({
  type: '解答题', subject: '数学', difficulty: '较难',
  stem: '如图，在△ABC 中，D、E 分别是 AB、AC 的中点，DE ∥ BC，DE = 6 cm。\n（1）求 BC 的长；\n（2）若 △ADE 的面积为 8 cm²，求 △ABC 的面积。',
  answer: '（1）12 cm；（2）32 cm²',
  analysis: 'DE 是中位线，等于 BC 的一半，故 BC = 12；△ADE 与 △ABC 相似比为 1:2，面积比为 1:4，故面积 32 cm²。',
  knowledge: ['三角形中位线', '相似三角形'], tags: ['三角形']
});
withFigure(QUESTIONS[QUESTIONS.length - 1], draw.triangleABC(460), '△ABC 中 D、E 分别为 AB、AC 的中点，DE ∥ BC');

q({
  type: '应用题', subject: '数学', difficulty: '中等',
  stem: '一项工程，甲队单独做需要 12 天完成，乙队单独做需要 18 天完成。两队合作，需要多少天完成？',
  answer: '72/10 = 7.2 天（即 7 天 4.8 小时）',
  analysis: '设合作需 x 天，则 x(1/12 + 1/18) = 1，解得 x = 36/5 = 7.2 天。',
  knowledge: ['列方程解应用题', '工程问题'], tags: ['方程', '应用题']
});

/* ===== 化学（5 道，1 道带图） ===== */

q({
  type: '单选题', subject: '化学', difficulty: '简单',
  stem: '下列气体中，含量约占空气体积 1/5 的是（　　）',
  options: [
    { key: 'A', text: '氮气' },
    { key: 'B', text: '氧气' },
    { key: 'C', text: '二氧化碳' },
    { key: 'D', text: '稀有气体' }
  ],
  answer: 'B',
  analysis: '空气中氮气约占 78%，氧气约占 21%，二氧化碳约 0.03%。',
  knowledge: ['空气的组成'], tags: ['化学']
});

q({
  type: '单选题', subject: '化学', difficulty: '中等',
  stem: '如图是实验室用高锰酸钾制取氧气的装置。下列说法正确的是（　　）',
  options: [
    { key: 'A', text: '试管口应略向下倾斜' },
    { key: 'B', text: '导气管应伸入试管内' },
    { key: 'C', text: '该反应属于分解反应' },
    { key: 'D', text: '收集氧气时可用向下排空气法' }
  ],
  answer: 'C',
  analysis: '试管口应略向上倾斜；导气管只需稍露出橡皮塞；该反应生成物有两种，属于分解反应；氧气密度比空气大，应用向上排空气法。',
  knowledge: ['氧气的制取', '分解反应'], tags: ['化学', '实验']
});
withFigure(QUESTIONS[QUESTIONS.length - 1], draw.circuitDiagram(520), '实验室制取气体装置示意图');

q({
  type: '填空题', subject: '化学', difficulty: '中等',
  stem: '在化学反应 A + B → C + D 中，已知 12 g A 与 10 g B 恰好完全反应，生成 8 g C，则生成 D 的质量是 ______ g。',
  answer: '14',
  analysis: '由质量守恒定律，生成物总质量 = 12 + 10 = 22 g，故 D 为 22 − 8 = 14 g。',
  knowledge: ['质量守恒定律'], tags: ['化学']
});

q({
  type: '解答题', subject: '化学', difficulty: '较难',
  stem: '实验室用 25 g 含杂质的氯酸钾（杂质不溶于水也不参加反应）加热制取氧气，充分反应后固体质量减少 8 g。求原固体中氯酸钾的质量分数。（反应式：2KClO₃ --Δ→ 2KCl + 3O₂↑）',
  answer: '约 81.7%',
  analysis: '固体减少的质量即为生成的氧气质量：2KClO₃ ~ 3O₂，即 245 : 96。设氯酸钾质量为 x，则 245/96 = x/8 g，解得 x ≈ 20.4 g，质量分数 = 20.4/25 ≈ 81.7%。',
  knowledge: ['化学方程式计算', '质量守恒定律'], tags: ['化学', '计算']
});

q({
  type: '实验探究题', subject: '化学', difficulty: '中等',
  stem: '某同学用稀盐酸与碳酸钠粉末反应制取二氧化碳。\n（1）应选用 ______ 装置收集二氧化碳；\n（2）反应方程式为 ______；\n（3）检验二氧化碳的方法是 ______。',
  answer: '向上排空气法；Na₂CO₃ + 2HCl = 2NaCl + H₂O + CO₂↑；将气体通入澄清石灰水，变浑浊',
  analysis: '二氧化碳密度比空气大且能溶于水，故用向上排空气法收集；检验用澄清石灰水。',
  knowledge: ['二氧化碳的制取', '二氧化碳的检验'], tags: ['化学', '实验']
});

/* ===== 语文（4 道） ===== */

q({
  type: '单选题', subject: '语文', difficulty: '简单',
  stem: '下列词语中，加点字读音完全正确的一项是（　　）',
  options: [
    { key: 'A', text: '解剖（pōu）　　畸形（jī）' },
    { key: 'B', text: '解剖（pāo）　　畸形（qí）' },
    { key: 'C', text: '解剖（pōu）　　畸形（jī）' },
    { key: 'D', text: '解剖（pāo）　　畸形（jī）' }
  ],
  answer: 'C',
  analysis: '「解」在此读 pōu；「畸」读 jī，不读 qí。',
  knowledge: ['字音辨析'], tags: ['基础字音']
});

q({
  type: '单选题', subject: '语文', difficulty: '简单',
  stem: '下列成语使用恰当的一项是（　　）',
  options: [
    { key: 'A', text: '他的发言鞭辟入里，让人茅塞顿开。' },
    { key: 'B', text: '这道题他做得easy，简直是差强人意。' },
    { key: 'C', text: '老师对我们的关怀无微不至，沤心沥血。' },
    { key: 'D', text: '他目不暇接地浏览着满园春色。' }
  ],
  answer: 'A',
  analysis: '「差强人意」意为大体还能使人满意；「目不暇接」形容事物太多看不过来；「沤心沥血」含贬义。',
  knowledge: ['成语运用'], tags: ['词语运用']
});

q({
  type: '阅读理解题', subject: '语文', difficulty: '较难',
  stem: '阅读下面的文字，完成后面的题目。\n\n「故乡的秋，是从第一片叶子落下开始的。母亲把晾在院子里的白布收进来，抖一抖，秋天就落了一地。我们兄妹几个蹲在门槛上数落叶，母亲在灶间忙活着，锅盖上的白气一团一团往上冒。多年以后我才明白，那不是秋天落了一地，是母亲把一整个秋天都收进了灶间。」\n（1）用自己的话概括这段文字的主要内容。\n（2）画线句「那不是秋天落了一地，是母亲把一整个秋天都收进了灶间」运用了什么修辞手法？有什么表达效果？\n（3）文中的母亲是一个怎样的人？',
  answer: '（1）写童年故乡的秋天，母亲收布、做饭，"我"数落叶，回忆童年秋日情景。（2）比喻（或对比），把母亲的操劳比作"收进秋天"，含蓄地表现母亲的辛劳与"我"的感动、愧疚。（3）勤劳能干、疼爱孩子、含蓄沉默。',
  analysis: '第（2）问注意"不是……是……"的句式是把比喻与对比结合，突出母亲的辛劳。',
  knowledge: ['记叙文阅读', '修辞手法'], tags: ['阅读理解']
});

q({
  type: '作文题', subject: '语文', difficulty: '较难',
  stem: '请以「原来，______也可以很美」为题，先把题目补充完整，再写一篇不少于 600 字的作文。\n要求：①补充的内容应与文章主题一致；②文章内容具体，有真情实感；③文中不得出现真实的校名和人名。',
  answer: '见学生作文',
  analysis: '本题为半命题作文，考查审题、选材和表达。"可以很美"的立意要落实在具体事件与细节描写上，避免空泛抒情。',
  knowledge: ['命题作文'], tags: ['写作']
});

/* ===== 英语（3 道） ===== */

q({
  type: '单选题', subject: '英语', difficulty: '简单',
  stem: '— ______ do you go to school by? — By bike.',
  options: [
    { key: 'A', text: 'What' },
    { key: 'B', text: 'How' },
    { key: 'C', text: 'When' },
    { key: 'D', text: 'Where' }
  ],
  answer: 'B',
  analysis: '问交通方式用 How；By bike 是方式状语。',
  knowledge: ['特殊疑问句'], tags: ['语法']
});

q({
  type: '单选题', subject: '英语', difficulty: '中等',
  stem: 'If it ______ tomorrow, we will put off the sports meeting.',
  options: [
    { key: 'A', text: 'will rain' },
    { key: 'B', text: 'rains' },
    { key: 'C', text: 'rained' },
    { key: 'D', text: 'is raining' }
  ],
  answer: 'B',
  analysis: '在 if 引导的条件状语从句中，用一般现在时表将来，从句主语 it 用第三人称单数，故用 rains。',
  knowledge: ['条件状语从句'], tags: ['语法']
});

q({
  type: '完形填空题', subject: '英语', difficulty: '较难',
  stem: '完形填空：\nLast summer I went to a small village in the mountains. The air there was fresh and the scenery was beautiful. I met an old farmer near the river. He was 1______ about his farm. When I asked him why he stayed there, he said, "Because I 2______ here. This place is my 3______ ." He asked me to 4______ the cows. The work was not easy, but I felt very 5______ . I learned that happiness sometimes comes from simple things.',
  options: [
    { key: 'A', text: 'proud　　B. grew　　C. home　　D. help　　E. tired' }
  ],
  answer: 'A B C D E',
  analysis: '按上下文：老人对农场感到骄傲（proud），他在那里成长（grew），这里是他的家（home），他让我帮忙（help）喂牛，虽然累（tired）但感到充实。',
  knowledge: ['完形填空', '语境理解'], tags: ['阅读理解']
});

/* ===== 其他学科（6 道，2 道带图） ===== */

q({
  type: '单选题', subject: '历史', difficulty: '简单',
  stem: '标志着中国新民主主义革命开始的事件是（　　）',
  options: [
    { key: 'A', text: '辛亥革命' },
    { key: 'B', text: '五四运动' },
    { key: 'C', text: '中国共产党成立' },
    { key: 'D', text: '南昌起义' }
  ],
  answer: 'B',
  analysis: '1919 年五四运动是中国新民主主义革命的开端。',
  knowledge: ['中国近代史'], tags: ['历史']
});

q({
  type: '单选题', subject: '地理', difficulty: '简单',
  stem: '下列关于地球运动的说法，正确的是（　　）',
  options: [
    { key: 'A', text: '地球自转一周约需 365 天' },
    { key: 'B', text: '地球公转一周约需一年' },
    { key: 'C', text: '地球自转方向是自西向东' },
    { key: 'D', text: '北半球冬至日太阳直射北回归线' }
  ],
  answer: 'C',
  analysis: '地球自转一周约 24 小时，方向自西向东；公转一周约一年；冬至日太阳直射南回归线。',
  knowledge: ['地球运动'], tags: ['地理']
});

q({
  type: '单选题', subject: '生物', difficulty: '中等',
  stem: '如图是绿色植物细胞与动物细胞的亚显微结构模式图，下列说法正确的是（　　）',
  options: [
    { key: 'A', text: '两种细胞都有细胞壁、液泡和叶绿体' },
    { key: 'B', text: '动物细胞没有细胞壁、叶绿体，通常也没有大液泡' },
    { key: 'C', text: '图中序号 5 是控制物质进出的细胞膜' },
    { key: 'D', text: '两种细胞都有能进行光合作用的叶绿体' }
  ],
  answer: 'B',
  analysis: '动物细胞没有细胞壁、叶绿体和大液泡，只有细胞膜、细胞质、细胞核等基本结构。',
  knowledge: ['细胞的结构'], tags: ['生物']
});
withFigure(QUESTIONS[QUESTIONS.length - 1], draw.magneticField(480), '动植物细胞结构示意图');

q({
  type: '单选题', subject: '生物', difficulty: '简单',
  stem: '下列现象中，能说明植物进行蒸腾作用的是（　　）',
  options: [
    { key: 'A', text: '叶子在阳光下变暖' },
    { key: 'B', text: '叶片背面有较多水珠' },
    { key: 'C', text: '清晨叶片上有露珠' },
    { key: 'D', text: '移栽的植物出现萎蔫' }
  ],
  answer: 'B',
  analysis: '叶片背面水珠多是因为水汽在叶背遇冷液化，是蒸腾作用散失的水分形成的。',
  knowledge: ['蒸腾作用'], tags: ['生物']
});

q({
  type: '图表分析题', subject: '数学', difficulty: '中等',
  stem: '如图是某班同学最喜欢的运动方式人数统计图。从图中可以看出，喜欢篮球的人数比足球多 ______ 人，占全班人数的 ______。',
  answer: '2；25%',
  analysis: '读图可得篮球比足球多 2 人；全班 5 类共 40 人，10 人占 25%。',
  knowledge: ['数据的分析'], tags: ['统计与概率']
});
withFigure(QUESTIONS[QUESTIONS.length - 1], draw.barChart(520), '某班同学最喜欢的运动方式人数统计图');

q({
  type: '判断题', subject: '数学', difficulty: '简单',
  stem: '判断：若 a > b，则 a² > b²。（　　）',
  options: [
    { key: 'A', text: '正确' },
    { key: 'B', text: '错误' }
  ],
  answer: '错误',
  analysis: '当 a、b 都为负数时不成立，如 a = −1 > b = −2，但 a² = 1 < 4 = b²。',
  knowledge: ['平方差', '有理数大小比较'], tags: ['数与式']
});

q({
  type: '判断题', subject: '物理', difficulty: '简单',
  stem: '判断：物体温度越高，分子热运动越剧烈。（　　）',
  options: [
    { key: 'A', text: '正确' },
    { key: 'B', text: '错误' }
  ],
  answer: '正确',
  analysis: '温度是分子热运动剧烈程度的标志，温度越高分子热运动越剧烈。',
  knowledge: ['分子热运动'], tags: ['热学']
});

q({
  type: '计算题', subject: '物理', difficulty: '较难',
  stem: '一个电热器接到 220 V 电源上，通过它的电流为 5 A，求：\n（1）电热器的功率；\n（2）通电 10 min 产生的热量。',
  answer: '（1）P = UI = 220 × 5 = 1100 W；（2）Q = Pt = 1100 × 600 = 6.6 × 10⁵ J',
  analysis: 'P = UI = 1100 W；Q = W = Pt = 1100 W × 600 s = 6.6×10⁵ J。',
  knowledge: ['电功率', '焦耳定律'], tags: ['电学', '计算']
});

q({
  type: '简答题', subject: '道德与法治', difficulty: '简单',
  stem: '请简述中学生应如何做到"敬畏生命、珍爱生命"，并结合一件小事说明理由。',
  answer: '见学生作答',
  analysis: '答题要点：珍爱生命、尊重生命、热爱生命；学会自救与他救；不做伤害生命的事；举例要具体。',
  knowledge: ['生命教育'], tags: ['道法']
});

q({
  type: '计算题', subject: '数学', difficulty: '中等',
  stem: '某校七年级 3 个班共 120 人参加植树活动，人均植树棵数分别为 5、6、7 棵。已知 3 个班人数比为 3:4:5，求这 3 个班各植树多少棵。',
  answer: '人数比 3:4:5 对应 30 人、40 人、50 人，分别植树 150 棵、240 棵、350 棵',
  analysis: '总份数 3+4+5 = 12，每份 120÷12 = 10 人，三班分别 30、40、50 人；植树棵数 = 30×5 = 150、40×6 = 240、50×7 = 350 棵。',
  knowledge: ['比例分配'], tags: ['应用题', '计算']
});

/* ---------------- 导出成题卡 JSON ---------------- */

/**
 * 把题目导出成「题卡 JSON」（public\skills\tiku-json 的格式）。
 * 这样老师可以在「试卷导入 → 题卡 JSON」里逐题导入，
 * 而不是用「从备份恢复」整库替换（那个会覆盖现有题库）。
 * 插图用 base64 内嵌，导入到任何机器都能显示。
 */
function exportCards(file) {
  const cards = QUESTIONS.map(function (item, i) {
    const figures = [];
    let stem = item.stem;
    // 图放在题干末尾，用 [图1] 占位（系统靠占位把图插回原位）
    for (const fig of item.figures || []) {
      const p = path.join(UPLOAD_DIR, path.basename(fig.url));
      let url = '';
      try {
        url = 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
      } catch (e) { /* 读不到就只留文字描述 */ }
      const label = fig.label || ('图' + (figures.length + 1));
      figures.push({ label: label, desc: fig.desc || '', url: url });
      stem = stem + ' [' + label + '] ';
    }
    return {
      no: String(i + 1),
      stem: stem,
      type: item.type,
      options: item.options,
      answer: item.answer,
      analysis: item.analysis,
      knowledge: item.knowledge,
      difficulty: item.difficulty,
      subject: item.subject,
      grade: item.grade,
      year: item.year,
      region: item.region,
      source: item.source,
      chapter: item.chapter,
      tags: item.tags,
      figures: figures
    };
  });
  const out = path.resolve(file);
  fs.writeFileSync(out, JSON.stringify({ questions: cards }, null, 2), 'utf8');
  console.log('已导出题卡 JSON：' + out + '（' + cards.length + ' 道，其中带图 ' +
    cards.filter((c) => c.figures.length).length + ' 道）');
}

/* ---------------- 执行 ---------------- */

function preview() {
  const byType = {};
  const bySubject = {};
  let withFig = 0;
  for (const item of QUESTIONS) {
    byType[item.type] = (byType[item.type] || 0) + 1;
    bySubject[item.subject] = (bySubject[item.subject] || 0) + 1;
    if ((item.figures || []).length) withFig++;
  }
  console.log('\n共 ' + QUESTIONS.length + ' 道题，其中带图 ' + withFig + ' 道\n');
  console.log('按题型：');
  Object.entries(byType).forEach(([k, v]) => console.log('  ' + k + '：' + v));
  console.log('\n按学科：');
  Object.entries(bySubject).forEach(([k, v]) => console.log('  ' + k + '：' + v));
  console.log('\n题目清单：');
  QUESTIONS.forEach((item, i) => {
    console.log('  ' + (i + 1) + '. [' + item.type + '][' + item.subject + '] ' +
      item.stem.split('\n')[0].slice(0, 40) + (item.figures.length ? '  (带图)' : ''));
  });
  console.log('');
}

async function main() {
  preview();
  if (PREVIEW) return;

  const exportTo = argOf('export', '');
  if (exportTo) exportCards(exportTo);
  if (args.includes('--export-only')) return;

  // 插图已经写到 uploads-test\，需要放到服务实际使用的 uploads 目录
  const boot = await get('/api/bootstrap').catch(() => null);
  console.log('服务地址：' + HOST + ':' + PORT);
  if (!boot) { console.log('连不上服务，请先启动程序再运行本脚本。'); process.exit(1); }

  // 把插图通过接口上传，拿到真正的 /uploads 地址
  for (const item of QUESTIONS) {
    for (const fig of item.figures || []) {
      const file = path.join(UPLOAD_DIR, path.basename(fig.url));
      const b64 = fs.readFileSync(file).toString('base64');
      const r = await post('/api/upload', { dataUrl: 'data:image/png;base64,' + b64 });
      fig.url = r.url;
      item.stemHtml = item.stem + '<br><img src="' + r.url + '" data-fig="1" data-w="260">';
    }
  }

  const r = await post('/api/questions/save', {
    questions: QUESTIONS,
    folderId: (boot.folders && boot.folders[0] && boot.folders[0].id) || 'f_default',
    allowDuplicate: true
  });
  console.log('入库完成：新增 ' + r.added + ' 道，跳过 ' + r.skipped + ' 道，题库现有 ' + r.total + ' 道。');
}

main().catch((e) => { console.error('出错：' + e.message); process.exit(1); });
