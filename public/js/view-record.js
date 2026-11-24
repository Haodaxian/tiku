window.ViewRecord = {
  setup() {
    const { ref, computed, onMounted, onActivated, onDeactivated } = Vue;
    const { ElMessage, ElNotification } = ElementPlus;
    const store = TK.store;

    const fileInput = ref(null);
    const images = ref([]);
    const results = ref([]);
    const mode = ref('single');
    const folderId = ref(store.folders[0] ? store.folders[0].id : '');
    const folderOptions = computed(() => TK.folderOptions(store.folders));
    const dragging = ref(false);
    const recognizing = ref(false);
    const done = ref(0);
    const elapsed = ref(0);
    const saving = ref(false);
    const preview = ref('');
    const editVisible = ref(false);
    const editSaving = ref(false);
    const draft = ref(null);
    const hintSubject = ref(store.settings.lastSubject || '');
    const hintGrade = ref(store.settings.lastGrade || '');
    const autoSolve = ref(false);
    const SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理', '科学', '其他'];
    const GRADES = ['七年级', '八年级', '九年级', '高一', '高二', '高三', '小学三年级', '小学四年级', '小学五年级', '小学六年级', '通用'];
    let active = false;

    const selected = computed(() => results.value.filter((q) => q._checked));
    const allSelected = computed(() => results.value.length > 0 && results.value.every((q) => q._checked));
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
    function diffTag(d) {
      const i = TK.DIFFICULTIES.indexOf(TK.normDifficulty(d));
      return i <= 1 ? 'success' : (i === 2 ? 'warning' : 'danger');
    }
    function figSrc(f) { return TK.figSrc(f); }
    function figureSrcs(q) { return (q.figures || []).map((f) => TK.figSrc(f)).filter(Boolean); }

    function pick() { fileInput.value && fileInput.value.click(); }

    async function addFile(file) {
      if (!file || !/^image\//.test(file.type)) return;
      try {
        const url = await TK.downscaleImage(file, 1600);
        images.value.push({ id: 'img_' + Date.now() + Math.random().toString(36).slice(2, 6), url, name: file.name || '截图' });
      } catch (e) {
        ElMessage.error(e.message);
      }
    }

    async function onFiles(e) {
      const files = Array.from(e.target.files || []);
      for (const f of files) await addFile(f);
      e.target.value = '';
    }

    async function onDrop(e) {
      dragging.value = false;
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      if (!files.length) return;
      for (const f of files) await addFile(f);
    }

    function removeImage(i) { images.value.splice(i, 1); }

    /* 全局粘贴截图 */
    function onPaste(e) {
      if (!active) return;
      const items = (e.clipboardData && e.clipboardData.items) || [];
      const tasks = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image') === 0) {
          const f = items[i].getAsFile();
          if (f) tasks.push(addFile(f));
        }
      }
      if (tasks.length) {
        e.preventDefault();
        ElMessage.success('已从剪贴板添加 ' + tasks.length + ' 张图片');
      }
    }

    async function start() {
      if (!store.settings.hasKey) {
        ElMessage.warning('请先在「设置」里填写 API Key');
        store.view = 'settings';
        return;
      }
      if (!folderId.value && store.folders.length) folderId.value = store.folders[0].id;
      const queue = images.value.slice();
      recognizing.value = true;
      done.value = 0;
      elapsed.value = 0;
      const t0 = Date.now();
      const timer = setInterval(() => { elapsed.value = Math.round((Date.now() - t0) / 1000); }, 500);
      try {
        // 三张同时识别，整批耗时接近最快那几张，而不是逐张相加
        const outcomes = await TK.pool(queue, 3, async (im, idx) => {
          const list = await TK.api('/api/recognize', {
            method: 'POST',
            timeout: 150000,
            body: {
              images: [im.url], mode: mode.value, keepImage: true,
              subject: hintSubject.value, grade: hintGrade.value
            }
          });
          // 模型给出的是原图上的归一化框选，这里按框裁成独立图形，题目里直接可用
          await TK.hydrateFigures(list, im.url);
          done.value += 1;
          return { list, im, idx };
        });

        let added = 0;
        let failed = 0;
        const emptyOnes = [];
        outcomes.forEach((o, i) => {
          if (!o.ok) {
            failed += 1;
            ElMessage.error('第 ' + (i + 1) + ' 张识别失败：' + o.error.message);
            return;
          }
          const { list, im } = o.value;
          if (!list.length) emptyOnes.push(i + 1);
          for (const q of list) {
            results.value.push(Object.assign(q, {
              _checked: true,
              _solving: false,
              source: q.source || im.name,
              fromImage: im.url
            }));
            added += 1;
          }
        });

        if (added) {
          const sec = Math.round((Date.now() - t0) / 1000);
          ElNotification({
            title: '识别完成（用了 ' + sec + ' 秒）',
            message: '共识别出 ' + added + ' 道题，图形已单独裁出，核对后保存' + (failed ? '，' + failed + ' 张失败' : ''),
            type: 'success',
            duration: 3000
          });
          images.value = [];
          if (autoSolve.value) solveAll();
        }
        if (emptyOnes.length) ElMessage.warning('第 ' + emptyOnes.join('、') + ' 张没有识别到题目，可能拍得不完整');
      } finally {
        clearInterval(timer);
        recognizing.value = false;
      }
    }

    /** 开启「自动生成答案」时，识别完在后台逐题补答案（并发 2，避免同时打太多请求） */
    async function solveAll() {
      const targets = results.value.filter((q) => !String(q.answer || '').trim());
      if (!targets.length) return;
      let ok = 0;
      await TK.pool(targets, 2, async (q) => {
        q._solving = true;
        try {
          const r = await TK.api('/api/solve', { method: 'POST', body: { stem: q.stem, options: q.options || [] } });
          if (r.answer) q.answer = r.answer;
          if (r.analysis) q.analysis = r.analysis;
          if (r.knowledge && r.knowledge.length) q.knowledge = r.knowledge;
          if (r.difficulty) q.difficulty = r.difficulty;
          ok += 1;
        } catch (e) {
          /* 单题失败不影响其它题 */
        } finally {
          q._solving = false;
        }
      });
      if (ok) ElMessage.success('已自动补全 ' + ok + ' 道题的答案');
    }

    function toggleAll() {
      const target = !allSelected.value;
      results.value.forEach((q) => { q._checked = target; });
    }

    async function aiSolve(q) {
      if (!q.stem) return;
      q._solving = true;
      try {
        const r = await TK.api('/api/solve', { method: 'POST', body: { stem: q.stem, options: q.options || [] } });
        if (r.answer) q.answer = r.answer;
        if (r.analysis) q.analysis = r.analysis;
        if (r.knowledge && r.knowledge.length) q.knowledge = r.knowledge;
        if (r.difficulty) q.difficulty = r.difficulty;
        ElMessage.success('已补全答案与解析');
      } catch (e) {
        ElMessage.error(e.message);
      } finally {
        q._solving = false;
      }
    }

    async function save() {
      const list = selected.value;
      if (!list.length) { ElMessage.warning('请先勾选要保存的题目'); return; }
      saving.value = true;
      try {
        // 保存前兜底：还有未裁剪的框选图形，先补成图片
        await TK.hydrateFigures(list);
        const payload = list.map((q) => Object.assign({}, q, {
          source: q.source || '智能录题',
          folderId: folderId.value
        }));
        const r = await TK.api('/api/questions/save', { method: 'POST', body: { questions: payload, folderId: folderId.value } });
        ElMessage.success('已保存 ' + r.added + ' 道' + (r.skipped ? '，跳过重复 ' + r.skipped + ' 道' : ''));
        // 记住这次用的学段学科，下次录题自动带上
        if (hintSubject.value || hintGrade.value) {
          TK.api('/api/settings', {
            method: 'POST',
            body: { lastSubject: hintSubject.value, lastGrade: hintGrade.value }
          }).catch(() => {});
        }
        results.value = results.value.filter((q) => !q._checked);
        const bs = await TK.api('/api/bootstrap');
        store.questions = bs.questions;
        store.stats = bs.stats;
        store.folders = bs.folders;
      } catch (e) {
        ElMessage.error(e.message);
      } finally {
        saving.value = false;
      }
    }

    function openEdit(q) {
      draft.value = q;
      editVisible.value = true;
    }

    function applyEdit(payload) {
      const idx = results.value.findIndex((x) => x.id === payload.id);
      if (idx >= 0) {
        const flags = {
          _checked: results.value[idx]._checked,
          _solving: false,
          source: results.value[idx].source,
          fromImage: results.value[idx].fromImage
        };
        results.value[idx] = Object.assign({}, payload, flags);
      }
      editVisible.value = false;
      editSaving.value = false;
      ElMessage.success('已更新');
    }

    onMounted(() => {
      document.addEventListener('paste', onPaste);
      if (!folderId.value && store.folders.length) folderId.value = store.folders[0].id;
    });
    // 设置页刚保存的默认学段学科，回到录题页时自动补上（bootstrap 是异步的）
    Vue.watch(
      () => [store.settings.lastSubject, store.settings.lastGrade],
      ([s, g]) => {
        if (!hintSubject.value && s) hintSubject.value = s;
        if (!hintGrade.value && g) hintGrade.value = g;
      },
      { immediate: true }
    );
    onActivated(() => { active = true; });
    onDeactivated(() => { active = false; });

    return {
      store, fileInput, images, results, mode, folderId, folderOptions, dragging, recognizing, done, elapsed, saving,
      preview, editVisible, editSaving, draft, selected, allSelected, knowledgeOptions, tagOptions,
      hintSubject, hintGrade, SUBJECTS, GRADES, autoSolve,
      typeTag, diffTag, figSrc, figureSrcs, pick, onFiles, onDrop, removeImage, start, toggleAll, aiSolve, save,
      solveAll, openEdit, applyEdit,
      rich: TK.rich, renderStem: TK.renderStem, renderAnswer: TK.renderAnswer,
      pendingFigures: (q) => TK.pendingFigures(q)
    };
  }
};
