// =========================================================================
// Интегрированный движок документов: строго PDF и DOCX (Microsoft Word + PDF-режим)
// Двусторонний OpenXML .docx (чтение, live-редактирование как в MS Word, сохранение как .docx)
// =========================================================================
window.WB = window.WB || {};

(function () {
  const PAGE_W = 892;
  const PAGE_H = 1262;

  const DOC_META = {
    pdf: { kind: 'pdf', label: 'PDF', accentColor: '#dc2626', isDocument: true },
    docx: { kind: 'docx', label: 'DOCX', accentColor: '#2563eb', isDocument: true },
    image: { kind: 'image', label: 'IMG', accentColor: '#059669', isDocument: false },
    unsupported: { kind: 'unsupported', label: 'FILE', accentColor: '#64748b', isDocument: false }
  };

  const WORD_HIGHLIGHT_TO_HEX = {
    yellow: '#fef08a',
    green: '#bbf7d0',
    cyan: '#a5f3fc',
    magenta: '#f5d0fe',
    blue: '#bfdbfe',
    red: '#fecaca',
    darkyellow: '#fde047',
    lightgray: '#e2e8f0',
    darkgray: '#cbd5e1',
    black: '#1e293b'
  };

  WB.detectDocumentMeta = function (filename, mimeType = '') {
    const name = String(filename || '').trim().toLowerCase();
    const mime = String(mimeType || '').trim().toLowerCase();
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';

    if (ext === 'pdf' || mime === 'application/pdf') return DOC_META.pdf;
    if (
      ext === 'docx' ||
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      return DOC_META.docx;
    }
    if (
      ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'avif'].includes(ext) ||
      mime.startsWith('image/')
    ) {
      return DOC_META.image;
    }
    return DOC_META.unsupported;
  };

  function decodeXmlEntities(str) {
    return String(str || '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)));
  }

  function escapeXml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeHexColor(raw) {
    if (!raw) return undefined;
    const s = String(raw).trim().toLowerCase();
    if (!s || s === 'auto' || s === 'none' || s === 'transparent' || s === 'rgba(0, 0, 0, 0)') {
      return undefined;
    }
    if (/^#[0-9a-f]{6}$/.test(s)) return s;
    if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
    if (/^#[0-9a-f]{3}$/.test(s)) {
      return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
    }
    const rgbM = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgbM) {
      const toH = (v) => Math.max(0, Math.min(255, Number(v))).toString(16).padStart(2, '0');
      return `#${toH(rgbM[1])}${toH(rgbM[2])}${toH(rgbM[3])}`;
    }
    return undefined;
  }

  // =======================================================================
  // 1. Встроенный ZIP-архиватор и распаковщик (без внешних зависимостей)
  // =======================================================================
  const CRC32_TABLE = (() => {
    const tbl = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      tbl[i] = c >>> 0;
    }
    return tbl;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  async function inflateRawBytes(compressed) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('Браузер не поддерживает распаковку ZIP (DecompressionStream)');
    }
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(compressed);
    writer.close();
    const out = await new Response(ds.readable).arrayBuffer();
    return new Uint8Array(out);
  }

  async function unzipBufferToMap(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocdOffset = -1;
    const minOffset = Math.max(0, bytes.length - 65557);
    for (let i = bytes.length - 22; i >= minOffset; i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset < 0) throw new Error('Файл DOCX повреждён или не является ZIP-архивом');

    const totalEntries = view.getUint16(eocdOffset + 10, true);
    const cdOffset = view.getUint32(eocdOffset + 16, true);
    const decoder = new TextDecoder('utf-8');
    const files = new Map();

    let ptr = cdOffset;
    for (let i = 0; i < totalEntries && ptr + 46 <= bytes.length; i++) {
      if (view.getUint32(ptr, true) !== 0x02014b50) break;
      const method = view.getUint16(ptr + 10, true);
      const compSize = view.getUint32(ptr + 20, true);
      const nameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const commentLen = view.getUint16(ptr + 32, true);
      const localOffset = view.getUint32(ptr + 42, true);
      const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
      ptr += 46 + nameLen + extraLen + commentLen;

      if (localOffset + 30 > bytes.length) continue;
      if (view.getUint32(localOffset, true) !== 0x04034b50) continue;
      const lNameLen = view.getUint16(localOffset + 26, true);
      const lExtraLen = view.getUint16(localOffset + 28, true);
      const dataOffset = localOffset + 30 + lNameLen + lExtraLen;
      if (dataOffset + compSize > bytes.length) continue;

      const slice = bytes.subarray(dataOffset, dataOffset + compSize);
      if (method === 0) {
        files.set(name, slice);
      } else if (method === 8) {
        try {
          files.set(name, await inflateRawBytes(slice));
        } catch (err) {
          console.warn('Не удалось распаковать запись DOCX:', name, err);
        }
      }
    }
    return files;
  }

  function buildZipBytes(entries) {
    const enc = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBytes = enc.encode(entry.name);
      const dataBytes = typeof entry.data === 'string' ? enc.encode(entry.data) : entry.data;
      const checksum = crc32(dataBytes);

      const lh = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, 0, true);
      lv.setUint16(12, 0x5421, true);
      lv.setUint32(14, checksum, true);
      lv.setUint32(18, dataBytes.length, true);
      lv.setUint32(22, dataBytes.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);
      localParts.push(lh, dataBytes);

      const cd = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0x5421, true);
      cv.setUint32(16, checksum, true);
      cv.setUint32(20, dataBytes.length, true);
      cv.setUint32(24, dataBytes.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      cd.set(nameBytes, 46);
      centralParts.push(cd);

      offset += lh.length + dataBytes.length;
    }

    const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    const out = new Uint8Array(offset + centralSize + 22);
    let pos = 0;
    for (const part of localParts) { out.set(part, pos); pos += part.length; }
    for (const part of centralParts) { out.set(part, pos); pos += part.length; }
    out.set(eocd, pos);
    return out;
  }

  function bytesToDataUrl(bytes, filename) {
    const ext = String(filename || '').split('.').pop().toLowerCase();
    const mime =
      ext === 'png' ? 'image/png' :
      (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' :
      ext === 'gif' ? 'image/gif' :
      ext === 'webp' ? 'image/webp' : 'image/png';
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return `data:${mime};base64,${btoa(bin)}`;
  }

  function dataUrlToBinary(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string') return null;
    const m = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
    if (!m) return null;
    const ext = m[1].toLowerCase() === 'png' ? 'png' : 'jpeg';
    const binStr = atob(m[2].replace(/\s+/g, ''));
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
    return { bytes, ext };
  }

  // =======================================================================
  // 2. Парсер DOCX OpenXML -> DocxBlock[] -> Страницы
  // =======================================================================
  function parseRelationshipsXml(xml) {
    const map = {};
    if (!xml) return map;
    const re = /<Relationship\b[^>]*>/gi;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const idM = m[0].match(/\bId="([^"]+)"/i);
      const tgtM = m[0].match(/\bTarget="([^"]+)"/i);
      if (idM && tgtM) map[idM[1]] = tgtM[1];
    }
    return map;
  }

  function parseNumberingOrderedMap(numberingXml) {
    const orderedByNumId = {};
    if (!numberingXml) return orderedByNumId;

    const absOrdered = {};
    const absRe = /<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/gi;
    let am;
    while ((am = absRe.exec(numberingXml)) !== null) {
      const fmtM = am[2].match(/<w:numFmt\b[^>]*w:val="([^"]+)"/i);
      const fmt = fmtM ? fmtM[1].toLowerCase() : 'bullet';
      absOrdered[am[1]] = fmt !== 'bullet' && fmt !== 'none';
    }

    const numRe = /<w:num\b[^>]*w:numId="(\d+)"[^>]*>([\s\S]*?)<\/w:num>/gi;
    let nm;
    while ((nm = numRe.exec(numberingXml)) !== null) {
      const absRefM = nm[2].match(/<w:abstractNumId\b[^>]*w:val="(\d+)"/i);
      if (absRefM && absRefM[1] in absOrdered) {
        orderedByNumId[nm[1]] = absOrdered[absRefM[1]];
      }
    }
    return orderedByNumId;
  }

  function parseDocxRunsFromParagraph(pXml) {
    const runs = [];
    let hasPageBreak =
      /<w:br\b[^>]*w:type="page"/i.test(pXml) ||
      /<w:lastRenderedPageBreak\b/i.test(pXml) ||
      /<w:pageBreakBefore\b(?![^>]*w:val="(?:0|false)")/i.test(pXml);
    const imageEmbedIds = [];

    const runRe = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/gi;
    let rm;
    while ((rm = runRe.exec(pXml)) !== null) {
      const rBody = rm[1];
      const blipRe = /<a:blip\b[^>]*r:embed="([^"]+)"/gi;
      let bm;
      while ((bm = blipRe.exec(rBody)) !== null) imageEmbedIds.push(bm[1]);
      if (/<w:br\b[^>]*w:type="page"/i.test(rBody)) hasPageBreak = true;

      const rPrM = rBody.match(/<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/i);
      const rPr = rPrM ? rPrM[1] : '';
      const bold = /<w:b\b(?![^>]*w:val="(?:0|false)")/i.test(rPr);
      const italic = /<w:i\b(?![^>]*w:val="(?:0|false)")/i.test(rPr);
      const underline = /<w:u\b(?![^>]*w:val="none")/i.test(rPr);
      const strike = /<w:strike\b(?![^>]*w:val="(?:0|false)")/i.test(rPr);
      const fontM = rPr.match(/<w:rFonts\b[^>]*w:(?:ascii|hAnsi|cs)="([^"]+)"/i);
      const fontFamily = fontM ? decodeXmlEntities(fontM[1]) : undefined;
      const szM = rPr.match(/<w:sz\b[^>]*w:val="(\d+)"/i);
      const fontSizePt = szM ? Math.max(8, Math.min(72, Math.round(Number(szM[1]) / 2))) : undefined;
      const colorM = rPr.match(/<w:color\b[^>]*w:val="([0-9a-fA-F]{6})"/i);
      const color = colorM ? `#${colorM[1].toLowerCase()}` : undefined;

      let highlight;
      const hlM = rPr.match(/<w:highlight\b[^>]*w:val="([^"]+)"/i);
      if (hlM) {
        highlight = WORD_HIGHLIGHT_TO_HEX[hlM[1].toLowerCase()] || '#fef08a';
      } else {
        const shdM = rPr.match(/<w:shd\b[^>]*w:fill="([0-9a-fA-F]{6})"/i);
        if (shdM && shdM[1].toLowerCase() !== 'ffffff') highlight = `#${shdM[1].toLowerCase()}`;
      }

      const tokenRe = /<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br(?:\s+[^>]*)?\/>/gi;
      let tm;
      let txt = '';
      while ((tm = tokenRe.exec(rBody)) !== null) {
        if (tm[0].startsWith('<w:tab')) txt += '    ';
        else if (tm[0].startsWith('<w:br')) {
          if (!/w:type="page"/i.test(tm[0])) txt += '\n';
        } else {
          txt += decodeXmlEntities(tm[1] || '');
        }
      }
      if (!txt) continue;

      const prev = runs[runs.length - 1];
      if (
        prev &&
        !!prev.bold === bold &&
        !!prev.italic === italic &&
        !!prev.underline === underline &&
        !!prev.strike === strike &&
        prev.fontFamily === fontFamily &&
        prev.fontSizePt === fontSizePt &&
        prev.color === color &&
        prev.highlight === highlight
      ) {
        prev.text += txt;
      } else {
        const run = { text: txt };
        if (bold) run.bold = true;
        if (italic) run.italic = true;
        if (underline) run.underline = true;
        if (strike) run.strike = true;
        if (fontFamily) run.fontFamily = fontFamily;
        if (fontSizePt) run.fontSizePt = fontSizePt;
        if (color) run.color = color;
        if (highlight) run.highlight = highlight;
        runs.push(run);
      }
    }
    return { runs, hasPageBreak, imageEmbedIds };
  }

  function parseDocxDocumentXml(xml, relsXml, numberingXml, mediaDataUrlMap) {
    const blocks = [];
    if (!xml) return blocks;

    const rels = parseRelationshipsXml(relsXml || '');
    const orderedMap = parseNumberingOrderedMap(numberingXml || '');
    const bodyM = xml.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/i);
    const body = bodyM ? bodyM[1] : xml;

    function findExactXmlTag(str, tagName, fromIdx) {
      let idx = fromIdx;
      while (idx < str.length) {
        const found = str.indexOf(tagName, idx);
        if (found === -1) return -1;
        const ch = str[found + tagName.length];
        if (!ch || ch === '>' || ch === '/' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
          return found;
        }
        idx = found + tagName.length;
      }
      return -1;
    }

    let pos = 0;
    while (pos < body.length) {
      const nextP = findExactXmlTag(body, '<w:p', pos);
      const nextTbl = findExactXmlTag(body, '<w:tbl', pos);
      if (nextP === -1 && nextTbl === -1) break;

      const isTbl = nextTbl !== -1 && (nextP === -1 || nextTbl < nextP);
      if (isTbl) {
        const endTbl = body.indexOf('</w:tbl>', nextTbl);
        if (endTbl === -1) break;
        const tblXml = body.slice(nextTbl, endTbl + 8);
        pos = endTbl + 8;

        const rows = [];
        const rowRe = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/gi;
        let rowM;
        while ((rowM = rowRe.exec(tblXml)) !== null) {
          const cells = [];
          const cellRe = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/gi;
          let cellM;
          while ((cellM = cellRe.exec(rowM[1])) !== null) {
            const tcXml = cellM[1];
            const tcPrM = tcXml.match(/<w:tcPr\b[^>]*>([\s\S]*?)<\/w:tcPr>/i);
            const tcPr = tcPrM ? tcPrM[1] : '';
            const shdM = tcPr.match(/<w:shd\b[^>]*w:fill="([0-9a-fA-F]{6})"/i);
            const shading = shdM && shdM[1].toLowerCase() !== 'ffffff' ? `#${shdM[1].toLowerCase()}` : undefined;
            const spanM = tcPr.match(/<w:gridSpan\b[^>]*w:val="(\d+)"/i);
            const colSpan = spanM ? Math.max(1, Number(spanM[1])) : undefined;

            const pRuns = [];
            const pTexts = [];
            let cellAlign;
            const cpRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi;
            let cpM;
            while ((cpM = cpRe.exec(tcXml)) !== null) {
              const jcM = cpM[1].match(/<w:jc\b[^>]*w:val="([^"]+)"/i);
              if (!cellAlign && jcM) {
                const v = jcM[1].toLowerCase();
                if (v === 'center' || v === 'right' || v === 'both') {
                  cellAlign = v === 'both' ? 'justify' : v;
                }
              }
              const parsed = parseDocxRunsFromParagraph(cpM[1]);
              const t = parsed.runs.map(r => r.text).join('').trim();
              if (t) {
                if (pRuns.length > 0) pRuns.push({ text: '\n' });
                pRuns.push(...parsed.runs);
                pTexts.push(t);
              }
            }
            const cellObj = { text: pTexts.join('\n') };
            if (pRuns.length > 0) cellObj.runs = pRuns;
            if (shading) cellObj.shading = shading;
            if (colSpan && colSpan > 1) cellObj.colSpan = colSpan;
            if (cellAlign) cellObj.align = cellAlign;
            cells.push(cellObj);
          }
          if (cells.length > 0) rows.push(cells);
        }
        if (rows.length > 0) blocks.push({ type: 'table', rows });
        continue;
      }

      const tagEnd = body.indexOf('>', nextP);
      if (tagEnd === -1) break;
      const isSelfClosing = body[tagEnd - 1] === '/';
      let pXml = '';
      if (isSelfClosing) {
        pXml = body.slice(nextP, tagEnd + 1);
        pos = tagEnd + 1;
      } else {
        const endP = body.indexOf('</w:p>', nextP);
        if (endP === -1) break;
        pXml = body.slice(nextP, endP + 6);
        pos = endP + 6;
      }

      const pPrM = pXml.match(/<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/i);
      const pPr = pPrM ? pPrM[1] : '';
      const styleM = pPr.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/i);
      const styleVal = styleM ? styleM[1].toLowerCase() : '';
      const hasNumPr = /<w:numPr\b/i.test(pPr);
      const ilvlM = pPr.match(/<w:ilvl\b[^>]*w:val="(\d+)"/i);
      const numIdM = pPr.match(/<w:numId\b[^>]*w:val="(\d+)"/i);
      const jcM = pPr.match(/<w:jc\b[^>]*w:val="([^"]+)"/i);
      let align = 'left';
      if (jcM) {
        const v = jcM[1].toLowerCase();
        if (v === 'center') align = 'center';
        else if (v === 'right') align = 'right';
        else if (v === 'both' || v === 'distribute') align = 'justify';
      }

      const { runs, hasPageBreak, imageEmbedIds } = parseDocxRunsFromParagraph(pXml);
      const plainText = runs.map(r => r.text).join('').trim();

      if (hasPageBreak && blocks.length > 0 && blocks[blocks.length - 1].type !== 'page-break') {
        blocks.push({ type: 'page-break' });
      }

      for (const rId of imageEmbedIds) {
        const rawTarget = rels[rId];
        if (!rawTarget) continue;
        const cleanTarget = rawTarget.replace(/^\/+/, '').replace(/^\.\.\//, '');
        const fullPath = cleanTarget.startsWith('word/') ? cleanTarget : `word/${cleanTarget}`;
        const dataUrl = mediaDataUrlMap ? mediaDataUrlMap.get(fullPath) : undefined;
        if (dataUrl) {
          blocks.push({
            type: 'image',
            imageTarget: fullPath,
            imageDataUrl: dataUrl,
            alt: cleanTarget.split('/').pop() || 'image'
          });
        }
      }

      if (!plainText) continue;

      if (styleVal.includes('heading1') || styleVal === 'title' || styleVal === '1') {
        blocks.push({ type: 'heading', level: 1, align, text: plainText, runs });
      } else if (styleVal.includes('heading2') || styleVal === 'subtitle' || styleVal === '2') {
        blocks.push({ type: 'heading', level: 2, align, text: plainText, runs });
      } else if (styleVal.includes('heading3') || styleVal.includes('heading') || styleVal === '3') {
        blocks.push({ type: 'heading', level: 3, align, text: plainText, runs });
      } else if (hasNumPr || styleVal.includes('list')) {
        const numId = numIdM ? numIdM[1] : '';
        const ordered = numId ? !!orderedMap[numId] : false;
        blocks.push({
          type: 'list-item',
          level: ilvlM ? Math.min(3, Number(ilvlM[1])) : 0,
          ordered,
          align,
          text: plainText,
          runs
        });
      } else {
        blocks.push({ type: 'paragraph', align, text: plainText, runs });
      }
    }
    return blocks;
  }

  function splitBlocksIntoDocxPages(blocks) {
    const pages = [[]];
    for (const b of blocks) {
      if (b.type === 'page-break') {
        if (pages[pages.length - 1].length > 0) pages.push([]);
        continue;
      }
      pages[pages.length - 1].push(b);
    }
    const nonEmpty = pages.filter(p => p.length > 0);
    return nonEmpty.length > 0 ? nonEmpty : [[]];
  }

  // =======================================================================
  // 3. DocxBlock[] <-> Редактируемый Word HTML
  // =======================================================================
  function docxRunsToHtml(runs) {
    return (runs || []).map(r => {
      let inner = escapeHtml(r.text || '').replace(/\n/g, '<br>');
      if (r.bold) inner = `<strong>${inner}</strong>`;
      if (r.italic) inner = `<em>${inner}</em>`;
      if (r.underline) inner = `<u>${inner}</u>`;
      if (r.strike) inner = `<s>${inner}</s>`;
      const styles = [];
      if (r.fontFamily) styles.push(`font-family:${escapeHtml(r.fontFamily)}`);
      if (r.fontSizePt) styles.push(`font-size:${r.fontSizePt}pt`);
      if (r.color) styles.push(`color:${r.color}`);
      if (r.highlight) styles.push(`background-color:${r.highlight}`);
      if (styles.length > 0) inner = `<span style="${styles.join(';')}">${inner}</span>`;
      return inner;
    }).join('');
  }

  WB.docxBlocksToHtml = function (blocks) {
    if (!blocks || blocks.length === 0) return '<p><br></p>';
    const out = [];
    let i = 0;

    while (i < blocks.length) {
      const b = blocks[i];
      if (b.type === 'list-item') {
        const ordered = !!b.ordered;
        const tag = ordered ? 'ol' : 'ul';
        const items = [];
        while (i < blocks.length && blocks[i].type === 'list-item' && !!blocks[i].ordered === ordered) {
          const lb = blocks[i];
          const inner = lb.runs && lb.runs.length ? docxRunsToHtml(lb.runs) : escapeHtml(lb.text || '');
          items.push(`<li>${inner}</li>`);
          i++;
        }
        out.push(`<${tag}>${items.join('')}</${tag}>`);
        continue;
      }

      const alignAttr = b.align && b.align !== 'left' ? ` style="text-align:${b.align}"` : '';
      if (b.type === 'heading') {
        const lvl = Math.max(1, Math.min(3, b.level || 1));
        const inner = b.runs && b.runs.length ? docxRunsToHtml(b.runs) : escapeHtml(b.text || '');
        out.push(`<h${lvl}${alignAttr}>${inner}</h${lvl}>`);
      } else if (b.type === 'paragraph') {
        const inner = b.runs && b.runs.length ? docxRunsToHtml(b.runs) : escapeHtml(b.text || '');
        out.push(`<p${alignAttr}>${inner || '<br>'}</p>`);
      } else if (b.type === 'table' && b.rows && b.rows.length > 0) {
        const rowsHtml = b.rows.map(row => {
          const cellsHtml = row.map(cell => {
            const cStyles = [];
            if (cell.shading) cStyles.push(`background-color:${cell.shading}`);
            if (cell.align && cell.align !== 'left') cStyles.push(`text-align:${cell.align}`);
            const styleAttr = cStyles.length ? ` style="${cStyles.join(';')}"` : '';
            const spanAttr = cell.colSpan && cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : '';
            const inner = cell.runs && cell.runs.length ? docxRunsToHtml(cell.runs) : escapeHtml(cell.text || '');
            return `<td${spanAttr}${styleAttr}>${inner || '&nbsp;'}</td>`;
          }).join('');
          return `<tr>${cellsHtml}</tr>`;
        }).join('');
        out.push(`<table class="docx-table"><tbody>${rowsHtml}</tbody></table>`);
      } else if (b.type === 'image' && b.imageDataUrl) {
        out.push(`<p class="docx-img-p"><img src="${b.imageDataUrl}" alt="${escapeHtml(b.alt || 'image')}"></p>`);
      }
      i++;
    }
    return out.join('\n');
  };

  function parseFontSizePtFromCss(rawSize) {
    if (!rawSize) return undefined;
    const s = String(rawSize).trim().toLowerCase();
    const ptM = s.match(/^([\d.]+)pt$/);
    if (ptM) return Math.max(8, Math.min(72, Math.round(Number(ptM[1]))));
    const pxM = s.match(/^([\d.]+)px$/);
    if (pxM) return Math.max(8, Math.min(72, Math.round(Number(pxM[1]) * 0.75)));
    return undefined;
  }

  function extractInlineRunsFromElement(rootEl) {
    const runs = [];
    const images = [];

    function walk(node, fmt) {
      if (node.nodeType === 3) {
        const text = node.nodeValue || '';
        if (!text) return;
        const prev = runs[runs.length - 1];
        if (
          prev &&
          !!prev.bold === !!fmt.bold &&
          !!prev.italic === !!fmt.italic &&
          !!prev.underline === !!fmt.underline &&
          !!prev.strike === !!fmt.strike &&
          prev.fontFamily === fmt.fontFamily &&
          prev.fontSizePt === fmt.fontSizePt &&
          prev.color === fmt.color &&
          prev.highlight === fmt.highlight
        ) {
          prev.text += text;
        } else {
          const r = { text };
          if (fmt.bold) r.bold = true;
          if (fmt.italic) r.italic = true;
          if (fmt.underline) r.underline = true;
          if (fmt.strike) r.strike = true;
          if (fmt.fontFamily) r.fontFamily = fmt.fontFamily;
          if (fmt.fontSizePt) r.fontSizePt = fmt.fontSizePt;
          if (fmt.color) r.color = fmt.color;
          if (fmt.highlight) r.highlight = fmt.highlight;
          runs.push(r);
        }
        return;
      }

      if (node.nodeType !== 1) return;
      const tag = node.tagName.toUpperCase();
      if (tag === 'BR') {
        if (runs.length > 0) runs.push({ text: '\n' });
        return;
      }
      if (tag === 'IMG') {
        const src = node.getAttribute('src') || '';
        if (src.startsWith('data:image/')) {
          images.push({
            type: 'image',
            imageDataUrl: src,
            imageWidthPx: node.naturalWidth || node.width || 480,
            imageHeightPx: node.naturalHeight || node.height || 300,
            alt: node.getAttribute('alt') || 'Image'
          });
        }
        return;
      }

      const next = Object.assign({}, fmt);
      if (tag === 'STRONG' || tag === 'B') next.bold = true;
      if (tag === 'EM' || tag === 'I') next.italic = true;
      if (tag === 'U') next.underline = true;
      if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') next.strike = true;
      if (tag === 'FONT') {
        const face = node.getAttribute('face');
        if (face) next.fontFamily = face;
        const col = normalizeHexColor(node.getAttribute('color'));
        if (col) next.color = col;
        const szAttr = node.getAttribute('size');
        const mapSz = { '1': 8, '2': 10, '3': 12, '4': 14, '5': 18, '6': 24, '7': 36 };
        if (szAttr && mapSz[szAttr]) next.fontSizePt = mapSz[szAttr];
      }

      const st = node.style;
      if (st) {
        if (st.fontWeight === 'bold' || Number(st.fontWeight) >= 600) next.bold = true;
        if (st.fontStyle === 'italic') next.italic = true;
        const td = (st.textDecoration || st.textDecorationLine || '').toLowerCase();
        if (td.includes('underline')) next.underline = true;
        if (td.includes('line-through')) next.strike = true;
        if (st.fontFamily) next.fontFamily = st.fontFamily.replace(/['"]/g, '').split(',')[0].trim();
        const pt = parseFontSizePtFromCss(st.fontSize);
        if (pt) next.fontSizePt = pt;
        const col = normalizeHexColor(st.color);
        if (col) next.color = col;
        const bg = normalizeHexColor(st.backgroundColor);
        if (bg && bg !== '#ffffff') next.highlight = bg;
      }

      for (const child of Array.from(node.childNodes)) {
        walk(child, next);
      }
    }

    for (const child of Array.from(rootEl.childNodes)) {
      walk(child, {});
    }
    return { runs, images };
  }

  function extractAlignFromEl(el) {
    const raw = (el.style && el.style.textAlign) || el.getAttribute('align') || '';
    const v = raw.toLowerCase();
    if (v === 'center' || v === 'right' || v === 'justify') return v;
    return 'left';
  }

  WB.parseWordHtmlToBlocks = function (htmlOrEl) {
    let container = htmlOrEl;
    if (typeof htmlOrEl === 'string') {
      container = document.createElement('div');
      container.innerHTML = htmlOrEl;
    }
    if (!container) return [];
    const blocks = [];

    function processNode(node) {
      if (node.nodeType === 3) {
        const txt = (node.nodeValue || '').trim();
        if (txt) blocks.push({ type: 'paragraph', align: 'left', text: txt, runs: [{ text: txt }] });
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName.toUpperCase();

      if (tag === 'HR') {
        blocks.push({ type: 'page-break' });
        return;
      }

      if (tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4') {
        const lvl = Math.min(3, Number(tag.slice(1)) || 1);
        const { runs, images } = extractInlineRunsFromElement(node);
        const text = runs.map(r => r.text).join('').trim();
        if (text) blocks.push({ type: 'heading', level: lvl, align: extractAlignFromEl(node), text, runs });
        images.forEach(img => blocks.push(img));
        return;
      }

      if (tag === 'UL' || tag === 'OL') {
        const ordered = tag === 'OL';
        for (const li of Array.from(node.children)) {
          if (li.tagName.toUpperCase() !== 'LI') continue;
          const { runs, images } = extractInlineRunsFromElement(li);
          const text = runs.map(r => r.text).join('').trim();
          if (text) blocks.push({ type: 'list-item', ordered, level: 0, align: extractAlignFromEl(li), text, runs });
          images.forEach(img => blocks.push(img));
        }
        return;
      }

      if (tag === 'TABLE') {
        const rows = [];
        const trList = node.querySelectorAll('tr');
        for (const tr of Array.from(trList)) {
          const cells = [];
          for (const td of Array.from(tr.children)) {
            const cTag = td.tagName.toUpperCase();
            if (cTag !== 'TD' && cTag !== 'TH') continue;
            const { runs } = extractInlineRunsFromElement(td);
            const cleanRuns = runs.map(r => Object.assign({}, r, { text: r.text.replace(/\u00a0/g, ' ') }));
            const text = cleanRuns.map(r => r.text).join('').trim();
            const cellObj = { text };
            if (cleanRuns.length > 0 && text) {
              if (cTag === 'TH') cleanRuns.forEach(r => { r.bold = true; });
              cellObj.runs = cleanRuns;
            }
            const shd = normalizeHexColor(td.style && td.style.backgroundColor);
            if (shd && shd !== '#ffffff') cellObj.shading = shd;
            const span = Number(td.getAttribute('colspan') || 1);
            if (span > 1) cellObj.colSpan = span;
            const al = extractAlignFromEl(td);
            if (al !== 'left') cellObj.align = al;
            cells.push(cellObj);
          }
          if (cells.length > 0) rows.push(cells);
        }
        if (rows.length > 0) blocks.push({ type: 'table', rows });
        return;
      }

      if (tag === 'IMG') {
        const src = node.getAttribute('src') || '';
        if (src.startsWith('data:image/')) {
          blocks.push({
            type: 'image',
            imageDataUrl: src,
            imageWidthPx: node.naturalWidth || node.width || 480,
            imageHeightPx: node.naturalHeight || node.height || 300,
            alt: node.getAttribute('alt') || 'Image'
          });
        }
        return;
      }

      // P, DIV, BLOCKQUOTE, etc.
      const hasBlockChildren = Array.from(node.children).some(ch =>
        ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'TABLE'].includes(ch.tagName.toUpperCase())
      );
      if (tag === 'DIV' && hasBlockChildren) {
        Array.from(node.childNodes).forEach(processNode);
        return;
      }

      const { runs, images } = extractInlineRunsFromElement(node);
      const text = runs.map(r => r.text).join('').trim();
      if (text) {
        blocks.push({ type: 'paragraph', align: extractAlignFromEl(node), text, runs });
      } else if (images.length === 0) {
        blocks.push({ type: 'paragraph', align: 'left', text: '', runs: [{ text: '' }] });
      }
      images.forEach(img => blocks.push(img));
    }

    Array.from(container.childNodes).forEach(processNode);
    return blocks;
  };

  // =======================================================================
  // 4. Растеризация Word-блоков на Canvas (для миниатюр, вырезки ✂️ и превью доски)
  // =======================================================================
  function loadImagePromise(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  WB.renderDocxBlocksToCanvas = async function (blocks, width = PAGE_W, height = PAGE_H) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    const padX = 76;
    const padTop = 72;
    const maxW = width - padX * 2;
    let y = padTop;

    const makeFont = (run, baseSize, forceBold) => {
      const weight = (forceBold || run.bold) ? '700' : '400';
      const style = run.italic ? 'italic' : 'normal';
      const sz = run.fontSizePt ? Math.round(run.fontSizePt * 1.333) : baseSize;
      const fam = run.fontFamily ? `"${run.fontFamily}", Calibri, Inter, sans-serif` : 'Calibri, Inter, sans-serif';
      return { font: `${style} ${weight} ${sz}px ${fam}`, sizePx: sz };
    };

    const drawRunsParagraph = (runs, baseSize, forceBold, align, indentX = 0, prefix = '') => {
      const availW = Math.max(80, maxW - indentX);
      const tokens = [];
      for (const r of (runs && runs.length ? runs : [{ text: '' }])) {
        const parts = String(r.text || '').split(/(\s+|\n)/);
        for (const p of parts) {
          if (!p) continue;
          tokens.push({ text: p, run: r });
        }
      }

      const lines = [];
      let curLine = [];
      let curW = 0;

      for (const tk of tokens) {
        if (tk.text === '\n') {
          lines.push({ items: curLine, width: curW });
          curLine = [];
          curW = 0;
          continue;
        }
        const f = makeFont(tk.run, baseSize, forceBold);
        ctx.font = f.font;
        const w = ctx.measureText(tk.text).width;
        if (curLine.length > 0 && curW + w > availW && tk.text.trim()) {
          lines.push({ items: curLine, width: curW });
          curLine = [];
          curW = 0;
          if (!tk.text.trim()) continue;
        }
        curLine.push({ text: tk.text, run: tk.run, font: f.font, sizePx: f.sizePx, w });
        curW += w;
      }
      if (curLine.length > 0 || lines.length === 0) lines.push({ items: curLine, width: curW });

      lines.forEach((line, lineIdx) => {
        const maxSz = line.items.reduce((m, it) => Math.max(m, it.sizePx), baseSize);
        const lineH = Math.round(maxSz * 1.48);
        if (y + lineH > height - 48) return;

        let x = padX + indentX;
        if (align === 'center') x = padX + indentX + Math.max(0, (availW - line.width) / 2);
        else if (align === 'right') x = padX + indentX + Math.max(0, availW - line.width);

        if (lineIdx === 0 && prefix) {
          ctx.font = `600 ${baseSize}px Calibri, Inter, sans-serif`;
          ctx.fillStyle = '#2563eb';
          ctx.textBaseline = 'top';
          ctx.fillText(prefix, padX + Math.max(0, indentX - 22), y);
        }

        for (const it of line.items) {
          ctx.font = it.font;
          ctx.textBaseline = 'top';
          if (it.run.highlight) {
            ctx.fillStyle = it.run.highlight;
            ctx.fillRect(x - 1, y - 1, it.w + 2, it.sizePx + 4);
          }
          ctx.fillStyle = it.run.color || '#0f172a';
          ctx.fillText(it.text, x, y);
          if (it.run.underline) {
            ctx.strokeStyle = it.run.color || '#0f172a';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(x, y + it.sizePx + 1);
            ctx.lineTo(x + it.w, y + it.sizePx + 1);
            ctx.stroke();
          }
          if (it.run.strike) {
            ctx.strokeStyle = it.run.color || '#0f172a';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(x, y + it.sizePx * 0.55);
            ctx.lineTo(x + it.w, y + it.sizePx * 0.55);
            ctx.stroke();
          }
          x += it.w;
        }
        y += lineH;
      });
    };

    let orderedCounter = 0;
    for (const b of (blocks || [])) {
      if (y > height - 64) break;

      if (b.type === 'list-item' && b.ordered) {
        orderedCounter++;
      } else {
        orderedCounter = 0;
      }

      if (b.type === 'heading') {
        const sz = b.level === 1 ? 28 : (b.level === 2 ? 22 : 18);
        y += 8;
        drawRunsParagraph(b.runs || [{ text: b.text || '' }], sz, true, b.align || 'left', 0);
        y += 10;
      } else if (b.type === 'list-item') {
        const pref = b.ordered ? `${orderedCounter}.` : '•';
        drawRunsParagraph(b.runs || [{ text: b.text || '' }], 16, false, b.align || 'left', 26, pref);
        y += 5;
      } else if (b.type === 'paragraph') {
        drawRunsParagraph(b.runs || [{ text: b.text || '' }], 16, false, b.align || 'left', 0);
        y += 9;
      } else if (b.type === 'table' && b.rows && b.rows.length > 0) {
        const maxCols = Math.max(1, ...b.rows.map(r => r.reduce((s, c) => s + (c.colSpan || 1), 0)));
        const colW = maxW / maxCols;
        y += 6;
        for (const row of b.rows) {
          const rowH = 34;
          if (y + rowH > height - 48) break;
          let colCursor = 0;
          for (const cell of row) {
            const span = cell.colSpan || 1;
            const cx = padX + colCursor * colW;
            const cw = colW * span;
            if (cell.shading) {
              ctx.fillStyle = cell.shading;
              ctx.fillRect(cx, y, cw, rowH);
            }
            ctx.strokeStyle = '#cbd5e1';
            ctx.lineWidth = 1;
            ctx.strokeRect(cx, y, cw, rowH);

            const isBold = cell.runs && cell.runs[0] && cell.runs[0].bold;
            ctx.font = `${isBold ? '700' : '400'} 14px Calibri, Inter, sans-serif`;
            ctx.fillStyle = '#0f172a';
            ctx.textBaseline = 'middle';
            const txt = String(cell.text || '').replace(/\n/g, ' ');
            let clipped = txt;
            while (clipped.length > 1 && ctx.measureText(clipped).width > cw - 16) {
              clipped = clipped.slice(0, -1);
            }
            if (clipped !== txt && clipped.length > 2) clipped = clipped.slice(0, -1) + '…';
            ctx.fillText(clipped, cx + 8, y + rowH / 2);
            colCursor += span;
          }
          y += rowH;
        }
        y += 12;
      } else if (b.type === 'image' && b.imageDataUrl) {
        const img = await loadImagePromise(b.imageDataUrl);
        if (img && img.naturalWidth > 0) {
          const maxImgH = Math.min(340, height - y - 64);
          const scale = Math.min(1, maxW / img.naturalWidth, maxImgH / img.naturalHeight);
          const dw = Math.round(img.naturalWidth * scale);
          const dh = Math.round(img.naturalHeight * scale);
          const dx = padX + Math.round((maxW - dw) / 2);
          ctx.drawImage(img, dx, y, dw, dh);
          y += dh + 14;
        }
      }
    }
    return canvas;
  };

  // =======================================================================
  // 5. Генератор настоящего OpenXML .docx (сохранение DOCX как .docx!)
  // =======================================================================
  function serializeRunToOoxml(run) {
    const rPrParts = [];
    if (run.fontFamily) {
      const f = escapeXml(run.fontFamily);
      rPrParts.push(`<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}"/>`);
    }
    if (run.bold) rPrParts.push('<w:b/>');
    if (run.italic) rPrParts.push('<w:i/>');
    if (run.underline) rPrParts.push('<w:u w:val="single"/>');
    if (run.strike) rPrParts.push('<w:strike/>');
    const hexColor = normalizeHexColor(run.color);
    if (hexColor) rPrParts.push(`<w:color w:val="${hexColor.slice(1).toUpperCase()}"/>`);
    if (run.fontSizePt && Number.isFinite(run.fontSizePt)) {
      const halfPts = Math.max(16, Math.min(144, Math.round(run.fontSizePt * 2)));
      rPrParts.push(`<w:sz w:val="${halfPts}"/><w:szCs w:val="${halfPts}"/>`);
    }
    const hexHl = normalizeHexColor(run.highlight);
    if (hexHl) {
      rPrParts.push(`<w:shd w:val="clear" w:color="auto" w:fill="${hexHl.slice(1).toUpperCase()}"/>`);
    }

    const rPr = rPrParts.length > 0 ? `<w:rPr>${rPrParts.join('')}</w:rPr>` : '';
    const lines = String(run.text || '').split('\n');
    const content = lines.map((line, idx) => {
      const tXml = `<w:t xml:space="preserve">${escapeXml(line)}</w:t>`;
      return idx > 0 ? `<w:br/>${tXml}` : tXml;
    }).join('');
    return `<w:r>${rPr}${content}</w:r>`;
  }

  function serializeAlignToOoxml(align) {
    if (!align || align === 'left') return '';
    return `<w:jc w:val="${align === 'justify' ? 'both' : align}"/>`;
  }

  function serializeImageParagraphToOoxml(rId, docPrId, name, widthPx, heightPx) {
    const maxWidthPx = 610;
    const maxHeightPx = 860;
    let w = Math.max(40, widthPx || 520);
    let h = Math.max(40, heightPx || 320);
    const scale = Math.min(1, maxWidthPx / w, maxHeightPx / h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
    const cx = w * 9525;
    const cy = h * 9525;
    const safeName = escapeXml(name || `Image ${docPrId}`);

    return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${docPrId}" name="${safeName}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${safeName}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  }

  WB.buildDocxBytes = function (pages) {
    const safePages = Array.isArray(pages) && pages.length > 0 ? pages : [{ kind: 'docx', blocks: [] }];
    const bodyParts = [];
    const mediaFiles = [];
    let nextRelNum = 3;
    let nextDocPrId = 1;

    const registerImage = (dataUrl, wPx, hPx, label) => {
      const bin = dataUrlToBinary(dataUrl);
      if (!bin) return null;
      const rId = `rId${nextRelNum++}`;
      const fileName = `image${mediaFiles.length + 1}.${bin.ext}`;
      mediaFiles.push({ rId, fileName, bytes: bin.bytes, ext: bin.ext });
      return serializeImageParagraphToOoxml(rId, nextDocPrId++, label, wPx, hPx);
    };

    safePages.forEach((page, pageIdx) => {
      if (pageIdx > 0) {
        bodyParts.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
      }

      if (page.kind === 'blank' && page.blankPageDataUrl) {
        const imgXml = registerImage(page.blankPageDataUrl, page.blankWidthPx || 610, page.blankHeightPx || 860, `Страница ${pageIdx + 1}`);
        if (imgXml) bodyParts.push(imgXml);
        return;
      }

      for (const block of (page.blocks || [])) {
        if (block.type === 'page-break') {
          bodyParts.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
          continue;
        }
        if (block.type === 'image' && block.imageDataUrl) {
          const imgXml = registerImage(block.imageDataUrl, block.imageWidthPx || 520, block.imageHeightPx || 320, block.alt || 'Image');
          if (imgXml) bodyParts.push(imgXml);
          continue;
        }
        if (block.type === 'heading') {
          const lvl = Math.max(1, Math.min(3, block.level || 1));
          const runs = block.runs && block.runs.length ? block.runs : [{ text: block.text || '' }];
          const pPr = `<w:pPr><w:pStyle w:val="Heading${lvl}"/>${serializeAlignToOoxml(block.align)}</w:pPr>`;
          bodyParts.push(`<w:p>${pPr}${runs.map(serializeRunToOoxml).join('')}</w:p>`);
          continue;
        }
        if (block.type === 'list-item') {
          const numId = block.ordered ? '2' : '1';
          const ilvl = Math.max(0, Math.min(3, block.level || 0));
          const runs = block.runs && block.runs.length ? block.runs : [{ text: block.text || '' }];
          const pPr = `<w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>${serializeAlignToOoxml(block.align)}</w:pPr>`;
          bodyParts.push(`<w:p>${pPr}${runs.map(serializeRunToOoxml).join('')}</w:p>`);
          continue;
        }
        if (block.type === 'table' && block.rows && block.rows.length > 0) {
          const maxCols = Math.max(1, ...block.rows.map(r => r.reduce((s, c) => s + (c.colSpan || 1), 0)));
          const colW = Math.floor(9638 / maxCols);
          const gridCols = Array.from({ length: maxCols }, () => `<w:gridCol w:w="${colW}"/>`).join('');
          const trXml = block.rows.map(row => {
            const tcXml = row.map(cell => {
              const tcPrParts = [`<w:tcW w:w="${colW * (cell.colSpan || 1)}" w:type="dxa"/>`];
              if (cell.colSpan && cell.colSpan > 1) tcPrParts.push(`<w:gridSpan w:val="${cell.colSpan}"/>`);
              const shd = normalizeHexColor(cell.shading);
              if (shd) tcPrParts.push(`<w:shd w:val="clear" w:color="auto" w:fill="${shd.slice(1).toUpperCase()}"/>`);
              const cellRuns = cell.runs && cell.runs.length ? cell.runs : [{ text: cell.text || '' }];
              const pAlign = serializeAlignToOoxml(cell.align);
              const pPr = pAlign ? `<w:pPr>${pAlign}</w:pPr>` : '';
              return `<w:tc><w:tcPr>${tcPrParts.join('')}</w:tcPr><w:p>${pPr}${cellRuns.map(serializeRunToOoxml).join('')}</w:p></w:tc>`;
            }).join('');
            return `<w:tr>${tcXml}</w:tr>`;
          }).join('');
          bodyParts.push(
            `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="9638" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/></w:tblBorders><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${gridCols}</w:tblGrid>${trXml}</w:tbl>`
          );
          continue;
        }
        const runs = block.runs && block.runs.length ? block.runs : [{ text: block.text || '' }];
        const alignXml = serializeAlignToOoxml(block.align);
        const pPr = alignXml ? `<w:pPr>${alignXml}</w:pPr>` : '';
        bodyParts.push(`<w:p>${pPr}${runs.map(serializeRunToOoxml).join('')}</w:p>`);
      }

      if (page.annotationImageDataUrl) {
        const annXml = registerImage(
          page.annotationImageDataUrl,
          page.annotationWidthPx || 610,
          page.annotationHeightPx || 420,
          `Пометки на странице ${pageIdx + 1}`
        );
        if (annXml) bodyParts.push(annXml);
      }
    });

    if (bodyParts.length === 0) bodyParts.push('<w:p/>');

    const documentXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<w:body>${bodyParts.join('')}` +
      `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>` +
      `</w:body></w:document>`;

    const stylesXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:color w:val="0F172A"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
      `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/><w:color w:val="0F172A"/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="200" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/><w:color w:val="1E293B"/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="160" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/><w:color w:val="334155"/></w:rPr></w:style>` +
      `<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>` +
      `</w:styles>`;

    const numberingXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>` +
      `<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>` +
      `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>` +
      `<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>` +
      `</w:numbering>`;

    const docRelsItems = [
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>`,
      ...mediaFiles.map(m =>
        `<Relationship Id="${m.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.fileName}"/>`
      )
    ];

    const docRelsXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${docRelsItems.join('')}</Relationships>`;

    const rootRelsXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `</Relationships>`;

    const contentTypesXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Default Extension="png" ContentType="image/png"/>` +
      `<Default Extension="jpeg" ContentType="image/jpeg"/>` +
      `<Default Extension="jpg" ContentType="image/jpeg"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
      `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` +
      `</Types>`;

    return buildZipBytes([
      { name: '[Content_Types].xml', data: contentTypesXml },
      { name: '_rels/.rels', data: rootRelsXml },
      { name: 'word/document.xml', data: documentXml },
      { name: 'word/styles.xml', data: stylesXml },
      { name: 'word/numbering.xml', data: numberingXml },
      { name: 'word/_rels/document.xml.rels', data: docRelsXml },
      ...mediaFiles.map(m => ({ name: `word/media/${m.fileName}`, data: m.bytes }))
    ]);
  };

  WB.buildDocxBlobFromActiveEditor = async function () {
    WB.syncActiveDocxLayersToState();
    const total = WB.pdfEditor.pages.length;
    const docxPages = Array.isArray(WB.pdfEditor.docxPages) ? WB.pdfEditor.docxPages : [];
    const exportPages = [];

    for (let i = 0; i < total; i++) {
      const dp = docxPages[i];
      const strokes = WB.pdfEditor.strokesByPage[i] || [];
      const widgets = WB.pdfEditor.widgetsByPage[i] || [];
      const hasAnnotations = strokes.length > 0 || widgets.length > 0;

      if (dp && dp.kind === 'docx') {
        const blocks = WB.parseWordHtmlToBlocks(dp.html || '');
        const entry = { kind: 'docx', blocks };
        if (hasAnnotations) {
          const annCanvas = document.createElement('canvas');
          const dims = WB.pdfEditor.pageDims[i] || { width: PAGE_W, height: PAGE_H };
          annCanvas.width = dims.width;
          annCanvas.height = dims.height;
          const actx = annCanvas.getContext('2d');
          actx.fillStyle = '#ffffff';
          actx.fillRect(0, 0, annCanvas.width, annCanvas.height);
          // Композит Word-страницы + пометки для сохранения визуальной привязки пометок в Word
          const wordCanvas = await WB.renderDocxBlocksToCanvas(blocks, dims.width, dims.height);
          actx.drawImage(wordCanvas, 0, 0);
          if (typeof WB.drawPdfStrokeList === 'function') WB.drawPdfStrokeList(actx, strokes, true);
          if (typeof WB.drawPdfWidgetsOnCanvas === 'function') WB.drawPdfWidgetsOnCanvas(actx, widgets);
          entry.annotationImageDataUrl = annCanvas.toDataURL('image/png');
          entry.annotationWidthPx = dims.width;
          entry.annotationHeightPx = dims.height;
        }
        exportPages.push(entry);
      } else {
        const comp = typeof WB.buildCompositePdfPageCanvas === 'function'
          ? await WB.buildCompositePdfPageCanvas(i)
          : null;
        if (comp) {
          exportPages.push({
            kind: 'blank',
            blankPageDataUrl: comp.toDataURL('image/png'),
            blankWidthPx: comp.width,
            blankHeightPx: comp.height
          });
        }
      }
    }

    const bytes = WB.buildDocxBytes(exportPages);
    return new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
  };

  WB.downloadEditedDocx = async function () {
    const total = WB.pdfEditor.pages.length;
    if (total === 0) return;
    if (typeof WB.showToast === 'function') {
      WB.showToast(`📘 Сохраняем документ Word (.docx, ${total} стр.)...`, 2000);
    }
    const blob = await WB.buildDocxBlobFromActiveEditor();
    if (!blob) return;
    const baseName = (WB.pdfEditor.title || 'Документ').replace(/\.(docx|pdf)$/i, '');
    const filename = typeof WB.sanitizeExportFilename === 'function'
      ? WB.sanitizeExportFilename(baseName, 'docx')
      : `${baseName}.docx`;
    WB.triggerDownload(blob, filename);
  };

  WB.downloadEditedDocument = function () {
    if (WB.pdfEditor && WB.pdfEditor.isDocx) {
      return WB.downloadEditedDocx();
    }
    if (WB.pdfEditor && WB.pdfEditor.isPhoto && WB.pdfEditor.pages.length <= 1 && typeof WB.downloadEditedPhoto === 'function') {
      return WB.downloadEditedPhoto('png');
    }
    if (typeof WB.downloadEditedPdf === 'function') {
      return WB.downloadEditedPdf();
    }
  };

  // =======================================================================
  // 6. Лента Microsoft Word внутри редактора документа (только для DOCX)
  // =======================================================================
  WB.updateDocxWordCount = function () {
    const badge = document.getElementById('wordRibbonWordCount');
    if (!badge) return;
    const layers = document.querySelectorAll('#pdfPagesStack .docx-word-layer');
    let text = '';
    if (layers.length > 0) {
      layers.forEach(l => { text += ' ' + (l.innerText || ''); });
    } else if (Array.isArray(WB.pdfEditor.docxPages)) {
      WB.pdfEditor.docxPages.forEach(p => {
        if (p && p.kind === 'docx' && p.html) {
          text += ' ' + p.html.replace(/<[^>]+>/g, ' ');
        }
      });
    }
    const count = text.trim().split(/\s+/).filter(Boolean).length;
    badge.textContent = `Слов: ${count}`;
  };

  let docxSyncTimer = null;
  WB.scheduleDocxHtmlSync = function (pageIdx) {
    if (!WB.pdfEditor || !WB.pdfEditor.isOpen || !WB.pdfEditor.isDocx || !WB.pdfEditor.targetWidgetId) return;
    if (docxSyncTimer) clearTimeout(docxSyncTimer);
    docxSyncTimer = setTimeout(() => {
      docxSyncTimer = null;
      if (!WB.pdfEditor || !WB.pdfEditor.isDocx || !Array.isArray(WB.pdfEditor.docxPages)) return;
      const idx = typeof pageIdx === 'number' ? pageIdx : (WB.pdfEditor.currentPage || 0);
      const dp = WB.pdfEditor.docxPages[idx];
      if (!dp || dp.kind !== 'docx') return;
      if (typeof WB.broadcastPdfEvent === 'function') {
        WB.broadcastPdfEvent('pdf_docx_html', {
          widgetId: WB.pdfEditor.targetWidgetId,
          pageIdx: idx,
          html: dp.html || ''
        });
      }
    }, 180);
  };

  WB.syncActiveDocxLayersToState = function (opts) {
    if (!WB.pdfEditor || !WB.pdfEditor.isDocx || !Array.isArray(WB.pdfEditor.docxPages)) return;
    let changedIdx = null;
    document.querySelectorAll('#pdfPagesStack .docx-word-layer').forEach(layer => {
      const idx = Number(layer.dataset.pageIdx);
      if (!Number.isNaN(idx) && WB.pdfEditor.docxPages[idx] && WB.pdfEditor.docxPages[idx].kind === 'docx') {
        if (WB.pdfEditor.docxPages[idx].html !== layer.innerHTML) {
          WB.pdfEditor.docxPages[idx].html = layer.innerHTML;
          changedIdx = idx;
        }
      }
    });
    const w = WB.state.widgets.find(item => item.id === WB.pdfEditor.targetWidgetId);
    if (w) {
      w.docxPages = WB.pdfEditor.docxPages.map(p => p ? Object.assign({}, p) : null);
    }
    if (changedIdx !== null && !(opts && opts.silentSync)) {
      WB.scheduleDocxHtmlSync(changedIdx);
    }
  };

  WB.focusActiveWordLayer = function () {
    const cur = WB.pdfEditor.currentPage || 0;
    let layer = document.querySelector(`#pdfPagesStack .docx-word-layer[data-page-idx="${cur}"]`);
    if (!layer) layer = document.querySelector('#pdfPagesStack .docx-word-layer');
    if (layer && document.activeElement !== layer) {
      layer.focus({ preventScroll: true });
    }
    return layer;
  };

  WB.ensureWordEditMode = function () {
    if (WB.pdfEditor.tool !== 'word' && typeof WB.setPdfEditorTool === 'function') {
      WB.setPdfEditorTool('word');
    }
    return WB.focusActiveWordLayer();
  };

  WB.execWordCommand = function (cmd, value = null) {
    WB.ensureWordEditMode();
    try {
      document.execCommand('styleWithCSS', false, true);
    } catch (_) {}
    document.execCommand(cmd, false, value);
    WB.syncActiveDocxLayersToState();
    WB.updateDocxWordCount();
    WB.syncWordRibbonState();
  };

  WB.applyWordBlockStyle = function (tagVal) {
    WB.ensureWordEditMode();
    const tag = ['P', 'H1', 'H2', 'H3'].includes(tagVal) ? tagVal : 'P';
    document.execCommand('formatBlock', false, `<${tag}>`);
    WB.syncActiveDocxLayersToState();
    WB.syncWordRibbonState();
  };

  WB.applyWordFontFamily = function (family) {
    if (!family) return;
    WB.ensureWordEditMode();
    try { document.execCommand('styleWithCSS', false, true); } catch (_) {}
    document.execCommand('fontName', false, family);
    WB.syncActiveDocxLayersToState();
  };

  WB.applyWordFontSize = function (ptVal) {
    const pt = Math.max(8, Math.min(72, Number(ptVal) || 12));
    WB.ensureWordEditMode();
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      const span = document.createElement('span');
      span.style.fontSize = `${pt}pt`;
      try {
        range.surroundContents(span);
      } catch (_) {
        const frag = range.extractContents();
        span.appendChild(frag);
        range.insertNode(span);
      }
      sel.removeAllRanges();
      const nextRange = document.createRange();
      nextRange.selectNodeContents(span);
      sel.addRange(nextRange);
    } else {
      const layer = WB.focusActiveWordLayer();
      if (layer) layer.style.fontSize = `${pt}pt`;
    }
    WB.syncActiveDocxLayersToState();
  };

  WB.applyWordTextColor = function (hex) {
    if (!hex) return;
    WB.ensureWordEditMode();
    try { document.execCommand('styleWithCSS', false, true); } catch (_) {}
    document.execCommand('foreColor', false, hex);
    const bar = document.getElementById('wordTextColorBar');
    if (bar) bar.style.background = hex;
    WB.syncActiveDocxLayersToState();
  };

  WB.applyWordHighlight = function (hex) {
    if (!hex) return;
    WB.ensureWordEditMode();
    try { document.execCommand('styleWithCSS', false, true); } catch (_) {}
    if (!document.execCommand('hiliteColor', false, hex)) {
      document.execCommand('backColor', false, hex);
    }
    const bar = document.getElementById('wordHighlightColorBar');
    if (bar) bar.style.background = hex;
    WB.syncActiveDocxLayersToState();
  };

  WB.insertWordTable = function () {
    const layer = WB.ensureWordEditMode();
    if (!layer) return;
    const tblHtml =
      '<table class="docx-table"><tbody>' +
      '<tr><td style="background-color:#eff6ff"><strong>Заголовок 1</strong></td><td style="background-color:#eff6ff"><strong>Заголовок 2</strong></td><td style="background-color:#eff6ff"><strong>Заголовок 3</strong></td></tr>' +
      '<tr><td>Ячейка 1</td><td>Ячейка 2</td><td>Ячейка 3</td></tr>' +
      '<tr><td>Данные</td><td>Данные</td><td>Данные</td></tr>' +
      '</tbody></table><p><br></p>';
    document.execCommand('insertHTML', false, tblHtml);
    WB.syncActiveDocxLayersToState();
    WB.updateDocxWordCount();
  };

  WB.syncWordRibbonState = function () {
    const isWordTool = WB.pdfEditor && WB.pdfEditor.tool === 'word';
    document.getElementById('wordModeToggleBtn')?.classList.toggle('active', isWordTool);
    if (!isWordTool) return;

    const cmdMap = {
      wordBoldBtn: 'bold',
      wordItalicBtn: 'italic',
      wordUnderlineBtn: 'underline',
      wordStrikeBtn: 'strikeThrough',
      wordAlignLeftBtn: 'justifyLeft',
      wordAlignCenterBtn: 'justifyCenter',
      wordAlignRightBtn: 'justifyRight',
      wordAlignJustifyBtn: 'justifyFull',
      wordUlBtn: 'insertUnorderedList',
      wordOlBtn: 'insertOrderedList'
    };
    for (const [id, cmd] of Object.entries(cmdMap)) {
      const btn = document.getElementById(id);
      if (!btn) continue;
      let active = false;
      try { active = document.queryCommandState(cmd); } catch (_) {}
      btn.classList.toggle('active', active);
    }
  };

  WB.updateWordRibbonVisibility = function () {
    const wrap = document.getElementById('wordRibbonWrap');
    const dlBtn = document.getElementById('pdfDownloadPdfBtn');
    const isDocx = !!(WB.pdfEditor && WB.pdfEditor.isOpen && WB.pdfEditor.isDocx);
    const isPhoto = !!(WB.pdfEditor && WB.pdfEditor.isOpen && WB.pdfEditor.isPhoto);

    if (wrap) wrap.style.display = isDocx ? 'flex' : 'none';
    if (dlBtn) {
      if (isDocx) {
        dlBtn.title = 'Скачать документ как Word (.docx)';
        dlBtn.setAttribute('aria-label', 'Скачать DOCX');
      } else if (isPhoto) {
        const multi = (WB.pdfEditor.pages || []).length > 1;
        dlBtn.title = multi ? 'Скачать все страницы как PDF' : 'Скачать фото с пометками (PNG)';
        dlBtn.setAttribute('aria-label', multi ? 'Скачать PDF' : 'Скачать PNG');
      } else {
        dlBtn.title = 'Скачать PDF (все страницы с пометками)';
        dlBtn.setAttribute('aria-label', 'Скачать PDF');
      }
    }
    if (isDocx) {
      WB.updateDocxWordCount();
      WB.syncWordRibbonState();
    }
  };

  WB.mountDocxWordLayer = function (stage, idx, natW, natH) {
    if (!WB.pdfEditor || !WB.pdfEditor.isDocx || !Array.isArray(WB.pdfEditor.docxPages)) return;
    const dp = WB.pdfEditor.docxPages[idx];
    if (!dp || dp.kind !== 'docx') return;

    const existing = stage.querySelector('.docx-word-layer');
    if (existing) existing.remove();

    const layer = document.createElement('div');
    layer.className = `docx-word-layer ${WB.pdfEditor.tool === 'word' ? 'editing-word' : ''}`;
    layer.dataset.pageIdx = String(idx);
    layer.contentEditable = 'true';
    layer.spellcheck = true;
    layer.setAttribute('role', 'textbox');
    layer.setAttribute('aria-multiline', 'true');
    layer.setAttribute('aria-label', `Текст Word — страница ${idx + 1}`);
    layer.style.width = `${natW}px`;
    layer.style.minHeight = `${natH}px`;
    layer.style.transform = `scale(${WB.pdfEditor.zoom})`;
    layer.innerHTML = dp.html || '<p><br></p>';

    layer.addEventListener('focus', () => {
      if (typeof WB.setPdfActivePageMeta === 'function') WB.setPdfActivePageMeta(idx);
      WB.syncWordRibbonState();
    });
    layer.addEventListener('input', () => {
      if (WB.pdfEditor.docxPages[idx]) {
        WB.pdfEditor.docxPages[idx].html = layer.innerHTML;
      }
      const w = WB.state.widgets.find(item => item.id === WB.pdfEditor.targetWidgetId);
      if (w && Array.isArray(w.docxPages) && w.docxPages[idx]) {
        w.docxPages[idx].html = layer.innerHTML;
      }
      WB.pdfEditor.docxDirty = true;
      WB.updateDocxWordCount();
      WB.scheduleDocxHtmlSync(idx);
    });
    layer.addEventListener('keyup', () => WB.syncWordRibbonState());
    layer.addEventListener('mouseup', () => WB.syncWordRibbonState());

    const overlay = stage.querySelector('.pdf-page-overlay');
    if (overlay) {
      stage.insertBefore(layer, overlay);
    } else {
      stage.appendChild(layer);
    }
  };

  // =======================================================================
  // 7. Импорт DOCX и PDF на доску
  // =======================================================================
  WB.importDocxFileToBoard = async function (file) {
    try {
      if (typeof WB.showToast === 'function') {
        WB.showToast(`📘 Открываем документ Word: ${file.name}...`, 2800);
      }
      const buf = await file.arrayBuffer();
      const zipFiles = await unzipBufferToMap(buf);
      const docBytes = zipFiles.get('word/document.xml');
      if (!docBytes) throw new Error('В файле DOCX отсутствует word/document.xml');

      const decoder = new TextDecoder('utf-8');
      const docXml = decoder.decode(docBytes);
      const relsBytes = zipFiles.get('word/_rels/document.xml.rels');
      const relsXml = relsBytes ? decoder.decode(relsBytes) : '';
      const numBytes = zipFiles.get('word/numbering.xml');
      const numXml = numBytes ? decoder.decode(numBytes) : '';

      const mediaMap = new Map();
      for (const [entryName, bytes] of zipFiles.entries()) {
        if (/^word\/media\/.+\.(png|jpe?g|gif|webp)$/i.test(entryName)) {
          mediaMap.set(entryName, bytesToDataUrl(bytes, entryName));
        }
      }

      const blocks = parseDocxDocumentXml(docXml, relsXml, numXml, mediaMap);
      const pageBlocksList = splitBlocksIntoDocxPages(blocks);
      const docxPages = [];
      const previewPages = [];

      for (const pBlocks of pageBlocksList) {
        const html = WB.docxBlocksToHtml(pBlocks);
        docxPages.push({ kind: 'docx', html });
        const canvas = await WB.renderDocxBlocksToCanvas(pBlocks, PAGE_W, PAGE_H);
        previewPages.push(canvas.toDataURL('image/jpeg', 0.9));
      }

      const dims = await WB.measureImageDimensions(previewPages[0]);
      const fit = WB.calcAspectFitBox(dims.width, dims.height, 480, 560, 140);
      const center = WB.toWorld(window.innerWidth / 2, window.innerHeight / 2);

      const widgetObj = WB.addWidget('image', {
        x: center.x - fit.w / 2,
        y: center.y - (fit.h + 56) / 2,
        w: fit.w,
        h: fit.h + 56,
        src: previewPages[0],
        isPdf: true,
        isDocx: true,
        docType: 'docx',
        docKind: 'docx',
        docLabel: 'DOCX',
        docEmoji: '📘',
        docAccent: '#2563eb',
        pdfTitle: file.name || 'Документ.docx',
        pdfPages: previewPages,
        docxPages,
        currentPage: 0
      });

      if (typeof WB.showToast === 'function') {
        WB.showToast(`✅ Загружен DOCX (${previewPages.length} стр.). Режим Word + PDF готов!`, 2600, 'success');
      }
      if (widgetObj && typeof WB.openPdfEditorForWidget === 'function') {
        WB.openPdfEditorForWidget(widgetObj.id);
      }
    } catch (err) {
      console.error('Ошибка импорта DOCX:', err);
      if (typeof WB.showToast === 'function') {
        WB.showToast(`⚠️ Не удалось открыть DOCX: ${err?.message || 'проверьте файл'}`, 4000, 'error');
      }
    }
  };

  WB.createBlankDocumentOnBoard = async function (style = 'grid') {
    if (typeof WB.closeAllDropdowns === 'function') WB.closeAllDropdowns();
    const blankUrl = typeof WB.generateBlankPdfPageDataUrl === 'function'
      ? WB.generateBlankPdfPageDataUrl(style || 'grid', PAGE_W, PAGE_H)
      : '';
    if (!blankUrl) return;

    const dims = await WB.measureImageDimensions(blankUrl);
    const fit = WB.calcAspectFitBox(dims.width, dims.height, 480, 560, 140);
    const center = WB.toWorld(window.innerWidth / 2, window.innerHeight / 2);
    const widgetObj = WB.addWidget('image', {
      x: center.x - fit.w / 2,
      y: center.y - (fit.h + 56) / 2,
      w: fit.w,
      h: fit.h + 56,
      src: blankUrl,
      isPdf: true,
      isDocx: false,
      docKind: 'pdf',
      docLabel: 'PDF',
      docAccent: '#dc2626',
      pdfTitle: 'Новый документ.pdf',
      pdfPages: [blankUrl],
      currentPage: 0
    });
    if (widgetObj && typeof WB.openPdfEditorForWidget === 'function') {
      WB.openPdfEditorForWidget(widgetObj.id);
    }
  };

  WB.importAnyFileToBoard = async function (file) {
    if (WB.userRole === 'student') return;
    if (!file) return;
    const meta = WB.detectDocumentMeta(file.name, file.type);

    if (meta.kind === 'image') {
      if (typeof WB.insertImageFile === 'function') WB.insertImageFile(file);
      return;
    }
    if (meta.kind === 'pdf') {
      if (typeof WB.importPDFFileToBoard === 'function') await WB.importPDFFileToBoard(file);
      return;
    }
    if (meta.kind === 'docx') {
      await WB.importDocxFileToBoard(file);
      return;
    }
    if (typeof WB.showToast === 'function') {
      WB.showToast('⚠️ Поддерживаются только документы PDF и DOCX (и изображения)', 3200, 'error');
    }
  };

  WB.handleUniversalFileUpload = function (e) {
    if (WB.userRole === 'student') {
      if (e && e.target) e.target.value = '';
      return;
    }
    const file = e && e.target && e.target.files ? e.target.files[0] : null;
    if (file) WB.importAnyFileToBoard(file);
    if (e && e.target) e.target.value = '';
  };

  document.addEventListener('selectionchange', () => {
    if (WB.pdfEditor && WB.pdfEditor.isOpen && WB.pdfEditor.isDocx && WB.pdfEditor.tool === 'word') {
      WB.syncWordRibbonState();
    }
  });
})();
