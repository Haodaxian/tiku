/* 应用外壳：加载页面模板、注册组件、导航与主题 */
(function () {
  const TPL_FILES = {
    app: 'tpl/app.html',
    dashboard: 'tpl/dashboard.html',
    record: 'tpl/record.html',
    import: 'tpl/import.html',
    bank: 'tpl/bank.html',
    gallery: 'tpl/gallery.html',
    lecture: 'tpl/lecture.html',
    lectures: 'tpl/lectures.html',
    stats: 'tpl/stats.html',
    settings: 'tpl/settings.html',
    docView: 'tpl/doc-view.html',
    qedit: 'tpl/qedit.html'
  };

  const NAV = [
    {
      title: '录题与备课',
      items: [
        { key: 'dashboard', label: '工作台', icon: 'HomeFilled', desc: '整体情况与快捷入口' },
        { key: 'record', label: '智能录题', icon: 'Camera', desc: '拍照、截图、粘贴，自动识别成题目' },
        { key: 'import', label: '试卷导入', icon: 'Files', desc: '整卷图片批量识别，或 PDF 框选切题' },
        { key: 'bank', label: '题库管理', icon: 'Collection', desc: '检索、编辑、组卷与备份' },
        { key: 'gallery', label: '我的图库', icon: 'Picture', desc: '常用图形统一存放，出题时直接取用' }
      ]
    },
    {
      title: '讲义与输出',
      items: [
        { key: 'lecture', label: '讲义排版', icon: 'Reading', desc: 'A4 排版、单双栏、作答区，直接打印' },
        { key: 'lectures', label: '讲义管理', icon: 'Notebook', desc: '已保存的讲义' }
      ]
    },
    {
      title: '设置',
      items: [
        { key: 'stats', label: '数据统计', icon: 'DataLine', desc: '题量、分布与本机费用估算' },
        { key: 'settings', label: '设置', icon: 'Setting', desc: '模型接入与个人偏好' }
      ]
    }
  ];

  /* ---------- 工具补充 ---------- */
  TK.uid = function () {
    return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  };

  /**
   * 题型分组：真实试卷不是把题平铺，而是分大题。
   * 每组有自己的标题样式、每题分值，以及是否双栏。
   */
  const TYPE_GROUPS = [
    { key: 'choice', name: '选择题', types: ['单选题', '多选题', '判断题'], score: 3, cols: 2 },
    { key: 'fill', name: '填空题', types: ['填空题'], score: 4, cols: 1 },
    { key: 'solve', name: '解答题', types: ['解答题', '计算题', '应用题', '实验探究题', '简答题'], score: 6, cols: 1 },
    { key: 'comp', name: '综合题', types: ['阅读理解题', '图表分析题', '完形填空题', '作文题'], score: 10, cols: 1 },
    { key: 'other', name: '其他题', types: [], score: 4, cols: 1 }
  ];

  const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

  /** 把题目按题型分到大题里 */
  TK.groupQuestions = function (questions, scores) {
    const used = new Set();
    const groups = [];
    TYPE_GROUPS.forEach(function (g) {
      const inGroup = questions.filter(function (q) {
        const t = String(q.type || '').trim();
        if (g.types.indexOf(t) >= 0) { used.add(q); return true; }
        return false;
      });
      if (!inGroup.length) return;
      const score = Number(scores && scores[g.key] != null ? scores[g.key] : g.score) || g.score;
      groups.push({ key: g.key, name: g.name, cols: g.cols, score: score, questions: inGroup });
    });
    // 没被归到任何一组的题，统统放进"其他题"
    const rest = questions.filter(function (q) { return !used.has(q); });
    if (rest.length) {
      const score = Number(scores && scores.other != null ? scores.other : 4) || 4;
      groups.push({ key: 'other', name: '其他题', cols: 1, score: score, questions: rest });
    }
    return groups;
  };

  /** 生成试卷结构：分大题、题号分区连续、每题带分值 */
  TK.buildPaper = function (title, questions, opts) {
    const o = opts || {};
    const groups = TK.groupQuestions(questions || [], o.scores);
    const sections = groups.map(function (g, gi) {
      const count = g.questions.length;
      const total = count * g.score;
      const heading = o.sectioned
        ? CN_NUM[gi] + '、' + g.name +
          '（本大题共 ' + count + ' 小题，每小题 ' + g.score + ' 分，共 ' + total + ' 分）'
        : '';
      return {
        id: TK.uid(),
        heading: heading,
        cols: o.twoColChoice && g.key === 'choice' ? 2 : 1,
        blocks: g.questions.map(function (q) {
          // 选择题、填空题不画作答横线：真题里这两类就是直接答在题旁，
          // 画一堆横线只会把卷子撑得很长。解答题才留出书写区。
          const needRoom = (g.key === 'solve' || g.key === 'comp');
          return {
            id: TK.uid(),
            type: 'question',
            questionId: q.id,
            stem: q.stem,
            stemHtml: q.stemHtml || '',
            figures: q.figures || [],
            options: q.options || [],
            answer: q.answer || '',
            analysis: q.analysis || '',
            typeLabel: o.showTypeLabel ? (q.type || '') : '',
            score: g.score,
            lines: needRoom ? (Number(o.answerLines) || 0) : 0
          };
        })
      };
    });
    return { title: title || '试卷', sections: sections };
  };

  async function fetchTemplate(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('页面模板加载失败：' + url);
    return await res.text();
  }

  function showFatal(message) {
    document.getElementById('app').innerHTML =
      '<div style="padding:60px;font-family:sans-serif;line-height:1.9">' +
      '<h2 style="color:#e04b4b">程序启动异常</h2>' +
      '<p>' + message + '</p>' +
      '<p style="color:#888">请确认启动的是完整程序目录，不要单独移动 index.html；' +
      '如果刚从压缩包解压，请把整个文件夹一起解压。</p></div>';
  }

  (async function main() {
    const tpls = {};
    try {
      await Promise.all(Object.keys(TPL_FILES).map(async function (k) {
        tpls[k] = await fetchTemplate(TPL_FILES[k]);
      }));
    } catch (e) {
      showFatal(e.message);
      return;
    }

    const { createApp, computed, onMounted, onActivated } = Vue;
    const store = TK.store;

    function view(name, logic, tplKey) {
      return Object.assign({ name: name, template: tpls[tplKey] || '' }, logic);
    }

    const components = {
      'view-dashboard': view('ViewDashboard', window.ViewDashboard, 'dashboard'),
      'view-record': view('ViewRecord', window.ViewRecord, 'record'),
      'view-import': view('ViewImport', window.ViewImport, 'import'),
      'view-bank': view('ViewBank', window.ViewBank, 'bank'),
      'view-gallery': view('ViewGallery', window.ViewGallery, 'gallery'),
      'view-lecture': view('ViewLecture', window.ViewLecture, 'lecture'),
      'view-lectures': view('ViewLectures', window.ViewLectures, 'lectures'),
      'view-stats': view('ViewStats', window.ViewStats, 'stats'),
      'view-settings': view('ViewSettings', window.ViewSettings, 'settings'),
      'doc-view': view('DocView', window.ViewDoc, 'docView'),
      'q-edit': view('QEditDrawer', window.QEditDrawer, 'qedit')
    };

    const VIEW_KEYS = ['dashboard', 'record', 'import', 'bank', 'gallery', 'lecture', 'lectures', 'stats', 'settings'];
    const flat = {};
    NAV.forEach(function (g) { g.items.forEach(function (i) { flat[i.key] = i; }); });

    const root = {
      template: tpls.app,
      components: components,
      setup() {
        const current = computed(function () {
          return flat[store.view] || { label: '', desc: '' };
        });

        const viewComp = computed(function () {
          const key = VIEW_KEYS.indexOf(store.view) >= 0 ? store.view : 'dashboard';
          return 'view-' + key;
        });

        function go(key) {
          store.view = key;
          const el = document.querySelector('.content');
          if (el) el.scrollTop = 0;
        }

        function toggleTheme() {
          store.theme = store.theme === 'dark' ? 'light' : 'dark';
          document.documentElement.classList.toggle('dark', store.theme === 'dark');
          try { localStorage.setItem('tiku-theme', store.theme); } catch (e) {}
        }

        /** 顶栏问号：看当前页面的说明 */
        function openHelp() {
          if (!window.TKGuide) return;
          const key = store.view;
          if (window.TKGuideData && window.TKGuideData.pages[key]) {
            window.TKGuide.openHelp(key);
          } else {
            window.TKGuide.openOverview();
          }
        }

        /** 侧边栏：总览指南 */
        function openGuide() {
          if (!window.TKGuide) return;
          window.TKGuide.openOverview();
        }

        /** 重看新手引导 */
        function restartTour() {
          if (!window.TKGuide) return;
          window.TKGuide.start((window.TKGuideData && window.TKGuideData.tour) || [], {
            key: 'tiku-tour', force: true
          });
        }

        onMounted(async function () {
          try {
            if (localStorage.getItem('tiku-theme') === 'dark') {
              store.theme = 'dark';
              document.documentElement.classList.add('dark');
            }
          } catch (e) {}

          // 桌面客户端：主进程菜单「打印当前试卷」转到这里
          try {
            if (window.tikuElectron && window.tikuElectron.onMenuPrint) {
              window.tikuElectron.onMenuPrint(function () {
                if (!TK.requestPrint()) {
                  ElementPlus.ElMessage.warning('当前页面没有可打印的内容，切到「讲义排版」再试');
                }
              });
            }
          } catch (e) {}

          // F1：随时打开当前页面的说明
          try {
            document.addEventListener('keydown', function (e) {
              if (e.key === 'F1') { e.preventDefault(); openHelp(); }
            });
          } catch (e) {}

          // 支持用 ?view=record 直接打开某个页面（也方便刷新后回到原页面）
          try {
            const v = new URLSearchParams(location.search).get('view');
            if (v && flat[v]) store.view = v;
          } catch (e) {}

          try {
            const data = await TK.api('/api/bootstrap');
            store.settings = data.settings;
            store.folders = data.folders;
            store.questions = data.questions;
            store.gallery = data.gallery || [];
            store.lectures = data.lectures;
            store.stats = data.stats;
            store.ready = true;

            // 第一次用：自动走一遍新手引导（可跳过，跳过后不再打扰）
            // 引导里已经讲到"填 API Key"，所以那个提示要等引导结束后再弹，
            // 否则提示会被引导遮罩盖住，用户根本看不见。
            var showKeyHint = function () {
              ElementPlus.ElMessage({
                message: '第一次使用，先到「设置」里填入阶跃星辰 API Key',
                type: 'info',
                duration: 5000
              });
            };
            var willTour = false;
            try {
              willTour = !!(window.TKGuide && !window.TKGuide.isDone('tiku-tour'));
              if (willTour) {
                window.TKGuide.onTourEnd(function () {
                  if (!store.settings.hasKey) showKeyHint();
                });
                setTimeout(function () {
                  window.TKGuide.start((window.TKGuideData && window.TKGuideData.tour) || [], {
                    key: 'tiku-tour'
                  });
                }, 700);
              }
            } catch (e) { willTour = false; }
            if (!data.settings.hasKey && !willTour) {
              showKeyHint();
            }
            // 数据文件损坏过：必须明确告诉老师，不能让空白的题库看起来像"本来就没有数据"
            if (data.settings.corrupted) {
              const c = data.settings.corrupted;
              ElementPlus.ElMessageBox.alert(
                '题库数据文件读取失败，当前显示的是空题库。损坏前的原始内容已完整保留在 data 目录下的「' +
                c.file + '」里，没有丢失。\n\n' +
                '请到「设置」页点「从备份恢复」把最近的备份导回来；如果没有备份，可以把 ' +
                c.file + ' 改名回 db.json 后重启程序。',
                '数据文件损坏',
                { type: 'error', confirmButtonText: '我知道了', dangerouslyUseHTMLString: false }
              ).catch(function () {});
            }
          } catch (e) {
            ElementPlus.ElMessage.error(e.message);
            // 读取失败也要放行界面，否则一直停在加载态；
            // 页面会显示 0 道题，用户能看出"数据没读出来"，而不是一直转圈
            store.ready = true;
          }

          window.addEventListener('afterprint', function () {
            store.printTarget = null;
            document.body.classList.remove('print-ready');
          });
        });

        return { store, nav: NAV, current, viewComp, go, toggleTheme, openHelp, openGuide, restartTour };
      }
    };

    const app = createApp(root);
    // Element Plus 默认是英文，这里统一切到简体中文（分页、下拉框、表格空态等）
    if (window.ElementPlusLocaleZhCn) app.use(ElementPlus, { locale: window.ElementPlusLocaleZhCn });
    else app.use(ElementPlus);
    // 全局注册，保证任意页面模板里都能直接使用其他组件（如 doc-view）
    Object.keys(components).forEach(function (name) {
      app.component(name, components[name]);
    });
    if (window.ElementPlusIconsVue) {
      Object.keys(window.ElementPlusIconsVue).forEach(function (name) {
        app.component(name, window.ElementPlusIconsVue[name]);
      });
    }
    app.config.errorHandler = function (err) {
      console.error('[界面错误]', err);
      try { ElementPlus.ElMessage.error('界面出错了：' + (err && err.message ? err.message : '')); } catch (e) {}
    };
    app.mount('#app');
  })();
})();
