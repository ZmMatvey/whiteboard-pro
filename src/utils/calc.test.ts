import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluatePhysicsCalc,
  evaluatePolRec,
  decimalToFractionString,
  formatDmsString,
  formatEngNotation,
  formatComixResult,
  computeSdStats,
  getArrowHeadGeometry,
  createDefaultTableData,
  resizeTableData,
  getParticipantInitials,
  filterBoardSearchItems,
  calcFitAllCamera,
  calcNormalizedSquareOrCircleBox,
  generateQRMatrix,
  getLineDashPattern,
  shouldEraseStroke,
  filterStrokesByClearAction,
  togglePeerBlockState,
  rotate3DPoint,
  unrotate3DPoint,
  getNextConstructionPointLabel,
  canChange3DBodyType,
  snap3DEdgeRatio,
  get3DBodyDimensionMeta,
  resolve3DFloatingPosition,
  isContentEditableWidgetTarget,
  is2DShapeStrokeType,
  reorderStrokesLayer,
  computeFloatingBarPosition,
  erasePdfStrokeSegments,
  shouldHideBoardChromeInPdf,
  createLinearPointModeState,
  stepLinearPointClick,
  handleLinearPointKey,
  computeHeaderPopoverPosition,
  resolvePageIndexAfterDelete,
  getBoardLayerZOrder,
  getThemeMetaConfig,
  type ErasableStroke,
} from './calc';

test('DEG trigonometry computes exact standard values', () => {
  assert.equal(evaluatePhysicsCalc('sin(30)', 'DEG'), '0.5');
  assert.equal(evaluatePhysicsCalc('cos(60)', 'DEG'), '0.5');
  assert.equal(evaluatePhysicsCalc('cos(90)', 'DEG'), '0');
  assert.equal(evaluatePhysicsCalc('tg(45)', 'DEG'), '1');
  assert.equal(evaluatePhysicsCalc('arcsin(0.5)', 'DEG'), '30');
  assert.equal(evaluatePhysicsCalc('arccos(0.5)', 'DEG'), '60');
  assert.equal(evaluatePhysicsCalc('arctg(1)', 'DEG'), '45');
  assert.equal(evaluatePhysicsCalc('tg(90)', 'DEG'), 'Ошибка');
});

test('RAD and GRAD trigonometry compute exact standard values', () => {
  assert.equal(evaluatePhysicsCalc('sin(π/2)', 'RAD'), '1');
  assert.equal(evaluatePhysicsCalc('cos(π)', 'RAD'), '-1');
  assert.equal(evaluatePhysicsCalc('arcsin(1)', 'RAD'), evaluatePhysicsCalc('π/2', 'RAD'));
  assert.equal(evaluatePhysicsCalc('sin(100)', 'GRAD'), '1');
  assert.equal(evaluatePhysicsCalc('cos(100)', 'GRAD'), '0');
  assert.equal(evaluatePhysicsCalc('tan(50)', 'GRAD'), '1');
  assert.equal(evaluatePhysicsCalc('sin(30°)', 'RAD'), '0.5');
  assert.equal(evaluatePhysicsCalc('sin(100ᵍ)', 'DEG'), '1');
});

test('Logarithms, powers, roots, factorial, and scientific notation for Physics', () => {
  assert.equal(evaluatePhysicsCalc('lg(1000)', 'DEG'), '3');
  assert.equal(evaluatePhysicsCalc('log(100)', 'DEG'), '2');
  assert.equal(evaluatePhysicsCalc('ln(e)', 'DEG'), '1');
  assert.equal(evaluatePhysicsCalc('sqrt(144)', 'DEG'), '12');
  assert.equal(evaluatePhysicsCalc('cbrt(27)', 'DEG'), '3');
  assert.equal(evaluatePhysicsCalc('32^(1/5)', 'DEG'), '2');
  assert.equal(evaluatePhysicsCalc('5ˣ√32', 'DEG'), '2');
  assert.equal(evaluatePhysicsCalc('3ˣ√(-27)', 'DEG'), '-3');
  assert.equal(evaluatePhysicsCalc('2^10', 'DEG'), '1024');
  assert.equal(evaluatePhysicsCalc('5!', 'DEG'), '120');
  assert.equal(evaluatePhysicsCalc('50%', 'DEG'), '0.5');
  // Universal gravitation / Coulomb constant style scientific notation
  assert.equal(evaluatePhysicsCalc('6.67E-11 * 1E11', 'DEG'), '6.67');
  assert.equal(evaluatePhysicsCalc('1.6E-19 * 2', 'DEG'), '3.2e-19');
});

