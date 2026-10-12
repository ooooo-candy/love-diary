/* 一键发布前端到 CloudBase 静态托管
 * 用法：npm run publish
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

const FILES = ['index.html', 'manifest.webmanifest', 'sw.js'];
const DIRS = ['css', 'js', 'icons'];

function readEnvId() {
  try {
    const conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'cloudbaserc.json'), 'utf8'));
    return conf.envId;
  } catch (err) {
    return process.env.TCB_ENV || '';
  }
}

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, item.name);
    const d = path.join(dest, item.name);
    if (item.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const envId = readEnvId();
if (!envId) {
  console.error('✖ 没找到 envId，请检查 cloudbaserc.json');
  process.exit(1);
}

rmrf(PUBLIC_DIR);
fs.mkdirSync(PUBLIC_DIR, { recursive: true });
FILES.forEach((f) => fs.copyFileSync(path.join(ROOT, f), path.join(PUBLIC_DIR, f)));
DIRS.forEach((d) => copyDir(path.join(ROOT, d), path.join(PUBLIC_DIR, d)));

/* 打包好的 APK 一并发布，手机点链接即可下载安装 */
const apkSrc = fs
  .readdirSync(ROOT)
  .filter((f) => /\.apk$/i.test(f))
  .map((f) => path.join(ROOT, f))[0];
if (apkSrc) {
  fs.copyFileSync(apkSrc, path.join(PUBLIC_DIR, 'chaomu.apk'));
  console.log('✔ 已带上安装包 ' + path.basename(apkSrc) + ' → chaomu.apk');
}

const count = (function walk(p) {
  return fs.readdirSync(p, { withFileTypes: true }).reduce(
    (n, it) => n + (it.isDirectory() ? walk(path.join(p, it.name)) : 1),
    0
  );
})(PUBLIC_DIR);

console.log('✔ 已准备发布目录 public/（' + count + ' 个文件）');

if (process.argv.indexOf('--no-deploy') >= 0) {
  console.log('（--no-deploy：跳过上传）');
} else {
  console.log('▶ 上传到 CloudBase 静态托管…');
  execSync(`tcb hosting deploy public -e ${envId}`, { stdio: 'inherit', cwd: ROOT });
}
