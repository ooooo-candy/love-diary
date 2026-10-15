/* 用户：微信 openid 静默注册/登录、资料更新 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const users = db.collection('users');

function publicUser(u) {
  return {
    _id: u._id,
    nickname: u.nickname || '',
    avatar: u.avatar || '',
    bookId: u.bookId || ''
  };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  try {
    const found = await users.where({ openid: OPENID }).limit(1).get();
    let u = found.data[0];

    if (event.action === 'login') {
      if (!u) {
        const added = await users.add({
          data: { openid: OPENID, nickname: '', avatar: '', bookId: '', createdAt: Date.now() }
        });
        u = { _id: added._id, nickname: '', avatar: '', bookId: '' };
      }
      return { ok: true, data: { user: publicUser(u) } };
    }

    if (!u) return { ok: false, error: '请先进入小程序完成登录' };

    if (event.action === 'updateProfile') {
      const patch = {};
      if (typeof event.nickname === 'string' && event.nickname.trim()) patch.nickname = event.nickname.trim().slice(0, 12);
      if (typeof event.avatar === 'string') patch.avatar = event.avatar;
      if (Object.keys(patch).length) await users.doc(u._id).update({ data: patch });
      const fresh = await users.doc(u._id).get();
      return { ok: true, data: { user: publicUser(fresh.data) } };
    }

    return { ok: false, error: '未知操作' };
  } catch (err) {
    return { ok: false, error: err.message || '服务异常' };
  }
};
