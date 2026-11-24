window.ViewDoc = {
  props: {
    lecture: { type: Object, default: null },
    config: { type: Object, default: () => ({}) },
    zoom: { type: Number, default: 1 }
  },
  setup(props) {
    const { computed } = Vue;

    const DEFAULTS = {
      columns: 1,
      fontSize: 14,
      lineHeight: 1.9,
      paragraphGap: 9,
      questionGap: 12,
      answerArea: 'line',
      answerLines: 3,
      gridCols: 20,
      showAnswer: false,
      showMeta: true,
      showSubtitle: true,
      showDate: false,
      showFooter: false,
      showStudentInfo: false,
      examInfo: '',
      school: '',
      teacher: '',
      subject: '',
      grade: '',
      showNotice: false,
      noticeText: ''
    };

    const cfg = computed(() => Object.assign({}, DEFAULTS, props.config || {}));

    // 不在这里写 padding：打印时需要用样式表统一控制页边距，内联样式会盖掉
    const paperStyle = computed(() => ({
      fontSize: cfg.value.fontSize + 'px',
      lineHeight: cfg.value.lineHeight,
      zoom: props.zoom && props.zoom !== 1 ? props.zoom : undefined
    }));

    const subtitle = computed(() => {
      const c = cfg.value;
      const parts = [c.grade, c.subject].filter(Boolean);
      if (c.subtitle) parts.push(c.subtitle);
      return parts.join(' · ');
    });

    const today = computed(() => {
      const d = new Date();
      return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
    });

    // 全局连续题号：答案区用（答案要能对上整卷的题号）
    const orderMap = computed(() => {
      const map = {};
      let n = 0;
      const secs = (props.lecture && props.lecture.sections) || [];
      for (const s of secs) {
        for (const b of (s.blocks || [])) {
          if (b.type === 'question') {
            n += 1;
            map[b.id] = n;
          }
        }
      }
      return map;
    });

    // 大题内的题号：真实试卷每个大题都从 1 重新编号
    const sectionMap = computed(() => {
      const map = {};
      const secs = (props.lecture && props.lecture.sections) || [];
      for (const s of secs) {
        let n = 0;
        for (const b of (s.blocks || [])) {
          if (b.type === 'question') {
            n += 1;
            map[b.id] = { no: n, score: Number(b.score) || 0 };
          }
        }
      }
      return map;
    });

    const answerList = computed(() => {
      const list = [];
      const secs = (props.lecture && props.lecture.sections) || [];
      for (const s of secs) {
        for (const b of (s.blocks || [])) {
          if (b.type === 'question' && (b.answer || b.analysis)) {
            list.push({ no: orderMap.value[b.id], answer: b.answer, analysis: b.analysis });
          }
        }
      }
      return list;
    });

    /** 题号（大题内重新编号） */
    function qIndex(id) {
      const m = sectionMap.value[id];
      return m ? m.no : '';
    }

    /** 该题分值，没有就空 */
    function qScore(id) {
      const m = sectionMap.value[id];
      return m && m.score ? m.score : 0;
    }

    function needLines(b) {
      return !b.options || !b.options.length;
    }

    /** 这道题留几行作答区；明确写了 0 就不留（不能用 || 兜底，0 是有效值） */
    function answerLinesOf(b) {
      const n = (b && b.lines !== undefined && b.lines !== null) ? Number(b.lines) : Number(cfg.value.answerLines);
      return n > 0 ? n : 0;
    }

    /** 要点块：优先用 items 数组，其次把 content 按行拆开 */
    function pointItems(b) {
      if (Array.isArray(b.items) && b.items.length) return b.items;
      return String(b.content || '').split('\n').map((s) => s.trim()).filter(Boolean);
    }

    return { cfg, paperStyle, subtitle, today, answerList, qIndex, qScore, needLines, answerLinesOf, pointItems, rich: TK.rich, renderStem: TK.renderStem, renderAnswer: TK.renderAnswer, stemForPaper: TK.stemForPaper };
  }
};
