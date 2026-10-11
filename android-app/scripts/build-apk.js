/* 一键重新打包 Android APK
 * 用法（在项目根目录）：npm run apk
 * 前提：已安装 JDK 17 与 Android SDK（build-tools 34 / platform 34）
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const APP_DIR = path.join(__dirname, '..');
const ANDROID_DIR = path.join(APP_DIR, 'android');

/* 必须用 JDK 17（系统的 JAVA_HOME 可能仍是 1.8，不能直接用） */
function pickJdk() {
  const candidates = [
    process.env.JDK17_HOME,
    'C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.20.101-hotspot'
  ].filter(Boolean);
  candidates.push(process.env.JAVA_HOME);
  for (const p of candidates) {
    if (p && fs.existsSync(path.join(p, 'bin', 'java.exe'))) return p;
  }
  throw new Error('没有找到 JDK 17，请先安装（winget install EclipseAdoptium.Temurin.17.JDK）');
}

function pickSdk() {
  const candidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, 'C:\\Users\\oukai\\Android\\Sdk'];
  for (const p of candidates) {
    if (p && fs.existsSync(path.join(p, 'platform-tools'))) return p;
  }
  throw new Error('没有找到 Android SDK');
}

const JDK = pickJdk();
const SDK = pickSdk();
console.log('使用 JDK: ' + JDK);
console.log('使用 SDK: ' + SDK);

function run(cmd, cwd) {
  console.log('▶ ' + cmd);
  execSync(cmd, { cwd: cwd || ROOT, stdio: 'inherit', env: Object.assign({}, process.env, { JAVA_HOME: JDK, ANDROID_HOME: SDK }) });
}

// 1) 生成最新前端静态文件（只准备 public/，不上传）
run('node scripts/publish.js --no-deploy', ROOT);

// 2) 清掉插件构建残留（避免 Capacitor 同步时被安全删除策略打断）
try {
  execSync('cmd /c rmdir /s /q "' + path.join(ANDROID_DIR, 'capacitor-cordova-android-plugins') + '"', { stdio: 'ignore' });
} catch (err) { /* 不存在就忽略 */ }

// 3) 同步到 Android 工程
run('npx cap sync android', APP_DIR);

// 3) 生成图标（可选，改了图标才需要）
try {
  run('node scripts/gen-icons.js', APP_DIR);
} catch (err) {
  console.log('（图标生成跳过）');
}

// 4) Gradle 编译
const gradlew = path.join(ANDROID_DIR, process.platform === 'win32' ? 'gradlew.bat' : './gradlew');
run(`"${gradlew}" assembleRelease`, ANDROID_DIR);

// 5) 拷贝产物
const apk = path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
if (fs.existsSync(apk)) {
  const out = path.join(ROOT, '小日子-v1.0.apk');
  fs.copyFileSync(apk, out);
  const mb = (fs.statSync(out).size / 1048576).toFixed(1);
  console.log('\n✔ 打包完成：' + out + '（' + mb + ' MB）');
} else {
  console.error('✖ 没有找到 APK 产物');
}