test('Comix CS-85 240-function scientific calculator operations (nCr, nPr, Pol, Rec, hyp, fractions, DMS, ENG, vars, SD)', () => {
  assert.equal(evaluatePhysicsCalc('5C2', 'DEG'), '10');
  assert.equal(evaluatePhysicsCalc('5P2', 'DEG'), '20');
  assert.equal(evaluatePhysicsCalc('Pol(3, 4)', 'DEG'), '5');
  assert.equal(evaluatePhysicsCalc('Rec(10, 60)', 'DEG'), '5');
  assert.equal(evaluatePhysicsCalc('sinh(0)', 'DEG'), '0');
  assert.equal(evaluatePhysicsCalc('cosh(0)', 'DEG'), '1');
  assert.equal(evaluatePhysicsCalc('tanh(0)', 'DEG'), '0');

  // Fractions ab/c and d/c
  assert.equal(evaluatePhysicsCalc('1┘2 + 1┘3', 'DEG'), '0.8333333333');
  assert.equal(evaluatePhysicsCalc('1┘1┘2 + 2┘1┘2', 'DEG'), '4');
  assert.equal(decimalToFractionString(8 / 9, false), '8┘9');
  assert.equal(decimalToFractionString(7 / 3, false), '2┘1┘3');
  assert.equal(decimalToFractionString(7 / 3, true), '7┘3');

  // DMS conversion & parsing
  assert.equal(formatDmsString(45.5041666667), '45°30′15″');
  assert.equal(evaluatePhysicsCalc("45°30'0\"", 'DEG'), '45.5');

  // ENG shift right/left by multiples of 3
  assert.equal(formatEngNotation(1234, 0), '1.234e+3');
  assert.equal(formatEngNotation(1234, 1), '1234e+0');
  assert.equal(formatEngNotation(1234, -1), '0.001234e+6');

  // Variables A-F, X, Y, M, Ans + Pol/Rec dual outputs
  const vars = { A: 12, B: 3, C: 4, X: 5, Y: 6, M: 10, Ans: 2 };
  assert.equal(evaluatePhysicsCalc('A*B + C + M + Ans', 'DEG', vars), '52');
  const pol = evaluatePolRec('Pol(3, 4)', 'DEG');
  assert.ok(pol && Math.abs(pol.xVal - 5) < 1e-9 && Math.abs(pol.yVal - 53.13010235) < 1e-5);
  const rec = evaluatePolRec('Rec(10, 30)', 'DEG');
  assert.ok(rec && Math.abs(rec.xVal - 8.6602540378) < 1e-6 && Math.abs(rec.yVal - 5) < 1e-9);

  // Display format modes (Fix, Sci)
  assert.equal(formatComixResult(8 / 9, { mode: 'FIX', digits: 3 }), '0.889');
  assert.equal(formatComixResult(1234, { mode: 'SCI', digits: 3 }), '1.23e+3');

  // SD statistics
  const sd = computeSdStats([10, 20, 30]);
  assert.equal(sd.n, 3);
  assert.equal(sd.sumX, 60);
  assert.equal(sd.sumX2, 1400);
  assert.equal(sd.mean, 20);
  assert.ok(Math.abs(sd.sigmaN - Math.sqrt(200 / 3)) < 1e-9);
  assert.equal(sd.sigmaN1, 10);
});

test('Equal-side shape box normalization for Square, Circle, and Unit Circle', () => {
  const sq = calcNormalizedSquareOrCircleBox(100, 100, 220, 160, true);
  assert.equal(sq.w, 120);
  assert.equal(sq.h, 120);
  const rect = calcNormalizedSquareOrCircleBox(100, 100, 220, 160, false);
  assert.equal(rect.w, 120);
  assert.equal(rect.h, 60);
});

