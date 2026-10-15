/* 一键迁移：清空新环境 → 按旧 App 原样重建本子 → 照片/语音/点赞/评论/每日一问/心愿/想你 全部还原 */
const cloud = require('wx-server-sdk');
const axios = require('axios');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const books = db.collection('books');
const users = db.collection('users');
const records = db.collection('records');

const SECRET = 'cm-mig-7xk2q9zr4t';
const PENDING = 'PENDING';

function auth(event) {
  if (String(event.secret) !== SECRET) throw new Error('forbidden');
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
  const m = String(oldId || '').toLowerCase().match(/\.(jpe?g|png|webp|gif|m4a|mp3|aac|wav|webm|mp4)/);
  return m ? m[1] : 'jpg';
}

/* 清空集合（新环境里全是测试/半途数据，原原本本重来） */
async function wipe(col) {
  for (let i = 0; i < 300; i++) {
    const got = await col.limit(100).get();
    if (!got.data.length) break;
    await Promise.all(got.data.map((d) => col.doc(d._id).remove()));
  }
}

function mapUid(uidMap, k) {
  return uidMap[k] !== undefined ? uidMap[k] : k;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  try {
    auth(event);

    /* ---------- 准备：找到旧本子（按记录数取最多的，即真实本子） ---------- */
    if (event.action === 'prepare') {
      const dump = await fetchDump(event.oldBase);
      const list = (dump.books || []).map((b) => ({
        oldId: b._id,
        code: b.code,
        myName: b.myName || '我',
        partnerName: b.partnerName || '宝贝',
        anniversary: b.anniversary || '',
        count: (dump.records || []).filter((r) => r.bookId === b._id).length
      }));
      list.sort((a, b) => b.count - a.count);
      return { ok: true, data: { book: list[0] || null, others: list.length - 1 } };
    }

    /* ---------- 一键执行：清空 → 重建 → 挂接当前用户 ---------- */
    if (event.action === 'run') {
      const dump = await fetchDump(event.oldBase);
      const oldBook = (dump.books || []).filter((b) => b._id === event.oldBookId)[0];
      if (!oldBook) return { ok: false, error: '旧本子不存在' };

      /* 1. 清空新环境 */
      await wipe(users);
      await wipe(books);
      await wipe(records);

      /* 2. 重建当前用户身份 */
      const myName = String(event.myName || '').slice(0, 12);
      const added = await users.add({
        data: { openid: OPENID, nickname: myName, avatar: '', bookId: '', lastSeen: Date.now(), createdAt: Date.now() }
      });
      const myNewId = added._id;

      /* 3. 角色：调用者是旧本子的“我”还是“宝贝” */
      const myIsCreator = oldBook.myName === myName;
      const creatorOld = oldBook.createdBy || (oldBook.members || [])[0] || '';
      const partnerOld = (oldBook.members || []).filter((x) => x !== creatorOld)[0] || '';
      const uidMap = {};
      uidMap[creatorOld] = myIsCreator ? myNewId : PENDING;
      uidMap[partnerOld] = myIsCreator ? PENDING : myNewId;

      /* 4. 头像搬到新存储（旧“我”的头像跟人走） */
      let myAvatarFile = '';
      let partnerAvatarFile = '';
      const avIds = [oldBook.myAvatar, oldBook.partnerAvatar].filter(Boolean);
      if (avIds.length) {
        const urls = await oldImageUrls(event.oldBase, avIds);
        if (oldBook.myAvatar && urls[oldBook.myAvatar]) {
          const up = await cloud.uploadFile({
            cloudPath: 'avatars/' + myNewId + '.jpg',
            fileContent: await downloadBuffer(urls[oldBook.myAvatar])
          });
          myAvatarFile = up.fileID;
        }
        if (oldBook.partnerAvatar && urls[oldBook.partnerAvatar]) {
          const up = await cloud.uploadFile({
            cloudPath: 'avatars/partner_' + Date.now() + '.jpg',
            fileContent: await downloadBuffer(urls[oldBook.partnerAvatar])
          });
          partnerAvatarFile = up.fileID;
        }
      }
      await users.doc(myNewId).update({ data: { avatar: myAvatarFile } });

      /* 5. 创建本子（邀请码/名字/纪念日/头像/心愿/想你/每日一问 原样，uid 按角色映射） */
      const mapKeys = (obj) => {
        const out = {};
        Object.keys(obj || {}).forEach((k) => { out[mapUid(uidMap, k)] = obj[k]; });
        return out;
      };
      const bookDoc = {
        code: oldBook.code,
        members: [myNewId],
        createdBy: myNewId,
        myName: myName,
        partnerName: myIsCreator ? oldBook.partnerName : oldBook.myName,
        anniversary: oldBook.anniversary || '',
        myAvatar: myAvatarFile,
        partnerAvatar: partnerAvatarFile,
        events: oldBook.events || [],
        wishes: oldBook.wishes || [],
        miss: oldBook.miss ? { date: oldBook.miss.date, counts: mapKeys(oldBook.miss.counts || {}) } : null,
        missEvents: (oldBook.missEvents || []).map((e) => ({ ...e, from: mapUid(uidMap, e.from) })),
        dailyQA: (oldBook.dailyQA || []).map((x) => ({ date: x.date, answers: mapKeys(x.answers || {}) })),
        legacy: {
          creatorOld: creatorOld,
          partnerOld: partnerOld,
          creatorNew: uidMap[creatorOld] === PENDING ? '' : uidMap[creatorOld],
          partnerNew: uidMap[partnerOld] === PENDING ? '' : uidMap[partnerOld]
        },
        createdAt: Date.now()
      };
      const bookAdded = await books.add({ data: bookDoc });
      await users.doc(myNewId).update({ data: { bookId: bookAdded._id } });

      /* 6. 记录（含照片/语音/点赞/评论，uid 全部按角色映射） */
      const all = (dump.records || []).filter((r) => r.bookId === oldBook._id);
      let dumpFileID = '';
      if (all.length) {
        const up = await cloud.uploadFile({
          cloudPath: 'migrate/dump.json',
          fileContent: Buffer.from(JSON.stringify(all), 'utf8')
        });
        dumpFileID = up.fileID;
      }
      return {
        ok: true,
        data: {
          bookId: bookAdded._id,
          bookCode: oldBook.code,
          total: all.length,
          dumpFileID: dumpFileID
        }
      };
    }

    /* ---------- 分批搬记录 ---------- */
    if (event.action === 'batch') {
      const u = (await users.where({ openid: OPENID }).limit(1).get()).data[0];
      if (!u || !u.bookId) return { ok: false, error: '请先完成迁移初始化' };
      const dumpRes = await cloud.getTempFileURL({ fileList: [event.dumpFileID] });
      const url = dumpRes.fileList && dumpRes.fileList[0] && dumpRes.fileList[0].tempFileURL;
      if (!url) return { ok: false, error: '迁移缓存失效，请重新开始' };
      const dumpRes2 = await axios.get(url, { responseType: 'json', timeout: 30000 });
      const all = dumpRes2.data || [];

      const start = Math.max(0, Number(event.start) || 0);
      const count = Math.min(4, Math.max(1, Number(event.count) || 4));
      const slice = all.slice(start, start + count);
      if (!slice.length) return { ok: true, data: { processed: 0, remaining: Math.max(0, all.length - start) } };

      const fileIds = [];
      slice.forEach((r) => {
        (r.images || []).forEach((i) => i && i.id && fileIds.push(i.id));
        if (r.audio && r.audio.id) fileIds.push(r.audio.id);
      });
      const urls = await oldImageUrls(event.oldBase, fileIds);

      /* 旧 uid → 新 uid（PENDING 的等 TA 加入时再替换） */
      const b = await books.doc(u.bookId).get();
      const l = b.data.legacy || {};
      const uidMap = {};
      if (l.creatorOld) uidMap[l.creatorOld] = l.creatorNew || PENDING;
      if (l.partnerOld) uidMap[l.partnerOld] = l.partnerNew || PENDING;

      let done = 0;
      for (const r of slice) {
        const images = [];
        for (const img of r.images || []) {
          const oldUrl = urls[img.id];
          if (!oldUrl) continue;
          try {
            const buf = await downloadBuffer(oldUrl);
            const up = await cloud.uploadFile({
              cloudPath: 'records/' + u.bookId + '/' + (r.createdAt || Date.now()) + '_' + done + '_' + images.length + '.' + extOf(img.id),
              fileContent: buf
            });
            images.push({ fileId: up.fileID });
          } catch (err) { /* 单张失败跳过 */ }
        }
        let audio = null;
        if (r.audio && r.audio.id && urls[r.audio.id]) {
          try {
            const buf = await downloadBuffer(urls[r.audio.id]);
            const up = await cloud.uploadFile({
              cloudPath: 'records/' + u.bookId + '/' + (r.createdAt || Date.now()) + '_' + done + '_audio.' + extOf(r.audio.id),
              fileContent: buf
            });
            audio = { fileId: up.fileID, duration: r.audio.duration || 0 };
          } catch (err) { /* 忽略 */ }
        }
        await records.add({
          data: {
            bookId: u.bookId,
            date: r.date,
            title: r.title,
            note: r.note,
            place: r.place,
            mood: r.mood,
            tags: r.tags || [],
            images: images,
            audio: audio,
            likes: (r.likes || []).map((x) => mapUid(uidMap, x)).filter((x) => x),
            comments: (r.comments || []).map((c) => ({ ...c, uid: mapUid(uidMap, c.uid) })),
            authorId: mapUid(uidMap, r.authorId) || '',
            authorName: r.authorName || 'Ta',
            createdAt: r.createdAt || Date.now()
          }
        });
        done++;
      }

      const processed = Math.min(done, slice.length);
      return { ok: true, data: { processed: processed, remaining: Math.max(0, all.length - (start + processed)) } };
    }

    /* ---------- 清理缓存 ---------- */
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
