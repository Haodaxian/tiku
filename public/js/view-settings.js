window.ViewSettings = {
  setup() {
    const { ref, computed } = Vue;
    const { ElMessage, ElMessageBox } = ElementPlus;
    const store = TK.store;

    const apiKey = ref('');
    const school = ref(store.settings.school || '');
    const teacher = ref(store.settings.teacher || '');
    const density = ref(store.settings.lectureDensity || 'single');
    const defaultSubject = ref(store.settings.lastSubject || '');
    const defaultGrade = ref(store.settings.lastGrade || '');
    const SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理', '科学', '其他'];
    const GRADES = ['七年级', '八年级', '九年级', '高一', '高二', '高三', '小学三年级', '小学四年级', '小学五年级', '小学六年级', '通用'];
    const saving = ref(false);
    const saved = ref(false);
    const testing = ref(false);
    const testResult = ref('');
    const testOk = ref(false);
    const backing = ref(false);
    const importVisible = ref(false);

    // 模型已内置固定，界面只做说明展示，不提供切换
    const visionInfo = computed(() => {
      const m = (store.settings.models || {})[store.settings.visionModel] || {};
      return {
        name: m.name || 'Step-1o Turbo Vision',
        note: m.note || '专用识图模型，响应快，单张试卷照片通常 3～8 秒'
      };
    });
    const textInfo = computed(() => {
      const m = (store.settings.models || {})[store.settings.textModel] || {};
      return {
        name: m.name || 'Step-3.5 Flash',
        note: m.note || '文本处理最快、单价最低，一份讲义成本不到 3 分钱'
      };
    });

    async function save() {
      saving.value = true;
      saved.value = false;
      try {
        const body = { lectureDensity: density.value };
        if (apiKey.value.trim()) body.apiKey = apiKey.value.trim();
        const r = await TK.api('/api/settings', { method: 'POST', body });
        store.settings = Object.assign({}, store.settings, r);
        apiKey.value = '';
        saved.value = true;
        ElMessage.success('已保存');
      } catch (e) {
        ElMessage.error(e.message);
      } finally {
        saving.value = false;
      }
    }

    async function saveAndTest() {
      await save();
      testing.value = true;
      testResult.value = '';
      try {
        const r = await TK.api('/api/test-key', { method: 'POST', body: {} });
        testResult.value = r.message;
        testOk.value = true;
      } catch (e) {
        testResult.value = e.message;
        testOk.value = false;
      } finally {
        testing.value = false;
      }
    }

    async function saveProfile() {
      saving.value = true;
      try {
        const r = await TK.api('/api/settings', {
          method: 'POST',
          body: {
            school: school.value, teacher: teacher.value, lectureDensity: density.value,
            lastSubject: defaultSubject.value, lastGrade: defaultGrade.value
          }
        });
        store.settings = Object.assign({}, store.settings, r);
        ElMessage.success('已保存');
      } catch (e) {
        ElMessage.error(e.message);
      } finally {
        saving.value = false;
      }
    }

    /** 数据实际在哪个文件夹：找数据时用得上 */
    const dataDir = ref(store.settings.dataDir || '');
    const canOpenFolder = !!(window.tikuElectron && window.tikuElectron.isDesktop);

    /** 打开总览指南 */
    function openGuide() {
      if (window.TKGuide) window.TKGuide.openOverview();
    }

    /** 重看新手引导 */
    function restartTour() {
      if (!window.TKGuide) return;
      window.TKGuide.start((window.TKGuideData && window.TKGuideData.tour) || [], {
        key: 'tiku-tour', force: true
      });
    }

    async function openDataDir() {
      if (!canOpenFolder) return;
      try {
        await window.tikuElectron.openDataDir();
      } catch (e) {
        ElMessage.error('打不开文件夹：' + (e && e.message ? e.message : '未知原因'));
      }
    }

    /** 清除已保存的 API Key：换机器、或者不想在本机留 Key 时用 */
    async function clearKey() {
      try {
        await ElMessageBox.confirm('清除后需要重新填写才能继续使用模型功能，确定清除吗？', '清除 API Key', {
          confirmButtonText: '清除', cancelButtonText: '取消', type: 'warning'
        });
        const r = await TK.api('/api/settings', { method: 'POST', body: { clearKey: true } });
        store.settings = Object.assign({}, store.settings, r);
        apiKey.value = '';
        ElMessage.success('已清除');
      } catch (e) {
        if (e !== 'cancel' && e && e.message) ElMessage.error(e.message);
      }
    }

    async function backup() {
      backing.value = true;
      try {
        await TK.api('/api/backup', { method: 'POST' });
        ElMessage.success('已备份到 data/backup 目录');
      } catch (e) {
        ElMessage.error(e.message);
      } finally {
        backing.value = false;
      }
    }

    async function exportAll() {
      try {
        const data = await TK.api('/api/export/all');
        TK.download('题库备份-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(data, null, 2));
      } catch (e) {
        ElMessage.error(e.message);
      }
    }

    async function doRestore(e) {
      const file = (e.target.files || [])[0];
      if (!file) return;
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        await ElMessageBox.confirm('恢复后当前题库和讲义会被替换，确定继续吗？', '从备份恢复', {
          confirmButtonText: '恢复', cancelButtonText: '取消', type: 'warning'
        });
        const r = await TK.api('/api/import/all', { method: 'POST', body: json });
        const bs = await TK.api('/api/bootstrap');
        store.questions = bs.questions;
        store.lectures = bs.lectures;
        store.folders = bs.folders;
        store.stats = bs.stats;
        importVisible.value = false;
        ElMessage.success('已恢复 ' + r.questions + ' 道题、' + r.lectures + ' 份讲义');
      } catch (err) {
        if (err !== 'cancel' && err && err.message) ElMessage.error(err.message);
      }
    }

    return {
      store, apiKey, school, teacher, density, visionInfo, textInfo,
      defaultSubject, defaultGrade, SUBJECTS, GRADES,
      saving, saved, testing, testResult, testOk, backing, importVisible,
      save, saveAndTest, saveProfile, clearKey, backup, exportAll, doRestore,
      dataDir, canOpenFolder, openDataDir, openGuide, restartTour
    };
  }
};
