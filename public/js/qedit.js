/**
 * 题目编辑抽屉：属性全字段 + 图形（从原图框选 / 上传）+ 实时预览。
 * 复用方只需要监听 submit，自己决定是存库（PUT）还是留在结果列表里。
 */
window.QEditDrawer = {
  props: {
    visible: { type: Boolean, default: false },
    question: { type: Object, default: null },
    folders: { type: Array, default: () => [] },
    knowledgeOptions: { type: Array, default: () => [] },
    tagOptions: { type: Array, default: () => [] },
    title: { type: String, default: '编辑题目' },
    gallery: { type: Array, default: () => [] },
    saving: { type: Boolean, default: false }
  },
  emits: ['update:visible', 'submit'],
  setup(props, { emit }) {
    const { ref, reactive, computed, watch, nextTick } = Vue;
    const { ElMessage } = ElementPlus;

    /* ---------- 答案：一空一个框 + 共用格式工具栏 ----------
       以前答案是一个纯文本 textarea：多个空挤在一个框里，也没法加上下标 / 字号。
       现在按空拆成多行输入框，格式沿用选项那套 _{} / ^{} 标记存进 answer，
       渲染时由 rich() 转成 <sub>/<sup>，与题干、选项保持一致。 */
    const answerBlanks = ref([{ text: '' }]);
    const ansCursor = {};            // 每个空输入框最后的光标位置
    let ansActive = 0;               // 工具栏作用于第几个空

    /** 老数据的 answer 是一整段：按换行拆成一空一个框，去掉已有的（1）前缀避免重复 */
    function blanksFromAnswer(q) {
      const plain = String((q && q.answer) || '');
      const lines = plain.split('\n').map((t) => t.replace(/^\s*（\d+）\s*/, '').trim());
      while (lines.length > 1 && !lines[lines.length - 1]) lines.pop();
      return (lines.length ? lines : ['']).map((t) => ({ text: t }));
    }

    function syncAnswerBlanks() {
      draft.value.answer = answerBlanks.value.map((b) => String(b.text || '').trim()).join('\n');
    }

    /** 多空时预览带（1）（2）编号，和最终试卷显示一致 */
    const answerPreview = computed(() => {
      const list = answerBlanks.value.map((b) => String(b.text || '').trim());
      if (!list.some(Boolean)) return '';
      if (list.length <= 1) return TK.rich(list.join(''));
      return list.map((t, i) => (t ? '（' + (i + 1) + '）' + TK.rich(t) : '')).filter(Boolean).join('<br>');
    });

    function onAnswerInput() { syncAnswerBlanks(); dirty.value = true; }

    function addAnswerBlank() {
      answerBlanks.value.push({ text: '' });
      nextTick(() => {
        const rows = document.querySelectorAll('.qe-ans-row input');
        const last = rows[rows.length - 1];
        if (last) last.focus();
      });
    }

    function removeAnswerBlank(i) {
      if (answerBlanks.value.length <= 1) return;
      answerBlanks.value.splice(i, 1);
      syncAnswerBlanks();
    }

    function ansFocus(b) {
      const idx = answerBlanks.value.indexOf(b);
      if (idx >= 0) ansActive = idx;
      const el = document.activeElement;
      if (el && el.tagName === 'INPUT') {
        ansCursor[idx] = { start: el.selectionStart, end: el.selectionEnd, el };
      }
    }

    /** 当前工具栏要作用的输入框与选区 */
    function ansTarget() {
      const cur = ansCursor[ansActive] || {};
      const input = (cur.el && document.contains(cur.el)) ? cur.el : null;
      const text = String((answerBlanks.value[ansActive] || {}).text || '');
      const start = input ? input.selectionStart : (cur.start === undefined ? text.length : cur.start);
      const end = input ? input.selectionEnd : (cur.end === undefined ? start : cur.end);
      return { input, text, start, end };
    }

    /** 用标记包住选区；没有选区就插入占位并把光标放进去，和选项的下标按钮一致 */
    function ansWrap(open, close) {
      const { input, text, start, end } = ansTarget();
      const selected = text.slice(start, end);
      const wrapped = open + selected + close;
      answerBlanks.value[ansActive].text = text.slice(0, start) + wrapped + text.slice(end);
      const caret = selected ? start + wrapped.length : start + open.length;
      if (input) {
        nextTick(() => {
          input.focus();
          try { input.setSelectionRange(caret, caret); } catch (e) {}
        });
      }
      syncAnswerBlanks();
      dirty.value = true;
    }

    function ansScript(kind) { ansWrap(kind === 'sub' ? '_{' : '^{', '}'); }

    /** 字号：用标记包住选区，渲染时 rich() 不会吃掉未知标签，这里用私有标记交给预览处理 */
    function ansSize(delta) {
      const { text, start, end } = ansTarget();
      if (start === end) { ElMessage.info('先选中要放大/缩小的答案文字'); return; }
      const open = delta > 0 ? '\\big{' : '\\small{';
      ansWrap(open, '}');
      ElMessage.success(delta > 0 ? '已放大' : '已缩小');
    }

    const types = ['单选题', '多选题', '填空题', '判断题', '解答题', '计算题', '应用题', '实验探究题', '简答题', '阅读理解题', '图表分析题', '作文题', '完形填空题', '其他'];
    const DIFFS = TK.DIFFICULTIES;
    const MASTERY = TK.MASTERY_LEVELS;
    const draft = ref(null);
    const dirty = ref(false);
    const solving = ref(false);
    const uploading = ref(false);
    const figInput = ref(null);
    const preview = ref('');

    const editor = ref(null);
    const editorFocused = ref(false);
    const insertFigurePicker = ref(false);
    const stemLength = ref(0);

    const cropVisible = ref(false);
    const cropSource = ref('');
    const cropWrap = ref(null);
    const cropCanvas = ref(null);
    const cropSel = ref(null);
    const cropping = ref(false);
    const cropTarget = ref(null);
    const cropInsertInline = ref(false);
    let dragging = false;

    const figures = computed(() => (draft.value && Array.isArray(draft.value.figures)) ? draft.value.figures : []);
    const needOptions = computed(() => {
      const t = draft.value && draft.value.type;
      return t === '单选题' || t === '多选题';
    });

    function typeTag(t) { return TK.TYPE_TAG[t] || 'info'; }
    function figSrc(f) { return TK.figSrc(f); }

    /** 难度 5 档对应的标签颜色 */
    function diffTag(d) {
      const i = DIFFS.indexOf(TK.normDifficulty(d));
      if (i <= 1) return 'success';
      if (i === 2) return 'warning';
      return 'danger';
    }

    /* 难度滑块：1~5 对应 5 档标签 */
    const diffLevel = computed({
      get() {
        return Math.max(1, DIFFS.indexOf(TK.normDifficulty(draft.value && draft.value.difficulty)) + 1);
      },
      set(v) {
        if (!draft.value) return;
        draft.value.difficulty = DIFFS[Math.min(4, Math.max(0, Number(v) - 1))];
      }
    });
    const diffLabel = computed(() => (draft.value ? TK.normDifficulty(draft.value.difficulty) : '中等'));

    function reset() {
      const q = props.question || {};
      const copy = JSON.parse(JSON.stringify(q));
      copy.type = copy.type || '其他';
      copy.difficulty = copy.difficulty || '中等';
      copy.options = Array.isArray(copy.options) ? copy.options : [];
      copy.knowledge = Array.isArray(copy.knowledge) ? copy.knowledge : [];
      copy.tags = Array.isArray(copy.tags) ? copy.tags : [];
      copy.figures = Array.isArray(copy.figures) ? copy.figures : [];
      copy.folderId = copy.folderId || (props.folders[0] && props.folders[0].id) || '';
      copy.no = copy.no || '';
      copy.subject = copy.subject || '';
      copy.grade = copy.grade || '';
      copy.year = copy.year || '';
      copy.region = copy.region || '';
      copy.source = copy.source || '';
      copy.chapter = copy.chapter || '';
      copy.stem = copy.stem || '';
      copy.stemHtml = copy.stemHtml || '';
      copy.answer = copy.answer || '';
      copy.analysis = copy.analysis || '';
      copy.difficulty = TK.normDifficulty(copy.difficulty);
      copy.mastery = copy.mastery || '';
      copy.favorite = copy.favorite ? 1 : 0;
      // 赋值 draft 会触发 deep watcher（pre-flush 是异步的），
      // 这里先关掉"标脏"，等 watcher 跑完再打开
      suppressDirty = true;
      draft.value = copy;
      answerBlanks.value = blanksFromAnswer(copy);
      ansActive = 0;
      Object.keys(ansCursor).forEach((k) => delete ansCursor[k]);
      dirty.value = false;
      cropSource.value = copy.sourceImage || copy.image || '';
      nextTick(() => {
        if (editor.value) {
          editor.value.innerHTML = copy.stemHtml || (copy.stem ? TK.escapeHtml(copy.stem).replace(/\n/g, '<br>') : '');
          stemLength.value = (editor.value.innerText || '').trim().length;
          // 老数据可能只有 data-w 没有 style：补上实际宽度，否则拖动前看到的仍是原图尺寸
          editor.value.querySelectorAll('img').forEach((img) => {
            const w = parseInt(img.getAttribute('data-w'), 10);
            if (w > 0 && !img.style.width) {
              img.style.width = Math.min(1200, w) + 'px';
              img.style.maxWidth = '100%';
            }
          });
          noNativeDrag(editor.value);
          clearImgSel();
        }
        suppressDirty = false;
      });
    }

    watch(() => props.visible, (v) => { if (v) reset(); });
    // reset() 里赋值 draft 会触发这个 watcher（pre-flush 是异步的），
    // 于是刚打开抽屉就被标成"有未保存的修改"。用一个开关把这次赋值排除掉。
    let suppressDirty = false;
    watch(draft, () => { if (!suppressDirty && draft.value) dirty.value = true; }, { deep: true });

    /* ---------- 富文本题干 ---------- */
    function syncStem() {
      if (!draft.value || !editor.value) return '';
      const html = editor.value.innerHTML || '';
      draft.value.stemHtml = html;
      draft.value.stem = (editor.value.innerText || '').trim();
      stemLength.value = draft.value.stem.length;
      dirty.value = true;
      return html;
    }

    function onEditorInput() { syncStem(); saveSelection(); }

    /**
     * 题图默认是浏览器可拖的（draggable=true），按下去会触发原生「拖图片」，
     * 我们自己的 mousemove 就收不到，表现就是图形拖不动。统一关掉。
     */
    function noNativeDrag(scope) {
      if (!scope) return;
      scope.querySelectorAll('img').forEach((img) => {
        img.draggable = false;
        img.setAttribute('draggable', 'false');
      });
    }

    function onEditorDragStart(e) {
      if (e.target && e.target.tagName === 'IMG') e.preventDefault();
    }

    /** 压到图上就选中并进入调宽；拖哪里都行，不必非得对准右边缘 */
    function onEditorMouseDown(e) {
      if (pickImgAt(e) && imgSel.value) { startImgDrag(e); return; }
      saveSelection();
    }

    let savedRange = null;
    function saveSelection() {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || !editor.value) return;
      if (!editor.value.contains(sel.anchorNode)) return;
      savedRange = sel.getRangeAt(0).cloneRange();
    }

    function restoreSelection() {
      if (!editor.value) return;
      editor.value.focus();
      if (!savedRange) return;
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }

    function fmt(cmd) {
      // 不能先 focus()：会把已选中的选区收拢到起点，导致对选中文字加粗失效
      restoreSelection();
      document.execCommand(cmd, false, null);
      syncStem();
      saveSelection();
    }

    function bumpFont(delta) {
      if (!editor.value) return;
      restoreSelection();
      const sel = window.getSelection();
      if (sel && sel.rangeCount && !sel.isCollapsed) {
        document.execCommand('fontSize', false, delta > 0 ? '5' : '2');
        const spans = editor.value.querySelectorAll('font[size]');
        spans.forEach((f) => {
          const el = document.createElement('span');
          el.style.fontSize = delta > 0 ? '1.25em' : '0.85em';
          el.innerHTML = f.innerHTML;
          f.replaceWith(el);
        });
      }
      syncStem();
      saveSelection();
    }

    async function onEditorPaste(e) {
      const cd = e.clipboardData;
      if (!cd) return;
      const imgs = [];
      for (const item of Array.from(cd.items || [])) {
        if (item.type && item.type.indexOf('image') === 0) {
          const f = item.getAsFile();
          if (f) imgs.push(f);
        }
      }
      if (imgs.length) {
        e.preventDefault();
        for (const f of imgs) {
          try {
            const dataUrl = await TK.downscaleImage(f, 1400);
            const url = await TK.uploadImage(dataUrl);
            insertHtml('<img src="' + url + '" data-fig="1" data-w="480">');
            draft.value.figures.push({
              id: 'fig_' + Date.now().toString(36),
              label: '图' + (draft.value.figures.length + 1),
              desc: '粘贴图片',
              url: url
            });
          } catch (err) {
            ElMessage.error(err.message);
          }
        }
        syncStem();
        return;
      }
      // 纯文本粘贴：去掉外部样式，只留换行
      const text = cd.getData('text/plain');
      if (text) {
        e.preventDefault();
        insertHtml(TK.escapeHtml(text).replace(/\r?\n/g, '<br>'));
        syncStem();
      }
    }

    function insertHtml(html) {
      if (!editor.value) return;
      restoreSelection();
      const sel = window.getSelection();
      // 没有有效光标时（刚打开抽屉、或点工具栏丢了选区）先放到末尾，避免插入被丢弃
      if (!sel || !sel.rangeCount || !editor.value.contains(sel.anchorNode)) {
        const range = document.createRange();
        range.selectNodeContents(editor.value);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      document.execCommand('insertHTML', false, html);
      noNativeDrag(editor.value);
      syncStem();
      saveSelection();
    }

    /* ---------- 文本处理器：选中就用选区，没选就整段 ---------- */
    const procMenu = ref(false);

    function currentSelection() {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || !editor.value) return null;
      if (!editor.value.contains(sel.anchorNode) || !editor.value.contains(sel.focusNode)) return null;
      return sel;
    }

    function runProc(key) {
      if (!editor.value) return;
      let sel = currentSelection();
      // 点工具栏时浏览器可能把选区收拢：先用记住的 range 恢复
      if ((!sel || sel.isCollapsed) && savedRange) {
        restoreSelection();
        sel = currentSelection();
      }
      const scope = sel && !sel.isCollapsed ? '选区' : '整段';
      if (sel && !sel.isCollapsed) {
        const text = sel.toString();
        const next = TK.applyTextProc(key, text);
        if (next !== text) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const node = document.createTextNode(next);
          range.insertNode(node);
          range.setStartAfter(node);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      } else {
        // 整段处理：先把图片换成占位标记，处理完再放回去
        const imgs = extractImages();
        const text = editor.value.innerText || '';
        const next = TK.applyTextProc(key, text);
        replaceEditorText(next, imgs);
      }
      procMenu.value = false;
      syncStem();
      saveSelection();
      ElMessage.success(scope + '已处理');
    }

    function runProcAll(key) {
      if (!editor.value) return;
      const imgs = extractImages();
      const next = TK.applyTextProc(key, editor.value.innerText || '');
      replaceEditorText(next, imgs);
      procMenu.value = false;
      syncStem();
      saveSelection();
      ElMessage.success('整段已处理');
    }

    function insertFigureAt(f) {
      const src = TK.figSrc(f);
      if (!src) { ElMessage.warning('这个图形还没有图片，先框选或上传'); return; }
      const w = f.width && f.width > 900 ? 480 : 360;
      insertHtml('<img src="' + src + '" data-fig="1" data-w="' + w + '">');
      insertFigurePicker.value = false;
      ElMessage.success('图形已插入题干');
    }

    /** 从图库选一张：插进题干，同时挂到这道题的图形库里 */
    function pickFromGallery(g) {
      if (!g || !g.url) return;
      const exists = draft.value.figures.find((f) => TK.figSrc(f) === g.url);
      if (!exists) {
        draft.value.figures.push({
          id: 'fig_' + Date.now().toString(36),
          label: '图' + (draft.value.figures.length + 1),
          desc: g.label || '来自图库',
          url: g.url
        });
      }
      insertHtml('<img src="' + g.url + '" data-fig="1" data-w="480">');
      insertFigurePicker.value = false;
      ElMessage.success('已从图库插入');
    }

    /** 把题干里已有的图片收进图库，方便别的题复用 */
    async function saveToGallery(f) {
      const url = TK.figSrc(f);
      if (!url) return;
      try {
        await TK.api('/api/gallery', { method: 'POST', body: { url, label: f.label || '图形', tags: draft.value.knowledge || [] } });
        ElMessage.success('已收进图库');
      } catch (e) {
        ElMessage.error(e.message);
      }
    }

    function addOption() {
      const next = String.fromCharCode(65 + draft.value.options.length);
      draft.value.options.push({ key: next, text: '' });
    }

    // 记住每个选项输入框最后的光标位置，点下标按钮时才知道要包住哪几个字
    const optCursor = {};
    function optFocus(o) {
      const el = document.activeElement;
      const idx = draft.value.options.indexOf(o);
      if (el && el.tagName === 'INPUT' && idx >= 0) {
        optCursor[idx] = { start: el.selectionStart, end: el.selectionEnd, el };
      }
    }

    /** 给选项文字加下标/上标：有选中就包住选中部分，没选就插入占位符并把光标放到括号中间 */
    function optScript(o, kind) {
      const idx = draft.value.options.indexOf(o);
      const cur = optCursor[idx] || {};
      const input = (cur.el && document.contains(cur.el)) ? cur.el : null;
      const text = String(o.text || '');
      const start = input ? input.selectionStart : (cur.start === undefined ? text.length : cur.start);
      const end = input ? input.selectionEnd : (cur.end === undefined ? start : cur.end);
      const selected = text.slice(start, end);
      const open = kind === 'sub' ? '_{' : '^{';
      const wrapped = open + selected + '}';
      o.text = text.slice(0, start) + wrapped + text.slice(end);
      const caret = selected ? start + wrapped.length : start + open.length;
      if (input) {
        nextTick(() => {
          input.focus();
          try { input.setSelectionRange(caret, caret); } catch (e) {}
        });
      }
    }

    async function aiSolve() {
      if (!draft.value) return;
      syncStem();
      if (!String(draft.value.stem || '').trim()) {
        ElMessage.warning('题干为空，先补题干');
        return;
      }
      solving.value = true;
      try {
        const r = await TK.api('/api/solve', {
          method: 'POST',
          body: { stem: draft.value.stem, options: draft.value.options || [] }
        });
        if (r.answer) draft.value.answer = r.answer;
        if (r.analysis) draft.value.analysis = r.analysis;
        if (r.knowledge && r.knowledge.length) draft.value.knowledge = r.knowledge;
        if (r.difficulty) draft.value.difficulty = r.difficulty;
        ElMessage.success('已补全答案与解析');
      } catch (e) {
        ElMessage.error(e.message);
      } finally {
        solving.value = false;
      }
    }

    /* ---------- 图形：直接上传 ---------- */
    function pickFigure() { figInput.value && figInput.value.click(); }

    async function onFigureFile(e) {
      const file = (e.target.files || [])[0];
      e.target.value = '';
      if (!file || !/^image\//.test(file.type)) return;
      uploading.value = true;
      try {
        const dataUrl = await TK.downscaleImage(file, 1400);
        const url = await TK.uploadImage(dataUrl);
        const fig = {
          id: 'fig_' + Date.now().toString(36),
          label: '图' + (draft.value.figures.length + 1),
          desc: file.name || '',
          url: url,
          bbox: null
        };
        draft.value.figures.push(fig);
        insertHtml('<img src="' + url + '" data-fig="1" data-w="480">');
        insertFigurePicker.value = false;
        ElMessage.success('已上传并插入题干');
      } catch (err) {
        ElMessage.error(err.message);
      } finally {
        uploading.value = false;
      }
    }

    function removeFigure(i) {
      const f = draft.value.figures[i];
      // 图形库里的这条记录删掉了，题干里插着的那张图也要一起删，
      // 否则保存后图还在题干里，界面上却已经"删干净"了。
      if (f) {
        const url = TK.figSrc(f);
        if (url) removeInlineFigure(url);
      }
      draft.value.figures.splice(i, 1);
      draft.value.figures.forEach((f2, idx) => { if (!f2.desc) f2.label = f2.label || ('图' + (idx + 1)); });
    }

    /* ---------- 图形：从原图框选 ---------- */
    function startCrop(f) {
      if (!cropSource.value) { ElMessage.warning('这道题没有原图，直接上传一张图片即可'); return; }
      cropTarget.value = f || null;
      cropSel.value = null;
      cropVisible.value = true;
      nextTick(updateCropHint);
    }

    function updateCropHint() { /* 预留：尺寸提示由模板根据 cropSel 计算 */ }

    function pointInImage(e) {
      const box = cropCanvas.value;
      if (!box) return null;
      const img = box.querySelector('img');
      if (!img) return null;
      const rect = img.getBoundingClientRect();
      return {
        x: Math.min(Math.max(0, e.clientX - rect.left), rect.width),
        y: Math.min(Math.max(0, e.clientY - rect.top), rect.height),
        w: rect.width,
        h: rect.height
      };
    }

    function cropStart(e) {
      const p = pointInImage(e);
      if (!p) return;
      dragging = true;
      cropSel.value = { x: p.x, y: p.y, w: 0, h: 0, natW: p.w, natH: p.h };
      e.preventDefault();
    }

    function cropMove(e) {
      if (!dragging || !cropSel.value) return;
      const p = pointInImage(e);
      if (!p) return;
      const s = cropSel.value;
      const x2 = p.x, y2 = p.y;
      const startX = s.x, startY = s.y;
      cropSel.value = {
        x: Math.min(startX, x2),
        y: Math.min(startY, y2),
        w: Math.abs(x2 - startX),
        h: Math.abs(y2 - startY),
        natW: p.w,
        natH: p.h
      };
    }

    function cropEnd() {
      dragging = false;
      const s = cropSel.value;
      if (s && (s.w < 8 || s.h < 8)) cropSel.value = null;
    }

    async function applyCrop() {
      const s = cropSel.value;
      if (!s || !cropSource.value) return;
      const bbox = [s.x / s.natW, s.y / s.natH, s.w / s.natW, s.h / s.natH];
      cropping.value = true;
      try {
        // 手动框选的不做自动裁字，尊重用户框的范围
        const r = await TK.cropRegion(cropSource.value, bbox, { pad: 0.008, trim: false });
        const url = await TK.uploadImage(r.dataUrl);
        if (cropTarget.value) {
          cropTarget.value.url = url;
          cropTarget.value.src = '';
          cropTarget.value.bbox = bbox;
          cropTarget.value.width = r.width;
          cropTarget.value.height = r.height;
          insertHtml('<img src="' + url + '" data-fig="1" data-w="480">');
        } else {
          draft.value.figures.push({
            id: 'fig_' + Date.now().toString(36),
            label: '图' + (draft.value.figures.length + 1),
            desc: '',
            url: url,
            bbox: bbox,
            width: r.width,
            height: r.height
          });
          if (cropInsertInline.value) insertHtml('<img src="' + url + '" data-fig="1" data-w="480">');
        }
        cropInsertInline.value = false;
        cropTarget.value = null;
        insertFigurePicker.value = false;
        cropVisible.value = false;
        ElMessage.success('图形已保存并插入题干');
      } catch (e) {
        ElMessage.error(e.message);
      } finally {
        cropping.value = false;
      }
    }

    function removeInlineFigure(url) {
      if (!editor.value) return;
      editor.value.querySelectorAll('img').forEach((img) => {
        if (img.getAttribute('src') === url) img.remove();
      });
      clearImgSel();
      syncStem();
    }

    /* ---------- 题图调宽：点选一张图，出现百分比/拖拽，宽度写回 data-w ----------
       原来插入图片时把 data-w 写死 480px，图比版心窄就再也拉不宽，
       而 data-w 是保存后会保留的唯一宽度来源（服务端只放行像素值），
       所以调宽必须落回 data-w，否则刷新后又弹回 480。 */
    const imgSel = ref(null);        // 当前选中的 <img> DOM 节点
    const imgSelW = ref(0);          // 当前显示宽度（px）
    let imgDrag = null;

    function editorImages() {
      if (!editor.value) return [];
      return Array.from(editor.value.querySelectorAll('img'));
    }

    /** 同步当前图的显示宽度到 imgSelW，供工具栏显示 */
    function syncImgSelWidth() {
      if (!imgSel || !imgSel.value) return;
      // 优先用 data-w：图还没加载完时 getBoundingClientRect 会给出破图的宽度（十几 px）
      const saved = parseInt(imgSel.value.getAttribute('data-w'), 10);
      imgSelW.value = saved > 0 ? saved : Math.round(imgSel.value.getBoundingClientRect().width);
    }

    function clearImgSel() {
      if (imgSel.value) imgSel.value.classList.remove('qe-img-sel');
      imgSel.value = null;
      imgSelW.value = 0;
    }

    function selectImg(img) {
      if (imgSel.value === img) return;
      clearImgSel();
      imgSel.value = img;
      img.classList.add('qe-img-sel');
      syncImgSelWidth();
    }

    /** 由点击位置找出落在哪张图上：点在图上就选中，否则取消选中 */
    function pickImgAt(e) {
      const img = e.target && e.target.closest ? e.target.closest('img') : null;
      if (img && editor.value && editor.value.contains(img)) { selectImg(img); return true; }
      clearImgSel();
      return false;
    }

    /** 设宽：夹到 80~1200px，同时写 style 与 data-w，保证编辑器里立刻生效、保存后不丢 */
    function setImgWidth(img, w) {
      if (!img) return;
      const maxW = 1200;
      const px = Math.round(Math.min(maxW, Math.max(80, w)));
      img.setAttribute('data-w', String(px));
      img.removeAttribute('height');
      // 宽度定了就按原图比例算高度，避免只写 width 时高度先按旧比例撑开再回弹
      if (img.naturalWidth && img.naturalHeight) {
        img.style.height = 'auto';
      }
      img.style.width = px + 'px';
      img.style.maxWidth = '100%';
      imgSelW.value = px;
    }

    function imgWidthBy(delta) {
      if (!imgSel.value) return;
      const cur = parseInt(imgSel.value.getAttribute('data-w'), 10) || Math.round(imgSel.value.getBoundingClientRect().width) || 480;
      setImgWidth(imgSel.value, cur + delta);
      syncStem();
    }

    function imgWidthFit() {
      if (!imgSel.value) return;
      setImgWidth(imgSel.value, 1200);
      syncStem();
      ElMessage.success('已按最大宽度显示');
    }

    function startImgDrag(e) {
      const img = imgSel.value;
      if (!img) return;
      e.preventDefault();
      // 起点用 data-w（用户设定的宽度）；没有才退回渲染宽度
      const saved = parseInt(img.getAttribute('data-w'), 10);
      const startW = saved > 0 ? saved : Math.round(img.getBoundingClientRect().width) || 480;
      imgDrag = { img, startX: e.clientX, startW };
      window.addEventListener('mousemove', moveImgDrag);
      window.addEventListener('mouseup', endImgDrag);
    }

    function moveImgDrag(e) {
      if (!imgDrag) return;
      setImgWidth(imgDrag.img, imgDrag.startW + (e.clientX - imgDrag.startX));
    }

    function endImgDrag() {
      window.removeEventListener('mousemove', moveImgDrag);
      window.removeEventListener('mouseup', endImgDrag);
      if (imgDrag) { imgDrag = null; syncStem(); }
    }

    /* ---------- 整段文本处理：不能把题干里的图抹掉 ----------
       innerText 不包含 <img>，以前直接 editor.innerText = 处理结果，
       题干里的图会被整体覆盖掉、保存后只剩文字。
       做法：处理前把每张图换成占位标记，处理完再按标记放回原来的位置。 */

    const IMG_TOKEN = '';   // 私用区字符，正文里不会出现

    /** 把编辑器里的 img 换成占位文本，返回原图片节点数组 */
    function extractImages() {
      const imgs = [];
      editor.value.querySelectorAll('img').forEach((img) => {
        const token = document.createTextNode(IMG_TOKEN + imgs.length + IMG_TOKEN);
        img.replaceWith(token);
        imgs.push(img);
      });
      return imgs;
    }

    /** 用处理后的文本覆盖编辑器，并把占位标记换回原来的图片 */
    function replaceEditorText(next, imgs) {
      editor.value.innerText = next;
      if (!imgs.length) return;
      const walker = document.createTreeWalker(editor.value, NodeFilter.SHOW_TEXT, null);
      const nodes = [];
      let n;
      while ((n = walker.nextNode())) nodes.push(n);
      const re = new RegExp(IMG_TOKEN + '(\\d+)' + IMG_TOKEN, 'g');
      for (const node of nodes) {
        const v = node.nodeValue || '';
        if (v.indexOf(IMG_TOKEN) < 0) continue;
        const frag = document.createDocumentFragment();
        let last = 0;
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(v))) {
          if (m.index > last) frag.appendChild(document.createTextNode(v.slice(last, m.index)));
          const img = imgs[Number(m[1])];
          if (img) frag.appendChild(img);
          last = m.index + m[0].length;
        }
        if (last < v.length) frag.appendChild(document.createTextNode(v.slice(last)));
        node.parentNode.replaceChild(frag, node);
      }
    }

    function submit() {
      if (!draft.value) return;
      syncStem();
      syncAnswerBlanks();
      if (!String(draft.value.stem || '').trim() && !draft.value.stemHtml) {
        ElMessage.warning('题干不能为空');
        return;
      }
      emit('submit', JSON.parse(JSON.stringify(draft.value)));
    }

    function openCropForInline() {
      cropInsertInline.value = true;
      startCrop(null);
    }

    return {
      TK, types, DIFFS, MASTERY, draft, dirty, solving, uploading, figInput, preview,
      editor, editorFocused, insertFigurePicker, stemLength,
      cropVisible, cropSource, cropWrap, cropCanvas, cropSel, cropping,
      figures, needOptions, typeTag, diffTag, diffLevel, diffLabel, figSrc, addOption, optFocus, optScript, aiSolve,
      onEditorInput, onEditorPaste, onEditorMouseDown, onEditorDragStart, fmt, bumpFont, insertFigureAt, removeInlineFigure,
      imgSel, imgSelW, imgWidthBy, imgWidthFit, clearImgSel,
      answerBlanks, answerPreview, onAnswerInput, addAnswerBlank, removeAnswerBlank,
      ansFocus, ansScript, ansSize, ansActive,
      openCropForInline, saveSelection, pickFromGallery, saveToGallery,
      procMenu, runProc, runProcAll, textProcs: TK.TEXTPROC,
      pickFigure, onFigureFile, removeFigure, startCrop,
      cropStart, cropMove, cropEnd, applyCrop, submit, reset,
      knowledgeOptions: computed(() => props.knowledgeOptions || []),
      tagOptions: computed(() => props.tagOptions || []),
      folders: computed(() => props.folders || []),
      folderOptions: computed(() => TK.folderOptions(props.folders || [])),
      galleryItems: computed(() => props.gallery || [])
    };
  }
};
