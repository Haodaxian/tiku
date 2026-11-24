window.ViewBank = {
  setup() {
    const { ref, computed, watch, nextTick, reactive } = Vue;
    const { ElMessage, ElMessageBox } = ElementPlus;
    const store = TK.store;

    const types = ['单选题', '多选题', '填空题', '判断题', '解答题', '计算题', '应用题', '实验探究题', '简答题', '阅读理解题', '图表分析题', '作文题', '完形填空题', '其他'];
    const DIFFS = TK.DIFFICULTIES;
    const MASTERY = TK.MASTERY_LEVELS;
    const SORTS = [
      { key: 'new', label: '最新录入' },
      { key: 'old', label: '最早录入' },
      { key: 'no', label: '题号升序' },
      { key: 'diff', label: '难度从易到难' }
    ];
    const DIFF_ORDER = {};
    DIFFS.forEach(function (d, i) { DIFF_ORDER[d] = i; });

    const folderId = ref('all');
    const keyword = ref('');
    const filterType = ref('');
    const filterDiff = ref('');
    const filterSubject = ref('');
    const filterGrade = ref('');
    const filterKnowledge = ref('');
    const filterTag = ref('');
    const filterSource = ref('');
    const onlyWithFigure = ref(false);
    const onlyWithAnswer = ref(false);
    const onlyFavorite = ref(false);
    const filterMastery = ref('');
    const sortBy = ref('new');
    const page = ref(1);
    const pageSize = 20;
    const checkedIds = ref([]);
    const editVisible = ref(false);
    const editSaving = ref(false);
    const draft = ref(null);
    const exporting = ref(false);
    const exportingDocx = ref(false);
    const moving = ref(null);
    const moveTarget = ref('');
    const similar = ref({ visible: false, source: null, list: [], loading: false });

    const bulkPatch = ref({ folderId: '', type: '', difficulty: '', addTags: '' });
    const bulkSaving = ref(false);

    /* ---------- 题库树（父子级） ---------- */
    const expandedFolders = ref([]);
    const folderDlg = ref({ visible: false, mode: 'create', id: '', name: '', parentId: '', tags: '' });

    function buildFolderTree() {
      const all = store.folders || [];
      const byParent = new Map();
      all.forEach(function (f) {
        const p = f.parentId || '';
        if (!byParent.has(p)) byParent.set(p, []);
        byParent.get(p).push(f);
      });
      function build(parentId, depth) {
        return (byParent.get(parentId) || []).map(function (f) {
          return { folder: f, depth: depth, children: build(f.id, depth + 1) };
        });
      }
      return build('', 0);
    }

    const folderTree = computed(buildFolderTree);

    /** 展开状态下摊平的一维列表，模板里直接 v-for */
    const flatFolders = computed(function () {
      const out = [];
      function walk(nodes) {
        nodes.forEach(function (n) {
          const open = expandedFolders.value.indexOf(n.folder.id) >= 0;
          out.push({ folder: n.folder, depth: n.depth, hasKids: n.children.length > 0, expanded: open });
          if (open) walk(n.children);
        });
      }
      walk(folderTree.value);
      return out;
    });

    function toggleFolder(id) {
      const i = expandedFolders.value.indexOf(id);
      if (i >= 0) expandedFolders.value.splice(i, 1);
      else expandedFolders.value.push(id);
    }

    /** 每个题库及其下级的题目数（一次算好，模板里直接查表） */
    const folderCounts = computed(function () {
      const direct = new Map();
      (store.questions || []).forEach(function (q) {
        direct.set(q.folderId, (direct.get(q.folderId) || 0) + 1);
      });
      const map = new Map();
      function walk(node) {
        let n = direct.get(node.folder.id) || 0;
        node.children.forEach(function (c) { n += walk(c); });
        map.set(node.folder.id, n);
        return n;
      }
      folderTree.value.forEach(walk);
      // 不在树上的（理论上不会出现）也要有数
      (store.folders || []).forEach(function (f) { if (!map.has(f.id)) map.set(f.id, direct.get(f.id) || 0); });
      return map;
    });

    function countDeep(id) {
      return folderCounts.value.get(id) || 0;
    }

    function openFolderDlg(mode, folder, parentId) {
      folderDlg.value = mode === 'edit'
        ? { visible: true, mode: 'edit', id: folder.id, name: folder.name, parentId: folder.parentId || '', tags: (folder.tags || []).join('、') }
        : { visible: true, mode: 'create', id: '', name: '', parentId: parentId || '', tags: '' };
    }

    async function saveFolderDlg() {
      const d = folderDlg.value;
      if (!d.name || !d.name.trim()) { ElMessage.warning('请输入题库名称'); return; }
      try {
        const body = { name: d.name.trim(), parentId: d.parentId || '', tags: d.tags || '' };
        if (d.mode === 'edit') {
          const r = await TK.api('/api/folders/' + d.id, { method: 'PUT', body: body });
          const idx = store.folders.findIndex(function (x) { return x.id === d.id; });
          if (idx >= 0) store.folders[idx] = r;
        } else {
          const f = await TK.api('/api/folders', { method: 'POST', body: body });
          store.folders.push(f);
          if (f.parentId && expandedFolders.value.indexOf(f.parentId) < 0) expandedFolders.value.push(f.parentId);
        }
        folderDlg.value = { visible: false, mode: 'create', id: '', name: '', parentId: '', tags: '' };
        ElMessage.success('已保存');
      } catch (e) {
        if (e && e.message) ElMessage.error(e.message);
      }
    }

    /** 可作为父级的题库：排除自己和自己的下级，防止成环 */
    const parentOptions = computed(function () {
      const self = folderDlg.value.id;
      const banned = new Set();
      function mark(id) {
        if (!id || banned.has(id)) return;
        banned.add(id);
        (store.folders || []).forEach(function (f) { if (f.parentId === id) mark(f.id); });
      }
      mark(self);
      return (store.folders || []).filter(function (f) { return !banned.has(f.id); });
    });

    function uniq(list) {
      return Array.from(new Set(list.filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), 'zh-CN'));
    }

    const subjectOptions = computed(() => uniq((store.questions || []).map((q) => q.subject)));
    const gradeOptions = computed(() => uniq((store.questions || []).map((q) => q.grade)));
    const knowledgeOptions = computed(() => uniq((store.questions || []).flatMap((q) => q.knowledge || [])).slice(0, 300));
    const tagOptions = computed(() => uniq((store.questions || []).flatMap((q) => q.tags || [])).slice(0, 300));

    const filtered = computed(() => {
      const kw = keyword.value.trim().toLowerCase();
      const srcKw = filterSource.value.trim().toLowerCase();
      const list = (store.questions || []).filter((q) => {
        if (folderId.value !== 'all' && q.folderId !== folderId.value) return false;
        if (filterType.value && q.type !== filterType.value) return false;
        if (filterDiff.value && q.difficulty !== filterDiff.value) return false;
        if (filterSubject.value && q.subject !== filterSubject.value) return false;
        if (filterGrade.value && q.grade !== filterGrade.value) return false;
        if (filterKnowledge.value && !(q.knowledge || []).includes(filterKnowledge.value)) return false;
        if (filterTag.value && !(q.tags || []).includes(filterTag.value)) return false;
        if (srcKw) {
          const haySrc = [q.source, q.year, q.region, q.chapter, q.subject, q.grade].join(' ').toLowerCase();
          if (haySrc.indexOf(srcKw) < 0) return false;
        }
        if (onlyWithFigure.value && !(q.figures && q.figures.length)) return false;
        if (onlyWithAnswer.value && !String(q.answer || '').trim()) return false;
        if (onlyFavorite.value && !q.favorite) return false;
        if (filterMastery.value) {
          const m = q.mastery || '';
          if (filterMastery.value === '未标记') { if (m) return false; }
          else if (m !== filterMastery.value) return false;
        }
        if (!kw) return true;
        const hay = [
          q.stem, q.answer, q.analysis, q.source, q.chapter, q.region, q.no,
          (q.knowledge || []).join(' '), (q.tags || []).join(' '),
          (q.options || []).map((o) => o.text).join(' ')
        ].join(' ').toLowerCase();
        return hay.indexOf(kw) >= 0;
      });
      return list.sort((a, b) => {
        if (sortBy.value === 'old') return (a.createdAt || 0) - (b.createdAt || 0);
        if (sortBy.value === 'no') {
          const na = parseInt(String(a.no || '').replace(/\D/g, ''), 10);
          const nb = parseInt(String(b.no || '').replace(/\D/g, ''), 10);
          if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
          return (b.createdAt || 0) - (a.createdAt || 0);
        }
        if (sortBy.value === 'diff') {
          const da = DIFF_ORDER[a.difficulty] === undefined ? 1 : DIFF_ORDER[a.difficulty];
          const db = DIFF_ORDER[b.difficulty] === undefined ? 1 : DIFF_ORDER[b.difficulty];
          if (da !== db) return da - db;
          return (b.createdAt || 0) - (a.createdAt || 0);
        }
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
    });

    const pageList = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize));

    /* ---------- 按词找题：命中高亮与定位 ---------- */

    /** 在纯文本里把关键词包上 <mark>（文本已经是转义过的，这里不再转义一次） */
    function markText(text, kw) {
      const s = String(text == null ? '' : text);
      if (!kw) return s;
      const lower = s.toLowerCase();
      const k = kw.toLowerCase();
      if (!k) return s;
      let out = '';
      let i = 0;
      for (;;) {
        const p = lower.indexOf(k, i);
        if (p < 0) { out += s.slice(i); break; }
        out += s.slice(i, p) + '<mark class="tk-hit">' + s.slice(p, p + kw.length) + '</mark>';
        i = p + kw.length;
      }
      return out;
    }

    /**
     * 只在文本节点里高亮，不碰标签和属性。
     * 注意：rich() 对没有公式的文本返回的是「不带任何标签的纯字符串」，
     * 所以不能只按 >文本< 匹配，必须把标签和文本分段处理，否则一个都匹配不到。
     */
    function hlHtml(html, kw) {
      if (!html || !kw) return html;
      const k = String(kw).trim();
      if (!k) return html;
      return String(html).replace(/(<[^>]*>)|([^<]+)/g, function (m, tag, text) {
        if (tag) return tag;
        return markText(text, k);
      });
    }

    function hlStem(q) {
      return hlHtml(TK.renderStem(q), keyword.value.trim());
    }

    function hlRich(s) {
      return hlHtml(TK.rich(s), keyword.value.trim());
    }

    /** 答案带多空编号 + 上下标，先按统一规则渲染再做搜索高亮 */
    function hlAnswer(q) {
      return hlHtml(TK.renderAnswer(q), keyword.value.trim());
    }

    /** 一道题里关键词出现了几次 */
    function hitCount(q) {
      const kw = keyword.value.trim().toLowerCase();
      if (!kw || !q) return 0;
      const hay = [
        q.stem, q.answer, q.analysis, q.no, q.source, q.chapter, q.region,
        (q.knowledge || []).join(' '), (q.tags || []).join(' '),
        (q.options || []).map(function (o) { return o.text; }).join(' ')
      ].join(' ').toLowerCase();
      let n = 0;
      let i = 0;
      for (;;) {
        const p = hay.indexOf(kw, i);
        if (p < 0) break;
        n++;
        i = p + kw.length;
      }
      return n;
    }

    /** 当前筛选结果里带命中的题目顺序（用于上一个/下一个跳转） */
    const hitIds = computed(function () {
      const kw = keyword.value.trim();
      if (!kw) return [];
      return filtered.value.filter(function (q) { return hitCount(q) > 0; }).map(function (q) { return q.id; });
    });

    const hitPos = ref(-1);

    function gotoHit(dir) {
      const ids = hitIds.value;
      if (!ids.length) return;
      let p = hitPos.value + dir;
      if (p < 0) p = ids.length - 1;
      if (p >= ids.length) p = 0;
      hitPos.value = p;
      const id = ids[p];
      const idx = filtered.value.findIndex(function (q) { return q.id === id; });
      if (idx < 0) return;
      const targetPage = Math.floor(idx / pageSize) + 1;
      if (targetPage !== page.value) page.value = targetPage;
      nextTick(function () {
        const el = document.getElementById('q-' + id);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('tk-flash');
        setTimeout(function () { el.classList.remove('tk-flash'); }, 1400);
      });
    }

    watch(keyword, function () {
      hitPos.value = -1;
      // 搜完直接定位到第一处命中，计数不会是 0/N
      nextTick(function () {
        if (hitIds.value.length) gotoHit(1);
      });
    });

    const hasFilter = computed(() => !!(
      keyword.value || filterType.value || filterDiff.value || filterSubject.value || filterGrade.value ||
      filterKnowledge.value || filterTag.value || filterSource.value || onlyWithFigure.value || onlyWithAnswer.value ||
      onlyFavorite.value || filterMastery.value
    ));

    const activeChips = computed(() => {
      const chips = [];
      if (keyword.value) chips.push({ key: 'keyword', label: '搜索：' + keyword.value });
      if (filterType.value) chips.push({ key: 'type', label: filterType.value });
      if (filterDiff.value) chips.push({ key: 'diff', label: filterDiff.value });
      if (filterSubject.value) chips.push({ key: 'subject', label: filterSubject.value });
      if (filterGrade.value) chips.push({ key: 'grade', label: filterGrade.value });
      if (filterKnowledge.value) chips.push({ key: 'knowledge', label: '知识点：' + filterKnowledge.value });
      if (filterTag.value) chips.push({ key: 'tag', label: '#' + filterTag.value });
      if (filterSource.value) chips.push({ key: 'source', label: '来源：' + filterSource.value });
      if (onlyWithFigure.value) chips.push({ key: 'figure', label: '只看带图' });
      if (onlyWithAnswer.value) chips.push({ key: 'answer', label: '只看有答案' });
      if (onlyFavorite.value) chips.push({ key: 'favorite', label: '只看收藏' });
      if (filterMastery.value) chips.push({ key: 'mastery', label: '掌握度：' + filterMastery.value });
      return chips;
    });

    const currentSortLabel = computed(() => {
      const s = SORTS.find((x) => x.key === sortBy.value);
      return s ? s.label : '最新录入';
    });

    const pageIds = computed(() => pageList.value.map((q) => q.id));
    const allPageChecked = computed(() => pageIds.value.length > 0 && pageIds.value.every((id) => checkedIds.value.includes(id)));
    const somePageChecked = computed(() => pageIds.value.some((id) => checkedIds.value.includes(id)) && !allPageChecked.value);

    watch([keyword, filterType, filterDiff, filterSubject, filterGrade, filterKnowledge, filterTag, filterSource, onlyWithFigure, onlyWithAnswer, onlyFavorite, filterMastery, folderId, sortBy], () => {
      page.value = 1;
    });

    // 删除题目后当前页可能已经越界（第 3 页把第 3 页删空），
    // 不修正的话列表会一片空白且分页器停在越界页码上。
    watch(() => filtered.value.length, function (n) {
      const maxPage = Math.max(1, Math.ceil(n / pageSize));
      if (page.value > maxPage) page.value = maxPage;
    });

    function typeTag(t) { return TK.TYPE_TAG[t] || 'info'; }
    /** 难度 5 档对应的标签颜色 */
    function diffTag(d) {
      const i = DIFF_ORDER[TK.normDifficulty(d)];
      if (i === 0 || i === 1) return 'success';
      if (i === 2) return 'warning';
      return 'danger';
    }
    function figSrc(f) { return TK.figSrc(f); }
    function figureSrcs(q) {
      return (q.figures || []).map((f) => TK.figSrc(f)).filter(Boolean);
    }
    function countIn(id) { return (store.questions || []).filter((q) => q.folderId === id).length; }

    function toggleCheck(id, v) {
      const i = checkedIds.value.indexOf(id);
      if (v && i < 0) checkedIds.value.push(id);
      if (!v && i >= 0) checkedIds.value.splice(i, 1);
    }

    function togglePageCheck(v) {
      const ids = pageIds.value;
      if (v) {
        const set = new Set(checkedIds.value);
        ids.forEach((id) => set.add(id));
        checkedIds.value = Array.from(set);
      } else {
        const drop = new Set(ids);
        checkedIds.value = checkedIds.value.filter((id) => !drop.has(id));
      }
    }

    function clearChip(key) {
      const map = {
        keyword: () => { keyword.value = ''; },
        type: () => { filterType.value = ''; },
        diff: () => { filterDiff.value = ''; },
        subject: () => { filterSubject.value = ''; },
        grade: () => { filterGrade.value = ''; },
        knowledge: () => { filterKnowledge.value = ''; },
        tag: () => { filterTag.value = ''; },
        source: () => { filterSource.value = ''; },
        figure: () => { onlyWithFigure.value = false; },
        answer: () => { onlyWithAnswer.value = false; },
        favorite: () => { onlyFavorite.value = false; },
        mastery: () => { filterMastery.value = ''; }
      };
      if (map[key]) map[key]();
    }

    function clearFilters() {
      keyword.value = '';
      filterType.value = '';
      filterDiff.value = '';
      filterSubject.value = '';
      filterGrade.value = '';
      filterKnowledge.value = '';
      filterTag.value = '';
      filterSource.value = '';
      onlyWithFigure.value = false;
      onlyWithAnswer.value = false;
      onlyFavorite.value = false;
      filterMastery.value = '';
    }

    async function reload() {
      const bs = await TK.api('/api/bootstrap');
      store.questions = bs.questions;
      store.folders = bs.folders;
      store.stats = bs.stats;
    }

    async function removeFolder(f) {
      try {
        await ElMessageBox.confirm('删除「' + f.name + '」后，里面的题目会移到第一个题库，题目本身不会丢。', '删除题库', {
          confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning'
        });
        const r = await TK.api('/api/folders/' + f.id, { method: 'DELETE' });
        store.folders = r.folders;
        await reload();
        folderId.value = 'all';
      } catch (e) {
        if (e !== 'cancel' && e && e.message) ElMessage.error(e.message);
      }
    }

    async function removeOne(q) {
      try {
        await ElMessageBox.confirm('删除后无法恢复，确定删除这道题吗？', '删除题目', {
          confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning'
        });
        await TK.api('/api/questions/' + q.id, { method: 'DELETE' });
        store.questions = store.questions.filter((x) => x.id !== q.id);
        store.stats = Object.assign({}, store.stats, { questionCount: store.questions.length });
        checkedIds.value = checkedIds.value.filter((id) => id !== q.id);
        ElMessage.success('已删除');
      } catch (e) {
        if (e !== 'cancel' && e && e.message) ElMessage.error(e.message);
      }
    }

    async function bulkDelete() {
      try {
        await ElMessageBox.confirm('将删除选中的 ' + checkedIds.value.length + ' 道题，删除后无法恢复。', '批量删除', {
          confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning'
        });
        const r = await TK.api('/api/questions/bulk-delete', { method: 'POST', body: { ids: checkedIds.value } });
        const set = new Set(checkedIds.value);
        store.questions = store.questions.filter((q) => !set.has(q.id));
        store.stats = Object.assign({}, store.stats, { questionCount: store.questions.length });
        checkedIds.value = [];
        ElMessage.success('已删除 ' + r.removed + ' 道');
      } catch (e) {
        if (e !== 'cancel' && e && e.message) ElMessage.error(e.message);
      }
    }

    async function applyBulk() {
      const patch = {
        folderId: bulkPatch.value.folderId || '',
        type: bulkPatch.value.type || '',
        difficulty: bulkPatch.value.difficulty || '',
        addTags: String(bulkPatch.value.addTags || '').split(/[,，;；\s]+/).filter(Boolean)
      };
      if (!patch.folderId && !patch.type && !patch.difficulty && !patch.addTags.length) {
        ElMessage.warning('先选一个要修改的项');
        return;
      }
      bulkSaving.value = true;
      try {
        const r = await TK.api('/api/questions/bulk-update', {
          method: 'POST',
          body: { ids: checkedIds.value, patch }
        });
        await reload();
        bulkPatch.value = { folderId: '', type: '', difficulty: '', addTags: '' };
        ElMessage.success('已更新 ' + r.changed + ' 道');
      } catch (e) {
        ElMessage.error(e.message);
      } finally {
        bulkSaving.value = false;
      }
    }

    async function aiSolve(q) {
      q._solving = true;
      try {
        const r = await TK.api('/api/solve', { method: 'POST', body: { stem: q.stem, options: q.options || [] } });
        const patch = { answer: r.answer || q.answer, analysis: r.analysis || q.analysis };
        if (r.knowledge && r.knowledge.length) patch.knowledge = r.knowledge;
        if (r.difficulty) patch.difficulty = r.difficulty;
        const updated = await TK.api('/api/questions/' + q.id, { method: 'PUT', body: patch });
        const i = store.questions.findIndex((x) => x.id === q.id);
        if (i >= 0) store.questions[i] = updated;
        ElMessage.success('已补全答案');
      } catch (e) {
        ElMessage.error(e.message);
      } finally {
        q._solving = false;
      }
    }

    function openEdit(q) {
      draft.value = q;
      editVisible.value = true;
      // 打开题目就算看了一次：浏览次数 +1（失败不打扰用户）
      TK.api('/api/questions/' + q.id + '/meta', { method: 'POST', body: { view: 1 } })
        .then(function (r) {
          const i = store.questions.findIndex(function (x) { return x.id === r.id; });
          if (i >= 0) { store.questions[i].viewCount = r.viewCount; }
        })
        .catch(function () {});
    }

    /** 收藏 / 取消收藏 */
    async function toggleFavorite(q, e) {
      if (e) e.stopPropagation();
      const next = q.favorite ? 0 : 1;
      q.favorite = next;               // 先动界面，失败再回滚
      try {
        const r = await TK.api('/api/questions/' + q.id + '/meta', { method: 'POST', body: { favorite: next } });
        q.favorite = r.favorite;
      } catch (err) {
        q.favorite = next ? 0 : 1;
        ElMessage.error(err.message || '操作失败');
      }
    }

    /** 点击掌握度标签：未标记 → 生疏 → 模糊 → 掌握 → 未标记 */
    async function cycleMastery(q, e) {
      if (e) e.stopPropagation();
      const cur = q.mastery || '';
      const next = cur === '' ? '生疏' : (cur === '生疏' ? '模糊' : (cur === '模糊' ? '掌握' : ''));
      const old = cur;
      q.mastery = next;
      try {
        const r = await TK.api('/api/questions/' + q.id + '/meta', { method: 'POST', body: { mastery: next } });
        q.mastery = r.mastery;
      } catch (err) {
        q.mastery = old;
        ElMessage.error(err.message || '操作失败');
      }
    }

    async function applyEdit(payload) {
      if (payload && payload._isNew) { await saveNew(payload); return; }
      editSaving.value = true;
      try {
        const updated = await TK.api('/api/questions/' + payload.id, { method: 'PUT', body: payload });
        const i = store.questions.findIndex((x) => x.id === updated.id);
        if (i >= 0) store.questions[i] = updated;
        editVisible.value = false;
        ElMessage.success('已保存');
      } catch (e) {
        ElMessage.error(e.message);
      } finally {
        editSaving.value = false;
      }
    }

    async function exportJson() {
      exporting.value = true;
      try {
        const data = await TK.api('/api/export/all');
        TK.download('题库备份-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(data, null, 2));
        ElMessage.success('已导出备份文件');
      } catch (e) {
        ElMessage.error(e.message);
      } finally {
        exporting.value = false;
      }
    }

    function printPaper() {
      const list = store.questions.filter((q) => checkedIds.value.includes(q.id));
      if (!list.length) return;
      const config = {
        columns: 1, fontSize: 14, lineHeight: 1.9, showAnswer: false, showMeta: true,
        showSubtitle: true, answerArea: 'line', answerLines: 4, school: store.settings.school || '',
        teacher: store.settings.teacher || '', subtitle: '共 ' + list.length + ' 题'
      };
      store.printTarget = {
        lecture: TK.buildPaper('试卷', list),
        config
      };
      // 必须打上 print-ready：只有这个标记存在，打印样式才会只输出纸面。
      // 少了它，打印出来的是整个题库列表界面，试卷内容一条都没有。
      document.body.classList.add('print-ready');
      Vue.nextTick(() => setTimeout(() => {
        window.print();
        setTimeout(() => document.body.classList.remove('print-ready'), 1000);
      }, 300));
    }

    /* ---------- 组卷：按真实试卷的版式来 ---------- */

    const paper = reactive({
      visible: false,
      title: '',
      school: '',
      examInfo: '',
      showStudentInfo: true,
      showNotice: true,
      noticeText: '1．选择题的答案须用 2B 铅笔填涂在答题卡上；2．解答题须用黑色签字笔写在答题卡相应位置，写在试卷上无效。',
      sectioned: true,
      twoColChoice: true,
      withAnswer: false,
      answerLines: 5,
      scores: { choice: 3, fill: 4, solve: 6, comp: 10, other: 4 }
    });

    /** 组卷设置里可调分值的题型 */
    const paperScoreFields = [
      { key: 'choice', label: '选择题' },
      { key: 'fill', label: '填空题' },
      { key: 'solve', label: '解答题' },
      { key: 'comp', label: '综合题' },
      { key: 'other', label: '其他题' }
    ];

    /** 打开组卷设置：按当前勾选的题自动预填卷首 */
    function openPaperSetup() {
      const list = store.questions.filter((q) => checkedIds.value.includes(q.id));
      if (!list.length) { ElMessage.warning('先勾选要出卷的题目'); return; }
      const subject = list[0].subject || '';
      const grade = list[0].grade || '';
      const groups = TK.groupQuestions(list, paper.scores);
      const total = groups.reduce((n, g) => n + g.questions.length * g.score, 0);
      paper.title = paper.title || (subject + grade ? grade + subject : '') + '测试卷';
      paper.school = store.settings.school || '';
      paper.examInfo = paper.examInfo || ('时间 ' + estimateMinutes(list.length) + ' 分钟　满分 ' + total + ' 分');
      paper.visible = true;
    }

    /** 按题量估个考试时长：选择题 1 分钟/题，长题多留时间 */
    function estimateMinutes(n) {
      return Math.max(30, Math.round(n * 1.5 / 5) * 5);
    }

    /** 按设置组装试卷，送到讲义排版页预览 */
    function buildPaper() {
      const list = store.questions.filter((q) => checkedIds.value.includes(q.id));
      if (!list.length) { ElMessage.warning('没有勾选题目'); return; }
      const doc = TK.buildPaper(paper.title || '试卷', list, {
        sectioned: paper.sectioned,
        twoColChoice: paper.twoColChoice,
        scores: paper.scores,
        showTypeLabel: false,
        answerLines: paper.answerLines
      });
      const config = {
        columns: 1,
        fontSize: 14,
        lineHeight: 1.9,
        answerArea: 'line',
        answerLines: 4,
        gridCols: 20,
        showAnswer: paper.withAnswer,
        showMeta: true,
        showSubtitle: false,
        showDate: false,
        showFooter: false,
        showStudentInfo: paper.showStudentInfo,
        showNotice: paper.showNotice,
        noticeText: paper.noticeText,
        examInfo: paper.examInfo,
        school: paper.school,
        teacher: store.settings.teacher || '',
        subject: '',
        grade: ''
      };
      // 送到讲义排版页：那里能看预览、调整、再打印或另存为讲义
      store.editingLecture = {
        id: null,
        title: doc.title,
        subject: '',
        grade: '',
        savedAt: null,
        sections: doc.sections,
        config: config
      };
      paper.visible = false;
      store.view = 'lecture';
      ElMessage.success('试卷已生成，可在讲义排版页预览后打印');
    }

    /** 导出 Word：题干保留富文本排版，图形作为图片嵌进 docx */
    async function exportDocx(withAnswer) {
      const list = store.questions.filter((q) => checkedIds.value.includes(q.id));
      if (!list.length) { ElMessage.warning('先勾选要导出的题目'); return; }
      exportingDocx.value = true;
      try {
        const r = await TK.api('/api/export/docx', {
          method: 'POST',
          body: {
            title: '试卷',
            school: store.settings.school || '',
            subtitle: '共 ' + list.length + ' 题',
            studentInfo: true,
            withAnswer: !!withAnswer,
            answerLines: 3,
            questions: list
          }
        });
        TK.downloadBase64(r.filename, r.base64, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        ElMessage.success('已导出 ' + r.filename);
      } catch (e) {
        ElMessage.error(e.message);
      } finally {
        exportingDocx.value = false;
      }
    }

    /* ---------- 新增 / 移动 / 相似题 ---------- */
    function createQuestion() {
      const folder = folderId.value === 'all' ? (store.folders[0] && store.folders[0].id) : folderId.value;
      draft.value = {
        id: 'q_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        no: '', stem: '', stemHtml: '', type: '单选题', difficulty: '中等',
        options: [{ key: 'A', text: '' }, { key: 'B', text: '' }],
        answer: '', analysis: '', knowledge: [], tags: [], figures: [],
        subject: filterSubject.value || '', grade: filterGrade.value || '',
        folderId: folder || (store.folders[0] && store.folders[0].id) || '',
        year: '', region: '', source: '', chapter: '', _isNew: true
      };
      editVisible.value = true;
    }

    async function saveNew(payload) {
      editSaving.value = true;
      try {
        const body = { questions: [payload], folderId: payload.folderId, allowDuplicate: true };
        const r = await TK.api('/api/questions/save', { method: 'POST', body });
        await reload();
        editVisible.value = false;
        // 要看接口返回的实际结果：服务端判为空题跳过了，界面却提示"已新增"，
        // 老师会以为存上了，回头找不到这道题。
        if (r && r.added === 0) {
          ElMessage.warning('这道题没有存进去：题干是空的（只有文字没有内容不算题），请补充后再保存');
        } else {
          ElMessage.success('已新增到题库');
        }
      } catch (e) {
        ElMessage.error(e.message);
      } finally {
        editSaving.value = false;
      }
    }

    function openMove(q) {
      moving.value = q;
      moveTarget.value = q.folderId || '';
    }

    async function doMove() {
      if (!moving.value || !moveTarget.value) return;
      try {
        const updated = await TK.api('/api/questions/' + moving.value.id, { method: 'PUT', body: { folderId: moveTarget.value } });
        const i = store.questions.findIndex((x) => x.id === updated.id);
        if (i >= 0) store.questions[i] = updated;
        moving.value = null;
        ElMessage.success('已移动');
      } catch (e) {
        ElMessage.error(e.message);
      }
    }

    async function openSimilar(q) {
      similar.value = { visible: true, source: q, list: [], loading: true };
      try {
        const list = await TK.api('/api/questions/similar', {
          method: 'POST',
          body: {
            id: q.id, stem: q.stem, options: q.options || [],
            knowledge: q.knowledge || [], count: 3
          }
        });
        similar.value.list = list.map((x) => Object.assign(x, { _checked: true }));
        if (!list.length) ElMessage.info('模型没有生成变式题，可以再试一次');
      } catch (e) {
        ElMessage.error(e.message);
        similar.value.visible = false;
      } finally {
        similar.value.loading = false;
      }
    }

    async function saveSimilar() {
      const src = similar.value.source;
      const picked = similar.value.list.filter((x) => x._checked);
      if (!src || !picked.length) return;
      try {
        const payload = picked.map((q) => Object.assign({}, q, {
          folderId: src.folderId, subject: q.subject || src.subject,
          grade: q.grade || src.grade, tags: Array.from(new Set([].concat(q.tags || [], src.tags || [], ['变式题']))).slice(0, 8),
          source: 'AI 变式 · 原题第 ' + (src.no || '') + ' 题'
        }));
        const r = await TK.api('/api/questions/save', { method: 'POST', body: { questions: payload, folderId: src.folderId } });
        await reload();
        similar.value.visible = false;
        ElMessage.success('已保存 ' + r.added + ' 道变式题');
      } catch (e) {
        ElMessage.error(e.message);
      }
    }

    return {
      store, types, DIFFS, MASTERY, SORTS, folderId, keyword, filterType, filterDiff,
      filterSubject, filterGrade, filterKnowledge, filterTag, filterSource,
      onlyWithFigure, onlyWithAnswer, onlyFavorite, filterMastery, sortBy, page, pageSize, checkedIds,
      editVisible, editSaving, draft, exporting, bulkPatch, bulkSaving,
      exportingDocx, moving, moveTarget, similar,
      filtered, pageList, subjectOptions, gradeOptions, knowledgeOptions, tagOptions,
      hasFilter, activeChips, currentSortLabel, allPageChecked, somePageChecked,
      typeTag, diffTag, figSrc, figureSrcs, countIn, toggleCheck, togglePageCheck,
      clearChip, clearFilters, removeFolder, removeOne, toggleFavorite, cycleMastery,
      bulkDelete, applyBulk, aiSolve, openEdit, applyEdit, exportJson, printPaper,
      paper, openPaperSetup, buildPaper, paperScoreFields,
      exportDocx, createQuestion, openMove, doMove, openSimilar, saveSimilar,
      rich: TK.rich, brief: TK.brief, fmtDate: TK.fmtDate, renderStem: TK.renderStem,
      pendingFigures: (q) => TK.pendingFigures(q),
      // 题库树
      flatFolders, expandedFolders, toggleFolder, countDeep, folderDlg,
      openFolderDlg, saveFolderDlg, parentOptions,
      // 按词找题
      hlStem, hlRich, hlAnswer, hitCount, hitIds, hitPos, gotoHit
    };
  }
};
