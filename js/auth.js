/* 账号：注册（用户名 / 邮箱）/ 登录 / 找回密码（密保问题 或 恢复码） + 创建或加入情侣本 */
(function () {
  'use strict';

  let authMode = 'login';        // login | register | forgot
  let signupMode = 'username';   // username | email
  let forgotMode = 'answer';     // answer | code
  let joinStep = 'create';       // create | join
  let lastIdentifier = '';
  let pickedQuestion = '';
  let askedQuestion = '';

  const QUESTIONS = [
    '我们在一起的日子是？',
    'TA 的生日是哪一天？',
    '我们第一次看的电影是？',
    '第一次约会去的地方是？',
    '我们第一次一起吃的是什么？'
  ];

  const view = () => document.getElementById('view-auth');

  function heroHtml(emoji, title, desc) {
    return `
      <div class="auth__hero">
        <div class="auth__logo">${emoji}</div>
        <h1>${title}</h1>
        <p>${desc}</p>
      </div>`;
  }

  function tabsHtml() {
    const item = (key, label) =>
      `<button class="chip${authMode === key ? ' is-on' : ''}" type="button" data-auth="${key}">${label}</button>`;
    return `<div class="chips" style="margin:0 0 16px;padding:0">${item('login', '登录')}${item('register', '注册')}${item('forgot', '忘记密码')}</div>`;
  }

  /* 登录 / 找回 用的统一账号输入框（用户名或邮箱） */
  function identifierField(label, hint) {
    return `
      <div class="field">
        <label class="field__label" for="fIdentifier">${label || '用户名 / 邮箱'}</label>
        <input class="input" id="fIdentifier" type="text" maxlength="60" autocomplete="username"
               placeholder="${hint || '用户名或邮箱都可以'}" value="${UI.escapeHtml(lastIdentifier)}" />
      </div>`;
  }

  function questionFields() {
    const chips = QUESTIONS.map(
      (q) =>
        `<button class="chip${pickedQuestion === q ? ' is-on' : ''}" type="button" data-q="${UI.escapeHtml(q)}">${UI.escapeHtml(q)}</button>`
    ).join('');
    return `
      <div class="field">
        <span class="field__label">密保问题（忘记密码时用）</span>
        <div class="chips" id="fQuestions" style="margin:0 0 8px;padding:0">${chips}</div>
        <input class="input" id="fQuestion" maxlength="60" placeholder="也可以自己写一个问题"
               value="${UI.escapeHtml(QUESTIONS.indexOf(pickedQuestion) >= 0 ? '' : pickedQuestion)}" />
      </div>
      <div class="field">
        <label class="field__label" for="fAnswer">密保答案</label>
        <input class="input" id="fAnswer" maxlength="40" placeholder="建议简短，例如 20230520" />
      </div>`;
  }

  function loginHtml() {
    return `
      <div class="auth">
        ${heroHtml('💞', '朝暮', '朝朝暮暮，都是你<br/>登录后记录会同步到云端，两台手机看到同一份回忆')}
        <div class="card auth__card">
          ${tabsHtml()}
          ${identifierField()}
          <div class="field">
            <label class="field__label" for="fPassword">密码</label>
            <input class="input" id="fPassword" type="password" maxlength="32" placeholder="请输入密码" autocomplete="current-password" />
          </div>
          <button class="btn btn--primary btn--block" id="actLogin" type="button">登录</button>
          <div class="auth__links">
            <button type="button" data-auth="forgot">忘记密码？</button>
            <button type="button" data-auth="register">还没有账号，去注册</button>
          </div>
          ${Cloud.isOnline() ? '' : '<div class="auth__tip">当前是<b>本地演示模式</b>：数据只存在这台设备</div>'}
        </div>
      </div>`;
  }

  function registerHtml() {
    const modeChip = (key, label) =>
      `<button class="chip${signupMode === key ? ' is-on' : ''}" type="button" data-signup="${key}">${label}</button>`;

    const idField =
      signupMode === 'email'
        ? `
      <div class="field">
        <label class="field__label" for="fEmail">邮箱</label>
        <input class="input" id="fEmail" type="email" maxlength="60" placeholder="you@example.com" autocomplete="email" />
      </div>
      <div class="field">
        <label class="field__label" for="fEmailCode">邮箱验证码</label>
        <div class="row" style="align-items:center">
          <input class="input" id="fEmailCode" type="text" inputmode="numeric" maxlength="6"
                 placeholder="6 位验证码" autocomplete="one-time-code" />
          <button class="btn btn--ghost btn--sm" id="actSendMail" type="button" style="flex:none;white-space:nowrap">获取验证码</button>
        </div>
      </div>`
        : `
      <div class="field">
        <label class="field__label" for="fUsername">用户名</label>
        <input class="input" id="fUsername" maxlength="20" placeholder="3~20 位字母、数字或下划线" autocomplete="username" />
      </div>`;

    return `
      <div class="auth">
        ${heroHtml('💌', '创建一个账号', '用用户名或邮箱都行，找回密码靠密保问题')}
        <div class="card auth__card">
          ${tabsHtml()}
          <div class="chips" style="margin:0 0 14px;padding:0">${modeChip('username', '用用户名注册')}${modeChip('email', '用邮箱注册')}</div>
          ${idField}
          <div class="field">
            <label class="field__label" for="fPassword">设置密码</label>
            <input class="input" id="fPassword" type="password" maxlength="32" placeholder="至少 6 位" autocomplete="new-password" />
          </div>
          <div class="field">
            <label class="field__label" for="fPassword2">确认密码</label>
            <input class="input" id="fPassword2" type="password" maxlength="32" placeholder="再输入一次" autocomplete="new-password" />
          </div>
          ${questionFields()}
          <button class="btn btn--primary btn--block" id="actRegister" type="button">注册并登录</button>
          <div class="auth__links">
            <button type="button" data-auth="login">已有账号，去登录</button>
          </div>
          <div class="drop-hint">${
            signupMode === 'email'
              ? '邮箱仅作为登录账号，不会发送验证邮件'
              : '注册后可在「我们 → 账号安全」里绑定邮箱，之后也能用邮箱登录'
          }</div>
        </div>
      </div>`;
  }

  function forgotHtml() {
    const tab = (key, label) =>
      `<button class="chip${forgotMode === key ? ' is-on' : ''}" type="button" data-forgot="${key}">${label}</button>`;

    const online = Cloud.isOnline();
    const hint = online
      ? '答密保问题、用恢复码，或者用邮箱收验证码'
      : '本地演示模式下，邮箱验证码会直接显示出来';

    let body = '';
    if (forgotMode === 'email') {
      const guess = lastIdentifier.indexOf('@') >= 0 ? lastIdentifier : '';
      body = `
        <div class="field">
          <label class="field__label" for="fEmail">邮箱</label>
          <input class="input" id="fEmail" type="email" maxlength="60" placeholder="注册/绑定时用的邮箱"
                 value="${UI.escapeHtml(guess)}" autocomplete="email" />
        </div>
        <div class="field">
          <label class="field__label" for="fEmailCode">验证码</label>
          <div class="row" style="align-items:center">
            <input class="input" id="fEmailCode" type="text" inputmode="numeric" maxlength="6"
                   placeholder="6 位验证码" autocomplete="one-time-code" />
            <button class="btn btn--ghost btn--sm" id="actSendMail" type="button" style="flex:none;white-space:nowrap">获取验证码</button>
          </div>
        </div>`;
    } else if (forgotMode === 'answer') {
      body = `
        ${identifierField('用户名 / 邮箱')}
        <button class="btn btn--ghost btn--block btn--sm" id="actAsk" type="button">查看我的密保问题</button>
        <div id="fQuestionBox" style="display:${askedQuestion ? 'block' : 'none'}">
          <div class="auth__tip" id="fQuestionText">${UI.escapeHtml(askedQuestion)}</div>
          <div class="field">
            <label class="field__label" for="fAnswer">答案</label>
            <input class="input" id="fAnswer" maxlength="40" placeholder="请输入密保答案" />
          </div>
        </div>`;
    } else {
      body = `
        ${identifierField('用户名 / 邮箱')}
        <div class="field">
          <label class="field__label" for="fRecovery">恢复码</label>
          <input class="input" id="fRecovery" maxlength="24" placeholder="XXXX-XXXX-XXXX-XXXX"
                 style="letter-spacing:2px;text-transform:uppercase" />
        </div>`;
    }

    return `
      <div class="auth">
        ${heroHtml('🔑', '找回密码', hint)}
        <div class="card auth__card">
          ${tabsHtml()}
          <div class="chips" style="margin:0 0 14px;padding:0">${tab('answer', '密保问题')}${tab('code', '恢复码')}${tab('email', '邮箱验证码')}</div>
          ${body}
          <div class="field">
            <label class="field__label" for="fPassword">新密码</label>
            <input class="input" id="fPassword" type="password" maxlength="32" placeholder="至少 6 位" autocomplete="new-password" />
          </div>
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

  const val = (body, id) => {
    const el = body.querySelector('#' + id);
    return el ? String(el.value || '').trim() : '';
  };

  function busy(btn, text) {
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = text;
  }

  function idle(btn, text) {
    if (!btn) return;
    btn.disabled = false;
    btn.textContent = text;
  }

  async function afterAuth() {
    await Store.sync();
    App.enterApp();
  }

  let mailCountdown = 0;
  let mailTimer = null;

  function startMailCountdown(btn) {
    mailCountdown = 60;
    clearInterval(mailTimer);
    btn.disabled = true;
    btn.textContent = mailCountdown + ' 秒后重发';
    mailTimer = setInterval(() => {
      mailCountdown--;
      if (mailCountdown <= 0) {
        clearInterval(mailTimer);
        btn.disabled = false;
        btn.textContent = '获取验证码';
        return;
      }
      btn.textContent = mailCountdown + ' 秒后重发';
    }, 1000);
  }

  async function onSendMail(body, btn) {
    const emailInput = body.querySelector('#fEmail');
    const email = emailInput ? String(emailInput.value || '').trim() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      UI.toast('请先填写正确的邮箱');
      return;
    }
    const scene = authMode === 'register' ? 'register' : 'reset';
    busy(btn, '发送中…');
    try {
      const res = await Cloud.api.sendEmailCode(email, scene);
      const codeInput = body.querySelector('#fEmailCode');
      if (res && res.devCode) {
        UI.toast('演示模式验证码：' + res.devCode);
        if (codeInput) codeInput.value = res.devCode;
      } else {
        UI.toast('验证码已发送，请查收邮件');
      }
      startMailCountdown(btn);
    } catch (err) {
      idle(btn, '获取验证码');
      UI.toast(err.message || '发送失败');
    }
  }

  function showRecoverySheet(code) {
    const html = `
      <div class="sheet__title">
        <span>请保存这个恢复码</span>
        <button class="mini-btn" type="button" data-act="close-sheet">✕</button>
      </div>
      <div class="invite" data-act="copy-recovery">
        <div class="invite__label">恢复码（只显示这一次）</div>
        <div class="invite__code" style="font-size:22px;letter-spacing:3px">${UI.escapeHtml(code)}</div>
        <div class="invite__hint">点击复制</div>
      </div>
      <p class="record__note" style="margin-top:14px">
        忘记密码时，如果密保问题也答不上来，可以用这串恢复码重设密码。<br/>
        建议截图保存。之后在「我们 → 账号安全」里也能重新生成。
      </p>
      <button class="btn btn--primary btn--block" type="button" data-act="close-sheet">我已保存，开始使用</button>
    `;
    const body = UI.openSheet(html);
    body.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="copy-recovery"]')) {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(code).then(
            () => UI.toast('恢复码已复制'),
            () => UI.toast('复制失败，请手动抄下')
          );
        } else {
          UI.toast('请长按上面的恢复码复制');
        }
      }
    });
  }

  async function onRegister(body, btn) {
    const username = signupMode === 'username' ? val(body, 'fUsername') : '';
    const email = signupMode === 'email' ? val(body, 'fEmail') : '';
    const emailCode = signupMode === 'email' ? val(body, 'fEmailCode') : '';
    const pwd = val(body, 'fPassword');
    const pwd2 = val(body, 'fPassword2');
    const custom = val(body, 'fQuestion');
    const question = custom || pickedQuestion;
    const answer = val(body, 'fAnswer');

    if (signupMode === 'username') {
      if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return UI.toast('用户名需 3~20 位字母、数字或下划线');
      lastIdentifier = username;
    } else {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return UI.toast('邮箱格式看起来不太对');
      if (!/^\d{6}$/.test(emailCode)) return UI.toast('请填写邮箱收到的 6 位验证码');
      lastIdentifier = email;
    }
    if (pwd.length < 6) return UI.toast('密码至少 6 位');
    if (pwd !== pwd2) return UI.toast('两次输入的密码不一样');
    if (!question) return UI.toast('请选择或填写一个密保问题');
    if (answer.length < 2) return UI.toast('密保答案至少 2 个字符');

    busy(btn, '注册中…');
    try {
      const res = await Cloud.api.register({
        username: username,
        email: email,
        emailCode: emailCode,
        password: pwd,
        question: question,
        answer: answer
      });
      await Store.sync();
      UI.toast('注册成功 ❤');
      App.enterApp();
      if (res && res.recoveryCode) setTimeout(() => showRecoverySheet(res.recoveryCode), 400);
    } catch (err) {
      idle(btn, '注册并登录');
      UI.toast(err.message || '注册失败');
    }
  }

  async function onLogin(body, btn) {
    const identifier = val(body, 'fIdentifier');
    const password = val(body, 'fPassword');
    if (!identifier) return UI.toast('请输入用户名或邮箱');
    if (!password) return UI.toast('请输入密码');
    lastIdentifier = identifier;
    busy(btn, '登录中…');
    try {
      await Cloud.api.login(identifier, password);
      UI.toast('欢迎回来 ❤');
      await afterAuth();
    } catch (err) {
      idle(btn, '登录');
      UI.toast(err.message || '登录失败');
    }
  }

  async function onAskQuestion(body, btn) {
    const identifier = val(body, 'fIdentifier');
    if (!identifier) return UI.toast('请先输入用户名或邮箱');
    lastIdentifier = identifier;
    busy(btn, '查询中…');
    try {
      const res = await Cloud.api.securityQuestion(identifier);
      if (!res.question) {
        idle(btn, '查看我的密保问题');
        return UI.toast('这个账号没有设置密保问题，请用恢复码找回');
      }
      askedQuestion = res.question;
      if (res.locked) {
        idle(btn, '查看我的密保问题');
        return UI.toast('尝试次数过多，请 ' + res.lockedMinutes + ' 分钟后再试');
      }
      const box = body.querySelector('#fQuestionBox');
      const text = body.querySelector('#fQuestionText');
      if (box && text) {
        text.textContent = res.question;
        box.style.display = 'block';
      }
      idle(btn, '已找到问题');
      const ans = body.querySelector('#fAnswer');
      if (ans) ans.focus();
    } catch (err) {
      idle(btn, '查看我的密保问题');
      UI.toast(err.message || '查询失败');
    }
  }

  async function onReset(body, btn) {
    const password = val(body, 'fPassword');
    if (password.length < 6) return UI.toast('新密码至少 6 位');
    busy(btn, '提交中…');

    try {
      if (forgotMode === 'email') {
        const email = val(body, 'fEmail');
        const code = val(body, 'fEmailCode');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          idle(btn, '重设密码并登录');
          return UI.toast('请输入邮箱');
        }
        if (!/^\d{6}$/.test(code)) {
          idle(btn, '重设密码并登录');
          return UI.toast('请输入 6 位验证码');
        }
        lastIdentifier = email;
        await Cloud.api.resetByEmailCode(email, code, password);
      } else {
        const identifier = val(body, 'fIdentifier');
        if (!identifier) {
          idle(btn, '重设密码并登录');
          return UI.toast('请输入用户名或邮箱');
        }
        lastIdentifier = identifier;
        if (forgotMode === 'answer') {
          const answer = val(body, 'fAnswer');
          if (!answer) {
            idle(btn, '重设密码并登录');
            return UI.toast('请输入密保答案');
          }
          await Cloud.api.resetByAnswer(identifier, answer, password);
        } else {
          const code = val(body, 'fRecovery');
          if (!code) {
            idle(btn, '重设密码并登录');
            return UI.toast('请输入恢复码');
          }
          await Cloud.api.resetByCode(identifier, code, password);
        }
      }
      UI.toast('密码已重设 ❤');
      await afterAuth();
    } catch (err) {
      idle(btn, '重设密码并登录');
      UI.toast(err.message || '重设失败');
    }
  }

  async function onCreate(body, btn) {
    const myName = val(body, 'obMy') || '我';
    const partnerName = val(body, 'obPartner') || '宝贝';
    const anniversary = val(body, 'obAnniv') || UI.todayStr();
    busy(btn, '创建中…');
    try {
      await Cloud.api.updateUser({ nickname: myName });
      await Cloud.api.createBook({ myName: myName, partnerName: partnerName, anniversary: anniversary });
      await Store.sync();
      UI.toast('创建成功，把邀请码发给 TA 吧 ❤');
      App.enterApp();
    } catch (err) {
      idle(btn, '创建');
      UI.toast(err.message || '创建失败');
    }
  }

  async function onJoin(body, btn) {
    const code = val(body, 'obCode').toUpperCase();
    if (!code) return UI.toast('请输入邀请码');
    busy(btn, '加入中…');
    try {
      await Cloud.api.joinBook(code);
      await Store.sync();
      UI.toast('加入成功，你们现在共享同一本啦 ❤');
      App.enterApp();
    } catch (err) {
      idle(btn, '加入');
      UI.toast(err.message || '加入失败');
    }
  }

  function rememberIdentifier(body) {
    const v = val(body, 'fIdentifier');
    if (v) lastIdentifier = v;
    else {
      const u = val(body, 'fUsername') || val(body, 'fEmail');
      if (u) lastIdentifier = u;
    }
  }

  function bind(body) {
    body.onclick = (e) => {
      const authTab = e.target.closest('[data-auth]');
      if (authTab) {
        rememberIdentifier(body);
        authMode = authTab.dataset.auth;
        askedQuestion = '';
        return AuthView.show();
      }

      const signupTab = e.target.closest('[data-signup]');
      if (signupTab) {
        signupMode = signupTab.dataset.signup;
        return AuthView.show();
      }

      const forgotTab = e.target.closest('[data-forgot]');
      if (forgotTab) {
        rememberIdentifier(body);
        forgotMode = forgotTab.dataset.forgot;
        askedQuestion = '';
        return AuthView.show();
      }

      const qChip = e.target.closest('[data-q]');
      if (qChip) {
        pickedQuestion = qChip.dataset.q;
        UI.$$('#fQuestions .chip').forEach((b) => b.classList.toggle('is-on', b === qChip));
        const custom = body.querySelector('#fQuestion');
        if (custom) custom.value = '';
        return;
      }

      const stepTab = e.target.closest('[data-step]');
      if (stepTab) {
        joinStep = stepTab.dataset.step;
        return AuthView.show();
      }

      const hit = (sel) => e.target.closest(sel);
      if (hit('#actSendMail')) return onSendMail(body, body.querySelector('#actSendMail'));
      if (hit('#actLogin')) return onLogin(body, body.querySelector('#actLogin'));
      if (hit('#actRegister')) return onRegister(body, body.querySelector('#actRegister'));
      if (hit('#actAsk')) return onAskQuestion(body, body.querySelector('#actAsk'));
      if (hit('#actReset')) return onReset(body, body.querySelector('#actReset'));
      if (hit('#obCreate')) return onCreate(body, body.querySelector('#obCreate'));
      if (hit('#obJoin')) return onJoin(body, body.querySelector('#obJoin'));
      if (hit('#obLogout')) return AuthView.signOut();
    };

    body.onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      const id = e.target.id;
      if (id === 'fIdentifier' && authMode === 'login') {
        return onLogin(body, body.querySelector('#actLogin'));
      }
      if (id === 'fPassword') {
        if (authMode === 'login') return onLogin(body, body.querySelector('#actLogin'));
        if (authMode === 'forgot') return onReset(body, body.querySelector('#actReset'));
        return;
      }
      if (id === 'fPassword2') return onRegister(body, body.querySelector('#actRegister'));
      if (id === 'fEmailCode') {
        if (authMode === 'register') return onRegister(body, body.querySelector('#actRegister'));
        return onReset(body, body.querySelector('#actReset'));
      }
      if (id === 'fAnswer') {
        if (authMode === 'register') return onRegister(body, body.querySelector('#actRegister'));
        return onReset(body, body.querySelector('#actReset'));
      }
      if (id === 'fRecovery') return onReset(body, body.querySelector('#actReset'));
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
      } else if (authMode === 'login') {
        el.innerHTML = loginHtml();
      } else if (authMode === 'register') {
        el.innerHTML = registerHtml();
      } else {
        el.innerHTML = forgotHtml();
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
      forgotMode = 'answer';
      askedQuestion = '';
      pickedQuestion = '';
      document.getElementById('main').scrollTop = 0;
      App.reset();
      AuthView.show();
      UI.toast('已退出登录');
    }
  };

  window.AuthView = AuthView;
})();
