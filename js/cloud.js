/* 云端调用层
 * 通过云函数的 HTTP 访问服务通信：不需要 CloudBase 前端 SDK，也不需要匿名登录，
 * 业务上的身份校验由我们自己签发的 token 完成。
 * 未配置云服务时自动降级为本地模拟模式。
 */
(function (global) {
  'use strict';

  const SESSION_KEY = 'love-diary:session';

  const config = (global.APP_CONFIG = global.APP_CONFIG || {
    mode: 'mock',     // 'cloud' | 'mock'
    envId: '',
    httpBase: ''      // 云函数的 HTTP 访问地址，形如 https://xxx.app.tcloudbase.com/api
  });

  let online = false;

  function loadSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') || null;
    } catch (err) {
      return null;
    }
  }

  function saveSession(s) {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  }

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('图片读取失败'));
      fr.readAsDataURL(blob);
    });
  }

  const Cloud = {
    session: loadSession(),
    get mode() {
      return online ? 'cloud' : 'mock';
    },
    isOnline: () => online,

    async init() {
      online = config.mode === 'cloud' && Boolean(config.httpBase);
      if (!online && global.MockCloud) global.MockCloud.init();
      return { online: online };
    },

    setSession(s) {
      Cloud.session = s;
      saveSession(s);
    },

    clearSession() {
      Cloud.session = null;
      saveSession(null);
    },

    /* 调用云函数 */
    async call(action, payload) {
      const args = Object.assign({}, payload || {});
      const s = Cloud.session;
      if (s && s.uid && args.uid === undefined) {
        args.uid = s.uid;
        args.token = s.token;
      }

      if (!online) {
        if (!global.MockCloud) throw new Error('未连接云服务');
        return global.MockCloud.handle(action, args);
      }

      let res;
      try {
        res = await fetch(config.httpBase, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: action, payload: args })
        });
      } catch (err) {
        const e = new Error('网络不太好，稍后再试');
        e.apiCode = 'NETWORK';
        throw e;
      }

      let body = null;
      try {
        body = await res.json();
      } catch (err) {
        const e = new Error('服务器返回异常');
        e.apiCode = 'BAD_RESPONSE';
        throw e;
      }

      if (body && body.ok) return body.data || {};
      const err = new Error((body && body.error) || '请求失败');
      err.apiCode = (body && body.apiCode) || 'UNKNOWN';
      throw err;
    },

    /* 上传图片：压缩后的 blob → base64 → 服务端写入云存储 */
    async uploadImage(file) {
      if (!online) {
        if (!global.MockCloud) throw new Error('未开启本地模式');
        return global.MockCloud.upload(file);
      }
      const dataUrl = await blobToDataURL(file);
      const data = await Cloud.call('uploadImage', {
        base64: dataUrl,
        name: (file && file.name) || 'photo.jpg'
      });
      if (!data || !data.fileId) throw new Error('图片上传失败');
      return { fileId: data.fileId };
    },

    /* 换取图片临时下载地址 */
    async getFileUrls(fileIds) {
      if (!fileIds || !fileIds.length) return {};
      if (!online) return global.MockCloud.urls(fileIds);
      const data = await Cloud.call('getFileUrl', { fileIds: fileIds });
      return data.urls || {};
    },

    api: {
      register: (info) =>
        Cloud.call('register', {
          username: info.username || '',
          email: info.email || '',
          emailCode: info.emailCode || '',
          password: info.password,
          question: info.question,
          answer: info.answer
        }).then((d) => {
          Cloud.setSession({ uid: d.uid, token: d.token });
          return d;
        }),

      login: (identifier, password) =>
        Cloud.call('login', { identifier: identifier, password: password }).then((d) => {
          Cloud.setSession({ uid: d.uid, token: d.token });
          return d;
        }),

      securityQuestion: (identifier) =>
        Cloud.call('securityQuestion', { identifier: identifier }),

      resetByAnswer: (identifier, answer, password) =>
        Cloud.call('resetByAnswer', {
          identifier: identifier,
          answer: answer,
          password: password
        }).then((d) => {
          Cloud.setSession({ uid: d.uid, token: d.token });
          return d;
        }),

      resetByCode: (identifier, recoveryCode, password) =>
        Cloud.call('resetByCode', {
          identifier: identifier,
          recoveryCode: recoveryCode,
          password: password
        }).then((d) => {
          Cloud.setSession({ uid: d.uid, token: d.token });
          return d;
        }),

      updateEmail: (password, email) =>
        Cloud.call('updateEmail', { password: password, email: email }),

      /* 邮箱验证码：scene = register | reset | bind */
      sendEmailCode: (email, scene) => Cloud.call('sendEmailCode', { email: email, scene: scene }),

      resetByEmailCode: (email, code, password) =>
        Cloud.call('resetByEmailCode', { email: email, code: code, password: password }).then((d) => {
          Cloud.setSession({ uid: d.uid, token: d.token });
          return d;
        }),

      bindEmail: (email, code) => Cloud.call('bindEmail', { email: email, code: code }),

      unbindEmail: (password) => Cloud.call('unbindEmail', { password: password }),

      changePassword: (oldPassword, password) =>
        Cloud.call('changePassword', { oldPassword: oldPassword, password: password }),

      updateSecurity: (password, question, answer) =>
        Cloud.call('updateSecurity', { password: password, question: question, answer: answer }),

      regenerateRecovery: (password) => Cloud.call('regenerateRecovery', { password: password }),
      signOut: () => Cloud.call('signOut', {}).finally(() => Cloud.clearSession()),
      me: () => Cloud.call('me', {}),
      updateUser: (patch) => Cloud.call('updateUser', patch),
      createBook: (info) => Cloud.call('createBook', info),
      joinBook: (code) => Cloud.call('joinBook', { code: code }),
      leaveBook: () => Cloud.call('leaveBook', {}),
      updateBook: (patch) => Cloud.call('updateBook', patch),
      listRecords: () => Cloud.call('listRecords', {}),
      upsertRecord: (record) => Cloud.call('upsertRecord', { record: record }),
      removeRecord: (id) => Cloud.call('removeRecord', { id: id })
    }
  };

  global.Cloud = Cloud;
})(window);
