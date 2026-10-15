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

  onLoad(options) {
    /* 从分享卡片或小程序码进来：自动切到加入模式并填好码 */
    let code = options && options.code;
    if (!code && options && options.scene) {
      const scene = decodeURIComponent(options.scene);
      const m = scene.match(/c=([A-Za-z0-9]{4,12})/);
      if (m) code = m[1];
    }
    if (code) {
      this.setData({ mode: 'join', code: String(code).toUpperCase() });
    }
  },

  switchMode(e) {
    this.setData({ mode: e.currentTarget.dataset.mode });
  },

  onMyName(e) { this.setData({ myName: e.detail.value }); },
  onPartnerName(e) { this.setData({ partnerName: e.detail.value }); },
  onDate(e) { this.setData({ anniversary: e.detail.value }); },
  onCode(e) { this.setData({ code: e.detail.value.toUpperCase() }); },

  /* 扫一扫：扫 TA 的小程序码 / 二维码 */
  scan() {
    wx.scanCode({
      success: (res) => {
        const text = decodeURIComponent(res.result || res.path || '');
        const m = text.match(/c=([A-Za-z0-9]{4,12})/i) || text.match(/code=([A-Za-z0-9]{4,12})/i) || text.match(/^([A-Z0-9]{6})$/i);
        if (m) {
          this.setData({ mode: 'join', code: m[1].toUpperCase() });
          wx.showToast({ title: '已识别邀请码', icon: 'none' });
        } else {
          wx.showToast({ title: '没认出邀请码，手动输入吧', icon: 'none' });
        }
      }
    });
  },

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
  }
});
