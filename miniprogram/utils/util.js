/* 日期与通用工具 */
function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

function todayStr(d) {
  const t = d || new Date();
  return t.getFullYear() + '-' + pad2(t.getMonth() + 1) + '-' + pad2(t.getDate());
}

/* 恋爱天数（按自然日） */
function loveDays(anniversary) {
  if (!anniversary) return 0;
  const a = new Date(anniversary + 'T00:00:00');
  if (isNaN(a.getTime())) return 0;
  const now = new Date();
  const a0 = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const n0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((n0 - a0) / 86400000));
}

function fmtDate(dateStr) {
  if (!dateStr) return '';
  const parts = String(dateStr).split('-');
  if (parts.length < 3) return dateStr;
  return Number(parts[0]) + ' 年 ' + Number(parts[1]) + ' 月 ' + Number(parts[2]) + ' 日';
}

function fmtDateShort(dateStr) {
  if (!dateStr) return '';
  const parts = String(dateStr).split('-');
  if (parts.length < 3) return dateStr;
  return Number(parts[1]) + '月' + Number(parts[2]) + '日';
}

function relativeDay(dateStr) {
  const today = todayStr();
  const mk = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return todayStr(d);
  };
  if (dateStr === today) return '今天';
  if (dateStr === mk(-1)) return '昨天';
  if (dateStr === mk(-2)) return '前天';
  if (dateStr === mk(1)) return '明天';
  return '';
}

function cmtTime(ts) {
  const d = new Date(ts || Date.now());
  return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/* 每日一问题库（与旧版网页一致） */
const DAILY_QUESTIONS = [
  '今天最让你开心的一件小事是什么？',
  'TA 今天哪个瞬间让你心动了？',
  '如果现在可以立刻见到 TA，你最想做的第一件事是什么？',
  '今天吃到的最好吃的东西是什么？想带 TA 去吃吗？',
  '今天有没有哪个瞬间特别想 TA？',
  '用三个词形容一下今天的心情。',
  '最近最想和 TA 一起去做的一件事是什么？',
  '今天有什么想跟 TA 分享但还没说的吗？',
  '如果给今天的你们拍一张照片，会是什么画面？',
  '今天有比昨天更爱 TA 一点吗？为什么？',
  '最近一次笑出声是因为什么？',
  '如果明天是周末，你最理想的安排是什么？',
  '今天天气怎么样？像不像你们某次一起经历的那天？',
  '最近单曲循环的歌是什么？想跟 TA 一起听吗？',
  '今天学到了什么新东西？',
  '如果可以用一个表情包总结今天，是哪一个？',
  '今天有想跟 TA 倒的小烦恼吗？',
  '你们下一次约会，你最想去哪里？',
  '最近有没有什么小目标想和 TA 一起完成？',
  '今天路过哪里的时候想起了你们的故事？',
  '如果 TA 现在站在你面前，你想说的第一句话是什么？',
  '今天为自己做了什么好事？顺便夸夸自己。',
  '最近一次觉得「有 TA 真好」是什么时候？',
  '如果送 TA 一份不需要花钱的礼物，会是什么？',
  '今天几点起床的？想不想和 TA 一起赖床？',
  '最近一次梦到 TA 是什么梦？',
  '今天的你，最想被 TA 怎么夸？',
  '如果你们的爱情是一部电影，今天演到哪一幕了？',
  '明天最期待的一件事是什么？',
  '今天有没有什么想存起来、等老了一起回味的瞬间？'
];

function dailyQuestion(dateStr) {
  let h = 0;
  const s = String(dateStr || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return DAILY_QUESTIONS[h % DAILY_QUESTIONS.length];
}

module.exports = {
  pad2: pad2,
  todayStr: todayStr,
  loveDays: loveDays,
  fmtDate: fmtDate,
  fmtDateShort: fmtDateShort,
  relativeDay: relativeDay,
  cmtTime: cmtTime,
  dailyQuestion: dailyQuestion,
  DAILY_QUESTIONS: DAILY_QUESTIONS
};
