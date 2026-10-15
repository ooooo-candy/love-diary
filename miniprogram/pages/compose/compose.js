const api = require('../../utils/api');
const util = require('../../utils/util');

const MOODS = [
  { key: 'sweet', emoji: '🥰', label: '甜甜' },
  { key: 'happy', emoji: '😄', label: '开心' },
  { key: 'calm', emoji: '🙂', label: '平静' },
  { key: 'sad', emoji: '🥺', label: '委屈' },
  { key: 'angry', emoji: '😤', label: '生气' }
];

Page({
  data: {
    id: null,
    date: '',
    title: '',
    note: '',
    place: '',
    mood: 'sweet',
    moods: MOODS,
    tags: [],
    tagInput: '',
    images: [],       // { fileId, tempUrl } 已上传的
    localImages: [],  // { tempPath } 待上传
    busy: false
  },

  onLoad(options) {
    const app = getApp();
    if (options.id) {
      const rec = (app.globalData.records || []).filter((r) => r._id === options.id)[0];
      if (rec) {
        this.setData({
          id: rec._id,
          date: rec.date,
          title: rec.title,
          note: rec.note,
          place: rec.place,
          mood: rec.mood || 'sweet',
          tags: rec.tags || [],
          images: (rec.images || []).map((i) => ({ fileId: i.fileId, tempUrl: i.fileId }))
        });
        /* 换取云存储临时链接用于回显 */
        if (this.data.images.length) {
          wx.cloud.getTempFileURL({
            fileList: this.data.images.map((i) => i.fileId),
            complete: (res) => {
              const map = {};
              (res.fileList || []).forEach((f) => { if (f.fileID && f.tempFileURL) map[f.fileID] = f.tempFileURL; });
              this.setData({
                images: this.data.images.map((i) => ({ fileId: i.fileId, tempUrl: map[i.fileId] || i.tempUrl }))
              });
            }
          });
        }
        return;
      }
    }
    this.setData({ date: util.todayStr() });
  },

  onDate(e) { this.setData({ date: e.detail.value }); },
  onTitle(e) { this.setData({ title: e.detail.value }); },
  onNote(e) { this.setData({ note: e.detail.value }); },
  onPlace(e) { this.setData({ place: e.detail.value }); },
  onTagInput(e) { this.setData({ tagInput: e.detail.value }); },
  pickMood(e) { this.setData({ mood: e.currentTarget.dataset.key }); },

  addTag() {
    const t = this.data.tagInput.trim();
    if (!t) return;
    if (this.data.tags.indexOf(t) >= 0 || this.data.tags.length >= 12) {
      this.setData({ tagInput: '' });
      return;
    }
    this.setData({ tags: this.data.tags.concat([t]), tagInput: '' });
  },
  removeTag(e) {
    const i = Number(e.currentTarget.dataset.i);
    const tags = this.data.tags.slice();
    tags.splice(i, 1);
    this.setData({ tags: tags });
  },

  chooseImages() {
    const left = 9 - this.data.images.length - this.data.localImages.length;
    if (left <= 0) return wx.showToast({ title: '最多 9 张照片', icon: 'none' });
    wx.chooseMedia({
      count: left,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        this.setData({
          localImages: this.data.localImages.concat(res.tempFiles.map((f) => ({ tempPath: f.tempFilePath })))
        });
      }
    });
  },
  removeLocal(e) {
    const i = Number(e.currentTarget.dataset.i);
    const arr = this.data.localImages.slice();
    arr.splice(i, 1);
    this.setData({ localImages: arr });
  },
  removeImage(e) {
    const i = Number(e.currentTarget.dataset.i);
    const arr = this.data.images.slice();
    arr.splice(i, 1);
    this.setData({ images: arr });
  },

  preview(e) {
    const i = Number(e.currentTarget.dataset.i);
    const urls = this.data.images.map((x) => x.tempUrl).filter(Boolean);
    if (urls.length) wx.previewImage({ current: urls[i], urls: urls });
  },

  /* 上传所有待传照片到云存储 */
  uploadImages() {
    const app = getApp();
    const prefix = 'records/' + (app.globalData.user ? app.globalData.user._id : 'anon') + '/' + Date.now();
    const tasks = this.data.localImages.map((item, i) => {
      return new Promise((resolve, reject) => {
        const path = prefix + '_' + i + '.jpg';
        wx.cloud.uploadFile({
          cloudPath: path,
          filePath: item.tempPath,
          success: (res) => resolve({ fileId: res.fileID, tempUrl: item.tempPath }),
          fail: reject
        });
      });
    });
    return Promise.all(tasks);
  },

  async save() {
    if (this.data.busy) return;
    const d = this.data;
    if (!d.title.trim() && !d.note.trim() && !d.images.length && !d.localImages.length) {
      return wx.showToast({ title: '写点什么或选张照片吧', icon: 'none' });
    }
    this.setData({ busy: true });
    wx.showLoading({ title: '保存中…', mask: true });
    try {
      let uploaded = [];
      if (d.localImages.length) uploaded = await this.uploadImages();
      const images = d.images.concat(uploaded).map((i) => ({ fileId: i.fileId }));
      const data = await api.call('records', {
        action: 'upsert',
        record: {
          id: d.id,
          date: d.date,
          title: d.title,
          note: d.note,
          place: d.place,
          mood: d.mood,
          tags: d.tags,
          images: images
        }
      });
      /* 更新本地缓存 */
      const app = getApp();
      const list = app.globalData.records.filter((r) => r._id !== data.record._id);
      list.unshift(data.record);
      app.globalData.records = list;
      wx.hideLoading();
      wx.showToast({ title: '已保存 ❤', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (err) {
      wx.hideLoading();
      api.toastErr(err);
      this.setData({ busy: false });
    }
  }
});
