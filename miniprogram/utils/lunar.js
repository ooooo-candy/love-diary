/* 农历（阴历）工具
 *
 * 用 1900~2100 年的标准农历数据表做换算：
 *   - lunarToSolar：农历日期 → 公历日期（算农历生日倒计时要用）
 *   - solarToLunar：公历日期 → 农历日期（校验 + 显示）
 *   - nextOccurrence：某个农历月日下一次出现的公历日期
 * 全部离线计算，不依赖任何外部服务。
 */
(function () {
  'use strict';

  /* 每年一个 32 位整数：
   *   低 4 位 = 闰月月份（0 表示无闰月）
   *   第 5~16 位 = 1~12 月的大小（1 = 30 天，0 = 29 天）
   *   第 17 位 = 闰月天数（1 = 30 天，0 = 29 天）
   */
  const lunarInfo = [
    0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, // 1900-1909
    0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977, // 1910-1919
    0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, // 1920-1929
    0x06566, 0x0d4a0, 0x0ea50, 0x16a95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, // 1930-1939
    0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557, // 1940-1949
    0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, // 1950-1959
    0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, // 1960-1969
    0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6, // 1970-1979
    0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, // 1980-1989
    0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0, // 1990-1999
    0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, // 2000-2009
    0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, // 2010-2019
    0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530, // 2020-2029
    0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, // 2030-2039
    0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, // 2040-2049
    0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0, // 2050-2059
    0x092e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4, // 2060-2069
    0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, // 2070-2079
    0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, // 2080-2089
    0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252, // 2090-2099
    0x0d520 // 2100
  ];

  const MIN_YEAR = 1900;
  const MAX_YEAR = 2100;
  const BASE_UTC = Date.UTC(1900, 0, 31); // 1900 年正月初一
  const DAY_MS = 86400000;

  const MONTH_NAMES = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
  const DAY_PREFIX = ['初', '十', '廿', '三'];
  const DAY_UNIT = ['日', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

  /* 农历 y 年总天数 */
  function yearDays(y) {
    let sum = 348; // 12 个月最少 29 天
    for (let i = 0x8000; i > 0x8; i >>= 1) {
      if (lunarInfo[y - MIN_YEAR] & i) sum += 1;
    }
    return sum + leapDays(y);
  }

  /* 农历 y 年闰几月（0 = 无闰月） */
  function leapMonth(y) {
    return lunarInfo[y - MIN_YEAR] & 0xf;
  }

  /* 闰月天数 */
  function leapDays(y) {
    if (!leapMonth(y)) return 0;
    return lunarInfo[y - MIN_YEAR] & 0x10000 ? 30 : 29;
  }

  /* 农历 y 年 m 月的天数（不含闰月） */
  function monthDays(y, m) {
    return lunarInfo[y - MIN_YEAR] & (0x10000 >> m) ? 30 : 29;
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  /* 农历 → 公历，返回 { y, m, d }（公历，月份从 1 开始） */
  function lunarToSolar(ly, lm, ld, isLeap) {
    if (!(ly >= MIN_YEAR && ly <= MAX_YEAR)) return null;
    if (!(lm >= 1 && lm <= 12) || !(ld >= 1 && ld <= 30)) return null;

    let offset = 0;
    for (let i = MIN_YEAR; i < ly; i++) offset += yearDays(i);

    const leap = leapMonth(ly);
    for (let i = 1; i < lm; i++) {
      offset += monthDays(ly, i);
      if (i === leap) offset += leapDays(ly);
    }
    if (isLeap && leap === lm) offset += monthDays(ly, lm);
    offset += ld - 1;

    const dt = new Date(BASE_UTC + offset * DAY_MS);
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  }

  /* 公历 → 农历，返回 { year, month, day, isLeap } */
  function solarToLunar(date) {
    const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    let offset = Math.floor((utc - BASE_UTC) / DAY_MS);
    if (offset < 0) return null;

    let year = MIN_YEAR;
    let temp = 0;
    for (; year <= MAX_YEAR && offset > 0; year++) {
      temp = yearDays(year);
      offset -= temp;
    }
    if (offset < 0) {
      offset += temp;
      year -= 1;
    }

    const leap = leapMonth(year);
    let isLeap = false;
    let m = 1;
    for (; m < 13 && offset > 0; m++) {
      if (leap > 0 && m === leap + 1 && !isLeap) {
        // 进入闰月：先退一格再按闰月天数扣
        m -= 1;
        isLeap = true;
        temp = leapDays(year);
      } else {
        temp = monthDays(year, m);
      }
      if (isLeap && m === leap + 1) isLeap = false;
      offset -= temp;
    }

    if (offset === 0 && leap > 0 && m === leap + 1) {
      if (isLeap) {
        isLeap = false;
      } else {
        isLeap = true;
        m -= 1;
      }
    }
    if (offset < 0) {
      offset += temp;
      m -= 1;
    }

    return { year: year, month: m, day: offset + 1, isLeap: isLeap };
  }

  /* 农历月名：八月 / 闰四月 */
  function monthName(m, isLeap) {
    return (isLeap ? '闰' : '') + (MONTH_NAMES[m - 1] || m) + '月';
  }

  /* 农历日名：初一 / 十五 / 廿三 / 三十 */
  function dayName(d) {
    if (d === 10) return '初十';
    if (d === 20) return '二十';
    if (d === 30) return '三十';
    return DAY_PREFIX[Math.floor(d / 10)] + DAY_UNIT[d % 10];
  }

  /* 文本化：八月十五 */
  function format(m, d, isLeap) {
    return monthName(m, isLeap) + dayName(d);
  }

  /* 某年该农历月日对应的公历（该月没有这一天时，退回该月最后一天） */
  function solarOfLunarYear(ly, lm, ld, isLeap) {
    let res = lunarToSolar(ly, lm, ld, isLeap);
    if (!res) return null;
    const back = solarToLunar(new Date(res.y, res.m - 1, res.d));
    if (!back || back.month !== lm || back.day !== ld || Boolean(back.isLeap) !== Boolean(isLeap)) {
      // 小月没有三十：按该月最后一天算
      if (ld === 30) {
        res = lunarToSolar(ly, lm, 29, isLeap);
        if (res) {
          const back2 = solarToLunar(new Date(res.y, res.m - 1, res.d));
          if (back2 && back2.month === lm) return res;
        }
      }
      return null;
    }
    return res;
  }

  /* 下一次出现的公历日期（含今天），返回 { y, m, d, lunarYear } */
  function nextOccurrence(lm, ld, isLeap, from) {
    const today = from || new Date();
    const cur = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    for (let i = 0; i <= 2; i++) {
      const ly = today.getFullYear() + i;
      const s = solarOfLunarYear(ly, lm, ld, isLeap);
      if (!s) continue;
      if (Date.UTC(s.y, s.m - 1, s.d) >= cur) {
        return { y: s.y, m: s.m, d: s.d, lunarYear: ly };
      }
    }
    return null;
  }

  /* 今天对应的农历（用于展示"今天是农历几月几"） */
  function today(from) {
    return solarToLunar(from || new Date());
  }

  module.exports = {
    yearDays: yearDays,
    leapMonth: leapMonth,
    leapDays: leapDays,
    monthDays: monthDays,
    lunarToSolar: lunarToSolar,
    solarToLunar: solarToLunar,
    solarOfLunarYear: solarOfLunarYear,
    nextOccurrence: nextOccurrence,
    monthName: monthName,
    dayName: dayName,
    format: format,
    today: today,
    pad2: pad2,
    MIN_YEAR: MIN_YEAR,
    MAX_YEAR: MAX_YEAR
  };
});
