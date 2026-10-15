const api = require('../../utils/api');
const util = require('../../utils/util');

const MOODS = { sweet: '🥰', happy: '😄', calm: '🙂', sad: '🥺', angry: '😤' };

Page({
  data: {
    book: null,
    days: 0,
    todayStr: '',
    hasToday: false,
    latest: [],
    code: '',
    partnerJoined: false,
    /* 想你 */
    myMiss: 0,
    partnerMiss: 0,
    /* 每日一问 */
    daily: null,
    dailyMine: '',
    dailyPartner: '',
    dailyAnswered: false,
    /* 心愿 */
    wishTotal: 0,
    wishDone: 0,
    wishPct: 0
  },

  onShow() {
    this.refresh();
    this.startMissPoll();
  },
  onHide() { this.stopMissPoll(); },
  onUnload() { this.stopMissPoll(); },

  onPullDownRefresh() {
    this.refresh().then(() => wx.stopPullDownRefresh());
  },

  async refresh() {
    const app = getApp();
    try {
      const data = await api.call('book', { action: 'get' });
      app.globalData.book = data.book;
      const rd = await api.call('records', { action: 'list' });
      app.globalData.records = rd.records;
      this.render();
    } catch (err) {
      api.toastErr(err);
    }
  },

  render() {
    const app = getApp();
    const book = app.globalData.book || {};
    const records = app.globalData.records || [];
    const myId = (app.globalData.user && app.globalData.user._id) || '';
    const today = util.todayStr();
    const latest = records.slice(0, 3).map((r) => ({
      _id: r._id,
      date: r.date,
      dateShort: util.fmtDateShort(r.date),
      rel: util.relativeDay(r.date),
      title: r.title || '（无标题）',
      note: (r.note || '').slice(0, 60),
      mood: MOODS[r.mood] || '🥰',
      cover: (r.images && r.images[0] && r.images[0].fileId) || ''
    }));

    const daily = book.daily || null;
    const dailyMine = daily && daily.answers ? daily.answers[myId] || '' : '';
    const dailyPartner = daily && daily.answers ? daily.answers[book.partnerId] || '' : '';
    const wishes = book.wishes || [];
    const wishDone = wishes.filter((w) => w.done).length;

    this.setData({
      book: book,
      days: util.loveDays(book.anniversary),
      todayStr: today,
      hasToday: records.some((r) => r.date === today),
      latest: latest,
      code: book.code || '',
      partnerJoined: !!book.partnerJoined,
      myMiss: (book.miss && book.miss.myCount) || 0,
      partnerMiss: (book.miss && book.miss.partnerCount) || 0,
      daily: daily,
      dailyMine: dailyMine,
      dailyPartner: dailyPartner,
      dailyAnswered: !!dailyMine,
      wishTotal: wishes.length,
      wishDone: wishDone,
      wishPct: wishes.length ? Math.round((wishDone / wishes.length) * 100) : 0
    });
  },

  /* ---------- 悄悄话·想你 ---------- */

  async sendMiss() {
    try {
      const r = await api.call('book', { action: 'sendMiss' });
      if (r.eventTs) wx.setStorageSync('lastMissTs', r.eventTs);
      this.rain(6);
      this.setData({ myMiss: r.myCount, partnerMiss: r.partnerCount });
      wx.showToast({
        title: r.partnerCount > 0 ? 'TA 今天也想了你 ' + r.partnerCount + ' 次 ❤' : '已悄悄告诉 TA：你想 TA 了 ❤',
        icon: 'none'
      });
    } catch (err) {
      api.toastErr(err);
    }
  },

  startMissPoll() {
    this.stopMissPoll();
    this.pollMiss();
    this.missTimer = setInterval(() => this.pollMiss(), 15000);
  },
  stopMissPoll() {
    if (this.missTimer) clearInterval(this.missTimer);
    this.missTimer = null;
  },

  async pollMiss() {
    if (this.polling) return;
    this.polling = true;
    try {
      const since = Number(wx.getStorageSync('lastMissTs')) || 0;
      const r = await api.call('book', { action: 'checkMiss', since: since });
      const myId = (getApp().globalData.user && getApp().globalData.user._id) || '';
      let maxTs = since;
      const fromPartner = [];
      (r.events || []).forEach((e) => {
        if (e.ts > maxTs) maxTs = e.ts;
        if (e.from !== myId) fromPartner.push(e);
      });
      if (maxTs) wx.setStorageSync('lastMissTs', maxTs);
      if (fromPartner.length) {
        this.rain(Math.min(fromPartner.length * 3 + 4, 16));
        wx.showToast({ title: '💗 ' + (fromPartner[fromPartner.length - 1].name || 'TA') + ' 想你了', icon: 'none' });
        this.refresh();
      }
    } catch (err) { /* 静默 */ }
    this.polling = false;
  },

  /* 满屏爱心雨 */
  rain(n) {
    const hearts = [];
    const emojis = ['💗', '💖', '💕', '❤️', '💘'];
    for (let i = 0; i < n; i++) {
      hearts.push({
        left: 4 + Math.random() * 88,
        delay: (Math.random() * 1.6).toFixed(2),
        size: 30 + Math.round(Math.random() * 30),
        emoji: emojis[i % emojis.length]
      });
    }
    this.setData({ rainHearts: hearts });
    setTimeout(() => this.setData({ rainHearts: [] }), 4200);
  },

  goCompose() { wx.navigateTo({ url: '/pages/compose/compose' }); },
  goTimeline() { wx.switchTab({ url: '/pages/timeline/timeline' }); },
  goWishes() { wx.navigateTo({ url: '/pages/wishes/wishes' }); },
  goWheel() { wx.navigateTo({ url: '/pages/wheel/wheel' }); },
  goDaily() { wx.navigateTo({ url: '/pages/daily/daily' }); },

  copyCode() {
    wx.setClipboardData({ data: this.data.code });
  },

  /* 分享卡片邀请 TA */
  onShareAppMessage() {
    return {
      title: '来和我一起记录我们的日子 ❤',
      path: '/pages/onboard/onboard?code=' + this.data.code
    };
  }
});
