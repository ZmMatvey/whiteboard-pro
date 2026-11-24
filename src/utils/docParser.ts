// Чистая логика работы с документами (строго PDF и DOCX) + двусторонний движок Microsoft Word OpenXML (DOCX <-> модель <-> HTML <-> .docx)

export type DocumentKind = 'pdf' | 'docx' | 'image' | 'unsupported';

export interface DocFormatMeta {
  kind: DocumentKind;
  label: string;
  accentColor: string;
  isDocument: boolean;
}

export function detectDocumentKind(filename: string, mimeType = ''): DocumentKind {
  const name = String(filename || '').trim().toLowerCase();
  const mime = String(mimeType || '').trim().toLowerCase();
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';

  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (
    ext === 'docx' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx';
  }
  if (
    ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'avif'].includes(ext) ||
    mime.startsWith('image/')
  ) {
    return 'image';
  }
  return 'unsupported';
}

export function getDocFormatMeta(kind: DocumentKind): DocFormatMeta {
  switch (kind) {
    case 'pdf':
      return { kind: 'pdf', label: 'PDF', accentColor: '#dc2626', isDocument: true };
    case 'docx':
      return { kind: 'docx', label: 'DOCX', accentColor: '#2563eb', isDocument: true };
    case 'image':
      return { kind: 'image', label: 'IMG', accentColor: '#059669', isDocument: false };
    default:
      return { kind: 'unsupported', label: 'FILE', accentColor: '#64748b', isDocument: false };
  }
}

export function decodeXmlEntities(str: string): string {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)));
}

export function escapeXml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// =====================================================================
// ZIP reader (Central Directory) & ZIP writer (Store + CRC32 + UTF-8)
// =====================================================================

export interface ZipEntryMeta {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  dataOffset: number;
  compressedData: Uint8Array;
}

const CRC32_TABLE = (() => {
  const tbl = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    tbl[i] = c >>> 0;
  }
  return tbl;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function readZipCentralDirectory(bytes: Uint8Array): ZipEntryMeta[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocdOffset = -1;
  const minOffset = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minOffset; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return [];

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const decoder = new TextDecoder('utf-8');
  const entries: ZipEntryMeta[] = [];

  let ptr = cdOffset;
  for (let i = 0; i < totalEntries && ptr + 46 <= bytes.length; i++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) break;
    const compressionMethod = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const uncompressedSize = view.getUint32(ptr + 24, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localHeaderOffset = view.getUint32(ptr + 42, true);

    const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    if (localHeaderOffset + 30 > bytes.length) continue;
    if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) continue;
    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;
    if (dataOffset + compressedSize > bytes.length) continue;

    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      dataOffset,
      compressedData: bytes.subarray(dataOffset, dataOffset + compressedSize)
    });
  }
  return entries;
}

export interface ZipWriteEntry {
  name: string;
  data: string | Uint8Array;
}

export function buildZipBytes(entries: ZipWriteEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const dataBytes = typeof entry.data === 'string' ? enc.encode(entry.data) : entry.data;
    const checksum = crc32(dataBytes);

    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 filename flag
    lv.setUint16(8, 0, true); // stored (no compression — 100% compatible with Word & LibreOffice)
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

  const totalLen = offset + centralSize + 22;
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const part of localParts) {
    out.set(part, pos);
    pos += part.length;
  }
  for (const part of centralParts) {
    out.set(part, pos);
    pos += part.length;
  }
  out.set(eocd, pos);
  return out;
}

// =====================================================================
// Модель документа Word (DOCX)
// =====================================================================

export type DocTextAlign = 'left' | 'center' | 'right' | 'justify';

export interface DocxRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  fontFamily?: string;
  fontSizePt?: number;
  color?: string; // #RRGGBB
  highlight?: string; // #RRGGBB
}

export interface DocxTableCell {
  text: string;
  runs?: DocxRun[];
  shading?: string; // #RRGGBB
  colSpan?: number;
  align?: DocTextAlign;
}

export interface DocxBlock {
  type: 'heading' | 'paragraph' | 'list-item' | 'table' | 'image' | 'page-break';
  level?: number; // heading 1..3 or list nesting 0..3
  ordered?: boolean;
  align?: DocTextAlign;
  text?: string;
  runs?: DocxRun[];
  rows?: DocxTableCell[][];
  imageTarget?: string;
  imageDataUrl?: string;
  imageWidthPx?: number;
  imageHeightPx?: number;
  alt?: string;
}

