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

## 第 4 步：开通真实短信（可选，但建议）

**不配置也能用**：此时 App 处于「演示模式」，注册/找回密码的验证码会直接显示在界面上。
配置真实短信后，验证码通过手机短信发送，代码无需任何改动。

### 需要准备的 5 个值

| 变量 | 从哪里拿 |
|---|---|
| `SMS_SECRET_ID` / `SMS_SECRET_KEY` | 腾讯云控制台 → 访问管理 CAM → API 密钥管理 → 新建密钥 |
| `SMS_SDK_APP_ID` | 短信控制台 → 应用管理 → 应用列表里的 SDKAppID |
| `SMS_TEMPLATE_ID` | 短信控制台 → 国内短信 → 正文模板管理 → 新建（内容例如：`您的验证码是{1}，{2}分钟内有效`） |
| `SMS_SIGN` | 短信控制台 → 国内短信 → 签名管理 → 新建（个人可申请 1 个自用签名） |

> 签名和模板都要经过审核（一般 1~2 个工作日）。费用约 0.035 元/条，
> 两个人日常使用一个月几块钱。我们的云函数按 `[验证码, 有效分钟数]` 两个参数发送，
> 所以模板里要留两个变量位 `{1}` `{2}`。

### 配置到云函数

控制台 →「云函数」→ `api` → 函数配置 → 环境变量 → 添加上面 5 个 → 保存。

然后重新部署一次让配置稳定生效：

```bash
npm run deploy:fn
```

配好后，在 App 里发一次验证码，手机上就能收到真短信了。

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
