const api = require('../../utils/api');
const util = require('../../utils/util');

Page({
  data: {
    daily: null,
    myId: '',
    mine: '',
    partner: '',
    partnerName: 'Ta',
    showPartner: false,
    input: '',
    history: [],
    busy: false
  },

  onShow() { this.refresh(); },

  async refresh() {
    const app = getApp();
    try {
      const data = await api.call('book', { action: 'get' });
      app.globalData.book = data.book;
      const book = data.book || {};
      const myId = (app.globalData.user && app.globalData.user._id) || '';
      const daily = book.daily || { answers: {} };
      const mine = daily.answers[myId] || '';
      this.setData({
        daily: daily,
        myId: myId,
        mine: mine,
        input: mine,
        partner: daily.answers[book.partnerId] || '',
        partnerName: book.partnerName || 'Ta',
        showPartner: !!daily.answers[book.partnerId] && !!mine,
        history: (book.dailyHistory || []).map((h) => ({
          date: h.date,
          label: util.fmtDateShort(h.date),
          rel: util.relativeDay(h.date),
          question: h.question,
          mine: h.answers[myId] || '',
          partner: h.answers[book.partnerId] || ''
        }))
      });
    } catch (err) {
      api.toastErr(err);
    }
  },

  onInput(e) { this.setData({ input: e.detail.value }); },

  async save() {
    if (this.data.busy) return;
    const text = this.data.input.trim();
    if (!text) return wx.showToast({ title: '先写点什么吧', icon: 'none' });
    this.setData({ busy: true });
    try {
      const r = await api.call('book', { action: 'answerDaily', text: text });
      const myId = this.data.myId;
      const partnerAns = this.data.daily && this.data.daily.answers
        ? this.data.daily.answers[this.data.daily.partnerId] || '' : '';
      this.setData({
        daily: r.daily,
        mine: r.daily.answers[myId] || '',
        partner: r.daily.answers[(getApp().globalData.book || {}).partnerId] || '',
        showPartner: !!(r.daily.answers[(getApp().globalData.book || {}).partnerId])
      });
      wx.showToast({ title: '已保存，去看看 TA 的吧 ❤', icon: 'none' });
      this.refresh();
    } catch (err) {
      api.toastErr(err);
    }
    this.setData({ busy: false });
  }
});
