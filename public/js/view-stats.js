window.ViewStats = {
  setup() {
    const { computed, onMounted } = Vue;
    const store = TK.store;
    const s = computed(() => store.stats || {});

    const priceRows = [
      { model: '识图模型', raw: 'Step-1o Turbo Vision', label: '看图录题', in: '¥2.50', out: '¥8.00', note: '拍题识别用的就是这个，专用视觉模型，速度快' },
      { model: '文本模型', raw: 'Step-3.5 Flash', label: '解题 / 讲义整理', in: '¥0.70', out: '¥2.10', note: '讲解、讲义分节用的就是这个，最经济' },
      { model: '备选识图', raw: 'Step-3.7 Flash', label: '可换用', in: '¥1.35', out: '¥8.10', note: '识图和文字都能做，需要时可换用' },
      { model: '高精度识图', raw: 'Step 5 Preview', label: '可换用', in: '¥7.00', out: '¥20.00', note: '复杂版面最准，单价约 3 倍' }
    ];

    // 把内部型号换成老师看得懂的名字，型号只作为副标题小字出现
    function modelName(id) {
      const m = (store.settings.models || {})[id];
      if (m && m.name) return m.name;
      if (/vision|1o|turbo/i.test(id)) return '识图模型';
      return '文本模型';
    }
    function isVision(id) {
      return id === store.settings.visionModel;
    }

    const modelRows = computed(() => (s.value.byModel || []).map((r) =>
      Object.assign({}, r, {
        raw: r.model,
        model: modelName(r.model),
        kind: r.model === store.settings.visionModel ? '识图' : (r.model === store.settings.textModel ? '文本' : '其他')
      })));

    const weekTotal = computed(() => (s.value.last7 || []).reduce((n, d) => n + (d.count || 0), 0));

    function barHeight(count) {
      const max = Math.max.apply(null, (s.value.last7 || []).map((d) => d.count).concat([1]));
      return Math.max(3, Math.round((count / max) * 76)) + 'px';
    }

    function pct(v, total) {
      const t = total || 1;
      return Math.max(2, Math.round((v / t) * 100)) + '%';
    }

    // 难度 5 档配色：绿 → 浅绿 → 琥珀 → 砖红 → 深红
    const DIFF_COLORS = ['#7f9c86', '#5e8168', '#b5873f', '#b56d63', '#8f4a41'];
    function diffColor(d) {
      const i = TK.DIFFICULTIES.indexOf(TK.normDifficulty(d));
      return DIFF_COLORS[i < 0 ? 2 : i];
    }

    onMounted(async () => {
      try {
        store.stats = await TK.api('/api/stats');
      } catch (e) { /* 忽略 */ }
    });

    const DIFFS = TK.DIFFICULTIES;

    return { store, s, priceRows, modelRows, barHeight, pct, diffColor, weekTotal, isVision, DIFFS };
  }
};
