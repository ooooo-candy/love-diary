# 云端版部署指南（腾讯云 CloudBase）

把 App 从「本地模式」升级为「云端共享版」：账号登录、两人共用一本、照片存云端。

## 第 1 步：开通 CloudBase

1. 打开 https://tcb.cloud.tencent.com ，用腾讯云账号登录
2. 创建环境：选择「按量计费」（有免费额度，个人使用基本够）
3. 记下 **环境 ID**（形如 `xxx-1a2b3c4d`）

## 第 2 步：不需要数据库 ✅

本方案把整份数据存成云存储里的一个 JSON 文件（`love-diary/data.json`），
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

## 第 4 步：配置邮箱验证码（QQ 邮箱，已配置好可直接跳过）

**不配置也能用**：此时处于「演示模式」，验证码会直接显示在界面上。
配置后验证码通过邮件发送，代码无需任何改动。

### 需要两个值

| 变量 | 从哪里拿 |
|---|---|
| `MAIL_USER` | 你的 QQ 邮箱地址，例如 `123456789@qq.com` |
| `MAIL_PASS` | **SMTP 授权码**（不是 QQ 密码！） |

**授权码获取步骤：**

1. 电脑浏览器登录 https://mail.qq.com
2. 右上角 **设置 → 账户**（新版在「账号与安全 → 安全设置」）
3. 找到 **「POP3/IMAP/SMTP/Exchange/CardDAV/CalDAV服务」**
4. 开启 **「IMAP/SMTP 服务」**，按提示用手机发一条短信验证
5. 验证通过后弹出 **16 位授权码**（形如 `abcd efgh ijkl mnop`），复制它（去掉空格）

### 写到云函数

```bash
# 在 cloudbaserc.json 的 functions[0] 里临时加上环境变量后部署：
{
  "name": "api",
  ...
  "envVariables": {
    "MAIL_USER": "123456789@qq.com",
    "MAIL_PASS": "abcdefghijklmnop",
    "MAIL_HOST": "smtp.qq.com",
    "MAIL_PORT": "465",
    "MAIL_APP_NAME": "朝暮"
  }
}
# 然后
tcb fn deploy api --force
```

> 也可以直接在控制台「云函数 → api → 函数配置 → 环境变量」里加，效果一样。
> 部署完成后建议把 `envVariables` 从 `cloudbaserc.json` 里删掉再提交，避免授权码进仓库
> （环境变量已存在云端，之后重新部署不会丢失）。

配好后在 App 里发一次验证码，邮箱就能收到信了。QQ 邮箱每天限额约 50 封，两个人用绰绰有余。

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

```bash
npm run publish      # 生成 public/ 并上传到 CloudBase 静态托管
```

## 使用流程

1. 一方：注册（用户名或邮箱）→ 创建本子 → 把「邀请码」发给对方
2. 另一方：注册 → 「用邀请码加入」
3. 之后双方看到的是同一份记录和照片，每条记录会显示是谁写的

## 找回密码

- 答对**密保问题** → 重设密码
- 用**恢复码** → 重设密码
- 用**邮箱验证码**（需已绑定邮箱）→ 重设密码
