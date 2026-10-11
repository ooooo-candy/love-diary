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
    const imgs = UI.$$('img[data-ref]', root || document);
    await Promise.all(
      imgs.map(async (img) => {
        if (img.getAttribute('src')) return;
        const ref = map.get(img.dataset.ref);
        if (!ref) return;
        const url = await resolveURL(ref);
        if (url) img.src = url;
      })
    );
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
          icon: '🎂',
          isToday: false
        });
      }
    }

    (p.events || []).forEach((ev) => {
      if (!ev || !ev.date) return;
      const src = UI.parseDate(ev.date);
      let year = today.getFullYear();
      if (!ev.yearly) {
        const target = UI.parseDate(ev.date);
        const diff = UI.daysBetween(today, target);
        if (diff < 0) return;
        events.push({
          id: ev.id,
          name: ev.name,
          date: ev.date,
          icon: ev.icon || '📅',
          raw: diff
        });
        return;
      }
      let next = new Date(year, src.getMonth(), src.getDate());
      const cur = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      if (next < cur) next = new Date(year + 1, src.getMonth(), src.getDate());
      events.push({
        id: ev.id,
        name: ev.name,
        date: next.getFullYear() + '-' + UI.pad2(next.getMonth() + 1) + '-' + UI.pad2(next.getDate()),
        icon: ev.icon || '📅'
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
                <div class="event-row__date">${UI.formatDateShort(ev.date)}</div>
              </div>
              <div class="event-row__count">${txt}</div>
            </div>`;
          })
          .join('')
      : `<div class="empty__desc" style="padding:8px 0">还没有设置重要日子，去「我们」页添加吧</div>`;

    const latest = records.slice(0, 3);

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
        ${grid}
        ${tags ? `<div class="record__tags">${tags}</div>` : ''}
      </article>`;
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

  /* 情侣本卡片：账号 + 邀请码 */
  function bookCardHtml() {
    const p = Store.getProfile();
    const me = Store.getMe() || {};
    const account = [me.username, me.email].filter(Boolean).join(' · ');
    const joined = (p.members || []).length >= 2;

    return `
      <div class="section" style="margin-top:0">
        <div class="card">
          <div class="event-row">
            <div class="event-row__icon">👤</div>
            <div class="event-row__main">
              <div class="event-row__name">${UI.escapeHtml(me.nickname || account || '未登录')}</div>
              <div class="event-row__date">${
                (account ? '账号：' + UI.escapeHtml(account) + ' · ' : '') +
                (Cloud.isOnline() ? '已同步到云端，换手机登录也能看到' : '本地演示模式，数据只存在这台设备')
              }</div>
            </div>
            <button class="btn btn--ghost btn--sm" type="button" data-act="logout" style="flex:none">退出</button>
          </div>

          <div class="invite" data-act="copy-code">
            <div class="invite__label">情侣本邀请码</div>
            <div class="invite__code">${UI.escapeHtml(p.code || '------')}</div>
            <span class="invite__hint">点击复制，发给 TA 就能一起写同一本</span>
          </div>
          <div class="setting-row__hint" style="margin-top:10px">
            ${joined ? '✔ TA 已经加入了，你们正在共享同一本记录' : '还没有人加入，等 TA 用邀请码进来'}
          </div>
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
        <div class="section__head"><div class="section__title">设置与备份</div></div>
        <div class="card">
          <div class="setting-row">
            <div class="setting-row__main">
              <div class="setting-row__label">我们的资料</div>
              <div class="setting-row__hint">昵称、头像、在一起的日子</div>
            </div>
            <button class="btn btn--ghost btn--sm" type="button" data-act="settings">编辑</button>
          </div>
          <div class="setting-row">
            <div class="setting-row__main">
              <div class="setting-row__label">重要日子</div>
              <div class="setting-row__hint">纪念日、生日倒计时</div>
            </div>
            <button class="btn btn--ghost btn--sm" type="button" data-act="events">管理</button>
          </div>
          <div class="setting-row">
            <div class="setting-row__main">
              <div class="setting-row__label">导出备份</div>
              <div class="setting-row__hint">把全部记录和照片存成一个文件</div>
            </div>
            <button class="btn btn--ghost btn--sm" type="button" data-act="export">导出</button>
          </div>
          <div class="setting-row">
            <div class="setting-row__main">
              <div class="setting-row__label">导入备份</div>
              <div class="setting-row__hint">从之前导出的文件恢复</div>
            </div>
            <button class="btn btn--ghost btn--sm" type="button" data-act="import">导入</button>
          </div>
          <div class="setting-row">
            <div class="setting-row__main">
              <div class="setting-row__label">安装到手机桌面</div>
              <div class="setting-row__hint">${
                installPrompt
                  ? '一键安装，像原生 App 一样全屏打开、可离线使用'
                  : '像原生 App 一样全屏打开；iOS 点开后有分步指引'
              }</div>
            </div>
            <button class="btn btn--ghost btn--sm" type="button" data-act="install">安装</button>
          </div>
          <div class="setting-row">
            <div class="setting-row__main">
              <div class="setting-row__label">数据存储</div>
              <div class="setting-row__hint">${
                Cloud.isOnline()
                  ? '记录和照片保存在云端，登录即可在多台设备同步'
                  : '当前未连接云服务，数据只存在这台设备'
              }</div>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-row__main">
              <div class="setting-row__label">账号安全</div>
              <div class="setting-row__hint">修改密码、密保问题、恢复码</div>
            </div>
            <button class="btn btn--ghost btn--sm" type="button" data-act="security">管理</button>
          </div>
          <div class="setting-row">
            <div class="setting-row__main">
              <div class="setting-row__label">清空本机数据</div>
              <div class="setting-row__hint">清除这台设备上的缓存并回到登录页</div>
            </div>
            <button class="btn btn--ghost btn--sm" type="button" data-act="clear">清空</button>
          </div>
            </div>
          </div>
        </div>
      </div>
    `;
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
          <input class="input" id="fPlace" type="text" placeholder="比如：那家小面馆" value="${UI.escapeHtml(draft.place || '')}" />
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

      <div class="field">
        <span class="field__label">我的头像</span>
        <div class="upload-avatar">
          ${avatarHtml(p.myAvatar, p.myName)}
          <button class="btn btn--ghost btn--sm" type="button" data-act="avatar" data-who="myAvatar">上传</button>
          ${p.myAvatar ? '<button class="btn btn--ghost btn--sm" type="button" data-act="rm-avatar" data-who="myAvatar">移除</button>' : ''}
        </div>
      </div>
      <div class="field">
        <label class="field__label" for="sMyName">我的昵称</label>
        <input class="input" id="sMyName" value="${UI.escapeHtml(p.myName || '')}" />
      </div>

      <div class="field">
        <span class="field__label">TA 的头像</span>
        <div class="upload-avatar">
          ${avatarHtml(p.partnerAvatar, p.partnerName)}
          <button class="btn btn--ghost btn--sm" type="button" data-act="avatar" data-who="partnerAvatar">上传</button>
          ${p.partnerAvatar ? '<button class="btn btn--ghost btn--sm" type="button" data-act="rm-avatar" data-who="partnerAvatar">移除</button>' : ''}
        </div>
      </div>
      <div class="field">
        <label class="field__label" for="sPartnerName">TA 的昵称</label>
        <input class="input" id="sPartnerName" value="${UI.escapeHtml(p.partnerName || '')}" />
      </div>

      <div class="field">
        <label class="field__label" for="sAnniv">我们在一起的日子</label>
        <input class="input" id="sAnniv" type="date" value="${UI.escapeHtml(p.anniversary || UI.todayStr())}" />
      </div>

      <div class="field">
        <span class="field__label">主题色</span>
        <div class="palettes">${palettes}</div>
      </div>

      <div class="row" style="margin-top:18px">
        <button class="btn btn--ghost" type="button" data-act="close-sheet">取消</button>
        <button class="btn btn--primary" type="button" data-act="save-profile">保存</button>
      </div>
    `;

    const body = UI.openSheet(html);

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
      const av = e.target.closest('[data-act="avatar"]');
      if (av) {
        who = av.dataset.who;
        avatarInput.click();
        return;
      }
      const rm = e.target.closest('[data-act="rm-avatar"]');
      if (rm) {
        const key = rm.dataset.who;
        Store.saveProfile({ [key]: null }).then(() => {
          UI.closeSheet();
          openSettings();
          render();
        });
        return;
      }
      const pal = e.target.closest('[data-pal]');
      if (pal) {
        Store.saveProfile({ palette: pal.dataset.pal }).catch(() => {});
        UI.$$('.palette').forEach((b) => b.classList.toggle('is-on', b === pal));
        render();
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
      }
    });
  }

  /* ---------------- 重要日子 ---------------- */

  function openEvents() {
    const p = Store.getProfile();
    const events = p.events || [];
    const icons = ['🎂', '💍', '✈️', '🎁', '🍰', '💌', '🎬', '🌙'];

    const rows = events.length
      ? events
          .map((ev) => {
            const diff = UI.daysBetween(new Date(), UI.parseDate(ev.date));
            const txt = ev.yearly
              ? `已走过 ${Math.max(0, Math.floor((UI.daysBetween(UI.parseDate(ev.date), new Date())) / 365))} 年`
              : diff >= 0
              ? `还有 ${diff} 天`
              : '已过去';
            return `<div class="event-row">
              <div class="event-row__icon">${UI.escapeHtml(ev.icon || '📅')}</div>
              <div class="event-row__main">
                <div class="event-row__name">${UI.escapeHtml(ev.name)}</div>
                <div class="event-row__date">${UI.formatDateShort(ev.date)}${ev.yearly ? ' · 每年' : ''}</div>
              </div>
              <div class="event-row__count">${txt}</div>
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
      <div class="card" style="margin-bottom:16px">${rows}</div>

      <div class="field">
        <label class="field__label" for="evName">名称</label>
        <input class="input" id="evName" placeholder="比如：第一次看海 / TA 的生日" />
      </div>
      <div class="row">
        <div class="field">
          <label class="field__label" for="evDate">日期</label>
          <input class="input" id="evDate" type="date" value="${UI.todayStr()}" />
        </div>
        <div class="field">
          <span class="field__label">图标</span>
          <div class="chips" id="evIcons" style="margin-top:0;padding-top:0">
            ${icons
              .map(
                (x, i) =>
                  `<button class="chip${i === 0 ? ' is-on' : ''}" type="button" data-icon="${x}">${x}</button>`
              )
              .join('')}
          </div>
        </div>
      </div>
      <div class="field">
        <span class="field__label">类型</span>
        <div class="chips" id="evType" style="margin-top:0;padding-top:0">
          <button class="chip is-on" type="button" data-yearly="1">每年重复</button>
          <button class="chip" type="button" data-yearly="0">仅一次</button>
        </div>
      </div>
      <button class="btn btn--primary btn--block" type="button" data-act="add-event">添加</button>
    `;

    const body = UI.openSheet(html);
    let icon = icons[0];
    let yearly = true;

    body.addEventListener('click', (e) => {
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
        return;
      }
      const del = e.target.closest('[data-act="del-event"]');
      if (del) {
        const id = del.dataset.id;
        const next = (Store.getProfile().events || []).filter((x) => x.id !== id);
        Store.saveProfile({ events: next }).then(() => {
          UI.closeSheet();
          openEvents();
          render();
        });
        render();
        return;
      }
      const add = e.target.closest('[data-act="add-event"]');
      if (add) {
        const name = body.querySelector('#evName').value.trim();
        const date = body.querySelector('#evDate').value;
        if (!name) {
          UI.toast('给它起个名字吧');
          return;
        }
        if (!date) {
          UI.toast('选一个日期');
          return;
        }
        const nextEvent = { id: UI.uid(), name: name, date: date, icon: icon, yearly: yearly };
        Store.saveProfile({ events: (Store.getProfile().events || []).concat([nextEvent]) }).then(() => {
          UI.closeSheet();
          openEvents();
          render();
        });
        render();
        UI.toast('已添加');
      }
    });
  }

  /* ---------------- 灯箱 ---------------- */

  const LB = { list: [], idx: 0, caption: '' };

  async function showLightbox() {
    const item = LB.list[LB.idx];
    if (!item) return;
    const url = await Store.getImageURL(item.ref);
    const lb = document.getElementById('lightbox');
    const img = document.getElementById('lbImg');
    img.src = url || '';
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
    showLightbox();
  }

  function closeLightbox() {
    document.getElementById('lightbox').hidden = true;
    document.getElementById('lbImg').removeAttribute('src');
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
        <span class="field__label">绑定邮箱（之后可用邮箱登录）</span>
        <input class="input" id="emEmail" type="email" maxlength="60" placeholder="you@example.com"
               value="${UI.escapeHtml(me.email || '')}" style="margin-bottom:8px" />
        <input class="input" id="emPassword" type="password" maxlength="32" placeholder="输入登录密码以确认" />
      </div>
      <button class="btn btn--ghost btn--block btn--sm" type="button" data-act="save-email">保存邮箱</button>

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

      if (act === 'save-email') {
        const email = body.querySelector('#emEmail').value.trim();
        const password = body.querySelector('#emPassword').value;
        if (!password) return UI.toast('请输入登录密码');
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return UI.toast('邮箱格式看起来不太对');
        btn.disabled = true;
        btn.textContent = '提交中…';
        try {
          await Cloud.api.updateEmail(password, email);
          await Store.sync();
          UI.closeSheet();
          openSecurity();
          UI.toast(email ? '邮箱已绑定 ❤' : '已解绑邮箱');
        } catch (err) {
          btn.disabled = false;
          btn.textContent = '保存邮箱';
          UI.toast(err.message || '保存失败');
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
    if ('serviceWorker' in navigator && secure) {
      navigator.serviceWorker.register('./sw.js').catch(() => { /* 离线缓存不可用时静默降级 */ });
    }
  }

  /* ---------------- 应用入口 ---------------- */

  function enterApp() {
    document.documentElement.classList.remove('is-guest');
    document.getElementById('view-auth').hidden = true;
    state.tab = 'home';
    render();
  }

  function reset() {
    document.documentElement.classList.add('is-guest');
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
    if (act === 'import') return importBackup();
    if (act === 'clear') return clearAll();
    if (act === 'logout') return AuthView.signOut();
    if (act === 'security') return openSecurity();
    if (act === 'copy-code') return copyInviteCode();
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
