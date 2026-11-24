'use strict';
/**
 * 极简 PNG 绘制：零依赖，画教学插图（几何图、坐标图、电路图、光路图…）。
 *
 * 本程序整体零第三方依赖，测试题里要带图又不能联网找图，
 * 所以自己实现一个够用的画布：画直线、圆、矩形、折线，再编码成 PNG。
 *
 * @author zz_lxf
 */
const zlib = require('zlib');

/* ---------------- PNG 编码 ---------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** 把 RGBA 像素编码成 PNG */
function encodePNG(width, height, pixels) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // 过滤器：None
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // 位深
  ihdr[9] = 6;   // 颜色类型 RGBA
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- 画布 ---------------- */

class Canvas {
  constructor(width, height, bg) {
    this.w = width;
    this.h = height;
    this.px = new Uint8Array(width * height * 4);
    const c = bg || [255, 255, 255, 255];
    for (let i = 0; i < width * height; i++) {
      this.px[i * 4] = c[0];
      this.px[i * 4 + 1] = c[1];
      this.px[i * 4 + 2] = c[2];
      this.px[i * 4 + 3] = c[3];
    }
  }

  set(x, y, color, alpha) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const a = alpha === undefined ? 1 : alpha;
    const i = (y * this.w + x) * 4;
    this.px[i] = Math.round(this.px[i] * (1 - a) + color[0] * a);
    this.px[i + 1] = Math.round(this.px[i + 1] * (1 - a) + color[1] * a);
    this.px[i + 2] = Math.round(this.px[i + 2] * (1 - a) + color[2] * a);
    this.px[i + 3] = 255;
  }

  /** 直线（带宽度） */
  line(x1, y1, x2, y2, color, width) {
    const w = width || 2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2) + 1;
    const half = (w - 1) / 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x1 + dx * t;
      const y = y1 + dy * t;
      for (let oy = -half; oy <= half; oy++) {
        for (let ox = -half; ox <= half; ox++) {
          this.set(x + ox, y + oy, color);
        }
      }
    }
  }

  /** 矩形边框 */
  rect(x, y, w, h, color, lw) {
    const t = lw || 2;
    for (let i = 0; i < t; i++) {
      this.line(x + i, y + i, x + w - 1 - i, y + i, color);
      this.line(x + i, y + h - 1 - i, x + w - 1 - i, y + h - 1 - i, color);
      this.line(x + i, y + i, x + i, y + h - 1 - i, color);
      this.line(x + w - 1 - i, y + i, x + w - 1 - i, y + h - 1 - i, color);
    }
  }

  /** 实心矩形 */
  fillRect(x, y, w, h, color) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) this.set(x + i, y + j, color);
    }
  }

  /** 圆/椭圆描边 */
  ellipse(cx, cy, rx, ry, color, width, from, to) {
    const w = width || 2;
    const a0 = from === undefined ? 0 : from;
    const a1 = to === undefined ? Math.PI * 2 : to;
    const steps = Math.max(64, Math.ceil((rx + ry) * 2));
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (a1 - a0) * (i / steps);
      const x = cx + Math.cos(a) * rx;
      const y = cy + Math.sin(a) * ry;
      for (let oy = -Math.floor(w / 2); oy <= Math.floor(w / 2); oy++) {
        for (let ox = -Math.floor(w / 2); ox <= Math.floor(w / 2); ox++) {
          this.set(x + ox, y + oy, color);
        }
      }
    }
  }

  /** 实心圆 */
  fillCircle(cx, cy, r, color) {
    this.ellipse(cx, cy, r, r, color, 1);
    this.fillRect(Math.round(cx - r), Math.round(cy - r), Math.round(r * 2), Math.round(r * 2), color);
    this.ellipse(cx, cy, r, r, color, 1);
  }

  /** 折线 */
  poly(points, color, width, close) {
    for (let i = 0; i < points.length - 1; i++) {
      this.line(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], color, width);
    }
    if (close && points.length > 2) {
      const a = points[points.length - 1];
      const b = points[0];
      this.line(a[0], a[1], b[0], b[1], color, width);
    }
  }

  /** 坐标轴 */
  axes(x0, y0, len, color) {
    this.line(x0, y0, x0 + len, y0, color, 2);
    this.line(x0, y0, x0, y0 - len, color, 2);
    // 箭头
    this.line(x0 + len, y0, x0 + len - 12, y0 - 6, color, 2);
    this.line(x0 + len, y0, x0 + len - 12, y0 + 6, color, 2);
    this.line(x0, y0 - len, x0 - 6, y0 - len + 12, color, 2);
    this.line(x0, y0 - len, x0 + 6, y0 - len + 12, color, 2);
  }

  /** 虚线 */
  dashed(x1, y1, x2, y2, color, width, dash) {
    const d = dash || 10;
    const total = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.ceil(total / d);
    for (let i = 0; i < steps; i += 2) {
      const t1 = i / steps;
      const t2 = Math.min(1, (i + 1) / steps);
      this.line(x1 + (x2 - x1) * t1, y1 + (y2 - y1) * t1, x1 + (x2 - x1) * t2, y1 + (y2 - y1) * t2, color, width);
    }
  }

  /** 小黑点（表示顶点/标记） */
  dot(x, y, r, color) {
    this.ellipse(x, y, r, r, color, 2);
  }

  /**
   * 画文字（5×7 点阵字体，教材插图上标 A、B、O 和数字够用了）。
   * scale 为放大倍数，1 时每个字符 6×8 像素。
   */
  text(x, y, str, color, scale) {
    const s = scale || 1;
    let cx = x;
    for (const ch of String(str).toUpperCase()) {
      const glyph = FONT[ch];
      if (glyph) {
        for (let col = 0; col < 5; col++) {
          const bits = glyph[col];
          for (let row = 0; row < 7; row++) {
            if (!(bits & (1 << row))) continue;
            for (let dy = 0; dy < s; dy++) {
              for (let dx = 0; dx < s; dx++) {
                this.set(cx + col * s + dx, y + row * s + dy, color);
              }
            }
          }
        }
      }
      cx += 6 * s;
    }
    return cx;
  }

  /** 居中文字 */
  textCenter(cx, y, str, color, scale) {
    const w = String(str).length * 6 * (scale || 1);
    this.text(cx - w / 2, y, str, color, scale);
  }

  toPNG() {
    return encodePNG(this.w, this.h, this.px);
  }
}