test('ISO/IEC 18004 QR Code matrix generator produces valid scannable QR structure for invite links', () => {
  const url = 'https://ais-pre-eoiv4f7zvvsc65jyag3csq-703559799185.europe-west2.run.app/?room=wb-a1b2c3&role=student';
  const mat = generateQRMatrix(url);
  assert.ok(mat.length >= 25 && (mat.length - 17) % 4 === 0);
  assert.equal(mat.length, mat[0].length);
  // Top-left finder pattern center (3,3) is dark, separator (7,0..7) is white
  assert.equal(mat[0][0], true);
  assert.equal(mat[3][3], true);
  assert.equal(mat[1][1], false);
  assert.equal(mat[7][0], false);
  assert.equal(mat[0][7], false);
  // Dark module at (size - 8, 8) is always true per ISO/IEC 18004
  assert.equal(mat[mat.length - 8][8], true);
  // Different room URLs produce distinct QR matrices
  const mat2 = generateQRMatrix('https://ais-pre-eoiv4f7zvvsc65jyag3csq-703559799185.europe-west2.run.app/?room=wb-z9y8x7&role=student');
  assert.notDeepEqual(mat, mat2);
});

test('Domain & syntax errors return Ошибка safely', () => {
  assert.equal(evaluatePhysicsCalc('10/0', 'DEG'), 'Ошибка');
  assert.equal(evaluatePhysicsCalc('sqrt(-4)', 'DEG'), 'Ошибка');
  assert.equal(evaluatePhysicsCalc('lg(0)', 'DEG'), 'Ошибка');
  assert.equal(evaluatePhysicsCalc('arcsin(2)', 'DEG'), 'Ошибка');
  assert.equal(evaluatePhysicsCalc('alert(1)', 'DEG'), 'Ошибка');
});

test('Solid filled triangular arrowhead geometry matches vertical shaft reference', () => {
  const g = getArrowHeadGeometry(100, 100, 100, 220, 4);
  assert.deepEqual(g.tip, { x: 100, y: 220 });
  // Base left and right are symmetric horizontally around x=100, above tip y=220
  assert.ok(Math.abs((g.baseLeft.x + g.baseRight.x) / 2 - 100) < 1e-6);
  assert.ok(g.baseLeft.y < 220 && g.baseRight.y < 220);
  // Shaft ends inside the filled head so lineCap never pokes out of tip
  assert.ok(g.shaftEnd.y < 220 && g.shaftEnd.y > g.baseLeft.y - 2);
});

test('Table default & resize helpers maintain bounds', () => {
  const t = createDefaultTableData(3, 3);
  assert.equal(t.length, 3);
  assert.equal(t[0].length, 3);
  assert.equal(t[0][0], 'Столбец 1');

  const bigger = resizeTableData(t, 1, 1);
  assert.equal(bigger.length, 4);
  assert.equal(bigger[0].length, 4);

  const shrunk = resizeTableData(t, -5, -5);
  assert.equal(shrunk.length, 1);
  assert.equal(shrunk[0].length, 1);
});

test('LearnBoard helpers compute initials, board search filters, and fit-all camera', () => {
  assert.equal(getParticipantInitials('Иван Петров'), 'ИП');
  assert.equal(getParticipantInitials('Преподаватель'), 'ПР');
  assert.equal(getParticipantInitials(''), 'УЧ');

  const sample = [
    { id: '1', type: 'image', isPdf: true, pdfTitle: 'задание 1', x: 0, y: 0, w: 300, h: 400 },
    { id: '2', type: 'text', text: 'Закон сохранения импульса', x: 400, y: 0, w: 200, h: 80 },
    { id: '3', type: 'calculator', x: 700, y: 0, w: 320, h: 460 },
  ];
  assert.equal(filterBoardSearchItems(sample, '', 'all').length, 3);
  assert.equal(filterBoardSearchItems(sample, '', 'books').length, 1);
  assert.equal(filterBoardSearchItems(sample, 'импульса', 'text')[0]?.id, '2');
  assert.equal(filterBoardSearchItems(sample, 'калькулятор', 'other')[0]?.id, '3');

  const cam = calcFitAllCamera({ x: 100, y: 100, w: 600, h: 400 }, 1440, 900, 90);
  assert.ok(cam.z > 0.2 && cam.z <= 2.0);
});

