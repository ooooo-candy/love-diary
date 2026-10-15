const api = require('../../utils/api');
const migrate = require('../../utils/migrate');

Page({
  data: {
    loading: true,
    error: '',
    showBooks: false,
    oldBooks: []
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
    /* 迁移流程升级过，重置旧版本错误写入的"已迁移"标记 */
    if (wx.getStorageSync('migVer') !== 'v2') {
      wx.removeStorageSync('migrated');
      wx.setStorageSync('migVer', 'v2');
    }
    try {
      let data = await api.call('user', { action: 'login' });
      app.globalData.user = data.user;

      /* 首次进入：列出旧本子让人选，然后自动搬运 */
      if (!wx.getStorageSync('migrated')) {
        let books = [];
        let listErr = '';
        try {
          books = await migrate.listBooks();
        } catch (err) {
          listErr = err.message || '连接旧版本失败';
        }
        if (listErr) {
          /* 失败必须可见：让用户选重试或跳过 */
          this.setData({ loading: false });
          wx.showModal({
            title: '旧数据导入失败',
            content: listErr + '。重试吗？（也可以先进入，稍后在小程序里再导）',
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
        if (books.length === 1) {
          await migrate.run(books[0].index);
          data = await api.call('user', { action: 'login' });
          app.globalData.user = data.user;
          this.enter(data);
          return;
        }
        if (books.length > 1) {
          this.setData({ loading: false, showBooks: true, oldBooks: books });
          return;
        }
        wx.setStorageSync('migrated', true);
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
    this.setData({ loading: true, showBooks: false });
    migrate
      .run(idx)
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
  }
});
