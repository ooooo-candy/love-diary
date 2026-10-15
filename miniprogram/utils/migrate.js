/* 旧版数据迁移（迁移完成后可移除） */
const api = require('./api');

const MIGRATE = {
  base: 'https://kq620lm-d8gabmn69c500f017-1503834579.ap-shanghai.app.tcloudbase.com/api',
  secret: 'cm-mig-7xk2q9zr4t'
};

/* 列出旧本子（只含有记录的，按记录数从多到少） */
async function listBooks() {
  const list = await api.call('migrate', { action: 'list', secret: MIGRATE.secret, oldBase: MIGRATE.base });
  return (list.books || []).filter((b) => b.count > 0);
}

/* 按选择的旧本子导入全部记录（含照片/语音），onProgress(pct, text) */
async function run(bookIndex, onProgress) {
  const prog = (t) => { if (onProgress) onProgress(t); wx.showLoading({ title: t, mask: true }); };
  prog('正在连接旧版本…');
  const init = await api.call('migrate', {
    action: 'init',
    secret: MIGRATE.secret,
    oldBase: MIGRATE.base,
    bookIndex: bookIndex
  });
  if (!init.total) {
    wx.setStorageSync('migrated', true);
    wx.hideLoading();
    return { total: 0 };
  }
  let start = 0;
  for (let guard = 0; guard < 500 && start < init.total; guard++) {
    const r = await api.call('migrate', {
      action: 'batch',
      secret: MIGRATE.secret,
      oldBase: MIGRATE.base,
      bookId: init.bookId,
      dumpFileID: init.dumpFileID,
      start: start,
      count: 4
    });
    if (!r.processed) throw new Error('导入中断了，请重试');
    start += r.processed;
    prog('导入照片 ' + Math.min(start, init.total) + '/' + init.total);
  }
  await api.call('migrate', { action: 'finish', secret: MIGRATE.secret, dumpFileID: init.dumpFileID }).catch(() => {});
  wx.setStorageSync('migrated', true);
  wx.hideLoading();
  return { total: init.total };
}

module.exports = {
  base: MIGRATE.base,
  secret: MIGRATE.secret,
  listBooks: listBooks,
  run: run
};
