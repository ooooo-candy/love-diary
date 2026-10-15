/* 情侣本：创建 / 加入 / 查询 / 资料 + 心愿清单 + 悄悄话想你 + 每日一问 + 小程序码 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const books = db.collection('books');
const users = db.collection('users');
const records = db.collection('records');
const _ = db.command;

async function me(OPENID) {
  const found = await users.where({ openid: OPENID }).limit(1).get();
  if (!found.data.length) return null;
  return found.data[0];
}

function randCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

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
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return DAILY_QUESTIONS[h % DAILY_QUESTIONS.length];
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function publicBook(b, myUid) {
  if (!b) return null;
  const otherId = (b.members || []).filter((x) => x !== myUid)[0] || '';
  const dailyEntry = ((b.dailyQA || []).filter((x) => x.date === today())[0]) || { date: today(), answers: {} };
  const miss = b.miss && b.miss.date === today() ? b.miss : { date: today(), counts: {} };
  const partnerId = otherId;
  return {
    _id: b._id,
    code: b.code,
    myName: b.myName || '我',
    partnerName: b.partnerName || '宝贝',
    anniversary: b.anniversary || '',
    myAvatar: b.myAvatar || '',
    partnerAvatar: b.partnerAvatar || '',
    members: b.members || [],
    createdBy: b.createdBy || '',
    partnerJoined: (b.members || []).length >= 2,
    partnerId: partnerId,
    isCreator: b.createdBy === myUid,
    wishes: b.wishes || [],
    miss: { myCount: miss.counts[myUid] || 0, partnerCount: miss.counts[partnerId] || 0 },
    daily: { date: today(), question: dailyQuestion(today()), answers: dailyEntry.answers || {} },
    dailyHistory: (b.dailyQA || []).slice(-60).reverse().map((x) => ({
      date: x.date,
      question: dailyQuestion(x.date),
      answers: x.answers || {}
    }))
  };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  try {
    const u = await me(OPENID);
    if (!u) return { ok: false, error: '请先登录' };

    /* ---------- 基础 ---------- */

    if (event.action === 'create') {
      if (u.bookId) {
        const old = await books.doc(u.bookId).get();
        return { ok: true, data: { book: publicBook(old.data, u._id) } };
      }
      let code = randCode();
      for (let i = 0; i < 5; i++) {
        const dup = await books.where({ code: code }).count();
        if (!dup.total) break;
        code = randCode();
      }
      const added = await books.add({
        data: {
          code: code,
          members: [u._id],
          createdBy: u._id,
          myName: (event.myName || '我').slice(0, 12),
          partnerName: (event.partnerName || '宝贝').slice(0, 12),
          anniversary: event.anniversary || '',
          myAvatar: u.avatar || '',
          partnerAvatar: '',
          wishes: [],
          miss: null,
          missEvents: [],
          dailyQA: [],
          createdAt: Date.now()
        }
      });
      const patch = { bookId: added._id };
      if (event.nickname) patch.nickname = String(event.nickname).slice(0, 12);
      await users.doc(u._id).update({ data: patch });
      const b = await books.doc(added._id).get();
      const fresh = await users.doc(u._id).get();
      return { ok: true, data: { book: publicBook(b.data, u._id), user: { _id: fresh.data._id, nickname: fresh.data.nickname, avatar: fresh.data.avatar, bookId: fresh.data.bookId } } };
    }

    if (event.action === 'join') {
      if (u.bookId) {
        const old = await books.doc(u.bookId).get();
        return { ok: true, data: { book: publicBook(old.data, u._id) } };
      }
      const code = String(event.code || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(code)) return { ok: false, error: '邀请码格式不对' };
      const found = await books.where({ code: code }).limit(1).get();
      if (!found.data.length) return { ok: false, error: '邀请码不存在，让 TA 再看看' };
      const b = found.data[0];
      if ((b.members || []).indexOf(u._id) >= 0) {
        await users.doc(u._id).update({ data: { bookId: b._id } });
        return { ok: true, data: { book: publicBook(b, u._id) } };
      }
      if ((b.members || []).length >= 2) return { ok: false, error: '这个本子已经有两位主人啦' };
      await books.doc(b._id).update({ data: { members: _.push(u._id) } });
      await users.doc(u._id).update({ data: { bookId: b._id } });

      /* 迁移进来的旧数据里，没到场的那个人的身份是 PENDING，现在补上 */
      try {
        const bd = (await books.doc(b._id).get()).data;
        const patch = {};
        if ((bd.dailyQA || []).some((x) => x.answers && x.answers.PENDING !== undefined)) {
          patch.dailyQA = bd.dailyQA.map((x) => {
            const answers = {};
            Object.keys(x.answers || {}).forEach((k) => { answers[k === 'PENDING' ? u._id : k] = x.answers[k]; });
            return { date: x.date, answers: answers };
          });
        }
        if (bd.miss && bd.miss.counts && bd.miss.counts.PENDING !== undefined) {
          const counts = { ...bd.miss.counts };
          counts[u._id] = counts.PENDING;
          delete counts.PENDING;
          patch.miss = { date: bd.miss.date, counts: counts };
        }
        if ((bd.missEvents || []).some((e) => e.from === 'PENDING')) {
          patch.missEvents = bd.missEvents.map((e) => (e.from === 'PENDING' ? { ...e, from: u._id } : e));
        }
        const legacy = bd.legacy || null;
        if (legacy) {
          if (!legacy.creatorNew) legacy.creatorNew = u._id;
          else if (!legacy.partnerNew) legacy.partnerNew = u._id;
          patch.legacy = legacy;
        }
        await books.doc(b._id).update({ data: patch });

        /* 记录里的 PENDING 点赞/评论/作者 */
        const recs = await records.where({ bookId: b._id }).limit(500).get();
        for (const r of recs.data) {
          const p = {};
          if ((r.likes || []).indexOf('PENDING') >= 0) {
            p.likes = r.likes.map((x) => (x === 'PENDING' ? u._id : x));
          }
          if ((r.comments || []).some((c) => c.uid === 'PENDING')) {
            p.comments = r.comments.map((c) => (c.uid === 'PENDING' ? { ...c, uid: u._id } : c));
          }
          if (r.authorId === 'PENDING') p.authorId = u._id;
          if (Object.keys(p).length) await records.doc(r._id).update({ data: p });
        }
      } catch (err) { /* 补齐失败不影响加入 */ }

      const freshBook = await books.doc(b._id).get();
      const fresh = await users.doc(u._id).get();
      return { ok: true, data: { book: publicBook(freshBook.data, u._id), user: { _id: fresh.data._id, nickname: fresh.data.nickname, avatar: fresh.data.avatar, bookId: fresh.data.bookId } } };
    }

    if (event.action === 'get') {
      if (!u.bookId) return { ok: true, data: { book: null } };
      const b = await books.doc(u.bookId).get();
      const book = publicBook(b.data, u._id);
      if (book.partnerId) {
        const other = await users.doc(book.partnerId).get();
        book.partnerInfo = {
          nickname: other.data.nickname || book.partnerName,
          avatar: other.data.avatar || '',
          lastSeen: other.data.lastSeen || 0
        };
      }
      return { ok: true, data: { book: book } };
    }

    if (event.action === 'update') {
      if (!u.bookId) return { ok: false, error: '还没有加入任何本子' };
      const b = await books.doc(u.bookId).get();
      const patch = {};
      const isCreator = b.data.createdBy === u._id;
      const pre = isCreator ? 'my' : 'partner';
      const otherPre = isCreator ? 'partner' : 'my';
      if (typeof event.myName === 'string' && event.myName.trim()) patch[pre + 'Name'] = event.myName.trim().slice(0, 12);
      if (typeof event.partnerName === 'string' && event.partnerName.trim()) patch[otherPre + 'Name'] = event.partnerName.trim().slice(0, 12);
      if (typeof event.anniversary === 'string') patch.anniversary = event.anniversary;
      if (typeof event.myAvatar === 'string') patch[pre + 'Avatar'] = event.myAvatar;
      if (Object.keys(patch).length) await books.doc(u.bookId).update({ data: patch });
      const fresh = await books.doc(u.bookId).get();
      return { ok: true, data: { book: publicBook(fresh.data, u._id) } };
    }

    /* ---------- 心愿清单 ---------- */

    if (event.action === 'addWish') {
      if (!u.bookId) return { ok: false, error: '还没有加入任何本子' };
      const text = String(event.text || '').trim().slice(0, 60);
      if (!text) return { ok: false, error: '先写个心愿吧' };
      const w = { id: 'w' + Date.now().toString(36) + Math.floor(Math.random() * 1000), text: text, done: false };
      await books.doc(u.bookId).update({ data: { wishes: _.push([w]) } });
      return { ok: true, data: { wish: w } };
    }

    if (event.action === 'toggleWish') {
      const b = await books.doc(u.bookId).get();
      const list = (b.data.wishes || []).map((w) => (w.id === event.id ? { ...w, done: !w.done } : w));
      await books.doc(u.bookId).update({ data: { wishes: list } });
      return { ok: true, data: { wishes: list } };
    }

    if (event.action === 'removeWish') {
      const b = await books.doc(u.bookId).get();
      const list = (b.data.wishes || []).filter((w) => w.id !== event.id);
      await books.doc(u.bookId).update({ data: { wishes: list } });
      return { ok: true, data: { wishes: list } };
    }

    /* ---------- 悄悄话·想你 ---------- */

    if (event.action === 'sendMiss') {
      if (!u.bookId) return { ok: false, error: '还没有加入任何本子' };
      const b = await books.doc(u.bookId).get();
      const d = today();
      const m = b.data.miss && b.data.miss.date === d ? b.data.miss : { date: d, counts: {} };
      m.counts[u._id] = (m.counts[u._id] || 0) + 1;
      const ev = { id: 'm' + Date.now().toString(36), from: u._id, name: u.nickname || 'Ta', ts: Date.now() };
      const events = ((b.data.missEvents || []).concat([ev])).slice(-50);
      await books.doc(u.bookId).update({ data: { miss: m, missEvents: events } });
      const partnerId = (b.data.members || []).filter((x) => x !== u._id)[0] || '';
      return { ok: true, data: { myCount: m.counts[u._id] || 0, partnerCount: m.counts[partnerId] || 0, eventTs: ev.ts } };
    }

    if (event.action === 'checkMiss') {
      if (!u.bookId) return { ok: true, data: { events: [] } };
      const b = await books.doc(u.bookId).get();
      const since = Number(event.since) || 0;
      if (!u.lastSeen || Date.now() - u.lastSeen > 120000) {
        await users.doc(u._id).update({ data: { lastSeen: Date.now() } });
      }
      return { ok: true, data: { events: (b.data.missEvents || []).filter((e) => e.ts > since), now: Date.now() } };
    }

    /* ---------- 每日一问 ---------- */

    if (event.action === 'answerDaily') {
      if (!u.bookId) return { ok: false, error: '还没有加入任何本子' };
      const text = String(event.text || '').trim().slice(0, 500);
      if (!text) return { ok: false, error: '先写点什么吧' };
      const b = await books.doc(u.bookId).get();
      const d = today();
      const list = (b.data.dailyQA || []).filter((x) => x.date !== d);
      const entry = { date: d, answers: {} };
      const oldSame = (b.data.dailyQA || []).filter((x) => x.date === d)[0];
      if (oldSame) entry.answers = oldSame.answers || {};
      entry.answers[u._id] = text;
      list.push(entry);
      list.sort((a, c) => (a.date < c.date ? -1 : 1));
      if (list.length > 60) list = list.slice(-60);
      await books.doc(u.bookId).update({ data: { dailyQA: list } });
      return { ok: true, data: { daily: { date: d, question: dailyQuestion(d), answers: entry.answers } } };
    }

    /* ---------- 小程序码（分享二维码） ---------- */

    if (event.action === 'getQrcode') {
      if (!u.bookId) return { ok: false, error: '还没有加入任何本子' };
      try {
        const res = await cloud.openapi.wxacode.getUnlimited({
          scene: 'c=' + event.code,
          page: 'pages/onboard/onboard',
          width: 430,
          checkPath: false
        });
        const up = await cloud.uploadFile({
          cloudPath: 'qrcode/' + event.code + '.png',
          fileContent: Buffer.from(res.buffer)
        });
        return { ok: true, data: { fileId: up.fileID } };
      } catch (err) {
        return { ok: false, error: '小程序码生成失败（发布后可用）' };
      }
    }

    return { ok: false, error: '未知操作' };
  } catch (err) {
    return { ok: false, error: err.message || '服务异常' };
  }
};
