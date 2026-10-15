const api = require('../../utils/api');

/* 旧版数据迁移配置（迁移完成后可移除） */
const MIGRATE = {
  base: 'https://kq620lm-d8gabmn69c500f017-1503834579.ap-shanghai.app.tcloudbaseapp.com/api',
  secret: 'cm-mig-7xk2q9zr4t'
};

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
        this.handleLogin();
      },
      fail: () => {
        this.setData({ loading: false, error: '微信登录失败，请重试' });
      }
    });
  },

  async handleLogin() {
    const app = getApp();
    try {
      let data = await api.call('user', { action: 'login' });
      app.globalData.user = data.user;

      /* 首次进入：自动把旧版网页里的记录和照片搬进来 */
      if (!wx.getStorageSync('migrated')) {
        await this.runMigration();
        data = await api.call('user', { action: 'login' });
        app.globalData.user = data.user;
      }

      if (data.user.bookId) {
        wx.switchTab({ url: '/pages/home/home' });
      } else {
        wx.reLaunch({ url: '/pages/onboard/onboard' });
      }
    } catch (err) {
      this.setData({ loading: false, error: err.message || '登录失败，请重试' });
    }
  },

  async runMigration() {
    try {
      wx.showLoading({ title: '正在导入旧数据…', mask: true });
      const init = await api.call('migrate', {
        action: 'init',
        secret: MIGRATE.secret,
        oldBase: MIGRATE.base
      });
      if (!init.total) {
        wx.setStorageSync('migrated', true);
        wx.hideLoading();
        return;
      }
      let start = 0;
      for (let guard = 0; guard < 500 && start < init.total; guard++) {
        const r = await api.call('migrate', {
          action: 'batch',
          secret: MIGRATE.secret,
          oldBase: MIGRATE.base,
          bookId: init.bookId,
          dumpFileID: init.dumpFileID,
          start: start,
          count: 4
        });
        if (!r.processed) break;
        start += r.processed;
        wx.showLoading({ title: '导入旧数据 ' + Math.min(start, init.total) + '/' + init.total, mask: true });
      }
      await api
        .call('migrate', { action: 'finish', secret: MIGRATE.secret, dumpFileID: init.dumpFileID })
        .catch(() => {});
      wx.setStorageSync('migrated', true);
      wx.hideLoading();
      wx.showToast({ title: '旧数据已导入 ❤', icon: 'none', duration: 2000 });
    } catch (err) {
      wx.hideLoading();
      /* 失败不打断登录，下次进入自动重试 */
      console.error('migrate failed', err);
    }
  }
});
