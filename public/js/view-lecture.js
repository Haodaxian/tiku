window.ViewLecture = {
  setup() {
    const { ref, reactive, computed, onActivated, watch, nextTick } = Vue;
    const { ElMessage } = ElementPlus;
    const store = TK.store;

    const subjects = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理', '科学', '其他'];
    const grades = ['七年级', '八年级', '九年级', '高一', '高二', '高三', '小学三年级', '小学四年级', '小学五年级', '小学六年级', '通用'];

    function emptyLecture() {
      return {
        id: null,
        title: '未命名讲义',
        subject: '',
        grade: '',
        savedAt: null,
        sections: [{ id: TK.uid(), heading: '第一部分', blocks: [] }]
      };
    }

    const lecture = reactive(emptyLecture());
    const config = reactive({
      // 新讲义的默认分栏跟「设置」页里选的一致
      columns: store.settings.lectureDensity === 'double' ? 2 : 1,
      fontSize: 14,
      lineHeight: 1.9,
      answerArea: 'line',
      answerLines: 3,
      gridCols: 20,
      showAnswer: false,
      showMeta: true,
      showDate: false,
      showSubtitle: true,
      showFooter: false,
      showStudentInfo: false,
      examInfo: '',
      school: store.settings.school || '',
      teacher: store.settings.teacher || ''
    });

    const activeSection = ref(0);
    const activeBlock = ref('');
    const rightTab = ref('layout');
    const saving = ref(false);

    // A4 预览按可用宽度自动缩放，避免纸张被横向裁掉
    const paperWrap = ref(null);
    const paperZoom = ref(1);
    function fitPaper() {
      const el = paperWrap.value;
      if (!el) return;
      const avail = el.clientWidth - 46;
      paperZoom.value = Math.min(1, Math.max(0.45, Math.round((avail / 794) * 100) / 100));
    }
    Vue.onMounted(() => {
      fitPaper();
      window.addEventListener('resize', fitPaper);

      // 保持打印区跟当前讲义同步：老师在讲义页直接按 Ctrl+P 也能打出干净试卷，
      // 不必先点按钮（print-ready 只在打印样式里生效，屏幕上没有任何影响）
      const applyPrintTarget = () => {
        store.printTarget = {
          lecture: normalize(),
          // 用 printConfig（带年级·学科副标题），不要用裸 config：
          // 裸 config 里没有 subtitle，打印出来就少了「八年级 · 数学」这一行
          config: JSON.parse(JSON.stringify(printConfig()))
        };
      };
      let ptTimer = null;
      const syncPrintTarget = () => {
        clearTimeout(ptTimer);
        ptTimer = setTimeout(applyPrintTarget, 400);
      };
      applyPrintTarget();
      watch([lecture, config], syncPrintTarget, { deep: true });

      window.addEventListener('beforeprint', () => {
        if (store.view !== 'lecture') return;
        if (!lecture.sections.some((s) => s.blocks && s.blocks.length)) return;
        applyPrintTarget();
        document.body.classList.add('print-ready');
      });
    });
    onActivated(() => nextTick(fitPaper));

    // 桌面客户端的「文件 → 打印当前试卷」菜单走这里
    TK.setPrintHandler(function () { print(); });

    const importVisible = ref(false);
    const importTab = ref('paste');
    const importText = ref('');
    const importFileName = ref('');
    const useAI = ref(false);
    const importing = ref(false);
    const fileInput = ref(null);

    const pickerVisible = ref(false);
    const pickKeyword = ref('');
    const pickedIds = ref([]);

    const currentBlock = computed(() => {
      for (const s of lecture.sections) {
        const b = s.blocks.find((x) => x.id === activeBlock.value);
        if (b) return b;
      }
      return null;
    });

    const blockTotal = computed(() =>
      lecture.sections.reduce((n, s) => n + (s.blocks ? s.blocks.length : 0), 0)
    );

    const pickList = computed(() => {
      const kw = pickKeyword.value.trim().toLowerCase();
      return (store.questions || []).filter((q) => {
        if (!kw) return true;
        return (q.stem + ' ' + (q.knowledge || []).join(' ')).toLowerCase().indexOf(kw) >= 0;
      }).slice(0, 200);
    });

    const subtitleText = computed(() => [lecture.grade, lecture.subject].filter(Boolean).join(' · '));

    /** 打印/预览用的配置：副标题带上「年级 · 学科」，屏幕和纸面保持一致 */
    function printConfig() {
      return Object.assign({}, config, { subtitle: subtitleText.value });
    }

    const previewConfig = computed(() => printConfig());

    /* ---------- 结构编辑 ---------- */
    function addSection() {
      lecture.sections.push({ id: TK.uid(), heading: '新章节', blocks: [] });
      activeSection.value = lecture.sections.length - 1;
    }

    function removeSection(i) {
      if (lecture.sections.length <= 1) { ElMessage.warning('至少保留一个章节'); return; }
      lecture.sections.splice(i, 1);
      activeSection.value = Math.min(activeSection.value, lecture.sections.length - 1);
    }

    function moveSection(i, dir) {
      const t = i + dir;
      if (t < 0 || t >= lecture.sections.length) return;
      const arr = lecture.sections;
      [arr[i], arr[t]] = [arr[t], arr[i]];
      activeSection.value = t;
    }

    function selectSection(i) {
      activeSection.value = i;
      rightTab.value = 'layout';
    }

    function selectBlock(si, bi) {
      activeSection.value = si;
      activeBlock.value = lecture.sections[si].blocks[bi].id;
      rightTab.value = 'block';
    }

    function addBlock(type, extra) {
      const sec = lecture.sections[activeSection.value];
      if (!sec) return;
      const b = Object.assign({ id: TK.uid(), type, content: '' }, extra || {});
      sec.blocks.push(b);
      activeBlock.value = b.id;
      rightTab.value = 'block';
      return b;
    }

    function addTextBlock(si) {
      activeSection.value = si;
      addBlock('text', { content: '在这里写讲解内容' });
    }

    function addAnswerBlock(si) {
      activeSection.value = si;
      addBlock('answer', { lines: 3 });
    }

    function addFormulaBlock(si) {
      activeSection.value = si;
      addBlock('formula', { content: '公式：' });
    }

    function addExampleBlock(si) {
      activeSection.value = si;
      addBlock('example', { content: '例题：' });
    }

    function addTianzigeBlock(si) {
      activeSection.value = si;
      addBlock('tianzige', { cell: 26, cols: 12, rows: 3 });
    }

    function addPageBreak(si) {
      activeSection.value = si;
      addBlock('pagebreak');
    }

    function removeBlock(si, bi) {
      lecture.sections[si].blocks.splice(bi, 1);
    }

    function moveBlock(si, bi, dir) {
      const arr = lecture.sections[si].blocks;
      const t = bi + dir;
      if (t < 0 || t >= arr.length) return;
      [arr[bi], arr[t]] = [arr[t], arr[bi]];
    }

    function blockLabel(b) {
      return {
        text: '正文', points: '要点', formula: '公式', example: '例题',
        question: '题目', answer: '作答区', tianzige: '格子', pagebreak: '分页'
      }[b.type] || b.type;
    }

    function blockBrief(b) {
      if (b.type === 'question') return TK.brief(b.stem, 30);
      if (b.type === 'answer') return (b.lines || 3) + ' 行';
      if (b.type === 'pagebreak') return '——';
      if (b.type === 'points') return TK.brief(String(b.content || '').split('\n')[0], 26);
      return TK.brief(b.content, 26);
    }

    /* ---------- 保存 / 打印 ---------- */
    function normalize() {
      // points 块统一用 content 存每行一条
      return {
        id: lecture.id,
        title: lecture.title,
        subject: lecture.subject,
        grade: lecture.grade,
        sections: lecture.sections.map((s) => ({
          id: s.id,
          heading: s.heading,
          // 大题分栏（选择题双栏用），存下来否则保存后就没了
          cols: s.cols === 2 ? 2 : 1,
          blocks: s.blocks.map((b) => {
            const o = { id: b.id, type: b.type };
            if (b.type === 'question') {
              o.stem = b.stem; o.stemHtml = b.stemHtml || ''; o.figures = b.figures || [];
              o.options = b.options || []; o.answer = b.answer || '';
              o.analysis = b.analysis || ''; o.typeLabel = b.typeLabel || '';
              o.lines = b.lines === undefined ? 3 : b.lines; o.questionId = b.questionId || '';
              // 每题分值，试卷版式要用
              o.score = b.score || 0;
              // 作文格作答区的行数也要存下来，否则永远按默认 8 行渲染
              o.gridRows = b.gridRows === undefined ? 8 : b.gridRows;
            } else if (b.type === 'answer') {
              o.lines = b.lines || 3;
            } else if (b.type === 'tianzige') {
              o.cell = b.cell || 26; o.cols = b.cols || 12; o.rows = b.rows || 3;
            } else if (b.type === 'pagebreak') {
              // 无内容
            } else {
              o.content = b.content || '';
            }
            return o;
          })
        })),
        config: JSON.parse(JSON.stringify(config))
      };
    }

    async function save() {
      if (!lecture.sections.some((s) => s.blocks.length)) {
        ElMessage.warning('讲义里还没有内容，先导入或插入一些吧');
        return;
      }
      saving.value = true;
      try {
        const data = normalize();
        const saved = await TK.api('/api/lectures/save', { method: 'POST', body: data });
        lecture.id = saved.id;
        lecture.savedAt = saved.updatedAt;
        const bs = await TK.api('/api/bootstrap');
        store.lectures = bs.lectures;
        store.stats = bs.stats;
        ElMessage.success('已保存到「讲义管理」');
      } catch (e) {
        ElMessage.error(e.message);
      } finally {
        saving.value = false;
      }
    }

    /** 版式预设：三种常见场景一键套用 */
    function preset(kind) {
      const map = {
        lecture: { columns: 1, fontSize: 14, lineHeight: 1.9, answerArea: 'none', showStudentInfo: false, showAnswer: false, showFooter: false },
        exam: { columns: 1, fontSize: 14, lineHeight: 1.8, answerArea: 'line', answerLines: 4, showStudentInfo: true, showAnswer: false, showFooter: true },
        practice: { columns: 2, fontSize: 13, lineHeight: 1.75, answerArea: 'none', showStudentInfo: true, showAnswer: true, showFooter: false }
      };
      const p = map[kind];
      if (!p) return;
      Object.assign(config, p);
      ElMessage.success(
        kind === 'lecture' ? '已套用「讲义」版式' :
        kind === 'exam' ? '已套用「试卷」版式' : '已套用「练习题」版式'
      );
    }

    function print() {
      if (!lecture.sections.some((s) => s.blocks.length)) {
        ElMessage.warning('讲义里还没有内容');
        return;
      }
      store.printTarget = { lecture: normalize(), config: JSON.parse(JSON.stringify(printConfig())) };
      // 浏览器打印的页眉默认取 document.title，临时换成文档标题，
      // 这样即使老师没关掉「页眉和页脚」，纸面上也不会出现系统名
      const oldTitle = document.title;
      const t = String(lecture.title || '').trim();
      if (t && t !== '未命名讲义') document.title = t;
      // 桌面客户端走主进程的系统打印框，浏览器走 window.print()
      TK.doPrint(
        function () {
          // 打上标记，让打印样式只输出纸面，不带侧边栏和顶栏
          document.body.classList.add('print-ready');
        },
        function () {
          document.title = oldTitle;
          document.body.classList.remove('print-ready');
        }
      );
    }

    function newLecture() {
      const l = emptyLecture();
      lecture.id = l.id;
      lecture.title = l.title;
      lecture.subject = '';
      lecture.grade = '';
      lecture.savedAt = null;
      lecture.sections = l.sections;
      // 新讲义回到「设置」页设定的默认版式
      config.columns = store.settings.lectureDensity === 'double' ? 2 : 1;
      activeSection.value = 0;
      activeBlock.value = '';
      ElMessage.success('已新建空白讲义');
    }

    /* ---------- 导入 ---------- */
    function parseTextToSections(text) {
      const lines = String(text || '').split('\n');
      const sections = [];
      let cur = { id: TK.uid(), heading: '讲义内容', blocks: [] };
      let para = [];
      const flushPara = () => {
        const t = para.join('\n').trim();
        if (t) cur.blocks.push({ id: TK.uid(), type: 'text', content: t });
        para = [];
      };
      const isHeading = (s) => {
        const t = s.trim();
        if (t.length > 26) return false;
        if (/[。；，,;]$/.test(t)) return false;
        return /^(第[一二三四五六七八九十百]+[章节讲部分]|[一二三四五六七八九十]+[、.]|\d+[、.]|【.+】|[（(][一二三四五六七八九十]+[)）])/.test(t) || /^#{1,4}\s/.test(t);
      };
      for (const raw of lines) {
        const line = raw.replace(/^#{1,4}\s*/, '').trim();
        if (!line) { flushPara(); continue; }
        if (isHeading(line)) {
          flushPara();
          if (cur.blocks.length) sections.push(cur);
          cur = { id: TK.uid(), heading: line.replace(/^#{1,4}\s*/, '').slice(0, 40), blocks: [] };
        } else {
          para.push(line);
        }
      }
      flushPara();
      if (cur.blocks.length || cur.heading !== '讲义内容') sections.push(cur);
      return sections.filter((s) => s.blocks.length || s.heading);
    }

    async function onFile(e) {
      const file = (e.target.files || [])[0];
      e.target.value = '';
      if (!file) return;
      importFileName.value = file.name;
      try {
        if (/\.docx$/i.test(file.name)) {
          const b64 = await new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(String(r.result).replace(/^data:[^,]+,/, ''));
            r.onerror = rej;
            r.readAsDataURL(file);
          });
          const r = await TK.api('/api/import/docx', { method: 'POST', body: { base64: b64 } });
          importText.value = r.text;
        } else {
          importText.value = await file.text();
        }
      } catch (err) {
        ElMessage.error('这个文件读不出来：' + err.message);
      }
    }

    async function doImport() {
      const text = importText.value.trim();
      if (!text) { ElMessage.warning('还没有内容'); return; }
      importing.value = true;
      try {
        let sections;
        if (useAI.value) {
          if (!store.settings.hasKey) {
            ElMessage.warning('AI 分节需要先配置 API Key，先按普通方式导入吧');
            sections = parseTextToSections(text);
          } else {
            const r = await TK.api('/api/lecture/organize', { method: 'POST', body: { text } });
            sections = (r.sections || []).map((s) => ({
              id: TK.uid(),
              heading: s.heading || '内容',
              blocks: (s.blocks || []).map((b) => ({
                id: TK.uid(),
                type: b.type === 'points' ? 'points' : b.type,
                content: b.type === 'points' ? (b.items || []).join('\n') : (b.content || '')
              })).filter((b) => b.content)
            })).filter((s) => s.blocks.length);
            if (!sections.length) sections = parseTextToSections(text);
            if (r.title && (!lecture.title || lecture.title === '未命名讲义')) lecture.title = r.title;
            if (r.truncated) {
              ElMessage.warning('材料较长，AI 只整理完前 ' + sections.length + ' 节，剩下的可以再导入一次补充');
            }
          }
        } else {
          sections = parseTextToSections(text);
        }

        if (!lecture.sections.some((s) => s.blocks.length)) {
          lecture.sections = sections;
        } else {
          lecture.sections = lecture.sections.concat(sections);
        }
        activeSection.value = lecture.sections.length - 1;
        importVisible.value = false;
        importText.value = '';
        importFileName.value = '';
        ElMessage.success('已导入 ' + sections.length + ' 个章节');
      } catch (e) {
        ElMessage.error(e.message);
      } finally {
        importing.value = false;
      }
    }

    /* ---------- 选题 ---------- */
    function openPicker() {
      pickedIds.value = [];
      pickKeyword.value = '';
      pickerVisible.value = true;
    }

    function togglePick(id, v) {
      const i = pickedIds.value.indexOf(id);
      if (v && i < 0) pickedIds.value.push(id);
      if (!v && i >= 0) pickedIds.value.splice(i, 1);
    }

    function insertPicked() {
      const list = store.questions.filter((q) => pickedIds.value.includes(q.id));
      const sec = lecture.sections[activeSection.value] || lecture.sections[0];
      for (const q of list) {
        sec.blocks.push({
          id: TK.uid(),
          type: 'question',
          questionId: q.id,
          stem: q.stem,
          stemHtml: q.stemHtml || '',
          figures: q.figures || [],
          options: q.options || [],
          answer: q.answer || '',
          analysis: q.analysis || '',
          typeLabel: q.type || '',
          lines: 3
        });
      }
      activeBlock.value = '';
      pickerVisible.value = false;
      ElMessage.success('已插入 ' + list.length + ' 道题');
    }

    /* ---------- 打开已有讲义 ---------- */
    function loadLecture(data) {
      lecture.id = data.id || null;
      lecture.title = data.title || '未命名讲义';
      lecture.subject = data.subject || '';
      lecture.grade = data.grade || '';
      lecture.savedAt = data.updatedAt || null;
      lecture.sections = (data.sections && data.sections.length ? data.sections : emptyLecture().sections)
        .map((s) => ({
          id: s.id || TK.uid(),
          heading: s.heading || '',
          // 大题分栏（选择题双栏），不接住的话生成试卷后会退回单栏
          cols: s.cols === 2 ? 2 : 1,
          blocks: (s.blocks || []).map((b) => Object.assign({ id: b.id || TK.uid() }, b))
        }));
      Object.assign(config, data.config || {});
      // 讲义自带版式优先；老讲义没存版式时用「设置」页里的默认分栏
      if (!data.config || typeof data.config.columns === 'undefined') {
        config.columns = store.settings.lectureDensity === 'double' ? 2 : 1;
      }
      activeSection.value = 0;
      activeBlock.value = '';
    }

    onActivated(() => {
      if (store.editingLecture) {
        loadLecture(store.editingLecture);
        store.editingLecture = null;
      }
    });

    return {
      store, lecture, config, previewConfig, activeSection, activeBlock, rightTab, saving,
      subjects, grades, currentBlock,
      importVisible, importTab, importText, importFileName, useAI, importing, fileInput,
      pickerVisible, pickKeyword, pickedIds, pickList,
      addSection, removeSection, moveSection, selectSection, selectBlock,
      addTextBlock, addAnswerBlock, addFormulaBlock, addExampleBlock, addTianzigeBlock,
      addPageBreak, removeBlock, moveBlock,
      blockLabel, blockBrief, save, print, newLecture, onFile, doImport,
      openPicker, togglePick, insertPicked, preset, paperWrap, paperZoom, blockTotal,
      rich: TK.rich, brief: TK.brief, fmtDate: TK.fmtDate, renderStem: TK.renderStem
    };
  }
};
