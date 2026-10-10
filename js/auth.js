/* 登录 / 注册 / 找回密码 + 创建或加入情侣本 */
(function () {
  'use strict';

  let authMode = 'login';   // login | register | forgot
  let joinStep = 'create';  // create | join
  let countdown = 0;
  let countTimer = null;
  let lastPhone = '';

  const view = () => document.getElementById('view-auth');

  function tabsHtml() {
    const item = (key, label) =>
      `<button class="chip${authMode === key ? ' is-on' : ''}" type="button" data-auth="${key}">${label}</button>`;
    return `<div class="chips" style="margin:0 0 16px;padding:0">${item('login', '登录')}${item('register', '注册')}${item('forgot', '忘记密码')}</div>`;
  }

  function heroHtml(emoji, title, desc) {
    return `
      <div class="auth__hero">
        <div class="auth__logo">${emoji}</div>
        <h1>${title}</h1>
        <p>${desc}</p>
      </div>`;
  }

  function phoneField() {
    return `
      <div class="field">
        <label class="field__label" for="fPhone">手机号</label>
        <input class="input" id="fPhone" type="tel" inputmode="numeric" maxlength="11"
               placeholder="用于登录和找回密码" value="${UI.escapeHtml(lastPhone)}" autocomplete="tel" />
      </div>`;
  }

  function codeField() {
    return `
      <div class="field">
        <label class="field__label" for="fCode">短信验证码</label>
        <div class="row" style="align-items:center">
          <input class="input" id="fCode" type="text" inputmode="numeric" maxlength="6"
                 placeholder="6 位验证码" autocomplete="one-time-code" />
          <button class="btn btn--ghost btn--sm" id="actSend" type="button" style="flex:none;white-space:nowrap">获取验证码</button>
        </div>
      </div>`;
  }

  function passwordField(id, label, placeholder) {
    return `
      <div class="field">
        <label class="field__label" for="${id}">${label}</label>
        <input class="input" id="${id}" type="password" maxlength="32" placeholder="${placeholder}" autocomplete="new-password" />
      </div>`;
  }

  function loginHtml() {
    return `
      <div class="auth">
        ${heroHtml('💞', '我们的小日子', '登录后记录会同步到云端<br/>两个人、多台手机看到同一份回忆')}
        <div class="card auth__card">
          ${tabsHtml()}
          ${phoneField()}
          <div class="field">
            <label class="field__label" for="fPassword">密码</label>
            <input class="input" id="fPassword" type="password" maxlength="32" placeholder="请输入密码" autocomplete="current-password" />
          </div>
          <button class="btn btn--primary btn--block" id="actLogin" type="button">登录</button>
          <div class="auth__links">
            <button type="button" data-auth="forgot">忘记密码？</button>
            <button type="button" data-auth="register">还没有账号，去注册</button>
          </div>
          ${Cloud.isOnline() ? '' : '<div class="auth__tip">当前是<b>本地演示模式</b>：数据只存在这台设备，验证码会直接显示出来</div>'}
        </div>
      </div>`;
  }

  function registerHtml() {
    return `
      <div class="auth">
        ${heroHtml('💌', '注册一个账号', '手机号就是你的账号，用来登录和找回密码')}
        <div class="card auth__card">
          ${tabsHtml()}
          ${phoneField()}
          ${codeField()}
          ${passwordField('fPassword', '设置密码', '至少 6 位，建议字母+数字')}
          ${passwordField('fPassword2', '确认密码', '再输入一次')}
          <button class="btn btn--primary btn--block" id="actRegister" type="button">注册并登录</button>
          <div class="auth__links">
            <button type="button" data-auth="login">已有账号，去登录</button>
          </div>
          <div class="drop-hint">请填写真实手机号，忘记密码时需要用它接收验证码</div>
        </div>
      </div>`;
  }

  function forgotHtml() {
    return `
      <div class="auth">
        ${heroHtml('🔑', '找回密码', '用注册时的手机号接收验证码，重设一个新密码')}
        <div class="card auth__card">
          ${tabsHtml()}
          ${phoneField()}
          ${codeField()}
          ${passwordField('fPassword', '新密码', '至少 6 位')}
          <button class="btn btn--primary btn--block" id="actReset" type="button">重设密码并登录</button>
          <div class="auth__links">
            <button type="button" data-auth="login">想起来了，去登录</button>
          </div>
        </div>
      </div>`;
  }

  function onboardHtml() {
    const me = Store.getMe() || {};
    const createOn = joinStep !== 'join';
    return `
      <div class="auth">
        ${heroHtml(
          createOn ? '💌' : '🔑',
          createOn ? '创建你们的本子' : '加入 TA 的本子',
          createOn
            ? '填好你们的信息，创建后会生成一个邀请码<br/>把邀请码发给 TA，就能一起写同一本啦'
            : '输入 TA 给你的 6 位邀请码<br/>加入后你们看到的记录会完全一样'
        )}
        <div class="card auth__card">
          <div class="chips" style="margin:0 0 14px;padding:0">
            <button class="chip${createOn ? ' is-on' : ''}" type="button" data-step="create">创建本子</button>
            <button class="chip${createOn ? '' : ' is-on'}" type="button" data-step="join">用邀请码加入</button>
          </div>
          ${
            createOn
              ? `
            <div class="field">
              <label class="field__label" for="obMy">我的昵称</label>
              <input class="input" id="obMy" maxlength="12" placeholder="我" value="${UI.escapeHtml(me.nickname || '')}" />
            </div>
            <div class="field">
              <label class="field__label" for="obPartner">TA 的昵称</label>
              <input class="input" id="obPartner" maxlength="12" placeholder="宝贝" />
            </div>
            <div class="field">
              <label class="field__label" for="obAnniv">我们在一起的日子</label>
              <input class="input" id="obAnniv" type="date" value="${UI.todayStr()}" />
            </div>
            <button class="btn btn--primary btn--block" id="obCreate" type="button">创建</button>`
              : `
            <div class="field">
              <label class="field__label" for="obCode">邀请码</label>
              <input class="input" id="obCode" maxlength="6" placeholder="6 位邀请码"
                     style="text-transform:uppercase;letter-spacing:4px;text-align:center;font-size:20px;font-weight:800" />
            </div>
            <button class="btn btn--primary btn--block" id="obJoin" type="button">加入</button>`
          }
          <button class="btn btn--ghost btn--block btn--sm" id="obLogout" type="button" style="margin-top:10px">换个账号登录</button>
        </div>
      </div>`;
  }

  /* ---------------- 交互 ---------------- */

  function readPhone(body) {
    const el = body.querySelector('#fPhone');
    return el ? (el.value || '').replace(/\D/g, '') : '';
  }

  function startCountdown(btn) {
    countdown = 60;
    clearInterval(countTimer);
    btn.disabled = true;
    btn.textContent = countdown + ' 秒后重发';
    countTimer = setInterval(() => {
      countdown--;
      if (countdown <= 0) {
        clearInterval(countTimer);
        btn.disabled = false;
        btn.textContent = '获取验证码';
        return;
      }
      btn.textContent = countdown + ' 秒后重发';
    }, 1000);
  }

  async function onSendCode(body, btn) {
    const phone = readPhone(body);
    if (!/^1\d{10}$/.test(phone)) {
      UI.toast('请输入正确的手机号');
      return;
    }
    lastPhone = phone;
    btn.disabled = true;
    btn.textContent = '发送中…';
    try {
      const res = await Cloud.api.sendCode(phone);
      UI.toast('验证码已发送');
      if (res && res.devCode) {
        UI.toast('演示模式验证码：' + res.devCode);
        const codeInput = body.querySelector('#fCode');
        if (codeInput) codeInput.value = res.devCode;
      }
      startCountdown(btn);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '获取验证码';
      UI.toast(err.message || '验证码发送失败');
    }
  }

  function busy(btn, text) {
    btn.disabled = true;
    btn.textContent = text;
  }

  async function afterAuth() {
    await Store.sync();
    App.enterApp();
  }

  async function onLogin(body, btn) {
    const phone = readPhone(body);
    const password = body.querySelector('#fPassword').value;
    if (!/^1\d{10}$/.test(phone)) return UI.toast('请输入正确的手机号');
    if (!password) return UI.toast('请输入密码');
    lastPhone = phone;
    busy(btn, '登录中…');
    try {
      await Cloud.api.login(phone, password);
      UI.toast('欢迎回来 ❤');
      await afterAuth();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '登录';
      UI.toast(err.message || '登录失败');
    }
  }

  async function onRegister(body, btn) {
    const phone = readPhone(body);
    const code = (body.querySelector('#fCode').value || '').trim();
    const pwd = body.querySelector('#fPassword').value;
    const pwd2 = body.querySelector('#fPassword2').value;
    if (!/^1\d{10}$/.test(phone)) return UI.toast('请输入正确的手机号');
    if (!/^\d{6}$/.test(code)) return UI.toast('请输入 6 位验证码');
    if (String(pwd).length < 6) return UI.toast('密码至少 6 位');
    if (pwd !== pwd2) return UI.toast('两次输入的密码不一样');
    lastPhone = phone;
    busy(btn, '注册中…');
    try {
      await Cloud.api.register(phone, code, pwd);
      UI.toast('注册成功 ❤');
      await afterAuth();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '注册并登录';
      UI.toast(err.message || '注册失败');
    }
  }

  async function onReset(body, btn) {
    const phone = readPhone(body);
    const code = (body.querySelector('#fCode').value || '').trim();
    const pwd = body.querySelector('#fPassword').value;
    if (!/^1\d{10}$/.test(phone)) return UI.toast('请输入正确的手机号');
    if (!/^\d{6}$/.test(code)) return UI.toast('请输入 6 位验证码');
    if (String(pwd).length < 6) return UI.toast('新密码至少 6 位');
    lastPhone = phone;
    busy(btn, '提交中…');
    try {
      await Cloud.api.resetPassword(phone, code, pwd);
      UI.toast('密码已重设 ❤');
      await afterAuth();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '重设密码并登录';
      UI.toast(err.message || '重设失败');
    }
  }

  async function onCreate(body, btn) {
    const myName = body.querySelector('#obMy').value.trim() || '我';
    const partnerName = body.querySelector('#obPartner').value.trim() || '宝贝';
    const anniversary = body.querySelector('#obAnniv').value || UI.todayStr();
    busy(btn, '创建中…');
    try {
      await Cloud.api.updateUser({ nickname: myName });
      await Cloud.api.createBook({ myName: myName, partnerName: partnerName, anniversary: anniversary });
      await Store.sync();
      UI.toast('创建成功，把邀请码发给 TA 吧 ❤');
      App.enterApp();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '创建';
      UI.toast(err.message || '创建失败');
    }
  }

  async function onJoin(body, btn) {
    const code = (body.querySelector('#obCode').value || '').trim().toUpperCase();
    if (!code) return UI.toast('请输入邀请码');
    busy(btn, '加入中…');
    try {
      await Cloud.api.joinBook(code);
      await Store.sync();
      UI.toast('加入成功，你们现在共享同一本啦 ❤');
      App.enterApp();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '加入';
      UI.toast(err.message || '加入失败');
    }
  }

  function switchAuth(next, body) {
    const cur = readPhone(body);
    if (cur) lastPhone = cur;
    authMode = next;
    AuthView.show();
  }

  function bind(body) {
    body.onclick = (e) => {
      const authTab = e.target.closest('[data-auth]');
      if (authTab) return switchAuth(authTab.dataset.auth, body);

      const stepTab = e.target.closest('[data-step]');
      if (stepTab) {
        joinStep = stepTab.dataset.step;
        return AuthView.show();
      }

      const hit = (sel) => e.target.closest(sel);
      if (hit('#actSend')) return onSendCode(body, body.querySelector('#actSend'));
      if (hit('#actLogin')) return onLogin(body, body.querySelector('#actLogin'));
      if (hit('#actRegister')) return onRegister(body, body.querySelector('#actRegister'));
      if (hit('#actReset')) return onReset(body, body.querySelector('#actReset'));
      if (hit('#obCreate')) return onCreate(body, body.querySelector('#obCreate'));
      if (hit('#obJoin')) return onJoin(body, body.querySelector('#obJoin'));
      if (hit('#obLogout')) return AuthView.signOut();
    };

    body.onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      const id = e.target.id;
      if (id === 'fPhone') return onSendCode(body, body.querySelector('#actSend'));
      if (id === 'fPassword2') return onRegister(body, body.querySelector('#actRegister'));
      if (id === 'fPassword') {
        if (authMode === 'login') return onLogin(body, body.querySelector('#actLogin'));
        if (authMode === 'forgot') return onReset(body, body.querySelector('#actReset'));
        return;
      }
      if (id === 'fCode') {
        if (authMode === 'register') return onRegister(body, body.querySelector('#actRegister'));
        if (authMode === 'forgot') return onReset(body, body.querySelector('#actReset'));
        return;
      }
      if (id === 'obCode') return onJoin(body, body.querySelector('#obJoin'));
    };
  }

  const AuthView = {
    show() {
      const el = view();
      document.documentElement.classList.add('is-guest');
      el.hidden = false;
      ['home', 'timeline', 'album', 'stats'].forEach((k) => {
        document.getElementById('view-' + k).hidden = true;
      });

      if (Store.isSignedIn()) {
        el.innerHTML = onboardHtml();
      } else {
        if (authMode === 'login') el.innerHTML = loginHtml();
        else if (authMode === 'register') el.innerHTML = registerHtml();
        else el.innerHTML = forgotHtml();
      }
      bind(el);
    },

    async signOut() {
      try {
        await Cloud.api.signOut();
      } catch (err) { /* 忽略 */ }
      Cloud.clearSession();
      Store.clearLocal();
      authMode = 'login';
      document.getElementById('main').scrollTop = 0;
      App.reset();
      AuthView.show();
      UI.toast('已退出登录');
    }
  };

  window.AuthView = AuthView;
})();