const WORD_HIGHLIGHT_TO_HEX: Record<string, string> = {
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

export function normalizeHexColor(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const s = String(raw).trim().toLowerCase();
  if (!s || s === 'auto' || s === 'none' || s === 'transparent') return undefined;
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
  if (/^#[0-9a-f]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  }
  const rgbMatch = s.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (rgbMatch) {
    const toH = (v: string) => Math.max(0, Math.min(255, Number(v))).toString(16).padStart(2, '0');
    return `#${toH(rgbMatch[1])}${toH(rgbMatch[2])}${toH(rgbMatch[3])}`;
  }
  return undefined;
}

export function parseRelationshipsXml(xml: string): Record<string, string> {
  const map: Record<string, string> = {};
  if (!xml) return map;
  const re = /<Relationship\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const tag = m[0];
    const idM = tag.match(/\bId="([^"]+)"/i);
    const tgtM = tag.match(/\bTarget="([^"]+)"/i);
    if (idM && tgtM) {
      map[idM[1]] = tgtM[1];
    }
  }
  return map;
}

export function parseNumberingOrderedMap(numberingXml?: string): Record<string, boolean> {
  const orderedByNumId: Record<string, boolean> = {};
  if (!numberingXml) return orderedByNumId;

  const absOrdered: Record<string, boolean> = {};
  const absRe = /<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/gi;
  let am: RegExpExecArray | null;
  while ((am = absRe.exec(numberingXml)) !== null) {
    const id = am[1];
    const body = am[2];
    const fmtM = body.match(/<w:numFmt\b[^>]*w:val="([^"]+)"/i);
    const fmt = fmtM ? fmtM[1].toLowerCase() : 'bullet';
    absOrdered[id] = fmt !== 'bullet' && fmt !== 'none';
  }

  const numRe = /<w:num\b[^>]*w:numId="(\d+)"[^>]*>([\s\S]*?)<\/w:num>/gi;
  let nm: RegExpExecArray | null;
  while ((nm = numRe.exec(numberingXml)) !== null) {
    const numId = nm[1];
    const absRefM = nm[2].match(/<w:abstractNumId\b[^>]*w:val="(\d+)"/i);
    if (absRefM && absRefM[1] in absOrdered) {
      orderedByNumId[numId] = absOrdered[absRefM[1]];
    }
  }
  return orderedByNumId;
}

function parseDocxRunsFromParagraph(pXml: string): {
  runs: DocxRun[];
  hasPageBreak: boolean;
  imageEmbedIds: string[];
} {
  const runs: DocxRun[] = [];
  let hasPageBreak =
    /<w:br\b[^>]*w:type="page"/i.test(pXml) ||
    /<w:lastRenderedPageBreak\b/i.test(pXml) ||
    /<w:pageBreakBefore\b(?![^>]*w:val="(?:0|false)")/i.test(pXml);
  const imageEmbedIds: string[] = [];

  const runRe = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/gi;
  let rm: RegExpExecArray | null;
  while ((rm = runRe.exec(pXml)) !== null) {
    const rBody = rm[1];
    const blipRe = /<a:blip\b[^>]*r:embed="([^"]+)"/gi;
    let bm: RegExpExecArray | null;
    while ((bm = blipRe.exec(rBody)) !== null) {
      imageEmbedIds.push(bm[1]);
    }
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

    let highlight: string | undefined;
    const hlM = rPr.match(/<w:highlight\b[^>]*w:val="([^"]+)"/i);
    if (hlM) {
      highlight = WORD_HIGHLIGHT_TO_HEX[hlM[1].toLowerCase()] || '#fef08a';
    } else {
      const shdM = rPr.match(/<w:shd\b[^>]*w:fill="([0-9a-fA-F]{6})"/i);
      if (shdM && shdM[1].toLowerCase() !== 'ffffff') {
        highlight = `#${shdM[1].toLowerCase()}`;
      }
    }

    const tokenRe = /<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br(?:\s+[^>]*)?\/>/gi;
    let tm: RegExpExecArray | null;
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
      const run: DocxRun = { text: txt };
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