/* ---------------- 5×7 点阵字体 ----------------
   每个字符 5 列，每列一个字节，bit0 是最上面一行。 */

const FONT = {
  '0': [0x3e, 0x51, 0x49, 0x45, 0x3e], '1': [0x00, 0x42, 0x7f, 0x40, 0x00],
  '2': [0x42, 0x61, 0x51, 0x49, 0x46], '3': [0x21, 0x41, 0x45, 0x4b, 0x31],
  '4': [0x18, 0x14, 0x12, 0x7f, 0x10], '5': [0x27, 0x45, 0x45, 0x45, 0x39],
  '6': [0x3c, 0x4a, 0x49, 0x49, 0x30], '7': [0x01, 0x71, 0x09, 0x05, 0x03],
  '8': [0x36, 0x49, 0x49, 0x49, 0x36], '9': [0x06, 0x49, 0x49, 0x29, 0x1e],
  'A': [0x7e, 0x11, 0x11, 0x11, 0x7e], 'B': [0x7f, 0x49, 0x49, 0x49, 0x36],
  'C': [0x3e, 0x41, 0x41, 0x41, 0x22], 'D': [0x7f, 0x41, 0x41, 0x22, 0x1c],
  'E': [0x7f, 0x49, 0x49, 0x49, 0x41], 'F': [0x7f, 0x09, 0x09, 0x09, 0x01],
  'G': [0x3e, 0x41, 0x49, 0x49, 0x7a], 'H': [0x7f, 0x08, 0x08, 0x08, 0x7f],
  'I': [0x00, 0x41, 0x7f, 0x41, 0x00], 'J': [0x20, 0x40, 0x41, 0x3f, 0x01],
  'K': [0x7f, 0x08, 0x14, 0x22, 0x41], 'L': [0x7f, 0x40, 0x40, 0x40, 0x40],
  'M': [0x7f, 0x02, 0x0c, 0x02, 0x7f], 'N': [0x7f, 0x04, 0x08, 0x10, 0x7f],
  'O': [0x3e, 0x41, 0x41, 0x41, 0x3e], 'P': [0x7f, 0x09, 0x09, 0x09, 0x06],
  'Q': [0x3e, 0x41, 0x51, 0x21, 0x5e], 'R': [0x7f, 0x09, 0x19, 0x29, 0x46],
  'S': [0x46, 0x49, 0x49, 0x49, 0x31], 'T': [0x01, 0x01, 0x7f, 0x01, 0x01],
  'U': [0x3f, 0x40, 0x40, 0x40, 0x3f], 'V': [0x1f, 0x20, 0x40, 0x20, 0x1f],
  'W': [0x3f, 0x40, 0x38, 0x40, 0x3f], 'X': [0x63, 0x14, 0x08, 0x14, 0x63],
  'Y': [0x07, 0x08, 0x70, 0x08, 0x07], 'Z': [0x61, 0x51, 0x49, 0x45, 0x43],
  '+': [0x08, 0x08, 0x3e, 0x08, 0x08], '-': [0x08, 0x08, 0x08, 0x08, 0x08],
  '=': [0x14, 0x14, 0x14, 0x14, 0x14], '.': [0x00, 0x60, 0x60, 0x00, 0x00],
  ',': [0x00, 0x50, 0x30, 0x00, 0x00], '(': [0x00, 0x1c, 0x22, 0x41, 0x00],
  ')': [0x00, 0x41, 0x22, 0x1c, 0x00], '/': [0x20, 0x10, 0x08, 0x04, 0x02],
  ':': [0x00, 0x36, 0x36, 0x00, 0x00], '°': [0x00, 0x07, 0x05, 0x07, 0x00],
  '²': [0x00, 0x21, 0x15, 0x09, 0x00], '²': [0x00, 0x21, 0x15, 0x09, 0x00],
  '√': [0x18, 0x18, 0x24, 0x42, 0x7f], '∥': [0x22, 0x22, 0x22, 0x22, 0x22]
};