test('Line style dash patterns match solid, dashed, dotted, and dashdot specifications', () => {
  assert.deepEqual(getLineDashPattern('solid', 4), []);
  assert.equal(getLineDashPattern('dashed', 4).length, 2);
  assert.equal(getLineDashPattern('dotted', 4).length, 2);
  assert.equal(getLineDashPattern('dashdot', 4).length, 4);
});

test('Eraser target filtering and page clear actions handle teacher vs student strokes', () => {
  const strokes: ErasableStroke[] = [
    { id: 1, type: 'pen', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], authorRole: 'teacher' },
    { id: 2, type: 'highlighter', isHighlighter: true, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], authorRole: 'student' },
    { id: 3, type: 'rect', authorRole: 'student' },
  ];
  assert.equal(shouldEraseStroke(strokes[0], 'pen_only'), true);
  assert.equal(shouldEraseStroke(strokes[1], 'pen_only'), false);
  assert.equal(shouldEraseStroke(strokes[1], 'highlighter_only'), true);
  assert.equal(shouldEraseStroke(strokes[2], 'pen_and_highlighter'), false);
  assert.equal(shouldEraseStroke(strokes[2], 'all'), true);

  assert.equal(filterStrokesByClearAction(strokes, 'highlighters').length, 2);
  assert.equal(filterStrokesByClearAction(strokes, 'student_strokes').length, 1);
  assert.equal(filterStrokesByClearAction(strokes, 'teacher_strokes').length, 2);
  assert.equal(filterStrokesByClearAction(strokes, 'all_strokes').length, 0);
});

test('Student management toggles block state and status label', () => {
  const peers = {
    u_student1: { id: 'u_student1', name: 'Прежде', role: 'student' as const, blocked: false },
  };
  const blockedRes = togglePeerBlockState(peers, 'u_student1');
  assert.equal(blockedRes.blocked, true);
  assert.equal(blockedRes.statusLabel, 'Ученик(заблокирован)');

  const unblockedRes = togglePeerBlockState(peers, 'u_student1');
  assert.equal(unblockedRes.blocked, false);
  assert.equal(unblockedRes.statusLabel, 'Ученик(активен)');
});

test('3D stereometry helpers rotate points, assign P/Q/R/T labels, and guard body switching', () => {
  const p0 = rotate3DPoint({ x: 1, y: 0, z: 0 }, 0, 0);
  assert.equal(Math.round(p0.x), 1);
  assert.equal(Math.round(p0.y), 0);
  assert.equal(Math.round(p0.z), 0);

  const pYaw90 = rotate3DPoint({ x: 1, y: 0, z: 0 }, Math.PI / 2, 0);
  assert.ok(Math.abs(pYaw90.x) < 1e-9);
  assert.ok(Math.abs(pYaw90.z + 1) < 1e-9);

  assert.equal(getNextConstructionPointLabel([]), 'P');
  assert.equal(getNextConstructionPointLabel(['P', 'Q', 'R']), 'T');
  assert.equal(canChange3DBodyType(0), true);
  assert.equal(canChange3DBodyType(4), false);

  // Inverse rotation recovers original 3D point
  const orig = { x: 0.75, y: -0.4, z: 0.55 };
  const rot = rotate3DPoint(orig, 0.65, 0.35);
  const back = unrotate3DPoint(rot, 0.65, 0.35);
  assert.ok(Math.abs(back.x - orig.x) < 1e-9);
  assert.ok(Math.abs(back.y - orig.y) < 1e-9);
  assert.ok(Math.abs(back.z - orig.z) < 1e-9);

  // Edge snapping & body metadata
  assert.deepEqual(snap3DEdgeRatio(0.47, true), { t: 0.5, snapLabel: '1/2' });
  assert.deepEqual(snap3DEdgeRatio(0.47, false), { t: 0.47, snapLabel: null });
  assert.equal(get3DBodyDimensionMeta('cube').showHeight, false);
  assert.equal(get3DBodyDimensionMeta('prism').showBaseSides, true);
  assert.equal(get3DBodyDimensionMeta('cone').radiusLabel, 'Радиус основания');
});

