# 云端版部署指南（腾讯云 CloudBase）

把 App 从「本地模式」升级为「云端共享版」：手机号验证码登录、两人共用一本、照片存云端。

## 第 1 步：开通 CloudBase

1. 打开 https://tcb.cloud.tencent.com ，用腾讯云账号登录
2. 创建环境：选择「按量计费」（有免费额度，个人使用基本够）
3. 记下 **环境 ID**（形如 `xxx-1a2b3c4d`）

## 第 2 步：不需要数据库 ✅

本方案把整份数据存成云存储里的一个 JSON 文件（`love-diary/db.json`），
**不用开通云数据库、也不用手动建集合**，开通环境即可直接跑。
（读写都经过云函数，数据不会直接暴露给公网。）

## 第 3 步：部署云函数 + HTTP 访问服务

```bash
npm install -g @cloudbase/cli
tcb login                                    # 浏览器授权一次

# 云函数依赖（本地装好后随代码一起上传）
cd cloud/api && npm install && cd ../..

# 部署云函数（仓库里的 cloudbaserc.json 已配置好：本地打包依赖 + 函数名为 api）
tcb fn deploy api --force

# 为云函数开通 HTTP 访问服务，前端通过它通信（不需要前端登录态）
tcb service create -p api -f api
# 记下输出的访问地址，例如：
# https://<env>.ap-shanghai.app.tcloudbase.com/api
```

## 第 4 步：开通手机号验证码登录

1. 控制台 →「登录授权」→ 开启「手机号登录」（需要先在腾讯云 SMS 开通短信服务，
   个人实名认证可申请 1 个自用签名 + 模板，审核约 1~2 天，费用约 0.035 元/条，日常使用一个月几块钱）
2. 给云函数 `api` 配置环境变量（控制台 → 云函数 → api → 函数配置 → 环境变量）：
   - `SMS_SECRET_ID` / `SMS_SECRET_KEY`：访问管理 cam 里创建 API 密钥
   - `SMS_SDK_APP_ID`：短信应用 SDKAppID
   - `SMS_TEMPLATE_ID`：模板 ID（模板内容需含两个参数：`{1}` 验证码、`{2}` 有效分钟数）
   - `SMS_SIGN`：已审核的短信签名

> 未配置短信时，App 运行在「演示模式」：验证码直接显示在界面上，可以先完整体验全部功能。

## 第 5 步：前端切换到云端

编辑 `index.html`：

```js
window.APP_CONFIG = {
  mode: 'cloud',
  envId: '你的环境ID',
  httpBase: 'https://<env>.ap-shanghai.app.tcloudbase.com/api'   // 第 3 步拿到的地址
};
```

## 第 6 步：托管前端

控制台 →「静态网站托管」→ 上传 `index.html`、`css/`、`js/`、`icons/`、`manifest.webmanifest`、`sw.js`
（或用 CLI：`tcb hosting deploy . -e 你的环境ID`），即可得到国内高速访问的网址。

## 使用流程

1. 一方：手机号登录 → 创建本子 → 把「邀请码」发给对方
2. 另一方：手机号登录 → 「用邀请码加入」
3. 之后双方看到的是同一份记录和照片，每条记录会显示是谁写的
