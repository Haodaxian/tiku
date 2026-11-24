window.ViewDashboard = {
  setup() {
    const { computed } = Vue;
    const store = TK.store;

    const cards = [
      { key: 'record', icon: 'Camera', title: '智能录题', desc: '拍照、截图或粘贴，自动识别成一道一道的题目，核对后存进题库。', action: '开始录题' },
      { key: 'import', icon: 'Files', title: '试卷导入', desc: '整份试卷图片批量识别，或上传 PDF 逐页框选切题。', action: '上传试卷' },
      { key: 'lecture', icon: 'Reading', title: '讲义排版', desc: '把讲义内容排成 A4，单双栏、字号行距、作答区都能调，直接打印。', action: '新建讲义' }
    ];

    const steps = [
      { t: '配置模型', d: '在设置里填入阶跃星辰 API Key，一次配置长期有效。' },
      { t: '录题入库', d: '拍张照或传整份试卷，核对识别结果后保存。' },
      { t: '排讲义打印', d: '选题目、调版式，用浏览器直接打印或存成 PDF。' }
    ];

    const s = computed(() => store.stats || {});

    const recent = computed(() => {
      return (store.questions || []).slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
    });

    const weekTotal = computed(() =>
      (s.value.last7 || []).reduce((sum, d) => sum + (d.count || 0), 0)
    );

    const hasAnyData = computed(() => (s.value.questionCount || 0) > 0);

    function barHeight(count) {
      const max = Math.max.apply(null, (s.value.last7 || []).map((d) => d.count).concat([1]));
      const h = Math.round((count / max) * 76);
      return Math.max(3, h) + 'px';
    }

    async function go(key) {
      store.view = key;
    }

    async function refresh() {
      try {
        const data = await TK.api('/api/stats');
        store.stats = data;
      } catch (e) { /* 静默 */ }
    }
    Vue.onMounted(refresh);

    return {
      store, cards, steps, s, recent, barHeight, go, weekTotal, hasAnyData,
      rich: TK.rich, brief: TK.brief, fmtDate: TK.fmtDate
    };
  }
};
