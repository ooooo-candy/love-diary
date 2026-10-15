/* 旧数据迁移：从旧版 CloudBase HTTP API 拉取记录，照片逐张搬到新云存储 */
const cloud = require('wx-server-sdk');
const axios = require('axios');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const books = db.collection('books');
const users = db.collection('users');
const records = db.collection('records');
const _ = db.command;

const SECRET = 'cm-mig-7xk2q9zr4t';

function auth(event) {
  if (String(event.secret) !== SECRET) throw new Error('forbidden');
}

async function callerOf(OPENID) {
  const found = await users.where({ openid: OPENID }).limit(1).get();
  return found.data[0] || null;
}

async function fetchDump(oldBase) {
  const res = await axios.post(
    oldBase,
    { action: 'dumpAll', payload: { secret: SECRET } },
    { timeout: 30000, headers: { 'Content-Type': 'application/json' } }
  );
  const body = res.data || {};
  if (!body.ok) throw new Error(body.error || '旧数据拉取失败');
  return body.data;
}

async function oldImageUrls(oldBase, fileIds) {
  const ids = fileIds.filter(Boolean).slice(0, 50);
  if (!ids.length) return {};
  const res = await axios.post(
    oldBase,
    { action: 'imgUrls', payload: { secret: SECRET, fileIds: ids } },
    { timeout: 30000, headers: { 'Content-Type': 'application/json' } }
  );
  const body = res.data || {};
  if (!body.ok) throw new Error(body.error || '旧图片链接获取失败');
  return body.data.urls || {};
}

async function downloadBuffer(url) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
  return Buffer.from(res.data);
}

function extOf(oldId) {
  const m = String(oldId || '').toLowerCase().match(/\.(jpe?g|png|webp|gif|m4a|mp3|aac|wav|webm|mp4|m3u8)/);
  return m ? m[1] : 'jpg';
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  try {
    auth(event);
    const u = await callerOf(OPENID);
    if (!u) return { ok: false, error: '请先登录' };

    /* ---------- 第一步：拉取旧数据，定位/创建目标本子 ---------- */
    if (event.action === 'init') {
      const dump = await fetchDump(event.oldBase);
      const oldBook = (dump.books || [])[0] || { code: 'CHAMU1', myName: '我', partnerName: '宝贝', anniversary: '' };

      let bookId = u.bookId || '';
      let created = false;
      if (!bookId) {
        /* 优先找同码本子（另一伴先迁移过） */
        const same = await books.where({ code: oldBook.code }).limit(1).get();
        if (same.data.length) {
          bookId = same.data[0]._id;
          if ((same.data[0].members || []).indexOf(u._id) < 0 && (same.data[0].members || []).length < 2) {
            await books.doc(bookId).update({ data: { members: _.push(u._id) } });
            await users.doc(u._id).update({ data: { bookId: bookId } });
          }
        } else {
          const added = await books.add({
            data: {
              code: oldBook.code,
              members: [u._id],
              createdBy: u._id,
              myName: oldBook.myName || '我',
              partnerName: oldBook.partnerName || '宝贝',
              anniversary: oldBook.anniversary || '',
              myAvatar: '',
              partnerAvatar: '',
              createdAt: Date.now()
            }
          });
          bookId = added._id;
          await users.doc(u._id).update({ data: { bookId: bookId } });
          created = true;
        }
      }

      /* 只迁第一个本子（真实数据），测试本子的记录不搬 */
      dump.records = (dump.records || []).filter((r) => !oldBook._id || !r.bookId || r.bookId === oldBook._id);
      const total = dump.records.length;
      let dumpFileID = '';
      if (total) {
        const up = await cloud.uploadFile({
          cloudPath: 'migrate/dump-' + u._id + '.json',
          fileContent: Buffer.from(JSON.stringify(dump), 'utf8')
        });
        dumpFileID = up.fileID;
      }
      return { ok: true, data: { bookId: bookId, bookCode: oldBook.code, created: created, total: total, dumpFileID: dumpFileID } };
    }

    /* ---------- 第二步：分批搬运记录与照片 ---------- */
    if (event.action === 'batch') {
      const dumpRes = await cloud.getTempFileURL({ fileList: [event.dumpFileID] });
      const url = dumpRes.fileList && dumpRes.fileList[0] && dumpRes.fileList[0].tempFileURL;
      if (!url) return { ok: false, error: '迁移缓存失效，请重新开始' };
      const dumpRes2 = await axios.get(url, { responseType: 'json', timeout: 30000 });
      const dump = dumpRes2.data;
      const all = dump.records || [];

      const start = Math.max(0, Number(event.start) || 0);
      const count = Math.min(4, Math.max(1, Number(event.count) || 4));
      const slice = all.slice(start, start + count);
      if (!slice.length) return { ok: true, data: { processed: 0, remaining: Math.max(0, all.length - start) } };

      /* 收集本批所有旧文件 ID，一次性换临时链接 */
      const fileIds = [];
      slice.forEach((r) => {
        (r.images || []).forEach((i) => i && i.id && fileIds.push(i.id));
        if (r.audio && r.audio.id) fileIds.push(r.audio.id);
      });
      const urls = await oldImageUrls(event.oldBase, fileIds);

      let done = 0;
      for (const r of slice) {
        const images = [];
        for (const img of r.images || []) {
          const oldUrl = urls[img.id];
          if (!oldUrl) continue;
          try {
            const buf = await downloadBuffer(oldUrl);
            const up = await cloud.uploadFile({
              cloudPath: 'records/' + bookId + '/' + (r.createdAt || Date.now()) + '_' + done + '_' + images.length + '.' + extOf(img.id),
              fileContent: buf
            });
            images.push({ fileId: up.fileID });
          } catch (err) { /* 单张失败跳过，不阻断 */ }
        }
        let audio = null;
        if (r.audio && r.audio.id && urls[r.audio.id]) {
          try {
            const buf = await downloadBuffer(urls[r.audio.id]);
            const up = await cloud.uploadFile({
              cloudPath: 'records/' + bookId + '/' + (r.createdAt || Date.now()) + '_' + done + '_audio.' + extOf(r.audio.id),
              fileContent: buf
            });
            audio = { fileId: up.fileID, duration: r.audio.duration || 0 };
          } catch (err) { /* 忽略 */ }
        }
        await records.add({
          data: {
            bookId: event.bookId,
            date: r.date,
            title: r.title,
            note: r.note,
            place: r.place,
            mood: r.mood,
            tags: r.tags || [],
            images: images,
            audio: audio,
            authorId: '',
            authorName: r.authorName || 'Ta',
            createdAt: r.createdAt || Date.now()
          }
        });
        done++;
      }

      const processed = Math.min(done, slice.length);
      return { ok: true, data: { processed: processed, remaining: Math.max(0, all.length - (start + processed)) } };
    }

    /* ---------- 第三步：清理迁移缓存 ---------- */
    if (event.action === 'finish') {
      if (event.dumpFileID) {
        try { await cloud.deleteFile({ fileList: [event.dumpFileID] }); } catch (err) { /* 忽略 */ }
      }
      return { ok: true, data: {} };
    }

    return { ok: false, error: '未知操作' };
  } catch (err) {
    return { ok: false, error: err.message || '迁移服务异常' };
  }
};
