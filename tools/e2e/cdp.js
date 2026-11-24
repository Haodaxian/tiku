/**
 * 极简 CDP 客户端（零依赖）
 * 用 Node 22 内置的全局 WebSocket 直连 Edge/Chrome 的 DevTools 协议。
 */
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EDGE_PATHS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function httpJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const c = [];
      res.on('data', (d) => c.push(d));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(c).toString('utf8'))); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.consoleLog = [];
    this.pageErrors = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      const timer = setTimeout(() => reject(new Error('WebSocket 连接超时')), 15000);
      this.ws.addEventListener('open', () => { clearTimeout(timer); resolve(this); });
      this.ws.addEventListener('error', (e) => { clearTimeout(timer); reject(new Error('WebSocket 错误')); });
      this.ws.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: rs, reject: rj } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rj(new Error(msg.error.message || 'CDP 错误'));
          else rs(msg.result);
          return;
        }
        if (msg.method) {
          if (msg.method === 'Runtime.consoleAPICalled') {
            const text = (msg.params.args || [])
              .map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type))
              .join(' ');
            this.consoleLog.push({ type: msg.params.type, text });
          }
          if (msg.method === 'Runtime.exceptionThrown') {
            const d = msg.params.exceptionDetails || {};
            this.pageErrors.push((d.exception && (d.exception.description || d.exception.value)) || d.text || '未知异常');
          }
          if (msg.method === 'Log.entryAdded') {
            const e = msg.params.entry || {};
            if (e.level === 'error') this.pageErrors.push('[network] ' + (e.text || '') + ' ' + ((e.url) || ''));
          }
          const hs = this.listeners.get(msg.method) || [];
          hs.forEach((h) => h(msg.params));
        }
      });
    });
  }

  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP 调用超时：' + method));
        }
      }, 120000);
    });
  }

  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(handler);
  }

  once(method) {
    return new Promise((resolve) => {
      const h = (p) => {
        const arr = this.listeners.get(method) || [];
        const i = arr.indexOf(h);
        if (i >= 0) arr.splice(i, 1);
        resolve(p);
      };
      this.on(method, h);
    });
  }

  async init() {
    await this.send('Runtime.enable');
    await this.send('Page.enable');
    await this.send('Log.enable');
    await this.send('DOM.enable');
    // 测试必须绕开浏览器缓存，否则会跑到旧版脚本上，测出“假缺陷”
    try {
      await this.send('Network.enable');
      await this.send('Network.setCacheDisabled', { cacheDisabled: true });
    } catch (e) { /* 忽略：不影响主流程 */ }
    return this;
  }

  async goto(url, waitMs) {
    const loaded = this.once('Page.loadEventFired');
    await this.send('Page.navigate', { url });
    await Promise.race([loaded, sleep(20000)]);
    await sleep(waitMs === undefined ? 1200 : waitMs);
  }

  /** 在页面里求值，返回 JS 值 */
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: '(function(){' + expr + '})()',
      returnByValue: true,
      awaitPromise: true,
      userGesture: true
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error((d.exception && (d.exception.description || d.exception.value)) || d.text);
    }
    return r.result.value;
  }

  /** 同上，但允许在表达式里用 await */
  async evalAsync(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: '(async function(){' + expr + '})()',
      returnByValue: true,
      awaitPromise: true,
      userGesture: true
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error((d.exception && (d.exception.description || d.exception.value)) || d.text);
    }
    return r.result.value;
  }

  /** 轮询直到条件成立 */
  async waitFor(expr, timeoutMs, intervalMs) {
    const deadline = Date.now() + (timeoutMs || 30000);
    while (Date.now() < deadline) {
      let v = false;
      try { v = await this.eval('return !!(' + expr + ')'); } catch (e) { v = false; }
      if (v) return true;
      await sleep(intervalMs || 400);
    }
    return false;
  }

  async screenshot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }

  /** 给隐藏 file input 塞文件（Element Plus 的 upload 就是这种） */
  async setFiles(selector, files) {
    const doc = await this.send('DOM.getDocument', { depth: -1, pierce: true });
    const q = await this.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector });
    if (!q.nodeId) throw new Error('找不到文件输入框：' + selector);
    await this.send('DOM.setFileInputFiles', { nodeId: q.nodeId, files });
    return true;
  }

  /**
   * 在页面内构造 File 并注入（对 display:none、位于隐藏页签里的输入框同样有效）
   * CDP 的 DOM.setFileInputFiles 在元素不可渲染时会静默失效，这里用 DataTransfer 兜底。
   */
  async injectFile(selector, filePath, mimeType, fileName) {
    const b64 = fs.readFileSync(filePath).toString('base64');
    const name = fileName || path.basename(filePath);
    const mime = mimeType || (/\.pdf$/i.test(filePath) ? 'application/pdf' : 'application/octet-stream');
    const code = [
      'var raw=atob(' + JSON.stringify(b64) + ');',
      'var u=new Uint8Array(raw.length);',
      'for(var i=0;i<raw.length;i++)u[i]=raw.charCodeAt(i);',
      'var f=new File([u],' + JSON.stringify(name) + ',{type:' + JSON.stringify(mime) + '});',
      'var dt=new DataTransfer();dt.items.add(f);',
      'var el=document.querySelector(' + JSON.stringify(selector) + ');',
      'if(!el)return -1;',
      'el.files=dt.files;',
      'el.dispatchEvent(new Event("change",{bubbles:true}));',
      'return el.files.length;'
    ].join('');
    return this.eval(code);
  }

  /**
   * 稳定上传：先把隐藏 input 临时显示（CDP 对 display:none 会静默失效），
   * 再用 DOM.setFileInputFiles 走真实浏览器的文件选择链路。
   * 失败时回退到页面内 DataTransfer 注入。
   */
  async upload(selector, file) {
    const shown = await this.eval(
      'var el=document.querySelector(' + JSON.stringify(selector) + ');' +
      'if(!el)return false;el.style.display="block";el.style.position="absolute";el.style.opacity="0";' +
      'el.style.width="1px";el.style.height="1px";return true;'
    );
    if (!shown) return { ok: false, reason: '找不到 input' };
    try {
      const doc = await this.send('DOM.getDocument', { depth: -1, pierce: true });
      const q = await this.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector });
      if (q.nodeId) {
        await this.send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [file] });
        return { ok: true, via: 'cdp' };
      }
    } catch (e) { /* 走回退 */ }
    const n = await this.injectFile(selector, file);
    return { ok: n > 0, via: 'inject', count: n };
  }

  async text(selector) {
    return this.eval(
      'var el=document.querySelector(' + JSON.stringify(selector) + ');return el?el.innerText:null;'
    );
  }

  async count(selector) {
    return this.eval(
      'return document.querySelectorAll(' + JSON.stringify(selector) + ').length;'
    );
  }

  async click(selector, index) {
    return this.eval(
      'var es=document.querySelectorAll(' + JSON.stringify(selector) + ');' +
      'var el=es[' + (index || 0) + '];if(!el)return false;el.scrollIntoView({block:"center"});el.click();return true;'
    );
  }

  /** 按可见文字点按钮 */
  async clickText(text, tag) {
    return this.eval(
      'var sel=' + JSON.stringify((tag || 'button') + ', .el-button, .el-radio-button__inner, .el-checkbox, .el-tab-pane a') + ';' +
      'var target=' + JSON.stringify(text) + ';' +
      'var list=Array.from(document.querySelectorAll(sel));' +
      'var hit=list.find(function(e){return (e.innerText||"").replace(/\\s+/g,"")===target.replace(/\\s+/g,"")});' +
      'if(!hit){hit=list.find(function(e){return (e.innerText||"").indexOf(target)>=0});}' +
      'if(!hit)return false;hit.scrollIntoView({block:"center"});hit.click();return true;'
    );
  }

  clearLog() {
    this.consoleLog = [];
    this.pageErrors = [];
  }
}

