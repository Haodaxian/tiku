window.ViewImport = {
  setup() {
    const { ref, shallowRef, reactive, computed, onMounted, nextTick } = Vue;
    const { ElMessage } = ElementPlus;
    const store = TK.store;

    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    }

    const tab = ref('images');
    /* ---------- 整卷图片 ---------- */
    const fileInput = ref(null);
    const pages = ref([]);
    const dragging = ref(false);
    const busy = ref(false);
    const doneCount = ref(0);
    const elapsed = ref(0);
    const folderId = ref(store.folders[0] ? store.folders[0].id : '');
    const folderOptions = computed(() => TK.folderOptions(store.folders));
    const saving = ref(false);

    /* ---------- 题卡 / 章节：框选结果先进当前题卡，可多次累积 ---------- */
    let cardSeq = 0;
    function newCard(name) {
      cardSeq += 1;
      return { id: 'card_' + Date.now().toString(36) + '_' + cardSeq, name: name || ('题卡 ' + cardSeq), questions: [] };
    }
    const cards = ref([newCard('一、选择题')]);
    const activeCardId = ref(cards.value[0].id);
    const results = ref([]);
    const activeCard = computed(() => cards.value.find((c) => c.id === activeCardId.value) || cards.value[0]);
    const totalQuestions = computed(() => cards.value.reduce((n, c) => n + c.questions.length, 0));
    const previewVisible = ref(false);

    function addCard() { const c = newCard(); cards.value.push(c); activeCardId.value = c.id; }
    function selectCard(id) { activeCardId.value = id; }
    function removeCard(id) {
      if (cards.value.length <= 1) return;
      const idx = cards.value.findIndex((c) => c.id === id);
      if (idx < 0) return;
      cards.value.splice(idx, 1);
      if (activeCardId.value === id) activeCardId.value = cards.value[Math.max(0, idx - 1)].id;
    }
    function clearActiveCard() { activeCard.value.questions = []; }
    function moveQuestion(i, delta) {
      const list = activeCard.value.questions;
      const j = i + delta;
      if (j < 0 || j >= list.length) return;
      const t = list[i]; list[i] = list[j]; list[j] = t;
    }

    const selected = computed(() => results.value.filter((q) => q._checked));
    const allSelected = computed(() => results.value.length > 0 && results.value.every((q) => q._checked));
    const editVisible = ref(false);
    const editSaving = ref(false);
    const draft = ref(null);

    const knowledgeOptions = computed(() => {
      const set = new Set();
      (store.questions || []).forEach((q) => (q.knowledge || []).forEach((k) => set.add(k)));
      return Array.from(set).slice(0, 200);
    });
    const tagOptions = computed(() => {
      const set = new Set();
      (store.questions || []).forEach((q) => (q.tags || []).forEach((t) => set.add(t)));
      return Array.from(set).slice(0, 200);
    });

    function typeTag(t) { return TK.TYPE_TAG[t] || 'info'; }
    function figSrc(f) { return TK.figSrc(f); }
    function figureSrcs(q) { return (q.figures || []).map((f) => TK.figSrc(f)).filter(Boolean); }

    /** 识别结果进哪里：PDF 框选进当前题卡，整卷图片进 results */
    function pushResults(list, sourceName) {
      const target = tab.value === 'pdf' ? activeCard.value.questions : results.value;
      for (const q of list) {
        target.push(Object.assign(q, { _checked: true, source: sourceName }));
      }
    }

    function pick() { fileInput.value && fileInput.value.click(); }

    async function addPage(file) {
      if (!file) return;
      if (!/^image\//.test(file.type)) {
        // 原来直接 return，拖进来一个 PDF 界面毫无反应，
        // 老师会以为是程序坏了
        ElMessage.warning('「' + file.name + '」不是图片，整卷照片只支持图片（PDF 请用下面的 PDF 导入）');
        return;
      }
      try {
        const url = await TK.downscaleImage(file, 1600);
        pages.value.push({ id: 'p_' + Date.now() + Math.random().toString(36).slice(2, 6), url, name: file.name });
      } catch (e) {
        ElMessage.error('「' + file.name + '」读取失败：' + (e && e.message ? e.message : '未知原因'));
      }
    }

    async function onFiles(e) {
      for (const f of Array.from(e.target.files || [])) await addPage(f);
      // 必须清空，否则同一个文件再选一次不会触发 change
      e.target.value = '';
    }

    async function onDrop(e) {
      dragging.value = false;
      for (const f of Array.from((e.dataTransfer && e.dataTransfer.files) || [])) await addPage(f);
    }

    async function recognizePages() {
      if (!store.settings.hasKey) { ElMessage.warning('请先在「设置」里填写 API Key'); store.view = 'settings'; return; }
      const queue = pages.value.slice();
      busy.value = true;
      doneCount.value = 0;
      elapsed.value = 0;
      const t0 = Date.now();
      const timer = setInterval(() => { elapsed.value = Math.round((Date.now() - t0) / 1000); }, 500);
      try {
        const outcomes = await TK.pool(queue, 3, async (p, idx) => {
          const list = await TK.api('/api/recognize', {
            method: 'POST',
            timeout: 150000,
            body: { images: [p.url], mode: 'paper', subject: hintSubject.value, grade: hintGrade.value }
          });
          // 整卷识别出的图形按归一化框选，从这一页原图上裁成独立图片
          await TK.hydrateFigures(list, p.url);
          doneCount.value += 1;
          return { list, p, idx };
        });

        let added = 0;
        outcomes.forEach((o, i) => {
          if (!o.ok) {
            ElMessage.error('第 ' + (i + 1) + ' 页识别失败：' + o.error.message);
            return;
          }
          pushResults(o.value.list, o.value.p.name);
          added += o.value.list.length;
        });

        if (added) {
          const sec = Math.round((Date.now() - t0) / 1000);
          ElMessage.success('整卷识别完成，共 ' + added + ' 道（用了 ' + sec + ' 秒）');
          pages.value = [];
        }
      } finally {
        clearInterval(timer);
        busy.value = false;
      }
    }

    function toggleAll() {
      const t = !allSelected.value;
      results.value.forEach((q) => { q._checked = t; });
    }

    async function save() {
      const list = selected.value;
      if (!list.length) { ElMessage.warning('没有可保存的题目'); return; }
      saving.value = true;
      try {
        await TK.hydrateFigures(list);
        const payload = list.map((q) => Object.assign({}, q, {
          source: q.source || '试卷导入',
          folderId: folderId.value
        }));
        const r = await TK.api('/api/questions/save', { method: 'POST', body: { questions: payload, folderId: folderId.value } });
        ElMessage.success('已保存 ' + r.added + ' 道' + (r.skipped ? '，跳过重复 ' + r.skipped + ' 道' : ''));
        results.value = results.value.filter((q) => !q._checked);
        const bs = await TK.api('/api/bootstrap');
        store.questions = bs.questions;
        store.stats = bs.stats;
      } catch (e) {
        ElMessage.error(e.message);
      } finally {
        saving.value = false;
      }
    }

    /** PDF 题卡整批入库：按题卡顺序保存，题卡名写进教材章节（没填就不覆盖） */
    async function saveAll() {
      const all = [];
      for (const c of cards.value) {
        const name = String(c.name || '').trim();
        for (const q of c.questions) {
          all.push(Object.assign({}, q, {
            chapter: q.chapter || (name && !/^题卡\s*\d+$/.test(name) ? name : ''),
            source: q.source || 'PDF 框选',
            folderId: folderId.value
          }));
        }
      }
      if (!all.length) { ElMessage.warning('题卡里还没有题目'); return; }
      saving.value = true;
      try {
        await TK.hydrateFigures(all);
        const r = await TK.api('/api/questions/save', { method: 'POST', body: { questions: all, folderId: folderId.value } });
        ElMessage.success('已保存 ' + r.added + ' 道' + (r.skipped ? '，跳过重复 ' + r.skipped + ' 道' : ''));
        cards.value.forEach((c) => { c.questions = []; });
        const bs = await TK.api('/api/bootstrap');
        store.questions = bs.questions;
        store.stats = bs.stats;
      } catch (e) {
        ElMessage.error(e.message);
      } finally {
        saving.value = false;
      }
    }

    /* ---------- PDF ---------- */
    const pdfInput = ref(null);
    // 必须用 shallowRef：pdf.js 的对象带 # 私有字段，被 Vue 包成 Proxy 后调用 getPage() 会直接报错
    const pdfDoc = shallowRef(null);
    const pdfName = ref('');
    const pdfLoading = ref(false);
    const pageCount = ref(0);
    const pageNo = ref(1);
    const thumbs = reactive({});
    const mainCanvas = shallowRef(null);
    const selLayer = ref(null);
    const wrapRef = ref(null);
    const zoom = ref(1);
    const sel = ref(null);
    const currentBlob = ref('');
    let dragging_ = false;

    async function onPdf(e) {
      const file = (e.target.files || [])[0];
      e.target.value = '';
      if (!file) return;
      if (!window.pdfjsLib) { ElMessage.error('PDF 组件没有加载，请重新启动程序'); return; }
      pdfLoading.value = true;
      pdfName.value = file.name;
      Object.keys(textCache).forEach((k) => delete textCache[k]);
      try {
        const buf = await file.arrayBuffer();
        pdfDoc.value = await window.pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
        pageCount.value = pdfDoc.value.numPages;
        pageNo.value = 1;
        Object.keys(thumbs).forEach((k) => delete thumbs[k]);
        await renderMain(1);
        await nextTick();
        fitZoom();
        for (let i = 1; i <= Math.min(pageCount.value, 6); i++) await renderThumb(i);
      } catch (err) {
        console.error('[PDF] 打开失败', err);
        ElMessage.error('这个 PDF 打不开：' + (err && err.message ? err.message : '文件可能已损坏'));
        resetPdf();
      } finally {
        pdfLoading.value = false;
      }
    }

    async function renderMain(n) {
      if (!pdfDoc.value) return;
      const page = await pdfDoc.value.getPage(n);
      // 渲染分辨率固定按 1.5 倍（裁切清晰度靠它），显示大小由 zoom 单独控制，
      // 这样放大缩小只改 CSS 尺寸，不用重渲染、也不会损失画质。
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = mainCanvas.value;
      if (!canvas) return;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      applyZoom();
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      currentBlob.value = canvas.toDataURL('image/jpeg', 0.9);
      sel.value = null;
    }

    /** 缩放只改显示尺寸，选框坐标始终以 CSS 像素记录，裁切时再换算回画布像素 */
    function applyZoom() {
      const canvas = mainCanvas.value;
      if (!canvas || !canvas.width) return;
      const w = Math.round(canvas.width * zoom.value);
      canvas.style.width = w + 'px';
      canvas.style.height = Math.round(canvas.height * zoom.value) + 'px';
    }

    function setZoom(next) {
      const z = Math.max(0.4, Math.min(2, Number(next) || 1));
      zoom.value = Math.round(z * 100) / 100;
      applyZoom();
    }

    function zoomBy(delta) { setZoom(zoom.value + delta); }

    /** 缩放到适合容器宽度，让整页一眼看全 */
    function fitZoom() {
      const canvas = mainCanvas.value;
      const wrap = wrapRef.value;
      if (!canvas || !canvas.width || !wrap) return;
      const avail = wrap.clientWidth - 28;
      if (avail > 0) setZoom(avail / canvas.width);
    }

    async function renderThumb(n) {
      if (!pdfDoc.value || thumbs[n]) return;
      try {
        const page = await pdfDoc.value.getPage(n);
        const viewport = page.getViewport({ scale: 0.24 });
        const c = document.createElement('canvas');
        c.width = Math.floor(viewport.width);
        c.height = Math.floor(viewport.height);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        thumbs[n] = c.toDataURL('image/jpeg', 0.7);
      } catch (e) { /* 缩略图失败不影响 */ }
    }

    async function gotoPage(n) {
      if (n < 1 || n > pageCount.value) return;
      pageNo.value = n;
      pdfLoading.value = true;
      try {
        await renderMain(n);
        await renderThumb(n);
        if (n + 1 <= pageCount.value) renderThumb(n + 1);
      } finally {
        pdfLoading.value = false;
      }
    }

    function resetPdf() {
      pdfDoc.value = null;
      pageCount.value = 0;
      pageNo.value = 1;
      sel.value = null;
      Object.keys(thumbs).forEach((k) => delete thumbs[k]);
    }

    function startSel(e) {
      const canvas = mainCanvas.value;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
      dragging_ = true;
      sel.value = { x, y, w: 0, h: 0 };
    }

    function moveSel(e) {
      if (!dragging_ || !sel.value) return;
      const rect = mainCanvas.value.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
      const s = sel.value;
      sel.value = {
        x: Math.min(x, s.x), y: Math.min(y, s.y),
        w: Math.abs(x - s.x), h: Math.abs(y - s.y)
      };
    }

    function endSel() {
      dragging_ = false;
      if (sel.value && (sel.value.w < 12 || sel.value.h < 12)) sel.value = null;
    }

    function clearSel() { sel.value = null; }

    /** 按当前选框裁图：选区是 CSS 像素，画布是渲染像素，必须换算后再取图。
     *  默认零留白：严格按老师框的范围裁，多留白会把上下相邻行的内容一起带进来。 */
    function cropRegion(pad) {
      const canvas = mainCanvas.value;
      const s = sel.value;
      if (!canvas || !s) return '';
      const rectCss = canvas.getBoundingClientRect();
      const k = rectCss.width ? canvas.width / rectCss.width : 1;
      const p = (pad === undefined ? 0 : pad) * k;
      const x = Math.max(0, Math.round(s.x * k - p));
      const y = Math.max(0, Math.round(s.y * k - p));
      const w = Math.max(1, Math.min(canvas.width - x, Math.round(s.w * k + p * 2)));
      const h = Math.max(1, Math.min(canvas.height - y, Math.round(s.h * k + p * 2)));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.92);
    }

    /* ---------- 框选后确认：文字 / 图片 ---------- */
    const cropVisible = ref(false);
    const cropKind = ref('text');
    const cropText = ref('');
    const cropImage = ref('');
    const cropHasText = ref(false);
    const cropBusy = ref(false);
    const cropOcrBusy = ref(false);
    const cropOcrFail = ref('');
    const ocrHint = ref('');
    const cropSource = ref('');
    const textCache = {};

    /** 当前页文字层，坐标换算到画布像素（scale 1.5） */
    async function textItemsOf(n) {
      if (textCache[n]) return textCache[n];
      const page = await pdfDoc.value.getPage(n);
      const viewport = page.getViewport({ scale: 1.5 });
      const tc = await page.getTextContent();
      const U = (window.pdfjsLib && window.pdfjsLib.Util) || null;
      const items = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        let m = null;
        if (U && U.transform) m = U.transform(viewport.transform, it.transform);
        else {
          const v = viewport.transform;
          const t = it.transform;
          m = [
            v[0] * t[0] + v[2] * t[1], v[1] * t[0] + v[3] * t[1],
            v[0] * t[2] + v[2] * t[3], v[1] * t[2] + v[3] * t[3],
            v[0] * t[4] + v[2] * t[5] + v[4], v[1] * t[4] + v[3] * t[5] + v[5]
          ];
        }
        const h = Math.hypot(m[2], m[3]) || 12;
        const w = Math.max(h * 0.4, it.str.replace(/\s/g, '').length * h * 0.52);
        items.push({ str: it.str, x: m[4], y: m[5] - h, w, h });
      }
      textCache[n] = items;
      return items;
    }

    function textInRect(items, rect) {
      // 用「文字有任一部位落在选框内」判断，而不是中心点：
      // 老师框选常常只压住文字的上半截或下半截，按中心点会整条漏掉，
      // 于是明明有文字的题被判成「没有文字层，只能按图片裁切」。
      const x0 = rect.x, y0 = rect.y, x1 = rect.x + rect.w, y1 = rect.y + rect.h;
      const inside = items.filter((t) => {
        const tx1 = t.x + t.w;
        const ty1 = t.y + t.h;
        return tx1 > x0 && t.x < x1 && ty1 > y0 && t.y < y1;
      });
      inside.sort((a, b) => (a.y - b.y) || (a.x - b.x));
      const lines = [];
      for (const t of inside) {
        const last = lines[lines.length - 1];
        if (last && Math.abs(t.y - last.y) < Math.max(last.h, t.h) * 0.6) last.items.push(t);
        else lines.push({ y: t.y, h: t.h, items: [t] });
      }
      return lines.map((line) => {
        let out = '';
        let end = 0;
        line.items.sort((a, b) => a.x - b.x).forEach((t) => {
          if (out && t.x - end > line.h * 0.35) out += ' ';
          out += t.str;
          end = t.x + t.w;
        });
        return out.replace(/\s+/g, ' ').trim();
      }).filter(Boolean).join('\n').trim();
    }

    async function openCrop() {
      const s = sel.value;
      if (!s || !mainCanvas.value) return;
      if (ocrHint.value) return; // 上一块还在识别，别叠加
      const canvas = mainCanvas.value;
      const rectCss = canvas.getBoundingClientRect();
      // 选框是画布显示尺寸下的像素，画布内部分辨率固定 1.5 倍，两者比例即换算系数
      const k = rectCss.width ? canvas.width / rectCss.width : 1;
      const rect = { x: s.x * k, y: s.y * k, w: s.w * k, h: s.h * k };
      cropImage.value = cropRegion();
      cropText.value = '';
      cropHasText.value = false;
      cropOcrFail.value = '';
      cropSource.value = pdfName.value + ' 第' + pageNo.value + '页';
      cropKind.value = 'image';

      let items = [];
      try {
        items = await textItemsOf(pageNo.value);
      } catch (e) { /* 没有文字层 */ }

      const txt = items.length ? textInRect(items, rect) : '';
      if (txt) {
        // 有文字层：立即弹窗，零等待
        cropText.value = txt;
        cropHasText.value = true;
        cropKind.value = 'text';
        cropVisible.value = true;
        return;
      }
      if (!store.settings.hasKey) {
        cropKind.value = 'image';
        cropVisible.value = true;
        return;
      }
      // 扫描件要等模型几秒：先不弹窗，在页面上显示明显的识别中提示，
      // 识别完再把结果弹出来，老师不用盯着一个空弹窗干等。
      ocrHint.value = '正在识别这块的文字…';
      cropKind.value = 'text';
      await autoOcrCrop();
      ocrHint.value = '';
      cropVisible.value = true;
    }

    function closeCrop() {
      cropVisible.value = false;
      cropBusy.value = false;
      cropOcrBusy.value = false;
    }

    /**
     * 没有文字层时自动识别：把裁切图送去模型认一遍，转成可直接编辑的文字。
     * 走 single 模式，保证只出这一道题、不按题号拆。
     */
    async function autoOcrCrop() {
      if (cropOcrBusy.value || !cropImage.value) return;
      cropOcrBusy.value = true;
      try {
        const img = await TK.downscaleImage(cropImage.value, 1600);
        const list = await TK.api('/api/recognize', {
          method: 'POST', timeout: 150000,
          body: { images: [img], mode: 'single', subject: hintSubject.value, grade: hintGrade.value }
        });
        const q = (list && list[0]) || null;
        const stem = String((q && q.stem) || '').trim();
        if (!stem) {
          // 模型确实没认出文字（纯图形/手写）：退回图片，并说明原因，
          // 不能默默变成图片让老师以为功能坏了。
          cropKind.value = 'image';
          cropOcrFail.value = '这块没认出文字（可能是纯图形或手写），已按图片存';
          return;
        }
        const lines = [stem];
        if (q.options && q.options.length) {
          q.options.forEach((o) => lines.push(o.key + '. ' + o.text));
        }
        cropText.value = lines.join('\n');
        cropHasText.value = true;
        cropKind.value = 'text';
      } catch (e) {
        // 失败原因必须说出来：余额不足 / 超时 / 网络 / Key 无效，静默退回图片等于把问题藏起来
        cropKind.value = 'image';
        cropOcrFail.value = '识别失败：' + (e && e.message ? e.message : '未知原因') + '（可稍后重试，或按图片存）';
      } finally {
        cropOcrBusy.value = false;
      }
    }

    /** 手动重试：识别失败（超时、网络、余额）时给老师一个再试一次的机会 */
    function retryOcr() {
      if (cropOcrBusy.value) return;
      cropOcrFail.value = '';
      cropKind.value = 'text';
      return autoOcrCrop();
    }

    /** 文本处理器：把某个文本框的内容整体处理一遍 */
    function makeProc(target) {
      return (key) => {
        const before = String(target.value || '');
        const next = TK.applyTextProc(key, before);
        if (next === before) { ElMessage.info('内容没有需要改动的地方'); return; }
        target.value = next;
        ElMessage.success('已处理');
      };
    }

    /** 追加一段文字到题目：一次裁不完整就裁两次，都归在同一道题里 */
    function appendTextTo(cur, q) {
      const add = String(q.stem || '').trim();
      if (add) {
        cur.stem = cur.stem ? cur.stem + '\n' + add : add;
        // 已有富文本题干时（此前裁过图片），文字也必须并进 stemHtml，否则渲染时会被忽略
        if (cur.stemHtml) cur.stemHtml += '<br>' + TK.escapeHtml(add);
      }
      if ((q.options || []).length && !(cur.options || []).length) cur.options = q.options;
      if (q.answer && !cur.answer) cur.answer = q.answer;
      if (q.analysis && !cur.analysis) cur.analysis = q.analysis;
      cur.knowledge = Array.from(new Set((cur.knowledge || []).concat(q.knowledge || []))).slice(0, 10);
      if (q.type && q.type !== '其他' && (!cur.type || cur.type === '其他')) cur.type = q.type;
    }

    /**
     * 追加一张图片到题目。
     * 整块识别时模型会在题干里留 [图1] 占位，图形位置已固定；
     * 老师再单独框这个图形时要把图填进占位，不能再追加一份，
     * 否则 renderStem 会把占位和追加的 <img> 各渲染一遍，图就出现两次。
     */
    function appendImageTo(cur, url) {
      if (!url) return;
      cur.figures = Array.isArray(cur.figures) ? cur.figures : [];
      const head = String(cur.stemHtml || '') + '\n' + String(cur.stem || '');
      // 同一张图（同一地址）已经在这道题里了，直接跳过
      if (cur.figures.some((f) => TK.figSrc(f) === url) || head.indexOf(url) >= 0) return;

      const used = cur.figures.filter((f) => TK.figSrc(f)).map((f) => String(f.label || ''));
      const holders = head.match(/\[图\d+\]/g) || [];
      const placeholders = holders.map((m) => m.slice(1, -1));
      const free = placeholders.find((l) => used.indexOf(l) < 0);
      // 题干里还没填图的占位对应的空 figure 条目
      const empty = cur.figures.filter((f) => !TK.figSrc(f));

      if (free) {
        const imgHtml = '<img src="' + url + '" data-fig="1">';
        const match = empty.find((f) => String(f.label || '') === free);
        if (match) { match.url = url; }
        else {
          cur.figures.push({
            id: 'fig_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            label: free, desc: '', url
          });
        }
        // 有富文本题干时把占位就地换成 <img>，编辑器里也能直接看到这张图
        if (cur.stemHtml && cur.stemHtml.indexOf('[' + free + ']') >= 0) {
          cur.stemHtml = cur.stemHtml.split('[' + free + ']').join(imgHtml);
        }
        return;
      }
      if (empty.length) { empty[0].url = url; return; }

      const labels = cur.figures.map((f) => String(f.label || ''));
      let n = cur.figures.length + 1;
      while (labels.indexOf('图' + n) >= 0) n += 1;
      const label = '图' + n;
      cur.figures.push({
        id: 'fig_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        label, desc: '', url
      });
      // 占位和 <img> 只能有一种：两者都在时 renderStem 会各渲染一遍，图就出现两次。
      // 有富文本题干时补 <img>；纯文本题干只补 [图N]，由 renderStem 就地内嵌。
      if (cur.stemHtml) {
        cur.stemHtml = (cur.stemHtml ? cur.stemHtml + '<br>' : '') + '<img src="' + url + '" data-fig="1">';
      } else {
        cur.stem = (cur.stem ? cur.stem + '\n' : '') + '[' + label + ']';
      }
    }

    /** 同一题卡里的多次裁切都并进同一道题；题卡里还没有题时才新建一道 */
    function pushCropQuestion(q, kind) {
      const card = activeCard.value;
      const cur = card.questions[card.questions.length - 1];
      if (!cur) {
        card.questions.push(Object.assign(q, { _checked: true, source: cropSource.value }));
        return false;
      }
      if (kind === 'image') {
        const url = (q.figures && q.figures[0] && q.figures[0].url) || '';
        if (url) appendImageTo(cur, url);
      } else {
        appendTextTo(cur, q);
      }
      if (!cur.source) cur.source = cropSource.value;
      return true;
    }

    async function confirmCrop() {
      if (cropBusy.value) return;
      cropBusy.value = true;
      try {
        if (cropKind.value === 'text') {
          // 框选直接用 PDF 文字层原文：本来就已经是题干文字，再调模型要等十几秒却没多出信息。
          // 只做保守清洗（去页码页眉、压缩空格），换行必须保留——(1)(2) 小问和 A/B 选项靠换行分行，
          // 用「一键整理」那种合并断行会把它们并成一行，题干结构就废了。
          const raw = cropText.value.trim();
          const text = TK.applyTextProc('spaces', TK.applyTextProc('noise', raw)).trim();
          if (!text) { ElMessage.warning('这块没有文字层，请切换到「图片」'); cropBusy.value = false; return; }
          const appended = pushCropQuestion(plainQuestion(text), 'text');
          ElMessage.success(appended ? '已并入当前题目' : '已添加 1 道');
        } else {
          const url = await TK.uploadImage(cropImage.value);
          const appended = pushCropQuestion(imageQuestion(url), 'image');
          ElMessage.success(appended ? '已并入当前题目' : '已按图片添加 1 道，可到编辑里并入其它题');
        }
        cropVisible.value = false;
        sel.value = null;
      } catch (e) {
        ElMessage.error(e.message);
      } finally {
        cropBusy.value = false;
      }
    }

    function plainQuestion(text) {
      return {
        id: 'q_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        stem: text, type: '其他', options: [], answer: '', analysis: '',
        knowledge: [], difficulty: '中等', subject: hintSubject.value || '', grade: hintGrade.value || '',
        figures: [], _checked: true
      };
    }

    function imageQuestion(url) {
      const q = plainQuestion('[图1]');
      q.stemHtml = '<img src="' + url + '" data-fig="1">';
      q.figures = [{ id: 'fig_' + Date.now().toString(36), label: '图1', desc: '', url }];
      return q;
    }

    async function recognizePage() {
      if (!store.settings.hasKey) { ElMessage.warning('请先在「设置」里填写 API Key'); store.view = 'settings'; return; }
      if (!currentBlob.value) return;
      busy.value = true;
      try {
        // 大型扫描件整页转出来可能很大，先压到 1600px 再送模型，避免上传慢、容易超时
        const img = await TK.downscaleImage(currentBlob.value, 1600);
        const list = await TK.api('/api/recognize', {
          method: 'POST', timeout: 150000,
          body: { images: [img], mode: 'paper', subject: hintSubject.value, grade: hintGrade.value }
        });
        await TK.hydrateFigures(list, img);
        pushResults(list, pdfName.value + ' 第' + pageNo.value + '页');
        ElMessage.success('整页识别：' + list.length + ' 道');
      } catch (e) {
        ElMessage.error(e.message);
      } finally {
        busy.value = false;
      }
    }

    function openEdit(q) {
      draft.value = q;
      editVisible.value = true;
    }

    function applyEdit(payload) {
      for (const c of cards.value) {
        const idx = c.questions.findIndex((x) => x.id === payload.id);
        if (idx >= 0) {
          const flags = { _checked: c.questions[idx]._checked, source: c.questions[idx].source };
          c.questions[idx] = Object.assign({}, payload, flags);
          break;
        }
      }
      const ri = results.value.findIndex((x) => x.id === payload.id);
      if (ri >= 0) {
        const flags = { _checked: results.value[ri]._checked, source: results.value[ri].source };
        results.value[ri] = Object.assign({}, payload, flags);
      }
      editVisible.value = false;
      editSaving.value = false;
      ElMessage.success('已更新');
    }

    function onTabChange(name) {
      if (name === 'pdf' && pdfDoc.value) nextTick(() => renderMain(pageNo.value));
    }

    /* ---------- 题卡 JSON ---------- */
    const jsonText = ref('');
    const jsonFileName = ref('');
    const jsonPreview = ref([]);
    const jsonInput = ref(null);

    const SKILL_PROMPT = [
      '请使用 tiku-json 这个 skill，把下面的材料整理成题卡 JSON。',
      '要求：题目按原文顺序逐题拆开，不改写题干；题型只能用 单选题/多选题/填空题/判断题/解答题/计算题/应用题/实验探究题/简答题/阅读理解题/图表分析题/作文题/完形填空题/其他，',
      '难度只能用 简单/中等/较难；公式用 x²、√3、a/b 这类纯文本，不要 LaTeX；',
      '填空横线一律写成 ____（4 个下划线），不要写成 …… 或空格；',
      'knowledge 给 1-10 个，考查多个知识点时全部打上；答案和题目一一对应，顺序一致；',
      '图形用 [图1] 占位，figures 里写 label + desc；拿得到原图就把图切出来内嵌成 ' +
      'data:image/png;base64,.... 写进 url，单张 base64 不超过 1.2MB；',
      '最后只输出一个 {"questions":[...]} 的 JSON，不要解释。'
    ].join('\n');

    function downloadSkill() {
      window.open('/api/skill/tiku-json.zip', '_blank');
    }

    async function copySkillPrompt() {
      try {
        await navigator.clipboard.writeText(SKILL_PROMPT);
        ElMessage.success('已复制，直接粘给智能体即可');
      } catch (e) {
        TK.download('tiku-json-提示词.txt', SKILL_PROMPT, 'text/plain;charset=utf-8');
        ElMessage.warning('浏览器不允许复制，已下载成文本文件');
      }
    }

    function onJsonFile(e) {
      const file = (e.target.files || [])[0];
      e.target.value = '';
      if (!file) return;
      jsonFileName.value = file.name;
      file.text().then((t) => { jsonText.value = t; parseJson(); })
        .catch((err) => ElMessage.error('文件读不出来：' + err.message));
    }

    const jsonStat = ref({ count: 0, inline: 0, answer: 0, blank: 0 });

    /** 这道题的配图里有没有内嵌的 base64 图片 */
    function hasInlineFig(q) {
      return (q && q.figures || []).some(function (f) {
        return String((f && f.url) || '').indexOf('data:') === 0;
      });
    }

    function parseJson() {
      const t = jsonText.value.trim();
      if (!t) { jsonPreview.value = []; jsonStat.value = { count: 0, inline: 0, answer: 0, blank: 0 }; return; }
      try {
        const raw = JSON.parse(t);
        const list = TK.normalizeImported(raw, { subject: hintSubject.value, grade: hintGrade.value });

        // 顶层 answers 数组：按顺序回填到每道题（老师习惯把答案单独列一份）
        if (raw && !Array.isArray(raw) && Array.isArray(raw.answers) && raw.answers.length === list.length) {
          list.forEach(function (q, i) {
            const a = raw.answers[i];
            const text = a == null ? '' : (typeof a === 'object' ? (a.answer || '') : a);
            if (!q.answer && String(text).trim()) q.answer = String(text).trim();
          });
        }

        jsonPreview.value = list;
        jsonStat.value = {
          count: list.length,
          inline: list.filter(function (q) {
            return (q.figures || []).some(function (f) { return String(f.url || '').indexOf('data:') === 0; });
          }).length,
          answer: list.filter(function (q) { return String(q.answer || '').trim(); }).length,
          blank: list.filter(function (q) { return String(q.stem || '').indexOf('____') >= 0; }).length
        };
      } catch (e) {
        jsonPreview.value = [];
        jsonStat.value = { count: 0, inline: 0, answer: 0, blank: 0 };
        ElMessage.error('JSON 解析失败：' + e.message);
      }
    }

    async function importJson() {
      if (!jsonPreview.value.length) { ElMessage.warning('先粘贴或选择一个题卡 JSON'); return; }
      const list = jsonPreview.value.map((q) => Object.assign({}, q));

      // 题卡里的图常常是 base64：先落盘换成本机地址，
      // 再把题干里的 [图1] 占位换成真正的内嵌图，
      // 否则图形只挂在图形列表里，题干位置上是一片空白。
      let failed = 0;
      for (const q of list) {
        const figs = Array.isArray(q.figures) ? q.figures : [];
        for (const f of figs) {
          if (String(f.url || '').indexOf('data:') === 0) {
            try {
              f.url = await TK.uploadImage(f.url);
              f.src = '';
            } catch (e) {
              failed++;
              ElMessage.error('有一张图没能存下来：' + (e && e.message ? e.message : '未知原因'));
            }
          }
        }
        const map = {};
        figs.forEach((f, i) => {
          const url = TK.figSrc(f);
          if (url) map[f.label || ('图' + (i + 1))] = url;
        });
        if (!Object.keys(map).length) continue;
        let html = TK.rich(String(q.stem || ''));
        html = html.replace(/\[(图\d+)\]/g, (m, name) => {
          const url = map[name];
          return url ? '<img src="' + url + '" data-fig="1" data-w="260">' : m;
        });
        q.stemHtml = html;
      }

      pushResults(list, jsonFileName.value || '题卡导入');
      tab.value = 'images';
      ElMessage.success('已导入 ' + list.length + ' 道' + (failed ? '（' + failed + ' 张图没存上）' : '') + '，核对后保存');
    }

    /* ---------- PDF / MD / Word 文档识题 ---------- */
    const hintSubject = ref(store.settings.lastSubject || '');
    const hintGrade = ref(store.settings.lastGrade || '');
    const docInput = ref(null);
    const docName = ref('');
    const docText = ref('');
    const docBusy = ref(false);
    const docTruncated = ref(false);
    const SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理', '科学', '其他'];
    const GRADES = ['七年级', '八年级', '九年级', '高一', '高二', '高三', '小学三年级', '小学四年级', '小学五年级', '小学六年级', '通用'];

    async function extractPdfText(file) {
      if (!window.pdfjsLib) throw new Error('PDF 组件没有加载，请重新启动程序');
      const buf = await file.arrayBuffer();
      const doc = await window.pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
      const parts = [];
      // 只取前 30 页，避免整本书一次送进模型
      for (let i = 1; i <= Math.min(doc.numPages, 30); i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        let last = null;
        let line = '';
        const lines = [];
        for (const it of content.items) {
          if (!it.str) continue;
          if (last && Math.abs(it.transform[5] - last) > 2) {
            if (line.trim()) lines.push(line.trim());
            line = '';
          }
          line += it.str;
          last = it.transform[5];
        }
        if (line.trim()) lines.push(line.trim());
        if (lines.length) parts.push(lines.join('\n'));
      }
      return parts.join('\n\n');
    }

    async function onDocFile(e) {
      const file = (e.target.files || [])[0];
      e.target.value = '';
      if (!file) return;
      docName.value = file.name;
      docBusy.value = true;
      try {
        if (/\.pdf$/i.test(file.name)) {
          docText.value = await extractPdfText(file);
        } else if (/\.docx$/i.test(file.name)) {
          const b64 = await new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(String(r.result).replace(/^data:[^,]+,/, ''));
            r.onerror = rej;
            r.readAsDataURL(file);
          });
          const r = await TK.api('/api/import/docx', { method: 'POST', body: { base64: b64 } });
          docText.value = r.text;
        } else {
          docText.value = await file.text();
        }
        if (!String(docText.value || '').trim()) {
          ElMessage.warning(/\.pdf$/i.test(file.name)
            ? '这份 PDF 没有文字层（扫描件），改到「整卷照片 / 图片」里识别'
            : '这个文件里没有读到文字');
        }
      } catch (err) {
        ElMessage.error('文件读不出来：' + err.message);
      } finally {
        docBusy.value = false;
      }
    }

    async function parseDoc() {
      const text = String(docText.value || '').trim();
      if (!text) { ElMessage.warning('还没有内容'); return; }
      if (!store.settings.hasKey) { ElMessage.warning('请先在「设置」里填写 API Key'); store.view = 'settings'; return; }
      docBusy.value = true;
      try {
        const r = await TK.api('/api/questions/parse-text', {
          method: 'POST',
          body: { text, subject: hintSubject.value, grade: hintGrade.value }
        });
        docTruncated.value = !!r.truncated;
        if (!r.questions.length) {
          ElMessage.warning('这段材料里没看出来题目，可以只保留题目部分再试');
          return;
        }
        pushResults(r.questions, docName.value || '文档导入');
        tab.value = 'images';
        ElMessage.success('拆出 ' + r.questions.length + ' 道题' + (r.truncated ? '（材料较长，只处理了前面部分）' : ''));
      } catch (e) {
        ElMessage.error(e.message);
      } finally {
        docBusy.value = false;
      }
    }

    onMounted(() => {
      if (!folderId.value && store.folders.length) folderId.value = store.folders[0].id;
    });
    // bootstrap 是异步的，设置页保存的默认学段学科到位后自动补上
    Vue.watch(
      () => [store.settings.lastSubject, store.settings.lastGrade],
      ([s, g]) => {
        if (!hintSubject.value && s) hintSubject.value = s;
        if (!hintGrade.value && g) hintGrade.value = g;
      },
      { immediate: true }
    );

    return {
      store, tab, fileInput, pages, dragging, busy, doneCount, elapsed, results, folderId, saving,
      cards, activeCardId, activeCard, totalQuestions, previewVisible, addCard, selectCard, removeCard,
      clearActiveCard, moveQuestion, saveAll,
      selected, allSelected, editVisible, editSaving, draft, knowledgeOptions, tagOptions,
      typeTag, figSrc, figureSrcs, pick, onFiles, onDrop, recognizePages, toggleAll, save,
      openEdit, applyEdit,
      pdfInput, pdfDoc, pdfName, pdfLoading, pageCount, pageNo, thumbs, mainCanvas, selLayer, sel,
      wrapRef, zoom, setZoom, zoomBy, fitZoom,
      onPdf, gotoPage, resetPdf, startSel, moveSel, endSel, clearSel, recognizePage, onTabChange,
      cropVisible, cropKind, cropText, cropImage, cropHasText, cropBusy, cropOcrBusy, cropOcrFail, ocrHint, retryOcr, openCrop, closeCrop, confirmCrop,
      docProc: makeProc(docText), jsonProc: makeProc(jsonText),
      textProcs: TK.TEXTPROC,
      folderOptions,
      jsonText, jsonFileName, jsonPreview, jsonInput, onJsonFile, parseJson, importJson, jsonStat, hasInlineFig,
      downloadSkill, copySkillPrompt,
      hintSubject, hintGrade, SUBJECTS, GRADES, docInput, docName, docText, docBusy, docTruncated, onDocFile, parseDoc,
      rich: TK.rich, brief: TK.brief, stemText: TK.stemText, renderStem: TK.renderStem, renderAnswer: TK.renderAnswer,
      pendingFigures: (q) => TK.pendingFigures(q)
    };
  }
};
