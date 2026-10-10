/* 我们的小日子 · 云端接口
 *
 * 集合说明（在 CloudBase 控制台创建，权限设为「仅管理端可读写」）：
 *   ld_users    用户：{ _id, phone, nickname, avatar, bookId, tokens: [{t, exp}], createdAt }
 *   ld_books    情侣本：{ _id, code, title, myName, partnerName, anniversary, palette, theme, members: [uid], createdBy, createdAt }
 *   ld_records  记录：{ _id, bookId, authorId, authorName, date, title, note, place, mood, tags, images, createdAt, updatedAt }
 *   ld_sms_codes 验证码：{ _id, phone, code, expiresAt, used }
 *
 * 说明：所有读写都通过本云函数完成，服务端负责校验「用户属于哪个本子」。
 * 短信：配置了腾讯云 SMS 环境变量即真实发送，否则为开发模式（验证码在返回值里返回）。
 */
const cloudbase = require('@cloudbase/node-sdk');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV || process.env.TCB_ENV });
const db = app.database();
const _ = db.command;

const TOKEN_DAYS = 30;
const CODE_MINUTES = 10;
const MAX_IMAGES = 9;

/* ---------------- 工具 ---------------- */

const COLLECTIONS = {
  user: 'ld_users',
  book: 'ld_books',
  record: 'ld_records',
  sms: 'ld_sms_codes'
};

const col = (name) => db.collection(COLLECTIONS[name]);