test('2D shape helpers classify 2D figures, reorder layers, and position floating bar inside viewport', () => {
  assert.equal(is2DShapeStrokeType('parallelogram'), true);
  assert.equal(is2DShapeStrokeType('triangle'), true);
  assert.equal(is2DShapeStrokeType('circle'), true);
  assert.equal(is2DShapeStrokeType('cube'), false);
  assert.equal(is2DShapeStrokeType('pen'), false);

  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(reorderStrokesLayer(items, ['a'], 'front').map((x) => x.id), ['b', 'c', 'a']);
  assert.deepEqual(reorderStrokesLayer(items, ['c'], 'back').map((x) => x.id), ['c', 'a', 'b']);
  assert.deepEqual(reorderStrokesLayer(items, ['a'], 'forward').map((x) => x.id), ['b', 'a', 'c']);
  assert.deepEqual(reorderStrokesLayer(items, ['c'], 'backward').map((x) => x.id), ['a', 'c', 'b']);

  const posAbove = computeFloatingBarPosition(
    { left: 400, top: 300, width: 200, height: 150 },
    { width: 280, height: 48 },
    { width: 1440, height: 900 }
  );
  assert.equal(posAbove.left, 360);
  assert.equal(posAbove.top, 238);

  const posFlipped = computeFloatingBarPosition(
    { left: 10, top: 40, width: 120, height: 100 },
    { width: 280, height: 48 },
    { width: 1440, height: 900 }
  );
  assert.ok(posFlipped.left >= 12);
  assert.equal(posFlipped.top, 154);
});

test('PDF editor stroke eraser splits stroked segments cleanly and header chrome hides in PDF mode', () => {
  const strokes = [
    {
      color: '#ef4444',
      size: 4,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 50, y: 0 },
        { x: 90, y: 0 },
        { x: 100, y: 0 },
      ],
    },
  ];
  const untouched = erasePdfStrokeSegments(strokes, { x: 50, y: 100 }, 12);
  assert.equal(untouched.changed, false);
  assert.equal(untouched.strokes.length, 1);

  const split = erasePdfStrokeSegments(strokes, { x: 50, y: 0 }, 14);
  assert.equal(split.changed, true);
  assert.equal(split.strokes.length, 2);
  assert.equal(split.strokes[0].points.length, 2);
  assert.equal(split.strokes[1].points.length, 2);

  assert.equal(shouldHideBoardChromeInPdf(true), true);
  assert.equal(shouldHideBoardChromeInPdf(false), false);
});

