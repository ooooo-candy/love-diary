/* 一次性初始化：创建所需数据库集合 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const out = [];
  for (const name of ['users', 'books', 'records']) {
    try {
      await db.createCollection(name);
      out.push(name + ': created');
    } catch (err) {
      out.push(name + ': ' + (err.message || 'skip'));
    }
  }
  return { ok: true, data: { result: out } };
};
