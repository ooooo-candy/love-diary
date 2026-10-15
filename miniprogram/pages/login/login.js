const api = require('../../utils/api');
const migrate = require('../../utils/migrate');

Page({
  data: { loading: true, error: '' },

  onShow() {
    this.doLogin();
  },

  doLogin() {
    wx.login({
      success: () => this.handleLogin(),
      fail: () => this.setData({ loading: false, error: '微信登录失败，请重试' })
    });
  },

  async handleLogin() {
    const app = getApp();
    this.setData({ loading: true, error: '' });
    try {
      let data = await api.call('user', { action: 'login' });
      app.globalData.user = data.user;

      /* 首次进入：一键从旧版 App 还原全部数据 */
      if (!wx.getStorageSync('migrated')) {
        let done = false;
        try {
          await migrate.fullFlow();
          done = true;
        } catch (err) {
          if (err && err.message === 'cancel') {
            wx.setStorageSync('migrated', true);
          } else {
            this.setData({ loading: false });
            wx.showModal({
              title: '旧数据导入失败',
              content: (err && err.message ? err.message : '未知错误') + '。重试吗？',
              confirmText: '重试',
              cancelText: '先进入',
              confirmColor: '#ff6b9d',
              success: (res) => {
                if (res.confirm) this.handleLogin();
                else this.enter(data);
              }
            });
            return;
          }
        }
        if (done) {
          data = await api.call('user', { action: 'login' });
          app.globalData.user = data.user;
        }
      }

      this.enter(data);
    } catch (err) {
      this.setData({ loading: false, error: err.message || '登录失败，请重试' });
    }
  },

  enter(data) {
    if (data.user.bookId) {
      wx.switchTab({ url: '/pages/home/home' });
    } else {
      wx.reLaunch({ url: '/pages/onboard/onboard' });
    }
  }
});
