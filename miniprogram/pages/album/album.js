const api = require('../../utils/api');

Page({
  data: { shots: [], count: 0, recCount: 0 },

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
    const fileIds = [];
    const byId = {};
    records.forEach((r) => {
      (r.images || []).forEach((i) => {
        if (i.fileId) {
          fileIds.push(i.fileId);
          byId[i.fileId] = r._id;
        }
      });
    });
    if (!fileIds.length) {
      this.setData({ shots: [], count: 0, recCount: 0 });
      return;
    }
    wx.cloud.getTempFileURL({
      fileList: fileIds,
      complete: (res) => {
        const shots = [];
        (res.fileList || []).forEach((f) => {
          if (f.tempFileURL) shots.push({ fileId: f.fileID, url: f.tempFileURL, recId: byId[f.fileID] });
        });
        this.setData({
          shots: shots,
          count: shots.length,
          recCount: new Set(shots.map((s) => s.recId)).size
        });
      }
    });
  },

  preview(e) {
    const i = Number(e.currentTarget.dataset.i);
    const urls = this.data.shots.map((s) => s.url);
    wx.previewImage({ current: urls[i], urls: urls });
  }
});
