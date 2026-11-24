/**
 * 诊断脚本：直接拿模型的原始回复，判断识别结果是否被截断。
 * 用法：node tools/e2e/probe.js 单题-化学.jpg
 * 不会动正式数据（写入临时数据目录）。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tiku-probe-'));
process.env.TIKU_DATA = tmp;

// 先写一份只含 Key 的临时数据，再加载 db（避免污染正式数据）。
// Key 的来源只认环境变量 PROBE_DB 或 PROBE_API_KEY —— 不自动去翻正式库，
// 免得脚本一跑就把本机的 Key 带出去，也免得源码里出现别人机器的路径。
const CANDIDATES = [process.env.PROBE_DB].filter(Boolean);
let apiKey = process.env.PROBE_API_KEY || '';
let baseUrl = process.env.PROBE_BASE_URL || '';
if (CANDIDATES.length) {
  const real = JSON.parse(fs.readFileSync(CANDIDATES[0], 'utf8'));
  apiKey = apiKey || (real.settings && real.settings.apiKey) || '';
  baseUrl = baseUrl || (real.settings && real.settings.baseUrl) || '';
}
if (!apiKey) {
  console.error('没有 API Key。设置环境变量 PROBE_API_KEY，或用 PROBE_DB 指向一个含 Key 的 db.json。');
  process.exit(1);
}
fs.writeFileSync(
  path.join(tmp, 'db.json'),
  JSON.stringify({ settings: { apiKey: apiKey, baseUrl: baseUrl } }),
  'utf8'
);
console.log('使用配置：' + (CANDIDATES[0] || '环境变量 PROBE_API_KEY'));

const sf = require(path.join(ROOT, 'lib', 'stepfun'));
const cfg = require(path.join(ROOT, 'lib', 'config'));

const file = process.argv[2] || '单题-化学.jpg';
const mode = process.argv[3] || 'single';
const imgPath = path.join(ROOT, '测试材料', '02-单题照片', file);
if (!fs.existsSync(imgPath)) {
  console.error('图片不存在：' + imgPath);
  process.exit(1);
}

(async () => {
  const dataUrl = 'data:image/jpeg;base64,' + fs.readFileSync(imgPath).toString('base64');
  const isNewGen = /step-5|step-3\.7/.test(cfg.VISION_MODEL);
  const content = [sf.dataUrlToImagePart(dataUrl, isNewGen)];
  content.push({ type: 'text', text: sf.recognizePrompt(mode) });

  console.log('图片：' + file + '  模型：' + cfg.VISION_MODEL + '  模式：' + mode);
  const r = await sf.chat({
    model: cfg.VISION_MODEL,
    messages: [
      { role: 'system', content: sf.RECOGNIZE_SYSTEM },
      { role: 'user', content }
    ],
    temperature: 0.1,
    maxTokens: mode === 'paper' ? 4096 : 2048,
    extra: isNewGen ? { reasoning_effort: 'low' } : null,
    timeout: 90000
  });

  console.log('finish_reason：' + r.finishReason);
  console.log('tokens：入 ' + r.usage.promptTokens + ' / 出 ' + r.usage.completionTokens);
  console.log('耗时：' + (r.durationMs / 1000).toFixed(1) + 's');
  console.log('原始回复长度：' + r.content.length);
  console.log('--------------- 原始回复 ---------------');
  console.log(r.content);
  console.log('--------------- 结束 ---------------');
  fs.writeFileSync(path.join(__dirname, '..', '..', '.e2e', 'probe-' + file + '.txt'), r.content, 'utf8');
  fs.rmSync(tmp, { recursive: true, force: true });
})();