export function parseDocxDocumentXml(
  xml: string,
  relsXml?: string,
  numberingXml?: string
): DocxBlock[] {
  const blocks: DocxBlock[] = [];
  if (!xml) return blocks;

  const rels = parseRelationshipsXml(relsXml || '');
  const orderedMap = parseNumberingOrderedMap(numberingXml || '');
  const bodyM = xml.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/i);
  const body = bodyM ? bodyM[1] : xml;

  function findExactXmlTag(str: string, tagName: string, fromIdx: number): number {
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

      const rows: DocxTableCell[][] = [];
      const rowRe = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/gi;
      let rowM: RegExpExecArray | null;
      while ((rowM = rowRe.exec(tblXml)) !== null) {
        const cells: DocxTableCell[] = [];
        const cellRe = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/gi;
        let cellM: RegExpExecArray | null;
        while ((cellM = cellRe.exec(rowM[1])) !== null) {
          const tcXml = cellM[1];
          const tcPrM = tcXml.match(/<w:tcPr\b[^>]*>([\s\S]*?)<\/w:tcPr>/i);
          const tcPr = tcPrM ? tcPrM[1] : '';
          const shdM = tcPr.match(/<w:shd\b[^>]*w:fill="([0-9a-fA-F]{6})"/i);
          const shading = shdM && shdM[1].toLowerCase() !== 'ffffff' ? `#${shdM[1].toLowerCase()}` : undefined;
          const spanM = tcPr.match(/<w:gridSpan\b[^>]*w:val="(\d+)"/i);
          const colSpan = spanM ? Math.max(1, Number(spanM[1])) : undefined;

          const pRuns: DocxRun[] = [];
          const pTexts: string[] = [];
          let cellAlign: DocTextAlign | undefined;
          const cpRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi;
          let cpM: RegExpExecArray | null;
          while ((cpM = cpRe.exec(tcXml)) !== null) {
            const jcM = cpM[1].match(/<w:jc\b[^>]*w:val="([^"]+)"/i);
            if (!cellAlign && jcM) {
              const v = jcM[1].toLowerCase();
              if (v === 'center' || v === 'right' || v === 'both') {
                cellAlign = v === 'both' ? 'justify' : (v as DocTextAlign);
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
          const cellObj: DocxTableCell = { text: pTexts.join('\n') };
          if (pRuns.length > 0) cellObj.runs = pRuns;
          if (shading) cellObj.shading = shading;
          if (colSpan && colSpan > 1) cellObj.colSpan = colSpan;
          if (cellAlign) cellObj.align = cellAlign;
          cells.push(cellObj);
        }
        if (cells.length > 0) rows.push(cells);
      }
      if (rows.length > 0) {
        blocks.push({ type: 'table', rows });
      }
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
    let align: DocTextAlign = 'left';
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
      blocks.push({ type: 'image', imageTarget: fullPath, alt: cleanTarget.split('/').pop() || 'image' });
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

export function splitBlocksIntoDocxPages(blocks: DocxBlock[]): DocxBlock[][] {
  const pages: DocxBlock[][] = [[]];
  for (const b of blocks) {
    if (b.type === 'page-break') {
      if (pages[pages.length - 1].length > 0) {
        pages.push([]);
      }
      continue;
    }
    pages[pages.length - 1].push(b);
  }
  return pages.filter(p => p.length > 0).length > 0 ? pages : [[]];
}

// =====================================================================
// Модель Word <-> Редактируемый HTML
// =====================================================================

export function docxRunsToHtml(runs: DocxRun[]): string {
  return runs
    .map(r => {
      let inner = escapeHtml(r.text).replace(/\n/g, '<br>');
      if (r.bold) inner = `<strong>${inner}</strong>`;
      if (r.italic) inner = `<em>${inner}</em>`;
      if (r.underline) inner = `<u>${inner}</u>`;
      if (r.strike) inner = `<s>${inner}</s>`;
      const styles: string[] = [];
      if (r.fontFamily) styles.push(`font-family:${escapeHtml(r.fontFamily)}`);
      if (r.fontSizePt) styles.push(`font-size:${r.fontSizePt}pt`);
      if (r.color) styles.push(`color:${r.color}`);
      if (r.highlight) styles.push(`background-color:${r.highlight}`);
      if (styles.length > 0) {
        inner = `<span style="${styles.join(';')}">${inner}</span>`;
      }
      return inner;
    })
    .join('');
}

export function docxBlocksToHtml(blocks: DocxBlock[]): string {
  if (!blocks || blocks.length === 0) return '<p><br></p>';
  const out: string[] = [];
  let i = 0;

  while (i < blocks.length) {
    const b = blocks[i];
    if (b.type === 'list-item') {
      const ordered = !!b.ordered;
      const tag = ordered ? 'ol' : 'ul';
      const items: string[] = [];
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
      const rowsHtml = b.rows
        .map(row => {
          const cellsHtml = row
            .map(cell => {
              const cStyles: string[] = [];
              if (cell.shading) cStyles.push(`background-color:${cell.shading}`);
              if (cell.align && cell.align !== 'left') cStyles.push(`text-align:${cell.align}`);
              const styleAttr = cStyles.length ? ` style="${cStyles.join(';')}"` : '';
              const spanAttr = cell.colSpan && cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : '';
              const inner = cell.runs && cell.runs.length ? docxRunsToHtml(cell.runs) : escapeHtml(cell.text || '');
              return `<td${spanAttr}${styleAttr}>${inner || '&nbsp;'}</td>`;
            })
            .join('');
          return `<tr>${cellsHtml}</tr>`;
        })
        .join('');
      out.push(`<table class="docx-table"><tbody>${rowsHtml}</tbody></table>`);
    } else if (b.type === 'image' && b.imageDataUrl) {
      const wAttr = b.imageWidthPx ? ` width="${Math.round(b.imageWidthPx)}"` : '';
      out.push(`<p class="docx-img-p"><img src="${b.imageDataUrl}" alt="${escapeHtml(b.alt || 'image')}"${wAttr}></p>`);
    }
    i++;
  }

  return out.join('\n');
}

// =====================================================================
// Генератор настоящего OpenXML .docx (валидный для Microsoft Word / LibreOffice / Google Docs)
// =====================================================================

export interface DocxExportPageInput {
  kind: 'docx' | 'blank';
  blocks?: DocxBlock[];
  annotationImageDataUrl?: string;
  annotationWidthPx?: number;
  annotationHeightPx?: number;
  blankPageDataUrl?: string;
  blankWidthPx?: number;
  blankHeightPx?: number;
}

export function dataUrlToBinary(dataUrl: string): { bytes: Uint8Array; ext: 'png' | 'jpeg' } | null {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
  if (!m) return null;
  const rawType = m[1].toLowerCase();
  const ext: 'png' | 'jpeg' = rawType === 'png' ? 'png' : 'jpeg';
  const b64 = m[2].replace(/\s+/g, '');

  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(b64, 'base64');
    return { bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), ext };
  }
  const binStr = atob(b64);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) {
    bytes[i] = binStr.charCodeAt(i);
  }
  return { bytes, ext };
}

