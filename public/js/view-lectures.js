window.ViewLectures = {
  setup() {
    const { computed } = Vue;
    const { ElMessage, ElMessageBox } = ElementPlus;
    const store = TK.store;

    const sorted = computed(() => (store.lectures || []).slice().sort((a, b) => b.updatedAt - a.updatedAt));

    function go() { store.view = 'lecture'; }

    async function open(l) {
      try {
        const full = await TK.api('/api/lectures/' + l.id);
        store.editingLecture = full;
        store.view = 'lecture';
      } catch (e) {
        ElMessage.error(e.message);
      }
    }

    async function duplicate(l) {
      try {
        const full = await TK.api('/api/lectures/' + l.id);
        const copy = JSON.parse(JSON.stringify(full));
        delete copy.id;
        copy.title = full.title + '（副本）';
        await TK.api('/api/lectures/save', { method: 'POST', body: copy });
        const bs = await TK.api('/api/bootstrap');
        store.lectures = bs.lectures;
        ElMessage.success('已复制');
      } catch (e) {
        ElMessage.error(e.message);
      }
    }

    async function remove(l) {
      try {
        await ElMessageBox.confirm('删除后无法恢复，确定删除「' + l.title + '」吗？', '删除讲义', {
          confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning'
        });
        await TK.api('/api/lectures/' + l.id, { method: 'DELETE' });
        store.lectures = store.lectures.filter((x) => x.id !== l.id);
        store.stats = Object.assign({}, store.stats, { lectureCount: store.lectures.length });
        ElMessage.success('已删除');
      } catch (e) {
        if (e !== 'cancel' && e && e.message) ElMessage.error(e.message);
      }
    }

    return { store, sorted, go, open, duplicate, remove, fmtDate: TK.fmtDate };
  }
};
