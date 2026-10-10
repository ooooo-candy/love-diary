/* 本地模拟服务端：与 cloud/api/index.js 行为一致，
 * 用于在还没开通 CloudBase 时完整跑通「注册登录 → 邀请码 → 记录 → 照片」全流程。
 * 数据保存在 localStorage，仅供本机体验，不会同步到任何地方。
 */
(function (global) {
  'use strict';

  const KEY = 'love-diary:mockdb';
  const TOKEN_DAYS = 30;
  const CODE_MINUTES = 10;

  let db = null;

  function load() {
    try {
      db = JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch (err) {
      db = null;
    }
    if (!db || !db.users) {
      db = { users: [], books: [], records: [], codes: [], files: {} };
    }
    return db;
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify(db));
  }

  const delay = (ms) => new Promise((r) => setTimeout(r, ms == null ? 200 : ms));
  const now = () => Date.now();

  function rand(len, chars) {
    chars = chars || 'abcdefghijkmnpqrstuvwxyz23456789';
    let s = '';
    for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  function numCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  function fail(message, code) {
    const e = new Error(message);
    e.apiCode = code || 'ERROR';
    throw e;
  }

  function publicUser(u) {
    return { uid: u._id, phone: u.phone, nickname: u.nickname || '', avatar: u.avatar || null, bookId: u.bookId || null };
  }

  function publicBook(b) {
    if (!b) return null;
    return {
      id: b._id,
      code: b.code,
      title: b.title || '我们的小日子',
      myName: b.myName || '我',
      partnerName: b.partnerName || '宝贝',
      anniversary: b.anniversary || '',
      palette: b.palette || 'pink',
      theme: b.theme || 'light',
      myAvatar: b.myAvatar || null,
      partnerAvatar: b.partnerAvatar || null,
      events: b.events || [],
      members: b.members || [],
      createdBy: b.createdBy || ''
    };
  }

  function publicRecord(r) {
    return {
      id: r._id,
      authorId: r.authorId || '',
      authorName: r.authorName || '',
      date: r.date,
      title: r.title || '',
      note: r.note || '',
      place: r.place || '',
      mood: r.mood || 'sweet',
      tags: r.tags || [],
      images: r.images || [],
      createdAt: r.createdAt || 0,
      updatedAt: r.updatedAt || 0
    };
  }

  function maskPhone(p) {
    return String(p).replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
  }

  function findUser(uid, token) {
    if (!uid || !token) fail('请先登录', 'NO_AUTH');
    const u = db.users.filter((x) => x._id === uid)[0];
    if (!u) fail('账号不存在', 'NO_USER');
    const t = (u.tokens || []).filter((x) => x.t === token)[0];
    if (!t) fail('登录已失效，请重新登录', 'TOKEN_INVALID');
    if (t.exp < now()) fail('登录已过期，请重新登录', 'TOKEN_EXPIRED');
    return u;
  }

  function bookOfUser(u) {
    if (!u.bookId) return null;
    const b = db.books.filter((x) => x._id === u.bookId)[0];
    if (b && (b.members || []).indexOf(u._id) < 0) return null;
    return b || null;
  }

  const handlers = {
    async sendCode(p) {
      const phone = String(p.phone || '').replace(/\D/g, '');
      if (!/^1\d{10}$/.test(phone)) fail('请输入正确的手机号', 'BAD_PHONE');
      const code = numCode();
      db.codes.push({ _id: 'c_' + rand(8), phone: phone, code: code, used: false, expiresAt: now() + CODE_MINUTES * 60000, createdAt: now() });
      save();
      return { sent: false, expiresInMinutes: CODE_MINUTES, devCode: code };
    },

    async signIn(p) {
      const phone = String(p.phone || '').replace(/\D/g, '');
      const code = String(p.code || '').trim();
      if (!/^1\d{10}$/.test(phone)) fail('请输入正确的手机号', 'BAD_PHONE');
      if (!/^\d{6}$/.test(code)) fail('请输入 6 位验证码', 'BAD_CODE');
      const rows = db.codes.filter((x) => x.phone === phone && x.code === code && !x.used);
      const row = rows[rows.length - 1];
      if (!row) fail('验证码不正确', 'CODE_WRONG');
      if (row.expiresAt < now()) fail('验证码已过期', 'CODE_EXPIRED');
      row.used = true;

      let u = db.users.filter((x) => x.phone === phone)[0];
      const token = { t: rand(40), exp: now() + TOKEN_DAYS * 86400000 };
      if (!u) {
        u = { _id: 'u_' + rand(10), phone: phone, nickname: '', avatar: null, bookId: null, tokens: [token], createdAt: now() };
        db.users.push(u);
      } else {
        u.tokens = (u.tokens || []).filter((x) => x.exp > now()).slice(-4);
        u.tokens.push(token);
      }
      save();
      return { uid: u._id, token: token.t, expiresAt: token.exp, user: publicUser(u) };
    },

    async register(p) {
      const phone = String(p.phone || '').replace(/\D/g, '');
      const code = String(p.code || '').trim();
      const password = String(p.password || '');
      if (!/^1\d{10}$/.test(phone)) fail('请输入正确的手机号', 'BAD_PHONE');
      if (password.length < 6) fail('密码至少 6 位', 'WEAK_PASSWORD');
      const existed = db.users.filter((x) => x.phone === phone)[0];
      if (existed && existed.password) fail('该手机号已经注册过了，直接登录吧', 'PHONE_TAKEN');
      const rows = db.codes.filter((x) => x.phone === phone && x.code === code && !x.used);
      const row = rows[rows.length - 1];
      if (!row) fail('验证码不正确', 'CODE_WRONG');
      if (row.expiresAt < now()) fail('验证码已过期', 'CODE_EXPIRED');
      row.used = true;

      const token = { t: rand(40), exp: now() + TOKEN_DAYS * 86400000 };
      let u = existed;
      if (!u) {
        u = { _id: 'u_' + rand(10), phone: phone, nickname: '', avatar: null, bookId: null, tokens: [], createdAt: now() };
        db.users.push(u);
      }
      u.password = password; // 本地演示模式，仅存在本机
      u.tokens = (u.tokens || []).filter((x) => x.exp > now()).slice(-4);
      u.tokens.push(token);
      save();
      return { uid: u._id, token: token.t, expiresAt: token.exp, user: publicUser(u) };
    },

    async login(p) {
      const phone = String(p.phone || '').replace(/\D/g, '');
      const password = String(p.password || '');
      const u = db.users.filter((x) => x.phone === phone)[0];
      if (!u) fail('这个手机号还没注册', 'NO_USER');
      if (!u.password) fail('这个账号还没设置密码，请点「忘记密码」设置一个', 'NO_PASSWORD');
      if (u.password !== password) fail('手机号或密码不正确', 'BAD_PASSWORD');
      const token = { t: rand(40), exp: now() + TOKEN_DAYS * 86400000 };
      u.tokens = (u.tokens || []).filter((x) => x.exp > now()).slice(-4);
      u.tokens.push(token);
      save();
      return { uid: u._id, token: token.t, expiresAt: token.exp, user: publicUser(u) };
    },

    async resetPassword(p) {
      const phone = String(p.phone || '').replace(/\D/g, '');
      const code = String(p.code || '').trim();
      const password = String(p.password || '');
      if (password.length < 6) fail('密码至少 6 位', 'WEAK_PASSWORD');
      const u = db.users.filter((x) => x.phone === phone)[0];
      if (!u) fail('这个手机号还没注册', 'NO_USER');
      const rows = db.codes.filter((x) => x.phone === phone && x.code === code && !x.used);
      const row = rows[rows.length - 1];
      if (!row) fail('验证码不正确', 'CODE_WRONG');
      if (row.expiresAt < now()) fail('验证码已过期', 'CODE_EXPIRED');
      row.used = true;
      u.password = password;
      const token = { t: rand(40), exp: now() + TOKEN_DAYS * 86400000 };
      u.tokens = [token];
      save();
      return { uid: u._id, token: token.t, expiresAt: token.exp, user: publicUser(u) };
    },

    async changePassword(p) {
      const u = findUser(p.uid, p.token);
      if (String(p.password || '').length < 6) fail('密码至少 6 位', 'WEAK_PASSWORD');
      if (u.password && u.password !== p.oldPassword) fail('原密码不正确', 'BAD_PASSWORD');
      u.password = String(p.password);
      save();
      return { ok: true };
    },

    async signOut(p) {
      const u = findUser(p.uid, p.token);
      u.tokens = (u.tokens || []).filter((x) => x.t !== p.token);
      save();
      return { ok: true };
    },

    async me(p) {
      const u = findUser(p.uid, p.token);
      return { user: publicUser(u), book: publicBook(bookOfUser(u)) };
    },

    async updateUser(p) {
      const u = findUser(p.uid, p.token);
      if (p.nickname != null) u.nickname = String(p.nickname).slice(0, 24);
      if (p.avatar !== undefined) u.avatar = p.avatar;
      save();
      return { user: publicUser(u) };
    },

    async createBook(p) {
      const u = findUser(p.uid, p.token);
      if (u.bookId) return { book: publicBook(bookOfUser(u)) };
      let code = rand(6).toUpperCase();
      while (db.books.some((b) => b.code === code)) code = rand(6).toUpperCase();
      const b = {
        _id: 'b_' + rand(10),
        code: code,
        title: p.title || '我们的小日子',
        myName: p.myName || '我',
        partnerName: p.partnerName || '宝贝',
        anniversary: p.anniversary || '',
        palette: p.palette || 'pink',
        theme: p.theme || 'light',
        members: [u._id],
        createdBy: u._id,
        createdAt: now()
      };
      db.books.push(b);
      u.bookId = b._id;
      save();
      return { book: publicBook(b) };
    },

    async joinBook(p) {
      const u = findUser(p.uid, p.token);
      const code = String(p.code || '').trim().toUpperCase();
      if (!code) fail('请输入邀请码', 'NO_CODE');
      const b = db.books.filter((x) => x.code === code)[0];
      if (!b) fail('邀请码不存在', 'NO_BOOK');
      if ((b.members || []).length >= 2 && (b.members || []).indexOf(u._id) < 0) fail('这个本子已经有两位主人啦', 'BOOK_FULL');
      b.members = Array.from(new Set((b.members || []).concat([u._id])));
      u.bookId = b._id;
      save();
      return { book: publicBook(b) };
    },

    async leaveBook(p) {
      const u = findUser(p.uid, p.token);
      if (u.bookId) {
        const b = db.books.filter((x) => x._id === u.bookId)[0];
        if (b) b.members = (b.members || []).filter((m) => m !== u._id);
        u.bookId = null;
        save();
      }
      return { ok: true };
    },

    async updateBook(p) {
      const u = findUser(p.uid, p.token);
      const b = bookOfUser(u);
      if (!b) fail('还没有加入任何本子', 'NO_BOOK');
      ['title', 'myName', 'partnerName', 'anniversary', 'palette', 'theme', 'myAvatar', 'partnerAvatar', 'events'].forEach((k) => {
        if (p[k] !== undefined) b[k] = p[k];
      });
      b.updatedAt = now();
      save();
      return { book: publicBook(b) };
    },

    async listRecords(p) {
      const u = findUser(p.uid, p.token);
      const b = bookOfUser(u);
      if (!b) return { book: null, records: [] };
      const list = db.records
        .filter((r) => r.bookId === b._id)
        .sort((a, c) => (a.date < c.date ? 1 : a.date > c.date ? -1 : (c.createdAt || 0) - (a.createdAt || 0)))
        .slice(0, 500)
        .map(publicRecord);
      return { book: publicBook(b), records: list };
    },

    async upsertRecord(p) {
      const u = findUser(p.uid, p.token);
      const b = bookOfUser(u);
      if (!b) fail('还没有加入任何本子', 'NO_BOOK');
      const input = p.record || {};
      const doc = {
        date: input.date || new Date().toISOString().slice(0, 10),
        title: String(input.title || '').slice(0, 60),
        note: String(input.note || '').slice(0, 5000),
        place: String(input.place || '').slice(0, 60),
        mood: input.mood || 'sweet',
        tags: (input.tags || []).slice(0, 12),
        images: (input.images || []).slice(0, 9),
        authorId: u._id,
        authorName: u.nickname || maskPhone(u.phone),
        bookId: b._id,
        updatedAt: now()
      };
      if (input.id) {
        const old = db.records.filter((r) => r._id === input.id)[0];
        if (!old || old.bookId !== b._id) fail('记录不存在', 'NO_RECORD');
        Object.assign(old, doc);
        old.createdAt = old.createdAt || now();
        save();
        return { record: publicRecord(old) };
      }
      const rec = Object.assign({ _id: 'r_' + rand(10), createdAt: now() }, doc);
      db.records.push(rec);
      save();
      return { record: publicRecord(rec) };
    },

    async removeRecord(p) {
      const u = findUser(p.uid, p.token);
      const b = bookOfUser(u);
      const rec = db.records.filter((r) => r._id === p.id)[0];
      if (!b || !rec || rec.bookId !== b._id) fail('记录不存在', 'NO_RECORD');
      db.records = db.records.filter((r) => r._id !== p.id);
      save();
      return { ok: true, images: rec.images || [] };
    },

    async getFileUrl(p) {
      findUser(p.uid, p.token);
      const urls = {};
      (p.fileIds || []).forEach((id) => {
        urls[id] = db.files[id] || '';
      });
      return { urls: urls };
    }
  };

  global.MockCloud = {
    init() {
      load();
    },
    async handle(action, payload) {
      await delay();
      const h = handlers[action];
      if (!h) fail('未知的操作：' + action, 'NO_ACTION');
      return await h(payload || {});
    },
    async upload(file) {
      const dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(new Error('图片读取失败'));
        fr.readAsDataURL(file);
      });
      const fileId = 'mockfile_' + rand(12);
      db.files[fileId] = dataUrl;
      save();
      return { fileId: fileId };
    },
    urls(fileIds) {
      const map = {};
      (fileIds || []).forEach((id) => {
        map[id] = db.files[id] || '';
      });
      return Promise.resolve(map);
    }
  };
})(window);
