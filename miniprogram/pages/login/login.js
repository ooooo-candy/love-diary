const api = require('../../utils/api');

Page({
  data: { loading: true, error: '' },

  onShow() {
    this.doLogin();
  },

  doLogin() {
    const app = getApp();
    this.setData({ loading: true, error: '' });
    wx.login({
      success: (res) => {
        api
          .call('user', { action: 'login', code: res.code })
          .then((data) => {
            app.globalData.user = data.user;
            if (data.user.bookId) {
              wx.switchTab({ url: '/pages/home/home' });
            } else {
              wx.reLaunch({ url: '/pages/onboard/onboard' });
            }
          })
          .catch((err) => {
            this.setData({ loading: false, error: err.message });
          });
      },
      fail: () => {
        this.setData({ loading: false, error: '微信登录失败，请重试' });
      }
    });
  }
});