/* ---------------- 常用教学插图 ---------------- */

const BLACK = [30, 30, 30];
const GRAY = [120, 120, 120];
const BLUE = [40, 90, 170];
const RED = [190, 60, 50];

/** 直角三角形：顶点 A(左上) B(右下) C(右下)，直角在 B */
function triangleABC(size) {
  const c = new Canvas(size, size);
  const A = [size * 0.18, size * 0.2];
  const B = [size * 0.78, size * 0.78];
  const C = [size * 0.22, size * 0.78];
  c.poly([A, B, C], BLACK, 3, true);
  c.line(B[0], B[1], B[0] + 16, B[1], BLACK, 2);      // 直角标记
  c.line(B[0] + 16, B[1], B[0] + 16, B[1] - 16, BLACK, 2);
  c.line(B[0] + 16, B[1] - 16, B[0], B[1] - 16, BLACK, 2);
  c.dot(A[0], A[1], 5, BLACK);
  c.dot(B[0], B[1], 5, BLACK);
  c.dot(C[0], C[1], 5, BLACK);
  c.text(A[0] - 16, A[1] - 20, 'A', BLACK, 2);
  c.text(B[0] + 8, B[1] + 4, 'B', BLACK, 2);
  c.text(C[0] - 16, C[1] + 6, 'C', BLACK, 2);
  c.textCenter((A[0] + C[0]) / 2 - 6, (A[1] + C[1]) / 2 - 4, '6', BLACK, 1);
  c.textCenter((B[0] + C[0]) / 2, B[1] + 10, '8', BLACK, 1);
  return c;
}

/** 坐标系 + 抛物线 */
function parabolaAxes(size) {
  const c = new Canvas(size, size);
  const ox = size * 0.16;
  const oy = size * 0.72;
  c.axes(ox, oy, size * 0.72, BLACK);
  const pts = [];
  for (let x = 0; x <= 1.001; x += 0.01) {
    const px = ox + x * size * 0.72;
    const py = oy - (4 * x * x - 3 * x + 1.4) * size * 0.16;
    if (py > 6 && py < size - 4) pts.push([px, py]);
  }
  c.poly(pts, BLUE, 3);
  c.dot(ox + size * 0.72 * 0.5, oy, 5, RED);
  c.text(ox + size * 0.72 + 4, oy - 4, 'X', BLACK, 2);
  c.text(ox - 16, oy - size * 0.72 - 4, 'Y', BLACK, 2);
  c.text(ox - 12, oy + 4, 'O', BLACK, 2);
  return c;
}

