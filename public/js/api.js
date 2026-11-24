/* 全局状态与工具 */
window.TK = (function () {
  const { reactive } = Vue;

  const store = reactive({
    ready: false,
    view: 'dashboard',
    settings: {},
    folders: [],
    questions: [],
    gallery: [],
    lectures: [],
    stats: {},
    currentLecture: null,
    theme: 'light'
  });

  /* ---------------- 难度（5 档）与掌握度 ---------------- */

  /** 难度 5 档，数值 1~5 */
  const DIFFICULTIES = ['很简单', '简单', '中等', '较难', '很难'];

  /** 掌握度：空串表示没标记 */
  const MASTERY_LEVELS = ['生疏', '模糊', '掌握'];

  /** 难度别名归一，和服务端 server.js 的规则保持一致 */
  function normDifficulty(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return '中等';
    if (DIFFICULTIES.indexOf(s) >= 0) return s;
    if (/^[1-5]$/.test(s)) return DIFFICULTIES[Number(s) - 1];
    const alias = {
      '很容易': '很简单', '基础': '很简单', '入门': '很简单',
      '容易': '简单', '较易': '简单', 'easy': '简单',
      '中等': '中等', '中': '中等', '一般': '中等', '适中': '中等', '普通': '中等', 'medium': '中等',
      '较难': '较难', '偏难': '较难', '难': '较难', 'hard': '较难',
      '很难': '很难', '困难': '很难', '极难': '很难', '特难': '很难'
    }[s] || null;
    if (alias) return alias;
    if (s.indexOf('很') >= 0) {
      return (s.indexOf('简单') >= 0 || s.indexOf('容易') >= 0) ? '很简单' : '很难';
    }
    if (s.indexOf('难') >= 0) return '较难';
    if (s.indexOf('简单') >= 0 || s.indexOf('容易') >= 0) return '简单';
    return '中等';
  }

  /** 难度对应数值 1~5，排序和滑块都用 */
  function diffValue(v) {
    const i = DIFFICULTIES.indexOf(normDifficulty(v));
    return i < 0 ? 3 : i + 1;
  }

  function normMastery(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return '';
    if (MASTERY_LEVELS.indexOf(s) >= 0) return s;
    if (s.indexOf('生疏') >= 0 || s.indexOf('不会') >= 0 || s.indexOf('未掌握') >= 0) return '生疏';
    if (s.indexOf('模糊') >= 0 || s.indexOf('半会') >= 0 || s.indexOf('一般') >= 0) return '模糊';
    if (s.indexOf('掌握') >= 0 || s.indexOf('熟练') >= 0 || s.indexOf('会') >= 0) return '掌握';
    return '';
  }

  async function api(path, options) {
    const opts = Object.assign({ method: 'GET' }, options || {});
    const timeout = Number(opts.timeout) || 0;
    delete opts.timeout;
    if (opts.body && typeof opts.body !== 'string') {
      opts.body = JSON.stringify(opts.body);
      opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    }
    let res;
    let timer = null;
    if (timeout && typeof AbortController !== 'undefined') {
      const ac = new AbortController();
      opts.signal = ac.signal;
      timer = setTimeout(() => ac.abort(), timeout);
    }
    try {
      res = await fetch(path, opts);
    } catch (e) {
      if (e && (e.name === 'AbortError' || e.code === 20)) {
        throw new Error('等了 ' + Math.round(timeout / 1000) + ' 秒还没有结果，可能是网络慢或图片太大，可以再试一次');
      }
      throw new Error('连不上本地服务，请确认启动窗口没有被关闭');
    } finally {
      if (timer) clearTimeout(timer);
    }
    let json = null;
    try { json = await res.json(); } catch (e) { /* 忽略 */ }
    if (!res.ok || !json || json.ok === false) {
      const msg = (json && json.message) || ('操作失败（' + res.status + '）');
      throw new Error(msg);
    }
    return json.data;
  }

  const BASE_COST = {
    'step-1o-turbo-vision': { label: '极速识图', in: 2.5, out: 8 },
    'step-1o-vision-32k': { label: '高精度识图', in: 15, out: 70 },
    'step-3.5-flash': { label: '文本·经济', in: 0.7, out: 2.1 },
    'step-3.7-flash': { label: '文本·均衡', in: 1.35, out: 8.1 },
    'step-5-preview': { label: '文本·旗舰', in: 7, out: 20 }
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const SYMBOLS = [
    [/\\times/g, '×'], [/\\div/g, '÷'], [/\\pm/g, '±'], [/\\mp/g, '∓'],
    [/\\leq?/g, '≤'], [/\\geq?/g, '≥'], [/\\neq?/g, '≠'], [/\\approx/g, '≈'],
    [/\\infty/g, '∞'], [/\\pi/g, 'π'], [/\\alpha/g, 'α'], [/\\beta/g, 'β'],
    [/\\gamma/g, 'γ'], [/\\theta/g, 'θ'], [/\\lambda/g, 'λ'], [/\\mu/g, 'μ'],
    [/\\Delta/g, '△'], [/\\triangle/g, '△'], [/\\angle/g, '∠'], [/\\perp/g, '⊥'],
    [/\\parallel/g, '∥'], [/\\circ/g, '°'], [/\\degree/g, '°'], [/\\cdot/g, '·'],
    [/\\rightarrow|\\to/g, '→'], [/\\Rightarrow/g, '⇒'], [/\\in\b/g, '∈'],
    [/\\subset/g, '⊂'], [/\\cup/g, '∪'], [/\\cap/g, '∩'], [/\\emptyset/g, '∅'],
    [/\\sum/g, '∑'], [/\\int/g, '∫'], [/\\sqrt/g, '√'], [/\\left|\\right/g, ''],
    [/\\left/g, ''], [/\\right/g, ''], [/\\displaystyle/g, ''], [/\\\\/g, ' '],
    [/\\%|\\%/g, '%'], [/\\ /g, ' ']
  ];

  /** 把题干里的公式片段渲染成可读 HTML（先转义，再降级替换） */
  function rich(text) {
    let s = escapeHtml(text);
    // 分式
    s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, function (m, a, b) {
      return '<span class="frac"><span class="num">' + a + '</span><span class="den">' + b + '</span></span>';
    });
    s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)');
    // 字号（答案区 A+/A- 用）
    s = s.replace(/\\big\s*\{([^{}]*)\}/g, '<span style="font-size:1.25em">$1</span>');
    s = s.replace(/\\small\s*\{([^{}]*)\}/g, '<span style="font-size:0.85em">$1</span>');
    // 上下标
    s = s.replace(/\^\{([^{}]*)\}/g, '<sup>$1</sup>');
    s = s.replace(/\^([0-9a-zA-Z+\-])/g, '<sup>$1</sup>');
    s = s.replace(/_\{([^{}]*)\}/g, '<sub>$1</sub>');
    s = s.replace(/_([0-9a-zA-Z+\-])/g, '<sub>$1</sub>');
    for (const [re, rep] of SYMBOLS) s = s.replace(re, rep);
    s = s.replace(/\\[a-zA-Z]+/g, ''); // 兜底去掉剩余命令名
    s = s.replace(/\$([^$]+)\$/g, '$1'); // 去掉残留 $ 包裹
    s = s.replace(/&lt;br\s*\/?&gt;/gi, '<br>');
    return s.replace(/\n/g, '<br>');
  }

  /** 图形按 label（图1 / 图2）建索引，只保留已经有图片地址的 */
  function figureMap(q) {
    const map = {};
    ((q && q.figures) || []).forEach((f, i) => {
      const url = figSrc(f);
      if (!url) return;
      map[f.label || ('图' + (i + 1))] = url;
    });
    return map;
  }

  /**
   * 题干渲染入口：有富文本 stemHtml 时直接用（服务端已白名单净化），
   * 否则把纯文本按公式规则降级渲染。题干里的 [图N] 会替换成对应图形的内嵌图片，
   * 这样图形出现在原文位置，布局和原卷一致。
   */
  /**
   * 把 img 的 data-w（编辑器记下的显示宽度）兑现成 max-width。
   * 不兑现的话，题图按原始像素铺开，一幅图就占掉半张卷子。
   */
  function applyFigWidth(html) {
    return String(html || '').replace(/<img([^>]*?)>/gi, (m) => {
      let tag = m;
      if (!/class\s*=\s*["'][^"']*stem-fig/.test(tag)) {
        tag = tag.replace('<img', '<img class="stem-fig"');
      }
      const w = (m.match(/data-w\s*=\s*"?(\d+)/) || [])[1];
      if (w && !/style\s*=/i.test(tag)) {
        const px = Math.min(1200, Math.max(20, Number(w)));
        tag = /\/>\s*$/.test(tag)
          ? tag.replace(/\s*\/>\s*$/, ' style="max-width:' + px + 'px"/>')
          : tag.replace(/>\s*$/, ' style="max-width:' + px + 'px">');
      }
      return tag;
    });
  }

  function renderStem(q) {
    if (!q) return '';
    const map = figureMap(q);
    const html = typeof q === 'string' ? '' : String(q.stemHtml || '');
    const inline = (s) => {
      let out = s.replace(/\[(图\d+)\]/g, (m, name) => {
        const url = map[name];
        if (!url) return m;
        return '<img class="stem-fig" src="' + url + '" data-fig="1">';
      });
      return applyFigWidth(out).replace(/\n/g, '<br>');
    };
    if (html) return inline(html);
    return inline(rich(typeof q === 'string' ? q : q.stem || ''));
  }

  /** 还没内嵌进题干的图形（列表里只需要展示这些，避免同一张图出现两遍） */
  function pendingFigures(q) {
    if (!q) return [];
    const figs = Array.isArray(q.figures) ? q.figures : [];
    if (!figs.length) return [];
    const head = String(q.stemHtml || '') + ' ' + String(q.stem || '');
    return figs.filter((f, i) => {
      const url = figSrc(f);
      if (!url) return true;
      if (head.indexOf(url) >= 0) return false;
      const label = f.label || ('图' + (i + 1));
      return head.indexOf('[' + label + ']') < 0;
    });
  }

  /** 纯文本题干（用于搜索/复制/发给模型） */
  function stemText(q) {
    if (!q) return '';
    const anyQ = typeof q === 'string' ? { stem: q } : q;
    if (anyQ.stemHtml) {
      return String(anyQ.stemHtml)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(div|p)>/gi, '\n')
        .replace(/<img[^>]*>/gi, '[图]')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
        .trim() || String(anyQ.stem || '');
    }
    return String(anyQ.stem || '');
  }

  /** 从富文本里抽出内嵌图形，编辑时还原成 figures 列表 */
  function embeddedFigures(q) {
    const html = String((q && q.stemHtml) || '');
    const out = [];
    const re = /<img[^>]*src="([^"]+)"[^>]*>/gi;
    let m;
    while ((m = re.exec(html))) {
      out.push({ url: m[1], inline: true });
    }
    return out;
  }

  /**
   * 生成排版用的题干 HTML：富文本优先，并把还没内嵌进题干的图形按顺序补在末尾，
   * 保证试卷/讲义上不会漏图。
   */
  function stemForPaper(q) {
    const html = String((q && q.stemHtml) || '');
    const figures = (q && Array.isArray(q.figures)) ? q.figures : [];
    const missing = figures
      .map((f) => figSrc(f))
      .filter((u) => u && html.indexOf(u) < 0);
    if (html) {
      const extra = missing.map((u) => '<br><img src="' + u + '" data-fig="1">').join('');
      return applyFigWidth(html + extra);
    }
    const plain = rich((q && q.stem) || '');
    const extra = missing.map((u) => '<br><img src="' + u + '" data-fig="1">').join('');
    return applyFigWidth(plain + extra);
  }

  /**
   * 答案渲染：answer 里一个空一行，用与选项相同的 _{} / ^{} 标记存上下标。
   * 多空时统一补（1）（2）编号——存储里不带编号，显示时才加，
   * 这样编辑器里每个框只填答案本身，导出的答案页仍然是分条编号的。
   */
  function renderAnswer(q) {
    if (!q) return '';
    const text = String(q.answer || '');
    if (!text.trim()) return '';
    const lines = text.split('\n').map((t) => t.replace(/^\s*（\d+）\s*/, '').trim());
    if (lines.length <= 1) return rich(lines[0] || '');
    return lines.map((t, i) => (t ? '（' + (i + 1) + '）' + rich(t) : '')).filter(Boolean).join('<br>');
  }

  const TYPE_TAG = {
    '单选题': 'primary', '多选题': 'primary', '填空题': 'warning',
    '判断题': 'info', '解答题': 'success', '计算题': 'success',
    '应用题': 'success', '实验探究题': 'success', '简答题': 'success',
    '阅读理解题': 'danger', '图表分析题': 'danger', '作文题': 'danger',
    '完形填空题': 'danger', '其他': 'info'
  };

  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function fmtDay(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getMonth() + 1) + '/' + p(d.getDate());
  }

  function brief(text, n) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    return s.length > (n || 90) ? s.slice(0, n || 90) + '…' : s;
  }

  function costEstimate(model, inTokens, outTokens) {
    const p = BASE_COST[model] || { in: 3, out: 10 };
    return (inTokens / 1e6) * p.in + (outTokens / 1e6) * p.out;
  }

  /**
   * 并发池：把 N 个任务按 limit 并发跑，结果按原始顺序返回。
   * 识别整卷时用它把「一张一张等」变成「三张同时跑」。
   */
  async function pool(items, limit, worker) {
    const list = Array.from(items || []);
    const results = new Array(list.length);
    let cursor = 0;
    const size = Math.max(1, Math.min(limit || 3, list.length));
    const runners = [];
    for (let r = 0; r < size; r++) {
      runners.push((async () => {
        while (cursor < list.length) {
          const idx = cursor++;
          try {
            results[idx] = { ok: true, value: await worker(list[idx], idx) };
          } catch (e) {
            results[idx] = { ok: false, error: e };
          }
        }
      })());
    }
    await Promise.all(runners);
    return results;
  }

  let base64Cache = new Map();
  function downscaleImage(fileOrDataUrl, maxSide) {
    return new Promise((resolve, reject) => {
      // 1400px 足够看清试卷小字，又能明显减少上传体积与识别耗时
      const max = maxSide || 1400;
      const img = new Image();
      img.onload = function () {
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        const scale = Math.min(1, max / Math.max(w, h));
        w = Math.round(w * scale);
        h = Math.round(h * scale);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = function () { reject(new Error('图片读取失败，请换一张试试')); };
      if (typeof fileOrDataUrl === 'string') {
        img.src = fileOrDataUrl;
      } else {
        const reader = new FileReader();
        reader.onload = () => { img.src = reader.result; };
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.readAsDataURL(fileOrDataUrl);
      }
    });
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type: type || 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
  }

  /* ---------------- 打印 ---------------- */

  // 桌面客户端里由主进程弹系统打印框；浏览器里直接 window.print()
  const isDesktop = !!(window.tikuElectron && window.tikuElectron.isDesktop);

  /** 当前页面的打印函数（讲义排版页注册） */
  let printHandler = null;

  /**
   * 打印。
   * @param {function} [prepare] 打印前的准备（比如给 body 加 print-ready）
   * @param {function} [cleanup] 打印后的清理
   */
  function doPrint(prepare, cleanup) {
    if (prepare) { try { prepare(); } catch (e) { /* 忽略 */ } }
    const done = function () {
      if (cleanup) { try { cleanup(); } catch (e) { /* 忽略 */ } }
    };
    // 等界面把新内容渲染出来再打印，否则打出来的是上一版
    setTimeout(function () {
      if (isDesktop) {
        window.tikuElectron.print().then(function (r) {
          done();
          if (r && r.ok === false && r.message) {
            if (window.ElementPlus) window.ElementPlus.ElMessage.error('打印失败：' + r.message);
          }
        }).catch(function () { done(); });
        return;
      }
      window.print();
      setTimeout(done, 1000);
    }, 350);
  }

  /** 供主进程菜单调用：打印当前页面的内容 */
  function requestPrint() {
    if (printHandler) { printHandler(); return true; }
    return false;
  }

  function setPrintHandler(fn) { printHandler = fn; }

  /** 把后端返回的 base64 落成本地文件（导出 Word 用） */
  function downloadBase64(filename, base64, mime) {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 800);
  }

  /**
   * 题卡 JSON 归一化：兼容 [{...}] 和 {questions:[...]}，
   * 字段名同时认 中文/英文，方便直接拿第三方导出的题卡导入。
   */
  function normalizeImported(rawList, fallback) {
    const list = Array.isArray(rawList) ? rawList
      : (rawList && Array.isArray(rawList.questions) ? rawList.questions
        : (rawList && Array.isArray(rawList.data) ? rawList.data : []));
    const fb = fallback || {};
    const TYPES = ['单选题', '多选题', '填空题', '判断题', '解答题', '计算题', '应用题', '实验探究题', '简答题', '阅读理解题', '图表分析题', '作文题', '完形填空题', '其他'];

    function str(v) { return v == null ? '' : String(v).trim(); }
    function arr(v) {
      if (Array.isArray(v)) return v.map(str).filter(Boolean);
      if (typeof v === 'string') return v.split(/[,，、;；\s]+/).map(str).filter(Boolean);
      return [];
    }

    return list.map((q, i) => {
      if (!q || typeof q !== 'object') return null;
      let type = str(q.type || q.题型 || q.questionType);
      if (!TYPES.includes(type)) {
        if (type.indexOf('选择') >= 0 || type.indexOf('choice') >= 0) type = '单选题';
        else if (type.indexOf('填空') >= 0 || type.indexOf('fill') >= 0) type = '填空题';
        else if (type.indexOf('判断') >= 0) type = '判断题';
        else if (type.indexOf('解答') >= 0 || type.indexOf('主观') >= 0) type = '解答题';
        else if (type.indexOf('多选') >= 0) type = '多选题';
        else type = '其他';
      }
      let opts = q.options || q.选项 || [];
      if (typeof opts === 'string') opts = opts.split('\n').map(str).filter(Boolean);
      if (!Array.isArray(opts)) opts = [];
      opts = opts.map((o, oi) => {
        if (typeof o === 'string') {
          const m = o.match(/^\s*([A-Za-z])[.、．:：)]\s*(.+)$/);
          return m ? { key: m[1].toUpperCase(), text: m[2].trim() } : { key: String.fromCharCode(65 + oi), text: o.trim() };
        }
        return {
          key: str((o && (o.key || o.选项 || o.label)) || String.fromCharCode(65 + oi)).slice(0, 2),
          text: str((o && (o.text || o.content || o.value)) || '')
        };
      }).filter((o) => o.text);

      const diff = str(q.difficulty || q.难度);
      const knowledge = arr(q.knowledge || q.知识点 || q.knowledgePoints);
      const figures = (Array.isArray(q.figures) ? q.figures : []).map((f) => ({
        label: str(f && (f.label || f.名称)),
        desc: str(f && (f.desc || f.说明)),
        url: str(f && (f.url || f.src)),
        bbox: Array.isArray(f && f.bbox) ? f.bbox.slice(0, 4).map(Number) : null
      })).filter((f) => f.url || f.bbox || f.desc);

      return {
        id: 'q_imp_' + Date.now().toString(36) + '_' + i,
        no: str(q.no || q.题号 || q.number),
        stem: str(q.stem || q.题干 || q.question || q.content),
        stemHtml: str(q.stemHtml || ''),
        type,
        options: opts,
        answer: str(q.answer || q.答案),
        analysis: str(q.analysis || q.解析 || q.explain),
        knowledge: knowledge.slice(0, 10),
        tags: arr(q.tags || q.标签).slice(0, 12),
        difficulty: normDifficulty(diff),
        favorite: q.favorite ? 1 : 0,
        mastery: normMastery(q.mastery),
        subject: str(q.subject || q.学科) || fb.subject || '',
        grade: str(q.grade || q.年级) || fb.grade || '',
        year: str(q.year || q.年份),
        region: str(q.region || q.地区),
        source: str(q.source || q.来源) || fb.source || '',
        chapter: str(q.chapter || q.教材章节 || q.chapterName),
        figures,
        _checked: true,
        sourceImage: str(q.sourceImage || q.image || '')
      };
    }).filter((q) => q && q.stem);
  }

  /* ---------- 文本处理（粘贴/识别后的清洗与排版） ---------- */
  const TEXTPROC = [
    {
      key: 'cleanup',
      label: '一键整理',
      hint: '去页眉页脚、合并断行、压缩空格、统一符号',
      fn: (s) => collapseSpaces(mergeLines(mathToPlain(stripNoise(s))))
    },
    { key: 'math', label: '公式转纯文本', hint: '$x^2$ / \\frac → x² / a/b', fn: mathToPlain },
    { key: 'lines', label: '合并断行', hint: '把被 PDF 拆断的一行接回去', fn: mergeLines },
    { key: 'spaces', label: '压缩空格', hint: '连续空格压成一个，去掉行首尾空白', fn: collapseSpaces },
    { key: 'fullhalf', label: '全角转半角', hint: '数字、字母、括号转半角', fn: fullToHalf },
    { key: 'blank', label: '统一填空线', hint: '各种下划线/括号空位改为 ____', fn: toBlanks },
    { key: 'noise', label: '去页眉页脚', hint: '删除页码、水印、二维码等行', fn: stripNoise }
  ];

  function mathToPlain(s) {
    let t = String(s == null ? '' : s);
    t = t.replace(/\$\$?([^$]+)\$\$?/g, '$1');
    t = t.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)');
    t = t.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)');
    t = t.replace(/\\text\s*\{([^{}]*)\}/g, '$1');
    t = t.replace(/\^\{([^{}]*)\}/g, (m, a) => superscript(a));
    t = t.replace(/\^([0-9a-zA-Z+\-])/g, (m, a) => superscript(a));
    t = t.replace(/_\{([^{}]*)\}/g, (m, a) => subscript(a));
    t = t.replace(/_([0-9a-zA-Z+\-])/g, (m, a) => subscript(a));
    for (const [re, rep] of SYMBOLS) t = t.replace(re, rep);
    return t.replace(/\\[a-zA-Z]+/g, '');
  }

  const SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', n: 'ⁿ' };
  const SUB = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', n: 'ₙ' };
  function superscript(a) {
    return String(a).split('').map((c) => SUP[c] || c).join('');
  }
  function subscript(a) {
    return String(a).split('').map((c) => SUB[c] || c).join('');
  }

  /** 合并被换行拆断的句子：中文行末直接接下一行，英文按空格接 */
  function mergeLines(s) {
    const lines = String(s == null ? '' : s).split(/\r?\n/);
    const out = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { out.push(''); continue; }
      const prev = out.length ? out[out.length - 1] : '';
      const cjk = /[一-龥，。；：、）】」』]$/.test(prev) || /^[一-龥（【「『]/.test(line);
      const endsOpen = /[（【「『(]$/.test(prev);
      const startsQuote = /^[）】」』]/.test(line);
      if (prev && !/^[0-9]+[.．、]/.test(line) && (cjk || endsOpen || startsQuote)) {
        out[out.length - 1] = prev + line;
      } else {
        out.push(line);
      }
    }
    return out.join('\n');
  }

  function collapseSpaces(s) {
    return String(s == null ? '' : s)
      .split(/\r?\n/)
      .map((l) => l.replace(/[ \t　]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');
  }

  function fullToHalf(s) {
    return String(s == null ? '' : s).replace(/[！-～]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, ' ');
  }

  /** 各种空位写法统一成 4 个下划线 */
  function toBlanks(s) {
    return String(s == null ? '' : s)
      .replace(/[（(]\s*[)）]/g, '____')
      .replace(/_{2,}/g, '____')
      .replace(/[．.]{3,}/g, '____');
  }

  function stripNoise(s) {
    return String(s == null ? '' : s)
      .split(/\r?\n/)
      .filter((l) => {
        const t = l.trim();
        if (!t) return true;
        if (/^[-—–\s]*\d{1,3}[-—–\s]*$/.test(t)) return false;        // 纯页码
        if (/^第\s*\d+\s*页/.test(t)) return false;
        if (/^(数学|语文|英语|物理|化学)试卷\s*第/.test(t)) return false;
        if (/^扫一扫|扫码|二维码|微信公众号|关注我们/.test(t)) return false;
        return true;
      })
    .join('\n');
  }

  /** 给一段文本套一次处理，返回新文本 */
  function applyTextProc(key, text) {
    const item = TEXTPROC.find((t) => t.key === key);
    if (!item) return String(text == null ? '' : text);
    return item.fn(String(text == null ? '' : text));
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('图片加载失败')); };
      img.src = src;
    });
  }

  /**
   * 在裁切区域里找“图形本体”的像素范围。
   * 模型给的 bbox 经常把上方题干文字一起框进来，这里按行的墨迹分布切掉文字：
   * 取最高的连续墨迹带作为图形主体（图形远高于单行文字），再只向上/下合并
   * 贴得很近、水平范围重叠、且本身够高的墨迹带（坐标轴标注、刻度数字），
   * 最后在带内收掉左右空白。返回相对原图的像素框；判断不可信时返回 null，按原框裁。
   */
  function analyzeInkBox(img, sx, sy, sw, sh) {
    const maxSide = 700;
    const scale = Math.min(1, maxSide / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));
    if (w < 8 || h < 8) return null;

    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);

    const data = ctx.getImageData(0, 0, w, h).data;
    const isInk = (x, y) => {
      const i = (y * w + x) * 4;
      return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 200;
    };
    const rowInk = new Int32Array(h);
    for (let y = 0; y < h; y++) {
      let n = 0;
      for (let x = 0; x < w; x++) if (isInk(x, y)) n++;
      rowInk[y] = n;
    }

    // 找连续的墨迹行段（允许 1 行空隙，避免虚线被切碎）
    const rowThreshold = Math.max(1, Math.round(w * 0.002));
    const runs = [];
    let start = -1;
    let lastInk = -1;
    for (let y = 0; y < h; y++) {
      if (rowInk[y] > rowThreshold) {
        if (start < 0) start = y;
        lastInk = y;
      } else if (start >= 0 && y - lastInk > 1) {
        runs.push([start, lastInk]);
        start = -1;
      }
    }
    if (start >= 0) runs.push([start, lastInk]);
    if (!runs.length) return null;

    function runExtent(r) {
      let min = w - 1;
      let max = 0;
      for (let y = r[0]; y <= r[1]; y++) {
        for (let x = 0; x < w; x++) {
          if (!isInk(x, y)) continue;
          if (x < min) min = x;
          if (x > max) max = x;
        }
      }
      return { min, max };
    }

    // 取最高的一段墨迹：图形通常远高于单行文字（一行字约 20~40px），
    // 文字行即使更“黑”，高度也远小于图形主体。
    let best = runs[0];
    for (const r of runs) if (r[1] - r[0] > best[1] - best[0]) best = r;
    const bestExt = runExtent(best);
    let y0 = best[0];
    let y1 = best[1];

    // 上下扩展分两种情形：
    //  1) 贴得很近的小段（坐标轴刻度、字母标注）→ 只要水平重叠就并入；
    //  2) 离得稍远但本身够高的一段（上下分体的两个子图）→ 也并入；
    // 题干文字行高度通常不到主体的三成，两种情形都会被排除。
    const bestH = best[1] - best[0] + 1;
    const gapNear = Math.max(2, Math.round(h * 0.03));
    const gapFar = Math.round(h * 0.25);
    function merges(r, gap) {
      const ext = runExtent(r);
      const span = Math.max(1, bestExt.max - bestExt.min);
      const overlap = Math.min(ext.max, bestExt.max) - Math.max(ext.min, bestExt.min);
      const rh = r[1] - r[0] + 1;
      // 图注：窄且水平居中在图形下方/上方的短行（如「图1」、坐标轴字母），
      // 即使离得稍远也保留；题干文字行很宽，宽度占比会超过阈值被排除
      const rw = ext.max - ext.min + 1;
      const ctr = (ext.min + ext.max) / 2;
      if (gap <= gapFar && rw <= span * 0.3 && ctr > bestExt.min + span * 0.15 && ctr < bestExt.max - span * 0.15) return true;
      if (overlap < span * 0.25) return false;
      if (gap <= gapNear && rh >= bestH * 0.12) return true;
      return gap <= gapFar && rh >= bestH * 0.35;
    }
    for (let i = runs.indexOf(best) - 1; i >= 0; i--) {
      const r = runs[i];
      if (!merges(r, y0 - r[1])) break;
      y0 = r[0];
    }
    for (let i = runs.indexOf(best) + 1; i < runs.length; i++) {
      const r = runs[i];
      if (!merges(r, r[0] - y1)) break;
      y1 = r[1];
    }

    // 带内收左右空白
    let x0 = 0;
    let x1 = w - 1;
    const colThreshold = Math.max(1, Math.round((y1 - y0 + 1) * 0.004));
    for (; x0 < w; x0++) {
      let n = 0;
      for (let y = y0; y <= y1; y++) {
        const i = (y * w + x0) * 4;
        if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 200) n++;
      }
      if (n > colThreshold) break;
    }
    for (; x1 > x0; x1--) {
      let n = 0;
      for (let y = y0; y <= y1; y++) {
        const i = (y * w + x1) * 4;
        if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 200) n++;
      }
      if (n > colThreshold) break;
    }
    if (x1 <= x0) return null;

    const inv = 1 / scale;
    const box = {
      x: sx + x0 * inv,
      y: sy + y0 * inv,
      w: (x1 - x0 + 1) * inv,
      h: (y1 - y0 + 1) * inv
    };
    // 只拦“收成了一个小点”这种明显不可信的结果。
    // 不能用面积比例：模型给的框经常一大半是题干文字，图形本体只占很小一块是正常的。
    if (box.w < Math.max(16, sw * 0.03) || box.h < Math.max(16, sh * 0.03)) return null;
    return box;
  }

  /**
   * 按归一化框选区域 [x,y,w,h]（0~1）从原图裁出图形。
   * 越界自动收边；裁出的小图放大时用高质量重采样，保证打印时清晰。
   * trim 默认开启：自动裁掉框里的题干文字，只留图形。
   */
  async function cropRegion(srcUrl, bbox, opts) {
    const o = opts || {};
    const img = await loadImage(srcUrl);
    const [bx, by, bw, bh] = (Array.isArray(bbox) && bbox.length === 4) ? bbox : [0, 0, 1, 1];
    const padRatio = o.pad === undefined ? 0.012 : o.pad;
    const x0 = Math.max(0, bx - padRatio);
    const y0 = Math.max(0, by - padRatio);
    const x1 = Math.min(1, bx + bw + padRatio);
    const y1 = Math.min(1, by + bh + padRatio);
    let sx = Math.round(x0 * img.naturalWidth);
    let sy = Math.round(y0 * img.naturalHeight);
    let sw = Math.max(1, Math.round((x1 - x0) * img.naturalWidth));
    let sh = Math.max(1, Math.round((y1 - y0) * img.naturalHeight));

    if (o.trim !== false) {
      // 反复收紧，直到框不再变小。多跑几轮是因为第一轮可能只切掉了上面的题干行，
      // 第二轮才能切掉保留下来的淡边、图注空隙和粘连的字头。
      for (let pass = 0; pass < 4; pass++) {
        const ink = analyzeInkBox(img, sx, sy, sw, sh);
        if (!ink) break;
        const gx = Math.round(Math.max(sw, sh) * 0.012);
        const nx = Math.max(0, Math.round(ink.x) - gx);
        const ny = Math.max(0, Math.round(ink.y) - gx);
        const nw = Math.min(img.naturalWidth - nx, Math.round(ink.w) + gx * 2);
        const nh = Math.min(img.naturalHeight - ny, Math.round(ink.h) + gx * 2);
        const shrunk = sw - nw > Math.max(2, sw * 0.01) || sh - nh > Math.max(2, sh * 0.01)
          || Math.abs(nx - sx) > Math.max(2, sw * 0.01) || Math.abs(ny - sy) > Math.max(2, sh * 0.01);
        if (!shrunk) break;
        sx = nx; sy = ny; sw = nw; sh = nh;
      }
    }

    // 小图形放大到至少 480 宽，避免打印成糊块，上不封顶不超过原图 3 倍
    const maxW = o.maxWidth || 1400;
    const minW = o.minWidth || 480;
    let scale = Math.min(maxW / sw, 3);
    if (sw * scale < minW) scale = Math.min(3, minW / sw);
    scale = Math.max(1, scale);
    const w = Math.round(sw * scale);
    const h = Math.round(sh * scale);

    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    return { dataUrl: c.toDataURL(o.type || 'image/png'), width: w, height: h };
  }

  /** 把一张图形裁图上传成可长期访问的地址 */
  async function uploadImage(dataUrl) {
    const r = await api('/api/upload', { method: 'POST', body: { dataUrl } });
    return r.url;
  }

  /** 已有图形（有 url 或只有 src）的统一显示地址 */
  function figSrc(f) {
    if (!f) return '';
    return f.url || f.src || '';
  }

  /**
   * 题库下拉用的选项：按层级缩进，同名的不同级也能分清。
   * 题库是树（parentId），这里把父级路径带在后面。
   */
  function folderOptions(folders) {
    const all = folders || [];
    const byParent = new Map();
    all.forEach(function (f) {
      const p = f.parentId || '';
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p).push(f);
    });
    const out = [];
    function walk(parentId, depth, path) {
      (byParent.get(parentId) || []).forEach(function (f) {
        out.push({
          id: f.id,
          name: f.name,
          depth: depth,
          label: '　'.repeat(depth) + f.name + (path ? '（' + path + '）' : '')
        });
        walk(f.id, depth + 1, path ? path + ' / ' + f.name : f.name);
      });
    }
    walk('', 0, '');
    return out;
  }

  /**
   * 识别结果落图：模型只给了归一化框选，这里按框从原图裁出独立图形并上传，
   * 题目里就能直接引用图形图片。all 为 true 时连无 url 的框选一起补齐。
   */
  async function hydrateFigures(list, sourceImage, onProgress) {
    let done = 0;
    for (const q of (list || [])) {
      const base = q.sourceImage || q.fromImage || sourceImage || '';
      if (!base || !Array.isArray(q.figures)) continue;
      for (const f of q.figures) {
        if (f.url && !f.httpLost) continue;
        if (!Array.isArray(f.bbox) || f.bbox.length !== 4) continue;
        try {
          const r = await cropRegion(base, f.bbox);
          f.url = await uploadImage(r.dataUrl);
          f.width = r.width;
          f.height = r.height;
        } catch (e) {
          // 裁剪失败不阻断整批保存，用户可在编辑里手动框选
        }
        done += 1;
        if (onProgress) onProgress(done);
      }
      if (!q.image && q.figures[0] && q.figures[0].url) q.image = q.figures[0].url;
    }
    return list;
  }

  return {
    store, api, rich, renderStem, renderAnswer, stemForPaper, stemText, embeddedFigures, escapeHtml, fmtDate, fmtDay, brief, pool,
    doPrint, requestPrint, setPrintHandler, isDesktop,
    costEstimate, downscaleImage, download, downloadBase64, normalizeImported, TYPE_TAG, BASE_COST,
    loadImage, cropRegion, uploadImage, figSrc, hydrateFigures, figureMap, pendingFigures, folderOptions,
    TEXTPROC, applyTextProc, mathToPlain, mergeLines, collapseSpaces, fullToHalf, toBlanks, stripNoise,
    DIFFICULTIES, MASTERY_LEVELS, normDifficulty, diffValue, normMastery
  };
})();
