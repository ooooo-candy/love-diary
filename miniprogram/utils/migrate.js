/* 一键迁移：清空重来，按旧 App 原样还原（迁移完成后可移除） */
const api = require('./api');

const MIGRATE = {
  base: 'https://kq620lm-d8gabmn69c500f017-1503834579.ap-shanghai.app.tcloudbase.com/api',
  secret: 'cm-mig-7xk2q9zr4t'
};

/* 完整流程：找到旧本子 → 问你是谁 → 清空重建 → 搬记录照片 */
async function fullFlow(onProgress) {
  const prog = (t) => {
    if (onProgress) onProgress(t);
    wx.showLoading({ title: t, mask: true });
  };

  prog('正在连接旧版本…');
  const prep = await api.call('migrate', { action: 'prepare', secret: MIGRATE.secret, oldBase: MIGRATE.base });
  const bk = prep.book;
  if (!bk || !bk.count) {
    wx.setStorageSync('migrated', true);
    wx.hideLoading();
    return { total: 0 };
  }

  /* 你是本子里的哪一位？ */
  wx.hideLoading();
  const who = await new Promise((resolve) => {
    wx.showActionSheet({
      alertText: '旧本子「' + bk.code + '」里，你是？',
      itemList: ['我是 ' + bk.myName, '我是 ' + bk.partnerName],
      success: (r) => resolve(r.tapIndex === 0 ? bk.myName : bk.partnerName),
      fail: () => resolve(null)
    });
  });
  if (!who) throw new Error('cancel');

  prog('清点旧数据…');
  const run = await api.call('migrate', {
    action: 'run',
    secret: MIGRATE.secret,
    oldBase: MIGRATE.base,
    oldBookId: bk.oldId,
    myName: who
  });

  if (!run.total) {
    await api.call('migrate', { action: 'finish', secret: MIGRATE.secret, dumpFileID: run.dumpFileID }).catch(() => {});
    wx.setStorageSync('migrated', true);
    wx.hideLoading();
    return { total: 0, bookId: run.bookId, code: run.bookCode };
  }

  let start = 0;
  for (let guard = 0; guard < 500 && start < run.total; guard++) {
    const r = await api.call('migrate', {
      action: 'batch',
      secret: MIGRATE.secret,
      oldBase: MIGRATE.base,
      dumpFileID: run.dumpFileID,
      start: start,
      count: 4
    });
    if (!r.processed) throw new Error('导入中断了，请重试');
    start += r.processed;
    prog('导入照片 ' + Math.min(start, run.total) + '/' + run.total);
  }

  await api.call('migrate', { action: 'finish', secret: MIGRATE.secret, dumpFileID: run.dumpFileID }).catch(() => {});
  wx.setStorageSync('migrated', true);
  wx.hideLoading();
  return { total: run.total, bookId: run.bookId, code: run.bookCode };
}

module.exports = {
  base: MIGRATE.base,
  secret: MIGRATE.secret,
  fullFlow: fullFlow
};
