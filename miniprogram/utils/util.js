/* 日期与通用工具（与原版 App 对齐） */
const Lunar = require('./lunar');

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const MOODS = [
  { key: 'sweet', emoji: '😍', label: '甜蜜' },
  { key: 'happy', emoji: '😊', label: '开心' },
  { key: 'warm', emoji: '🥰', label: '温馨' },
  { key: 'funny', emoji: '😂', label: '好笑' },
  { key: 'sad', emoji: '😢', label: '小情绪' },
  { key: 'calm', emoji: '🌿', label: '平淡' }
];

const MOOD_MAP = {};
MOODS.forEach((m) => { MOOD_MAP[m.key] = m; });

const PRESET_TAGS = ['旅行', '美食', '电影', '日常', '纪念日', '约会', '礼物', '散步', '自拍', '惊喜'];

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

function todayStr(d) {
  const t = d || new Date();
  return t.getFullYear() + '-' + pad2(t.getMonth() + 1) + '-' + pad2(t.getDate());
}

function parseDate(s) {
  const parts = String(s || '').split('-').map(Number);
  return new Date(parts[0] || 1970, (parts[1] || 1) - 1, parts[2] || 1);
}

function daysBetween(a, b) {
  const a0 = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const b0 = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((b0 - a0) / 86400000);
}

/* 恋爱天数（按自然日，含当天） */
function loveDays(anniversary) {
  if (!anniversary) return 0;
  const start = parseDate(anniversary);
  if (isNaN(start.getTime())) return 0;
  return Math.max(0, daysBetween(start, new Date()) + 1);
}

/* 2026年10月15日 · 周四 · 今天 */
function fmtDate(dateStr) {
  if (!dateStr) return '';
  const d = parseDate(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

function weekday(dateStr) {
  const d = parseDate(dateStr);
  if (isNaN(d.getTime())) return '';
  return WEEKDAYS[d.getDay()];
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

/* 连续记录天数（今天没记就从昨天起算） */
function streak(records) {
  const dates = {};
  (records || []).forEach((r) => { if (r.date) dates[r.date] = true; });
  const d = new Date();
  if (!dates[todayStr(d)]) d.setDate(d.getDate() - 1);
  let n = 0;
  while (n < 3650 && dates[todayStr(d)]) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/* 重要日子：下一次发生的公历日期（支持农历生日） */
function eventNextDate(ev, base) {
  const now = base || new Date();
  if (!ev) return null;

  if (ev.calendar === 'lunar' && ev.lunarMonth) {
    const label = '农历 ' + Lunar.format(ev.lunarMonth, ev.lunarDay, ev.lunarIsLeap);
    if (!ev.yearly && ev.lunarYear) {
      const s = Lunar.solarOfLunarYear(ev.lunarYear, ev.lunarMonth, ev.lunarDay, ev.lunarIsLeap);
      if (!s) return null;
      return { y: s.y, m: s.m, d: s.d, lunar: true, label: label };
    }
    const nx = Lunar.nextOccurrence(ev.lunarMonth, ev.lunarDay, ev.lunarIsLeap, now);
    if (!nx) return null;
    return { y: nx.y, m: nx.m, d: nx.d, lunar: true, label: label };
  }

  if (!ev.date) return null;
  const src = parseDate(ev.date);
  if (!ev.yearly) {
    return { y: src.getFullYear(), m: src.getMonth() + 1, d: src.getDate() };
  }
  const cur = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), src.getMonth(), src.getDate());
  if (next < cur) next = new Date(now.getFullYear() + 1, src.getMonth(), src.getDate());
  return { y: next.getFullYear(), m: next.getMonth() + 1, d: next.getDate() };
}

/* 即将到来的重要日子（含周年纪念日），按临近排序 */
function upcomingEvents(book) {
  const now = new Date();
  const todayKey = todayStr();
  const events = [];

  if (book && book.anniversary) {
    const start = parseDate(book.anniversary);
    let year = now.getFullYear();
    let next = new Date(year, start.getMonth(), start.getDate());
    const cur = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (next < cur) next = new Date(year + 1, start.getMonth(), start.getDate());
    const years = next.getFullYear() - start.getFullYear();
    if (years >= 1) {
      events.push({
        id: 'annual',
        name: '在一起 ' + years + ' 周年',
        date: next.getFullYear() + '-' + pad2(next.getMonth() + 1) + '-' + pad2(next.getDate()),
        icon: '🎂'
      });
    }
  }

  ((book && book.events) || []).forEach((ev) => {
    const nx = eventNextDate(ev, now);
    if (!nx) return;
    const dateStr = nx.y + '-' + pad2(nx.m) + '-' + pad2(nx.d);
    if (!ev.yearly && daysBetween(now, parseDate(dateStr)) < 0) return;
    events.push({
      id: ev.id,
      name: ev.name,
      date: dateStr,
      icon: ev.icon || (ev.calendar === 'lunar' ? '🎂' : '📅'),
      label: nx.label || ''
    });
  });

  events.forEach((ev) => {
    ev.diff = daysBetween(now, parseDate(ev.date));
    ev.isToday = ev.date === todayKey;
  });
  events.sort((a, b) => a.diff - b.diff);
  return events;
}

/* 每日一问题库（与原版一致） */
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
  parseDate: parseDate,
  daysBetween: daysBetween,
  loveDays: loveDays,
  fmtDate: fmtDate,
  weekday: weekday,
  fmtDateShort: fmtDateShort,
  relativeDay: relativeDay,
  cmtTime: cmtTime,
  streak: streak,
  eventNextDate: eventNextDate,
  upcomingEvents: upcomingEvents,
  dailyQuestion: dailyQuestion,
  DAILY_QUESTIONS: DAILY_QUESTIONS,
  MOODS: MOODS,
  MOOD_MAP: MOOD_MAP,
  PRESET_TAGS: PRESET_TAGS
};