test('3D settings panel stays locked during width changes and table cells remain editable', () => {
  const cubeMeta = get3DBodyDimensionMeta('cube');
  assert.equal(cubeMeta.title, 'Куб');
  assert.equal(cubeMeta.radiusLabel, 'Длина ребра');
  assert.equal(cubeMeta.showDiagonals, true);
  assert.equal(cubeMeta.showHeight, false);
  assert.equal(cubeMeta.subtypePlacement, 'none');

  const paraRect = get3DBodyDimensionMeta('parallelepiped', { boxKind: 'rectangular' });
  assert.equal(paraRect.title, 'Прямоугольный параллелепипед');
  assert.equal(paraRect.radiusLabel, 'Длина a');
  assert.equal(paraRect.showDepth, true);
  assert.equal(paraRect.depthLabel, 'Ширина b');
  assert.equal(paraRect.showBaseAngle, false);
  assert.equal(paraRect.showTiltXY, false);
  assert.equal(paraRect.subtypeLabel, 'Вид');

  const paraRight = get3DBodyDimensionMeta('parallelepiped', { boxKind: 'right' });
  assert.equal(paraRight.title, 'Прямой параллелепипед');
  assert.equal(paraRight.showBaseAngle, true);
  assert.equal(paraRight.showTiltXY, false);

  const paraOblique = get3DBodyDimensionMeta('parallelepiped', { boxKind: 'oblique' });
  assert.equal(paraOblique.title, 'Наклонный параллелепипед');
  assert.equal(paraOblique.showBaseAngle, true);
  assert.equal(paraOblique.showTiltXY, true);

  const prismMeta = get3DBodyDimensionMeta('prism');
  assert.equal(prismMeta.showBaseSides, true);
  assert.equal(prismMeta.showTopShift, true);
  assert.equal(prismMeta.subtypePlacement, 'none');

  const pyrTrunc = get3DBodyDimensionMeta('pyramid', { pyramidKind: 'truncated' });
  assert.equal(pyrTrunc.title, 'Усечённая пирамида');
  assert.equal(pyrTrunc.showTopRatio, true);
  assert.equal(pyrTrunc.showBaseSides, true);

  const pyrTet = get3DBodyDimensionMeta('pyramid', { pyramidKind: 'tetrahedron' });
  assert.equal(pyrTet.title, 'Тетраэдр');
  assert.equal(pyrTet.showBaseSides, false);
  assert.equal(pyrTet.showHeight, false);
  assert.equal(pyrTet.showTopShift, false);

  const coneFrustum = get3DBodyDimensionMeta('cone', { coneKind: 'frustum' });
  assert.equal(coneFrustum.title, 'Усечённый конус');
  assert.equal(coneFrustum.showTopRadius, true);
  assert.equal(coneFrustum.subtypePlacement, 'cone');

  const sphereMeta = get3DBodyDimensionMeta('sphere');
  assert.equal(sphereMeta.radiusLabel, 'Радиус');
  assert.equal(sphereMeta.showFaces, false);
  assert.equal(sphereMeta.showHeight, false);

  const locked = { left: 780, top: 140 };
  const posSmall = resolve3DFloatingPosition(
    { left: 620, top: 140, panelW: 348 },
    { settingsOpen: true, lockedPos: locked, customOffset: null },
    { width: 1440, height: 900 }
  );
  const posWide = resolve3DFloatingPosition(
    { left: 940, top: 120, panelW: 348 },
    { settingsOpen: true, lockedPos: locked, customOffset: null },
    { width: 1440, height: 900 }
  );
  assert.deepEqual(posSmall, locked);
  assert.deepEqual(posWide, locked);

  assert.equal(
    isContentEditableWidgetTarget({
      isContentEditable: true,
      insideWidget: true,
      isTableWidget: true,
      hasEditingClass: false,
    }),
    true
  );
  assert.equal(
    isContentEditableWidgetTarget({
      isContentEditable: true,
      insideWidget: true,
      isTableWidget: false,
      hasEditingClass: false,
    }),
    false
  );
});

