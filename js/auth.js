/* 登录 / 加入情侣本 的界面 */
(function () {
  'use strict';

  let step = 'login';        // login | create | join
  let countdown = 0;
  let countTimer = null;

  function view() {
    return document.getElementById('view-auth');
  }

  function loginHtml() {
    return `
      <div class="auth">
        <div class="auth__hero">
          <div class="auth__logo">💞</div>
          <h1>我们的小日子</h1>
          <p>登录后记录会自动同步到云端<br/>两个人、多台手机都能看到同一份回忆</p>
        </div>

        <div class="card auth__card">
          <div class="field">
            <label class="field__label" for="authPhone">手机号</label>
            <input class="input" id="authPhone" type="tel" inputmode="numeric" maxlength="11"
                   placeholder="请输入手机号" autocomplete="tel" />
          </div>
          <div class="field">
            <label class="field__label" for="authCode">验证码</label>
            <div class="row" style="align-items:center">
              <input class="input" id="authCode" type="text" inputmode="numeric" maxlength="6"
                     placeholder="6 位验证码" autocomplete="one-time-code" />
              <button class="btn btn--ghost btn--sm" id="authSend" type="button" style="flex:none;white-space:nowrap">获取验证码</button>
            </div>
          </div>
          <button class="btn btn--primary btn--block" id="authLogin" type="button">登录 / 注册</button>
          <div class="drop-hint">未注册的手机号会自动创建账号</div>
          ${
            Cloud.isOnline()
              ? ''
              : '<div class="auth__tip">当前为<b>本地演示模式</b>：点「获取验证码」后验证码会直接显示出来，数据只存在这台设备</div>'
          }
        </div>
      </div>`;
  }

  function onboardHtml() {
    const me = Store.getMe() || {};
    const createOn = step !== 'join';
    return `
      <div class="auth">
        <div class="auth__hero">
          <div class="auth__logo">${createOn ? '💌' : '🔑'}</div>
          <h1>${createOn ? '创建你们的本子' : '加入 TA 的本子'}</h1>
          <p>${createOn
            ? '填好你们的信息，创建后会生成一个邀请码<br/>把邀请码发给 TA，就能一起写同一本啦'
            : '输入 TA 给你的 6 位邀请码<br/>加入后你们看到的记录会完全一样'}</p>
        </div>

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
              <input class="input" id="obCode" maxlength="6" placeholder="6 位邀请码" style="text-transform:uppercase;letter-spacing:4px;text-align:center;font-size:20px;font-weight:800" />
            </div>
            <button class="btn btn--primary btn--block" id="obJoin" type="button">加入</button>`
          }
          <button class="btn btn--ghost btn--block btn--sm" id="obLogout" type="button" style="margin-top:10px">换个号码登录</button>
        </div>
      </div>`;
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
    const input = body.querySelector('#authPhone');
    const phone = (input.value || '').replace(/\D/g, '');
    if (!/^1\d{10}$/.test(phone)) {
      UI.toast('请输入正确的手机号');
      input.focus();
      return;
    }
    btn.disabled = true;
    btn.textContent = '发送中…';
    try {
      const res = await Cloud.api.sendCode(phone);
      UI.toast('验证码已发送');
      if (res && res.devCode) {
        UI.toast('演示模式验证码：' + res.devCode);
        const codeInput = body.querySelector('#authCode');
        if (codeInput) codeInput.value = res.devCode;
      }
      startCountdown(btn);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '获取验证码';
      UI.toast(err.message || '验证码发送失败');
    }
  }

  async function onLogin(body, btn) {
    const phone = (body.querySelector('#authPhone').value || '').replace(/\D/g, '');
    const code = (body.querySelector('#authCode').value || '').trim();
    if (!/^1\d{10}$/.test(phone)) return UI.toast('请输入正确的手机号');
    if (!/^\d{6}$/.test(code)) return UI.toast('请输入 6 位验证码');

    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '登录中…';
    try {
      await Cloud.api.signIn(phone, code);
      await Store.sync();
      UI.toast('登录成功 ❤');
      App.enterApp();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = old;
      UI.toast(err.message || '登录失败');
    }
  }

  async function onCreate(body, btn) {
    const myName = body.querySelector('#obMy').value.trim() || '我';
    const partnerName = body.querySelector('#obPartner').value.trim() || '宝贝';
    const anniversary = body.querySelector('#obAnniv').value || UI.todayStr();
    const nick = myName;
    btn.disabled = true;
    btn.textContent = '创建中…';
    try {
      await Cloud.api.updateUser({ nickname: nick });
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
    btn.disabled = true;
    btn.textContent = '加入中…';
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

  function bind(body) {
    // 用赋值方式绑定，避免每次 show() 都叠加一层监听
    body.onclick = (e) => {
      const tab = e.target.closest('[data-step]');
      if (tab) {
        step = tab.dataset.step;
        AuthView.show();
        return;
      }
      if (e.target.closest('#authSend')) {
        onSendCode(body, body.querySelector('#authSend'));
        return;
      }
      if (e.target.closest('#authLogin')) {
        onLogin(body, body.querySelector('#authLogin'));
        return;
      }
      if (e.target.closest('#obCreate')) {
        onCreate(body, body.querySelector('#obCreate'));
        return;
      }
      if (e.target.closest('#obJoin')) {
        onJoin(body, body.querySelector('#obJoin'));
        return;
      }
      if (e.target.closest('#obLogout')) {
        AuthView.signOut();
      }
    };

    body.onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      if (e.target.id === 'authPhone') return onSendCode(body, body.querySelector('#authSend'));
      if (e.target.id === 'authCode') return onLogin(body, body.querySelector('#authLogin'));
      if (e.target.id === 'obCode') return onJoin(body, body.querySelector('#obJoin'));
    };
  }

  const AuthView = {
    show() {
      const el = view();
      step = Store.isSignedIn() ? (step === 'login' ? 'create' : step) : 'login';
      document.documentElement.classList.add('is-guest');
      el.hidden = false;
      ['home', 'timeline', 'album', 'stats'].forEach((k) => {
        document.getElementById('view-' + k).hidden = true;
      });
      el.innerHTML = Store.isSignedIn() ? onboardHtml() : loginHtml();
      bind(el);
    },

    async signOut() {
      try {
        await Cloud.api.signOut();
      } catch (err) { /* 忽略 */ }
      Cloud.clearSession();
      Store.clearLocal();
      App.reset();
      AuthView.show();
      UI.toast('已退出登录');
    }
  };

  window.AuthView = AuthView;
})(window);
