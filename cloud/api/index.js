/* 我们的小日子 · 云端接口（CloudBase 云函数）
 *
 * 账号体系（不依赖短信/邮箱，开箱即用）：
 *   注册：用户名 + 密码 + 密保问题（找回密码用）→ 返回一次性恢复码
 *   登录：用户名 + 密码
 *   找回：① 答对密保问题重设密码  ② 用恢复码重设密码
 * 安全：密码与密保答案都用 scrypt 加盐哈希；密保答案连错 5 次锁定 10 分钟。
 *
 * 存储：整份数据存成云存储里的一个 JSON（love-diary/db.json），免开数据库、免建集合。
 */
const cloudbase = require('@cloudbase/node-sdk');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV || process.env.TCB_ENV });

const DB_PATH = 'love-diary/data.json'; // 换新文件，与早期的测试数据彻底隔离
const TOKEN_DAYS = 30;
const MAX_IMAGES = 9;
const MAX_ANSWER_FAILS = 5;
const LOCK_MINUTES = 10;

const EMPTY = { users: [], books: [], records: [], emailCodes: [] };

/* 每日一问题库：按日期确定性轮换，两人同一天永远是同一题 */
const DAILY_QUESTIONS = [
  '今天最让你开心的一件小事是什么？',
  'TA 今天哪个瞬间让你心动了？',
  '如果现在可以立刻见到 TA，你最想做的第一件事是什么？',
  '今天吃到的最好吃的东西是什么？想带 TA 去吃吗？',
  '今天有没有哪个瞬间特别想 TA？',
  '用三个词形容一下今天的心情。',
  '最近最想和 TA 一起去做的一件事是什么？',
  '今天有什么想跟 TA 分享但还没说的吗？',
  '如果给今天的你们拍一张照片，会是什么画面？',
  '今天有比昨天更爱 TA 一点吗？为什么？',
  '最近一次笑出声是因为什么？',
  '如果明天是周末，你最理想的安排是什么？',
  '今天天气怎么样？像不像你们某次一起经历的那天？',
  '最近单曲循环的歌是什么？想跟 TA 一起听吗？',
  '今天学到了什么新东西？',
  '如果可以用一个表情包总结今天，是哪一个？',
  '今天有想跟 TA 倒的小烦恼吗？',
  '你们下一次约会，你最想去哪里？',
  '最近有没有什么小目标想和 TA 一起完成？',
  '今天路过哪里的时候想起了你们的故事？',
  '如果 TA 现在站在你面前，你想说的第一句话是什么？',
  '今天为自己做了什么好事？顺便夸夸自己。',
  '最近一次觉得「有 TA 真好」是什么时候？',
  '如果送 TA 一份不需要花钱的礼物，会是什么？',
  '今天几点起床的？想不想和 TA 一起赖床？',
  '最近一次梦到 TA 是什么梦？',
  '今天的你，最想被 TA 怎么夸？',
  '如果你们的爱情是一部电影，今天演到哪一幕了？',
  '明天最期待的一件事是什么？',
  '今天有没有什么想存起来、等老了一起回味的瞬间？'
];

function dailyQuestion(dateStr) {
  let h = 0;
  const s = String(dateStr || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1000000;
  return DAILY_QUESTIONS[h % DAILY_QUESTIONS.length];
}

const COLLECTION_KEYS = ['users', 'books', 'records', 'emailCodes'];

const CODE_MINUTES = 10;

/* ---------------- 存储 ---------------- */

let fileIdPrefix = null;
let lastLoadError = null;

async function fileIDOf(cloudPath) {
  if (!fileIdPrefix) {
    const up = await app.uploadFile({
      cloudPath: 'love-diary/__probe.txt',
      fileContent: Buffer.from('probe')
    });
    const id = up && up.fileID;
    if (!id || id.indexOf('//') < 0) throw new Error('无法获取云存储信息');
    const slash = id.indexOf('/', id.indexOf('//') + 2);
    if (slash < 0) throw new Error('无法解析云存储路径');
    fileIdPrefix = id.slice(0, slash);
  }
  return fileIdPrefix + '/' + cloudPath;
}

/* 读取云存储里的一个小 JSON 文件（分片元信息用） */
async function readFileJSON(cloudPath) {
  try {
    const fileID = await fileIDOf(cloudPath);
    const res = await app.getTempFileURL({ fileList: [{ fileID: fileID, maxAge: 60 }] });
    const url = (res.fileList || [])[0] && (res.fileList || [])[0].tempFileURL;
    if (!url) return null;
    const r = await fetch(url);
    return JSON.parse(await r.text());
  } catch (err) {
    return null;
  }
}

async function loadDB() {
  try {
    const fileID = await fileIDOf(DB_PATH);
    const res = await app.getTempFileURL({ fileList: [{ fileID: fileID, maxAge: 60 }] });
    const url = (res.fileList || [])[0] && (res.fileList || [])[0].tempFileURL;
    if (!url) {
      lastLoadError = 'no temp url';
      return JSON.parse(JSON.stringify(EMPTY));
    }
    // 加时间戳，避免读到 CDN 缓存的旧版本
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
    const merged = JSON.parse(JSON.stringify(EMPTY));
    COLLECTION_KEYS.forEach((k) => {
      if (Array.isArray(data[k])) merged[k] = data[k];
    });
    return merged;
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
    await app.uploadFile({ cloudPath: DB_PATH, fileContent: buffer });
  }
}

/* ---------------- 通用工具 ---------------- */

function rand(len, chars) {
  chars = chars || 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function numCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/* ---------------- 邮件（QQ 邮箱 SMTP） ---------------- */

let transporter = null;

function mailReady() {
  return Boolean(process.env.MAIL_USER && process.env.MAIL_PASS);
}

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST || 'smtp.qq.com',
      port: Number(process.env.MAIL_PORT || 465),
      secure: true, // 465 端口用 SSL
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS // QQ 邮箱这里填「SMTP 授权码」，不是登录密码
      }
    });
  }
  return transporter;
}