/** 电路图：电池、开关、电阻、灯泡 */
function circuitDiagram(size) {
  const c = new Canvas(size, Math.round(size * 0.62));
  const H = c.h;
  const x0 = size * 0.12;
  const x1 = size * 0.88;
  const yTop = H * 0.24;
  const yBot = H * 0.76;
  const bx = size * 0.3;
  const rx = size * 0.45;
  const sx = size * 0.62;
  const lx = size * 0.8;

  // 上导线：电阻、开关、灯泡所在的一行
  c.line(x0, yTop, rx - 26, yTop, BLACK, 3);
  c.line(rx + 26, yTop, sx - 22, yTop, BLACK, 3);
  c.line(sx + 22, yTop, lx, yTop, BLACK, 3);
  c.line(lx, yTop, x1, yTop, BLACK, 3);
  // 下导线（电池处断开）
  c.line(x0, yBot, bx - 9, yBot, BLACK, 3);
  c.line(bx + 9, yBot, x1, yBot, BLACK, 3);
  // 左右两条竖导线
  c.line(x0, yTop, x0, yBot, BLACK, 3);
  c.line(x1, yTop, x1, yBot, BLACK, 3);

  // 电池：两条竖直的长短横线，长线为正极
  c.line(bx - 9, yBot - 16, bx - 9, yBot + 16, BLACK, 3);
  c.line(bx + 9, yBot - 8, bx + 9, yBot + 8, BLACK, 3);

  // 电阻（矩形骑在导线上）
  c.rect(rx - 26, yTop - 9, 52, 18, BLACK, 2);

  // 开关
  c.line(sx - 22, yTop, sx - 22, yTop - 12, BLACK, 3);
  c.line(sx + 22, yTop, sx + 22, yTop - 12, BLACK, 3);
  c.line(sx - 22, yTop - 12, sx + 16, yTop - 26, BLACK, 3);

  // 灯泡：圆圈底部与导线相接
  c.ellipse(lx, yTop - 16, 16, 16, BLACK, 3);
  c.line(lx - 10, yTop - 26, lx + 10, yTop - 6, BLACK, 2);
  c.line(lx + 10, yTop - 26, lx - 10, yTop - 6, BLACK, 2);

  // 标注
  c.text(sx - 6, yTop - 46, 'S', BLACK, 2);
  c.text(lx - 6, yTop - 54, 'L', BLACK, 2);
  c.text(rx - 6, yTop + 14, 'R', BLACK, 2);
  c.text(bx - 3, yBot + 22, 'E', BLACK, 2);
  return c;
}

/** 光的反射与折射 */
function lightPath(size) {
  const c = new Canvas(size, Math.round(size * 0.68));
  const H = c.h;
  const yIface = H * 0.42;
  const x0 = size * 0.06;
  const x1 = size * 0.94;
  c.dashed(x0, yIface, x1, yIface, GRAY, 2, 12);   // 界面
  const xA = size * 0.5;
  c.dashed(xA, yIface - H * 0.38, xA, yIface + H * 0.42, GRAY, 2, 10); // 法线
  c.line(size * 0.2, yIface + H * 0.34, xA, yIface, BLUE, 3);   // 入射
  c.line(xA, yIface, size * 0.3, yIface - H * 0.34, RED, 3);    // 反射
  c.line(xA, yIface, size * 0.72, yIface + H * 0.4, BLUE, 3);   // 折射
  c.text(xA + 6, yIface - H * 0.38 - 12, 'N', BLACK, 2);
  c.text(size * 0.08, yIface - 14, 'AIR', GRAY, 1);
  c.text(size * 0.08, yIface + 16, 'GLASS', GRAY, 1);
  return c;
}

/** 杠杆示意图 */
function lever(size) {
  const c = new Canvas(size, Math.round(size * 0.6));
  const H = c.h;
  const y = H * 0.45;
  const x0 = size * 0.08;
  const x1 = size * 0.92;
  c.line(x0, y, x1, y, BLACK, 4);
  // 支点
  const px = size * 0.5;
  c.poly([[px, y + 4], [px - 22, y + 46], [px + 22, y + 46]], BLACK, 3, true);
  // 挂钩（力）
  c.line(size * 0.22, y, size * 0.22, y + 42, BLACK, 3);
  c.fillRect(size * 0.22 - 16, y + 42, 32, 22, BLACK);
  c.line(size * 0.8, y, size * 0.8, y + 42, BLACK, 3);
  c.fillRect(size * 0.8 - 16, y + 42, 32, 22, GRAY);
  c.text(size * 0.2 - 6, y + 68, 'A', BLACK, 2);
  c.text(size * 0.78 - 6, y + 68, 'B', BLACK, 2);
  c.text(px - 6, y + 68, 'O', BLACK, 2);
  return c;
}

