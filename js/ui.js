/* 通用 UI 工具 */
(function (global) {
  'use strict';

  const UI = {};

  UI.$ = (sel, root) => (root || document).querySelector(sel);
  UI.$$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  UI.uid = function () {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  };

  UI.escapeHtml = function (str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  };

  UI.pad2 = (n) => String(n).padStart(2, '0');

  UI.todayStr = function () {
    const d = new Date();
    return d.getFullYear() + '-' + UI.pad2(d.getMonth() + 1) + '-' + UI.pad2(d.getDate());
  };

  UI.parseDate = function (str) {
    const p = String(str).split('-').map(Number);
    return new Date(p[0], (p[1] || 1) - 1, p[2] || 1);
  };

  UI.daysBetween = function (a, b) {
    const MS = 86400000;
    const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((db - da) / MS);
  };

  UI.formatDate = function (str) {
    const d = UI.parseDate(str);
    const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · ${week}`;
  };

  UI.formatDateShort = function (str) {
    const d = UI.parseDate(str);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  };

  UI.relativeDay = function (str) {
    const diff = UI.daysBetween(UI.parseDate(str), new Date());
    if (diff === 0) return '今天';
    if (diff === 1) return '昨天';
    if (diff > 1 && diff < 7) return `${diff}天前`;
    if (diff >= 7 && diff < 30) return `${Math.floor(diff / 7)}周前`;
    if (diff >= 30) return `${Math.floor(diff / 30)}个月前`;
    if (diff === -1) return '明天';
    return `${Math.abs(diff)}天后`;
  };

  UI.toast = function (msg) {
    const box = document.getElementById('toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s ease, transform .3s ease';
      el.style.opacity = '0';
      el.style.transform = 'translateY(10px)';
      setTimeout(() => el.remove(), 320);
    }, 2000);
  };

  /* 底部弹层 */
  let sheetOnClose = null;

  UI.openSheet = function (html, opts) {
    opts = opts || {};
    const sheet = document.getElementById('sheet');
    const backdrop = document.getElementById('backdrop');
    // 每次换成全新的容器，避免上一次弹层的事件监听残留
    const oldBody = document.getElementById('sheetBody');
    const body = oldBody.cloneNode(false);
    oldBody.parentNode.replaceChild(body, oldBody);
    body.innerHTML = html;
    sheet.hidden = false;
    backdrop.hidden = false;
    sheet.scrollTop = 0;
    body.scrollTop = 0;
    sheetOnClose = opts.onClose || null;
    document.body.style.overflow = 'hidden';
    if (opts.focus) {
      const f = body.querySelector(opts.focus);
      if (f) setTimeout(() => f.focus(), 320);
    }
    return body;
  };

  UI.closeSheet = function () {
    const sheet = document.getElementById('sheet');
    const backdrop = document.getElementById('backdrop');
    const body = document.getElementById('sheetBody');
    sheet.hidden = true;
    backdrop.hidden = true;
    document.body.style.overflow = '';
    const cb = sheetOnClose;
    sheetOnClose = null;
    body.innerHTML = '';
    if (cb) cb();
  };

  UI.isSheetOpen = function () {
    return !document.getElementById('sheet').hidden;
  };

  UI.confirm = function (message) {
    return new Promise((resolve) => {
      const html = `
        <div class="sheet__title">确认一下</div>
        <p class="record__note" style="font-size:14px;color:var(--text);margin:0 0 20px">${UI.escapeHtml(message)}</p>
        <div class="row">
          <button class="btn btn--ghost" type="button" data-act="no">再想想</button>
          <button class="btn btn--danger" type="button" data-act="yes">确定</button>
        </div>`;
      const body = UI.openSheet(html);
      body.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        UI.closeSheet();
        resolve(btn.dataset.act === 'yes');
      });
    });
  };

  /* 所有弹层里的「关闭 / 取消」按钮统一在这里处理 */
  document.addEventListener('DOMContentLoaded', () => {
    const sheet = document.getElementById('sheet');
    if (!sheet) return;
    sheet.addEventListener(
      'click',
      (e) => {
        if (!e.target.closest('[data-act="close-sheet"]')) return;
        e.stopPropagation();
        UI.closeSheet();
      },
      true
    );
  });

  UI.formatBytes = function (n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  };

  UI.debounce = function (fn, wait) {
    let t;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait || 200);
    };
  };

  global.UI = UI;
})(window);
