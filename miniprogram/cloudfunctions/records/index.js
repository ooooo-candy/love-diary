/* 记录：列表 / 新增编辑 / 删除 / 点赞 / 评论（含语音日记字段） */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const records = db.collection('records');
const users = db.collection('users');
const books = db.collection('books');

async function me(OPENID) {
  const found = await users.where({ openid: OPENID }).limit(1).get();
  if (!found.data.length) return null;
  return found.data[0];
}

/* 评论头像：本子双方头像优先，其次账号头像 */
async function avatarMapOf(bookId) {
  const map = {};
  try {
    const b = await books.doc(bookId).get();
    const other = (b.data.members || []).filter((x) => x !== b.data.createdBy)[0];
    if (b.data.createdBy && b.data.myAvatar) map[b.data.createdBy] = b.data.myAvatar;
    if (other && b.data.partnerAvatar) map[other] = b.data.partnerAvatar;
    for (const uid of b.data.members || []) {
      if (map[uid]) continue;
      try {
        const usr = await users.doc(uid).get();
        if (usr.data && usr.data.avatar) map[uid] = usr.data.avatar;
      } catch (err) { /* 忽略 */ }
    }
  } catch (err) { /* 忽略 */ }
  return map;
}

function decorate(r, amap) {
  return {
    _id: r._id,
    date: r.date,
    title: r.title || '',
    note: r.note || '',
    place: r.place || '',
    mood: r.mood || 'sweet',
    tags: r.tags || [],
    images: r.images || [],
    audio: r.audio || null,
    likes: r.likes || [],
    comments: (r.comments || []).slice(-100).map((c) => ({ ...c, avatar: (amap && amap[c.uid]) || '' })),
    authorId: r.authorId || '',
    authorName: r.authorName || '',
    createdAt: r.createdAt || 0
  };
}

async function checkBook(u) {
  if (!u.bookId) throw new Error('还没有加入任何本子');
  return u.bookId;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  try {
    const u = await me(OPENID);
    if (!u) return { ok: false, error: '请先登录' };
    const bookId = await checkBook(u);

    if (event.action === 'list') {
      const got = await records
        .where({ bookId: bookId })
        .orderBy('date', 'desc')
        .orderBy('createdAt', 'desc')
        .limit(500)
        .get();
      const amap = await avatarMapOf(bookId);
      return { ok: true, data: { records: got.data.map((r) => decorate(r, amap)) } };
    }

    if (event.action === 'upsert') {
      const input = event.record || {};
      const doc = {
        date: input.date || new Date().toISOString().slice(0, 10),
        title: String(input.title || '').slice(0, 60),
        note: String(input.note || '').slice(0, 5000),
        place: String(input.place || '').slice(0, 60),
        mood: input.mood || 'sweet',
        tags: (input.tags || []).slice(0, 12).map((t) => String(t).slice(0, 16)),
        images: (input.images || []).slice(0, 9),
        audio: input.audio && input.audio.fileId ? { fileId: input.audio.fileId, duration: Number(input.audio.duration) || 0 } : null,
        updatedAt: Date.now()
      };
      let out;
      if (input.id) {
        const old = await records.doc(input.id).get();
        if (!old.data || old.data.bookId !== bookId) return { ok: false, error: '记录不存在' };
        await records.doc(input.id).update({ data: doc });
        const fresh = await records.doc(input.id).get();
        out = fresh.data;
      } else {
        doc.bookId = bookId;
        doc.authorId = u._id;
        doc.authorName = u.nickname || 'Ta';
        doc.createdAt = Date.now();
        doc.likes = [];
        doc.comments = [];
        const added = await records.add({ data: doc });
        const fresh = await records.doc(added._id).get();
        out = fresh.data;
      }
      const amap = await avatarMapOf(bookId);
      return { ok: true, data: { record: decorate(out, amap) } };
    }

    if (event.action === 'remove') {
      const old = await records.doc(event.id).get();
      if (!old.data || old.data.bookId !== bookId) return { ok: false, error: '记录不存在' };
      const fileIds = (old.data.images || []).map((i) => i.fileId).filter(Boolean);
      if (old.data.audio && old.data.audio.fileId) fileIds.push(old.data.audio.fileId);
      if (fileIds.length) {
        try { await cloud.deleteFile({ fileList: fileIds }); } catch (err) { /* 忽略 */ }
      }
      await records.doc(event.id).remove();
      return { ok: true, data: {} };
    }

    if (event.action === 'toggleLike') {
      const old = await records.doc(event.id).get();
      if (!old.data || old.data.bookId !== bookId) return { ok: false, error: '记录不存在' };
      const likes = old.data.likes || [];
      const at = likes.indexOf(u._id);
      if (at >= 0) likes.splice(at, 1);
      else likes.push(u._id);
      await records.doc(event.id).update({ data: { likes: likes } });
      return { ok: true, data: { likes: likes } };
    }

    if (event.action === 'addComment') {
      const old = await records.doc(event.id).get();
      if (!old.data || old.data.bookId !== bookId) return { ok: false, error: '记录不存在' };
      const text = String(event.text || '').trim().slice(0, 500);
      if (!text) return { ok: false, error: '先写点什么吧' };
      const c = { id: 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1000), uid: u._id, name: u.nickname || 'Ta', text: text, ts: Date.now() };
      const comments = ((old.data.comments || []).concat([c])).slice(-200);
      await records.doc(event.id).update({ data: { comments: comments } });
      const amap = await avatarMapOf(bookId);
      return { ok: true, data: { comment: { ...c, avatar: amap[c.uid] || '' }, count: comments.length } };
    }

    if (event.action === 'delComment') {
      const old = await records.doc(event.id).get();
      if (!old.data || old.data.bookId !== bookId) return { ok: false, error: '记录不存在' };
      const comments = (old.data.comments || []).filter((c) => !(c.id === event.cid && c.uid === u._id));
      if (comments.length === (old.data.comments || []).length) return { ok: false, error: '只能删除自己写的评论' };
      await records.doc(event.id).update({ data: { comments: comments } });
      return { ok: true, data: { count: comments.length } };
    }

    return { ok: false, error: '未知操作' };
  } catch (err) {
    return { ok: false, error: err.message || '服务异常' };
  }
};
