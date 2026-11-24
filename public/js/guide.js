/* 指引与帮助：新手分步引导 + 页面帮助面板 + 总览指南
 * 纯 DOM 实现，不依赖任何框架，遮挡层用四块遮罩围出高亮区（兼容性最稳）。
 */
window.TKGuide = (function () {
  'use strict';

  const LS_DONE = 'tiku-guide-done';
  const Z = 30000;

  let layer = null;      // 引导层根节点
  let current = null;    // 当前步骤
  let steps = [];
  let idx = 0;
  let opts = {};
  let highlight = null;  // 高亮框
  let bubble = null;     // 气泡
  let maskNodes = [];
  let tourEndCb = null;   // 引导结束时的回调（用来延后弹提示，免得提示被遮罩挡住）

  /* ---------------- 工具 ---------------- */

  function h(tag, cls, html) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html !== undefined) el.innerHTML = html;
    return el;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function storeGet(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function storeSet(k, v) {
    try { localStorage.setItem(k, v); } catch (e) { /* 隐私模式会失败，忽略 */ }
  }

  /* ---------------- 引导层 ---------------- */

  function ensureLayer() {
    if (layer) return layer;
    layer = h('div', 'tk-guide-layer');
    layer.style.zIndex = String(Z);
    document.body.appendChild(layer);
    return layer;
  }

  function destroyLayer() {
    if (layer) { layer.remove(); layer = null; }
    highlight = null;
    bubble = null;
    maskNodes = [];
    current = null;
  }

  /** 找到步骤要指的元素 */
  function findTarget(step) {
    if (!step || !step.target) return null;
    try {
      return document.querySelector(step.target);
    } catch (e) {
      return null;
    }
  }

  /** 画四块遮罩围出高亮区 */
  function paintMask(rect) {
    maskNodes.forEach((n) => n.remove());
    maskNodes = [];
    const mk = (style) => {
      const n = h('div', 'tk-guide-mask');
      Object.assign(n.style, style);
      layer.appendChild(n);
      maskNodes.push(n);
      return n;
    };
    const top = Math.max(0, rect.top);
    const left = Math.max(0, rect.left);
    const right = Math.max(0, window.innerWidth - rect.right);
    const bottom = Math.max(0, window.innerHeight - rect.bottom);
    mk({ top: '0px', left: '0px', right: '0px', height: top + 'px' });
    mk({ top: rect.bottom + 'px', left: '0px', right: '0px', bottom: '0px' });
    mk({ top: top + 'px', left: '0px', width: left + 'px', height: rect.height + 'px' });
    mk({ top: top + 'px', left: rect.right + 'px', right: '0px', height: rect.height + 'px' });
  }

  /** 气泡放在目标旁边，自动躲开屏幕边缘 */
  function placeBubble(rect) {
    const gap = 14;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const bw = bubble.offsetWidth;
    const bh = bubble.offsetHeight;
    let placement = (current && current.placement) || 'bottom';
    if (placement === 'bottom' && rect.bottom + gap + bh > vh - 8) placement = 'top';
    if (placement === 'top' && rect.top - gap - bh < 8) placement = 'bottom';
    if (placement === 'right' && rect.right + gap + bw > vw - 8) placement = 'left';
    if (placement === 'left' && rect.left - gap - bw < 8) placement = 'right';

    let top = 0;
    let left = 0;
    if (placement === 'bottom') { top = rect.bottom + gap; left = rect.left + rect.width / 2 - bw / 2; }
    else if (placement === 'top') { top = rect.top - gap - bh; left = rect.left + rect.width / 2 - bw / 2; }
    else if (placement === 'right') { top = rect.top + rect.height / 2 - bh / 2; left = rect.right + gap; }
    else { top = rect.top + rect.height / 2 - bh / 2; left = rect.left - gap - bw; }

    left = Math.max(8, Math.min(left, vw - bw - 8));
    top = Math.max(8, Math.min(top, vh - bh - 8));
    bubble.style.left = Math.round(left) + 'px';
    bubble.style.top = Math.round(top) + 'px';
    bubble.setAttribute('data-placement', placement);
  }

  /** 定位当前步骤 */
  function locate() {
    if (!current) return;
    const target = findTarget(current);
    if (!target) {
      // 目标不在（页面元素变了）：跳过这一步
      next(true);
      return;
    }
    try { target.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (e) {}
    const rect = target.getBoundingClientRect();
    const pad = 6;
    const box = {
      top: rect.top - pad, left: rect.left - pad,
      right: rect.right + pad, bottom: rect.bottom + pad,
      width: rect.width + pad * 2, height: rect.height + pad * 2
    };
    paintMask(box);
    if (!highlight) {
      highlight = h('div', 'tk-guide-hl');
      layer.appendChild(highlight);
    }
    Object.assign(highlight.style, {
      top: box.top + 'px', left: box.left + 'px',
      width: box.width + 'px', height: box.height + 'px'
    });
    placeBubble(box);
  }

  /* ---------------- 气泡内容 ---------------- */

  function renderBubble() {
    const last = idx >= steps.length - 1;
    const total = steps.length;
    const step = current;
    bubble = h('div', 'tk-guide-bubble');
    bubble.innerHTML =
      '<div class="tk-guide-hd">' +
        '<span class="tk-guide-no">' + (idx + 1) + ' / ' + total + '</span>' +
        '<span class="tk-guide-tt">' + esc(step.title || '') + '</span>' +
      '</div>' +
      '<div class="tk-guide-tx">' + esc(step.text || '') + '</div>' +
      (step.tip ? '<div class="tk-guide-tip"><b>提示：</b>' + esc(step.tip) + '</div>' : '') +
      '<div class="tk-guide-ft">' +
        '<button class="tk-guide-btn tk-guide-skip">跳过</button>' +
        '<span class="tk-guide-sp"></span>' +
        '<button class="tk-guide-btn tk-guide-prev"' + (idx === 0 ? ' disabled' : '') + '>上一步</button>' +
        '<button class="tk-guide-btn tk-guide-next tk-guide-primary">' +
          (last ? '完成' : '下一步') +
        '</button>' +
      '</div>';
    layer.appendChild(bubble);

    bubble.querySelector('.tk-guide-next').onclick = () => next();
    bubble.querySelector('.tk-guide-prev').onclick = () => prev();
    bubble.querySelector('.tk-guide-skip').onclick = () => finish(true);
  }

  /* ---------------- 步骤控制 ---------------- */

  function showStep(i) {
    idx = i;
    current = steps[i];
    if (!current) { finish(false); return; }
    if (layer) {
      // 重画：清掉旧气泡和旧遮罩
      if (bubble) { bubble.remove(); bubble = null; }
      maskNodes.forEach((n) => n.remove());
      maskNodes = [];
    }
    ensureLayer();
    renderBubble();

    // 需要先切到别的页面
    const targetView = current.view;
    if (targetView && window.TK && TK.store && TK.store.view !== targetView) {
      TK.store.view = targetView;
      setTimeout(locate, 260);
    } else {
      setTimeout(locate, 60);
    }
  }

  function next(auto) {
    if (auto && idx < steps.length - 1) {
      // 目标不存在时自动跳过，别卡住用户
      idx++;
      current = steps[idx];
      if (bubble) { bubble.remove(); bubble = null; }
      maskNodes.forEach((n) => n.remove());
      maskNodes = [];
      renderBubble();
      setTimeout(locate, 60);
      return;
    }
    if (idx >= steps.length - 1) { finish(false); return; }
    idx++;
    showStep(idx);
  }

  function prev() {
    if (idx <= 0) return;
    idx--;
    showStep(idx);
  }

  function finish(skipped) {
    destroyLayer();
    if (opts.key) storeSet(opts.key, '1');
    if (tourEndCb) {
      const cb = tourEndCb;
      tourEndCb = null;
      try { cb(); } catch (e) { /* 回调出错不影响收尾 */ }
    }
    if (!skipped && opts.onDone) opts.onDone();
  }

  /* ---------------- 对外接口 ---------------- */

  /**
   * 开始一段分步引导
   * @param {Array} list 步骤数组：{view, target, title, text, tip, placement}
   * @param {Object} o   { key: 记住用的键, onDone, force }
   */
  function start(list, o) {
    const op = o || {};
    if (!list || !list.length) return;
    if (!op.force && op.key && storeGet(op.key)) return;
    steps = list.slice();
    opts = op;
    ensureLayer();
    // 点遮罩不关闭，但点右上角关闭按钮可以
    const close = h('button', 'tk-guide-close', '×');
    close.title = '关闭指引';
    close.onclick = () => finish(true);
    layer.appendChild(close);
    showStep(0);
  }

  /* ---------------- 页面帮助面板 ---------------- */

  let helpEl = null;
  let helpMask = null;

  /**
   * 关掉帮助面板。
   * 遮罩必须一起清掉：之前只删了面板，遮罩留在页面上，
   * 点完"知道了"整个程序就点不动了。
   */
  function closeHelp() {
    if (helpEl) { helpEl.remove(); helpEl = null; }
    if (helpMask) { helpMask.remove(); helpMask = null; }
    document.body.style.overflow = '';
  }

  /**
   * 打开某个页面的帮助
   * @param {string} key 页面标识
   */
  function openHelp(key) {
    const data = window.TKGuideData;
    if (!data) return;
    const page = (data.pages || {})[key];
    if (!page) return;
    closeHelp();
    const mask = h('div', 'tk-help-mask');
    helpMask = mask;
    const box = h('div', 'tk-help');
    let body = '<div class="tk-help-summary">' + esc(page.summary || '') + '</div>';
    (page.sections || []).forEach((sec) => {
      body += '<div class="tk-help-sec"><div class="tk-help-sec-t">' + esc(sec.title) + '</div><ul>';
      (sec.items || []).forEach((it) => {
        if (typeof it === 'string') {
          body += '<li>' + esc(it) + '</li>';
        } else {
          body += '<li><b>' + esc(it.k || '') + '</b>　' + esc(it.v || '') + '</li>';
        }
      });
      body += '</ul></div>';
    });
    (page.tips || []).forEach((t) => {
      body += '<div class="tk-help-tip"><b>提示：</b>' + esc(t) + '</div>';
    });
    box.innerHTML =
      '<div class="tk-help-head">' +
        '<div>' +
          '<div class="tk-help-title">' + esc(page.title || '') + '</div>' +
          '<div class="tk-help-sub">' + esc(page.sub || '') + '</div>' +
        '</div>' +
        '<button class="tk-help-x" title="关闭">×</button>' +
      '</div>' +
      '<div class="tk-help-body">' + body + '</div>' +
      '<div class="tk-help-foot">' +
        '<button class="tk-help-tour">看这个页面的操作引导</button>' +
        '<button class="tk-help-ok">知道了</button>' +
      '</div>';
    document.body.appendChild(mask);
    document.body.appendChild(box);
    document.body.style.overflow = 'hidden';
    helpEl = box;
    box.querySelector('.tk-help-x').onclick = closeHelp;
    box.querySelector('.tk-help-ok').onclick = closeHelp;
    mask.onclick = closeHelp;
    const tourBtn = box.querySelector('.tk-help-tour');
    const tour = (data.tours || {})[key];
    if (tour && tour.length) {
      tourBtn.onclick = () => { closeHelp(); start(tour, { key: 'tiku-tour-' + key, force: true }); };
    } else {
      tourBtn.style.display = 'none';
    }
    requestAnimationFrame(() => box.classList.add('tk-help-in'));
  }

  /** 打开总览指南 */
  function openOverview() {
    const data = window.TKGuideData;
    if (!data) return;
    const ov = data.overview || {};
    closeHelp();
    const mask = h('div', 'tk-help-mask');
    helpMask = mask;
    const box = h('div', 'tk-help tk-help-wide');
    let body = '<div class="tk-help-summary">' + esc(ov.summary || '') + '</div>';
    if (ov.flow && ov.flow.length) {
      body += '<div class="tk-help-sec"><div class="tk-help-sec-t">一条龙怎么走</div><div class="tk-flow">';
      ov.flow.forEach((f, i) => {
        body += '<div class="tk-flow-i"><span class="tk-flow-n">' + (i + 1) + '</span>' +
          '<b>' + esc(f.t) + '</b><span>' + esc(f.v) + '</span></div>';
        if (i < ov.flow.length - 1) body += '<div class="tk-flow-arrow">↓</div>';
      });
      body += '</div></div>';
    }
    (ov.sections || []).forEach((sec) => {
      body += '<div class="tk-help-sec"><div class="tk-help-sec-t">' + esc(sec.title) + '</div><ul>';
      (sec.items || []).forEach((it) => {
        if (typeof it === 'string') body += '<li>' + esc(it) + '</li>';
        else body += '<li><b>' + esc(it.k || '') + '</b>　' + esc(it.v || '') + '</li>';
      });
      body += '</ul></div>';
    });
    (ov.tips || []).forEach((t) => {
      body += '<div class="tk-help-tip"><b>提示：</b>' + esc(t) + '</div>';
    });
    box.innerHTML =
      '<div class="tk-help-head">' +
        '<div>' +
          '<div class="tk-help-title">使用指南</div>' +
          '<div class="tk-help-sub">从录题到出卷，一条龙怎么走</div>' +
        '</div>' +
        '<button class="tk-help-x" title="关闭">×</button>' +
      '</div>' +
      '<div class="tk-help-body">' + body + '</div>' +
      '<div class="tk-help-foot">' +
        '<button class="tk-help-tour">重看新手引导</button>' +
        '<button class="tk-help-ok">知道了</button>' +
      '</div>';
    document.body.appendChild(mask);
    document.body.appendChild(box);
    document.body.style.overflow = 'hidden';
    helpEl = box;
    box.querySelector('.tk-help-x').onclick = closeHelp;
    box.querySelector('.tk-help-ok').onclick = closeHelp;
    mask.onclick = closeHelp;
    box.querySelector('.tk-help-tour').onclick = () => {
      closeHelp();
      start(data.tour || [], { key: 'tiku-tour', force: true });
    };
    requestAnimationFrame(() => box.classList.add('tk-help-in'));
  }

  /* ---------------- 键盘与窗口 ---------------- */

  document.addEventListener('keydown', function (e) {
    if (bubble && layer && layer.parentNode) {
      if (e.key === 'Escape') { finish(true); return; }
      if (e.key === 'ArrowRight') { next(); return; }
      if (e.key === 'ArrowLeft') { prev(); return; }
    }
    if (e.key === 'Escape' && helpEl) closeHelp();
  });

  window.addEventListener('resize', function () { if (bubble) locate(); });
  window.addEventListener('scroll', function () { if (bubble) locate(); }, true);

  return {
    start: start,
    openHelp: openHelp,
    openOverview: openOverview,
    closeHelp: closeHelp,
    isDone: function (k) { return !!storeGet(k || 'tiku-tour'); },
    markDone: function (k) { storeSet(k || 'tiku-tour', '1'); },
    reset: function () { try { localStorage.removeItem('tiku-tour'); } catch (e) {} },
    /** 引导是否正在进行 */
    isTourRunning: function () { return !!(layer && bubble); },
    /** 引导结束时回调一次（用来把提示挪到引导之后弹，不然会被遮罩挡住） */
    onTourEnd: function (cb) { tourEndCb = cb; }
  };
})();
