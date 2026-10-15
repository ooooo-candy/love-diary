/* 云函数统一调用封装 */
function call(name, data) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: name,
      data: data || {},
      success: (res) => {
        const r = res.result || {};
        if (r.ok) resolve(r.data);
        else reject(new Error(r.error || '请求失败'));
      },
      fail: (err) => reject(new Error((err && err.errMsg) || '网络异常'))
    });
  });
}

/* 统一错误提示 */
function toastErr(err) {
  wx.showToast({ title: (err && err.message) || '出错了', icon: 'none', duration: 2200 });
}

module.exports = {
  call: call,
  toastErr: toastErr
};
