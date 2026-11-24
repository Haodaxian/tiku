// 静态编译所有页面模板 + 抽查 setup 返回值，提前发现会导致白屏的错误
// 用法：npm run check    （等价 node tools/check-templates.mjs）
// 只依赖工程自带的 public/vendor/vue.js，不需要联网、不需要额外安装。
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const ROOT = path.join(import.meta.dirname, '..');
const TPL_DIR = path.join(ROOT, 'public', 'tpl');
const JS_DIR = path.join(ROOT, 'public', 'js');
const VUE_FILE = path.join(ROOT, 'public', 'vendor', 'vue.js');

if (!fs.existsSync(VUE_FILE)) {
  console.error('找不到 public/vendor/vue.js，无法编译模板。');
  process.exit(1);
}

/* ---------- 极简 DOM stub：Vue 编译期解析 &amp; 这类实体时会用到 ---------- */
const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
function decode(v) {
  return String(v).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return String.fromCodePoint(cp);
    }
    return Object.prototype.hasOwnProperty.call(ENTITY, e) ? ENTITY[e] : m;
  });
}

/* ---------- 在沙箱里加载 Vue 全局构建（含模板编译器） ---------- */
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  window: {},
  navigator: { userAgent: 'node' },
  document: {
    createElement() {
      const self = {
        _html: '',
        style: {},
        setAttribute() {},
        appendChild() {},
        set innerHTML(v) {
          self._html = v;
        },
        get innerHTML() {
          return self._html;
        },
        get textContent() {
          return decode(self._html);
        },
        get children() {
          // Vue 的 decodeHtmlBrowser 会取 children[0].getAttribute(...)
          return [{ getAttribute: () => decode(self._html.replace(/^<div foo="|">$/g, '')) }];
        }
      };
      return self;
    },
    createTextNode() {
      return {};
    },
    querySelector() {
      return null;
    }
  }
};
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(VUE_FILE, 'utf8'), sandbox, { filename: 'vue.js' });
const Vue = sandbox.Vue;
if (!Vue || typeof Vue.compile !== 'function') {
  console.error('vendor/vue.js 不是完整版（缺少模板编译器），请换成含 compiler 的全局构建。');
  process.exit(1);
}

/* ---------- 一、逐个模板编译 ---------- */
const files = fs.readdirSync(TPL_DIR).filter((f) => f.endsWith('.html')).sort();
let problems = 0;

console.log('=== 模板编译 ===');
for (const f of files) {
  const tpl = fs.readFileSync(path.join(TPL_DIR, f), 'utf8');
  const errs = [];
  try {
    Vue.compile(tpl, {
      onError(e) {
        errs.push(e);
      }
    });
  } catch (e) {
    errs.push(e);
  }
  problems += errs.length;
  console.log((errs.length ? '[错] ' : '[OK] ') + f.padEnd(20) + tpl.length + ' 字符');
  for (const e of errs) {
    console.log('      code ' + (e.code || '?') + ': ' + String(e.message || e).split('\n')[0]);
    if (e.loc && e.loc.start) {
      const lines = tpl.split('\n');
      console.log('      行 ' + e.loc.start.line + ': ' + (lines[e.loc.start.line - 1] || '').trim().slice(0, 160));
    }
  }
}

/* ---------- 二、模板里用到、但 setup 没返回的变量 ---------- */
// 判定方式：取 view-*.js 里最后一个 return 对象，把它里面出现的所有标识符当成"已返回"。
// 只检查 {{ x }}、v-model="x"、v-for="... in x" 这三种最典型写法，v-for/v-slot 的循环变量排除。
const BUILTIN = new Set([
  'true', 'false', 'null', 'undefined', 'in', 'of', 'new', 'typeof', 'instanceof', 'void',
  'Math', 'JSON', 'Number', 'String', 'Boolean', 'Date', 'Object', 'Array', 'RegExp', 'Set', 'Map',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'console', 'window'
]);

function lastReturnObject(src) {
  let idx = -1;
  const re = /return\s*\{/g;
  let m;
  while ((m = re.exec(src))) idx = m.index;
  if (idx < 0) return null;
  const start = src.indexOf('{', idx);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

console.log('\n=== 模板变量是否在 setup 中返回 ===');
for (const f of files) {
  const base = f.replace(/\.html$/, '');
  const jsFile = path.join(JS_DIR, 'view-' + base + '.js');
  if (!fs.existsSync(jsFile)) {
    console.log('[跳过] ' + f + '  （没有 view-' + base + '.js，可能是纯静态页）');
    continue;
  }
  const objText = lastReturnObject(fs.readFileSync(jsFile, 'utf8'));
  if (!objText) {
    console.log('[跳过] ' + f + '  （view-' + base + '.js 里没找到 return 对象）');
    continue;
  }
  const declared = new Set(objText.match(/[A-Za-z_$][\w$]*/g) || []);
  const tpl = fs.readFileSync(path.join(TPL_DIR, f), 'utf8');

  const locals = new Set();
  // v-for="(item, i) in list" / v-for="item in list"：in 前面的都是局部变量
  for (const m of tpl.matchAll(/v-for\s*=\s*"([^"]*)"/g)) {
    const head = m[1].split(/\bin\b/)[0];
    for (const id of head.match(/[A-Za-z_$][\w$]*/g) || []) locals.add(id);
  }
  // 插槽作用域：v-slot="x" / #default="{ row, index }"
  for (const m of tpl.matchAll(/#[A-Za-z-]+\s*=\s*"\{?([^"}]*)\}?"/g)) {
    for (const id of m[1].match(/[A-Za-z_$][\w$]*/g) || []) locals.add(id);
  }
  for (const m of tpl.matchAll(/v-slot(?::[A-Za-z-]+)?\s*=\s*"\{?([^"}]*)\}?"/g)) {
    for (const id of m[1].match(/[A-Za-z_$][\w$]*/g) || []) locals.add(id);
  }

  const used = new Set();
  for (const m of tpl.matchAll(/\{\{\s*([A-Za-z_$][\w$]*)/g)) used.add(m[1]);
  for (const m of tpl.matchAll(/v-model(?:\.\w+)?\s*=\s*"([A-Za-z_$][\w$]*)/g)) used.add(m[1]);
  for (const m of tpl.matchAll(/v-for\s*=\s*"[^"]*?\bin\s+([A-Za-z_$][\w$]*)/g)) used.add(m[1]);

  const missing = [...used].filter((n) => !declared.has(n) && !locals.has(n) && !BUILTIN.has(n));
  if (missing.length) {
    console.log('[注意] ' + f.padEnd(20) + '未在 setup 返回：' + missing.join(', '));
    problems++;
  } else {
    console.log('[OK]   ' + f);
  }
}

console.log('\n模板数 ' + files.length + '，问题合计 ' + problems);
process.exitCode = problems ? 1 : 0;
