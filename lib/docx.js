'use strict';
/**
 * 最小可用的 .docx 解析：手写 zip 读取 + 提取正文段落。
 * 只依赖 Node 内置 zlib，不装任何 npm 包。
 * 图片、批注、页眉页脚忽略；正文段落顺序保留。
 */
const zlib = require('zlib');

/** 单个 zip 条目解压后的体积上限（32MB），防御解压炸弹 */
const MAX_INFLATE = 32 * 1024 * 1024;

function findEndOfCentralDirectory(buf) {
  const max = Math.min(buf.length, 66000);
  for (let i = buf.length - 22; i >= buf.length - max; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

function readZipEntry(buf, entryName) {
  const eocd = findEndOfCentralDirectory(buf);
  if (eocd < 0) throw new Error('不是有效的 docx 文件');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nameLen).toString('utf8');
    if (name === entryName) {
      const lnameLen = buf.readUInt16LE(localOff + 26);
      const lextraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lnameLen + lextraLen;
      const raw = buf.slice(dataStart, dataStart + compSize);
      if (method === 0) return raw;
      if (method === 8) {
        // 必须限制解压后的体积：docx 里的正文是高度可压缩的，
        // 构造一个几百 KB 的文件就能膨胀到几个 GB，直接把进程内存打爆。
        try {
          return zlib.inflateRawSync(raw, { maxOutputLength: MAX_INFLATE });
        } catch (e) {
          if (e && /maxOutputLength|Cannot create a Buffer/i.test(e.message || '')) {
            throw new Error('这份 docx 解压后体积过大（可能不是正常的 Word 文件），已拒绝导入');
          }
          throw e;
        }
      }
      throw new Error('docx 压缩方式不支持');
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function decodeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/** 把 document.xml 转成纯文本段落数组 */
function docxToParagraphs(buffer) {
  const xmlBuf = readZipEntry(buffer, 'word/document.xml');
  if (!xmlBuf) throw new Error('docx 里找不到正文内容');
  const xml = xmlBuf.toString('utf8');

  const paras = [];
  const pRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let m;
  while ((m = pRe.exec(xml))) {
    const body = m[1];
    let text = '';
    const tRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
    let t;
    while ((t = tRe.exec(body))) text += decodeXml(t[1]);
    // 换行符、制表符、公式占位
    if (/<w:br\b/.test(body)) text += '\n';
    if (/<m:oMath\b/.test(body) && !text.trim()) text = '[公式]';
    const clean = text.replace(/\u00a0/g, ' ').replace(/[ \t]+$/g, '');
    paras.push(clean);
  }
  return paras;
}

/** 段落数组转成讲义可用的纯文本（空行分隔） */
function paragraphsToText(paras) {
  const out = [];
  let blank = 0;
  for (const p of paras) {
    const t = String(p || '').trim();
    if (!t) {
      blank++;
      if (blank === 1) out.push('');
      continue;
    }
    blank = 0;
    out.push(t);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------------- 生成 docx（导出试卷用） ---------------- */

function crc32(buf) {
  if (zlib.crc32) return zlib.crc32(buf) >>> 0;
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function zipStore(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const data = e.data;
    const nameBuf = Buffer.from(e.name, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, data);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);

    offset += 30 + nameBuf.length + data.length;
  }
  const cenBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cenBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([Buffer.concat(locals), cenBuf, eocd]);
}

function xmlEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const EMU_PER_PX = 9525;

/**
 * 生成一个可被 Word 打开的 docx。
 * blocks 支持两种：
 *   { text, bold, size, align, spaceAfter }                               文字段落
 *   { image: { data: Buffer, ext, width, height }, align, spaceAfter }    插图段落
 */
function buildDocx(blocks) {
  const media = [];
  const rels = [];
  const body = (blocks || []).map((b) => {
    const t = String(b.text == null ? '' : b.text).replace(/\r/g, '');
    const jc = b.align === 'center' ? '<w:jc w:val="center"/>' : '';
    const spacing = '<w:spacing w:before="0" w:after="' + (b.spaceAfter === undefined ? 80 : b.spaceAfter) + '" w:line="360" w:lineRule="auto"/>';
    const ppr = '<w:pPr>' + spacing + jc + '</w:pPr>';

    if (b.image && b.image.data) {
      const n = media.length + 1;
      const ext = String(b.image.ext || 'png').replace(/[^a-z0-9]/gi, '') || 'png';
      const fileName = 'image' + n + '.' + ext;
      media.push({ name: 'word/media/' + fileName, data: b.image.data });
      const rid = 'rIdImg' + n;
      rels.push('<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + fileName + '"/>');
      const w = Math.max(20, Math.min(Number(b.image.width) || 300, 560));
      const h = Math.max(20, Math.round(w * ((Number(b.image.height) || 200) / (Number(b.image.width) || 300))));
      const cx = Math.round(w * EMU_PER_PX);
      const cy = Math.round(h * EMU_PER_PX);
      return '<w:p>' + ppr + '<w:r><w:drawing>' +
        '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
        '<wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
        '<wp:docPr id="' + (100 + n) + '" name="Picture ' + n + '"/>' +
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
        '<pic:pic>' +
        '<pic:nvPicPr><pic:cNvPr id="' + (100 + n) + '" name="' + fileName + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
        '<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
        '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
    }

    const runs = t.split('\n').map((line, i) =>
      (i ? '<w:r><w:br/></w:r>' : '') +
      '<w:r><w:rPr>' +
      (b.bold ? '<w:b/>' : '') +
      '<w:sz w:val="' + Math.round((b.size || 11) * 2) + '"/>' +
      '<w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体" w:hAnsi="Times New Roman"/>' +
      '</w:rPr><w:t xml:space="preserve">' + xmlEsc(line) + '</w:t></w:r>'
    ).join('');
    return '<w:p>' + ppr + runs + '</w:p>';
  }).join('');

  const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
    ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"' +
    ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
    ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<w:body>' + body +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>' +
    '</w:body></w:document>';

  const exts = Array.from(new Set(media.map((m) => m.name.split('.').pop())));
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    exts.map((e) => '<Default Extension="' + e + '" ContentType="image/' + (e === 'jpg' ? 'jpeg' : e) + '"/>').join('') +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>';

  const pkgRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';

  const docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels.join('') + '</Relationships>';

  const entries = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(pkgRels, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(doc, 'utf8') }
  ];
  if (rels.length) entries.push({ name: 'word/_rels/document.xml.rels', data: Buffer.from(docRels, 'utf8') });
  for (const m of media) entries.push({ name: m.name, data: m.data });
  return zipStore(entries);
}

module.exports = { docxToParagraphs, paragraphsToText, readZipEntry, buildDocx };
