/* 生成 Android 应用图标与启动图（粉紫渐变 + 白色心形）
 * 用法：node scripts/gen-icons.js
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const RES = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');

const C0 = [255, 107, 157]; // 品牌粉
const C1 = [167, 139, 250]; // 品牌紫
const WHITE = [255, 255, 255];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const tb = Buffer.from(type, 'ascii');
  const cb = Buffer.alloc(4);
  cb.writeUInt32BE(crc32(Buffer.concat([tb, data])));
  return Buffer.concat([len, tb, data, cb]);
}

function png(W, H, painter) {
  const raw = Buffer.alloc((W * 4 + 1) * H);
  let p = 0;
  for (let y = 0; y < H; y++) {
    raw[p++] = 0;
    for (let x = 0; x < W; x++) {
      const px = painter(x, y);
      raw[p++] = px[0];
      raw[p++] = px[1];
      raw[p++] = px[2];
      raw[p++] = px[3];
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* 心形判定：点在经典心形曲线内返回 true */
function inHeart(x, y, cx, cy, size) {
  const nx = ((x - cx) / size) * 2.35;
  const ny = -(((y - cy) / size) * 2.35 - 0.35);
  const a = nx * nx + ny * ny - 1;
  return a * a * a - nx * nx * ny * ny * ny <= 0;
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/* mode: 'icon' 渐变底+白心 / 'round' 同上但圆形裁剪 / 'fg' 透明底白心（自适应图标前景） / 'splash' 渐变底+白心 */
function make(w, h, mode) {
  const cx = w / 2;
  const cy = h * (mode === 'splash' ? 0.5 : 0.5);
  const size = Math.min(w, h) * (mode === 'fg' ? 0.42 : mode === 'splash' ? 0.2 : 0.64);
  const SS = 3;

  return png(w, h, (x, y) => {
    // 圆形裁剪（自适应用不到，round 图标用）
    if (mode === 'round') {
      const dx = x - w / 2;
      const dy = y - h / 2;
      if (Math.sqrt(dx * dx + dy * dy) > w / 2 - 0.5) return [0, 0, 0, 0];
    }

    let hits = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        if (inHeart(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS, cx, cy, size)) hits++;
      }
    }
    const cover = hits / (SS * SS);

    if (mode === 'fg') {
      // 透明背景 + 白色心形（系统会叠在背景色上）
      const v = Math.round(255 * cover);
      return [255, 255, 255, v];
    }

    const t = Math.min(1, Math.max(0, (x / w + y / h) / 2));
    const base = mix(C0, C1, t);
    const r = base[0] + (WHITE[0] - base[0]) * cover;
    const g = base[1] + (WHITE[1] - base[1]) * cover;
    const b = base[2] + (WHITE[2] - base[2]) * cover;
    return [Math.round(r), Math.round(g), Math.round(b), 255];
  });
}

const ICON_SIZES = { 'mipmap-mdpi': 48, 'mipmap-hdpi': 72, 'mipmap-xhdpi': 96, 'mipmap-xxhdpi': 144, 'mipmap-xxxhdpi': 192 };
const FG_SIZES = { 'mipmap-mdpi': 108, 'mipmap-hdpi': 162, 'mipmap-xhdpi': 216, 'mipmap-xxhdpi': 324, 'mipmap-xxxhdpi': 432 };

let written = 0;

Object.keys(ICON_SIZES).forEach((dir) => {
  const s = ICON_SIZES[dir];
  const target = path.join(RES, dir);
  if (!fs.existsSync(target)) return;
  fs.writeFileSync(path.join(target, 'ic_launcher.png'), make(s, s, 'icon'));
  fs.writeFileSync(path.join(target, 'ic_launcher_round.png'), make(s, s, 'round'));
  written += 2;
});

Object.keys(FG_SIZES).forEach((dir) => {
  const s = FG_SIZES[dir];
  const target = path.join(RES, dir);
  if (!fs.existsSync(target)) return;
  fs.writeFileSync(path.join(target, 'ic_launcher_foreground.png'), make(s, s, 'fg'));
  written += 1;
});

/* 启动图：按现有文件的尺寸重新生成 */
function pngSize(file) {
  try {
    const buf = fs.readFileSync(file);
    if (buf.slice(1, 4).toString() !== 'PNG') return null;
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } catch (err) {
    return null;
  }
}

fs.readdirSync(RES)
  .filter((d) => d.indexOf('drawable') === 0)
  .forEach((d) => {
    const dir = path.join(RES, d);
    const splash = path.join(dir, 'splash.png');
    if (!fs.existsSync(splash)) return;
    const size = pngSize(splash);
    if (!size) return;
    fs.writeFileSync(splash, make(size.w, size.h, 'splash'));
    written++;
  });

console.log('✔ 图标与启动图已生成，共写入 ' + written + ' 个文件');