function serializeRunToOoxml(run: DocxRun): string {
  const rPrParts: string[] = [];
  if (run.fontFamily) {
    const f = escapeXml(run.fontFamily);
    rPrParts.push(`<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}"/>`);
  }
  if (run.bold) rPrParts.push('<w:b/>');
  if (run.italic) rPrParts.push('<w:i/>');
  if (run.underline) rPrParts.push('<w:u w:val="single"/>');
  if (run.strike) rPrParts.push('<w:strike/>');
  const hexColor = normalizeHexColor(run.color);
  if (hexColor) {
    rPrParts.push(`<w:color w:val="${hexColor.slice(1).toUpperCase()}"/>`);
  }
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
  const content = lines
    .map((line, idx) => {
      const tXml = `<w:t xml:space="preserve">${escapeXml(line)}</w:t>`;
      return idx > 0 ? `<w:br/>${tXml}` : tXml;
    })
    .join('');
  return `<w:r>${rPr}${content}</w:r>`;
}

function serializeAlignToOoxml(align?: DocTextAlign): string {
  if (!align || align === 'left') return '';
  const val = align === 'justify' ? 'both' : align;
  return `<w:jc w:val="${val}"/>`;
}

function serializeImageParagraphToOoxml(
  rId: string,
  docPrId: number,
  name: string,
  widthPx: number,
  heightPx: number
): string {
  // 1 px (96 DPI) = 9525 EMU. Max content width on A4 (with 2cm margins) ~ 610 px = 5,810,250 EMU.
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

export function buildDocxBytes(pages: DocxExportPageInput[]): Uint8Array {
  const safePages = Array.isArray(pages) && pages.length > 0 ? pages : [{ kind: 'docx' as const, blocks: [] }];
  const bodyParts: string[] = [];
  const mediaFiles: { rId: string; fileName: string; bytes: Uint8Array; ext: 'png' | 'jpeg' }[] = [];
  let nextRelNum = 3; // rId1 = styles, rId2 = numbering
  let nextDocPrId = 1;

  const registerImage = (dataUrl: string, wPx = 560, hPx = 380, label = 'Image'): string | null => {
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
      const imgXml = registerImage(
        page.blankPageDataUrl,
        page.blankWidthPx || 610,
        page.blankHeightPx || 860,
        `Страница ${pageIdx + 1}`
      );
      if (imgXml) bodyParts.push(imgXml);
      return;
    }

    const blocks = page.blocks || [];
    for (const block of blocks) {
      if (block.type === 'page-break') {
        bodyParts.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
        continue;
      }

      if (block.type === 'image' && block.imageDataUrl) {
        const imgXml = registerImage(
          block.imageDataUrl,
          block.imageWidthPx || 520,
          block.imageHeightPx || 320,
          block.alt || 'Image'
        );
        if (imgXml) bodyParts.push(imgXml);
        continue;
      }

      if (block.type === 'heading') {
        const lvl = Math.max(1, Math.min(3, block.level || 1));
        const runs = block.runs && block.runs.length > 0 ? block.runs : [{ text: block.text || '' }];
        const pPr = `<w:pPr><w:pStyle w:val="Heading${lvl}"/>${serializeAlignToOoxml(block.align)}</w:pPr>`;
        bodyParts.push(`<w:p>${pPr}${runs.map(serializeRunToOoxml).join('')}</w:p>`);
        continue;
      }

      if (block.type === 'list-item') {
        const numId = block.ordered ? '2' : '1';
        const ilvl = Math.max(0, Math.min(3, block.level || 0));
        const runs = block.runs && block.runs.length > 0 ? block.runs : [{ text: block.text || '' }];
        const pPr = `<w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>${serializeAlignToOoxml(block.align)}</w:pPr>`;
        bodyParts.push(`<w:p>${pPr}${runs.map(serializeRunToOoxml).join('')}</w:p>`);
        continue;
      }

      if (block.type === 'table' && block.rows && block.rows.length > 0) {
        const maxCols = Math.max(1, ...block.rows.map(r => r.reduce((s, c) => s + (c.colSpan || 1), 0)));
        const colW = Math.floor(9638 / maxCols);
        const gridCols = Array.from({ length: maxCols }, () => `<w:gridCol w:w="${colW}"/>`).join('');
        const trXml = block.rows
          .map(row => {
            const tcXml = row
              .map(cell => {
                const tcPrParts: string[] = [`<w:tcW w:w="${colW * (cell.colSpan || 1)}" w:type="dxa"/>`];
                if (cell.colSpan && cell.colSpan > 1) {
                  tcPrParts.push(`<w:gridSpan w:val="${cell.colSpan}"/>`);
                }
                const shd = normalizeHexColor(cell.shading);
                if (shd) {
                  tcPrParts.push(`<w:shd w:val="clear" w:color="auto" w:fill="${shd.slice(1).toUpperCase()}"/>`);
                }
                const cellRuns = cell.runs && cell.runs.length > 0 ? cell.runs : [{ text: cell.text || '' }];
                const pAlign = serializeAlignToOoxml(cell.align);
                const pPr = pAlign ? `<w:pPr>${pAlign}</w:pPr>` : '';
                return `<w:tc><w:tcPr>${tcPrParts.join('')}</w:tcPr><w:p>${pPr}${cellRuns.map(serializeRunToOoxml).join('')}</w:p></w:tc>`;
              })
              .join('');
            return `<w:tr>${tcXml}</w:tr>`;
          })
          .join('');

        bodyParts.push(
          `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="9638" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/></w:tblBorders><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${gridCols}</w:tblGrid>${trXml}</w:tbl>`
        );
        continue;
      }

      // paragraph
      const runs = block.runs && block.runs.length > 0 ? block.runs : [{ text: block.text || '' }];
      const alignXml = serializeAlignToOoxml(block.align);
      const pPr = alignXml ? `<w:pPr>${alignXml}</w:pPr>` : '';
      bodyParts.push(`<w:p>${pPr}${runs.map(serializeRunToOoxml).join('')}</w:p>`);
    }

    // Если поверх Word-страницы нарисованы пометки/фигуры в PDF-режиме — прикладываем аккуратный снимок пометок
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

  if (bodyParts.length === 0) {
    bodyParts.push('<w:p/>');
  }

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
    ...mediaFiles.map(
      m =>
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

  const zipEntries: ZipWriteEntry[] = [
    { name: '[Content_Types].xml', data: contentTypesXml },
    { name: '_rels/.rels', data: rootRelsXml },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/styles.xml', data: stylesXml },
    { name: 'word/numbering.xml', data: numberingXml },
    { name: 'word/_rels/document.xml.rels', data: docRelsXml },
    ...mediaFiles.map(m => ({ name: `word/media/${m.fileName}`, data: m.bytes }))
  ];

  return buildZipBytes(zipEntries);
}

export function countDocxWords(blocks: DocxBlock[]): number {
  let text = '';
  for (const b of blocks || []) {
    if (b.text) text += ' ' + b.text;
    else if (b.runs) text += ' ' + b.runs.map(r => r.text).join('');
    if (b.rows) {
      for (const row of b.rows) {
        for (const c of row) text += ' ' + (c.text || '');
      }
    }
  }
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  return tokens.length;
}