/** 启动浏览器并返回会话 */
async function launch(opts) {
  opts = opts || {};
  const exe = EDGE_PATHS.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('未找到 Edge / Chrome');
  const port = opts.port || 9333;
  const profile = opts.profile || path.join(__dirname, '..', '..', '.e2e', 'profile');
  fs.mkdirSync(profile, { recursive: true });

  const child = spawn(exe, [
    '--headless=new',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1440,1000',
    '--disable-features=Translate,MediaRouter',
    'about:blank'
  ], { stdio: 'ignore' });

  const deadline = Date.now() + 25000;
  let ver = null;
  while (Date.now() < deadline) {
    try {
      ver = await httpJSON('http://127.0.0.1:' + port + '/json/version');
      if (ver && ver.webSocketDebuggerUrl) break;
    } catch (e) { /* 还没起来 */ }
    await sleep(300);
  }
  if (!ver) { child.kill(); throw new Error('浏览器启动失败'); }

  // 连一个页面级 target
  let pageWs = null;
  for (let i = 0; i < 20; i++) {
    const list = await httpJSON('http://127.0.0.1:' + port + '/json/list');
    const page = (list || []).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) { pageWs = page.webSocketDebuggerUrl; break; }
    await sleep(300);
  }
  if (!pageWs) { child.kill(); throw new Error('找不到页面 target'); }

  const cdp = new Cdp(pageWs);
  await cdp.connect();
  await cdp.init();

  return {
    cdp,
    browser: ver.Browser,
    async close() {
      try { await cdp.send('Browser.close'); } catch (e) { /* ignore */ }
      await sleep(300);
      try { child.kill(); } catch (e) { /* ignore */ }
    }
  };
}

module.exports = { launch, sleep, Cdp };
