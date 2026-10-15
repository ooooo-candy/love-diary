const api = require('../../utils/api');
const util = require('../../utils/util');

const MOODS = { sweet: '🥰', happy: '😄', calm: '🙂', sad: '🥺', angry: '😤' };

Page({
  data: {
    groups: [],
    total: 0,
    myId: '',
    /* 评论弹层 */
    showCmt: false,
    cmtRec: null,
    cmtList: [],
    cmtInput: '',
    cmtBusy: false
  },

  onShow() { this.refresh(); },
  onPullDownRefresh() { this.refresh().then(() => wx.stopPullDownRefresh()); },
  onUnload() { if (this.audioCtx) this.audioCtx.destroy(); },

  async refresh() {
    try {
      const rd = await api.call('records', { action: 'list' });
      const app = getApp();
      app.globalData.records = rd.records;
      this.setData({ myId: (app.globalData.user && app.globalData.user._id) || '' });
      this.render();
    } catch (err) {
      api.toastErr(err);
    }
  },

  render() {
    const records = getApp().globalData.records || [];
    const myId = this.data.myId;
    const map = {};
    const order = [];
    records.forEach((r) => {
      if (!map[r.date]) {
        map[r.date] = { date: r.date, label: util.fmtDate(r.date), rel: util.relativeDay(r.date), items: [] };
        order.push(r.date);
      }
      map[r.date].items.push({
        _id: r._id,
        title: r.title || '',
        note: r.note || '',
        place: r.place || '',
        mood: MOODS[r.mood] || '🥰',
        authorName: r.authorName || '',
        thumbs: (r.images || []).slice(0, 3).map((i) => i.fileId),
        more: Math.max(0, (r.images || []).length - 3),
        imageCount: (r.images || []).length,
        hasAudio: !!(r.audio && r.audio.fileId),
        audioDuration: (r.audio && r.audio.duration) || 0,
        likes: r.likes || [],
        liked: (r.likes || []).indexOf(myId) >= 0,
        likeCount: (r.likes || []).length,
        commentCount: (r.comments || []).length
      });
    });

    const allIds = [];
    records.forEach((r) => (r.images || []).forEach((i) => i.fileId && allIds.push(i.fileId)));
    if (allIds.length) {
      wx.cloud.getTempFileURL({
        fileList: allIds.slice(0, 50),
        complete: (res) => {
          const map2 = {};
          (res.fileList || []).forEach((f) => { if (f.fileID && f.tempFileURL) map2[f.fileID] = f.tempFileURL; });
          const groups = this.data.groups.map((g) => ({
            ...g,
            items: g.items.map((it) => ({ ...it, thumbs: it.thumbs.map((t) => map2[t] || t) }))
          }));
          this.setData({ groups: groups });
        }
      });
    }

    this.setData({
      groups: order.map((d) => map[d]),
      total: records.length
    });
  },

  preview(e) {
    const { g, i, t } = e.currentTarget.dataset;
    const group = this.data.groups[g];
    const rec = group.items[i];
    const full = (getApp().globalData.records.filter((r) => r._id === rec._id)[0] || { images: [] }).images.map((x) => x.fileId);
    const urls = rec.thumbs.filter((x) => x.indexOf('http') === 0);
    if (urls.length) wx.previewImage({ current: urls[t] || urls[0], urls: urls });
    else if (full.length) {
      wx.cloud.getTempFileURL({
        fileList: full,
        complete: (res) => {
          const u2 = (res.fileList || []).map((f) => f.tempFileURL).filter(Boolean);
          if (u2.length) wx.previewImage({ urls: u2 });
        }
      });
    }
  },

  edit(e) {
    wx.navigateTo({ url: '/pages/compose/compose?id=' + e.currentTarget.dataset.id });
  },

  remove(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除这条记录？',
      content: '照片和语音也会一起删除，不可恢复',
      confirmText: '删除',
      confirmColor: '#ff6b9d',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.call('records', { action: 'remove', id: id });
          const app = getApp();
          app.globalData.records = app.globalData.records.filter((r) => r._id !== id);
          wx.showToast({ title: '已删除', icon: 'none' });
          this.render();
        } catch (err) {
          api.toastErr(err);
        }
      }
    });
  },

  /* ---------- 点赞（原地更新不整页刷） ---------- */

  async toggleLike(e) {
    const id = e.currentTarget.dataset.id;
    const rec = getApp().globalData.records.filter((r) => r._id === id)[0];
    if (!rec) return;
    const myId = this.data.myId;
    const likes = (rec.likes || []).slice();
    const at = likes.indexOf(myId);
    if (at >= 0) likes.splice(at, 1);
    else likes.push(myId);
    rec.likes = likes;
    this.patchItem(id, { likes: likes, liked: likes.indexOf(myId) >= 0, likeCount: likes.length });
    try {
      const r = await api.call('records', { action: 'toggleLike', id: id });
      rec.likes = r.likes || [];
      this.patchItem(id, { likes: rec.likes, liked: rec.likes.indexOf(myId) >= 0, likeCount: rec.likes.length });
    } catch (err) {
      api.toastErr(err);
    }
  },

  patchItem(id, patch) {
    const groups = this.data.groups.map((g) => ({
      ...g,
      items: g.items.map((it) => (it._id === id ? { ...it, ...patch } : it))
    }));
    this.setData({ groups: groups });
  },

  /* ---------- 评论 ---------- */

  openCmt(e) {
    const id = e.currentTarget.dataset.id;
    const rec = getApp().globalData.records.filter((r) => r._id === id)[0];
    if (!rec) return;
    this.setData({
      showCmt: true,
      cmtRec: { id: id },
      cmtList: (rec.comments || []).slice().reverse().map((c) => ({ ...c, timeText: util.cmtTime(c.ts) })),
      cmtInput: ''
    });
  },
  closeCmt() { this.setData({ showCmt: false, cmtRec: null }); },
  onCmtInput(e) { this.setData({ cmtInput: e.detail.value }); },

  async sendCmt() {
    if (this.data.cmtBusy) return;
    const text = this.data.cmtInput.trim();
    if (!text) return wx.showToast({ title: '先写点什么吧', icon: 'none' });
    this.setData({ cmtBusy: true });
    try {
      const r = await api.call('records', { action: 'addComment', id: this.data.cmtRec.id, text: text });
      const rec = getApp().globalData.records.filter((x) => x._id === this.data.cmtRec.id)[0];
      if (rec) rec.comments = (rec.comments || []).concat([r.comment]);
      this.setData({
        cmtList: [{ ...r.comment, timeText: util.cmtTime(r.comment.ts) }].concat(this.data.cmtList),
        cmtInput: ''
      });
      this.patchItem(this.data.cmtRec.id, { commentCount: r.count });
    } catch (err) {
      api.toastErr(err);
    }
    this.setData({ cmtBusy: false });
  },

  async delCmt(e) {
    const cid = e.currentTarget.dataset.cid;
    try {
      const r = await api.call('records', { action: 'delComment', id: this.data.cmtRec.id, cid: cid });
      const rec = getApp().globalData.records.filter((x) => x._id === this.data.cmtRec.id)[0];
      if (rec) rec.comments = (rec.comments || []).filter((c) => c.id !== cid);
      this.setData({ cmtList: this.data.cmtList.filter((c) => c.id !== cid) });
      this.patchItem(this.data.cmtRec.id, { commentCount: r.count });
    } catch (err) {
      api.toastErr(err);
    }
  },

  /* ---------- 语音播放 ---------- */

  playVoice(e) {
    const id = e.currentTarget.dataset.id;
    const rec = getApp().globalData.records.filter((r) => r._id === id)[0];
    if (!rec || !rec.audio || !rec.audio.fileId) return;
    this.setData({ playingId: id });
    const finish = () => this.setData({ playingId: '' });
    wx.cloud.getTempFileURL({
      fileList: [rec.audio.fileId],
      complete: (res) => {
        const url = res.fileList && res.fileList[0] && res.fileList[0].tempFileURL;
        if (!url) { finish(); return; }
        if (this.audioCtx) this.audioCtx.destroy();
        this.audioCtx = wx.createInnerAudioContext();
        this.audioCtx.src = url;
        this.audioCtx.onEnded(finish);
        this.audioCtx.onError(finish);
        this.audioCtx.play();
      }
    });
  }
});