test('Point-to-point linear mode builds connected segments, closes polygons, and exits cleanly on Enter', () => {
  let st = createLinearPointModeState(true);

  // Click 1 sets anchor without creating a segment yet
  const r1 = stepLinearPointClick(st, { x: 100, y: 100 });
  st = r1.state;
  assert.equal(r1.segment, null);
  assert.deepEqual(st.anchor, { x: 100, y: 100 });
  assert.equal(st.enabled, true);

  // Click 2 creates first segment and advances anchor
  const r2 = stepLinearPointClick(st, { x: 260, y: 100 });
  st = r2.state;
  assert.deepEqual(r2.segment, { x1: 100, y1: 100, x2: 260, y2: 100 });
  assert.deepEqual(st.anchor, { x: 260, y: 100 });
  assert.equal(st.segmentCount, 1);

  // Click 3 creates second segment
  const r3 = stepLinearPointClick(st, { x: 260, y: 240 });
  st = r3.state;
  assert.deepEqual(r3.segment, { x1: 260, y1: 100, x2: 260, y2: 240 });
  assert.equal(st.segmentCount, 2);

  // Click 4 back on start point closes loop and lifts anchor while staying in linear mode
  const r4 = stepLinearPointClick(st, { x: 100, y: 100 });
  st = r4.state;
  assert.deepEqual(r4.segment, { x1: 260, y1: 240, x2: 100, y2: 100 });
  assert.equal(r4.closedLoop, true);
  assert.equal(st.anchor, null);
  assert.equal(st.enabled, true);

  // Start new chain, Escape lifts only current anchor, Enter exits linear mode
  st = stepLinearPointClick(st, { x: 400, y: 200 }).state;
  assert.deepEqual(st.anchor, { x: 400, y: 200 });

  const esc = handleLinearPointKey(st, 'Escape', false);
  assert.equal(esc.handled, true);
  assert.equal(esc.state.enabled, true);
  assert.equal(esc.state.anchor, null);

  st = stepLinearPointClick(esc.state, { x: 420, y: 220 }).state;
  // Enter ignored while typing inside editable input
  const ignoredEnter = handleLinearPointKey(st, 'Enter', true);
  assert.equal(ignoredEnter.handled, false);
  assert.equal(ignoredEnter.state.enabled, true);

  // Enter outside inputs exits linear mode and clears anchor
  const exitEnter = handleLinearPointKey(st, 'Enter', false);
  assert.equal(exitEnter.handled, true);
  assert.equal(exitEnter.state.enabled, false);
  assert.equal(exitEnter.state.anchor, null);
});

test('Header popovers stay inside viewport bounds and page deletion preserves active page index', () => {
  // Right-aligned popover near right edge at 1100px width stays inside [10, 1090] and below 48px header
  const pos = computeHeaderPopoverPosition(
    { left: 1010, right: 1056, top: 8, bottom: 40 },
    { width: 295, height: 260 },
    { width: 1100, height: 800 },
    'right'
  );
  assert.ok(pos.left >= 10 && pos.left + 295 <= 1090);
  assert.equal(pos.top, 48);

  // Narrow viewport clamps to left margin instead of going negative
  const narrow = computeHeaderPopoverPosition(
    { left: 80, right: 120, top: 8, bottom: 40 },
    { width: 344, height: 220 },
    { width: 390, height: 700 },
    'right'
  );
  assert.equal(narrow.left, 10);
  assert.equal(narrow.top, 48);

  // Page deletion rules
  assert.deepEqual(resolvePageIndexAfterDelete(1, 0, 0), { allowed: false, nextIndex: 0 });
  assert.deepEqual(resolvePageIndexAfterDelete(3, 2, 0), { allowed: true, nextIndex: 1 });
  assert.deepEqual(resolvePageIndexAfterDelete(3, 2, 2), { allowed: true, nextIndex: 1 });
  assert.deepEqual(resolvePageIndexAfterDelete(3, 0, 2), { allowed: true, nextIndex: 0 });
});

test('Background grid always stays behind widgets in both Hand/Draw and Select modes', () => {
  const handOrDraw = getBoardLayerZOrder(false);
  assert.equal(handOrDraw.grid, 1);
  assert.equal(handOrDraw.widgets, 2);
  assert.equal(handOrDraw.foreground, 3);
  assert.ok(handOrDraw.grid < handOrDraw.widgets && handOrDraw.widgets < handOrDraw.foreground);

  const select = getBoardLayerZOrder(true);
  assert.equal(select.grid, 1);
  assert.equal(select.foreground, 3);
  assert.equal(select.widgets, 4);
  assert.ok(select.grid < select.foreground && select.foreground < select.widgets);
});

test('Day/Night theme config maps color-scheme, theme-color, and toggle label accurately', () => {
  assert.deepEqual(getThemeMetaConfig(false), {
    colorScheme: 'light',
    themeColor: '#ffffff',
    toggleLabel: 'Ночная тема',
  });
  assert.deepEqual(getThemeMetaConfig(true), {
    colorScheme: 'dark',
    themeColor: '#0f172a',
    toggleLabel: 'Дневная тема',
  });
});
