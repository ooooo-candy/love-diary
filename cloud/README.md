# 云端版部署指南（腾讯云 CloudBase）

把 App 从「本地模式」升级为「云端共享版」：手机号验证码登录、两人共用一本、照片存云端。

## 第 1 步：开通 CloudBase

1. 打开 https://tcb.cloud.tencent.com ，用腾讯云账号登录
2. 创建环境：选择「按量计费」（有免费额度，个人使用基本够）
3. 记下 **环境 ID**（形如 `xxx-1a2b3c4d`）

## 第 2 步：创建数据库集合

控制台 →「云数据库」→ 新建以下 4 个集合，权限全部设为 **仅创建者可读写**（实际读写都走云函数，权限越严越安全）：

| 集合名 | 用途 |
|---|---|
| `ld_users` | 用户（手机号、昵称、头像、登录态） |
| `ld_books` | 情侣本（邀请码、双方昵称、纪念日、成员） |
| `ld_records` | 恋爱记录 |
| `ld_sms_codes` | 短信验证码 |

## 第 3 步：部署云函数

方式 A（推荐，用命令行）：

```bash
npm install -g @cloudbase/cli
tcb login                      # 浏览器授权一次
cd cloud/api
tcb fn deploy api --force      # 部署云函数（名字必须叫 api）
```

方式 B（网页上传）：控制台 →「云函数」→ 新建函数 `api` → 运行环境 Node.js 16 →
把 `cloud/api` 目录打包 zip 上传（依赖 `@cloudbase/node-sdk` 需要在本地 `npm install` 后一起打包）。

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

编辑 `index.html`，把：

```js
window.APP_CONFIG = { mode: 'mock', envId: '' };
```

改成：

```js
window.APP_CONFIG = { mode: 'cloud', envId: '你的环境ID' };
```

并在控制台「登录授权 → Web 安全域名」里加上你的访问域名（本地调试加 `localhost`）。

## 第 6 步：托管前端

控制台 →「静态网站托管」→ 上传 `index.html`、`css/`、`js/`、`icons/`、`manifest.webmanifest`、`sw.js`
（或用 CLI：`tcb hosting deploy . -e 你的环境ID`），即可得到国内高速访问的网址。

## 使用流程

1. 一方：手机号登录 → 创建本子 → 把「邀请码」发给对方
2. 另一方：手机号登录 → 「用邀请码加入」
3. 之后双方看到的是同一份记录和照片，每条记录会显示是谁写的
