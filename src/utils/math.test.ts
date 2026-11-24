import test from 'node:test';
import assert from 'node:assert/strict';
import {
  snapToGrid,
  snapAngle,
  calcSmartSnap,
  getAxesGeometry,
  clientToWorld,
  filterPhysicsFormulas,
  calcAspectFitBox,
  GRID_MODES,
  getNextGridMode,
  getEffectiveGridSize,
  getGridDrawPositions,
  snapPointCombined,
  computeLinearSnappedEndpoint,
  sanitizeExportFilename,
  computeArrowNudgeDelta,
  canStudentModifyObject,
  pushHistoryEntry,
  shiftIndexedRecordOnInsert,
  getPdfBlankPageStyleLabel,
  buildMultiPagePdfBytes,
  normalizePdfPageRows,
  insertPdfPageInRows,
  removePdfPageFromRows,
  shiftIndexedRecordOnDelete,
  splitLatexFormulaParts,
  formatFormulaCountRu,
} from './math';

test('clientToWorld eliminates right/top coordinate shift when canvas has bounding rect offset', () => {
  const cam = { x: 0, y: 0, z: 1 };
  const rect = { left: 45, top: 12, width: 390, height: 844 };

  const pt = clientToWorld(145, 112, cam, rect);
  assert.equal(pt.x, 100);
  assert.equal(pt.y, 100);
});

test('snapToGrid correctly aligns coordinates to 32px grid intersections', () => {
  const p1 = snapToGrid(10, 15, 32);
  assert.equal(p1.x, 0);
  assert.equal(p1.y, 0);

  const p2 = snapToGrid(17, 30, 32);
  assert.equal(p2.x, 32);
  assert.equal(p2.y, 32);
});

test('snapAngle snaps lines to standard geometric angles (0°, 45°, 90°)', () => {
  const pHoriz = snapAngle(0, 0, 100, 3, 15, 5);
  assert.equal(Math.round(pHoriz.y), 0);
  assert.equal(Math.round(pHoriz.x), 100);

  const pVert = snapAngle(0, 0, 2, 100, 15, 5);
  assert.equal(Math.round(pVert.x), 0);
  assert.equal(Math.round(pVert.y), 100);
});

test('calcSmartSnap (MS Whiteboard style) aligns dragged box with nearby boxes', () => {
  const targetBox = { x: 104, y: 50, w: 100, h: 80 };
  const otherBox = { x: 100, y: 200, w: 150, h: 100 };

  const snap = calcSmartSnap(targetBox, [otherBox], 8);
  assert.equal(snap.dx, -4);
  assert.ok(snap.guides.length > 0);
  assert.equal(snap.guides[0].type, 'vertical');
  assert.equal(snap.guides[0].pos, 100);
});

test('getAxesGeometry correctly positions axes origin and arrow endpoints without labels', () => {
  const axes = {
    id: 'axes_1',
    type: 'axes' as const,
    color: '#1e293b',
    size: 3,
    x1: 100,
    y1: 50,
    x2: 300,
    y2: 250,
    step: 32,
  };

  const geom = getAxesGeometry(axes);
  assert.equal(geom.origin.x, 200);
  assert.equal(geom.origin.y, 150);
  assert.equal(geom.step, 32);
});

test('filterPhysicsFormulas filters by FIPI code, title, and section', () => {
  const sample = [
    {
      code: '1.2.4',
      section: 'mech',
      subtopic: '1.2',
      title: 'Второй закон Ньютона',
      latex: '\\vec{F} = m\\vec{a}',
      hint: 'Сила, масса, ускорение',
      keywords: 'ньютон динамика сила',
    },
    {
      code: '3.2.3',
      section: 'electro',
      subtopic: '3.2',
      title: 'Закон Ома для участка цепи',
      latex: 'I = \\frac{U}{R}',
      hint: 'Сила тока, напряжение, сопротивление',
      keywords: 'ом ток резистор',
    },
  ];

  const byQuery = filterPhysicsFormulas(sample, 'all', 'all', 'Ома');
  assert.equal(byQuery.length, 1);
  assert.equal(byQuery[0].code, '3.2.3');

  const bySection = filterPhysicsFormulas(sample, 'mech', '1.2', '');
  assert.equal(bySection.length, 1);
  assert.equal(bySection[0].code, '1.2.4');
});

test('calcAspectFitBox preserves exact aspect ratio for wide/short PDF crops without vertical stretch', () => {
  // Wide formula strip: 700 x 80
  const wide = calcAspectFitBox(700, 80, 560, 520);
  assert.equal(wide.w, 560);
  assert.equal(wide.h, 64);
  assert.ok(Math.abs(wide.w / wide.h - 700 / 80) < 0.05);

  // Small formula strip: 240 x 40 (must NOT stretch height to 90px!)
  const small = calcAspectFitBox(240, 40, 560, 520);
  assert.equal(small.w, 240);
  assert.equal(small.h, 40);
});

