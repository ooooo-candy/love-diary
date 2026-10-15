/* 数据层：云端优先 + 本地缓存
 *
 * - 需要一个账号才能使用（手机号验证码登录），两个人加入同一个「情侣本」后数据完全共享
 * - 读取走内存 / localStorage 缓存（秒开、离线可看），写入先更新本地再同步云端
 * - 照片压缩后上传到云存储，只保存 fileId，展示时按需换取临时地址
 */
(function (global) {
  'use strict';

  const CACHE_KEY = 'love-diary:cache';
  const LS_LEGACY = 'love-diary:v1';

  const state = {
    me: null,     // { uid, phone, nickname, avatar, bookId }
    book: null,   // { id, code, title, myName, partnerName, anniversary, palette, theme, myAvatar, partnerAvatar, members }
    records: []   // [{ id, authorId, authorName, date, title, note, place, mood, tags, images, createdAt }]
  };

  const previewCache = new Map();
  const listeners = [];

  /* 临时链接持久缓存：fileId → { url, exp }（临时链接有效期 1 小时，提前 5 分钟作废） */
  const URL_CACHE_KEY = 'ld:imgurls';
  function loadUrlCache() {
    try { return JSON.parse(localStorage.getItem(URL_CACHE_KEY) || '{}'); } catch (err) { return {}; }
  }
  function urlCacheGet(id) {
    try {
      const hit = loadUrlCache()[id];
      if (hit && hit.url && hit.exp > Date.now() + 300000) return hit.url;
    } catch (err) { /* 忽略 */ }
    return '';
  }
  function urlCachePut(id, url) {
    try {
      const cache = loadUrlCache();
      cache[id] = { url: url, exp: Date.now() + 55 * 60000 };
      const keys = Object.keys(cache);
      if (keys.length > 150) {
        keys.sort((a, b) => (cache[a].exp || 0) - (cache[b].exp || 0));
        keys.slice(0, keys.length - 150).forEach((k) => delete cache[k]);
      }
      localStorage.setItem(URL_CACHE_KEY, JSON.stringify(cache));
    } catch (err) { /* 忽略 */ }
  }

  function emit() {
    listeners.forEach((fn) => {
      try { fn(); } catch (e) { console.error(e); }
    });
  }

  function persistCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ me: state.me, book: state.book, records: state.records }));
    } catch (err) { /* 缓存写满忽略 */ }
  }

  function restoreCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const c = JSON.parse(raw);
      state.me = c.me || null;
      state.book = c.book || null;
      state.records = Array.isArray(c.records) ? c.records : [];
    } catch (err) { /* 忽略 */ }
  }

  function sorted() {
    return state.records.slice().sort((a, b) => {
      if (a.date === b.date) return (b.createdAt || 0) - (a.createdAt || 0);
      return a.date < b.date ? 1 : -1;
    });
  }

  /* ---------------- 图片处理 ---------------- */

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img: img, url: url });
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('无法读取该图片：' + (file.name || '')));
      };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('图片压缩失败'))),
        type,
        quality
      );
    });
  }

  /* 大图会自动分片上传，所以这里只需控制单张照片的整体体积；
   * 超过这个大小就继续压缩，避免上传过慢、占用云存储。 */
  const UPLOAD_BYTES = 900 * 1024;

  /* 自适应压缩：优先保证画质，只在超过体积上限时才逐级压缩
   * aggressive=true 时用很小的目标，作为分片上传不可用时的兜底 */
  async function compress(file, aggressive) {
    const target = aggressive ? 34 * 1024 : UPLOAD_BYTES;
    const { img, url } = await loadImageFromFile(file);
    try {
      const sw = img.naturalWidth || img.width;
      const sh = img.naturalHeight || img.height;
      if (!sw || !sh) throw new Error('无法读取该图片：' + (file.name || ''));

      let maxEdge = aggressive ? 900 : 1600;
      let quality = aggressive ? 0.62 : 0.86;
      let best = null;

      // 最多迭代 8 次：太大就同时缩小尺寸 + 降质量，直到进入限制内
      for (let i = 0; i < 8; i++) {
        const scale = Math.min(1, maxEdge / Math.max(sw, sh));
        const w = Math.max(1, Math.round(sw * scale));
        const h = Math.max(1, Math.round(sh * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
        if (!best || blob.size < best.blob.size) best = { blob: blob, w: w, h: h };
        if (blob.size <= target) return { blob: blob, w: w, h: h };

        const over = Math.sqrt(blob.size / target);
        maxEdge = Math.max(520, Math.round(maxEdge / Math.min(1.6, Math.max(1.08, over))));
        quality = Math.max(0.4, quality - 0.09);
      }
      return best;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function blobToFile(blob, name) {
    try {
      return new File([blob], name || 'photo.jpg', { type: blob.type || 'image/jpeg' });
    } catch (err) {
      const b = new Blob([blob], { type: blob.type || 'image/jpeg' });
      b.name = name || 'photo.jpg';
      return b;
    }
  }

  function dataURLToBlob(dataURL) {
    const parts = String(dataURL).split(',');
    const mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
    const bin = atob(parts[1] || '');
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  /* ---------------- 对外 API ---------------- */

  const Store = {
    async init() {
      restoreCache();
      await Cloud.init();
      if (Cloud.session) await Store.sync();
      return Cloud.session ? 'cloud' : 'guest';
    },

    isSignedIn: () => Boolean(Cloud.session),
    subscribe(fn) { listeners.push(fn); },

    /* 拉取云端数据（登录后 / 下拉刷新） */
    async sync() {
      if (!Cloud.session) return;
      try {
        const me = await Cloud.api.me();
        state.me = me.user;
        state.book = me.book;
        const list = await Cloud.api.listRecords();
        state.book = list.book || state.book;
        state.records = list.records || [];
        persistCache();
      } catch (err) {
        if (err && (err.apiCode === 'TOKEN_INVALID' || err.apiCode === 'TOKEN_EXPIRED' || err.apiCode === 'NO_USER')) {
          Cloud.clearSession();
        }
        throw err;
      }
      emit();
    },

    getMe() { return state.me; },
    getBook() { return state.book; },

    getProfile() {
      const b = state.book || {};
      return {
        myName: b.myName || '我',
        partnerName: b.partnerName || '宝贝',
        anniversary: b.anniversary || UI.todayStr(),
        myAvatar: b.myAvatar || null,
        partnerAvatar: b.partnerAvatar || null,
        palette: b.palette || 'pink',
        theme: b.theme || 'light',
        events: b.events || [],
        wishes: b.wishes || [],
        miss: b.miss || null,
        daily: b.daily || null,
        dailyHistory: b.dailyHistory || [],
        onboarded: Boolean(state.book),
        code: b.code || '',
        partnerInfo: b.partnerInfo || null,
        members: b.members || []
      };
    },

    async saveProfile(patch) {
      // 本地先更新，保证即时反馈
      state.book = Object.assign({}, state.book || {}, patch);
      persistCache();
      emit();
      try {
        const res = await Cloud.api.updateBook(patch);
        if (res && res.book) state.book = Object.assign({}, state.book, res.book);
        persistCache();
        emit();
      } catch (err) {
        UI.toast('设置保存超时，稍后重试');
        throw err;
      }
    },

    listRecords() { return sorted(); },

    getRecord(id) { return state.records.filter((r) => r.id === id)[0] || null; },

    /* 点赞/评论等小改动：本地先更新，调用方再和云端对账 */
    patchRecord(id, patch) {
      const rec = state.records.filter((r) => r.id === id)[0];
      if (!rec) return null;
      Object.assign(rec, patch);
      persistCache();
      emit();
      return rec;
    },

    async upsertRecord(rec) {
      const payload = {
        id: rec.id || null,
        date: rec.date,
        title: rec.title,
        note: rec.note,
        place: rec.place,
        mood: rec.mood,
        tags: rec.tags,
        images: (rec.images || []).map((i) => ({ id: i.id, name: i.name, w: i.w, h: i.h }))
      };
      const idx = state.records.findIndex((r) => r.id === payload.id);
      const optimistic = Object.assign({}, rec, {
        id: payload.id || 'tmp_' + UI.uid(),
        authorId: (state.me && state.me.uid) || '',
        authorName: (state.me && (state.me.nickname || state.me.phone)) || '',
        createdAt: rec.createdAt || Date.now()
      });
      if (idx >= 0) state.records[idx] = optimistic;
      else state.records.push(optimistic);
      persistCache();
      emit();

      try {
        const res = await Cloud.api.upsertRecord(payload);
        const saved = res.record;
        const at = state.records.findIndex((r) => r.id === optimistic.id);
        if (at >= 0) state.records[at] = saved;
        else state.records.push(saved);
        persistCache();
        emit();
        return saved;
      } catch (err) {
        UI.toast('同步到云端失败，已暂存在本机');
        throw err;
      }
    },

    async removeRecord(id) {
      state.records = state.records.filter((r) => r.id !== id);
      persistCache();
      emit();
      try {
        await Cloud.api.removeRecord(id);
      } catch (err) {
        UI.toast('云端删除失败，已在本机删除');
      }
    },

    /* 压缩并上传照片 */
    async addImages(files) {
      const list = Array.prototype.slice.call(files || []).filter((f) =>
        /^image\//i.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name || '')
      );
      const refs = [];
      for (const file of list) {
        try {
          let { blob, w, h } = await compress(file);
          let up = null;
          try {
            up = await Cloud.uploadImage(blobToFile(blob, (file.name || 'photo') + '.jpg'));
          } catch (err) {
            // 万一还是超出云端上限（或网络抖动），再压一轮更小的兜底重试
            if (err.apiCode === 'TOO_LARGE' || err.apiCode === 'NETWORK') {
              const small = await compress(file, true);
              blob = small.blob;
              w = small.w;
              h = small.h;
              up = await Cloud.uploadImage(blobToFile(blob, (file.name || 'photo') + '.jpg'));
            } else {
              throw err;
            }
          }

          const localUrl = URL.createObjectURL(blob);
          const ref = { id: up.fileId, localUrl: localUrl, w: w, h: h, name: file.name || 'photo' };
          refs.push(ref);
          previewCache.set(String(ref.id), localUrl);
        } catch (err) {
          UI.toast(err.message || '有图片没能加进来');
        }
      }
      return refs.filter((r) => r.id).map((r) => ({
        id: r.id,
        name: r.name,
        w: r.w,
        h: r.h
      }));
    },

    async dropImages(refs) {
      // 云存储文件随记录删除一并清理即可，这里只清预览缓存
      (refs || []).forEach((r) => {
        previewCache.delete(String(r.id));
        if (r.localUrl) URL.revokeObjectURL(r.localUrl);
      });
    },

    async getImageURL(ref) {
      if (!ref) return '';
      if (!ref.id) return ref.localUrl || '';
      if (previewCache.has(String(ref.id))) return previewCache.get(String(ref.id));
      const cached = urlCacheGet(String(ref.id));
      if (cached) {
        previewCache.set(String(ref.id), cached);
        return cached;
      }
      try {
        const map = await Cloud.getFileUrls([ref.id]);
        const url = map[ref.id] || '';
        if (url) {
          previewCache.set(String(ref.id), url);
          urlCachePut(String(ref.id), url);
        }
        return url;
      } catch (err) {
        return '';
      }
    },

    /* 一次批量把多个 fileId 换成临时链接（带本地持久缓存，重进 App 秒开） */
    async resolveImageURLs(ids) {
      const out = {};
      const need = [];
      (ids || []).forEach((id) => {
        if (previewCache.has(String(id))) {
          out[id] = previewCache.get(String(id));
          if (!out[id]) delete out[id];
          else return;
        }
        const cached = urlCacheGet(String(id));
        if (cached) {
          previewCache.set(String(id), cached);
          out[id] = cached;
        } else {
          need.push(id);
        }
      });
      if (need.length) {
        try {
          const map = await Cloud.getFileUrls(need);
          need.forEach((id) => {
            const url = map[id] || '';
            if (url) {
              out[id] = url;
              previewCache.set(String(id), url);
              urlCachePut(String(id), url);
            }
          });
        } catch (err) { /* 失败返回已解析部分 */ }
      }
      return out;
    },

    allImageRefs() {
      const refs = [];
      const p = Store.getProfile();
      [p.myAvatar, p.partnerAvatar].forEach((a) => a && a.id && refs.push(a));
      state.records.forEach((r) => (r.images || []).forEach((i) => i && i.id && refs.push(i)));
      return refs;
    },

    /* 备份：导出为 JSON（含图片 base64，便于自己留档） */
    async exportAll() {
      const out = {
        app: 'love-diary',
        version: 2,
        exportedAt: new Date().toISOString(),
        book: state.book,
        records: []
      };
      for (const rec of state.records) {
        const images = [];
        for (const ref of rec.images || []) {
          const url = await Store.getImageURL(ref);
          let data = '';
          if (url && url.indexOf('data:') === 0) data = url;
          else if (url) {
            try {
              const res = await fetch(url);
              const blob = await res.blob();
              data = await new Promise((resolve) => {
                const fr = new FileReader();
                fr.onload = () => resolve(fr.result);
                fr.onerror = () => resolve('');
                fr.readAsDataURL(blob);
              });
            } catch (err) { /* 忽略 */ }
          }
          images.push({ name: ref.name, w: ref.w, h: ref.h, data: data });
        }
        out.records.push(Object.assign({}, rec, { images: images }));
      }
      return out;
    },

    async importAll(json) {
      if (!json || !Array.isArray(json.records)) throw new Error('备份文件格式不正确');
      for (const rec of json.records) {
        const images = await Store.addImages(
          (rec.images || []).filter((i) => i.data).map((i, idx) => blobToFile(dataURLToBlob(i.data), 'photo' + idx + '.jpg'))
        );
        await Store.upsertRecord(Object.assign({}, rec, { id: null, images: images }));
      }
    },

    clearLocal() {
      state.me = null;
      state.book = null;
      state.records = [];
      previewCache.clear();
      try {
        localStorage.removeItem(CACHE_KEY);
        localStorage.removeItem(LS_LEGACY);
        localStorage.removeItem(URL_CACHE_KEY);
      } catch (err) { /* 忽略 */ }
      emit();
    }
  };

  global.Store = Store;
})(window);
