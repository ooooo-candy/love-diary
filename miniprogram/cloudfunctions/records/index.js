/* 记录：列表 / 新增编辑 / 删除（点赞评论第二期） */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const records = db.collection('records');
const users = db.collection('users');

async function me(OPENID) {
  const found = await users.where({ openid: OPENID }).limit(1).get();
  if (!found.data.length) return null;
  return found.data[0];
}

function publicRecord(r) {
  return {
    _id: r._id,
    date: r.date,
    title: r.title || '',
    note: r.note || '',
    place: r.place || '',
    mood: r.mood || 'sweet',
    tags: r.tags || [],
    images: r.images || [],
    authorId: r.authorId || '',
    authorName: r.authorName || '',
    createdAt: r.createdAt || 0
  };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  try {
    const u = await me(OPENID);
    if (!u) return { ok: false, error: '请先登录' };
    if (!u.bookId) return { ok: false, error: '还没有加入任何本子' };
    const bookId = u.bookId;

    if (event.action === 'list') {
      const got = await records
        .where({ bookId: bookId })
        .orderBy('date', 'desc')
        .orderBy('createdAt', 'desc')
        .limit(500)
        .get();
      return { ok: true, data: { records: got.data.map(publicRecord) } };
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
        updatedAt: Date.now()
      };
      if (input.id) {
        const old = await records.doc(input.id).get();
        if (!old.data || old.data.bookId !== bookId) return { ok: false, error: '记录不存在' };
        await records.doc(input.id).update({ data: doc });
        const fresh = await records.doc(input.id).get();
        return { ok: true, data: { record: publicRecord(fresh.data) } };
      }
      doc.bookId = bookId;
      doc.authorId = u._id;
      doc.authorName = u.nickname || 'Ta';
      doc.createdAt = Date.now();
      const added = await records.add({ data: doc });
      const fresh = await records.doc(added._id).get();
      return { ok: true, data: { record: publicRecord(fresh.data) } };
    }

    if (event.action === 'remove') {
      const old = await records.doc(event.id).get();
      if (!old.data || old.data.bookId !== bookId) return { ok: false, error: '记录不存在' };
      /* 云存储里的照片一并删除 */
      const fileIds = (old.data.images || []).map((i) => i.fileId).filter(Boolean);
      if (fileIds.length) {
        try { await cloud.deleteFile({ fileList: fileIds }); } catch (err) { /* 忽略 */ }
      }
      await records.doc(event.id).remove();
      return { ok: true, data: {} };
    }

    return { ok: false, error: '未知操作' };
  } catch (err) {
    return { ok: false, error: err.message || '服务异常' };
  }
};
