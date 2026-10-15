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

module.exports = {
  pad2: pad2,
  todayStr: todayStr,
  loveDays: loveDays,
  fmtDate: fmtDate,
  fmtDateShort: fmtDateShort,
  relativeDay: relativeDay
};