async function sendMail(to, code, scene) {
  if (!mailReady()) return false;
  const appName = process.env.MAIL_APP_NAME || '朝暮';
  const titleMap = {
    reset: '【' + appName + '】找回密码验证码',
    register: '【' + appName + '】注册验证码',
    bind: '【' + appName + '】绑定邮箱验证码'
  };
  const tipMap = {
    reset: '你正在找回密码，输入下面的验证码即可重设新密码。',
    register: '你正在注册账号，输入下面的验证码即可完成注册。',
    bind: '你正在绑定邮箱，输入下面的验证码即可完成绑定。'
  };
  const subject = titleMap[scene] || '【' + appName + '】验证码';
  const tip = tipMap[scene] || '你的验证码是：';

  await getTransporter().sendMail({
    from: '"' + appName + '" <' + process.env.MAIL_USER + '>',
    to: to,
    subject: subject,
    text: tip + '\n\n验证码：' + code + '\n有效期 ' + CODE_MINUTES + ' 分钟。\n\n如果不是你本人操作，忽略本邮件即可。',
    html: `
      <div style="max-width:520px;margin:0 auto;padding:26px 22px;font-family:-apple-system,'PingFang SC',sans-serif;background:#fff6f9;border-radius:16px">
        <div style="font-size:19px;font-weight:800;color:#7a1f43;margin-bottom:6px">${appName}</div>
        <div style="font-size:13px;color:#8b7b90;margin-bottom:20px">朝朝暮暮，都是你</div>
        <div style="font-size:14px;color:#2f2438;line-height:1.7">${tip}</div>
        <div style="margin:18px 0;padding:16px;text-align:center;background:linear-gradient(135deg,#ff6b9d,#a78bfa);border-radius:12px">
          <span style="font-size:30px;font-weight:800;letter-spacing:6px;color:#fff">${code}</span>
        </div>
        <div style="font-size:12.5px;color:#8b7b90;line-height:1.7">
          验证码 ${CODE_MINUTES} 分钟内有效，请勿转发给他人。<br/>
          如果不是你本人操作，忽略这封邮件就好。
        </div>
      </div>`
  });
  return true;
}

/* 生成一条邮箱验证码（60 秒内同一邮箱只发一条） */
async function issueEmailCode(db, email, scene) {
  const now = Date.now();
  const recent = (db.emailCodes || [])
    .filter((c) => c.email === email && c.scene === scene)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (recent && now - recent.createdAt < 60000) fail('验证码刚发过啦，稍等一下再试', 'TOO_FAST');

  const code = numCode();
  db.emailCodes = (db.emailCodes || []).filter((c) => c.expiresAt > now || c.used);
  db.emailCodes.push({
    email: email,
    code: code,
    scene: scene,
    used: false,
    expiresAt: now + CODE_MINUTES * 60000,
    createdAt: now
  });
  if (db.emailCodes.length > 300) db.emailCodes = db.emailCodes.slice(-300);
  return code;
}

/* 校验并消费一条邮箱验证码 */
function consumeEmailCode(db, email, code, scene) {
  const now = Date.now();
  const rows = (db.emailCodes || []).filter(
    (c) => c.email === email && c.scene === scene && c.code === code && !c.used
  );
  const row = rows[rows.length - 1];
  if (!row) fail('验证码不正确', 'CODE_WRONG');
  if (row.expiresAt < now) fail('验证码已过期，请重新获取', 'CODE_EXPIRED');
  row.used = true;
}

function fail(message, code) {
  const err = new Error(message);
  err.apiCode = code || 'ERROR';
  throw err;
}

/* 通用哈希（密码、密保答案、恢复码都用它，一律加盐） */
function hashValue(value) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(value), salt, 32).toString('hex');
  return { salt: salt, hash: hash };
}

function verifyValue(value, salt, expected) {
  if (!salt || !expected) return false;
  try {
    const hash = crypto.scryptSync(String(value), salt, 32);
    const saved = Buffer.from(expected, 'hex');
    return hash.length === saved.length && crypto.timingSafeEqual(hash, saved);
  } catch (err) {
    return false;
  }
}

/* ---------------- 字段校验 ---------------- */

function normUsername(u) {
  return String(u || '').trim().toLowerCase();
}

function checkUsername(u) {
  const name = normUsername(u);
  if (!/^[a-z0-9_]{3,20}$/.test(name)) {
    fail('用户名需 3~20 位字母、数字或下划线', 'BAD_USERNAME');
  }
  return name;
}

/* 邮箱：可空；填了就要合法（仅作账号标识，不发验证邮件） */
function checkEmail(e) {
  const v = String(e || '').trim().toLowerCase();
  if (!v) return '';
  if (v.length > 60) fail('邮箱太长了', 'LONG_EMAIL');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) fail('邮箱格式看起来不太对', 'BAD_EMAIL');
  return v;
}

function checkPassword(p) {
  const v = String(p || '');
  if (v.length < 6) fail('密码至少 6 位', 'WEAK_PASSWORD');
  if (v.length > 32) fail('密码最长 32 位', 'LONG_PASSWORD');
  return v;
}

/* 答案做归一化：忽略大小写、空格与常见标点，减少“差一个符号就答不对” */
function normAnswer(a) {
  return String(a || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-_·.,，。、!！?？'"'']/g, '');
}

function checkAnswer(a) {
  const v = normAnswer(a);
  if (v.length < 2) fail('密保答案至少 2 个字符', 'BAD_ANSWER');
  if (v.length > 40) fail('密保答案太长了', 'LONG_ANSWER');
  return v;
}

function checkQuestion(q) {
  const v = String(q || '').trim();
  if (v.length < 2) fail('请选择或填写密保问题', 'BAD_QUESTION');
  return v.slice(0, 60);
}

/* 恢复码：4 组 4 位（去掉容易看错的字符） */
function makeRecoveryCode() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const part = () => rand(4, chars);
  return (part() + '-' + part() + '-' + part() + '-' + part()).toUpperCase();
}

