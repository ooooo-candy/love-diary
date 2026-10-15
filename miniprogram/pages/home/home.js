const api = require('../../utils/api');
const util = require('../../utils/util');

const MOODS = {
  sweet: '🥰', happy: '😄', calm: '🙂', sad: '🥺', angry: '😤'
};

Page({
  data: {
    book: null,
    days: 0,
    todayStr: '',
    hasToday: false,
    latest: [],
    code: '',
    partnerJoined: false
  },

  onShow() {
    this.refresh();
  },

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

    this.setData({
      book: book,
      days: util.loveDays(book.anniversary),
      todayStr: today,
      hasToday: records.some((r) => r.date === today),
      latest: latest,
      code: book.code || '',
      partnerJoined: !!book.partnerJoined
    });
  },

  goCompose() {
    wx.navigateTo({ url: '/pages/compose/compose' });
  },

  goTimeline() {
    wx.switchTab({ url: '/pages/timeline/timeline' });
  },

  copyCode() {
    wx.setClipboardData({ data: this.data.code });
  }
});
