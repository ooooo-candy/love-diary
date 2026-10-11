/* 本地模拟服务端：与 cloud/api/index.js 行为一致，
 * 用于没有配置云端时也能完整跑通「注册 → 登录 → 找回密码 → 记录 → 照片」全流程。
 * 仅本机演示用：数据存在 localStorage（密码也是明文，勿当真）。
 */
(function (global) {
  'use strict';

  const KEY = 'love-diary:mockdb';
  const TOKEN_DAYS = 30;
  const MAX_ANSWER_FAILS = 5;
  const LOCK_MINUTES = 10;

  let db = null;

  function load() {
    try {
      db = JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch (err) {
      db = null;
    }
    if (!db || !db.users) db = { users: [], books: [], records: [], files: {}, emailCodes: [] };
    if (!db.files) db.files = {};
    if (!db.emailCodes) db.emailCodes = [];
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

  function fail(message, code) {
    const e = new Error(message);
    e.apiCode = code || 'ERROR';
    throw e;
  }

  function normUsername(u) {
    return String(u || '').trim().toLowerCase();
  }

  function normAnswer(a) {
    return String(a || '')
      .trim()
      .toLowerCase()
      .replace(/[\s\-_·.,，。、!！?？'"'']/g, '');
  }

  function makeRecoveryCode() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    const part = () => rand(4, chars);
    return (part() + '-' + part() + '-' + part() + '-' + part()).toUpperCase();
  }

  function publicUser(u) {
    return {
      uid: u._id,
      username: u.username,
      nickname: u.nickname || '',
      avatar: u.avatar || null,
      bookId: u.bookId || null,
      question: u.question || ''
    };
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

  function consumeLocalCode(email, code, scene) {
    const now = Date.now();
    const rows = db.emailCodes.filter(
      (c) => c.email === email && c.scene === scene && c.code === code && !c.used
    );
    const row = rows[rows.length - 1];
    if (!row) fail('验证码不正确', 'CODE_WRONG');
    if (row.expiresAt < now) fail('验证码已过期，请重新获取', 'CODE_EXPIRED');
    row.used = true;
  }

  function findByIdentifier(idf) {
    const v = String(idf || '').trim().toLowerCase();
    if (!v) return null;
    if (v.indexOf('@') >= 0) return db.users.filter((x) => x.email === v)[0] || null;
    return db.users.filter((x) => x.username === v)[0] || null;
  }

  function findUser(uid, token) {
    if (!uid || !token) fail('请先登录', 'NO_AUTH');
    const u = db.users.filter((x) => x._id === uid)[0];
    if (!u) fail('账号不存在，请重新登录', 'NO_USER');
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

  function newToken() {
    return { t: rand(40), exp: now() + TOKEN_DAYS * 86400000 };
  }

  function attachToken(u, token) {
    u.tokens = (u.tokens || []).filter((x) => x.exp > now()).slice(-4);
    u.tokens.push(token);
  }

  const handlers = {
    async ping() {
      return { ok: true, users: db.users.length, books: db.books.length, records: db.records.length };
    },

    async sendEmailCode(p) {
      const email = String(p.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('邮箱格式看起来不太对', 'BAD_EMAIL');
      const scene = ['register', 'reset', 'bind'].indexOf(p.scene) >= 0 ? p.scene : 'register';
      if (scene === 'reset' && !db.users.some((x) => x.email === email)) fail('这个邮箱还没有绑定过账号', 'NO_USER');
      if (scene === 'bind') {
        const other = db.users.filter((x) => x.email === email)[0];
        if (other && other._id !== p.uid) fail('这个邮箱已经绑给别的账号了', 'EMAIL_TAKEN');
      }
      const now = Date.now();
      const recent = db.emailCodes
        .filter((c) => c.email === email && c.scene === scene)
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      if (recent && now - recent.createdAt < 60000) fail('验证码刚发过啦，稍等一下再试', 'TOO_FAST');
      const code = String(Math.floor(100000 + Math.random() * 900000));
      db.emailCodes.push({ email, code, scene, used: false, expiresAt: now + 600000, createdAt: now });
      save();
      // 本地演示：不发真邮件，直接把验证码返回
      return { sent: false, expiresInMinutes: 10, devCode: code };
    },

    async resetByEmailCode(p) {
      const email = String(p.email || '').trim().toLowerCase();
      const u = db.users.filter((x) => x.email === email)[0];
      if (!u) fail('这个邮箱还没有绑定过账号', 'NO_USER');
      if (String(p.password || '').length < 6) fail('密码至少 6 位', 'WEAK_PASSWORD');
      consumeLocalCode(email, String(p.code || '').trim(), 'reset');
      u.password = String(p.password);
      u.answerFails = 0;
      u.answerLockUntil = 0;
      const token = newToken();
      u.tokens = [token];
      save();
      return { uid: u._id, token: token.t, user: publicUser(u) };
    },

    async bindEmail(p) {
      const u = findUser(p.uid, p.token);
      const email = String(p.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('邮箱格式看起来不太对', 'BAD_EMAIL');
      const other = db.users.filter((x) => x.email === email)[0];
      if (other && other._id !== u._id) fail('这个邮箱已经绑给别的账号了', 'EMAIL_TAKEN');
      consumeLocalCode(email, String(p.code || '').trim(), 'bind');
      u.email = email;
      save();
      return { user: publicUser(u) };
    },

    async unbindEmail(p) {
      const u = findUser(p.uid, p.token);
      if (u.password !== String(p.password || '')) fail('密码不正确', 'BAD_PASSWORD');
      u.email = '';
      save();
      return { user: publicUser(u) };
    },

    async register(p) {
      const email = String(p.email || '').trim().toLowerCase();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('邮箱格式看起来不太对', 'BAD_EMAIL');
      let username = normUsername(p.username);
      if (username) {
        if (!/^[a-z0-9_]{3,20}$/.test(username)) fail('用户名需 3~20 位字母、数字或下划线', 'BAD_USERNAME');
        if (db.users.some((x) => x.username === username)) fail('这个用户名已经被用了，换一个吧', 'USERNAME_TAKEN');
      } else {
        if (!email) fail('请填写用户名或邮箱', 'NO_IDENTITY');
        const base = (email.split('@')[0] || 'user').replace(/[^a-z0-9_]/g, '').slice(0, 12) || 'user';
        let candidate = base;
        let i = 1;
        while (candidate.length < 3 || db.users.some((x) => x.username === candidate)) {
          candidate = base + i;
          i++;
          if (i > 500) { candidate = 'u' + rand(8); break; }
        }
        username = candidate;
      }
      if (email) {
        if (db.users.some((x) => x.email === email)) fail('这个邮箱已经注册过了，直接登录吧', 'EMAIL_TAKEN');
        const ec = String(p.emailCode || '').trim();
        if (!/^\d{6}$/.test(ec)) fail('请先获取邮箱验证码', 'NO_EMAIL_CODE');
        consumeLocalCode(email, ec, 'register');
      }
      if (String(p.password || '').length < 6) fail('密码至少 6 位', 'WEAK_PASSWORD');
      if (!String(p.question || '').trim()) fail('请选择或填写密保问题', 'BAD_QUESTION');
      const answer = normAnswer(p.answer);
      if (answer.length < 2) fail('密保答案至少 2 个字符', 'BAD_ANSWER');

      const recovery = makeRecoveryCode();
      const token = newToken();
      const u = {
        _id: 'u_' + rand(10),
        username: username,
        email: email,
        nickname: p.nickname ? String(p.nickname).slice(0, 24) : username,
        avatar: null,
        bookId: null,
        password: String(p.password), // 仅本地演示
        question: String(p.question).slice(0, 60),
        answer: answer,
        recoveryCode: recovery,
        answerFails: 0,
        answerLockUntil: 0,
        tokens: [],
        createdAt: now()
      };
      attachToken(u, token);
      db.users.push(u);
      save();
      return { uid: u._id, token: token.t, user: publicUser(u), recoveryCode: recovery };
    },

    async login(p) {
      const idf = String(p.identifier || p.username || '').trim().toLowerCase();
      const u = idf.indexOf('@') >= 0
        ? db.users.filter((x) => x.email === idf)[0]
        : db.users.filter((x) => x.username === idf)[0];
      if (!u || u.password !== String(p.password || '')) fail('账号或密码不对', 'BAD_LOGIN');
      const token = newToken();
      attachToken(u, token);
      save();
      return { uid: u._id, token: token.t, user: publicUser(u) };
    },

    async updateEmail(p) {
      const u = findUser(p.uid, p.token);
      if (u.password !== String(p.password || '')) fail('密码不正确', 'BAD_PASSWORD');
      const email = String(p.email || '').trim().toLowerCase();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('邮箱格式看起来不太对', 'BAD_EMAIL');
      if (email && db.users.some((x) => x.email === email && x._id !== u._id)) fail('这个邮箱已经绑给别的账号了', 'EMAIL_TAKEN');
      u.email = email;
      save();
      return { user: publicUser(u) };
    },

    async securityQuestion(p) {
      const idf = String(p.identifier || p.username || '').trim().toLowerCase();
      const u = idf.indexOf('@') >= 0
        ? db.users.filter((x) => x.email === idf)[0]
        : db.users.filter((x) => x.username === idf)[0];
      if (!u) fail('没有找到这个账号', 'NO_USER');
      const lockedUntil = Number(u.answerLockUntil || 0);
      const locked = lockedUntil > now();
      return {
        question: u.question || '',
        locked: locked,
        lockedMinutes: locked ? Math.ceil((lockedUntil - now()) / 60000) : 0
      };
    },

    async resetByAnswer(p) {
      if (String(p.password || '').length < 6) fail('密码至少 6 位', 'WEAK_PASSWORD');
      const u = findByIdentifier(p.identifier || p.username);
      if (!u) fail('没有找到这个账号', 'NO_USER');
      const lockedUntil = Number(u.answerLockUntil || 0);
      if (lockedUntil > now()) fail('尝试次数过多，请稍后再试', 'LOCKED');
      if (normAnswer(p.answer) !== u.answer) {
        u.answerFails = Number(u.answerFails || 0) + 1;
        if (u.answerFails >= MAX_ANSWER_FAILS) {
          u.answerFails = 0;
          u.answerLockUntil = now() + LOCK_MINUTES * 60000;
          save();
          fail('答案错误次数过多，已锁定 ' + LOCK_MINUTES + ' 分钟', 'LOCKED');
        }
        save();
        fail('密保答案不对，还可以试 ' + (MAX_ANSWER_FAILS - u.answerFails) + ' 次', 'BAD_ANSWER');
      }
      u.password = String(p.password);
      u.answerFails = 0;
      u.answerLockUntil = 0;
      const token = newToken();
      u.tokens = [token];
      save();
      return { uid: u._id, token: token.t, user: publicUser(u) };
    },

    async resetByCode(p) {
      if (String(p.password || '').length < 6) fail('密码至少 6 位', 'WEAK_PASSWORD');
      const u = findByIdentifier(p.identifier || p.username);
      if (!u) fail('没有找到这个账号', 'NO_USER');
      const code = String(p.recoveryCode || '').trim().toUpperCase();
      if (!u.recoveryCode || code !== u.recoveryCode) fail('恢复码不正确', 'BAD_CODE');
      u.password = String(p.password);
      const token = newToken();
      u.tokens = [token];
      save();
      return { uid: u._id, token: token.t, user: publicUser(u) };
    },

    async changePassword(p) {
      const u = findUser(p.uid, p.token);
      if (u.password !== String(p.oldPassword || '')) fail('原密码不正确', 'BAD_PASSWORD');
      if (String(p.password || '').length < 6) fail('新密码至少 6 位', 'WEAK_PASSWORD');
      u.password = String(p.password);
      save();
      return { ok: true };
    },

    async updateSecurity(p) {
      const u = findUser(p.uid, p.token);
      if (u.password !== String(p.password || '')) fail('密码不正确', 'BAD_PASSWORD');
      if (!String(p.question || '').trim()) fail('请选择或填写密保问题', 'BAD_QUESTION');
      const answer = normAnswer(p.answer);
      if (answer.length < 2) fail('密保答案至少 2 个字符', 'BAD_ANSWER');
      u.question = String(p.question).slice(0, 60);
      u.answer = answer;
      u.answerFails = 0;
      u.answerLockUntil = 0;
      save();
      return { user: publicUser(u) };
    },

    async regenerateRecovery(p) {
      const u = findUser(p.uid, p.token);
      if (u.password !== String(p.password || '')) fail('密码不正确', 'BAD_PASSWORD');
      const recovery = makeRecoveryCode();
      u.recoveryCode = recovery;
      save();
      return { recoveryCode: recovery };
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
        myName: p.myName || u.nickname || '我',
        partnerName: p.partnerName || '宝贝',
        anniversary: p.anniversary || '',
        palette: p.palette || 'pink',
        theme: p.theme || 'light',
        events: [],
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
        authorName: u.nickname || u.username,
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

    async uploadImage(p) {
      findUser(p.uid, p.token);
      const b64 = String(p.base64 || '');
      if (!b64) fail('没有图片内容', 'NO_FILE');
      const fileId = 'mockfile_' + rand(12);
      db.files[fileId] = b64;
      save();
      return { fileId: fileId };
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
    /* 兼容旧的直接上传入口（用于 Store.addImages 的本地模式） */
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