test('GRID_MODES includes ruled grid and cycles cleanly in order', () => {
  assert.ok(GRID_MODES.includes('grid-ruled'));
  assert.equal(getNextGridMode('grid-lines'), 'grid-dots');
  assert.equal(getNextGridMode('grid-dots'), 'grid-ruled');
  assert.equal(getNextGridMode('grid-ruled'), 'grid-none');
  assert.equal(getNextGridMode('grid-none'), 'grid-lines');
});

test('snapToGrid aligns 1:1 with rendered grid positions across arbitrary zoom levels', () => {
  const zooms = [0.25, 0.5, 0.8, 1.0, 1.35, 2.0, 3.25];
  for (const z of zooms) {
    const cam = { x: -137, y: 89, z };
    const { step, xs, ys } = getGridDrawPositions(cam, 1280, 720, 32);
    assert.equal(step, getEffectiveGridSize(z, 32));

    // Pick a client click inside viewport and verify snapped world coordinate exists in drawn grid lines
    const rawWorld = clientToWorld(540, 390, cam);
    const snapped = snapToGrid(rawWorld.x, rawWorld.y, step);
    const hasX = xs.some((line) => line.world === snapped.x);
    const hasY = ys.some((line) => line.world === snapped.y);
    assert.ok(hasX, `Expected snapped X ${snapped.x} to match rendered grid line at zoom ${z}`);
    assert.ok(hasY, `Expected snapped Y ${snapped.y} to match rendered grid line at zoom ${z}`);

    // Screen position of snapped point matches drawn grid screen position exactly
    const screenX = snapped.x * z + cam.x;
    const matchedX = xs.find((line) => line.world === snapped.x)!;
    assert.ok(Math.abs(screenX - matchedX.screen) < 1e-9);
  }
});

test('snapPointCombined prioritizes existing vertex over grid node when both Linear and Snap-to-Grid are active', () => {
  const vertices = [{ x: 105, y: 107, strokeId: 's1' }];

  // Close to off-grid vertex -> snaps to exact vertex, NOT pulled away to grid (96, 96)
  const nearVertex = snapPointCombined({ x: 111, y: 112 }, vertices, {
    snapToVertex: true,
    snapToGrid: true,
    vertexRadius: 14,
    gridSize: 32,
  });
  assert.equal(nearVertex.source, 'vertex');
  assert.equal(nearVertex.x, 105);
  assert.equal(nearVertex.y, 107);

  // Far from vertex -> falls back cleanly to grid intersection (192, 160)
  const emptyArea = snapPointCombined({ x: 196, y: 155 }, vertices, {
    snapToVertex: true,
    snapToGrid: true,
    vertexRadius: 14,
    gridSize: 32,
  });
  assert.equal(emptyArea.source, 'grid');
  assert.equal(emptyArea.x, 192);
  assert.equal(emptyArea.y, 160);
});

test('computeLinearSnappedEndpoint handles vertex snap, grid snap, and near-axial alignment together', () => {
  const vertices = [{ x: 250, y: 128, strokeId: 's2' }];
  const start = { x: 96, y: 128 };

  // When ending near existing vertex (250, 128), vertex wins even with grid snap on
  const hitVert = computeLinearSnappedEndpoint(start, { x: 245, y: 132 }, vertices, {
    snapToVertex: true,
    snapToGrid: true,
    vertexRadius: 14,
    gridSize: 32,
  });
  assert.equal(hitVert.source, 'vertex');
  assert.equal(hitVert.x, 250);
  assert.equal(hitVert.y, 128);

  // When ending in open grid with both modes on, snaps cleanly to grid node (320, 128)
  const hitGrid = computeLinearSnappedEndpoint(start, { x: 316, y: 131 }, vertices, {
    snapToVertex: true,
    snapToGrid: true,
    vertexRadius: 14,
    gridSize: 32,
  });
  assert.equal(hitGrid.source, 'grid');
  assert.equal(hitGrid.x, 320);
  assert.equal(hitGrid.y, 128);

  // With only Linear mode on (grid snap off), near-horizontal snaps cleanly to y=128
  const hitAngle = computeLinearSnappedEndpoint(start, { x: 316, y: 131 }, vertices, {
    snapToVertex: true,
    snapToGrid: false,
    vertexRadius: 14,
    gridSize: 32,
  });
  assert.equal(hitAngle.source, 'angle');
  assert.equal(Math.round(hitAngle.y), 128);
});

