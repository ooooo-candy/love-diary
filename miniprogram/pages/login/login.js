const api = require('../../utils/api');

/* 旧版数据迁移配置（迁移完成后可移除） */
const MIGRATE = {
  base: 'https://kq620lm-d8gabmn69c500f017-1503834579.ap-shanghai.app.tcloudbase.com/api',
  secret: 'cm-mig-7xk2q9zr4t'
};

Page({
  data: {
    loading: true,
    error: '',
    showBooks: false,
    oldBooks: [],
    pickedIndex: -1,
    migrating: false,
    progress: ''
  },

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

      /* 首次进入：列出旧本子让人选，然后自动搬运 */
      if (!wx.getStorageSync('migrated')) {
        let books = [];
        try {
          const list = await api.call('migrate', { action: 'list', secret: MIGRATE.secret, oldBase: MIGRATE.base });
          books = (list.books || []).filter((b) => b.count > 0);
        } catch (err) {
          console.error('migrate list failed', err);
        }
        if (books.length === 1) {
          await this.startMigration(books[0].index);
          data = await api.call('user', { action: 'login' });
          app.globalData.user = data.user;
        } else if (books.length > 1) {
          this.setData({ loading: false, showBooks: true, oldBooks: books });
          return;
        } else {
          wx.setStorageSync('migrated', true);
        }
      }

      this.enter(data);
    } catch (err) {
      this.setData({ loading: false, error: err.message || '登录失败，请重试' });
    }
  },

  pickBook(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const chosen = this.data.oldBooks.filter((b) => b.index === idx)[0];
    if (!chosen) return;
    this.setData({ pickedIndex: idx, showBooks: false, loading: true });
    this.startMigration(idx)
      .then(async () => {
        const data = await api.call('user', { action: 'login' });
        getApp().globalData.user = data.user;
        this.enter(data);
      })
      .catch((err) => {
        this.setData({ loading: false, error: '导入失败：' + (err.message || '未知错误') });
      });
  },

  skipMigration() {
    wx.setStorageSync('migrated', true);
    api
      .call('user', { action: 'login' })
      .then((data) => {
        getApp().globalData.user = data.user;
        this.enter(data);
      });
  },

  enter(data) {
    if (data.user.bookId) {
      wx.switchTab({ url: '/pages/home/home' });
    } else {
      wx.reLaunch({ url: '/pages/onboard/onboard' });
    }
  },

  async startMigration(bookIndex) {
    this.setData({ migrating: true, progress: '正在连接旧版本…' });
    try {
      wx.showLoading({ title: '正在导入旧数据…', mask: true });
      const init = await api.call('migrate', {
        action: 'init',
        secret: MIGRATE.secret,
        oldBase: MIGRATE.base,
        bookIndex: bookIndex
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
        wx.showLoading({ title: '导入照片 ' + Math.min(start, init.total) + '/' + init.total, mask: true });
      }
      await api
        .call('migrate', { action: 'finish', secret: MIGRATE.secret, dumpFileID: init.dumpFileID })
        .catch(() => {});
      wx.setStorageSync('migrated', true);
      wx.hideLoading();
      this.setData({ migrating: false });
      wx.showToast({ title: '旧数据已导入 ❤', icon: 'none', duration: 2000 });
    } catch (err) {
      this.setData({ migrating: false });
      wx.hideLoading();
      throw err;
    }
  }
});
