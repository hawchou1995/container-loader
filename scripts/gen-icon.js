// 生成应用图标 assets/icon.png (256x256) — 纯 Node 无依赖
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
// 画一个蓝色集装箱 + 橙黄色箱子的简单图标
function render() {
  const px = Buffer.alloc(SIZE * SIZE * 4); // RGBA
  const bg = [31, 45, 61, 255]; // 深蓝灰底
  const cont = [47, 111, 237, 255]; // 主蓝
  const contDark = [30, 85, 201, 255];
  const box = [255, 181, 32, 255]; // 橙色箱子
  const boxDark = [214, 128, 0, 255];

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      let c = bg;
      // 集装箱主体（圆角矩形简化）：区域 40..216 x 56..216
      const inX = x >= 40 && x <= 216;
      const inY = y >= 56 && y <= 216;
      if (inX && inY) {
        c = cont;
        // 波纹/横杠
        if (y >= 120 && y <= 124) c = contDark;
        if (y >= 148 && y <= 152) c = contDark;
        if (y >= 176 && y <= 180) c = contDark;
        // 集装箱竖线（门）
        if (x >= 148 && x <= 152) c = contDark;
      }
      // 箱子（前景）：96..176 x 88..148
      const inBox = x >= 88 && x <= 176 && y >= 80 && y <= 148;
      if (inBox) {
        c = box;
        // 箱面线条
        if (y >= 112 && y <= 116) c = boxDark;
        if (x >= 132 && x <= 136) c = boxDark;
        if (y >= 148 && y <= 152) c = contDark; // 箱底阴影线
      }
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = c[3];
    }
  }
  return px;
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function makePng(px, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  // 每行前加 filter byte 0
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const px = render();
const png = makePng(px, SIZE);
const out = path.join(__dirname, '..', 'assets', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('icon written:', out, png.length, 'bytes');