test('sanitizeExportFilename preserves Cyrillic titles and strips illegal filesystem characters', () => {
  assert.equal(sanitizeExportFilename('Физика ЕГЭ: Закон Ома / 11А', 'pdf'), 'Физика_ЕГЭ_Закон_Ома_11А.pdf');
  assert.equal(sanitizeExportFilename('   ???///   ', '.png'), 'whiteboard-pro.png');
  assert.equal(sanitizeExportFilename('', 'wb'), 'whiteboard-pro.wb');
});

test('computeArrowNudgeDelta returns 4px normal nudge and 1 grid step with Shift', () => {
  assert.deepEqual(computeArrowNudgeDelta('ArrowRight', false, 32), { x: 4, y: 0 });
  assert.deepEqual(computeArrowNudgeDelta('ArrowUp', true, 32), { x: 0, y: -32 });
  assert.equal(computeArrowNudgeDelta('Enter', false, 32), null);
});

test('canStudentModifyObject enforces locks and teacher studentPermissions accurately', () => {
  const strict = { deleteStrokes: false, deleteObjects: false, editMaterials: false };
  // Teacher can always modify unlocked objects
  assert.equal(canStudentModifyObject('teacher', 'teacher', 'delete_stroke', strict, false), true);
  // Nobody can modify locked objects
  assert.equal(canStudentModifyObject('teacher', 'teacher', 'delete_stroke', strict, true), false);
  // Student cannot delete teacher strokes/objects when prohibited
  assert.equal(canStudentModifyObject('student', 'teacher', 'delete_stroke', strict, false), false);
  assert.equal(canStudentModifyObject('student', 'teacher', 'delete_object', strict, false), false);
  assert.equal(canStudentModifyObject('student', 'teacher', 'edit_material', strict, false), false);
  // Student can still modify their own strokes
  assert.equal(canStudentModifyObject('student', 'student', 'delete_stroke', strict, false), true);
  // Student allowed when permissions enabled
  assert.equal(canStudentModifyObject('student', 'teacher', 'delete_stroke', { deleteStrokes: true }, false), true);
});

test('pushHistoryEntry deduplicates snapshots and maintains accurate step index at maxSize cap', () => {
  let state = { history: [] as string[], step: -1 };
  state = pushHistoryEntry(state.history, state.step, 's0', 3);
  assert.equal(state.step, 0);
  // Duplicate snapshot is ignored
  state = pushHistoryEntry(state.history, state.step, 's0', 3);
  assert.equal(state.history.length, 1);
  // Overflow cap keeps newest entries and exact step index
  state = pushHistoryEntry(state.history, state.step, 's1', 3);
  state = pushHistoryEntry(state.history, state.step, 's2', 3);
  state = pushHistoryEntry(state.history, state.step, 's3', 3);
  assert.deepEqual(state.history, ['s1', 's2', 's3']);
  assert.equal(state.step, 2);
});

test('shiftIndexedRecordOnInsert shifts subsequent page keys while preserving earlier pages', () => {
  const strokes: Record<number, string[]> = {
    0: ['p0-a'],
    1: ['p1-a'],
    2: ['p2-a'],
  };
  const shifted = shiftIndexedRecordOnInsert(strokes, 1);
  assert.equal(shifted[1], undefined);
  assert.deepEqual(shifted, {
    0: ['p0-a'],
    2: ['p1-a'],
    3: ['p2-a'],
  });
});

test('getPdfBlankPageStyleLabel defaults to grid and formats all three styles', () => {
  assert.equal(getPdfBlankPageStyleLabel('grid'), 'Клетчатая');
  assert.equal(getPdfBlankPageStyleLabel('ruled'), 'Линейчатая');
  assert.equal(getPdfBlankPageStyleLabel('blank'), 'Без разметки');
  assert.equal(getPdfBlankPageStyleLabel('unknown'), 'Клетчатая');
});

test('buildMultiPagePdfBytes produces valid %PDF-1.4 multi-page structure with accurate xref', () => {
  const dummyJpeg1 = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const dummyJpeg2 = new Uint8Array([0xff, 0xd8, 0x00, 0x01, 0xff, 0xd9]);
  const dummyJpeg3 = new Uint8Array([0xff, 0xd8, 0x02, 0xff, 0xd9]);
  const bytes = buildMultiPagePdfBytes([
    { width: 800, height: 1100, jpegBytes: dummyJpeg1 },
    { width: 892, height: 1262, jpegBytes: dummyJpeg2 },
    { width: 800, height: 1100, jpegBytes: dummyJpeg3 },
  ]);
  const text = new TextDecoder('latin1').decode(bytes);
  assert.ok(text.startsWith('%PDF-1.4\n'));
  assert.ok(text.includes('/Count 3'));
  assert.ok(text.includes('/Kids [3 0 R 6 0 R 9 0 R]'));
  assert.ok(text.includes('/MediaBox [0 0 892 1262]'));
  assert.ok(text.includes('/Size 12'));
  assert.ok(text.endsWith('%%EOF'));
  // Verify startxref points directly to the "xref\n" marker
  const match = text.match(/startxref\n(\d+)\n%%EOF$/);
  assert.ok(match);
  const xrefPos = Number(match[1]);
  assert.equal(text.slice(xrefPos, xrefPos + 5), 'xref\n');
});

