const api = require('../../utils/api');

Page({
  data: { wishes: [], text: '', busy: false },

  onShow() { this.refresh(); },

  async refresh() {
    try {
      const data = await api.call('book', { action: 'get' });
      getApp().globalData.book = data.book;
      this.setData({ wishes: (data.book && data.book.wishes) || [] });
    } catch (err) {
      api.toastErr(err);
    }
  },

  onText(e) { this.setData({ text: e.detail.value }); },

  async add() {
    const t = this.data.text.trim();
    if (!t || this.data.busy) return;
    this.setData({ busy: true });
    try {
      const r = await api.call('book', { action: 'addWish', text: t });
      this.setData({ wishes: this.data.wishes.concat([r.wish]), text: '' });
    } catch (err) {
      api.toastErr(err);
    }
    this.setData({ busy: false });
  },

  async toggle(e) {
    const id = e.currentTarget.dataset.id;
    try {
      const r = await api.call('book', { action: 'toggleWish', id: id });
      this.setData({ wishes: r.wishes });
    } catch (err) {
      api.toastErr(err);
    }
  },

  remove(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除这个心愿？',
      confirmColor: '#ff6b9d',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          const r = await api.call('book', { action: 'removeWish', id: id });
          this.setData({ wishes: r.wishes });
        } catch (err) {
          api.toastErr(err);
        }
      }
    });
  }
});
