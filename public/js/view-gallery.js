window.ViewGallery = {
  setup() {
    const { ref, computed } = Vue;
    const { ElMessage, ElMessageBox } = ElementPlus;
    const store = TK.store;

    const keyword = ref('');
    const uploading = ref(false);
    const fileInput = ref(null);
    const preview = ref('');
    const editVisible = ref(false);
    const editItem = ref(null);
    const editLabel = ref('');
    const editTags = ref('');

    const filtered = computed(() => {
      const kw = keyword.value.trim().toLowerCase();
      const list = store.gallery || [];
      if (!kw) return list;
      return list.filter((g) => (g.label + ' ' + (g.tags || []).join(' ')).toLowerCase().indexOf(kw) >= 0);
    });

    const tagOptions = computed(() => {
      const set = new Set();
      (store.gallery || []).forEach((g) => (g.tags || []).forEach((t) => set.add(t)));
      return Array.from(set);
    });

    async function onFiles(e) {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (!files.length) return;
      uploading.value = true;
      let ok = 0;
      try {
        for (const f of files) {
          if (!/^image\//.test(f.type)) continue;
          const dataUrl = await TK.downscaleImage(f, 1400);
          const item = await TK.api('/api/gallery', {
            method: 'POST',
            body: { dataUrl, label: f.name.replace(/\.[^.]+$/, '').slice(0, 40) }
          });
          store.gallery.unshift(item);
          ok += 1;
        }
        if (ok) ElMessage.success('已加入图库 ' + ok + ' 张');
      } catch (err) {
        ElMessage.error(err.message);
      } finally {
        uploading.value = false;
      }
    }

    /** 把题里已有的图形收进图库，省得再传一次 */
    async function collectFromBank() {
      const seen = new Set((store.gallery || []).map((g) => g.url));
      const items = [];
      for (const q of store.questions || []) {
        for (const f of q.figures || []) {
          const url = TK.figSrc(f);
          if (!url || seen.has(url)) continue;
          seen.add(url);
          items.push({ url, label: f.label || (q.type || '图形'), tags: (q.knowledge || []).slice(0, 3) });
        }
      }
      if (!items.length) { ElMessage.info('题库里的图形都已经在图库中了'); return; }
      try {
        for (const it of items) {
          const saved = await TK.api('/api/gallery', { method: 'POST', body: it });
          store.gallery.unshift(saved);
        }
        ElMessage.success('已收藏 ' + items.length + ' 张题库图形');
      } catch (e) {
        ElMessage.error(e.message);
      }
    }

    function openEdit(g) {
      editItem.value = g;
      editLabel.value = g.label || '';
      editTags.value = (g.tags || []).join(',');
      editVisible.value = true;
    }

    async function saveEdit() {
      if (!editItem.value) return;
      try {
        const tags = editTags.value.split(/[,，\s]+/).filter(Boolean);
        const r = await TK.api('/api/gallery/' + editItem.value.id, {
          method: 'PUT',
          body: { url: editItem.value.url, label: editLabel.value, tags }
        });
        const i = store.gallery.findIndex((x) => x.id === r.id);
        if (i >= 0) store.gallery[i] = r;
        editVisible.value = false;
        ElMessage.success('已保存');
      } catch (e) {
        ElMessage.error(e.message);
      }
    }

    async function remove(g) {
      try {
        await ElMessageBox.confirm('只从图库移除，已经用到题目里的图不受影响。', '移除图片', {
          confirmButtonText: '移除', cancelButtonText: '取消', type: 'warning'
        });
        await TK.api('/api/gallery/' + g.id, { method: 'DELETE' });
        store.gallery = store.gallery.filter((x) => x.id !== g.id);
        ElMessage.success('已移除');
      } catch (e) {
        if (e !== 'cancel' && e && e.message) ElMessage.error(e.message);
      }
    }

    return {
      store, keyword, uploading, fileInput, preview, filtered, tagOptions,
      editVisible, editItem, editLabel, editTags,
      onFiles, collectFromBank, openEdit, saveEdit, remove,
      figSrc: TK.figSrc
    };
  }
};