function randString(len, chars = 'abcdefghijkmnpqrstuvwxyz23456789') {
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function numCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function fail(message, code) {
  const err = new Error(message);
  err.apiCode = code || 'ERROR';
  throw err;
}

/* ---------------- 登录态 ---------------- */

async function userByToken(uid, token) {
  if (!uid || !token) fail('请先登录', 'NO_AUTH');
  const res = await col('user').doc(uid).get();
  const doc = (res.data && res.data[0]) || null;
  if (!doc) fail('账号不存在', 'NO_USER');
  const t = (doc.tokens || []).filter((x) => x.t === token)[0];
  if (!t) fail('登录已失效，请重新登录', 'TOKEN_INVALID');
  if (t.exp < Date.now()) fail('登录已过期，请重新登录', 'TOKEN_EXPIRED');
  return doc;
}

async function bookOfUser(user) {
  if (!user.bookId) return null;
  const res = await col('book').doc(user.bookId).get();
  const doc = (res.data && res.data[0]) || null;
  if (doc && (doc.members || []).indexOf(user._id) < 0) return null;
  return doc;
}

function issueToken() {
  return { t: randString(40), exp: Date.now() + TOKEN_DAYS * 86400000 };
}

function publicUser(user) {
  return {
    uid: user._id,
    phone: user.phone,
    nickname: user.nickname || '',
    avatar: user.avatar || null,
    bookId: user.bookId || null
  };
}

function publicBook(book) {
  if (!book) return null;
  return {
    id: book._id,
    code: book.code,
    title: book.title || '我们的小日子',
    myName: book.myName || '我',
    partnerName: book.partnerName || '宝贝',
    anniversary: book.anniversary || '',
    palette: book.palette || 'pink',
    theme: book.theme || 'light',
    myAvatar: book.myAvatar || null,
    partnerAvatar: book.partnerAvatar || null,
    events: book.events || [],
    members: book.members || [],
    createdBy: book.createdBy || ''
  };
}

/* ---------------- 短信 ---------------- */

async function sendRealSms(phone, code) {
  // 生产模式：需要在云函数环境变量里配置腾讯云短信（SMS 需要已审核的签名与模板）
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
  /* 发送验证码 */
  async sendCode(payload) {
    const phone = String(payload.phone || '').replace(/\D/g, '');
    if (!/^1\d{10}$/.test(phone)) fail('请输入正确的手机号', 'BAD_PHONE');

    const code = numCode();
    const now = Date.now();

    // 同一个号码 60 秒内只发一次
    const recent = await col('sms')
      .where({ phone: phone, expiresAt: _.gt(now - 60 * 1000) })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    if (recent.data && recent.data.length && now - (recent.data[0].createdAt || 0) < 60000) {
      fail('验证码已发送，请稍候再试', 'TOO_FAST');
    }

    await col('sms').add({
      phone: phone,
      code: code,
      used: false,
      expiresAt: now + CODE_MINUTES * 60000,
      createdAt: now
    });

    const sent = await sendRealSms(phone, code);

    return {
      sent: sent,
      expiresInMinutes: CODE_MINUTES,
      // 未配置短信服务时返回验证码，方便调试（正式上线配置短信后会移除）
      devCode: sent ? undefined : code
    };
  },

  /* 验证码登录 / 注册 */
  async signIn(payload) {
    const phone = String(payload.phone || '').replace(/\D/g, '');
    const code = String(payload.code || '').trim();
    if (!/^1\d{10}$/.test(phone)) fail('请输入正确的手机号', 'BAD_PHONE');
    if (!/^\d{6}$/.test(code)) fail('请输入 6 位验证码', 'BAD_CODE');

    const now = Date.now();
    const rec = await col('sms')
      .where({ phone: phone, code: code, used: false })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    const row = (rec.data && rec.data[0]) || null;
    if (!row) fail('验证码不正确', 'CODE_WRONG');
    if (row.expiresAt < now) fail('验证码已过期', 'CODE_EXPIRED');
    await col('sms').doc(row._id).update({ used: true });

    let user = null;
    const existed = await col('user').where({ phone: phone }).limit(1).get();
    user = (existed.data && existed.data[0]) || null;

    const token = issueToken();
    if (!user) {
      const uid = 'u_' + Date.now().toString(36) + randString(8);
      await col('user').doc(uid).set({
        _id: uid,
        phone: phone,
        nickname: '',
        avatar: null,
        bookId: null,
        tokens: [token],
        createdAt: now
      });
      user = { _id: uid, phone: phone, nickname: '', avatar: null, bookId: null };
    } else {
      const tokens = (user.tokens || []).filter((x) => x.exp > now).slice(-4);
      tokens.push(token);
      await col('user').doc(user._id).update({ tokens: tokens });
      user.tokens = tokens;
    }

    const me = await col('user').doc(user._id).get();
    const doc = (me.data && me.data[0]) || user;
    return { uid: user._id, token: token.t, expiresAt: token.exp, user: publicUser(doc) };
  },

  /* 退出登录 */
  async signOut(payload) {
    const user = await userByToken(payload.uid, payload.token);
    const tokens = (user.tokens || []).filter((x) => x.t !== payload.token);
    await col('user').doc(user._id).update({ tokens: tokens });
    return { ok: true };
  },

  /* 我的资料 + 情侣本 */
  async me(payload) {
    const user = await userByToken(payload.uid, payload.token);
    return { user: publicUser(user), book: publicBook(await bookOfUser(user)) };
  },

  /* 修改昵称 / 头像 */
  async updateUser(payload) {
    const user = await userByToken(payload.uid, payload.token);
    const patch = {};
    if (payload.nickname != null) patch.nickname = String(payload.nickname).slice(0, 24);
    if (payload.avatar !== undefined) patch.avatar = payload.avatar;
    if (Object.keys(patch).length) await col('user').doc(user._id).update(patch);
    const fresh = await col('user').doc(user._id).get();
    return { user: publicUser((fresh.data && fresh.data[0]) || user) };
  },

  /* 创建情侣本 */
  async createBook(payload) {
    const user = await userByToken(payload.uid, payload.token);
    if (user.bookId) {
      return { book: publicBook(await bookOfUser(user)) };
    }
    const id = 'b_' + Date.now().toString(36) + randString(8);
    const code = randString(6).toUpperCase();

    // 邀请码唯一
    const dup = await col('book').where({ code: code }).limit(1).get();
    if (dup.data && dup.data.length) return handlers.createBook(payload);

    await col('book').doc(id).set({
      _id: id,
      code: code,
      title: payload.title || '我们的小日子',
      myName: payload.myName || '我',
      partnerName: payload.partnerName || '宝贝',
      anniversary: payload.anniversary || '',
      palette: payload.palette || 'pink',
      theme: payload.theme || 'light',
      members: [user._id],
      createdBy: user._id,
      createdAt: Date.now()
    });
    await col('user').doc(user._id).update({ bookId: id });
    const res = await col('book').doc(id).get();
    return { book: publicBook((res.data && res.data[0]) || null) };
  },

  /* 用邀请码加入情侣本 */
  async joinBook(payload) {
    const user = await userByToken(payload.uid, payload.token);
    const code = String(payload.code || '').trim().toUpperCase();
    if (!code) fail('请输入邀请码', 'NO_CODE');

    const res = await col('book').where({ code: code }).limit(1).get();
    const book = (res.data && res.data[0]) || null;
    if (!book) fail('邀请码不存在', 'NO_BOOK');
    if ((book.members || []).length >= 2 && (book.members || []).indexOf(user._id) < 0) {
      fail('这个本子已经有两位主人啦', 'BOOK_FULL');
    }

    const members = Array.from(new Set((book.members || []).concat([user._id])));
    await col('book').doc(book._id).update({ members: members });
    await col('user').doc(user._id).update({ bookId: book._id });

    const fresh = await col('book').doc(book._id).get();
    return { book: publicBook((fresh.data && fresh.data[0]) || null) };
  },

  /* 退出情侣本 */
  async leaveBook(payload) {
    const user = await userByToken(payload.uid, payload.token);
    if (user.bookId) {
      const res = await col('book').doc(user.bookId).get();
      const book = (res.data && res.data[0]) || null;
      if (book) {
        const members = (book.members || []).filter((m) => m !== user._id);
        await col('book').doc(book._id).update({ members: members });
      }
      await col('user').doc(user._id).update({ bookId: null });
    }
    return { ok: true };
  },

  /* 修改情侣本设置（昵称、纪念日、主题等） */
  async updateBook(payload) {
    const user = await userByToken(payload.uid, payload.token);
    const book = await bookOfUser(user);
    if (!book) fail('还没有加入任何本子', 'NO_BOOK');

    const allowed = ['title', 'myName', 'partnerName', 'anniversary', 'palette', 'theme', 'myAvatar', 'partnerAvatar', 'events'];
    const patch = {};
    allowed.forEach((k) => {
      if (payload[k] !== undefined) patch[k] = payload[k];
    });
    if (Object.keys(patch).length) {
      patch.updatedAt = Date.now();
      await col('book').doc(book._id).update(patch);
    }
    const fresh = await col('book').doc(book._id).get();
    return { book: publicBook((fresh.data && fresh.data[0]) || null) };
  },

  /* 拉取本子的全部记录 */
  async listRecords(payload) {
    const user = await userByToken(payload.uid, payload.token);
    const book = await bookOfUser(user);
    if (!book) return { book: null, records: [] };

    const limit = Math.min(500, Number(payload.limit) || 500);
    const res = await col('record')
      .where({ bookId: book._id })
      .orderBy('date', 'desc')
      .limit(limit)
      .get();
    return { book: publicBook(book), records: (res.data || []).map(publicRecord) };
  },

  /* 新增 / 修改记录 */
  async upsertRecord(payload) {
    const user = await userByToken(payload.uid, payload.token);
    const book = await bookOfUser(user);
    if (!book) fail('还没有加入任何本子', 'NO_BOOK');

    const input = payload.record || {};
    const date = input.date || new Date().toISOString().slice(0, 10);
    // 前端统一用 id 字段（值就是云存储的 fileID）
    const images = (input.images || []).slice(0, MAX_IMAGES).map((img) => ({
      id: img.id || img.fileId || '',
      name: img.name || '',
      w: img.w || 0,
      h: img.h || 0
    }));

    const doc = {
      bookId: book._id,
      authorId: user._id,
      authorName: user.nickname || user.phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2'),
      date: date,
      title: String(input.title || '').slice(0, 60),
      note: String(input.note || '').slice(0, 5000),
      place: String(input.place || '').slice(0, 60),
      mood: input.mood || 'sweet',
      tags: (input.tags || []).slice(0, 12).map((t) => String(t).slice(0, 16)),
      images: images,
      updatedAt: Date.now()
    };

    if (input.id) {
      // 只能改自己本子里的记录
      const old = await col('record').doc(input.id).get();
      const oldDoc = (old.data && old.data[0]) || null;
      if (!oldDoc || oldDoc.bookId !== book._id) fail('记录不存在', 'NO_RECORD');
      doc.createdAt = oldDoc.createdAt || Date.now();
      await col('record').doc(input.id).update(doc);
      return { record: publicRecord(Object.assign({ _id: input.id }, doc)) };
    }

    doc.createdAt = Date.now();
    const added = await col('record').add(doc);
    return { record: publicRecord(Object.assign({ _id: added.id }, doc)) };
  },

  /* 删除记录 */
  async removeRecord(payload) {
    const user = await userByToken(payload.uid, payload.token);
    const book = await bookOfUser(user);
    if (!book) fail('还没有加入任何本子', 'NO_BOOK');
    const res = await col('record').doc(payload.id).get();
    const doc = (res.data && res.data[0]) || null;
    if (!doc || doc.bookId !== book._id) fail('记录不存在', 'NO_RECORD');
    await col('record').doc(payload.id).remove();
    return { ok: true, images: doc.images || [] };
  },

  /* 图片临时下载地址（fileID 有有效期，按需换取） */
  async getFileUrl(payload) {
    await userByToken(payload.uid, payload.token);
    const fileIds = (payload.fileIds || []).filter(Boolean);
    if (!fileIds.length) return { urls: {} };
    const res = await app.getTempFileURL({
      fileList: fileIds.map((id) => ({ fileID: id }))
    });
    const map = {};
    (res.fileList || []).forEach((it) => {
      if (it.fileID) map[it.fileID] = it.tempFileURL || '';
    });
    return { urls: map };
  }
};

function publicRecord(doc) {
  return {
    id: doc._id,
    authorId: doc.authorId || '',
    authorName: doc.authorName || '',
    date: doc.date,
    title: doc.title || '',
    note: doc.note || '',
    place: doc.place || '',
    mood: doc.mood || 'sweet',
    tags: doc.tags || [],
    images: doc.images || [],
    createdAt: doc.createdAt || 0,
    updatedAt: doc.updatedAt || 0
  };
}

/* ---------------- 入口 ---------------- */

exports.main = async (event) => {
  const action = (event && event.action) || '';
  const payload = (event && event.payload) || {};
  const handler = handlers[action];
  if (!handler) return { ok: false, error: '未知的操作：' + action };

  try {
    const data = await handler(payload);
    return { ok: true, data: data || {} };
  } catch (err) {
    return {
      ok: false,
      error: err && err.message ? err.message : '服务器有点忙',
      apiCode: (err && err.apiCode) || 'SERVER_ERROR'
    };
  }
};
