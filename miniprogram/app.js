const config = require('./config');

App({
  globalData: {
    user: null,   // { _id, nickname, avatar, bookId }
    book: null,   // 情侣本
    records: []   // 全部记录
  },

  onLaunch() {
    if (!wx.cloud) {
      wx.showModal({ title: '提示', content: '微信版本过低，请升级微信', showCancel: false });
      return;
    }
    wx.cloud.init({ env: config.CLOUD_ENV, traceUser: true });
  }
});
