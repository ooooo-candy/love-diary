/* 临时诊断脚本：检查旧 API 迁移导出接口（用完可删） */
const https = require('https');

const BASE = 'https://kq620lm-d8gabmn69c500f017-1503834579.ap-shanghai.app.tcloudbase.com/api';
const SECRET = 'cm-mig-7xk2q9zr4t';

function post(action, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ action: action, payload: payload });
    const url = new URL(BASE);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          try { resolve(JSON.parse(text)); } catch (err) { resolve({ raw: text.slice(0, 500) }); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

(async () => {
  const dump = await post('dumpAll', { secret: SECRET });
  if (!dump.ok) {
    console.log('DUMP FAIL:', JSON.stringify(dump).slice(0, 300));
    return;
  }
  const books = dump.data.books || [];
  const records = dump.data.records || [];
  console.log('BOOKS:', books.length);
  books.forEach((b, i) =>
    console.log(`  [${i}] code=${b.code} myName=${b.myName} partnerName=${b.partnerName} anniversary=${b.anniversary} _id=${b._id || '(无)'}`)
  );
  console.log('RECORDS:', records.length);
  const byBook = {};
  records.forEach((r) => { byBook[r.bookId] = (byBook[r.bookId] || 0) + 1; });
  console.log('  按本子分布:', JSON.stringify(byBook));
  const withImg = records.filter((r) => (r.images || []).length).length;
  const withAudio = records.filter((r) => r.audio && r.audio.id).length;
  const imgIds = [];
  records.forEach((r) => (r.images || []).forEach((i) => i.id && imgIds.push(i.id)));
  console.log('  有照片的记录:', withImg, ' 有语音的记录:', withAudio, ' 照片总数:', imgIds.length);
  if (imgIds.length) {
    console.log('  样例 fileId:', imgIds[0].slice(0, 60));
    const urls = await post('imgUrls', { secret: SECRET, fileIds: imgIds.slice(0, 3) });
    const map = (urls.data && urls.data.urls) || {};
    const got = Object.keys(map).filter((k) => map[k]);
    console.log('  imgUrls 接口返回可用链接:', got.length, '/', Object.keys(map).length);
  }
})();
