const api = require('../../utils/api');
const util = require('../../utils/util');

Page({
  data: {
    mode: 'create', // create | join
    myName: '',
    partnerName: '',
    anniversary: util.todayStr(),
    code: '',
    busy: false
  },

  switchMode(e) {
    this.setData({ mode: e.currentTarget.dataset.mode });
  },

  onMyName(e) { this.setData({ myName: e.detail.value }); },
  onPartnerName(e) { this.setData({ partnerName: e.detail.value }); },
  onDate(e) { this.setData({ anniversary: e.detail.value }); },
  onCode(e) { this.setData({ code: e.detail.value.toUpperCase() }); },

  async submit() {
    if (this.data.busy) return;
    const app = getApp();
    const d = this.data;

    if (d.mode === 'create') {
      if (!d.myName.trim()) return wx.showToast({ title: '先填你的昵称哦', icon: 'none' });
      this.setData({ busy: true });
      try {
        const data = await api.call('book', {
          action: 'create',
          myName: d.myName,
          partnerName: d.partnerName,
          nickname: d.myName,
          anniversary: d.anniversary
        });
        app.globalData.book = data.book;
        if (data.user) app.globalData.user = data.user;
        wx.showToast({ title: '创建成功 ❤', icon: 'none' });
        setTimeout(() => wx.switchTab({ url: '/pages/home/home' }), 500);
      } catch (err) {
        api.toastErr(err);
        this.setData({ busy: false });
      }
      return;
    }

    /* 加入 */
    if (!/^[A-Z0-9]{6}$/.test(d.code)) return wx.showToast({ title: '请输入 6 位邀请码', icon: 'none' });
    this.setData({ busy: true });
    try {
      const data = await api.call('book', { action: 'join', code: d.code });
      app.globalData.book = data.book;
      if (data.user) app.globalData.user = data.user;
      wx.showToast({ title: '加入成功 ❤', icon: 'none' });
      setTimeout(() => wx.switchTab({ url: '/pages/home/home' }), 500);
    } catch (err) {
      api.toastErr(err);
      this.setData({ busy: false });
    }
  },

  copyCode() { /* 占位：创建后由 home 展示邀请码 */ }
});
