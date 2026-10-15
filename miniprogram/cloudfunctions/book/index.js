/* 情侣本：创建 / 邀请码加入 / 查询 / 资料更新 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const books = db.collection('books');
const users = db.collection('users');
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

function publicBook(b, myUid) {
  if (!b) return null;
  const otherId = (b.members || []).filter((x) => x !== myUid)[0] || '';
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
    partnerId: otherId,
    isCreator: b.createdBy === myUid
  };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  try {
    const u = await me(OPENID);
    if (!u) return { ok: false, error: '请先登录' };

    /* 创建本子 */
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
          createdAt: Date.now()
        }
      });
      await users.doc(u._id).update({ data: { bookId: added._id } });
      if (event.myName || event.nickname) {
        await users.doc(u._id).update({ data: { nickname: (event.nickname || event.myName || '').slice(0, 12) } });
      }
      const b = await books.doc(added._id).get();
      const fresh = await users.doc(u._id).get();
      return { ok: true, data: { book: publicBook(b.data, u._id), user: { _id: fresh.data._id, nickname: fresh.data.nickname, avatar: fresh.data.avatar, bookId: fresh.data.bookId } } };
    }

    /* 邀请码加入 */
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
      const freshBook = await books.doc(b._id).get();
      const fresh = await users.doc(u._id).get();
      return { ok: true, data: { book: publicBook(freshBook.data, u._id), user: { _id: fresh.data._id, nickname: fresh.data.nickname, avatar: fresh.data.avatar, bookId: fresh.data.bookId } } };
    }

    /* 查询当前本子（含对方信息） */
    if (event.action === 'get') {
      if (!u.bookId) return { ok: true, data: { book: null } };
      const b = await books.doc(u.bookId).get();
      const book = publicBook(b.data, u._id);
      if (book.partnerId) {
        const other = await users.doc(book.partnerId).get();
        book.partnerInfo = {
          nickname: other.data.nickname || book.partnerName,
          avatar: other.data.avatar || ''
        };
      }
      return { ok: true, data: { book: book } };
    }

    /* 更新资料：按角色自动写 my* / partner* 字段 */
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

    return { ok: false, error: '未知操作' };
  } catch (err) {
    return { ok: false, error: err.message || '服务异常' };
  }
};