test('insertPdfPageInRows numbers pages left-to-right within rows and top-to-bottom across rows', () => {
  // Start with 2 vertical pages: Row 0 [0], Row 1 [1]
  const sideRes = insertPdfPageInRows(2, [1, 1], 0, 'side');
  assert.deepEqual(sideRes.rowCounts, [2, 1]);
  assert.equal(sideRes.insertIdx, 1);
  assert.deepEqual(normalizePdfPageRows(3, sideRes.rowCounts), [[0, 1], [2]]);

  // Inserting below page 0 (which is in row [0, 1]) places new row AFTER the whole row [0, 1] -> idx 2
  const belowRes = insertPdfPageInRows(3, sideRes.rowCounts, 0, 'below');
  assert.deepEqual(belowRes.rowCounts, [2, 1, 1]);
  assert.equal(belowRes.insertIdx, 2);
  assert.deepEqual(normalizePdfPageRows(4, belowRes.rowCounts), [[0, 1], [2], [3]]);
});

test('removePdfPageFromRows removes page, drops empty rows, and protects last remaining page', () => {
  const res1 = removePdfPageFromRows(4, [2, 1, 1], 1);
  assert.equal(res1.removed, true);
  assert.deepEqual(res1.rowCounts, [1, 1, 1]);
  assert.equal(res1.nextActiveIdx, 1);

  const res2 = removePdfPageFromRows(3, [1, 1, 1], 2);
  assert.equal(res2.removed, true);
  assert.deepEqual(res2.rowCounts, [1, 1]);
  assert.equal(res2.nextActiveIdx, 1);

  // Guard: never delete the only remaining page
  const guard = removePdfPageFromRows(1, [1], 0);
  assert.equal(guard.removed, false);
  assert.deepEqual(guard.rowCounts, [1]);
});

test('shiftIndexedRecordOnDelete drops removed key and shifts subsequent keys down by 1', () => {
  const map: Record<number, string[]> = { 0: ['a'], 1: ['b'], 2: ['c'], 3: ['d'] };
  const after = shiftIndexedRecordOnDelete(map, 1);
  assert.equal(after[3], undefined);
  assert.deepEqual(after, { 0: ['a'], 1: ['c'], 2: ['d'] });
});

test('splitLatexFormulaParts splits top-level \\quad and adjacent cases blocks without breaking braces', () => {
  const multi = 'x(t) = x_0 + v_{0x}t, \\quad v_x(t) = v_{0x} = \\text{const}';
  assert.deepEqual(splitLatexFormulaParts(multi), [
    'x(t) = x_0 + v_{0x}t',
    'v_x(t) = v_{0x} = \\text{const}',
  ]);

  const casesStr = '\\begin{cases} x = 1 \\\\ y = 2 \\end{cases}, \\; \\begin{cases} v_x = 3 \\\\ v_y = 4 \\end{cases}';
  assert.deepEqual(splitLatexFormulaParts(casesStr), [
    '\\begin{cases} x = 1 \\\\ y = 2 \\end{cases}',
    '\\begin{cases} v_x = 3 \\\\ v_y = 4 \\end{cases}',
  ]);

  const insideBrace = '\\text{a \\quad b} = c';
  assert.deepEqual(splitLatexFormulaParts(insideBrace), ['\\text{a \\quad b} = c']);
});

test('formatFormulaCountRu pluralizes Russian formula counts accurately', () => {
  assert.equal(formatFormulaCountRu(0), '0 формул');
  assert.equal(formatFormulaCountRu(1), '1 формула');
  assert.equal(formatFormulaCountRu(2), '2 формулы');
  assert.equal(formatFormulaCountRu(4), '4 формулы');
  assert.equal(formatFormulaCountRu(5), '5 формул');
  assert.equal(formatFormulaCountRu(11), '11 формул');
  assert.equal(formatFormulaCountRu(21), '21 формула');
  assert.equal(formatFormulaCountRu(33), '33 формулы');
});