/* ---------------- 数据包装 ---------------- */

function publicUser(u) {
  return {
    uid: u._id,
    username: u.username,
    email: u.email || '',
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
    wishes: b.wishes || [],
    miss: b.miss || null,
    daily: (function () {
      const today = new Date().toISOString().slice(0, 10);
      const entry = ((b.dailyQA || []).filter((x) => x.date === today)[0]) || { date: today, answers: {} };
      return { date: today, question: dailyQuestion(today), answers: entry.answers || {} };
    })(),
    dailyHistory: (b.dailyQA || [])
      .slice(-60)
      .reverse()
      .map((x) => ({
        date: x.date,
        question: dailyQuestion(x.date),
        answers: x.answers || {}
      })),
    createdBy: b.createdBy || ''
  };
}

function publicRecord(r, avatarMap) {
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
    audio: r.audio || null,
    likes: r.likes || [],
    comments: (r.comments || []).slice(-100).map(function (c) {
      return Object.assign({}, c, { avatar: (avatarMap && avatarMap[c.uid]) || null });
    }),
    createdAt: r.createdAt || 0,
    updatedAt: r.updatedAt || 0
  };
}

/* 评论头像：本子头像（设置页上传的那对）优先，其次账号自带头像 */
function commentAvatarMap(db, b) {
  const map = {};
  if (!b) return map;
  const other = (b.members || []).filter((x) => x !== b.createdBy)[0];
  if (b.createdBy && b.myAvatar) map[b.createdBy] = b.myAvatar;
  if (other && b.partnerAvatar) map[other] = b.partnerAvatar;
  (b.members || []).forEach((uid) => {
    if (map[uid]) return;
    const usr = db.users.filter((x) => x._id === uid)[0];
    if (usr && usr.avatar) map[uid] = usr.avatar;
  });
  return map;
}

/* 另一半的账号信息（头像/昵称/用户名/邮箱/最近在线） */
function partnerInfoOf(db, b, myUid) {
  if (!b) return null;
  const otherId = (b.members || []).filter((x) => x !== myUid)[0];
  if (!otherId) return null;
  const usr = db.users.filter((x) => x._id === otherId)[0] || {};
  const isCreator = otherId === b.createdBy;
  return {
    uid: otherId,
    username: usr.username || '',
    email: usr.email || '',
    nickname: usr.nickname || (isCreator ? b.myName : b.partnerName) || 'Ta',
    avatar: isCreator ? b.myAvatar || null : b.partnerAvatar || null,
    lastSeen: usr.lastSeen || 0
  };
}

function findUserByName(db, username) {
  const name = normUsername(username);
  return db.users.filter((x) => x.username === name)[0] || null;
}

function findUserByEmail(db, email) {
  const v = String(email || '').trim().toLowerCase();
  if (!v) return null;
  return db.users.filter((x) => (x.email || '') === v)[0] || null;
}

/* 登录标识：带 @ 按邮箱找，否则按用户名找 —— 一个输入框两种账号都能登 */
function findUserByIdentifier(db, idf) {
  const v = String(idf || '').trim().toLowerCase();
  if (!v) return null;
  if (v.indexOf('@') >= 0) return findUserByEmail(db, v);
  return findUserByName(db, v);
}

