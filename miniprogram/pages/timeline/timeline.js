const api = require('../../utils/api');
const util = require('../../utils/util');

const MOODS = { sweet: '🥰', happy: '😄', calm: '🙂', sad: '🥺', angry: '😤' };

Page({
  data: { groups: [], total: 0 },

  onShow() { this.refresh(); },
  onPullDownRefresh() { this.refresh().then(() => wx.stopPullDownRefresh()); },

  async refresh() {
    try {
      const rd = await api.call('records', { action: 'list' });
      getApp().globalData.records = rd.records;
      this.render();
    } catch (err) {
      api.toastErr(err);
    }
  },

  render() {
    const records = getApp().globalData.records || [];
    const map = {};
    const order = [];
    records.forEach((r) => {
      if (!map[r.date]) {
        map[r.date] = { date: r.date, label: util.fmtDate(r.date), rel: util.relativeDay(r.date), items: [] };
        order.push(r.date);
      }
      map[r.date].items.push({
        _id: r._id,
        title: r.title || '',
        note: r.note || '',
        place: r.place || '',
        mood: MOODS[r.mood] || '🥰',
        authorName: r.authorName || '',
        thumbs: (r.images || []).slice(0, 3).map((i) => i.fileId),
        more: Math.max(0, (r.images || []).length - 3),
        imageCount: (r.images || []).length
      });
    });

    /* 换取所有缩略图临时链接 */
    const allIds = [];
    records.forEach((r) => (r.images || []).forEach((i) => i.fileId && allIds.push(i.fileId)));
    if (allIds.length) {
      wx.cloud.getTempFileURL({
        fileList: allIds.slice(0, 50),
        complete: (res) => {
          const map2 = {};
          (res.fileList || []).forEach((f) => { if (f.fileID && f.tempFileURL) map2[f.fileID] = f.tempFileURL; });
          const groups = this.data.groups.map((g) => ({
            ...g,
            items: g.items.map((it) => ({ ...it, thumbs: it.thumbs.map((t) => map2[t] || t) }))
          }));
          this.setData({ groups: groups });
        }
      });
    }

    this.setData({
      groups: order.map((d) => map[d]),
      total: records.length
    });
  },

  preview(e) {
    const { g, i, t } = e.currentTarget.dataset;
    const group = this.data.groups[g];
    const rec = group.items[i];
    const full = (getApp().globalData.records.filter((r) => r._id === rec._id)[0] || { images: [] }).images.map((x) => x.fileId);
    /* 先用已知缩略图打开，完整大图随后通过云链接预览 */
    const urls = rec.thumbs.filter((x) => x.indexOf('http') === 0);
    if (urls.length) wx.previewImage({ current: urls[t] || urls[0], urls: urls });
    else if (full.length) {
      wx.cloud.getTempFileURL({
        fileList: full,
        complete: (res) => {
          const u2 = (res.fileList || []).map((f) => f.tempFileURL).filter(Boolean);
          if (u2.length) wx.previewImage({ urls: u2 });
        }
      });
    }
  },

  edit(e) {
    wx.navigateTo({ url: '/pages/compose/compose?id=' + e.currentTarget.dataset.id });
  },

  remove(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除这条记录？',
      content: '照片也会一起删除，不可恢复',
      confirmText: '删除',
      confirmColor: '#ff6b9d',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.call('records', { action: 'remove', id: id });
          const app = getApp();
          app.globalData.records = app.globalData.records.filter((r) => r._id !== id);
          wx.showToast({ title: '已删除', icon: 'none' });
          this.render();
        } catch (err) {
          api.toastErr(err);
        }
      }
    });
  }
});
