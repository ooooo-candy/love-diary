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
    /* 语音 */
    audio: null,      // { fileId } 已上传的 / { tempPath, duration } 待上传的
    recording: false,
    recSeconds: 0,
    playing: false,
    busy: false
  },

  onLoad(options) {
    const app = getApp();
    /* 录音器 */
    this.recorder = wx.getRecorderManager();
    this.recorder.onStop((res) => {
      if (!res.tempFilePath || res.duration < 800) {
        this.setData({ recording: false, recSeconds: 0 });
        return wx.showToast({ title: '太短了，没录上', icon: 'none' });
      }
      this.setData({
        recording: false,
        recSeconds: Math.max(1, Math.round(res.duration / 1000)),
        audio: { tempPath: res.tempFilePath, duration: Math.max(1, Math.round(res.duration / 1000)) }
      });
    });
    this.recorder.onError(() => {
      this.setData({ recording: false, recSeconds: 0 });
      wx.showModal({
        title: '拿不到麦克风',
        content: '请在手机系统设置 → 应用 → 微信 → 权限里，允许微信使用麦克风',
        showCancel: false
      });
    });

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
          images: (rec.images || []).map((i) => ({ fileId: i.fileId, tempUrl: i.fileId })),
          audio: rec.audio && rec.audio.fileId ? { fileId: rec.audio.fileId, duration: rec.audio.duration || 0 } : null
        });
        /* 换取云存储临时链接用于回显 */
        const fileIds = this.data.images.map((i) => i.fileId);
        if (this.data.audio && this.data.audio.fileId) fileIds.push(this.data.audio.fileId);
        if (fileIds.length) {
          wx.cloud.getTempFileURL({
            fileList: fileIds,
            complete: (res) => {
              const map = {};
              (res.fileList || []).forEach((f) => { if (f.fileID && f.tempFileURL) map[f.fileID] = f.tempFileURL; });
              this.setData({
                images: this.data.images.map((i) => ({ fileId: i.fileId, tempUrl: map[i.fileId] || i.tempUrl })),
                audio: this.data.audio && this.data.audio.fileId
                  ? { fileId: this.data.audio.fileId, duration: this.data.audio.duration, tempUrl: map[this.data.audio.fileId] || '' }
                  : this.data.audio
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

  /* ---------- 语音 ---------- */

  toggleRecord() {
    if (this.data.recording) {
      this.recorder.stop();
      return;
    }
    if (this.data.audio) {
      wx.showModal({
        title: '重新录一段？',
        content: '原来的语音会被替换',
        confirmColor: '#ff6b9d',
        success: (res) => { if (res.confirm) this.startRec(); }
      });
      return;
    }
    this.startRec();
  },

  startRec() {
    this.setData({ recording: true, recSeconds: 0 });
    this.recorder.start({ format: 'mp3', duration: 60000, sampleRate: 44100, encodeBitRate: 128000 });
    this.recTimer = setInterval(() => {
      this.setData({ recSeconds: this.data.recSeconds + 1 });
    }, 1000);
  },

  clearRecTimer() { if (this.recTimer) clearInterval(this.recTimer); this.recTimer = null; },

  removeAudio() {
    this.clearRecTimer();
    this.setData({ audio: null, recording: false, recSeconds: 0 });
  },

  playAudio() {
    const a = this.data.audio;
    if (!a) return;
    if (a.tempPath) {
      this.playFile(a.tempPath);
      return;
    }
    if (a.fileId) {
      wx.showLoading({ title: '加载中…', mask: true });
      wx.cloud.getTempFileURL({
        fileList: [a.fileId],
        complete: (res) => {
          wx.hideLoading();
          const url = res.fileList && res.fileList[0] && res.fileList[0].tempFileURL;
          if (url) this.playFile(url);
        }
      });
    }
  },

  playFile(url) {
    if (this.audioCtx) { this.audioCtx.destroy(); }
    this.audioCtx = wx.createInnerAudioContext();
    this.audioCtx.src = url;
    this.audioCtx.onEnded(() => this.setData({ playing: false }));
    this.setData({ playing: true });
    this.audioCtx.play();
  },

  async save() {
    if (this.data.busy) return;
    const d = this.data;
    if (!d.title.trim() && !d.note.trim() && !d.images.length && !d.localImages.length && !d.audio) {
      return wx.showToast({ title: '写点什么或选张照片吧', icon: 'none' });
    }
    if (d.recording) return wx.showToast({ title: '先停止录音再保存', icon: 'none' });
    this.setData({ busy: true });
    wx.showLoading({ title: '保存中…', mask: true });
    try {
      let uploaded = [];
      if (d.localImages.length) uploaded = await this.uploadImages();
      const images = d.images.concat(uploaded).map((i) => ({ fileId: i.fileId }));

      let audio = null;
      if (d.audio && d.audio.fileId) audio = { fileId: d.audio.fileId, duration: d.audio.duration };
      else if (d.audio && d.audio.tempPath) {
        const app = getApp();
        const up = await new Promise((resolve, reject) => {
          wx.cloud.uploadFile({
            cloudPath: 'audio/' + (app.globalData.user ? app.globalData.user._id : 'anon') + '/' + Date.now() + '.mp3',
            filePath: d.audio.tempPath,
            success: resolve,
            fail: reject
          });
        });
        audio = { fileId: up.fileID, duration: d.audio.duration || 0 };
      }

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
          images: images,
          audio: audio
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
