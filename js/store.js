/* 数据层：记录 + 图片
 * 图片优先存入 IndexedDB（容量大）；若浏览器/协议不支持（如 file:// 直开），
 * 自动降级为压缩后的 base64 存入 localStorage。两种模式对上层接口完全一致。
 */
(function (global) {
  'use strict';

  const LS_KEY = 'love-diary:v1';
  const DB_NAME = 'love-diary';
  const DB_VERSION = 1;
  const STORE_IMAGES = 'images';

  const DEFAULT_PROFILE = {
    myName: '我',
    partnerName: '宝贝',
    anniversary: UI.todayStr(),
    myAvatar: null,
    partnerAvatar: null,
    palette: 'pink',
    theme: 'light'
  };

  let db = null;
  let idbReady = false;
  let data = { profile: null, records: [] };
  let lastGood = null;
  const urlCache = new Map();
  const listeners = [];

  /* ---------------- IndexedDB ---------------- */

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!global.indexedDB) return reject(new Error('no indexedDB'));
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        return reject(err);
      }
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE_IMAGES)) {
          d.createObjectStore(STORE_IMAGES, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
      req.onblocked = () => reject(new Error('indexedDB blocked'));
    });
  }

  function idbPut(record) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_IMAGES, 'readwrite');
      tx.objectStore(STORE_IMAGES).put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  function idbGet(id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_IMAGES, 'readonly');
      const req = tx.objectStore(STORE_IMAGES).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  function idbDelete(ids) {
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_IMAGES, 'readwrite');
      const os = tx.objectStore(STORE_IMAGES);
      ids.forEach((id) => os.delete(id));
      tx.oncomplete = resolve;
      tx.onerror = () => resolve();
    });
  }

  function idbAll() {
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_IMAGES, 'readonly');
      const req = tx.objectStore(STORE_IMAGES).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  /* ---------------- 持久化 ---------------- */

  function persist() {
    let str;
    try {
      str = JSON.stringify(data);
    } catch (err) {
      throw new Error('DATA_INVALID');
    }
    try {
      localStorage.setItem(LS_KEY, str);
      lastGood = str;
    } catch (err) {
      if (lastGood) {
        try {
          data = JSON.parse(lastGood);
          localStorage.setItem(LS_KEY, lastGood);
        } catch (e) { /* 忽略 */ }
      }
      throw new Error('STORAGE_FULL');
    }
  }

  function emit() {
    listeners.forEach((fn) => {
      try { fn(); } catch (e) { console.error(e); }
    });
  }

  function commit() {
    persist();
    emit();
  }

  function load() {
    let raw = null;
    try {
      raw = localStorage.getItem(LS_KEY);
    } catch (err) {
      raw = null;
    }
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        data = {
          profile: Object.assign({}, DEFAULT_PROFILE, parsed.profile || {}),
          records: Array.isArray(parsed.records) ? parsed.records : []
        };
        lastGood = raw;
        return;
      } catch (err) { /* 数据损坏，重置 */ }
    }
    data = { profile: Object.assign({}, DEFAULT_PROFILE), records: [] };
  }

  /* ---------------- 图片处理 ---------------- */

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url });
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

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('图片编码失败'));
      fr.readAsDataURL(blob);
    });
  }

  /* 压缩后返回 { blob, w, h } */
  async function compress(file) {
    const { img, url } = await loadImageFromFile(file);
    const maxEdge = idbReady ? 1600 : 1100;
    const quality = idbReady ? 0.85 : 0.7;
    const sw = img.naturalWidth || img.width;
    const sh = img.naturalHeight || img.height;
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
    URL.revokeObjectURL(url);

    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    return { blob, w, h };
  }

  /* ---------------- 对外 API ---------------- */

  const Store = {
    async init() {
      load();
      try {
        db = await openDB();
        idbReady = true;
      } catch (err) {
        db = null;
        idbReady = false;
      }
      return { idbReady };
    },

    isIdbReady: () => idbReady,
    subscribe(fn) { listeners.push(fn); },
    onBoardDone: () => Boolean(data.profile && data.profile.anniversary && data.profile.onboarded !== false),

    getProfile() { return data.profile; },

    saveProfile(patch) {
      data.profile = Object.assign({}, data.profile, patch);
      commit();
    },

    listRecords() {
      return data.records.slice().sort((a, b) => {
        if (a.date === b.date) return (b.createdAt || 0) - (a.createdAt || 0);
        return a.date < b.date ? 1 : -1;
      });
    },

    getRecord(id) {
      return data.records.find((r) => r.id === id) || null;
    },

    upsertRecord(rec) {
      const idx = data.records.findIndex((r) => r.id === rec.id);
      const next = Object.assign({}, rec, { updatedAt: Date.now() });
      if (idx >= 0) data.records[idx] = next;
      else data.records.push(next);
      commit();
      return next;
    },

    removeRecord(id) {
      const rec = data.records.find((r) => r.id === id);
      if (!rec) return;
      const ids = (rec.images || []).map((img) => img.id).filter(Boolean);
      data.records = data.records.filter((r) => r.id !== id);
      commit();
      if (idbReady && ids.length) idbDelete(ids);
      ids.forEach((i) => {
        const u = urlCache.get(i);
        if (u) { URL.revokeObjectURL(u); urlCache.delete(i); }
      });
    },

    /* 处理用户选择的文件，返回可直接存入记录的 image 引用数组 */
    async addImages(files) {
      const list = Array.prototype.slice.call(files || []).filter((f) =>
        /^image\//i.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(f.name || '')
      );
      const refs = [];
      for (const file of list) {
        try {
          const { blob, w, h } = await compress(file);
          const ref = {
            id: UI.uid(),
            name: file.name || 'photo',
            w: w,
            h: h,
            size: blob.size,
            type: blob.type || 'image/jpeg'
          };
          if (idbReady) {
            await idbPut({ id: ref.id, blob: blob });
          } else {
            ref.data = await blobToDataURL(blob);
          }
          refs.push(ref);
        } catch (err) {
          console.warn(err);
          UI.toast(err.message || '有图片没能加进来');
        }
      }
      return refs;
    },

    async dropImages(refs) {
      const ids = (refs || []).map((r) => r.id).filter(Boolean);
      if (idbReady && ids.length) await idbDelete(ids);
      ids.forEach((i) => {
        const u = urlCache.get(i);
        if (u) { URL.revokeObjectURL(u); urlCache.delete(i); }
      });
    },

    /* 返回可用于 <img src> 的地址 */
    async getImageURL(ref) {
      if (!ref) return '';
      if (ref.data) return ref.data;
      if (!idbReady) return '';
      if (urlCache.has(ref.id)) return urlCache.get(ref.id);
      try {
        const row = await idbGet(ref.id);
        if (!row || !row.blob) return '';
        const url = URL.createObjectURL(row.blob);
        urlCache.set(ref.id, url);
        return url;
      } catch (err) {
        return '';
      }
    },

    allImageRefs() {
      const refs = [];
      const push = (r) => {
        if (r && r.id) refs.push(r);
      };
      push(data.profile && data.profile.myAvatar);
      push(data.profile && data.profile.partnerAvatar);
      data.records.forEach((rec) => (rec.images || []).forEach(push));
      return refs;
    },

    async exportAll() {
      const rows = idbReady ? await idbAll() : [];
      const map = new Map(rows.map((r) => [r.id, r.blob]));
      const out = {
        app: 'love-diary',
        version: 1,
        exportedAt: new Date().toISOString(),
        profile: data.profile,
        records: []
      };
      for (const rec of data.records) {
        const images = [];
        for (const ref of rec.images || []) {
          const copy = Object.assign({}, ref);
          if (!copy.data && map.has(ref.id)) {
            try { copy.data = await blobToDataURL(map.get(ref.id)); } catch (e) { /* 跳过 */ }
          }
          images.push(copy);
        }
        out.records.push(Object.assign({}, rec, { images: images }));
      }
      for (const key of ['myAvatar', 'partnerAvatar']) {
        const av = out.profile && out.profile[key];
        if (av && !av.data && map.has(av.id)) {
          try { av.data = await blobToDataURL(map.get(av.id)); } catch (e) { /* 跳过 */ }
        }
      }
      return out;
    },

    async importAll(json) {
      if (!json || !Array.isArray(json.records)) throw new Error('备份文件格式不正确');
      const profile = Object.assign({}, DEFAULT_PROFILE, json.profile || {}, { onboarded: true });
      const records = [];
      for (const rec of json.records) {
        const images = [];
        for (const ref of rec.images || []) {
          const copy = Object.assign({}, ref);
          copy.id = ref.id || UI.uid();
          if (copy.data && idbReady) {
            try {
              const blob = await dataURLToBlob(copy.data);
              await idbPut({ id: copy.id, blob: blob });
              delete copy.data;
            } catch (e) { /* 保留 data */ }
          }
          images.push(copy);
        }
        records.push(Object.assign({}, rec, {
          id: rec.id || UI.uid(),
          images: images,
          createdAt: rec.createdAt || Date.now()
        }));
      }
      data = { profile: profile, records: records };
      commit();
    },

    clearAll() {
      data = { profile: Object.assign({}, DEFAULT_PROFILE, { onboarded: true }), records: [] };
      commit();
    }
  };

  function dataURLToBlob(dataURL) {
    return new Promise((resolve, reject) => {
      try {
        const parts = String(dataURL).split(',');
        const mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
        const bin = atob(parts[1] || '');
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        resolve(new Blob([arr], { type: mime }));
      } catch (err) {
        reject(err);
      }
    });
  }

  global.Store = Store;
})(window);
