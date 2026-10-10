/* 云端调用层
 * 统一封装：账号会话、云函数、图片上传 / 临时地址。
 * 当 CloudBase 未配置或不可用时自动降级为本地模拟模式（便于先跑通界面与流程）。
 */
(function (global) {
  'use strict';

  const SESSION_KEY = 'love-diary:session';
  const FN_NAME = 'api';

  const config = (global.APP_CONFIG = global.APP_CONFIG || {
    mode: 'mock', // 'cloud' | 'mock'
    envId: ''
  });

  let tcbApp = null;
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

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('CloudBase SDK 加载失败'));
      document.head.appendChild(s);
    });
  }

  async function getApp() {
    if (tcbApp) return tcbApp;
    if (!global.cloudbase) {
      await loadScript('https://static.cloudbase.net/cloudbase-js-sdk/2.7.1/cloudbase.full.js');
    }
    if (!global.cloudbase) throw new Error('CloudBase SDK 未加载');
    tcbApp = global.cloudbase.init({ env: config.envId });
    return tcbApp;
  }

  const Cloud = {
    session: loadSession(),
    get mode() {
      return online ? 'cloud' : 'mock';
    },
    isOnline: () => online,

    async init() {
      if (config.mode === 'cloud' && config.envId) {
        try {
          await getApp();
          online = true;
        } catch (err) {
          online = false;
        }
      } else {
        online = false;
      }
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
        if (!global.MockCloud) throw new Error('未连接云服务，也未开启本地模式');
        return global.MockCloud.handle(action, args);
      }
      const app = await getApp();
      const res = await app.callFunction({ name: FN_NAME, data: { action: action, payload: args } });
      const body = res && res.result;
      if (body && body.ok) return body.data;
      const err = new Error((body && body.error) || '请求失败');
      err.apiCode = (body && body.apiCode) || 'UNKNOWN';
      throw err;
    },

    /* 上传一张图片到云存储，返回 fileId */
    async uploadImage(file, fileIdHint) {
      if (!online) {
        if (!global.MockCloud) throw new Error('未开启本地模式');
        return global.MockCloud.upload(file);
      }
      const app = await getApp();
      const ext = (String(file.name || '').split('.').pop() || 'jpg').toLowerCase();
      const cloudPath =
        'love-diary/' +
        (Cloud.session ? Cloud.session.uid : 'anon') +
        '/' +
        Date.now() +
        '_' +
        Math.random().toString(36).slice(2, 8) +
        '.' +
        ext;
      const res = await app.uploadFile({ cloudPath: cloudPath, filePath: file });
      if (!res || !res.fileID) throw new Error('图片上传失败');
      return { fileId: res.fileID };
    },

    /* 换取图片临时下载地址 */
    async getFileUrls(fileIds) {
      if (!fileIds || !fileIds.length) return {};
      if (!online) return global.MockCloud.urls(fileIds);
      const data = await Cloud.call('getFileUrl', { fileIds: fileIds });
      return data.urls || {};
    },

    /* 便捷包装 */
    api: {
      sendCode: (phone) => Cloud.call('sendCode', { phone: phone }),
      signIn: (phone, code) => Cloud.call('signIn', { phone: phone, code: code }).then((d) => {
        Cloud.setSession({ uid: d.uid, token: d.token });
        return d;
      }),
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