function userByToken(db, uid, token) {
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

function attachToken(u, token) {
  const now = Date.now();
  u.tokens = (u.tokens || []).filter((x) => x.exp > now).slice(-4);
  u.tokens.push(token);
}

/* ---------------- 接口 ---------------- */

const handlers = {
  async ping() {
    const db = await loadDB();
    return {
      ok: true,
      users: db.users.length,
      books: db.books.length,
      records: db.records.length,
      mailReady: mailReady(),
      mailUser: mailReady() ? String(process.env.MAIL_USER).replace(/^(.)[^@]*(@.*)$/, '$1***$2') : '',
      loadError: lastLoadError
    };
  },

  /* 发送邮箱验证码：scene = register | reset | bind */
  async sendEmailCode(payload) {
    const db = await loadDB();
    const email = checkEmail(payload.email);
    if (!email) fail('请输入邮箱', 'BAD_EMAIL');
    const scene = ['register', 'reset', 'bind'].indexOf(payload.scene) >= 0 ? payload.scene : 'register';

    if (scene === 'reset') {
      const u = findUserByEmail(db, email);
      if (!u) fail('这个邮箱还没有绑定过账号', 'NO_USER');
    }
    if (scene === 'bind') {
      const other = findUserByEmail(db, email);
      if (other && other._id !== payload.uid) fail('这个邮箱已经绑给别的账号了', 'EMAIL_TAKEN');
    }

    const code = await issueEmailCode(db, email, scene);
    await saveDB(db);

    let sent = false;
    if (mailReady()) {
      sent = await sendMail(email, code, scene);
    }
    return {
      sent: sent,
      expiresInMinutes: CODE_MINUTES,
      // 没配置邮件服务时把验证码返回给前端（演示模式）
      devCode: sent ? undefined : code
    };
  },

  /* 用邮箱验证码找回密码 */
  async resetByEmailCode(payload) {
    const db = await loadDB();
    const email = checkEmail(payload.email);
    const code = String(payload.code || '').trim();
    const password = checkPassword(payload.password);
    if (!email) fail('请输入邮箱', 'BAD_EMAIL');
    if (!/^\d{6}$/.test(code)) fail('请输入 6 位验证码', 'BAD_CODE');

    const u = findUserByEmail(db, email);
    if (!u) fail('这个邮箱还没有绑定过账号', 'NO_USER');
    consumeEmailCode(db, email, code, 'reset');

    const pwd = hashValue(password);
    u.passwordSalt = pwd.salt;
    u.passwordHash = pwd.hash;
    u.answerFails = 0;
    u.answerLockUntil = 0;
    const token = issueToken();
    u.tokens = [token];
    await saveDB(db);
    return { uid: u._id, token: token.t, user: publicUser(u) };
  },

  /* 绑定邮箱（需要邮箱验证码） */
  async bindEmail(payload) {
    const db = await loadDB();
    const u = userByToken(db, payload.uid, payload.token);
    const email = checkEmail(payload.email);
    if (!email) fail('请输入邮箱', 'BAD_EMAIL');
    const other = findUserByEmail(db, email);
    if (other && other._id !== u._id) fail('这个邮箱已经绑给别的账号了', 'EMAIL_TAKEN');
    consumeEmailCode(db, email, String(payload.code || '').trim(), 'bind');
    u.email = email;
    await saveDB(db);
    return { user: publicUser(u) };
  },

  /* 解绑邮箱 */
  async unbindEmail(payload) {
    const db = await loadDB();
    const u = userByToken(db, payload.uid, payload.token);
    if (!verifyValue(String(payload.password || ''), u.passwordSalt, u.passwordHash)) {
      fail('密码不正确', 'BAD_PASSWORD');
    }
    u.email = '';
    await saveDB(db);
    return { user: publicUser(u) };
  },

  /* 注册：用户名 或 邮箱 + 密码 + 密保问题 */
  async register(payload) {
    const db = await loadDB();
    const password = checkPassword(payload.password);
    const question = checkQuestion(payload.question);
    const answer = checkAnswer(payload.answer);
    const email = checkEmail(payload.email);

    // 用户名：填了就用，没填（邮箱注册）就自动生成一个
    let username = payload.username ? normUsername(payload.username) : '';
    if (username) {
      checkUsername(username);
      if (findUserByName(db, username)) fail('这个用户名已经被用了，换一个吧', 'USERNAME_TAKEN');
    } else {
      if (!email) fail('请填写用户名或邮箱', 'NO_IDENTITY');
      const base = (email.split('@')[0] || 'user').replace(/[^a-z0-9_]/g, '').slice(0, 12) || 'user';
      let candidate = base;
      let i = 1;
      while (candidate.length < 3 || findUserByName(db, candidate)) {
        candidate = base + i;
        i++;
        if (i > 500) {
          candidate = 'u' + rand(8);
          break;
        }
      }
      username = candidate;
    }

    if (email) {
      if (findUserByEmail(db, email)) fail('这个邮箱已经注册过了，直接登录吧', 'EMAIL_TAKEN');
      // 用邮箱注册时需要邮箱验证码，确保邮箱是真实可收信的
      const emailCode = String(payload.emailCode || '').trim();
      if (!/^\d{6}$/.test(emailCode)) fail('请先获取邮箱验证码', 'NO_EMAIL_CODE');
      consumeEmailCode(db, email, emailCode, 'register');
    }

    const now = Date.now();
    const pwd = hashValue(password);
    const ans = hashValue(answer);
    const recovery = makeRecoveryCode();
    const rec = hashValue(recovery);
    const token = issueToken();

    const user = {
      _id: 'u_' + now.toString(36) + rand(8),
      username: username,
      email: email,
      nickname: payload.nickname ? String(payload.nickname).slice(0, 24) : username,
      avatar: null,
      bookId: null,
      passwordSalt: pwd.salt,
      passwordHash: pwd.hash,
      question: question,
      answerSalt: ans.salt,
      answerHash: ans.hash,
      recoverySalt: rec.salt,
      recoveryHash: rec.hash,
      answerFails: 0,
      answerLockUntil: 0,
      createdAt: now,
      tokens: []
    };
    attachToken(user, token);
    db.users.push(user);
    await saveDB(db);

    return {
      uid: user._id,
      token: token.t,
      user: publicUser(user),
      recoveryCode: recovery // 只在注册时返回一次，让用户保存
    };
  },

  /* 登录：用户名 或 邮箱 都行 */
  async login(payload) {
    const db = await loadDB();
    const identifier = payload.identifier || payload.username || '';
    const password = String(payload.password || '');
    if (!String(identifier).trim()) fail('请输入用户名或邮箱', 'NO_IDENTITY');

    const u = findUserByIdentifier(db, identifier);
    if (!u || !verifyValue(password, u.passwordSalt, u.passwordHash)) {
      fail('账号或密码不对', 'BAD_LOGIN');
    }

    const token = issueToken();
    attachToken(u, token);
    await saveDB(db);
    return { uid: u._id, token: token.t, user: publicUser(u) };
  },

  /* 绑定 / 更换邮箱（已登录，需要密码） */
  async updateEmail(payload) {
    const db = await loadDB();
    const u = userByToken(db, payload.uid, payload.token);
    if (!verifyValue(String(payload.password || ''), u.passwordSalt, u.passwordHash)) {
      fail('密码不正确', 'BAD_PASSWORD');
    }
    const email = checkEmail(payload.email);
    if (email) {
      const other = findUserByEmail(db, email);
      if (other && other._id !== u._id) fail('这个邮箱已经绑给别的账号了', 'EMAIL_TAKEN');
    }
    u.email = email;
    await saveDB(db);
    return { user: publicUser(u) };
  },

  /* 找回密码第一步：取密保问题 */
  async securityQuestion(payload) {
    const db = await loadDB();
    const u = findUserByIdentifier(db, payload.identifier || payload.username);
    if (!u) fail('没有找到这个账号', 'NO_USER');
    const lockedUntil = Number(u.answerLockUntil || 0);
    const locked = lockedUntil > Date.now();
    return {
      question: u.question || '',
      locked: locked,
      lockedMinutes: locked ? Math.ceil((lockedUntil - Date.now()) / 60000) : 0
    };
  },

  /* 找回：回答密保问题 */
  async resetByAnswer(payload) {
    const db = await loadDB();
    const password = checkPassword(payload.password);
    const u = findUserByIdentifier(db, payload.identifier || payload.username);
    if (!u) fail('没有找到这个账号', 'NO_USER');

    const lockedUntil = Number(u.answerLockUntil || 0);
    if (lockedUntil > Date.now()) {
      fail('尝试次数过多，请 ' + Math.ceil((lockedUntil - Date.now()) / 60000) + ' 分钟后再试', 'LOCKED');
    }

    const answer = normAnswer(payload.answer);
    if (!verifyValue(answer, u.answerSalt, u.answerHash)) {
      u.answerFails = Number(u.answerFails || 0) + 1;
      if (u.answerFails >= MAX_ANSWER_FAILS) {
        u.answerFails = 0;
        u.answerLockUntil = Date.now() + LOCK_MINUTES * 60000;
        await saveDB(db);
        fail('答案错误次数过多，已锁定 ' + LOCK_MINUTES + ' 分钟', 'LOCKED');
      }
      await saveDB(db);
      fail('密保答案不对，还可以试 ' + (MAX_ANSWER_FAILS - u.answerFails) + ' 次', 'BAD_ANSWER');
    }

    const pwd = hashValue(password);
    u.passwordSalt = pwd.salt;
    u.passwordHash = pwd.hash;
    u.answerFails = 0;
    u.answerLockUntil = 0;
    const token = issueToken();
    u.tokens = [token];
    await saveDB(db);
    return { uid: u._id, token: token.t, user: publicUser(u) };
  },

  /* 找回：使用恢复码 */
  async resetByCode(payload) {
    const db = await loadDB();
    const password = checkPassword(payload.password);
    const u = findUserByIdentifier(db, payload.identifier || payload.username);
    if (!u) fail('没有找到这个账号', 'NO_USER');
    if (!u.recoveryHash) fail('这个账号没有设置恢复码', 'NO_RECOVERY');

    const code = String(payload.recoveryCode || '').trim().toUpperCase();
    if (!verifyValue(code, u.recoverySalt, u.recoveryHash)) fail('恢复码不正确', 'BAD_CODE');

    const pwd = hashValue(password);
    u.passwordSalt = pwd.salt;
    u.passwordHash = pwd.hash;
    u.answerFails = 0;
    u.answerLockUntil = 0;
    const token = issueToken();
    u.tokens = [token];
    await saveDB(db);
    return { uid: u._id, token: token.t, user: publicUser(u) };
  },

  /* 修改密码（已登录，需要原密码） */
  async changePassword(payload) {
    const db = await loadDB();
    const u = userByToken(db, payload.uid, payload.token);
    if (!verifyValue(String(payload.oldPassword || ''), u.passwordSalt, u.passwordHash)) {
      fail('原密码不正确', 'BAD_PASSWORD');
    }
    const pwd = hashValue(checkPassword(payload.password));
    u.passwordSalt = pwd.salt;
    u.passwordHash = pwd.hash;
    await saveDB(db);
    return { ok: true };
  },

  /* 修改密保问题（已登录，需要密码） */
  async updateSecurity(payload) {
    const db = await loadDB();
    const u = userByToken(db, payload.uid, payload.token);
    if (!verifyValue(String(payload.password || ''), u.passwordSalt, u.passwordHash)) {
      fail('密码不正确', 'BAD_PASSWORD');
    }
    const question = checkQuestion(payload.question);
    const answer = checkAnswer(payload.answer);
    const ans = hashValue(answer);
    u.question = question;
    u.answerSalt = ans.salt;
    u.answerHash = ans.hash;
    u.answerFails = 0;
    u.answerLockUntil = 0;
    await saveDB(db);
    return { user: publicUser(u) };
  },

  /* 重新生成恢复码（已登录，需要密码） */
  async regenerateRecovery(payload) {
    const db = await loadDB();
    const u = userByToken(db, payload.uid, payload.token);
    if (!verifyValue(String(payload.password || ''), u.passwordSalt, u.passwordHash)) {
      fail('密码不正确', 'BAD_PASSWORD');
    }
    const recovery = makeRecoveryCode();
    const rec = hashValue(recovery);
    u.recoverySalt = rec.salt;
    u.recoveryHash = rec.hash;
    await saveDB(db);
    return { recoveryCode: recovery };
  },

  async signOut(payload) {
    const db = await loadDB();
    const u = userByToken(db, payload.uid, payload.token);
    u.tokens = (u.tokens || []).filter((x) => x.t !== payload.token);
    await saveDB(db);
    return { ok: true };
  },

  async me(payload) {
    const db = await loadDB();
    const u = userByToken(db, payload.uid, payload.token);
    return { user: publicUser(u), book: publicBook(bookOfUser(db, u)) };
  },

  async updateUser(payload) {
    const db = await loadDB();
    const u = userByToken(db, payload.uid, payload.token);
    if (payload.nickname != null) u.nickname = String(payload.nickname).slice(0, 24);
    if (payload.avatar !== undefined) u.avatar = payload.avatar;
    await saveDB(db);
    return { user: publicUser(u) };
  },

  /* ---------- 情侣本 ---------- */

  async createBook(payload) {
    const db = await loadDB();
    const u = userByToken(db, payload.uid, payload.token);
    if (u.bookId) return { book: publicBook(bookOfUser(db, u)) };

    let code = rand(6).toUpperCase();
    while (db.books.some((b) => b.code === code)) code = rand(6).toUpperCase();

    const b = {
      _id: 'b_' + Date.now().toString(36) + rand(8),
      code: code,
      title: payload.title || '我们的小日子',
      myName: payload.myName || u.nickname || '我',
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
    const u = userByToken(db, payload.uid, payload.token);
    const code = String(payload.code || '').trim().toUpperCase();
    if (!code) fail('请输入邀请码', 'NO_CODE');
    const b = db.books.filter((x) => x.code === code)[0];
    if (!b) fail('邀请码不存在', 'NO_BOOK');
    if ((b.members || []).length >= 2 && (b.members || []).indexOf(u._id) < 0) {
      fail('这个本子已经有两位主人啦', 'BOOK_FULL');
    }
    b.members = Array.from(new Set((b.members || []).concat([u._id])));
    u.bookId = b._id;
    await saveDB(db);
    return { book: publicBook(b) };
  },

  async leaveBook(payload) {
    const db = await loadDB();
    const u = userByToken(db, payload.uid, payload.token);
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
    const u = userByToken(db, payload.uid, payload.token);
    const b = bookOfUser(db, u);
    if (!b) fail('还没有加入任何本子', 'NO_BOOK');
    ['title', 'myName', 'partnerName', 'anniversary', 'palette', 'theme', 'myAvatar', 'partnerAvatar', 'events'].forEach((k) => {
      if (payload[k] !== undefined) b[k] = payload[k];
    });
    b.updatedAt = Date.now();
    await saveDB(db);
    return { book: publicBook(b) };
  },

  /* ---------- 记录 ---------- */

  async listRecords(payload) {
    const db = await loadDB();
    const u = userByToken(db, payload.uid, payload.token);
    const b = bookOfUser(db, u);
    if (!b) return { book: null, records: [] };
    const list = db.records
      .filter((r) => r.bookId === b._id)
      .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : (y.createdAt || 0) - (x.createdAt || 0)))
      .slice(0, 500)
      .map((r) => publicRecord(r, commentAvatarMap(db, b)));
    const book = publicBook(b);
    book.partnerInfo = partnerInfoOf(db, b, u._id);
    return { book: book, records: list };
  },

  async upsertRecord(payload) {
    const db = await loadDB();
    const u = userByToken(db, payload.uid, payload.token);
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
      audio:
        input.audio && input.audio.id
          ? { id: input.audio.id, duration: Number(input.audio.duration) || 0 }
          : null,
      authorId: u._id,
      authorName: u.nickname || u.username,
      bookId: b._id,
      updatedAt: Date.now()
    };

    if (input.id) {
      const old = db.records.filter((r) => r._id === input.id)[0];
      if (!old || old.bookId !== b._id) fail('记录不存在', 'NO_RECORD');
      Object.assign(old, doc);
      old.createdAt = old.createdAt || Date.now();
      await saveDB(db);
      return { record: publicRecord(old, commentAvatarMap(db, b)) };
    }

    const rec = Object.assign({ _id: 'r_' + Date.now().toString(36) + rand(8), createdAt: Date.now() }, doc);
    db.records.push(rec);
    await saveDB(db);
    return { record: publicRecord(rec, commentAvatarMap(db, b)) };
  },

  async removeRecord(payload) {
    const db = await loadDB();
    const u = userByToken(db, payload.uid, payload.token);
    const b = bookOfUser(db, u);
    const rec = db.records.filter((r) => r._id === payload.id)[0];
    if (!b || !rec || rec.bookId !== b._id) fail('记录不存在', 'NO_RECORD');
    db.records = db.records.filter((r) => r._id !== payload.id);
    await saveDB(db);
    return { ok: true, images: rec.images || [] };
  },

  /* ---------- 图片 ---------- */

  async uploadImage(payload) {
    const db = await loadDB();
    const u = userByToken(db, payload.uid, payload.token);
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

  /* ---------- 地点搜索（腾讯位置服务） ----------
   * 需要在云函数环境变量里配置 MAP_KEY（lbs.qq.com 免费申请）。
   * 有经纬度时搜附近 10 公里，没有时用 IP 定位兜底。 */
  async searchPlace(payload) {
    const db = await loadDB();
    userByToken(db, payload.uid, payload.token);

    const key = process.env.MAP_KEY || '';
    if (!key) fail('地图服务未配置，请先在云函数环境变量里设置 MAP_KEY', 'NO_MAP_KEY');

    const keyword = String(payload.keyword || '').trim().slice(0, 30);
    if (!keyword) fail('请输入搜索关键词', 'BAD_KEYWORD');

    let lat = Number(payload.lat) || 0;
    let lng = Number(payload.lng) || 0;

    // 没有坐标时用 IP 定位兜底（粗略到城市级，够圈定搜索范围）
    if (!lat || !lng) {
      try {
        const r = await fetch('https://apis.map.qq.com/ws/location/v1/ip?key=' + key);
        const d = await r.json();
        if (d && d.status === 0 && d.result && d.result.location) {
          lat = d.result.location.lat;
          lng = d.result.location.lng;
        }
      } catch (err) {
        /* 忽略 */
      }
    }
    if (!lat || !lng) fail('暂时无法确定搜索范围，请打开定位后重试', 'NO_LOCATION');

    const url =
      'https://apis.map.qq.com/ws/place/v1/search?keyword=' +
      encodeURIComponent(keyword) +
      '&boundary=nearby(' + lat + ',' + lng + ',10000,1)' +
      '&key=' + key +
      '&page_size=10&page_index=1&orderby=_distance';
    const res = await fetch(url);
    const data = await res.json();
    if (!data || data.status !== 0) fail((data && data.message) || '搜索失败', 'SEARCH_FAIL');

    return {
      list: (data.data || []).map((p) => ({
        title: p.title || '',
        address: p.address || '',
        lat: p.location ? p.location.lat : 0,
        lng: p.location ? p.location.lng : 0
      }))
    };
  },

  /* ---------- 每日一问 ---------- */

  async answerDaily(payload) {
    const db = await loadDB();
    const u = userByToken(db, payload.uid, payload.token);
    const b = bookOfUser(db, u);
    if (!b) fail('还没有加入任何本子', 'NO_BOOK');

    const text = String(payload.text || '').trim().slice(0, 500);
    if (!text) fail('先写点什么再保存吧', 'EMPTY');

    const today = new Date().toISOString().slice(0, 10);
    const qa = (b.dailyQA = b.dailyQA || []);
    let entry = qa.filter((x) => x.date === today)[0];
    if (!entry) {
      entry = { date: today, answers: {} };
      qa.push(entry);
    }
    entry.answers[u._id] = text;
    await saveDB(db);
    return { ok: true };
  },

  /* ---------- 心愿清单 ---------- */

  async addWish(payload) {
    const db = await loadDB();
    const u = userByToken(db, payload.uid, payload.token);
    const b = bookOfUser(db, u);
    if (!b) fail('还没有加入任何本子', 'NO_BOOK');

    const text = String(payload.text || '').trim().slice(0, 100);
    if (!text) fail('写下想一起做的事', 'EMPTY');
    const wishes = (b.wishes = b.wishes || []);
    if (wishes.length >= 200) fail('心愿太多啦，先完成几个吧', 'FULL');
    wishes.push({
      id: 'w_' + Date.now().toString(36) + rand(6),
      text: text,
      done: false,
      createdBy: u._id,
      createdAt: Date.now()
    });
    await saveDB(db);
    return { ok: true };
  },

  async toggleWish(payload) {
    const db = await loadDB();
    const u = userByToken(db, payload.uid, payload.token);
    const b = bookOfUser(db, u);
    if (!b) fail('还没有加入任何本子', 'NO_BOOK');
    const w = (b.wishes || []).filter((x) => x.id === payload.id)[0];
    if (!w) fail('心愿不存在', 'NO_WISH');
    w.done = !w.done;
    w.doneAt = w.done ? Date.now() : 0;
    w.doneBy = w.done ? u._id : '';
    await saveDB(db);
    return { ok: true };
  },

  async removeWish(payload) {
    const db = await loadDB();
    const u = userByToken(db, payload.uid, payload.token);
    const b = bookOfUser(db, u);
    if (!b) fail('还没有加入任何本子', 'NO_BOOK');
    b.wishes = (b.wishes || []).filter((x) => x.id !== payload.id);
    await saveDB(db);
    return { ok: true };
  },

  /* ---------- 悄悄话·想你 ---------- */

  async sendMiss(payload) {
    const db = await loadDB();
    const u = userByToken(db, payload.uid, payload.token);
    const b = bookOfUser(db, u);
    if (!b) fail('还没有加入任何本子', 'NO_BOOK');

    const today = new Date().toISOString().slice(0, 10);
    const m = b.miss && b.miss.date === today ? b.miss : { date: today, counts: {}, seen: {} };
    b.miss = m;
    m.counts[u._id] = (m.counts[u._id] || 0) + 1;

    /* 记一条「想你」事件，对方轮询到就在屏幕上飘爱心 */
    const ev = { id: 'm_' + Date.now().toString(36) + rand(6), from: u._id, name: u.nickname || u.username, ts: Date.now() };
    b.missEvents = ((b.missEvents || []).concat([ev])).slice(-50);

    await saveDB(db);
    const partnerId = (b.members || []).filter((x) => x !== u._id)[0] || '';
    return { myCount: m.counts[u._id] || 0, partnerCount: m.counts[partnerId] || 0, eventTs: ev.ts };
  },

  /* 轮询新的「想你」事件：前端传入上次看到的最新时间戳；顺带节流记录在线心跳 */
  async checkMiss(payload) {
    const db = await loadDB();
    const u = userByToken(db, payload.uid, payload.token);
    const b = bookOfUser(db, u);
    if (!b) fail('还没有加入任何本子', 'NO_BOOK');
    const since = Number(payload.since) || 0;
    const events = (b.missEvents || []).filter((e) => e.ts > since);
    if (!u.lastSeen || Date.now() - u.lastSeen > 120000) {
      u.lastSeen = Date.now();
      await saveDB(db);
    }
    return { events: events, now: Date.now() };
  },

  /* ---------- 点赞 / 评论 ---------- */

  async toggleLike(payload) {
    const db = await loadDB();
    const u = userByToken(db, payload.uid, payload.token);
    const b = bookOfUser(db, u);
    const rec = db.records.filter((r) => r._id === payload.id)[0];
    if (!b || !rec || rec.bookId !== b._id) fail('记录不存在', 'NO_RECORD');

    rec.likes = rec.likes || [];
    const at = rec.likes.indexOf(u._id);
    if (at >= 0) rec.likes.splice(at, 1);
    else rec.likes.push(u._id);
    await saveDB(db);
    return { likes: rec.likes };
  },

  async addComment(payload) {
    const db = await loadDB();
    const u = userByToken(db, payload.uid, payload.token);
    const b = bookOfUser(db, u);
    const rec = db.records.filter((r) => r._id === payload.id)[0];
    if (!b || !rec || rec.bookId !== b._id) fail('记录不存在', 'NO_RECORD');

    const text = String(payload.text || '').trim();
    if (!text) fail('先写点什么吧', 'EMPTY');
    rec.comments = rec.comments || [];
    const c = {
      id: 'c_' + Date.now().toString(36) + rand(6),
      uid: u._id,
      name: u.nickname || u.username,
      text: text.slice(0, 500),
      ts: Date.now()
    };
    rec.comments.push(c);
    if (rec.comments.length > 200) rec.comments = rec.comments.slice(-200);
    await saveDB(db);
    return { comment: Object.assign({}, c, { avatar: commentAvatarMap(db, b)[c.uid] || null }) };
  },

  async delComment(payload) {
    const db = await loadDB();
    const u = userByToken(db, payload.uid, payload.token);
    const b = bookOfUser(db, u);
    const rec = db.records.filter((r) => r._id === payload.id)[0];
    if (!b || !rec || rec.bookId !== b._id) fail('记录不存在', 'NO_RECORD');

    const before = (rec.comments || []).length;
    rec.comments = (rec.comments || []).filter((c) => !(c.id === payload.cid && c.uid === u._id));
    if (rec.comments.length === before) fail('只能删除自己写的评论', 'FORBIDDEN');
    await saveDB(db);
    return { ok: true };
  },

  /* ---------- 一次性迁移导出（密钥保护，迁移完成后删除） ---------- */
  async dumpAll(payload) {
    if (String(payload.secret) !== 'cm-mig-7xk2q9zr4t') fail('forbidden');
    const db = await loadDB();
    return {
      books: db.books.map((b) => ({
        _id: b._id,
        code: b.code,
        myName: b.myName,
        partnerName: b.partnerName,
        anniversary: b.anniversary || '',
        myAvatar: b.myAvatar || null,
        partnerAvatar: b.partnerAvatar || null,
        createdBy: b.createdBy || '',
        members: b.members || [],
        wishes: b.wishes || [],
        miss: b.miss || null,
        missEvents: b.missEvents || [],
        dailyQA: b.dailyQA || []
      })),
      records: db.records.map((r) => ({
        bookId: r.bookId,
        date: r.date,
        title: r.title || '',
        note: r.note || '',
        place: r.place || '',
        mood: r.mood || 'sweet',
        tags: r.tags || [],
        images: r.images || [],
        audio: r.audio || null,
        authorName: r.authorName || '',
        createdAt: r.createdAt || 0
      }))
    };
  },

  async imgUrls(payload) {
    if (String(payload.secret) !== 'cm-mig-7xk2q9zr4t') fail('forbidden');
    const ids = (payload.fileIds || []).filter(Boolean).slice(0, 50);
    if (!ids.length) return { urls: {} };
    const res = await app.getTempFileURL({ fileList: ids.map((id) => ({ fileID: id, maxAge: 3600 })) });
    const map = {};
    (res.fileList || []).forEach((f) => {
      if (f && f.fileID) map[f.fileID] = f.tempFileURL || '';
    });
    return { urls: map };
  },

  async getFileUrl(payload) {
    const db = await loadDB();
    userByToken(db, payload.uid, payload.token);
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
  },

  /* ---------- 大图分片上传 ----------
   * HTTP 访问服务的请求体上限约 100KB，大图一次传不完。
   * 这里把大图切成多片分别上传（可并发），最后再调一次 finalize 合并成完整文件。 */
  async uploadImageChunk(payload) {
    const uploadId = String(payload.uploadId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
    const total = Number(payload.total);
    if (!uploadId) fail('分片标识缺失', 'BAD_CHUNK');
    if (!Number.isInteger(total) || total < 1 || total > 30) fail('分片数量不正确', 'BAD_CHUNK');

    const dir = 'love-diary/tmp/' + uploadId + '/';
    let meta = await readFileJSON(dir + 'meta.json');

    if (!meta) {
      // 第一片：校验身份并写入元信息（记下归属用户，避免他人拼接）
      const db = await loadDB();
      const u = userByToken(db, payload.uid, payload.token);
      meta = {
        uid: u._id,
        total: total,
        name: String(payload.name || 'photo.jpg').slice(0, 60),
        at: Date.now()
      };
      await app.uploadFile({
        cloudPath: dir + 'meta.json',
        fileContent: Buffer.from(JSON.stringify(meta), 'utf8'),
        headers: { 'Content-Type': 'application/json' }
      });
    } else if (meta.uid !== payload.uid) {
      fail('分片不属于当前账号', 'FORBIDDEN');
    }

    /* 合并阶段：一次性取所有分片的地址，再并行下载，尽量快 */
    if (payload.finalize) {
      const fileIDs = [];
      for (let i = 0; i < meta.total; i++) fileIDs.push(await fileIDOf(dir + 'p' + i));

      const res = await app.getTempFileURL({
        fileList: fileIDs.map((id) => ({ fileID: id, maxAge: 120 }))
      });
      const urlMap = {};
      (res.fileList || []).forEach((it) => {
        if (it && it.fileID) urlMap[it.fileID] = it.tempFileURL || '';
      });

      const parts = await Promise.all(
        fileIDs.map(async (id) => {
          const url = urlMap[id];
          if (!url) fail('有分片丢失，请重试', 'CHUNK_MISSING');
          const r = await fetch(url);
          return Buffer.from(await r.arrayBuffer());
        })
      );
      const full = Buffer.concat(parts);
      if (!full.length) fail('图片内容为空', 'EMPTY_IMAGE');

      const ext =
        (String(meta.name || 'photo.jpg').split('.').pop() || 'jpg')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '') || 'jpg';
      const cloudPath = 'love-diary/' + meta.uid + '/' + Date.now() + '_' + rand(8) + '.' + ext;
      const up = await app.uploadFile({ cloudPath: cloudPath, fileContent: full });
      if (!up || !up.fileID) fail('图片上传失败', 'UPLOAD_FAIL');

      // 清理临时分片（失败也不影响结果）
      try {
        const list = [{ fileID: await fileIDOf(dir + 'meta.json') }];
        for (let i = 0; i < meta.total; i++) list.push({ fileID: await fileIDOf(dir + 'p' + i) });
        await app.deleteFile({ fileList: list });
      } catch (err) {
        /* 忽略 */
      }
      return { fileId: up.fileID, bytes: full.length };
    }

    /* 分片写入阶段 */
    const index = Number(payload.index);
    if (!Number.isInteger(index) || index < 0 || index >= meta.total) fail('分片序号不正确', 'BAD_CHUNK');
    const clean = String(payload.base64 || '').split(',').pop();
    if (!clean) fail('分片内容为空', 'NO_FILE');
    const buf = Buffer.from(clean, 'base64');
    if (buf.length > 90 * 1024) fail('单个分片过大', 'CHUNK_TOO_LARGE');
    await app.uploadFile({ cloudPath: dir + 'p' + index, fileContent: buf });

    return { done: false, index: index, total: meta.total };
  }
};

/* 兼容 SDK 调用与 HTTP 访问服务两种入参 */
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
