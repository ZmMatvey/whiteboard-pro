import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectDocumentKind,
  getDocFormatMeta,
  readZipCentralDirectory,
  buildZipBytes,
  parseDocxDocumentXml,
  splitBlocksIntoDocxPages,
  docxBlocksToHtml,
  buildDocxBytes,
  countDocxWords,
  type DocxBlock
} from './docParser';

const SAMPLE_1PX_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';

test('detectDocumentKind strictly supports PDF, DOCX, and images; rejects removed formats', () => {
  assert.equal(detectDocumentKind('lesson.pdf'), 'pdf');
  assert.equal(detectDocumentKind('conspect.docx'), 'docx');
  assert.equal(
    detectDocumentKind('doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    'docx'
  );
  assert.equal(detectDocumentKind('diagram.png'), 'image');

  // Removed hacky formats must no longer be treated as supported documents
  assert.equal(detectDocumentKind('table.xlsx'), 'unsupported');
  assert.equal(detectDocumentKind('data.csv'), 'unsupported');
  assert.equal(detectDocumentKind('slides.pptx'), 'unsupported');
  assert.equal(detectDocumentKind('notes.md'), 'unsupported');
  assert.equal(detectDocumentKind('config.json'), 'unsupported');
  assert.equal(detectDocumentKind('legacy.rtf'), 'unsupported');

  assert.equal(getDocFormatMeta('pdf').isDocument, true);
  assert.equal(getDocFormatMeta('docx').isDocument, true);
  assert.equal(getDocFormatMeta('unsupported').isDocument, false);
});

test('buildZipBytes & readZipCentralDirectory round-trip UTF-8 Cyrillic filenames and binary entries', () => {
  const payload = new Uint8Array([1, 2, 3, 4, 255]);
  const zip = buildZipBytes([
    { name: 'word/document.xml', data: '<w:document>Привет</w:document>' },
    { name: 'word/media/image1.png', data: payload }
  ]);
  const entries = readZipCentralDirectory(zip);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, 'word/document.xml');
  assert.equal(new TextDecoder('utf-8').decode(entries[0].compressedData), '<w:document>Привет</w:document>');
  assert.equal(entries[1].name, 'word/media/image1.png');
  assert.deepEqual(Array.from(entries[1].compressedData), [1, 2, 3, 4, 255]);
});

