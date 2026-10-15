const api = require('../../utils/api');
const util = require('../../utils/util');

Page({
  data: {
    book: null,
    user: null,
    days: 0,
    recCount: 0,
    photoCount: 0,
    partnerJoined: false,
    partnerInfo: null,
    code: '',
    /* 迁移状态 */
    needMigrate: false,
    migrated: false,
    /* 小程序码 */
    qrFileId: '',
    /* 编辑资料弹层 */
    showEdit: false,
    myName: '',
    partnerName: '',
    anniversary: '',
    busy: false
  },

  onShow() { this.refresh(); },
  onPullDownRefresh() { this.refresh().then(() => wx.stopPullDownRefresh()); },

  async refresh() {
    const app = getApp();
    try {
      const data = await api.call('book', { action: 'get' });
      app.globalData.book = data.book;
      const records = app.globalData.records || [];
      if (!records.length) {
        const rd = await api.call('records', { action: 'list' });
        app.globalData.records = rd.records;
      }
      this.render();
    } catch (err) {
      api.toastErr(err);
    }
  },

  render() {
    const app = getApp();
    const book = app.globalData.book || {};
    const records = app.globalData.records || [];
    const user = app.globalData.user || {};
    const photoCount = records.reduce((n, r) => n + (r.images || []).length, 0);
    this.setData({
      book: book,
      user: user,
      days: util.loveDays(book.anniversary),
      recCount: records.length,
      photoCount: photoCount,
      partnerJoined: !!book.partnerJoined,
      partnerInfo: book.partnerInfo || null,
      code: book.code || '',
      migrated: !!wx.getStorageSync('migrated'),
      needMigrate: records.length === 0 && !wx.getStorageSync('migrated')
    });
  },

  copyCode() {
    wx.setClipboardData({ data: this.data.code });
  },

  /* 重试导入旧数据 */
  retryMigrate() {
    wx.removeStorageSync('migrated');
    wx.reLaunch({ url: '/pages/login/login' });
  },

  /* 分享卡片邀请 TA */
  onShareAppMessage() {
    return {
      title: '来和我一起记录我们的日子 ❤',
      path: '/pages/onboard/onboard?code=' + this.data.code
    };
  },

  /* 生成小程序码 */
  async showQrcode() {
    if (!this.data.code) return;
    wx.showLoading({ title: '生成中…', mask: true });
    try {
      if (!this.data.qrFileId) {
        const r = await api.call('book', { action: 'getQrcode', code: this.data.code });
        this.setData({ qrFileId: r.fileId });
      }
      wx.cloud.getTempFileURL({
        fileList: [this.data.qrFileId],
        complete: (res) => {
          wx.hideLoading();
          const url = res.fileList && res.fileList[0] && res.fileList[0].tempFileURL;
          if (url) this.setData({ qrUrl: url, showQr: true });
          else wx.showToast({ title: '生成失败，试试分享卡片', icon: 'none' });
        }
      });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '生成失败，试试分享卡片', icon: 'none' });
    }
  },
  closeQr() { this.setData({ showQr: false }); },

  saveQr() {
    if (!this.data.qrFileId) return;
    wx.showLoading({ title: '保存中…', mask: true });
    wx.cloud.downloadFile({
      fileID: this.data.qrFileId,
      success: (res) => {
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success: () => { wx.hideLoading(); wx.showToast({ title: '已存到相册', icon: 'none' }); },
          fail: () => { wx.hideLoading(); wx.showToast({ title: '没保存成功（需要相册权限）', icon: 'none' }); }
        });
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '下载失败', icon: 'none' }); }
    });
  },

  openEdit() {
    const b = this.data.book || {};
    this.setData({
      showEdit: true,
      myName: this.data.user.nickname || b.myName || '',
      partnerName: b.partnerName || '',
      anniversary: b.anniversary || util.todayStr()
    });
  },
  closeEdit() { this.setData({ showEdit: false }); },
  onMyName(e) { this.setData({ myName: e.detail.value }); },
  onPartnerName(e) { this.setData({ partnerName: e.detail.value }); },
  onDate(e) { this.setData({ anniversary: e.detail.value }); },

  async changeAvatar() {
    wx.showLoading({ title: '上传中…', mask: true });
    try {
      const choose = await new Promise((resolve, reject) => {
        wx.chooseMedia({
          count: 1,
          mediaType: ['image'],
          sourceType: ['album', 'camera'],
          sizeType: ['compressed'],
          success: resolve,
          fail: reject
        });
      });
      const tempPath = choose.tempFiles[0].tempFilePath;
      const app = getApp();
      const res = await new Promise((resolve, reject) => {
        wx.cloud.uploadFile({
          cloudPath: 'avatars/' + app.globalData.user._id + '/' + Date.now() + '.jpg',
          filePath: tempPath,
          success: resolve,
          fail: reject
        });
      });
      const up = await api.call('user', { action: 'updateProfile', avatar: res.fileID });
      app.globalData.user = up.user;
      await api.call('book', { action: 'update', myAvatar: res.fileID });
      wx.hideLoading();
      wx.showToast({ title: '头像已更新', icon: 'none' });
      this.refresh();
    } catch (err) {
      wx.hideLoading();
      if (err && err.errMsg && err.errMsg.indexOf('cancel') >= 0) return;
      api.toastErr(err);
    }
  },

  async saveEdit() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const data = await api.call('book', {
        action: 'update',
        myName: this.data.myName,
        partnerName: this.data.partnerName,
        anniversary: this.data.anniversary
      });
      getApp().globalData.book = data.book;
      if (this.data.myName) {
        const up = await api.call('user', { action: 'updateProfile', nickname: this.data.myName });
        getApp().globalData.user = up.user;
      }
      wx.showToast({ title: '资料已更新', icon: 'none' });
      this.setData({ showEdit: false, busy: false });
      this.render();
    } catch (err) {
      api.toastErr(err);
      this.setData({ busy: false });
    }
  }
});