/** 圆与切线 */
function circleTangent(size) {
  const c = new Canvas(size, size);
  const cx = size * 0.42;
  const cy = size * 0.52;
  const r = size * 0.28;
  c.ellipse(cx, cy, r, r, BLACK, 3);
  c.line(cx + r, cy, size * 0.94, cy - size * 0.3, BLACK, 3);  // 切线
  c.line(cx, cy, cx + r, cy, GRAY, 2);                          // 半径
  c.dot(cx, cy, 5, BLACK);
  c.dot(cx + r, cy, 5, RED);
  c.text(cx - 16, cy + 4, 'O', BLACK, 2);
  c.text(cx + r + 6, cy - 4, 'A', BLACK, 2);
  return c;
}

/** 数轴 */
function numberLine(size) {
  const c = new Canvas(size, Math.round(size * 0.36));
  const y = c.h * 0.5;
  const x0 = size * 0.08;
  const x1 = size * 0.92;
  c.line(x0, y, x1, y, BLACK, 3);
  c.line(x1, y, x1 - 14, y - 7, BLACK, 3);
  c.line(x1, y, x1 - 14, y + 7, BLACK, 3);
  for (let i = 0; i <= 10; i++) {
    const x = x0 + (x1 - x0) * (i / 10);
    c.line(x, y - 7, x, y + 7, BLACK, 2);
    c.dot(x, y, 3, BLACK);
  }
  // 刻度数字：-1 0 1
  c.text(x0 + (x1 - x0) * 0.4 - 10, y + 10, '-1', BLACK, 1);
  c.text(x0 + (x1 - x0) * 0.5 - 3, y + 10, '0', BLACK, 1);
  c.text(x0 + (x1 - x0) * 0.6 - 3, y + 10, '1', BLACK, 1);
  // 标记点 A
  const ax = x0 + (x1 - x0) * 0.45;
  c.dot(ax, y, 6, RED);
  c.text(ax - 4, y - 22, 'A', RED, 2);
  return c;
}

/** 磁感线 */
function magneticField(size) {
  const c = new Canvas(size, Math.round(size * 0.6));
  const H = c.h;
  const cx = size * 0.5;
  const cy = H * 0.5;
  c.rect(cx - 34, cy - 90, 68, 180, BLACK, 3);   // 条形磁铁
  for (let i = 0; i <= 8; i++) {
    const x = cx - 34 + (68 * i) / 8;
    const side = i % 2 === 0 ? -1 : 1;
    c.ellipse(x, cy + side * 40, 22, 34, GRAY, 2, side < 0 ? Math.PI : 0, side < 0 ? Math.PI * 2 : Math.PI);
  }
  c.text(cx - 6, cy - 12, 'N', BLACK, 2);
  c.text(cx - 6, cy + 4, 'S', BLACK, 2);
  return c;
}

/** 柱状统计图（带坐标轴） */
function barChart(size) {
  const c = new Canvas(size, Math.round(size * 0.72));
  const H = c.h;
  const ox = size * 0.12;
  const oy = H * 0.86;
  const h = H * 0.72;
  c.line(ox, oy, ox, H * 0.08, BLACK, 3);
  c.line(ox, oy, size * 0.94, oy, BLACK, 3);
  const data = [[0.45, 'A'], [0.7, 'B'], [0.35, 'C'], [0.85, 'D'], [0.55, 'E']];
  const bw = size * 0.11;
  const gap = size * 0.05;
  let x = ox + size * 0.06;
  for (const [hh, label] of data) {
    c.rect(x, oy - h * hh, bw, h * hh, BLACK, 2);
    c.textCenter(x + bw / 2, oy + 8, label, BLACK, 1);
    c.textCenter(x + bw / 2, oy - h * hh - 14, String(Math.round(hh * 40)), BLACK, 1);
    x += bw + gap;
  }
  c.text(ox - 20, H * 0.08 - 4, '40', BLACK, 1);
  return c;
}

module.exports = {
  Canvas, encodePNG,
  BLACK, GRAY, BLUE, RED,
  triangleABC, parabolaAxes, circuitDiagram, lightPath,
  lever, circleTangent, numberLine, magneticField, barChart
};