test('buildDocxBytes produces a valid OpenXML .docx archive that round-trips through parseDocxDocumentXml', () => {
  const page1Blocks: DocxBlock[] = [
    {
      type: 'heading',
      level: 1,
      align: 'center',
      text: 'Законы Ньютона',
      runs: [{ text: 'Законы Ньютона', bold: true, fontFamily: 'Calibri', fontSizePt: 20 }]
    },
    {
      type: 'paragraph',
      align: 'justify',
      runs: [
        { text: 'Формула: ', bold: true, color: '#1d4ed8' },
        { text: 'F = m · a', italic: true, underline: true, highlight: '#fef08a' },
        { text: ' (устарело)', strike: true }
      ]
    },
    {
      type: 'list-item',
      ordered: false,
      level: 0,
      runs: [{ text: 'Инерциальная система отсчёта' }]
    },
    {
      type: 'list-item',
      ordered: true,
      level: 0,
      runs: [{ text: 'Первый пункт плана' }]
    },
    {
      type: 'table',
      rows: [
        [
          { text: 'Величина', runs: [{ text: 'Величина', bold: true }], shading: '#dbeafe' },
          { text: 'Единица СИ', runs: [{ text: 'Единица СИ', bold: true }], shading: '#dbeafe' }
        ],
        [
          { text: 'Сила', runs: [{ text: 'Сила' }] },
          { text: 'Ньютон (Н)', runs: [{ text: 'Ньютон (Н)' }], align: 'right' }
        ]
      ]
    },
    {
      type: 'image',
      imageDataUrl: SAMPLE_1PX_PNG_DATA_URL,
      imageWidthPx: 240,
      imageHeightPx: 120,
      alt: 'Схема'
    }
  ];

  const docxBytes = buildDocxBytes([
    {
      kind: 'docx',
      blocks: page1Blocks,
      annotationImageDataUrl: SAMPLE_1PX_PNG_DATA_URL,
      annotationWidthPx: 400,
      annotationHeightPx: 200
    },
    {
      kind: 'blank',
      blankPageDataUrl: SAMPLE_1PX_PNG_DATA_URL,
      blankWidthPx: 610,
      blankHeightPx: 860
    }
  ]);

  const entries = readZipCentralDirectory(docxBytes);
  const names = entries.map(e => e.name);
  assert.ok(names.includes('[Content_Types].xml'));
  assert.ok(names.includes('_rels/.rels'));
  assert.ok(names.includes('word/document.xml'));
  assert.ok(names.includes('word/styles.xml'));
  assert.ok(names.includes('word/numbering.xml'));
  assert.ok(names.includes('word/_rels/document.xml.rels'));
  assert.ok(names.includes('word/media/image1.png'));
  assert.ok(names.includes('word/media/image2.png'));
  assert.ok(names.includes('word/media/image3.png'));

  const getText = (n: string) =>
    new TextDecoder('utf-8').decode(entries.find(e => e.name === n)!.compressedData);

  const reparsed = parseDocxDocumentXml(
    getText('word/document.xml'),
    getText('word/_rels/document.xml.rels'),
    getText('word/numbering.xml')
  );

  const pages = splitBlocksIntoDocxPages(reparsed);
  assert.equal(pages.length, 2);

  const p1 = pages[0];
  assert.equal(p1[0].type, 'heading');
  assert.equal(p1[0].level, 1);
  assert.equal(p1[0].align, 'center');
  assert.equal(p1[0].text, 'Законы Ньютона');

  assert.equal(p1[1].type, 'paragraph');
  assert.equal(p1[1].align, 'justify');
  assert.equal(p1[1].runs?.[0].bold, true);
  assert.equal(p1[1].runs?.[0].color, '#1d4ed8');
  assert.equal(p1[1].runs?.[1].italic, true);
  assert.equal(p1[1].runs?.[1].underline, true);
  assert.equal(p1[1].runs?.[1].highlight, '#fef08a');
  assert.equal(p1[1].runs?.[2].strike, true);

  assert.equal(p1[2].type, 'list-item');
  assert.equal(p1[2].ordered, false);
  assert.equal(p1[3].type, 'list-item');
  assert.equal(p1[3].ordered, true);

  assert.equal(p1[4].type, 'table');
  assert.equal(p1[4].rows?.length, 2);
  assert.equal(p1[4].rows?.[0][0].shading, '#dbeafe');
  assert.equal(p1[4].rows?.[1][1].align, 'right');

  // Embedded image + annotation image both survived on page 1
  const p1Images = p1.filter(b => b.type === 'image');
  assert.equal(p1Images.length, 2);
  assert.equal(p1Images[0].imageTarget, 'word/media/image1.png');

  // Blank page with grid/annotations survived on page 2 as an embedded image
  assert.equal(pages[1].length, 1);
  assert.equal(pages[1][0].type, 'image');
  assert.equal(pages[1][0].imageTarget, 'word/media/image3.png');
});

test('docxBlocksToHtml renders semantic Word HTML with lists, tables, alignment and inline formatting', () => {
  const html = docxBlocksToHtml([
    { type: 'heading', level: 2, align: 'center', runs: [{ text: 'План урока', bold: true }] },
    { type: 'list-item', ordered: false, runs: [{ text: 'Теория', color: '#2563eb' }] },
    { type: 'list-item', ordered: false, runs: [{ text: 'Практика' }] },
    {
      type: 'table',
      rows: [[{ text: 'A', shading: '#e2e8f0' }, { text: 'B' }]]
    }
  ]);

  assert.ok(html.includes('<h2 style="text-align:center"><strong>План урока</strong></h2>'));
  assert.ok(html.includes('<ul><li><span style="color:#2563eb">Теория</span></li><li>Практика</li></ul>'));
  assert.ok(html.includes('<table class="docx-table"><tbody><tr><td style="background-color:#e2e8f0">A</td><td>B</td></tr></tbody></table>'));
  assert.equal(
    countDocxWords([
      { type: 'heading', level: 1, text: 'Механика и динамика' },
      { type: 'paragraph', text: 'Три слова тут' }
    ]),
    6
  );
});
