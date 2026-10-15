const api = require('../../utils/api');
const util = require('../../utils/util');

const ICONS = ['🎂', '📅', '💍', '🎈', '🌟', '🐾', '🏠', '🎁'];

Page({
  data: {
    events: [],
    upcoming: [],
    showForm: false,
    editId: '',
    name: '',
    icon: '🎂',
    icons: ICONS,
    calendar: 'solar',   // solar | lunar
    yearly: true,
    date: util.todayStr(),
    lunarMonth: 1,
    lunarDay: 1,
    lunarIsLeap: false,
    lunarYear: '',
    busy: false
  },

  onShow() { this.refresh(); },

  async refresh() {
    try {
      const data = await api.call('book', { action: 'get' });
      getApp().globalData.book = data.book;
      const book = data.book || {};
      this.setData({
        events: book.events || [],
        upcoming: util.upcomingEvents(book).slice(0, 3)
      });
    } catch (err) {
      api.toastErr(err);
    }
  },

  openAdd() {
    this.setData({
      showForm: true,
      editId: '',
      name: '',
      icon: '🎂',
      calendar: 'solar',
      yearly: true,
      date: util.todayStr(),
      lunarMonth: 1,
      lunarDay: 1,
      lunarIsLeap: false,
      lunarYear: ''
    });
  },

  openEdit(e) {
    const id = e.currentTarget.dataset.id;
    const ev = this.data.events.filter((x) => x.id === id)[0];
    if (!ev) return;
    this.setData({
      showForm: true,
      editId: ev.id,
      name: ev.name || '',
      icon: ev.icon || '📅',
      calendar: ev.calendar === 'lunar' ? 'lunar' : 'solar',
      yearly: !!ev.yearly,
      date: ev.date || util.todayStr(),
      lunarMonth: ev.lunarMonth || 1,
      lunarDay: ev.lunarDay || 1,
      lunarIsLeap: !!ev.lunarIsLeap,
      lunarYear: ev.lunarYear ? String(ev.lunarYear) : ''
    });
  },

  closeForm() { this.setData({ showForm: false }); },
  onName(e) { this.setData({ name: e.detail.value }); },
  pickIcon(e) { this.setData({ icon: e.currentTarget.dataset.icon }); },
  pickCalendar(e) { this.setData({ calendar: e.currentTarget.dataset.v }); },
  toggleYearly() { this.setData({ yearly: !this.data.yearly }); },
  toggleLeap() { this.setData({ lunarIsLeap: !this.data.lunarIsLeap }); },
  onDate(e) { this.setData({ date: e.detail.value }); },
  onLunarMonth(e) { this.setData({ lunarMonth: Number(e.detail.value) + 1 }); },
  onLunarDay(e) { this.setData({ lunarDay: Number(e.detail.value) + 1 }); },
  onLunarYear(e) { this.setData({ lunarYear: e.detail.value.replace(/\D/g, '').slice(0, 4) }); },

  async save() {
    if (this.data.busy) return;
    const d = this.data;
    if (!d.name.trim()) return wx.showToast({ title: '先起个名字', icon: 'none' });
    const ev = {
      id: d.editId || 'e' + Date.now().toString(36),
      name: d.name.trim().slice(0, 20),
      icon: d.icon,
      yearly: d.yearly
    };
    if (d.calendar === 'lunar') {
      ev.calendar = 'lunar';
      ev.lunarMonth = d.lunarMonth;
      ev.lunarDay = d.lunarDay;
      ev.lunarIsLeap = d.lunarIsLeap;
      if (!d.yearly && d.lunarYear) ev.lunarYear = Number(d.lunarYear);
    } else {
      ev.date = d.date;
    }

    const list = d.editId
      ? d.events.map((x) => (x.id === d.editId ? ev : x))
      : d.events.concat([ev]);

    this.setData({ busy: true });
    try {
      const r = await api.call('book', { action: 'update', events: list });
      getApp().globalData.book = r.book;
      this.setData({ showForm: false, busy: false, events: r.book.events || [] });
      this.refresh();
      wx.showToast({ title: '已保存', icon: 'none' });
    } catch (err) {
      api.toastErr(err);
      this.setData({ busy: false });
    }
  },

  remove(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除这个日子？',
      confirmColor: '#ff6b9d',
      success: async (res) => {
        if (!res.confirm) return;
        const list = this.data.events.filter((x) => x.id !== id);
        try {
          const r = await api.call('book', { action: 'update', events: list });
          getApp().globalData.book = r.book;
          this.setData({ events: r.book.events || [] });
        } catch (err) {
          api.toastErr(err);
        }
      }
    });
  }
});
