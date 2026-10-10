/* 我们的小日子 · 云端接口（CloudBase 云函数）
 *
 * 存储方案：整份数据作为一个 JSON 文件存放在云存储（love-diary/db.json），
 * 好处是「开通环境即可用」，不需要额外开通云数据库、也不需要手动建集合。
 * 数据量小（两人使用），读写一份 JSON 完全够用；照片单独存云存储。
 *
 * HTTP 访问服务（无需前端登录态即可调用），业务身份用我们自己签发的 token 校验。
 */
const cloudbase = require('@cloudbase/node-sdk');
const fs = require('fs');
const crypto = require('crypto');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV || process.env.TCB_ENV });

const DB_PATH = 'love-diary/db.json';
const TOKEN_DAYS = 30;
const CODE_MINUTES = 10;
const MAX_IMAGES = 9;

const EMPTY = { users: [], books: [], records: [], codes: [] };

/* ---------------- 存储：读写云存储里的 JSON ---------------- */

let fileIdPrefix = null;

/* 云存储的 fileID 形如 cloud://<env>.<bucket>/<path>，前缀（含 bucket）需要先探一次 */
async function fileIDOf(cloudPath) {
  if (!fileIdPrefix) {
    const up = await app.uploadFile({
      cloudPath: 'love-diary/__probe.txt',
      fileContent: Buffer.from('probe')
    });
    const id = up && up.fileID;
    if (!id || id.indexOf('//') < 0) throw new Error('无法获取云存储信息');
    // fileID: cloud://<env>.<bucket>/<path> —— 需要协议之后的第一个斜杠
    const slash = id.indexOf('/', id.indexOf('//') + 2);
    if (slash < 0) throw new Error('无法解析云存储路径');
    fileIdPrefix = id.slice(0, slash);
  }
  return fileIdPrefix + '/' + cloudPath;
}

let lastLoadError = null;

async function loadDB() {
  try {
    const fileID = await fileIDOf(DB_PATH);
    const res = await app.getTempFileURL({ fileList: [{ fileID: fileID, maxAge: 60 }] });
    const url = (res.fileList || [])[0] && (res.fileList || [])[0].tempFileURL;
    if (!url) {
      lastLoadError = 'no temp url';
      return JSON.parse(JSON.stringify(EMPTY));
    }
    // 追加时间戳，避免命中 CDN 上的旧版本
    const sep = url.indexOf('?') >= 0 ? '&' : '?';
    const resp = await fetch(url + sep + 't=' + Date.now(), {
      headers: { 'Cache-Control': 'no-cache' }
    });
    const text = await resp.text();
    if (!text) {
      lastLoadError = 'empty file';
      return JSON.parse(JSON.stringify(EMPTY));
    }
    const data = JSON.parse(text);
    lastLoadError = null;
    return Object.assign(JSON.parse(JSON.stringify(EMPTY)), data);
  } catch (err) {
    lastLoadError = String((err && err.message) || err).slice(0, 200);
    return JSON.parse(JSON.stringify(EMPTY));
  }
}

async function saveDB(data) {
  const buffer = Buffer.from(JSON.stringify(data), 'utf8');
  try {
    await app.uploadFile({
      cloudPath: DB_PATH,
      fileContent: buffer,
      headers: { 'Cache-Control': 'no-cache', 'Content-Type': 'application/json' }
    });
  } catch (err) {
    // 部分版本不支持 headers，降级为普通上传
    await app.uploadFile({ cloudPath: DB_PATH, fileContent: buffer });
  }
}

/* ---------------- 工具 ---------------- */

function rand(len, chars) {
  chars = chars || 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function numCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/* ---------------- 密码 ---------------- */

function assertPassword(password) {
  const p = String(password || '');
  if (p.length < 6) fail('密码至少 6 位', 'WEAK_PASSWORD');
  if (p.length > 32) fail('密码最长 32 位', 'LONG_PASSWORD');
  return p;
}

/* 加盐哈希，明文不落库 */
function makePassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return { passwordSalt: salt, passwordHash: hash };
}

function checkPassword(user, password) {
  if (!user || !user.passwordHash || !user.passwordSalt) return false;
  try {
    const hash = crypto.scryptSync(String(password || ''), user.passwordSalt, 32);
    const saved = Buffer.from(user.passwordHash, 'hex');
    return hash.length === saved.length && crypto.timingSafeEqual(hash, saved);
  } catch (err) {
    return false;
  }
}

