/* 我们的小日子 · 主逻辑 */
(function () {
  'use strict';

  const MOODS = [
    { key: 'sweet', emoji: '😍', label: '甜蜜' },
    { key: 'happy', emoji: '😊', label: '开心' },
    { key: 'warm', emoji: '🥰', label: '温馨' },
    { key: 'funny', emoji: '😂', label: '好笑' },
    { key: 'sad', emoji: '😢', label: '小情绪' },
    { key: 'calm', emoji: '🌿', label: '平淡' }
  ];

  const PRESET_TAGS = ['旅行', '美食', '电影', '日常', '纪念日', '约会', '礼物', '散步', '自拍', '惊喜'];

  const PALETTES = [
    { key: 'pink', from: '#ff6b9d', to: '#a78bfa' },
    { key: 'sunset', from: '#ff8a5b', to: '#ff5f8d' },
    { key: 'mint', from: '#34c8a4', to: '#5aa9ff' },
    { key: 'grape', from: '#8b5cf6', to: '#ec4899' },
    { key: 'cocoa', from: '#b4794a', to: '#d98ca0' }
  ];

  const MOOD_MAP = MOODS.reduce((m, x) => ((m[x.key] = x), m), {});

  // 图片地址缓存：refId -> 可用于 <img src> 的地址，避免重复解码造成闪烁
  const previewCache = new Map();

  const state = {
    tab: 'home',
    query: '',
    mood: 'all',
    tag: 'all',
    drafting: null,      // 撰写中的草稿（含 mood / tags / images）
    editingId: null,
    onboarding: false
  };

  /* ---------------- 工具 ---------------- */

  const moodOf = (key) => MOOD_MAP[key] || { key: key, emoji: '💗', label: '' };

  function avatarHtml(ref, name, cls) {
    const c = 'avatar' + (cls ? ' ' + cls : '');
    if (ref && ref.id) {
      return `<img class="${c}" data-ref="${UI.escapeHtml(ref.id)}" alt="${UI.escapeHtml(name || '')}" />`;
    }
    const initial = String(name || '?').trim().charAt(0) || '?';
    return `<div class="${c}">${UI.escapeHtml(initial)}</div>`;
  }

  async function resolveURL(ref) {
    if (!ref) return '';
    if (ref.data) return ref.data;
    if (previewCache.has(ref.id)) return previewCache.get(ref.id);
    const url = await Store.getImageURL(ref);
    if (url) previewCache.set(ref.id, url);
    return url;
  }

  async function hydrateImages(root) {
    const refs = Store.allImageRefs();
    const map = new Map(refs.map((r) => [r.id, r]));
    const imgs = UI.$$('img[data-ref]', root || document).filter(
      (img) => !img.getAttribute('src') && map.get(img.dataset.ref)
    );
    if (!imgs.length) return;
    const ids = [];
    imgs.forEach((img) => {
      const ref = map.get(img.dataset.ref);
      if (ref.data || ref.localUrl) img.src = ref.data || ref.localUrl;
      else ids.push(ref.id);
    });
    if (!ids.length) return;
    /* 一批请求拿回所有临时链接，避免每张图一次网络往返 */
    const urls = await Store.resolveImageURLs(ids);
    imgs.forEach((img) => {
      const ref = map.get(img.dataset.ref);
      const url = urls[ref.id];
      if (url) img.src = url;
    });
  }

  function recordDates() {
    const set = new Set();
    Store.listRecords().forEach((r) => set.add(r.date));
    return set;
  }

  function allTags() {
    const set = new Set();
    Store.listRecords().forEach((r) => (r.tags || []).forEach((t) => set.add(t)));
    return Array.from(set);
  }

  /* ---------------- 视图：首页 ---------------- */

  function loveDays() {
    const p = Store.getProfile();
    if (!p || !p.anniversary) return 0;
    const start = UI.parseDate(p.anniversary);
    const today = new Date();
    return Math.max(0, UI.daysBetween(start, today) + 1);
  }

  /* 某个重要日子下一次发生的公历日期（支持农历生日） */
  function eventNextDate(ev, today) {
    const base = today || new Date();
    if (!ev) return null;

    if (ev.calendar === 'lunar' && ev.lunarMonth) {
      const label = '农历 ' + Lunar.format(ev.lunarMonth, ev.lunarDay, ev.lunarIsLeap);

      // 农历「仅一次」：按指定农历年份算具体公历日期
      if (!ev.yearly && ev.lunarYear) {
        const s = Lunar.solarOfLunarYear(ev.lunarYear, ev.lunarMonth, ev.lunarDay, ev.lunarIsLeap);
        if (!s) return null;
        return { y: s.y, m: s.m, d: s.d, lunar: true, label: label, fixed: true };
      }

      const nx = Lunar.nextOccurrence(ev.lunarMonth, ev.lunarDay, ev.lunarIsLeap, base);
      if (!nx) return null;
      return { y: nx.y, m: nx.m, d: nx.d, lunar: true, label: label };
    }

    if (!ev.date) return null;
    const src = UI.parseDate(ev.date);
    if (!ev.yearly) {
      return { y: src.getFullYear(), m: src.getMonth() + 1, d: src.getDate() };
    }
    const cur = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    let next = new Date(base.getFullYear(), src.getMonth(), src.getDate());
    if (next < cur) next = new Date(base.getFullYear() + 1, src.getMonth(), src.getDate());
    return { y: next.getFullYear(), m: next.getMonth() + 1, d: next.getDate() };
  }

  function upcomingEvents() {
    const p = Store.getProfile() || {};
    const today = new Date();
    const todayKey = UI.todayStr();
    const events = [];

    if (p.anniversary) {
      const start = UI.parseDate(p.anniversary);
      let year = today.getFullYear();
      let next = new Date(year, start.getMonth(), start.getDate());
      const cur = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      if (next < cur) next = new Date(year + 1, start.getMonth(), start.getDate());
      const years = next.getFullYear() - start.getFullYear();
      if (years >= 1) {
        events.push({
          id: 'annual',
          name: `在一起 ${years} 周年`,
          date: next.getFullYear() + '-' + UI.pad2(next.getMonth() + 1) + '-' + UI.pad2(next.getDate()),
          icon: '🎂'
        });
      }
    }

    (p.events || []).forEach((ev) => {
      const nx = eventNextDate(ev, today);
      if (!nx) return;
      const dateStr = nx.y + '-' + UI.pad2(nx.m) + '-' + UI.pad2(nx.d);
      // 「仅一次」的日子如果已经过去，就不再倒计时
      if (!ev.yearly && UI.daysBetween(today, UI.parseDate(dateStr)) < 0) return;
      events.push({
        id: ev.id,
        name: ev.name,
        date: dateStr,
        icon: ev.icon || (ev.calendar === 'lunar' ? '🎂' : '📅'),
        label: nx.label || ''
      });
    });

    events.forEach((ev) => {
      ev.diff = UI.daysBetween(today, UI.parseDate(ev.date));
      ev.isToday = ev.date === todayKey;
    });
    events.sort((a, b) => a.diff - b.diff);
    return events;
  }

  function renderHome() {
    const p = Store.getProfile();
    const days = loveDays();
    const events = upcomingEvents().slice(0, 3);
    const records = Store.listRecords();
    const today = UI.todayStr();
    const hasToday = records.some((r) => r.date === today);

    const hearts = Array.from({ length: 7 }, (_, i) =>
      `<span style="left:${8 + i * 13}%;animation-delay:${i * 0.9}s">${['💕', '💗', '💖', '✨'][i % 4]}</span>`
    ).join('');

    let eventHtml = events.length
      ? events
          .map((ev) => {
            const txt = ev.isToday ? '就是今天' : ev.diff <= 0 ? '今天' : `还有 ${ev.diff} 天`;
            return `<div class="event-row">
              <div class="event-row__icon">${UI.escapeHtml(ev.icon)}</div>
              <div class="event-row__main">
                <div class="event-row__name">${UI.escapeHtml(ev.name)}</div>
                <div class="event-row__date">${UI.formatDateShort(ev.date)}${
                  ev.label ? ' · ' + UI.escapeHtml(ev.label) : ''
                }</div>
              </div>
              <div class="event-row__count">${txt}</div>
            </div>`;
          })
          .join('')
      : `<div class="empty__desc" style="padding:8px 0">还没有设置重要日子，去「我们」页添加吧</div>`;

    const latest = records.slice(0, 3);

    const myId = (Cloud.session && Cloud.session.uid) || '';
    const partnerId = (p.members || []).filter((m) => m !== myId)[0] || '';

    const daily = p.daily || null;
    const dailyMine = daily && daily.answers ? daily.answers[myId] || '' : '';
    const dailyPartner = daily && daily.answers ? daily.answers[partnerId] || '' : '';

    const wishes = p.wishes || [];
    const wishDone = wishes.filter((w) => w.done).length;
    const wishPct = wishes.length ? Math.round((wishDone / wishes.length) * 100) : 0;

    const missCounts = (p.miss && p.miss.counts) || {};
    const partnerMiss = missCounts[partnerId] || 0;

    return `
      <div class="love-card">
        <div class="love-card__hearts">${hearts}</div>
        <div class="love-card__pair">
          ${avatarHtml(p.myAvatar, p.myName)}
          <span class="love-card__heart">❤️</span>
          ${avatarHtml(p.partnerAvatar, p.partnerName)}
        </div>
        <div class="love-card__names">${UI.escapeHtml(p.myName)} & ${UI.escapeHtml(p.partnerName)}</div>
        <div class="love-card__days"><b>${days}</b><span>天在一起</span></div>
        <div class="love-card__since">始于 ${UI.escapeHtml(String(p.anniversary).replace(/-/g, '.'))}</div>
        <button class="miss-btn" type="button" data-act="send-miss">💗 想你</button>
        ${partnerMiss ? `<div class="miss-hint">TA 今天想了你 ${partnerMiss} 次 💗</div>` : ''}
      </div>

      <div class="section">
        <div class="card dq-card" data-act="daily-open">
          <div class="dq-head">
            <span class="dq-label">💬 今日一问</span>
            <button class="section__more" type="button" data-act="daily-history">回顾</button>
          </div>
          <div class="dq-q">${UI.escapeHtml(daily ? daily.question : '')}</div>
          <div class="dq-row">
            <div class="dq-a">
              <b>我</b>
              <span>${
                dailyMine ? UI.escapeHtml(dailyMine) : '<i class="dq-empty">还没回答，点这里写</i>'
              }</span>
            </div>
            <div class="dq-a">
              <b>TA</b>
              <span>${
                dailyPartner ? UI.escapeHtml(dailyPartner) : '<i class="dq-empty">还没回答</i>'
              }</span>
            </div>
          </div>
        </div>
      </div>

      ${
        hasToday
          ? ''
          : `<div class="card section" style="display:flex;align-items:center;gap:12px">
              <div style="font-size:26px">📝</div>
              <div style="flex:1">
                <div style="font-size:14px;font-weight:700">今天还没记录哦</div>
                <div style="font-size:12px;color:var(--text-dim);margin-top:2px">把今天的小时光存起来吧</div>
              </div>
              <button class="btn btn--primary btn--sm" type="button" data-act="new">写一条</button>
            </div>`
      }

      <div class="section">
        <div class="section__head">
          <div class="section__title">重要日子</div>
          <button class="section__more" type="button" data-act="events">管理</button>
        </div>
        <div class="card">${eventHtml}</div>
      </div>

      <div class="section">
        <div class="card wish-card" data-act="wishes">
          <div class="wish-head">
            <span>✨ 心愿清单</span>
            <span class="wish-count">${wishDone} / ${wishes.length} 已完成</span>
          </div>
          <div class="wish-bar"><i style="width:${wishPct}%"></i></div>
          ${
            wishes.length
              ? `<div class="wish-latest">最近的心愿：${UI.escapeHtml(wishes[wishes.length - 1].text)}</div>`
              : `<div class="drop-hint" style="margin-top:8px">写下你们想一起做的事，完成一件点亮一件</div>`
          }
        </div>
      </div>

      <div class="section">
        <div class="card" data-act="decide" style="display:flex;align-items:center;gap:12px;cursor:pointer">
          <div style="font-size:24px">🤔</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:13.5px;font-weight:700">选择困难症发作？</div>
            <div style="font-size:12px;color:var(--text-dim);margin-top:2px">吃什么、去哪玩…让转盘帮你们决定</div>
          </div>
          <span style="color:var(--text-dim)">›</span>
        </div>
      </div>

      <div class="section">
        <div class="section__head">
          <div class="section__title">最近的小日子</div>
          <button class="section__more" type="button" data-act="go" data-tab="timeline">全部 ›</button>
        </div>
        ${
          latest.length
            ? latest.map(recordCardHtml).join('')
            : `<div class="card empty">
                <div class="empty__emoji">💌</div>
                <div class="empty__title">还没有记录</div>
                <div class="empty__desc">点击下面的 ＋，写下你们的第一条回忆</div>
                <button class="btn btn--primary" style="margin-top:16px" type="button" data-act="new">开始记录</button>
              </div>`
        }
      </div>
    `;
  }

  /* ---------------- 视图：记录卡片 ---------------- */

  function recordCardHtml(rec) {
    const m = moodOf(rec.mood);
    const imgs = rec.images || [];
    const n = imgs.length;
    let grid = '';
    if (n) {
      const shown = imgs.slice(0, Math.min(n, 6));
      const rest = n - shown.length;
      grid = `<div class="record__grid" data-n="${Math.min(n, 6)}">${shown
        .map((img, i) => {
          const more = i === shown.length - 1 && rest > 0;
          return `<div class="shot${more ? ' shot--more' : ''}" ${
            more ? `data-more="+${rest}"` : ''
          } data-act="view" data-id="${UI.escapeHtml(rec.id)}" data-idx="${i}">
            <img data-ref="${UI.escapeHtml(img.id)}" alt="${UI.escapeHtml(rec.title || '照片')}" loading="lazy" />
          </div>`;
        })
        .join('')}</div>`;
    }

    const tags = (rec.tags || [])
      .map((t) => `<span class="tag">#${UI.escapeHtml(t)}</span>`)
      .join('');

    return `
      <article class="record" data-id="${UI.escapeHtml(rec.id)}">
        <div class="record__head">
          <div class="record__mood">${m.emoji}</div>
          <div class="record__meta">
            <div class="record__date">${UI.formatDate(rec.date)} <span style="color:var(--text-dim);font-weight:500">· ${UI.relativeDay(rec.date)}</span></div>
            ${rec.place ? `<div class="record__place">📍 ${UI.escapeHtml(rec.place)}</div>` : ''}
            ${
              rec.authorName
                ? `<div class="record__place">✍️ ${UI.escapeHtml(rec.authorName)}</div>`
                : ''
            }
          </div>
          <div class="record__actions">
            <button class="mini-btn" type="button" data-act="edit" data-id="${UI.escapeHtml(rec.id)}" title="编辑">✎</button>
            <button class="mini-btn" type="button" data-act="del" data-id="${UI.escapeHtml(rec.id)}" title="删除">🗑</button>
          </div>
        </div>
        ${rec.title ? `<h3 class="record__title">${UI.escapeHtml(rec.title)}</h3>` : ''}
        ${rec.note ? `<div class="record__note">${UI.escapeHtml(rec.note)}</div>` : ''}
        ${
          rec.audio && rec.audio.id
            ? `<button class="voice-play" type="button" data-act="play-voice" data-id="${UI.escapeHtml(
                rec.audio.id
              )}">▶ 语音日记</button>`
            : ''
        }
        ${grid}
        ${tags ? `<div class="record__tags">${tags}</div>` : ''}
        ${recordFootHtml(rec)}
      </article>`;
  }

  function recordFootHtml(rec) {
    const myId = (Cloud.session && Cloud.session.uid) || '';
    const likes = rec.likes || [];
    const liked = likes.indexOf(myId) >= 0;
    const cmts = (rec.comments || []).length;
    return `
      <div class="rec-foot">
        <button class="rec-foot__btn${liked ? ' is-liked' : ''}" type="button" data-act="like" data-id="${UI.escapeHtml(rec.id)}">
          ${liked ? '❤️' : '🤍'}<span>${likes.length ? likes.length : '喜欢'}</span>
        </button>
        <button class="rec-foot__btn" type="button" data-act="comments" data-id="${UI.escapeHtml(rec.id)}">
          💬<span>${cmts ? cmts : '评论'}</span>
        </button>
      </div>`;
  }

  /* ---------------- 视图：时光轴 ---------------- */

  function filteredRecords() {
    const q = state.query.trim().toLowerCase();
    return Store.listRecords().filter((rec) => {
      if (state.mood !== 'all' && rec.mood !== state.mood) return false;
      if (state.tag !== 'all' && !(rec.tags || []).includes(state.tag)) return false;
      if (!q) return true;
      const hay = [rec.title, rec.note, rec.place, (rec.tags || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function renderTimeline() {
    const tags = allTags();
    const list = filteredRecords();

    const moodChips = [
      `<button class="chip${state.mood === 'all' ? ' is-on' : ''}" type="button" data-act="mood" data-val="all">全部心情</button>`
    ]
      .concat(
        MOODS.map(
          (m) =>
            `<button class="chip${state.mood === m.key ? ' is-on' : ''}" type="button" data-act="mood" data-val="${m.key}">${m.emoji} ${m.label}</button>`
        )
      )
      .join('');

    const tagChips = [
      `<button class="chip${state.tag === 'all' ? ' is-on' : ''}" type="button" data-act="tag" data-val="all">全部标签</button>`
    ]
      .concat(
        tags.map(
          (t) =>
            `<button class="chip${state.tag === t ? ' is-on' : ''}" type="button" data-act="tag" data-val="${UI.escapeHtml(t)}">#${UI.escapeHtml(t)}</button>`
        )
      )
      .join('');

    let body = '';
    if (!list.length) {
      body = `<div class="card empty">
        <div class="empty__emoji">🔍</div>
        <div class="empty__title">没有找到相关记录</div>
        <div class="empty__desc">换个关键词，或者新建一条回忆吧</div>
      </div>`;
    } else {
      let currentMonth = '';
      body = list
        .map((rec) => {
          const month = String(rec.date).slice(0, 7);
          let label = '';
          if (month !== currentMonth) {
            currentMonth = month;
            const d = UI.parseDate(rec.date);
            label = `<div class="month-label">${d.getFullYear()} 年 ${d.getMonth() + 1} 月</div>`;
          }
          return label + recordCardHtml(rec);
        })
        .join('');
    }

    return `
      <div class="search">
        <span>🔍</span>
        <input id="searchInput" type="search" placeholder="搜索标题、文字、地点、标签…" value="${UI.escapeHtml(state.query)}" />
        ${state.query ? '<button class="mini-btn" type="button" data-act="clear-query">✕</button>' : ''}
      </div>
      <div class="chips">${moodChips}</div>
      <div class="chips">${tagChips}</div>
      <div class="section" style="margin-top:6px">${body}</div>
    `;
  }

  /* ---------------- 视图：相册 ---------------- */

  function renderAlbum() {
    const records = Store.listRecords();
    const shots = [];
    records.forEach((rec) => {
      (rec.images || []).forEach((img) => shots.push({ ref: img, rec: rec }));
    });

    if (!shots.length) {
      return `<div class="card empty">
        <div class="empty__emoji">🖼</div>
        <div class="empty__title">相册还是空的</div>
        <div class="empty__desc">记录时添加照片，就会自动出现在这里</div>
        <button class="btn btn--primary" style="margin-top:16px" type="button" data-act="new">上传照片</button>
      </div>`;
    }

    const grid = shots
      .map(
        (s, i) =>
          `<div class="shot" data-act="shot" data-idx="${i}" data-id="${UI.escapeHtml(s.rec.id)}" data-ref="${UI.escapeHtml(s.ref.id)}">
            <img data-ref="${UI.escapeHtml(s.ref.id)}" alt="${UI.escapeHtml(s.rec.title || '照片')}" loading="lazy" />
          </div>`
      )
      .join('');

    return `
      <div class="section__head" style="margin-top:0">
        <div class="section__title">共 ${shots.length} 张照片</div>
        <div class="section__more">来自 ${records.length} 条记录</div>
      </div>
      <div class="album">${grid}</div>
    `;
  }

  /* ---------------- 视图：我们（统计） ---------------- */

  function calcStreak() {
    const dates = recordDates();
    const today = new Date();
    const key = (d) =>
      d.getFullYear() + '-' + UI.pad2(d.getMonth() + 1) + '-' + UI.pad2(d.getDate());
    if (!dates.has(key(today))) today.setDate(today.getDate() - 1);
    let n = 0;
    while (n < 3650 && dates.has(key(today))) {
      n++;
      today.setDate(today.getDate() - 1);
    }
    return n;
  }

  function monthCalendar() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const first = new Date(year, month, 1);
    const startWd = first.getDay();
    const days = new Date(year, month + 1, 0).getDate();
    const dates = recordDates();
    const todayKey = UI.todayStr();

    let cells = ['日', '一', '二', '三', '四', '五', '六']
      .map((w) => `<div class="calendar__wd">${w}</div>`)
      .join('');

    for (let i = 0; i < startWd; i++) cells += '<div class="cal-cell is-empty"></div>';
    for (let d = 1; d <= days; d++) {
      const key = year + '-' + UI.pad2(month + 1) + '-' + UI.pad2(d);
      const cls = ['cal-cell'];
      if (dates.has(key)) cls.push('has-record');
      if (key === todayKey) cls.push('is-today');
      cells += `<div class="${cls.join(' ')}">${d}</div>`;
    }
    return { cells: cells, label: `${year} 年 ${month + 1} 月` };
  }

  /* 情侣本卡片：账号 + 对方信息（已加入）/ 邀请码（未加入） */
  function bookCardHtml() {
    const p = Store.getProfile();
    const me = Store.getMe() || {};
    const account = [me.username, me.email].filter(Boolean).join(' · ');
    const partner = p.partnerInfo || null;
    const joined = (p.members || []).length >= 2 && partner;

    const meRow = `
      <div class="event-row">
        <div class="event-row__icon">👤</div>
        <div class="event-row__main">
          <div class="event-row__name">${UI.escapeHtml(me.nickname || account || '未登录')}</div>
          <div class="event-row__date">${
            (account ? '账号：' + UI.escapeHtml(account) + ' · ' : '') +
            (Cloud.isOnline() ? '已同步到云端' : '本地演示模式')
          }</div>
        </div>
        <button class="btn btn--ghost btn--sm" type="button" data-act="logout" style="flex:none">退出</button>
      </div>`;

    if (joined) {
      const online = partner.lastSeen && Date.now() - partner.lastSeen < 5 * 60000;
      const acc = [partner.username, partner.email].filter(Boolean).join(' · ');
      return `
        <div class="section" style="margin-top:0">
          <div class="card">
            ${meRow}
            <div class="partner-row">
              ${avatarHtml(partner.avatar, partner.nickname, 'avatar--sm')}
              <div class="partner-row__main">
                <div class="partner-row__name">${UI.escapeHtml(partner.nickname || 'Ta')}</div>
                <div class="partner-row__date">${acc ? '账号：' + UI.escapeHtml(acc) : '已加入你们的小日子'}</div>
              </div>
              <span class="online-dot${online ? ' is-on' : ''}"><i></i>${online ? '在线' : '离线'}</span>
            </div>
            <div class="setting-row__hint" style="margin-top:12px;text-align:center">❤️ 你们正在共享同一本记录</div>
          </div>
        </div>`;
    }

    return `
      <div class="section" style="margin-top:0">
        <div class="card">
          ${meRow}
          <div class="invite" data-act="copy-code">
            <div class="invite__label">情侣本邀请码</div>
            <div class="invite__code">${UI.escapeHtml(p.code || '------')}</div>
            <span class="invite__hint">点击复制，或生成二维码让 TA 扫一扫加入</span>
          </div>
          <button class="btn btn--ghost btn--block btn--sm" type="button" data-act="show-qr" style="margin-top:10px">📱 生成邀请二维码</button>
          <div class="setting-row__hint" style="margin-top:10px">还没有人加入，等 TA 用邀请码或扫码进来</div>
        </div>
      </div>`;
  }

  function renderStats() {
    const records = Store.listRecords();
    const shots = records.reduce((n, r) => n + (r.images || []).length, 0);
    const days = loveDays();
    const streak = calcStreak();
    const cal = monthCalendar();

    const counts = MOODS.map((m) => ({
      m: m,
      n: records.filter((r) => r.mood === m.key).length
    }));
    const max = Math.max(1, ...counts.map((c) => c.n));

    const bars = counts
      .map(
        (c) =>
          `<div class="bar-row">
            <span class="bar-row__emoji">${c.m.emoji}</span>
            <div class="bar-row__track"><div class="bar-row__fill" style="width:${(c.n / max) * 100}%"></div></div>
            <span class="bar-row__num">${c.n}</span>
          </div>`
      )
      .join('');

    const topTags = allTags().slice(0, 8);

    return `
      ${bookCardHtml()}

      <div class="stats-grid">
        <div class="stat stat--brand"><b>${days}</b><span>在一起的天数</span></div>
        <div class="stat"><b>${records.length}</b><span>条记录</span></div>
        <div class="stat"><b>${shots}</b><span>张照片</span></div>
        <div class="stat"><b>${streak}</b><span>连续记录天数</span></div>
      </div>

      <div class="section">
        <div class="section__head"><div class="section__title">心情分布</div></div>
        <div class="card">${bars}</div>
      </div>

      ${
        topTags.length
          ? `<div class="section">
              <div class="section__head"><div class="section__title">常用标签</div></div>
              <div class="card"><div class="record__tags">${topTags
                .map((t) => `<span class="tag">#${UI.escapeHtml(t)}</span>`)
                .join('')}</div></div>
            </div>`
          : ''
      }

      <div class="section">
        <div class="section__head">
          <div class="section__title">${cal.label}</div>
          <div class="section__more">亮起的日子有记录</div>
        </div>
        <div class="card"><div class="calendar">${cal.cells}</div></div>
      </div>

      <div class="section">
        <div class="section__head">
          <div class="section__title">设置</div>
          <div class="section__more">${Cloud.isOnline() ? '☁️ 数据云端同步中' : '离线模式'}</div>
        </div>
        <div class="card" style="padding:0;overflow:hidden">
          <div class="srow" data-act="settings">
            <span class="srow__icon">👤</span>
            <div class="srow__main">
              <div class="srow__label">我们的资料</div>
              <div class="srow__hint">头像 · 昵称 · 主题色 · 纪念日</div>
            </div>
            <span class="srow__chev">›</span>
          </div>
          <div class="srow" data-act="events">
            <span class="srow__icon">🎉</span>
            <div class="srow__main">
              <div class="srow__label">重要日子</div>
              <div class="srow__hint">纪念日与生日倒计时</div>
            </div>
            <span class="srow__chev">›</span>
          </div>
          <div class="srow" data-act="security">
            <span class="srow__icon">🔒</span>
            <div class="srow__main">
              <div class="srow__label">账号安全</div>
              <div class="srow__hint">密码 · 密保 · 恢复码</div>
            </div>
            <span class="srow__chev">›</span>
          </div>
          <div class="srow" data-act="backup">
            <span class="srow__icon">🗂</span>
            <div class="srow__main">
              <div class="srow__label">备份与恢复</div>
              <div class="srow__hint">导出 / 导入 / 清理本机</div>
            </div>
            <span class="srow__chev">›</span>
          </div>
          <div class="srow" data-act="${isIOS() ? 'install' : 'download-apk'}">
            <span class="srow__icon">📲</span>
            <div class="srow__main">
              <div class="srow__label">${isIOS() ? '添加到手机桌面' : '安装安卓版 App'}</div>
              <div class="srow__hint">${
                isIOS()
                  ? 'Safari 打开 → 分享 → 添加到主屏幕'
                  : isAppMode()
                  ? '重装或分享给别人时下载最新安装包'
                  : '独立图标全屏打开，以后自动更新'
              }</div>
            </div>
            <span class="srow__chev">›</span>
          </div>
          <div class="srow" data-act="force-update">
            <span class="srow__icon">♻️</span>
            <div class="srow__main">
              <div class="srow__label">检查更新</div>
              <div class="srow__hint">版本 ${UI.escapeHtml(window.APP_VERSION || 'dev')} · 界面没变就点这里强制刷新</div>
            </div>
            <span class="srow__chev">›</span>
          </div>
        </div>
      </div>
    `;
  }

  function openBackupSheet() {
    const body = UI.openSheet(`
      <div class="sheet__title">
        <span>备份与恢复</span>
        <button class="mini-btn" type="button" data-act="close-sheet">✕</button>
      </div>
      <p class="record__note" style="margin-top:0">记录和照片都保存在云端，多台设备登录即可同步。备份文件用来把数据带走或转移到别的账号。</p>
      <button class="btn btn--primary btn--block" type="button" data-bk="export">⬇️ 导出备份（含照片）</button>
      <button class="btn btn--ghost btn--block" type="button" data-bk="import" style="margin-top:10px">⬆️ 从备份文件导入</button>
      <button class="btn btn--ghost btn--block btn--sm" type="button" data-bk="clear" style="margin-top:18px;color:var(--text-dim)">清空本机缓存并退出登录</button>
    `);
    body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-bk]');
      if (!b) return;
      UI.closeSheet();
      if (b.dataset.bk === 'export') exportBackup();
      if (b.dataset.bk === 'import') importBackup();
      if (b.dataset.bk === 'clear') clearAll();
    });
  }

  /* ---------------- 渲染入口 ---------------- */

  const TITLES = {
    home: ['朝暮', '朝朝暮暮，都是你'],
    timeline: ['时光轴', '翻翻我们一起走过的日子'],
    album: ['相册', '每一个瞬间都值得收藏'],
    stats: ['我们', '关于这段感情的小数据']
  };

  function render() {
    const p = Store.getProfile();
    document.documentElement.setAttribute('data-theme', p.theme || 'light');
    document.documentElement.setAttribute('data-palette', p.palette || 'pink');

    // 未登录 / 还没加入本子时，显示登录或创建界面
    if (!Store.isSignedIn() || !Store.getBook()) {
      AuthView.show();
      return;
    }

    const views = { home: renderHome, timeline: renderTimeline, album: renderAlbum, stats: renderStats };
    Object.keys(views).forEach((key) => {
      const el = document.getElementById('view-' + key);
      el.hidden = key !== state.tab;
      if (key === state.tab) el.innerHTML = views[key]();
    });

    const t = TITLES[state.tab] || TITLES.home;
    UI.$('#topbarTitle').textContent = t[0];
    UI.$('#topbarSub').textContent = t[1];
    UI.$('#btnTheme').textContent = (p.theme || 'light') === 'dark' ? '☀️' : '🌙';

    UI.$$('.tab').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.tab === state.tab));

    hydrateImages(document.getElementById('view-' + state.tab));
  }

  function switchTab(tab) {
    if (state.tab === tab) {
      document.getElementById('main').scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    state.tab = tab;
    document.getElementById('main').scrollTop = 0;
    render();
  }

  /* ---------------- 撰写记录 ---------------- */

  function composeHtml(draft) {
    const moods = MOODS.map(
      (m) =>
        `<button class="mood${draft.mood === m.key ? ' is-on' : ''}" type="button" data-mood="${m.key}">${m.emoji} ${m.label}</button>`
    ).join('');

    const tags = Array.from(new Set(PRESET_TAGS.concat(draft.tags || [])))
      .map(
        (t) =>
          `<button class="chip${(draft.tags || []).includes(t) ? ' is-on' : ''}" type="button" data-tag="${UI.escapeHtml(t)}">#${UI.escapeHtml(t)}</button>`
      )
      .join('');

    return `
      <div class="sheet__title">
        <span>${draft.id ? '编辑记录' : '写一条新记录'}</span>
        <button class="mini-btn" type="button" data-act="close-sheet">✕</button>
      </div>

      <div class="row">
        <div class="field">
          <label class="field__label" for="fDate">日期</label>
          <input class="input" id="fDate" type="date" value="${UI.escapeHtml(draft.date)}" />
        </div>
        <div class="field">
          <label class="field__label" for="fPlace">地点（选填）</label>
          <input class="input" id="fPlace" type="text" placeholder="比如：那家小面馆"
                 value="${UI.escapeHtml(draft.place || '')}" />
        </div>
        <div class="field">
          <span class="field__label">语音日记（选填）</span>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="btn btn--ghost btn--sm" type="button" id="btnVoice"
                    style="white-space:nowrap">🎙 开始录音</button>
            <span id="voiceTime" style="font-size:12px;color:var(--text-dim)"></span>
            <button class="mini-btn" type="button" id="btnVoiceDel" hidden title="删除录音">🗑</button>
          </div>
          <audio id="voicePreview" controls hidden style="width:100%;margin-top:8px"></audio>
        </div>
      </div>

      <div class="field">
        <label class="field__label" for="fTitle">标题（选填）</label>
        <input class="input" id="fTitle" type="text" placeholder="给今天起个名字" value="${UI.escapeHtml(draft.title || '')}" />
      </div>

      <div class="field">
        <span class="field__label">照片</span>
        <input type="file" id="fFile" accept="image/*" multiple hidden />
        <div class="uploader" id="fUploader"></div>
        <div class="drop-hint">最多 9 张 · 也可以直接把照片拖进来或粘贴</div>
      </div>

      <div class="field">
        <span class="field__label">今天的心情</span>
        <div class="moods" id="fMoods">${moods}</div>
      </div>

      <div class="field">
        <span class="field__label">标签</span>
        <div class="chips" id="fTags" style="margin-top:0;padding-top:0">${tags}</div>
        <input class="input" id="fTagInput" style="margin-top:8px" type="text" placeholder="输入自定义标签后回车" />
      </div>

      <div class="field">
        <label class="field__label" for="fNote">想说的话</label>
        <textarea class="textarea" id="fNote" placeholder="今天发生了什么？当时的心情是怎样的…">${UI.escapeHtml(draft.note || '')}</textarea>
      </div>

      <div class="row" style="margin-top:18px">
        <button class="btn btn--ghost" type="button" data-act="close-sheet">取消</button>
        <button class="btn btn--primary" type="button" data-act="save">保存记录</button>
      </div>
    `;
  }

  function renderThumbs() {
    const box = document.getElementById('fUploader');
    if (!box) return;
    const images = state.drafting.images;
    let html = `<button class="uploader__add" type="button" data-act="pick"><b>＋</b>添加照片</button>`;
    images.forEach((img, i) => {
      const src = img.data || previewCache.get(img.id) || '';
      html += `<div class="thumb">
        <img src="${UI.escapeHtml(src)}" data-thumb="${UI.escapeHtml(img.id)}" alt="" />
        ${i === 0 ? '<div class="thumb__cover">封面</div>' : ''}
        <button class="thumb__del" type="button" data-act="rm-img" data-idx="${i}">✕</button>
      </div>`;
    });
    box.innerHTML = html;
    if (!images.length) return;
    // 异步补齐尚未解码的预览图
    images.forEach((img) => {
      if (img.data || previewCache.get(img.id)) return;
      resolveURL(img).then((url) => {
        const el = box.querySelector(`[data-thumb="${img.id}"]`);
        if (el && url) el.src = url;
      });
    });
  }

  /* 写记录弹窗里的语音录制（MediaRecorder） */
  function bindVoice(body) {
    const btn = body.querySelector('#btnVoice');
    const timeEl = body.querySelector('#voiceTime');
    const delBtn = body.querySelector('#btnVoiceDel');
    const prev = body.querySelector('#voicePreview');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';

    let rec = null;
    let chunks = [];
    let timer = null;
    let startedAt = 0;

    function refresh() {
      const a = state.drafting && state.drafting.audio;
      if (a && (a.blob || a.id)) {
        btn.textContent = '🎙 重录';
        delBtn.hidden = false;
        if (a.url) {
          prev.src = a.url;
          prev.hidden = false;
        }
        timeEl.textContent = a.duration ? Math.round(a.duration) + '″' : '';
      } else {
        btn.textContent = '🎙 开始录音';
        delBtn.hidden = true;
        prev.hidden = true;
        prev.removeAttribute('src');
        timeEl.textContent = '';
      }
    }

    async function toggleRecord() {
      if (rec && rec.state === 'recording') {
        rec.stop();
        return;
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        UI.toast('这台设备不支持录音');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        rec = new MediaRecorder(stream);
        chunks = [];
        startedAt = Date.now();
        rec.ondataavailable = (e) => {
          if (e.data && e.data.size) chunks.push(e.data);
        };
        rec.onstop = () => {
          try {
            stream.getTracks().forEach((t) => t.stop());
          } catch (err) {
            /* 忽略 */
          }
          clearInterval(timer);
          const mime = rec.mimeType || 'audio/webm';
          const blob = new Blob(chunks, { type: mime });
          const dur = Math.max(1, (Date.now() - startedAt) / 1000);
          if (state.drafting) {
            state.drafting.audio = {
              blob: blob,
              url: URL.createObjectURL(blob),
              duration: dur,
              ext: mime.indexOf('mp4') >= 0 || mime.indexOf('m4a') >= 0 ? 'm4a' : 'webm'
            };
          }
          refresh();
          UI.toast('录音完成，保存记录时会一起上传');
        };
        rec.start();
        btn.textContent = '⏹ 停止录音';
        timer = setInterval(() => {
          timeEl.textContent = Math.floor((Date.now() - startedAt) / 1000) + '″ 录音中…';
        }, 400);
      } catch (err) {
        const name = (err && err.name) || '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          UI.toast('麦克风权限被拒绝：请到系统设置 → 应用 → 朝暮 → 权限，打开麦克风');
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          UI.toast('这台设备上没有找到麦克风');
        } else if (name === 'NotReadableError' || name === 'TrackStartError') {
          UI.toast('麦克风被其他应用占用了，关掉再试');
        } else {
          UI.toast('录音启动失败：' + (err && err.message ? err.message : name || '未知错误'));
        }
      }
    }

    btn.addEventListener('click', toggleRecord);
    delBtn.addEventListener('click', () => {
      if (state.drafting) state.drafting.audio = null;
      refresh();
    });

    refresh();
  }

  function openCompose(rec) {
    const draft = rec
      ? JSON.parse(JSON.stringify(rec))
      : {
          id: null,
          date: UI.todayStr(),
          title: '',
          note: '',
          place: '',
          mood: 'sweet',
          tags: [],
          images: []
        };
    if (!draft.mood) draft.mood = 'sweet';
    state.drafting = draft;
    state.editingId = rec ? rec.id : null;
    const originalImages = rec ? (rec.images || []).slice() : [];

    const body = UI.openSheet(composeHtml(draft), {
      focus: '#fTitle',
      onClose: () => { state.drafting = null; }
    });
    renderThumbs();
    bindVoice(body);

    const fileInput = body.querySelector('#fFile');

    async function handleFiles(files) {
      const remain = 9 - state.drafting.images.length;
      if (remain <= 0) {
        UI.toast('最多 9 张照片哦');
        return;
      }
      const picked = Array.prototype.slice.call(files).slice(0, remain);
      if (!picked.length) return;
      UI.toast('正在处理照片…');
      const refs = await Store.addImages(picked);
      refs.forEach((r) => {
        if (r.data) previewCache.set(r.id, r.data);
      });
      state.drafting.images = state.drafting.images.concat(refs);
      renderThumbs();
      if (refs.length) UI.toast(`已添加 ${refs.length} 张照片`);
    }

    function syncDraft() {
      const d = state.drafting;
      d.date = body.querySelector('#fDate').value || UI.todayStr();
      d.title = body.querySelector('#fTitle').value.trim();
      d.place = body.querySelector('#fPlace').value.trim();
      d.note = body.querySelector('#fNote').value;
    }

    fileInput.addEventListener('change', () => {
      handleFiles(fileInput.files);
      fileInput.value = '';
    });

    body.addEventListener('click', (e) => {
      const pick = e.target.closest('[data-act="pick"]');
      if (pick) {
        fileInput.click();
        return;
      }
      const rm = e.target.closest('[data-act="rm-img"]');
      if (rm) {
        const i = Number(rm.dataset.idx);
        state.drafting.images.splice(i, 1);
        renderThumbs();
        return;
      }
      const mood = e.target.closest('[data-mood]');
      if (mood) {
        state.drafting.mood = mood.dataset.mood;
        UI.$$('#fMoods .mood').forEach((b) => b.classList.toggle('is-on', b.dataset.mood === mood.dataset.mood));
        return;
      }
      const tag = e.target.closest('[data-tag]');
      if (tag) {
        const val = tag.dataset.tag;
        const list = state.drafting.tags;
        const at = list.indexOf(val);
        if (at >= 0) list.splice(at, 1);
        else list.push(val);
        tag.classList.toggle('is-on', at < 0);
        return;
      }
      const save = e.target.closest('[data-act="save"]');
      if (save) {
        syncDraft();
        doSave(originalImages);
      }
    });

    body.querySelector('#fTagInput').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const val = e.target.value.trim().replace(/^#/, '');
      if (!val) return;
      if (!state.drafting.tags.includes(val)) {
        state.drafting.tags.push(val);
        const chip = body.querySelector(`#fTags [data-tag="${CSS.escape(val)}"]`);
        if (chip) chip.classList.add('is-on');
        else {
          const btn = document.createElement('button');
          btn.className = 'chip is-on';
          btn.type = 'button';
          btn.dataset.tag = val;
          btn.textContent = '#' + val;
          body.querySelector('#fTags').appendChild(btn);
        }
      }
      e.target.value = '';
    });

    ['dragenter', 'dragover'].forEach((t) =>
      body.addEventListener(t, (e) => {
        e.preventDefault();
      })
    );
    body.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
    });
  }

  async function doSave(originalImages) {
    const d = state.drafting;
    if (!d.title && !d.note.trim() && !d.images.length) {
      UI.toast('写点什么，或者加一张照片吧');
      return;
    }
    const payload = {
      id: d.id || null,
      date: d.date,
      title: d.title,
      note: d.note.trim(),
      place: d.place,
      mood: d.mood,
      tags: d.tags,
      images: d.images.map((i) => ({
        id: i.id,
        name: i.name,
        w: i.w,
        h: i.h
      })),
      createdAt: d.createdAt || Date.now()
    };

    // 语音日记：新录音先上传；编辑时未重录则沿用云端已有的
    if (d.audio) {
      if (d.audio.blob) {
        const keepBtn0 = UI.$$('#sheet [data-act="save"]')[0];
        if (keepBtn0) keepBtn0.textContent = '上传语音中…';
        const up = await Cloud.uploadImage(
          blobToFile(d.audio.blob, 'voice.' + (d.audio.ext || 'webm'))
        );
        payload.audio = { id: up.fileId, duration: Math.round(d.audio.duration || 0) };
      } else if (d.audio.id) {
        payload.audio = { id: d.audio.id, duration: Math.round(d.audio.duration || 0) };
      } else {
        payload.audio = null;
      }
    } else {
      payload.audio = null;
    }

    const keepBtn = UI.$$('#sheet [data-act="save"]')[0];
    if (keepBtn) {
      keepBtn.disabled = true;
      keepBtn.textContent = '保存中…';
    }
    try {
      await Store.upsertRecord(payload);
    } catch (err) {
      if (keepBtn) {
        keepBtn.disabled = false;
        keepBtn.textContent = '保存记录';
      }
      return;
    }
    const kept = new Set(payload.images.map((i) => i.id));
    const dropped = originalImages.filter((i) => !kept.has(i.id));
    if (dropped.length) await Store.dropImages(dropped);
    state.drafting = null;
    UI.closeSheet();
    render();
    UI.toast('已记录啦 ❤');
  }

  /* ---------------- 设置 / 资料 ---------------- */

  function openSettings() {
    const p = Store.getProfile();
    const palettes = PALETTES.map(
      (x) =>
        `<button class="palette${p.palette === x.key ? ' is-on' : ''}" type="button" data-pal="${x.key}" style="background:linear-gradient(135deg,${x.from},${x.to})" title="${x.key}"></button>`
    ).join('');

    const html = `
      <div class="sheet__title">
        <span>我们的资料</span>
        <button class="mini-btn" type="button" data-act="close-sheet">✕</button>
      </div>

      <div class="set-grid">
        <div class="set-card">
          <div class="set-avatar" data-act="avatar" data-who="myAvatar" title="点头像更换">
            ${avatarHtml(p.myAvatar, p.myName, 'avatar--sm')}
            ${p.myAvatar ? '<span class="set-avatar__rm" data-rm-avatar="myAvatar">✕</span>' : ''}
          </div>
          <input class="input" id="sMyName" maxlength="12" value="${UI.escapeHtml(p.myName || '')}" placeholder="我的昵称" />
        </div>
        <div class="set-card">
          <div class="set-avatar" data-act="avatar" data-who="partnerAvatar" title="点头像更换">
            ${avatarHtml(p.partnerAvatar, p.partnerName, 'avatar--sm')}
            ${p.partnerAvatar ? '<span class="set-avatar__rm" data-rm-avatar="partnerAvatar">✕</span>' : ''}
          </div>
          <input class="input" id="sPartnerName" maxlength="12" value="${UI.escapeHtml(p.partnerName || '')}" placeholder="TA 的昵称" />
        </div>
      </div>

      <div class="field">
        <label class="field__label" for="sAnniv">我们在一起的日子</label>
        <input class="input" id="sAnniv" type="date" value="${UI.escapeHtml(p.anniversary || UI.todayStr())}" />
      </div>

      <div class="field">
        <span class="field__label">主题色</span>
        <div class="palettes">${palettes}</div>
      </div>

      <button class="btn btn--primary btn--block" type="button" data-act="save-profile" style="margin-top:6px">保存</button>
    `;

    const body = UI.openSheet(html);
    hydrateImages(body);

    const avatarInput = document.createElement('input');
    avatarInput.type = 'file';
    avatarInput.accept = 'image/*';
    avatarInput.hidden = true;
    body.appendChild(avatarInput);

    let who = null;
    avatarInput.addEventListener('change', async () => {
      const files = avatarInput.files;
      if (!files || !files.length) return;
      UI.toast('头像上传中…');
      try {
        const refs = await Store.addImages([files[0]]);
        avatarInput.value = '';
        if (!refs.length || !who) return;
        const old = Store.getProfile()[who];
        await Store.saveProfile({ [who]: refs[0] });
        if (old) await Store.dropImages([old]);
        UI.closeSheet();
        openSettings();
        render();
        UI.toast('头像已更新');
      } catch (err) {
        UI.toast(err.message || '头像上传失败');
      }
    });

    body.addEventListener('click', async (e) => {
      const rm = e.target.closest('[data-rm-avatar]');
      if (rm) {
        Store.saveProfile({ [rm.dataset.rmAvatar]: null }).then(() => {
          UI.closeSheet();
          openSettings();
          render();
        });
        return;
      }
      const av = e.target.closest('[data-act="avatar"]');
      if (av) {
        who = av.dataset.who;
        avatarInput.click();
        return;
      }
      const pal = e.target.closest('[data-pal]');
      if (pal) {
        Store.saveProfile({ palette: pal.dataset.pal }).catch(() => {});
        UI.$$('.palette').forEach((b) => b.classList.toggle('is-on', b === pal));
        document.documentElement.setAttribute('data-palette', pal.dataset.pal);
        return;
      }
      const save = e.target.closest('[data-act="save-profile"]');
      if (save) {
        save.disabled = true;
        save.textContent = '保存中…';
        try {
          await Store.saveProfile({
            myName: body.querySelector('#sMyName').value.trim() || '我',
            partnerName: body.querySelector('#sPartnerName').value.trim() || '宝贝',
            anniversary: body.querySelector('#sAnniv').value || UI.todayStr()
          });
          UI.closeSheet();
          render();
          UI.toast('资料已更新');
        } catch (err) {
          save.disabled = false;
          save.textContent = '保存';
          UI.toast(err.message || '保存失败');
        }
        return;
      }

      // 设置里的其他入口（安装包 / 检查更新 / 备份 / 重要日子 等）
      const other = e.target.closest('[data-act]');
      if (!other) return;
      const a = other.dataset.act;
      if (a === 'download-apk') return downloadApk();
      if (a === 'force-update') return forceUpdate();
      if (a === 'export') return exportBackup();
      if (a === 'import') return importBackup();
      if (a === 'events') return openEvents();
      if (a === 'clear') return clearAll();
      if (a === 'logout') return AuthView.signOut();
      if (a === 'security') return openSecurity();
    });
  }

  /* ---------------- 纠结转盘 ---------------- */

  function openDecision() {
    const read = (key, fb) => {
      try {
        const v = JSON.parse(localStorage.getItem(key) || 'null');
        if (Array.isArray(v)) return v.filter((x) => typeof x === 'string' && x.trim());
      } catch (err) { /* 忽略 */ }
      return fb.slice();
    };
    const pool = read('ld:decide', ['火锅', '烧烤', '寿司', '麻辣烫', '甜品']);
    let items = read('ld:decideWheel', []);
    if (!items.length) items = pool.slice(0, Math.min(pool.length, 6));

    const savePool = () => {
      try { localStorage.setItem('ld:decide', JSON.stringify(pool)); } catch (err) { /* 忽略 */ }
    };
    const saveWheel = () => {
      try { localStorage.setItem('ld:decideWheel', JSON.stringify(items)); } catch (err) { /* 忽略 */ }
    };

    let spinning = false;
    let angle = 0;

    const html = `
      <div class="sheet__title">
        <span>🤔 纠结转盘</span>
        <button class="mini-btn" type="button" data-act="close-sheet">✕</button>
      </div>
      <div class="dc-wrap">
        <div class="dc-left">
          <span class="field__label">选项（点一下上转盘，再点取消）</span>
          <div class="row" style="gap:8px;align-items:center;margin:8px 0 10px">
            <input class="input" id="dcInput" maxlength="12" placeholder="比如：火锅" style="flex:1;min-width:0" />
            <button class="btn btn--primary btn--sm" type="button" id="dcAdd" style="flex:none">添加</button>
          </div>
          <div class="dc-pool" id="dcPool"></div>
        </div>
        <div class="dc-right">
          <div class="dc-wheel-box">
            <canvas id="dcCanvas" width="440" height="440"></canvas>
          </div>
          <button class="btn btn--primary btn--block" type="button" id="dcGo" style="margin-top:12px">🎯 开转！</button>
        </div>
      </div>
      <div class="dc-result" id="dcResult">吃什么、去哪玩、谁洗碗…<br/>让缘分替你决定 🎲</div>
    `;
    const body = UI.openSheet(html);

    const poolEl = body.querySelector('#dcPool');
    const inputEl = body.querySelector('#dcInput');
    const goBtn = body.querySelector('#dcGo');
    const resultEl = body.querySelector('#dcResult');
    const canvas = body.querySelector('#dcCanvas');
    const ctx = canvas.getContext('2d');

    const COLORS = ['#ff8fab', '#ffd3e0', '#ff9ebe', '#ffe6ee', '#f97ba8', '#ffc9d8', '#ff86ae', '#fbdce6'];

    function renderPool() {
      poolEl.innerHTML = pool.length
        ? pool
            .map(
              (o, i) =>
                `<span class="dc-pool__opt${items.indexOf(o) >= 0 ? ' is-on' : ''}" data-toggle="${i}">${UI.escapeHtml(o)}<b data-pdel="${i}">✕</b></span>`
            )
            .join('')
        : '<span class="dq-empty">还没有选项，先添加一个吧</span>';
    }

    function drawWheel() {
      const size = canvas.width;
      const cx = size / 2;
      const cy = size / 2;
      const R = size / 2 - 10;
      ctx.clearRect(0, 0, size, size);
      const n = items.length;
      if (!n) return;
      const arc = (Math.PI * 2) / n;
      for (let i = 0; i < n; i++) {
        const a0 = i * arc - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, a0, a0 + arc);
        ctx.closePath();
        ctx.fillStyle = COLORS[i % COLORS.length];
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.95)';
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      for (let i = 0; i < n; i++) {
        const mid = i * arc - Math.PI / 2 + arc / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(mid);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#7a1f43';
        ctx.font = 'bold 30px system-ui, -apple-system, sans-serif';
        let t = items[i];
        if (t.length > 6) t = t.slice(0, 6) + '…';
        ctx.fillText(t, R * 0.58, 0);
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, 34, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,107,157,.55)';
      ctx.lineWidth = 5;
      ctx.stroke();
    }

    function refresh() {
      renderPool();
      drawWheel();
    }

    body.addEventListener('click', (e) => {
      const pdel = e.target.closest('[data-pdel]');
      if (pdel && !spinning) {
        const i = Number(pdel.dataset.pdel);
        const o = pool[i];
        const at = items.indexOf(o);
        if (at >= 0) items.splice(at, 1);
        pool.splice(i, 1);
        savePool();
        saveWheel();
        refresh();
        return;
      }
      const toggle = e.target.closest('[data-toggle]');
      if (toggle && !spinning) {
        const o = pool[Number(toggle.dataset.toggle)];
        if (!o) return;
        const at = items.indexOf(o);
        if (at >= 0) {
          items.splice(at, 1);
          if (items.length < 2) resultEl.innerHTML = '至少要两个选项才能开转哦';
        } else {
          if (items.length >= 12) {
            UI.toast('转盘最多 12 个选项');
            return;
          }
          items.push(o);
        }
        saveWheel();
        refresh();
        return;
      }
      if (e.target.closest('#dcAdd')) {
        const v = (inputEl.value || '').trim();
        if (!v) return;
        if (pool.indexOf(v) >= 0) {
          UI.toast('已经有「' + v + '」了');
          inputEl.value = '';
          return;
        }
        if (pool.length >= 24) {
          UI.toast('选项满啦，先删掉一些吧');
          return;
        }
        pool.push(v);
        if (items.length < 12) items.push(v);
        inputEl.value = '';
        savePool();
        saveWheel();
        refresh();
        return;
      }
      if (e.target.closest('#dcGo')) spin();
    });
    body.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.id === 'dcInput') {
        const btn = body.querySelector('#dcAdd');
        if (btn) btn.click();
      }
    });

    function spin() {
      if (spinning) return;
      if (items.length < 2) {
        UI.toast('至少要两个选项才能纠结呀');
        return;
      }
      spinning = true;
      goBtn.disabled = true;
      resultEl.innerHTML = '转盘转转转…';

      const target = Math.floor(Math.random() * items.length);
      const arcDeg = 360 / items.length;
      /* 选项 i 画在从顶部开始第 i 块；让它的中心停在指针（顶部）下 */
      const segCenter = target * arcDeg + arcDeg / 2;
      const jitter = (Math.random() - 0.5) * arcDeg * 0.6;
      const targetDeg = (360 - ((segCenter + jitter) % 360)) % 360;
      angle = angle + 360 * 5 + (((targetDeg - (angle % 360)) % 360) + 360) % 360;
      canvas.style.transform = 'rotate(' + angle + 'deg)';

      setTimeout(() => {
        const pick = items[target];
        resultEl.innerHTML = `<div class="dc-final">🎯<br/>就去 <b>${UI.escapeHtml(pick)}</b>！</div>`;
        saveWheel();
        spinning = false;
        goBtn.disabled = false;
        UI.toast('缘分已定：' + pick);
      }, 4250);
    }

    refresh();
  }

  /* ---------------- 悄悄话·想你 ---------------- */

  async function sendMiss() {
    try {
      const r = await Cloud.api.sendMiss();
      if (r.eventTs) setLastMissTs(Math.max(lastMissTs(), r.eventTs));
      const card = document.querySelector('.love-card');
      if (card) {
        const hearts = card.querySelector('.love-card__hearts');
        if (hearts) {
          const s = document.createElement('span');
          s.className = 'miss-fly';
          s.textContent = '💗';
          s.style.left = 15 + Math.random() * 70 + '%';
          hearts.appendChild(s);
          setTimeout(() => s.remove(), 3200);
        }
      }
      render();
      UI.toast(
        r.partnerCount > 0
          ? 'TA 今天已经想了你 ' + r.partnerCount + ' 次，你们想到一起了 ❤'
          : '已经悄悄告诉 TA：你想 TA 了 ❤'
      );
    } catch (err) {
      UI.toast(err.message || '发送失败');
    }
  }

  /* ---------------- 想你：对方屏幕飘爱心 ---------------- */

  function lastMissTs() {
    try { return Number(localStorage.getItem('ld:lastMissTs')) || 0; } catch (err) { return 0; }
  }
  function setLastMissTs(v) {
    try { localStorage.setItem('ld:lastMissTs', String(v || 0)); } catch (err) { /* 忽略 */ }
  }

  function missRain(n) {
    const box = document.createElement('div');
    box.className = 'miss-rain';
    const emojis = ['💗', '💖', '💕', '❤️', '💘'];
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span');
      s.className = 'mr-heart';
      s.textContent = emojis[i % emojis.length];
      s.style.left = 4 + Math.random() * 92 + '%';
      s.style.animationDelay = (Math.random() * 1.8).toFixed(2) + 's';
      s.style.fontSize = 16 + Math.round(Math.random() * 20) + 'px';
      box.appendChild(s);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 5600);
  }

  let missTimer = null;
  let missPolling = false;

  async function pollMiss() {
    if (missPolling || !Store.isSignedIn() || !Store.getBook()) return;
    missPolling = true;
    try {
      const since = lastMissTs();
      const r = await Cloud.api.checkMiss(since);
      const myId = (Cloud.session && Cloud.session.uid) || '';
      let maxTs = since;
      const fromPartner = [];
      (r.events || []).forEach((e) => {
        if (e.ts > maxTs) maxTs = e.ts;
        if (e.from !== myId) fromPartner.push(e);
      });
      setLastMissTs(maxTs);
      if (fromPartner.length) {
        missRain(Math.min(fromPartner.length, 14));
        const who = fromPartner[fromPartner.length - 1].name || 'TA';
        UI.toast('💗 ' + who + ' 想你了' + (fromPartner.length > 1 ? ' ×' + fromPartner.length : ''));
      }
    } catch (err) { /* 静默轮询 */ }
    missPolling = false;
  }

  function startMissPoll() {
    if (missTimer) return;
    pollMiss();
    missTimer = setInterval(pollMiss, 15000);
  }
  function stopMissPoll() {
    clearInterval(missTimer);
    missTimer = null;
  }

  /* ---------------- 点赞 / 评论 ---------------- */

  function cmtTime(ts) {
    const d = new Date(ts || Date.now());
    const pad = (x) => (x < 10 ? '0' + x : '' + x);
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function updateLikeBtn(btn, likes, myId) {
    if (!btn) return;
    const liked = likes.indexOf(myId) >= 0;
    btn.classList.toggle('is-liked', liked);
    btn.innerHTML = (liked ? '❤️' : '🤍') + '<span>' + (likes.length ? likes.length : '喜欢') + '</span>';
  }

  function updateCommentBtn(id, count) {
    const btn = document.querySelector(
      '.rec-foot__btn[data-act="comments"][data-id="' + String(id).replace(/"/g, '') + '"]'
    );
    if (!btn) return;
    const span = btn.querySelector('span');
    if (span) span.textContent = count ? count : '评论';
  }

  async function toggleLike(id, btn) {
    const rec = Store.getRecord(id);
    if (!rec) return;
    const myId = (Cloud.session && Cloud.session.uid) || '';
    const likes = (rec.likes || []).slice();
    const at = likes.indexOf(myId);
    if (at >= 0) likes.splice(at, 1);
    else likes.push(myId);
    /* 只更新状态和当前按钮，不整页重渲染（重渲染会重建图片导致闪烁） */
    Store.patchRecord(id, { likes: likes });
    updateLikeBtn(btn, likes, myId);
    try {
      const r = await Cloud.api.toggleLike(id);
      Store.patchRecord(id, { likes: r.likes || [] });
      updateLikeBtn(btn, r.likes || [], myId);
    } catch (err) {
      UI.toast(err.message || '点赞失败');
    }
  }

  function openComments(id) {
    const rec = Store.getRecord(id);
    if (!rec) return;
    const myId = (Cloud.session && Cloud.session.uid) || '';
    const list = (rec.comments || [])
      .map(
        (c) => `
        <div class="cmt-item">
          <div class="cmt-item__head">
            ${avatarHtml(c.avatar, c.name, 'avatar--xs')}
            <b>${UI.escapeHtml(c.name || 'Ta')}</b>
            <span>${cmtTime(c.ts)}</span>
            ${c.uid === myId ? `<button class="mini-btn" type="button" data-cmt-del="${UI.escapeHtml(c.id)}" title="删除">✕</button>` : ''}
          </div>
          <div class="cmt-item__text">${UI.escapeHtml(c.text)}</div>
        </div>`
      )
      .join('');

    const body = UI.openSheet(`
      <div class="sheet__title">
        <span>评论（${(rec.comments || []).length}）</span>
        <button class="mini-btn" type="button" data-act="close-sheet">✕</button>
      </div>
      <div class="cmt-list">${list || '<div class="empty__desc" style="padding:14px 0">还没有评论，来抢沙发吧</div>'}</div>
      <div class="row cmt-row">
        <input class="input" id="cmtInput" maxlength="500" placeholder="写点甜甜的话…" />
        <button class="btn btn--primary" type="button" id="cmtSend" style="flex:none">发送</button>
      </div>
    `);
    hydrateImages(body);

    const send = async () => {
      const input = body.querySelector('#cmtInput');
      const text = (input.value || '').trim();
      if (!text) return UI.toast('先写点什么吧');
      const btn = body.querySelector('#cmtSend');
      btn.disabled = true;
      try {
        const r = await Cloud.api.addComment(id, text);
        const cur = Store.getRecord(id);
        const comments = ((cur && cur.comments) || []).concat([r.comment]);
        Store.patchRecord(id, { comments: comments });
        updateCommentBtn(id, comments.length);
        openComments(id);
      } catch (err) {
        btn.disabled = false;
        UI.toast(err.message || '发送失败');
      }
    };
    body.querySelector('#cmtSend').addEventListener('click', send);
    body.querySelector('#cmtInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') send();
    });
    body.addEventListener('click', async (e) => {
      const del = e.target.closest('[data-cmt-del]');
      if (!del) return;
      try {
        await Cloud.api.delComment(id, del.dataset.cmtDel);
        const cur = Store.getRecord(id);
        const comments = (cur.comments || []).filter((c) => c.id !== del.dataset.cmtDel);
        Store.patchRecord(id, { comments: comments });
        updateCommentBtn(id, comments.length);
        openComments(id);
      } catch (err) {
        UI.toast(err.message || '删除失败');
      }
    });
  }

  /* ---------------- 每日一问 ---------------- */

  function openDailyAnswer() {
    const p = Store.getProfile();
    const daily = p.daily || {};
    const myId = (Cloud.session && Cloud.session.uid) || '';
    const mine = (daily.answers || {})[myId] || '';

    const html = `
      <div class="sheet__title">
        <span>今日一问</span>
        <button class="mini-btn" type="button" data-act="close-sheet">✕</button>
      </div>
      <div class="dq-q" style="font-size:15px;font-weight:700;margin:2px 0 14px">${UI.escapeHtml(
        daily.question || ''
      )}</div>
      <div class="field">
        <textarea class="input textarea" id="dqText" maxlength="500"
                  placeholder="写下你的答案…答完后你们就能看到彼此的了">${UI.escapeHtml(mine)}</textarea>
      </div>
      <button class="btn btn--primary btn--block" type="button" data-act="save-daily">保存回答</button>
      <div class="drop-hint" style="margin-top:12px">保存后，你们两个都能看到彼此今天的答案；每天的问题会换一个</div>
    `;
    const body = UI.openSheet(html);
    body.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act="save-daily"]');
      if (!btn) return;
      const text = body.querySelector('#dqText').value.trim();
      if (!text) {
        UI.toast('先写点什么吧');
        return;
      }
      btn.disabled = true;
      btn.textContent = '保存中…';
      try {
        await Cloud.api.answerDaily(text);
        await Store.sync();
        UI.closeSheet();
        render();
        UI.toast('已保存，去看看 TA 写了什么 ❤');
      } catch (err) {
        btn.disabled = false;
        btn.textContent = '保存回答';
        UI.toast(err.message || '保存失败');
      }
    });
  }

  function openDailyHistory() {
    const p = Store.getProfile();
    const myId = (Cloud.session && Cloud.session.uid) || '';
    const partnerId = (p.members || []).filter((m) => m !== myId)[0] || '';
    const hist = (p.dailyHistory || []).filter((x) => {
      const a = x.answers || {};
      return Boolean(a[myId]) || Boolean(partnerId && a[partnerId]);
    });

    const rows = hist.length
      ? hist
          .map((x) => {
            const mine = (x.answers || {})[myId] || '';
            const partner = partnerId ? (x.answers || {})[partnerId] || '' : '';
            return `<div class="dq-hist">
              <div class="dq-hist__date">${UI.formatDate(x.date)}</div>
              <div class="dq-hist__q">${UI.escapeHtml(x.question)}</div>
              ${mine ? `<div class="dq-hist__a"><b>${UI.escapeHtml(p.myName || '我')}</b>${UI.escapeHtml(mine)}</div>` : ''}
              ${
                partner
                  ? `<div class="dq-hist__a"><b>${UI.escapeHtml(p.partnerName || 'TA')}</b>${UI.escapeHtml(partner)}</div>`
                  : ''
              }
            </div>`;
          })
          .join('')
      : '<div class="empty__desc" style="padding:10px 0">还没有历史回答，从今天开始攒吧</div>';

    const html = `
      <div class="sheet__title">
        <span>每日一问 · 回顾</span>
        <button class="mini-btn" type="button" data-act="close-sheet">✕</button>
      </div>
      <div style="max-height:60vh;overflow-y:auto">${rows}</div>
    `;
    UI.openSheet(html);
  }

  /* ---------------- 心愿清单 ---------------- */

  function openWishes() {
    renderWishSheet();

    function renderWishSheet() {
      const prof = Store.getProfile();
      const wishes = prof.wishes || [];
      const myId = (Cloud.session && Cloud.session.uid) || '';
      const nameOf = (uid) => (uid === myId ? prof.myName || '我' : prof.partnerName || 'TA');

      const rows = wishes.length
        ? wishes
            .map(
              (w) => `<div class="wish-row${w.done ? ' is-done' : ''}">
                <button class="wish-check" type="button" data-act="toggle-wish" data-id="${UI.escapeHtml(
                  w.id
                )}">${w.done ? '✅' : '⬜'}</button>
                <div class="wish-row__main">
                  <div class="wish-row__text">${UI.escapeHtml(w.text)}</div>
                  <div class="wish-row__meta">${UI.escapeHtml(nameOf(w.createdBy))} 许下的${
                    w.done ? ' · 已完成' : ''
                  }</div>
                </div>
                <button class="mini-btn" type="button" data-act="del-wish" data-id="${UI.escapeHtml(
                  w.id
                )}">🗑</button>
              </div>`
            )
            .join('')
        : '<div class="empty__desc" style="padding:12px 0">写下第一件想一起做的事吧 ✨</div>';

      const html = `
        <div class="sheet__title">
          <span>心愿清单</span>
          <button class="mini-btn" type="button" data-act="close-sheet">✕</button>
        </div>
        <div class="card" style="margin-bottom:14px">${rows}</div>
        <div class="row" style="gap:8px;align-items:center">
          <input class="input" id="wishText" maxlength="100" placeholder="想一起做的第 ${wishes.length + 1} 件事"
                 style="flex:1;min-width:0" />
          <button class="btn btn--primary btn--sm" type="button" data-act="add-wish"
                  style="flex:none;white-space:nowrap">添加</button>
        </div>
      `;
      const body = UI.openSheet(html);
      body.addEventListener('click', async (e) => {
        const tg = e.target.closest('[data-act="toggle-wish"]');
        if (tg) {
          try {
            await Cloud.api.toggleWish(tg.dataset.id);
            await Store.sync();
            renderWishSheet();
            render();
          } catch (err) {
            UI.toast(err.message || '操作失败');
          }
          return;
        }
        const del = e.target.closest('[data-act="del-wish"]');
        if (del) {
          try {
            await Cloud.api.removeWish(del.dataset.id);
            await Store.sync();
            renderWishSheet();
            render();
          } catch (err) {
            UI.toast(err.message || '删除失败');
          }
          return;
        }
        if (e.target.closest('[data-act="add-wish"]')) {
          const text = body.querySelector('#wishText').value.trim();
          if (!text) {
            UI.toast('先写下心愿内容');
            return;
          }
          try {
            await Cloud.api.addWish(text);
            await Store.sync();
            renderWishSheet();
            render();
          } catch (err) {
            UI.toast(err.message || '添加失败');
          }
        }
      });
      body.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.id === 'wishText') {
          const add = body.querySelector('[data-act="add-wish"]');
          if (add) add.click();
        }
      });
    }
  }

  /* ---------------- 语音日记 ---------------- */

  let voiceAudio = null;

  async function playVoice(btn) {
    const id = btn.dataset.id;
    if (!id) return;
    try {
      if (voiceAudio) {
        voiceAudio.pause();
        voiceAudio = null;
      }
      btn.textContent = '⏳ 加载中…';
      const urls = await Cloud.getFileUrls([id]);
      const url = urls[id];
      if (!url) throw new Error('取不到语音文件');
      voiceAudio = new Audio(url);
      voiceAudio.onended = () => {
        btn.textContent = '▶ 语音日记';
      };
      await voiceAudio.play();
      btn.textContent = '⏸ 播放中…（再点停止）';
      voiceAudio.onpause = () => {
        btn.textContent = '▶ 语音日记';
      };
    } catch (err) {
      btn.textContent = '▶ 语音日记';
      UI.toast(err.message || '播放失败');
    }
  }

  /* ---------------- 重要日子 ---------------- */

  function openEvents() {
    const p = Store.getProfile();
    const events = p.events || [];
    const icons = ['🎂', '💍', '✈️', '🎁', '🍰', '💌', '🎬', '🌙'];
    const lunarMonths = Array.from({ length: 12 }, (_, i) =>
      `<option value="${i + 1}">${Lunar.monthName(i + 1, false)}</option>`
    ).join('');
    const lunarDays = Array.from({ length: 30 }, (_, i) =>
      `<option value="${i + 1}">${Lunar.dayName(i + 1)}</option>`
    ).join('');

    const today = new Date();
    const rows = events.length
      ? events
          .map((ev) => {
            const isLunar = ev.calendar === 'lunar' && ev.lunarMonth;
            const nx = eventNextDate(ev, today);
            const dateStr = nx ? nx.y + '-' + UI.pad2(nx.m) + '-' + UI.pad2(nx.d) : ev.date;
            const diff = dateStr ? UI.daysBetween(today, UI.parseDate(dateStr)) : null;
            const txt =
              diff === null
                ? '—'
                : diff < 0
                ? '已过去'
                : diff === 0
                ? '就是今天'
                : `还有 ${diff} 天`;
            const dateLabel = isLunar
              ? `农历 ${Lunar.format(ev.lunarMonth, ev.lunarDay, ev.lunarIsLeap)}` +
                (ev.yearly ? ' · 每年' : ev.lunarYear ? ` · ${ev.lunarYear} 年` : '')
              : UI.formatDateShort(ev.date) + (ev.yearly ? ' · 每年' : '');
            const sub = isLunar && nx ? `公历 ${nx.m} 月 ${nx.d} 日` : '';
            return `<div class="event-row">
              <div class="event-row__icon">${UI.escapeHtml(ev.icon || (isLunar ? '🎂' : '📅'))}</div>
              <div class="event-row__main">
                <div class="event-row__name">${UI.escapeHtml(ev.name)}</div>
                <div class="event-row__date">${dateLabel}${sub ? ' · ' + sub : ''}</div>
              </div>
              <div class="event-row__count">${txt}</div>
              <button class="mini-btn" type="button" data-act="edit-event" data-id="${UI.escapeHtml(ev.id)}">✏️</button>
              <button class="mini-btn" type="button" data-act="del-event" data-id="${UI.escapeHtml(ev.id)}">🗑</button>
            </div>`;
          })
          .join('')
      : `<div class="empty__desc" style="padding:6px 0">还没有添加，下面可以加一个</div>`;

    const html = `
      <div class="sheet__title">
        <span>重要日子</span>
        <button class="mini-btn" type="button" data-act="close-sheet">✕</button>
      </div>
      <div class="card" style="margin-bottom:14px">${rows}</div>
      <button class="btn btn--primary btn--block" type="button" data-act="add-event">＋ 添加重要日子</button>
      <div class="drop-hint" style="margin-top:12px">生日可以选农历（阴历），到时候会自动换算成当年的公历日期</div>
    `;

    const body = UI.openSheet(html);

    body.addEventListener('click', (e) => {
      const del = e.target.closest('[data-act="del-event"]');
      if (del) {
        const id = del.dataset.id;
        const next = (Store.getProfile().events || []).filter((x) => x.id !== id);
        Store.saveProfile({ events: next }).then(() => {
          openEvents();
          render();
        });
        return;
      }
      const edit = e.target.closest('[data-act="edit-event"]');
      if (edit) {
        const ev = (Store.getProfile().events || []).filter((x) => x.id === edit.dataset.id)[0];
        if (ev) openEventForm(ev);
        return;
      }
      if (e.target.closest('[data-act="add-event"]')) openEventForm(null);
    });
  }

  /* 新增 / 编辑一个重要日子（ev 传 null 表示新增） */
  function openEventForm(ev) {
    const editing = Boolean(ev);
    const icons = ['🎂', '💍', '✈️', '🎁', '🍰', '💌', '🎬', '🌙'];
    const lunarMonths = Array.from({ length: 12 }, (_, i) =>
      `<option value="${i + 1}">${Lunar.monthName(i + 1, false)}</option>`
    ).join('');
    const lunarDays = Array.from({ length: 30 }, (_, i) =>
      `<option value="${i + 1}">${Lunar.dayName(i + 1)}</option>`
    ).join('');
    // 农历年份（仅「仅一次」时需要），按年代分组方便手机选择
    const lunarYears = (function () {
      let html = '';
      for (let start = 1930; start <= 2100; start += 10) {
        const end = Math.min(2100, start + 9);
        html += '<optgroup label="' + start + ' - ' + end + '">';
        for (let y = start; y <= end; y++) html += `<option value="${y}">${y} 年</option>`;
        html += '</optgroup>';
      }
      return html;
    })();

    let icon = (ev && ev.icon) || icons[0];
    let yearly = ev ? Boolean(ev.yearly) : true;
    let calendar = ev && ev.calendar === 'lunar' ? 'lunar' : 'solar';

    const html = `
      <div class="sheet__title">
        <span>${editing ? '编辑重要日子' : '添加重要日子'}</span>
        <button class="mini-btn" type="button" data-act="close-sheet">✕</button>
      </div>
      <div class="field">
        <label class="field__label" for="evName">名称</label>
        <input class="input" id="evName" placeholder="比如：TA 的生日 / 第一次看海"
               value="${UI.escapeHtml((ev && ev.name) || '')}" />
      </div>
      <div class="field">
        <span class="field__label">按哪种日历</span>
        <div class="chips" id="evCal" style="margin-top:0;padding-top:0">
          <button class="chip${calendar === 'solar' ? ' is-on' : ''}" type="button" data-cal="solar">公历</button>
          <button class="chip${calendar === 'lunar' ? ' is-on' : ''}" type="button" data-cal="lunar">农历（阴历）</button>
        </div>
      </div>
      <div class="field" id="evSolarField">
        <label class="field__label" for="evDate">日期</label>
        <input class="input" id="evDate" type="date" value="${UI.escapeHtml(
          (ev && ev.calendar !== 'lunar' && ev.date) || UI.todayStr()
        )}" />
      </div>
      <div class="field" id="evLunarField" hidden>
        <span class="field__label">农历日期（年 / 月 / 日）</span>
        <div class="row">
          <select class="input" id="evLunarYear">${lunarYears}</select>
          <select class="input" id="evLunarMonth">${lunarMonths}</select>
          <select class="input" id="evLunarDay">${lunarDays}</select>
        </div>
        <div class="drop-hint" id="evLunarHint" style="margin-top:8px"></div>
      </div>
      <div class="field">
        <span class="field__label">图标</span>
        <div class="chips" id="evIcons" style="margin-top:0;padding-top:0">
          ${icons
            .map(
              (x) =>
                `<button class="chip${x === icon ? ' is-on' : ''}" type="button" data-icon="${x}">${x}</button>`
            )
            .join('')}
        </div>
      </div>
      <div class="field" id="evTypeField">
        <span class="field__label">类型</span>
        <div class="chips" id="evType" style="margin-top:0;padding-top:0">
          <button class="chip${yearly ? ' is-on' : ''}" type="button" data-yearly="1">每年重复</button>
          <button class="chip${yearly ? '' : ' is-on'}" type="button" data-yearly="0">仅一次</button>
        </div>
      </div>
      <button class="btn btn--primary btn--block" type="button" data-act="save-event">${
        editing ? '保存修改' : '添加'
      }</button>
    `;

    const body = UI.openSheet(html);
    const $ = (sel) => body.querySelector(sel);

    // 年份下拉默认当前年（编辑时沿用原来的年份）
    $('#evLunarYear').value = String((ev && ev.lunarYear) || new Date().getFullYear());

    // 编辑时把原来的农历月/日填回下拉
    if (calendar === 'lunar') {
      $('#evLunarMonth').value = String((ev && ev.lunarMonth) || 8);
      $('#evLunarDay').value = String((ev && ev.lunarDay) || 15);
    }

    function updateLunarHint() {
      const el = $('#evLunarHint');
      if (!el) return;
      const lm = Number($('#evLunarMonth').value);
      const ld = Number($('#evLunarDay').value);
      const ly = Number($('#evLunarYear').value) || new Date().getFullYear();

      // 仅一次：按选定的农历年份算具体公历日期
      if (!yearly) {
        const s = Lunar.solarOfLunarYear(ly, lm, ld, false);
        if (!s) {
          el.textContent = '这个农历日期不存在，换一个试试';
          return;
        }
        const days = UI.daysBetween(new Date(), new Date(s.y, s.m - 1, s.d));
        el.textContent =
          ly +
          ' 年农历' +
          Lunar.format(lm, ld, false) +
          ' → 公历 ' +
          s.y +
          ' 年 ' +
          s.m +
          ' 月 ' +
          s.d +
          ' 日' +
          (days > 0 ? '（还有 ' + days + ' 天）' : days === 0 ? '（就是今天）' : '（已过去）');
        return;
      }

      const nx = Lunar.nextOccurrence(lm, ld, false, new Date());
      if (!nx) {
        el.textContent = '这个日期暂时算不出来，换一个试试';
        return;
      }
      const days = UI.daysBetween(new Date(), new Date(nx.y, nx.m - 1, nx.d));
      const thisYear = new Date().getFullYear();
      el.textContent =
        '农历' +
        Lunar.format(lm, ld, false) +
        ' → 今年是 ' +
        nx.y +
        ' 年 ' +
        nx.m +
        ' 月 ' +
        nx.d +
        ' 日' +
        (days > 0 ? '（还有 ' + days + ' 天）' : days === 0 ? '（就是今天）' : '') +
        (yearly && ly !== thisYear ? '；年份仅作记录，每年都按这个农历日提醒' : '');
    }

    /* 年份始终显示：生日时作记录用，「仅一次」时决定具体日期 */
    function syncLunarYear() {
      const sel = $('#evLunarYear');
      if (sel) sel.hidden = false;
    }

    function applyCalendar() {
      const isLunar = calendar === 'lunar';
      $('#evSolarField').hidden = isLunar;
      $('#evLunarField').hidden = !isLunar;
      syncLunarYear();
      updateLunarHint();
    }

    applyCalendar();

    body.addEventListener('change', (e) => {
      if (
        e.target.closest('#evLunarYear') ||
        e.target.closest('#evLunarMonth') ||
        e.target.closest('#evLunarDay')
      ) {
        updateLunarHint();
      }
    });

    body.addEventListener('click', (e) => {
      const cal = e.target.closest('[data-cal]');
      if (cal) {
        calendar = cal.dataset.cal;
        UI.$$('#evCal .chip').forEach((b) => b.classList.toggle('is-on', b === cal));
        applyCalendar();
        return;
      }
      const ic = e.target.closest('[data-icon]');
      if (ic) {
        icon = ic.dataset.icon;
        UI.$$('#evIcons .chip').forEach((b) => b.classList.toggle('is-on', b === ic));
        return;
      }
      const ty = e.target.closest('[data-yearly]');
      if (ty) {
        yearly = ty.dataset.yearly === '1';
        UI.$$('#evType .chip').forEach((b) => b.classList.toggle('is-on', b === ty));
        syncLunarYear();
        updateLunarHint();
        return;
      }

      const save = e.target.closest('[data-act="save-event"]');
      if (!save) return;

      const name = $('#evName').value.trim();
      if (!name) {
        UI.toast('给它起个名字吧');
        return;
      }

      const nextEvent = Object.assign({}, ev || {}, {
        id: (ev && ev.id) || UI.uid(),
        name: name,
        icon: icon,
        yearly: yearly
      });

      if (calendar === 'lunar') {
        const lm = Number($('#evLunarMonth').value);
        const ld = Number($('#evLunarDay').value);
        const ly = Number($('#evLunarYear').value) || new Date().getFullYear();
        let dateStr = UI.todayStr();

        if (yearly) {
          const nx = Lunar.nextOccurrence(lm, ld, false, new Date());
          if (nx) dateStr = nx.y + '-' + UI.pad2(nx.m) + '-' + UI.pad2(nx.d);
        } else {
          const s = Lunar.solarOfLunarYear(ly, lm, ld, false);
          if (s) dateStr = s.y + '-' + UI.pad2(s.m) + '-' + UI.pad2(s.d);
        }

        Object.assign(nextEvent, {
          calendar: 'lunar',
          lunarYear: ly,
          lunarMonth: lm,
          lunarDay: ld,
          lunarIsLeap: false,
          yearly: yearly,
          date: dateStr
        });
      } else {
        const date = $('#evDate').value;
        if (!date) {
          UI.toast('选一个日期');
          return;
        }
        nextEvent.date = date;
        nextEvent.calendar = 'solar';
        delete nextEvent.lunarMonth;
        delete nextEvent.lunarDay;
        delete nextEvent.lunarIsLeap;
      }

      const all = Store.getProfile().events || [];
      const next = editing
        ? all.map((x) => (x.id === nextEvent.id ? nextEvent : x))
        : all.concat([nextEvent]);

      save.disabled = true;
      Store.saveProfile({ events: next })
        .then(() => {
          UI.closeSheet();
          openEvents();
          render();
          UI.toast(calendar === 'lunar' ? '已保存，以后每年按农历提醒' : '已保存');
        })
        .catch(() => {
          save.disabled = false;
          UI.toast('保存失败，稍后再试');
        });
    });
  }

  /* ---------------- 灯箱 ---------------- */

  const LB = { list: [], idx: 0, caption: '' };

  async function showLightbox(dir) {
    const item = LB.list[LB.idx];
    if (!item) return;
    const url = await Store.getImageURL(item.ref);
    const lb = document.getElementById('lightbox');
    const img = document.getElementById('lbImg');
    img.src = url || '';
    if (dir) {
      // 带方向感的滑入动画：下一张从右进，上一张从左进
      img.classList.remove('lb-from-right', 'lb-from-left');
      void img.offsetWidth;
      img.classList.add(dir > 0 ? 'lb-from-right' : 'lb-from-left');
    }
    document.getElementById('lbCaption').textContent =
      (item.date ? UI.formatDate(item.date) + ' · ' : '') +
      (LB.list.length > 1 ? `${LB.idx + 1} / ${LB.list.length}` : '');
    lb.hidden = false;
  }

  function openLightbox(list, idx) {
    LB.list = list;
    LB.idx = idx;
    showLightbox();
  }

  function stepLightbox(delta) {
    if (LB.list.length < 2) return;
    LB.idx = (LB.idx + delta + LB.list.length) % LB.list.length;
    showLightbox(delta);
  }

  function closeLightbox() {
    document.getElementById('lightbox').hidden = true;
    document.getElementById('lbImg').removeAttribute('src');
  }

  /* 照片滑动浏览：手机左右滑、桌面按住拖拽，都能切换上一张/下一张 */
  function bindLightboxGestures() {
    const lb = document.getElementById('lightbox');
    if (!lb || lb.dataset.gestures) return;
    lb.dataset.gestures = '1';

    let startX = 0;
    let startY = 0;
    let tracking = false;

    lb.addEventListener(
      'touchstart',
      (e) => {
        if (!e.touches || !e.touches.length) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        tracking = true;
      },
      { passive: true }
    );

    lb.addEventListener(
      'touchend',
      (e) => {
        if (!tracking) return;
        tracking = false;
        const t = (e.changedTouches && e.changedTouches[0]) || null;
        if (!t) return;
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        // 横向滑超过 50px、且明显比纵向大，才算一次切换
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) {
          stepLightbox(dx < 0 ? 1 : -1);
        }
      },
      { passive: true }
    );

    // 桌面端按住拖拽
    let mouseDown = false;
    let mouseStartX = 0;
    lb.addEventListener('mousedown', (e) => {
      mouseDown = true;
      mouseStartX = e.clientX;
    });
    window.addEventListener('mouseup', (e) => {
      if (!mouseDown) return;
      mouseDown = false;
      if (lb.hidden) return;
      const dx = e.clientX - mouseStartX;
      if (Math.abs(dx) > 80) stepLightbox(dx < 0 ? 1 : -1);
    });
  }

  function recordShots(rec) {
    return (rec.images || []).map((ref) => ({ ref: ref, date: rec.date }));
  }

  /* ---------------- 备份 ---------------- */

  async function exportBackup() {
    try {
      const data = await Store.exportAll();
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `我们的小日子-备份-${UI.todayStr()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      UI.toast('备份已导出');
    } catch (err) {
      UI.toast('导出失败：' + (err.message || ''));
    }
  }

  function importBackup() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        const ok = await UI.confirm('导入会覆盖当前所有记录，确定继续吗？');
        if (!ok) return;
        await Store.importAll(json);
        UI.closeSheet();
        render();
        UI.toast('导入完成 ❤');
      } catch (err) {
        UI.toast('导入失败：' + (err.message || '文件格式错误'));
      }
    });
    input.click();
  }

  /* 账号安全：密码 / 密保问题 / 恢复码 */
  function openSecurity() {
    const me = Store.getMe() || {};
    const q = me.question || '（未设置）';
    const questions = [
      '我们在一起的日子是？',
      'TA 的生日是哪一天？',
      '我们第一次看的电影是？',
      '第一次约会去的地方是？',
      '我们第一次一起吃的是什么？'
    ];

    const html = `
      <div class="sheet__title">
        <span>账号安全</span>
        <button class="mini-btn" type="button" data-act="close-sheet">✕</button>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="event-row">
          <div class="event-row__icon">👤</div>
          <div class="event-row__main">
            <div class="event-row__name">${UI.escapeHtml(me.username || '')}</div>
            <div class="event-row__date">密保问题：${UI.escapeHtml(q)}</div>
            <div class="event-row__date">${me.email ? '邮箱：' + UI.escapeHtml(me.email) : '邮箱：未绑定'}</div>
          </div>
        </div>
      </div>

      <div class="field">
        <span class="field__label">${me.email ? '更换绑定邮箱' : '绑定邮箱'}（绑定后可用邮箱登录）</span>
        <input class="input" id="emEmail" type="email" maxlength="60" placeholder="you@example.com"
               value="${UI.escapeHtml(me.email || '')}" style="margin-bottom:8px" />
        <div class="row" style="align-items:center;margin-bottom:8px">
          <input class="input" id="emCode" type="text" inputmode="numeric" maxlength="6" placeholder="邮箱验证码" />
          <button class="btn btn--ghost btn--sm" id="actSendBindMail" type="button" style="flex:none;white-space:nowrap">获取验证码</button>
        </div>
        <input class="input" id="emPassword" type="password" maxlength="32" placeholder="解绑邮箱时需要密码" />
      </div>
      <div class="row" style="margin-top:6px">
        ${
          me.email
            ? '<button class="btn btn--ghost btn--sm" type="button" data-act="unbind-email">解绑邮箱</button>'
            : ''
        }
        <button class="btn btn--primary btn--sm" type="button" data-act="save-email">确认绑定</button>
      </div>

      <div class="field">
        <span class="field__label">① 修改密码</span>
        <input class="input" id="cpOld" type="password" maxlength="32" placeholder="原密码" style="margin-bottom:8px" />
        <input class="input" id="cpNew" type="password" maxlength="32" placeholder="新密码（至少 6 位）" style="margin-bottom:8px" />
        <input class="input" id="cpNew2" type="password" maxlength="32" placeholder="再输入一次新密码" />
      </div>
      <button class="btn btn--ghost btn--block btn--sm" type="button" data-act="save-pwd">保存新密码</button>

      <div class="field" style="margin-top:22px">
        <span class="field__label">② 修改密保问题</span>
        <div class="chips" id="secQuestions" style="margin:0 0 8px;padding:0">
          ${questions
            .map(
              (x) =>
                `<button class="chip" type="button" data-secq="${UI.escapeHtml(x)}">${UI.escapeHtml(x)}</button>`
            )
            .join('')}
        </div>
        <input class="input" id="secQuestion" maxlength="60" placeholder="或自己写一个问题" style="margin-bottom:8px" />
        <input class="input" id="secAnswer" maxlength="40" placeholder="新的密保答案" style="margin-bottom:8px" />
        <input class="input" id="secPassword" type="password" maxlength="32" placeholder="输入登录密码以确认" />
      </div>
      <button class="btn btn--ghost btn--block btn--sm" type="button" data-act="save-security">保存密保问题</button>

      <div class="field" style="margin-top:22px">
        <span class="field__label">③ 重新生成恢复码</span>
        <input class="input" id="recPassword" type="password" maxlength="32" placeholder="输入登录密码" />
      </div>
      <button class="btn btn--ghost btn--block btn--sm" type="button" data-act="regen-recovery">生成新的恢复码</button>

      <div class="drop-hint" style="margin-top:16px">
        忘记密码时：在登录页点「忘记密码」，答对密保问题即可重设；<br/>答不上来时用恢复码。
      </div>
    `;

    const body = UI.openSheet(html);
    let picked = '';

    body.addEventListener('click', async (e) => {
      const qChip = e.target.closest('[data-secq]');
      if (qChip) {
        picked = qChip.dataset.secq;
        UI.$$('#secQuestions .chip').forEach((b) => b.classList.toggle('is-on', b === qChip));
        body.querySelector('#secQuestion').value = '';
        return;
      }

      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;

      if (act === 'send-bind-mail') {
        const email = body.querySelector('#emEmail').value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return UI.toast('请先填写正确的邮箱');
        btn.disabled = true;
        btn.textContent = '发送中…';
        try {
          const res = await Cloud.api.sendEmailCode(email, 'bind');
          const codeInput = body.querySelector('#emCode');
          if (res && res.devCode) {
            UI.toast('演示模式验证码：' + res.devCode);
            if (codeInput) codeInput.value = res.devCode;
          } else {
            UI.toast('验证码已发送，请查收邮件');
          }
          let n = 60;
          btn.textContent = n + ' 秒后重发';
          const timer = setInterval(() => {
            n--;
            if (n <= 0) {
              clearInterval(timer);
              btn.disabled = false;
              btn.textContent = '获取验证码';
              return;
            }
            btn.textContent = n + ' 秒后重发';
          }, 1000);
        } catch (err) {
          btn.disabled = false;
          btn.textContent = '获取验证码';
          UI.toast(err.message || '发送失败');
        }
        return;
      }

      if (act === 'save-email') {
        const email = body.querySelector('#emEmail').value.trim();
        const code = body.querySelector('#emCode').value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return UI.toast('邮箱格式看起来不太对');
        if (!/^\d{6}$/.test(code)) return UI.toast('请填写邮箱收到的 6 位验证码');
        btn.disabled = true;
        btn.textContent = '提交中…';
        try {
          await Cloud.api.bindEmail(email, code);
          await Store.sync();
          UI.closeSheet();
          openSecurity();
          UI.toast('邮箱已绑定 ❤');
        } catch (err) {
          btn.disabled = false;
          btn.textContent = '确认绑定';
          UI.toast(err.message || '绑定失败');
        }
        return;
      }

      if (act === 'unbind-email') {
        const password = body.querySelector('#emPassword').value;
        if (!password) return UI.toast('请输入登录密码');
        btn.disabled = true;
        btn.textContent = '提交中…';
        try {
          await Cloud.api.unbindEmail(password);
          await Store.sync();
          UI.closeSheet();
          openSecurity();
          UI.toast('已解绑邮箱');
        } catch (err) {
          btn.disabled = false;
          btn.textContent = '解绑邮箱';
          UI.toast(err.message || '解绑失败');
        }
        return;
      }

      if (act === 'save-pwd') {
        const oldPwd = body.querySelector('#cpOld').value;
        const pwd = body.querySelector('#cpNew').value;
        const pwd2 = body.querySelector('#cpNew2').value;
        if (String(pwd).length < 6) return UI.toast('新密码至少 6 位');
        if (pwd !== pwd2) return UI.toast('两次输入的新密码不一样');
        btn.disabled = true;
        btn.textContent = '提交中…';
        try {
          await Cloud.api.changePassword(oldPwd, pwd);
          UI.closeSheet();
          UI.toast('密码已修改 ❤');
        } catch (err) {
          btn.disabled = false;
          btn.textContent = '保存新密码';
          UI.toast(err.message || '修改失败');
        }
        return;
      }

      if (act === 'save-security') {
        const question = body.querySelector('#secQuestion').value.trim() || picked;
        const answer = body.querySelector('#secAnswer').value.trim();
        const password = body.querySelector('#secPassword').value;
        if (!question) return UI.toast('请选择或填写密保问题');
        if (answer.length < 2) return UI.toast('密保答案至少 2 个字符');
        if (!password) return UI.toast('请输入登录密码');
        btn.disabled = true;
        btn.textContent = '提交中…';
        try {
          await Cloud.api.updateSecurity(password, question, answer);
          UI.closeSheet();
          openSecurity();
          UI.toast('密保问题已更新 ❤');
        } catch (err) {
          btn.disabled = false;
          btn.textContent = '保存密保问题';
          UI.toast(err.message || '修改失败');
        }
        return;
      }

      if (act === 'regen-recovery') {
        const password = body.querySelector('#recPassword').value;
        if (!password) return UI.toast('请输入登录密码');
        btn.disabled = true;
        btn.textContent = '生成中…';
        try {
          const res = await Cloud.api.regenerateRecovery(password);
          UI.closeSheet();
          UI.openSheet(`
            <div class="sheet__title">
              <span>新的恢复码</span>
              <button class="mini-btn" type="button" data-act="close-sheet">✕</button>
            </div>
            <div class="invite" data-act="copy-code2">
              <div class="invite__label">恢复码（旧的已失效）</div>
              <div class="invite__code" style="font-size:22px;letter-spacing:3px">${UI.escapeHtml(res.recoveryCode)}</div>
              <div class="invite__hint">点击复制</div>
            </div>
            <div class="drop-hint" style="margin-top:14px">建议截图保存，忘记密码又答不上密保问题时要用它。</div>
          `);
          const sheet = document.getElementById('sheetBody');
          sheet.addEventListener('click', (ev) => {
            if (!ev.target.closest('[data-act="copy-code2"]')) return;
            if (navigator.clipboard) {
              navigator.clipboard.writeText(res.recoveryCode).then(
                () => UI.toast('已复制'),
                () => UI.toast('请长按恢复码复制')
              );
            }
          });
        } catch (err) {
          btn.disabled = false;
          btn.textContent = '生成新的恢复码';
          UI.toast(err.message || '生成失败');
        }
      }
    });
  }

  function inviteLink(code) {
    return location.origin + location.pathname + '?code=' + code;
  }

  /* 二维码库偶尔没加载上（缓存/时序）时动态补一次 */
  function ensureQrLib() {
    if (typeof qrcode === 'function') return Promise.resolve(true);
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/qrcode.js';
      s.onload = () => resolve(typeof qrcode === 'function');
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }

  async function showInviteQR() {
    const p = Store.getProfile();
    const code = p.code;
    if (!code) return UI.toast('还没有邀请码');
    const ok = await ensureQrLib();
    if (!ok) return UI.toast('二维码组件加载失败，请刷新页面重试');

    let dataUrl = '';
    try {
      const qr = qrcode(0, 'M');
      qr.addData(inviteLink(code));
      qr.make();
      dataUrl = qr.createDataURL(10, 4);
    } catch (err) { /* 生成失败则只展示邀请码 */ }

    const joined = (p.members || []).length >= 2;
    const body = UI.openSheet(`
      <div class="sheet__title">
        <span>邀请 TA 加入</span>
        <button class="mini-btn" type="button" data-act="close-sheet">✕</button>
      </div>
      <div class="card qr-card">
        ${dataUrl ? '<img class="qr-img" src="' + dataUrl + '" alt="邀请二维码" />' : ''}
        <div style="font-size:26px;font-weight:800;letter-spacing:6px;margin-top:10px">${UI.escapeHtml(code)}</div>
        <div class="drop-hint" style="margin-top:10px">TA 用相机 / 微信「扫一扫」上面的码，<br/>打开 App 就会自动填好邀请码</div>
      </div>
      <div class="row" style="gap:10px;margin-top:12px">
        <button class="btn btn--ghost" type="button" data-qr="link" style="flex:1">复制链接</button>
        <button class="btn btn--ghost" type="button" data-qr="code" style="flex:1">复制邀请码</button>
      </div>
      <p class="record__note">${joined ? '✔ TA 已经加入了，你们正在共享同一本。' : '每个本子仅限你们两个人加入，人满后邀请码自动失效。'}TA 登录后点「用邀请码加入」或直接扫码即可。</p>
    `);
    body.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-qr]');
      if (!btn) return;
      const text = btn.dataset.qr === 'link' ? inviteLink(code) : code;
      try {
        await navigator.clipboard.writeText(text);
        UI.toast(btn.dataset.qr === 'link' ? '邀请链接已复制' : '邀请码已复制：' + code);
      } catch (err) {
        UI.toast('复制失败，请截图发给 TA');
      }
    });
  }

  async function copyInviteCode() {
    const code = Store.getProfile().code;
    if (!code) return UI.toast('还没有邀请码');
    try {
      await navigator.clipboard.writeText(code);
      UI.toast('邀请码已复制：' + code);
    } catch (err) {
      UI.openSheet(`
        <div class="sheet__title">
          <span>邀请码</span>
          <button class="mini-btn" type="button" data-act="close-sheet">✕</button>
        </div>
        <div class="card" style="text-align:center;padding:22px 16px">
          <div style="font-size:30px;font-weight:800;letter-spacing:6px">${UI.escapeHtml(code)}</div>
          <div class="drop-hint" style="margin-top:12px">长按上面的邀请码复制，发给 TA</div>
        </div>
        <p class="record__note">TA 打开 App → 用手机号登录 → 点「用邀请码加入」→ 输入这 6 位，就能一起写同一本啦。</p>
      `);
    }
  }

  async function clearAll() {
    const ok = await UI.confirm('清空本机缓存并回到登录页？（云端记录不会被删除）');
    if (!ok) return;
    Store.clearLocal();
    AuthView.show();
    UI.toast('已清空本机数据');
  }

  /* ---------------- 安装到手机桌面 ---------------- */

  let installPrompt = null;

  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  /* 是否已经在 App 里打开（装了安卓包或加到桌面后全屏运行） */
  function isAppMode() {
    try {
      if (/Capacitor/i.test(navigator.userAgent)) return true;
      if (navigator.standalone === true) return true;
      return window.matchMedia('(display-mode: standalone)').matches;
    } catch (err) {
      return false;
    }
  }

  /* 下载安卓安装包（安装包会随每次发布自动更新到同一地址） */
  function downloadApk() {
    const url = './chaomu.apk';
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = 'chaomu.apk';
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      // 稍后再移除，避免浏览器还没来得及开始下载就找不到元素
      setTimeout(() => {
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 4000);
      UI.toast('开始下载安装包…');
    } catch (err) {
      location.href = url;
    }
  }

  function showInstallGuide() {
    const steps = isIOS()
      ? ['用 <b>Safari</b> 打开本页', '点击底部工具栏的<b>分享</b>按钮 <b>⎋</b>', '选择「<b>添加到主屏幕</b>」', '点击右上角「<b>添加</b>」，完成！']
      : ['用 <b>Chrome</b> 打开本页', '点击右上角 <b>⋮</b> 菜单', '选择「<b>添加到主屏幕</b>」或「<b>安装应用</b>」', '确认后就会出现在桌面上'];
    const html = `
      <div class="sheet__title">
        <span>添加到手机桌面</span>
        <button class="mini-btn" type="button" data-act="close-sheet">✕</button>
      </div>
      <div class="card" style="margin-bottom:16px">
        ${steps.map((s, i) => `<div class="event-row"><div class="event-row__icon">${i + 1}</div><div class="event-row__main"><div class="event-row__name">${s}</div></div></div>`).join('')}
      </div>
      <div class="drop-hint">添加后就像普通 App 一样：有图标、全屏打开、没有网址栏。</div>
    `;
    UI.openSheet(html);
  }

  function tryInstall() {
    if (installPrompt) {
      const p = installPrompt;
      installPrompt = null;
      p.prompt();
      p.userChoice.then((r) => {
        if (r && r.outcome === 'accepted') UI.toast('已添加到桌面 ❤');
        render();
      });
    } else if (isIOS() || !window.matchMedia('(display-mode: standalone)').matches) {
      showInstallGuide();
    }
  }

  /* 强制拉取最新版本：清掉离线缓存与 Service Worker 后重新加载 */
  async function forceUpdate() {
    UI.toast('正在检查更新…');
    try {
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch (err) {
      /* 忽略 */
    }
    location.reload();
  }

  function bindInstallEvents() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      installPrompt = e;
      render();
    });
    window.addEventListener('appinstalled', () => {
      installPrompt = null;
      UI.toast('已添加到桌面 ❤');
      render();
    });
  }

  function registerSW() {
    const secure =
      location.protocol === 'https:' ||
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1';
    if (!('serviceWorker' in navigator) || !secure) return;

    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        // 发现新版本并激活后，自动刷新一次，省得用户手动清缓存
        const reloadOnce = () => {
          if (!navigator.serviceWorker.controller) return;
          if (sessionStorage.getItem('ld:sw-reloaded') === '1') return;
          sessionStorage.setItem('ld:sw-reloaded', '1');
          location.reload();
        };
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'activated') reloadOnce();
          });
        });
        // 已经处于等待中的更新，也直接生效
        if (reg.waiting && navigator.serviceWorker.controller) reloadOnce();
      })
      .catch(() => {
        /* 离线缓存不可用时静默降级 */
      });
  }

  /* ---------------- 应用入口 ---------------- */

  function enterApp() {
    document.documentElement.classList.remove('is-guest');
    document.getElementById('view-auth').hidden = true;
    state.tab = 'home';
    render();
    startMissPoll();
  }

  function reset() {
    document.documentElement.classList.add('is-guest');
    stopMissPoll();
  }

  async function refresh() {
    try {
      await Store.sync();
      render();
      UI.toast('已同步最新 ❤');
    } catch (err) {
      UI.toast(err.message || '同步失败');
    }
  }

  window.App = {
    enterApp: enterApp,
    reset: reset,
    refresh: refresh
  };

  /* ---------------- 事件绑定 ---------------- */

  function bindGlobal() {
    UI.$$('.tab').forEach((btn) =>
      btn.addEventListener('click', () => switchTab(btn.dataset.tab))
    );

    document.getElementById('fabAdd').addEventListener('click', () => openCompose(null));

    document.getElementById('btnTheme').addEventListener('click', () => {
      const p = Store.getProfile();
      Store.saveProfile({ theme: (p.theme || 'light') === 'dark' ? 'light' : 'dark' }).catch(() => {});
      render();
    });

    document.getElementById('backdrop').addEventListener('click', () => {
      if (state.onboarding) return;
      UI.closeSheet();
    });

    document.getElementById('lbClose').addEventListener('click', closeLightbox);
    document.getElementById('lbPrev').addEventListener('click', () => stepLightbox(-1));
    document.getElementById('lbNext').addEventListener('click', () => stepLightbox(1));
    document.getElementById('lightbox').addEventListener('click', (e) => {
      if (e.target.id === 'lightbox') closeLightbox();
    });

    document.addEventListener('keydown', (e) => {
      if (!document.getElementById('lightbox').hidden) {
        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'ArrowLeft') stepLightbox(-1);
        if (e.key === 'ArrowRight') stepLightbox(1);
        return;
      }
      if (e.key === 'Escape' && UI.isSheetOpen() && !state.onboarding) UI.closeSheet();
    });

    // 全局粘贴上传（撰写中时生效）
    document.addEventListener('paste', (e) => {
      if (!state.drafting) return;
      const items = (e.clipboardData && e.clipboardData.items) || [];
      const files = [];
      for (const it of items) {
        if (it.kind === 'file') {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        e.preventDefault();
        handlePasteFiles(files);
      }
    });

    // 照片滑动浏览手势
    bindLightboxGestures();

    // 主区域交互
    document.getElementById('main').addEventListener('click', onMainClick);
    document.getElementById('main').addEventListener('input', onMainInput);
  }

  async function handlePasteFiles(files) {
    const remain = 9 - state.drafting.images.length;
    if (remain <= 0) return;
    const refs = await Store.addImages(files.slice(0, remain));
    refs.forEach((r) => {
      if (r.data) previewCache.set(r.id, r.data);
    });
    state.drafting.images = state.drafting.images.concat(refs);
    renderThumbs();
    UI.toast(`已粘贴 ${refs.length} 张照片`);
  }

  async function onMainClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;

    if (act === 'new') return openCompose(null);
    if (act === 'go') return switchTab(el.dataset.tab);
    if (act === 'settings') return openSettings();
    if (act === 'events') return openEvents();
    if (act === 'export') return exportBackup();
    if (act === 'install') return tryInstall();
    if (act === 'download-apk') return downloadApk();
    if (act === 'send-miss') return sendMiss();
    if (act === 'decide') return openDecision();
    if (act === 'daily-open') return openDailyAnswer();
    if (act === 'daily-history') return openDailyHistory();
    if (act === 'wishes') return openWishes();
    if (act === 'play-voice') return playVoice(el);
    if (act === 'like') return toggleLike(el.dataset.id, el);
    if (act === 'comments') return openComments(el.dataset.id);
    if (act === 'force-update') return forceUpdate();
    if (act === 'import') return importBackup();
    if (act === 'clear') return clearAll();
    if (act === 'logout') return AuthView.signOut();
    if (act === 'security') return openSecurity();
    if (act === 'backup') return openBackupSheet();
    if (act === 'copy-code') return copyInviteCode();
    if (act === 'show-qr') return showInviteQR();
    if (act === 'sync') return refresh();
    if (act === 'mood') {
      state.mood = el.dataset.val;
      return render();
    }
    if (act === 'close-sheet') return UI.closeSheet();
    if (act === 'tag') {
      state.tag = el.dataset.val;
      return render();
    }
    if (act === 'clear-query') {
      state.query = '';
      return render();
    }
    if (act === 'edit') {
      const rec = Store.getRecord(el.dataset.id);
      if (rec) openCompose(rec);
      return;
    }
    if (act === 'del') {
      const ok = await UI.confirm('删除这条记录吗？照片也会一起删除。');
      if (!ok) return;
      Store.removeRecord(el.dataset.id);
      render();
      UI.toast('已删除');
      return;
    }
    if (act === 'view') {
      const rec = Store.getRecord(el.dataset.id);
      if (!rec) return;
      openLightbox(recordShots(rec), Number(el.dataset.idx || 0));
      return;
    }
    if (act === 'shot') {
      const idx = Number(el.dataset.idx || 0);
      const all = [];
      Store.listRecords().forEach((r) => recordShots(r).forEach((s) => all.push(s)));
      openLightbox(all, idx);
    }
  }

  const onMainInput = UI.debounce((e) => {
    if (e.target && e.target.id === 'searchInput') {
      const val = e.target.value;
      if (val === state.query) return;
      state.query = val;
      const pos = e.target.selectionStart;
      const view = document.getElementById('view-timeline');
      view.innerHTML = renderTimeline();
      const input = document.getElementById('searchInput');
      if (input) {
        input.focus();
        try { input.setSelectionRange(pos, pos); } catch (err) { /* 忽略 */ }
      }
      hydrateImages(view);
    }
  }, 220);

  /* ---------------- 启动 ---------------- */

  document.addEventListener('DOMContentLoaded', async () => {
    bindGlobal();
    bindInstallEvents();
    registerSW();

    document.documentElement.classList.add('is-guest');
    try {
      await Store.init();
    } catch (err) {
      UI.toast('连接云端失败，已进入离线只读模式');
    }

    if (Store.isSignedIn() && Store.getBook()) {
      enterApp();
      handleLaunchParams();
    } else {
      AuthView.show();
    }
  });

  /* 支持从桌面快捷方式直接进入某个功能：?action=new 写记录 / ?tab=album 相册 */
  function handleLaunchParams() {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    const action = params.get('action');
    if (tab) switchTab(tab);
    if (action === 'new') setTimeout(() => openCompose(null), 600);
    if (tab || action) {
      try {
        history.replaceState(null, '', location.pathname);
      } catch (err) { /* 忽略 */ }
    }
  }
})();