/* 校验并消费一条验证码 */
function consumeCode(db, phone, code) {
  const now = Date.now();
  const rows = db.codes.filter((c) => c.phone === phone && c.code === code && !c.used);
  const row = rows[rows.length - 1];
  if (!row) fail('验证码不正确', 'CODE_WRONG');
  if (row.expiresAt < now) fail('验证码已过期', 'CODE_EXPIRED');
  row.used = true;
}

function fail(message, code) {
  const err = new Error(message);
  err.apiCode = code || 'ERROR';
  throw err;
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

function findUser(db, uid, token) {
  if (!uid || !token) fail('请先登录', 'NO_AUTH');
  const u = db.users.filter((x) => x._id === uid)[0];
  if (!u) fail('账号不存在，请重新登录', 'NO_USER');
  const t = (u.tokens || []).filter((x) => x.t === token)[0];
  if (!t) fail('登录已失效，请重新登录', 'TOKEN_INVALID');
  if (t.exp < Date.now()) fail('登录已过期，请重新登录', 'TOKEN_EXPIRED');
  return u;
}

function bookOfUser(db, u) {
  if (!u.bookId) return null;
  const b = db.books.filter((x) => x._id === u.bookId)[0];
  if (b && (b.members || []).indexOf(u._id) < 0) return null;
  return b || null;
}

function issueToken() {
  return { t: rand(40), exp: Date.now() + TOKEN_DAYS * 86400000 };
}

/* ---------------- 短信 ---------------- */

async function sendRealSms(phone, code) {
  const { SMS_SECRET_ID, SMS_SECRET_KEY, SMS_SDK_APP_ID, SMS_TEMPLATE_ID, SMS_SIGN } = process.env;
  if (!SMS_SECRET_ID || !SMS_SECRET_KEY) return false;
  try {
    const tencentcloud = require('tencentcloud-sdk-nodejs-sms');
    const client = new tencentcloud.sms.v20210111.Client({
      credential: { secretId: SMS_SECRET_ID, secretKey: SMS_SECRET_KEY },
      region: 'ap-guangzhou',
      profile: { httpProfile: { endpoint: 'sms.tencentcloudapi.com' } }
    });
    await client.SendSms({
      SmsSdkAppId: SMS_SDK_APP_ID,
      SignName: SMS_SIGN,
      TemplateId: SMS_TEMPLATE_ID,
      TemplateParamSet: [code, String(CODE_MINUTES)],
      PhoneNumberSet: ['+86' + phone]
    });
    return true;
  } catch (err) {
    console.error('sms failed', err);
    throw new Error('短信发送失败：' + (err.message || ''));
  }
}

/* ---------------- 接口实现 ---------------- */

const handlers = {
  /* 服务自检 */
  async ping() {
    const db = await loadDB();
    return {
      ok: true,
      users: db.users.length,
      books: db.books.length,
      records: db.records.length,
      smsReady: Boolean(process.env.SMS_SECRET_ID && process.env.SMS_SECRET_KEY)
    };
  },

  /* 发送验证码 */
  async sendCode(payload) {
    const db = await loadDB();
    const phone = String(payload.phone || '').replace(/\D/g, '');
    if (!/^1\d{10}$/.test(phone)) fail('请输入正确的手机号', 'BAD_PHONE');

    const now = Date.now();
    const recent = db.codes.filter((c) => c.phone === phone).pop();
    if (recent && now - (recent.createdAt || 0) < 60000) fail('验证码已发送，请稍后再试', 'TOO_FAST');

    const code = numCode();
    db.codes.push({ _id: 'c_' + rand(8), phone: phone, code: code, used: false, expiresAt: now + CODE_MINUTES * 60000, createdAt: now });
    if (db.codes.length > 200) db.codes = db.codes.slice(-200);
    await saveDB(db);

    const sent = await sendRealSms(phone, code);
    return { sent: sent, expiresInMinutes: CODE_MINUTES, devCode: sent ? undefined : code };
  },

  /* 验证码登录 / 注册 */
  async signIn(payload) {
    const db = await loadDB();
    const phone = String(payload.phone || '').replace(/\D/g, '');
    const code = String(payload.code || '').trim();
    if (!/^1\d{10}$/.test(phone)) fail('请输入正确的手机号', 'BAD_PHONE');
    if (!/^\d{6}$/.test(code)) fail('请输入 6 位验证码', 'BAD_CODE');

    const now = Date.now();
    const rows = db.codes.filter((c) => c.phone === phone && c.code === code && !c.used);
    const row = rows[rows.length - 1];
    if (!row) fail('验证码不正确', 'CODE_WRONG');
    if (row.expiresAt < now) fail('验证码已过期', 'CODE_EXPIRED');
    row.used = true;

    let u = db.users.filter((x) => x.phone === phone)[0];
    const token = issueToken();
    if (!u) {
      u = { _id: 'u_' + now.toString(36) + rand(8), phone: phone, nickname: '', avatar: null, bookId: null, tokens: [token], createdAt: now };
      db.users.push(u);
    } else {
      u.tokens = (u.tokens || []).filter((x) => x.exp > now).slice(-4);
      u.tokens.push(token);
    }
    await saveDB(db);
    return { uid: u._id, token: token.t, expiresAt: token.exp, user: publicUser(u) };
  },

  /* 注册：手机号 + 验证码 + 密码（手机号即登录账号） */
  async register(payload) {
    const db = await loadDB();
    const phone = String(payload.phone || '').replace(/\D/g, '');
    const code = String(payload.code || '').trim();
    const password = assertPassword(payload.password);
    if (!/^1\d{10}$/.test(phone)) fail('请输入正确的手机号', 'BAD_PHONE');

    const existed = db.users.filter((x) => x.phone === phone)[0];
    if (existed && existed.passwordHash) fail('该手机号已经注册过了，直接登录吧', 'PHONE_TAKEN');

    consumeCode(db, phone, code);

    const now = Date.now();
    const token = issueToken();
    let u = existed;
    if (!u) {
      u = {
        _id: 'u_' + now.toString(36) + rand(8),
        phone: phone,
        nickname: payload.nickname ? String(payload.nickname).slice(0, 24) : '',
        avatar: null,
        bookId: null,
        tokens: [],
        createdAt: now
      };
      db.users.push(u);
    }
    Object.assign(u, makePassword(password));
    u.tokens = (u.tokens || []).filter((x) => x.exp > now).slice(-4);
    u.tokens.push(token);
    await saveDB(db);
    return { uid: u._id, token: token.t, expiresAt: token.exp, user: publicUser(u) };
  },

  /* 密码登录 */
  async login(payload) {
    const db = await loadDB();
    const phone = String(payload.phone || '').replace(/\D/g, '');
    const password = String(payload.password || '');
    if (!/^1\d{10}$/.test(phone)) fail('请输入正确的手机号', 'BAD_PHONE');

    const u = db.users.filter((x) => x.phone === phone)[0];
    if (!u) fail('这个手机号还没注册', 'NO_USER');
    if (!u.passwordHash) fail('这个账号还没设置密码，请点「忘记密码」设置一个', 'NO_PASSWORD');
    if (!checkPassword(u, password)) fail('手机号或密码不正确', 'BAD_PASSWORD');

    const now = Date.now();
    const token = issueToken();
    u.tokens = (u.tokens || []).filter((x) => x.exp > now).slice(-4);
    u.tokens.push(token);
    await saveDB(db);
    return { uid: u._id, token: token.t, expiresAt: token.exp, user: publicUser(u) };
  },

  /* 忘记密码：手机号 + 验证码 → 重设密码并登录 */
  async resetPassword(payload) {
    const db = await loadDB();
    const phone = String(payload.phone || '').replace(/\D/g, '');
    const code = String(payload.code || '').trim();
    const password = assertPassword(payload.password);
    if (!/^1\d{10}$/.test(phone)) fail('请输入正确的手机号', 'BAD_PHONE');

    const u = db.users.filter((x) => x.phone === phone)[0];
    if (!u) fail('这个手机号还没注册', 'NO_USER');
    consumeCode(db, phone, code);

    Object.assign(u, makePassword(password));
    const token = issueToken();
    u.tokens = [token]; // 改密码后其它设备需要重新登录
    await saveDB(db);
    return { uid: u._id, token: token.t, expiresAt: token.exp, user: publicUser(u) };
  },

  /* 修改密码（已登录时使用） */
  async changePassword(payload) {
    const db = await loadDB();
    const u = findUser(db, payload.uid, payload.token);
    const next = assertPassword(payload.password);
    if (u.passwordHash && !checkPassword(u, payload.oldPassword)) fail('原密码不正确', 'BAD_PASSWORD');
    Object.assign(u, makePassword(next));
    await saveDB(db);
    return { ok: true };
  },

  async signOut(payload) {
    const db = await loadDB();
    const u = findUser(db, payload.uid, payload.token);
    u.tokens = (u.tokens || []).filter((x) => x.t !== payload.token);
    await saveDB(db);
    return { ok: true };
  },

  async me(payload) {
    const db = await loadDB();
    const u = findUser(db, payload.uid, payload.token);
    return { user: publicUser(u), book: publicBook(bookOfUser(db, u)) };
  },

  async updateUser(payload) {
    const db = await loadDB();
    const u = findUser(db, payload.uid, payload.token);
    if (payload.nickname != null) u.nickname = String(payload.nickname).slice(0, 24);
    if (payload.avatar !== undefined) u.avatar = payload.avatar;
    await saveDB(db);
    return { user: publicUser(u) };
  },

  async createBook(payload) {
    const db = await loadDB();
    const u = findUser(db, payload.uid, payload.token);
    if (u.bookId) return { book: publicBook(bookOfUser(db, u)) };

    let code = rand(6).toUpperCase();
    while (db.books.some((b) => b.code === code)) code = rand(6).toUpperCase();

    const b = {
      _id: 'b_' + Date.now().toString(36) + rand(8),
      code: code,
      title: payload.title || '我们的小日子',
      myName: payload.myName || '我',
      partnerName: payload.partnerName || '宝贝',
      anniversary: payload.anniversary || '',
      palette: payload.palette || 'pink',
      theme: payload.theme || 'light',
      events: [],
      members: [u._id],
      createdBy: u._id,
      createdAt: Date.now()
    };
    db.books.push(b);
    u.bookId = b._id;
    await saveDB(db);
    return { book: publicBook(b) };
  },

  async joinBook(payload) {
    const db = await loadDB();
    const u = findUser(db, payload.uid, payload.token);
    const code = String(payload.code || '').trim().toUpperCase();
    if (!code) fail('请输入邀请码', 'NO_CODE');
    const b = db.books.filter((x) => x.code === code)[0];
    if (!b) fail('邀请码不存在', 'NO_BOOK');
    if ((b.members || []).length >= 2 && (b.members || []).indexOf(u._id) < 0) fail('这个本子已经有两位主人啦', 'BOOK_FULL');
    b.members = Array.from(new Set((b.members || []).concat([u._id])));
    u.bookId = b._id;
    await saveDB(db);
    return { book: publicBook(b) };
  },

  async leaveBook(payload) {
    const db = await loadDB();
    const u = findUser(db, payload.uid, payload.token);
    if (u.bookId) {
      const b = db.books.filter((x) => x._id === u.bookId)[0];
      if (b) b.members = (b.members || []).filter((m) => m !== u._id);
      u.bookId = null;
      await saveDB(db);
    }
    return { ok: true };
  },

  async updateBook(payload) {
    const db = await loadDB();
    const u = findUser(db, payload.uid, payload.token);
    const b = bookOfUser(db, u);
    if (!b) fail('还没有加入任何本子', 'NO_BOOK');
    ['title', 'myName', 'partnerName', 'anniversary', 'palette', 'theme', 'myAvatar', 'partnerAvatar', 'events'].forEach((k) => {
      if (payload[k] !== undefined) b[k] = payload[k];
    });
    b.updatedAt = Date.now();
    await saveDB(db);
    return { book: publicBook(b) };
  },

  async listRecords(payload) {
    const db = await loadDB();
    const u = findUser(db, payload.uid, payload.token);
    const b = bookOfUser(db, u);
    if (!b) return { book: null, records: [] };
    const list = db.records
      .filter((r) => r.bookId === b._id)
      .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : (y.createdAt || 0) - (x.createdAt || 0)))
      .slice(0, 500)
      .map(publicRecord);
    return { book: publicBook(b), records: list };
  },

  async upsertRecord(payload) {
    const db = await loadDB();
    const u = findUser(db, payload.uid, payload.token);
    const b = bookOfUser(db, u);
    if (!b) fail('还没有加入任何本子', 'NO_BOOK');

    const input = payload.record || {};
    const doc = {
      date: input.date || new Date().toISOString().slice(0, 10),
      title: String(input.title || '').slice(0, 60),
      note: String(input.note || '').slice(0, 5000),
      place: String(input.place || '').slice(0, 60),
      mood: input.mood || 'sweet',
      tags: (input.tags || []).slice(0, 12).map((t) => String(t).slice(0, 16)),
      images: (input.images || []).slice(0, MAX_IMAGES).map((img) => ({
        id: img.id || img.fileId || '',
        name: img.name || '',
        w: img.w || 0,
        h: img.h || 0
      })),
      authorId: u._id,
      authorName: u.nickname || maskPhone(u.phone),
      bookId: b._id,
      updatedAt: Date.now()
    };

    if (input.id) {
      const old = db.records.filter((r) => r._id === input.id)[0];
      if (!old || old.bookId !== b._id) fail('记录不存在', 'NO_RECORD');
      Object.assign(old, doc);
      old.createdAt = old.createdAt || Date.now();
      await saveDB(db);
      return { record: publicRecord(old) };
    }

    const rec = Object.assign({ _id: 'r_' + Date.now().toString(36) + rand(8), createdAt: Date.now() }, doc);
    db.records.push(rec);
    await saveDB(db);
    return { record: publicRecord(rec) };
  },

  async removeRecord(payload) {
    const db = await loadDB();
    const u = findUser(db, payload.uid, payload.token);
    const b = bookOfUser(db, u);
    const rec = db.records.filter((r) => r._id === payload.id)[0];
    if (!b || !rec || rec.bookId !== b._id) fail('记录不存在', 'NO_RECORD');
    db.records = db.records.filter((r) => r._id !== payload.id);
    await saveDB(db);
    return { ok: true, images: rec.images || [] };
  },

  /* 上传图片 */
  async uploadImage(payload) {
    const db = await loadDB();
    const u = findUser(db, payload.uid, payload.token);
    const b64 = String(payload.base64 || '');
    if (!b64) fail('没有图片内容', 'NO_FILE');
    const clean = b64.indexOf(',') >= 0 ? b64.slice(b64.indexOf(',') + 1) : b64;
    const buffer = Buffer.from(clean, 'base64');
    if (buffer.length > 8 * 1024 * 1024) fail('图片太大了', 'TOO_LARGE');

    const ext = (String(payload.name || '').split('.').pop() || 'jpg').toLowerCase();
    const cloudPath = 'love-diary/' + u._id + '/' + Date.now() + '_' + rand(8) + '.' + ext;
    const res = await app.uploadFile({ cloudPath: cloudPath, fileContent: buffer });
    if (!res || !res.fileID) fail('图片上传失败', 'UPLOAD_FAIL');
    return { fileId: res.fileID };
  },

  /* 图片临时下载地址 */
  async getFileUrl(payload) {
    const db = await loadDB();
    findUser(db, payload.uid, payload.token);
    const fileIds = (payload.fileIds || []).filter(Boolean);
    if (!fileIds.length) return { urls: {} };
    const res = await app.getTempFileURL({
      fileList: fileIds.map((id) => ({ fileID: id, maxAge: 3600 }))
    });
    const map = {};
    (res.fileList || []).forEach((it) => {
      if (it && it.fileID) map[it.fileID] = it.tempFileURL || '';
    });
    return { urls: map };
  }
};

/* 兼容两种调用方式：SDK callFunction 直接传对象；HTTP 访问服务放在 body 里 */
function normalize(raw) {
  let e = raw || {};
  if (typeof e === 'string') {
    try { e = JSON.parse(e); } catch (err) { e = {}; }
  }
  if (e.body && typeof e.body === 'string') {
    try {
      const parsed = JSON.parse(e.body);
      if (parsed && typeof parsed === 'object') e = parsed;
    } catch (err) { /* 保持原样 */ }
  }
  if (e.data && typeof e.data === 'object' && !e.action) e = e.data;
  return e;
}

exports.main = async (rawEvent) => {
  const event = normalize(rawEvent);
  const action = (event && event.action) || '';
  const payload = (event && event.payload) || {};
  const handler = handlers[action];
  if (!handler) return { ok: false, error: '未知的操作：' + action, apiCode: 'NO_ACTION' };

  try {
    const data = await handler(payload);
    return { ok: true, data: data || {} };
  } catch (err) {
    return {
      ok: false,
      error: (err && err.message) || '服务器有点忙',
      apiCode: (err && err.apiCode) || 'SERVER_ERROR'
    };
  }
};
