/**
 * Pure mathematical, geometric, and physics codifier search utilities for Whiteboard Pro v7.0
 */

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AlignmentGuide {
  type: 'vertical' | 'horizontal';
  pos: number;
  min: number;
  max: number;
}

export interface SmartSnapResult {
  dx: number;
  dy: number;
  guides: AlignmentGuide[];
}

export interface CanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Converts client (screen) coordinates to world coordinates, accounting for
 * canvas bounding rect offset (critical on mobile browsers to prevent right/top shift)
 * and camera pan/zoom.
 */
export function clientToWorld(
  clientX: number,
  clientY: number,
  cam: { x: number; y: number; z: number },
  rect?: CanvasRect
): Point {
  const localX = rect ? clientX - rect.left : clientX;
  const localY = rect ? clientY - rect.top : clientY;
  return {
    x: (localX - cam.x) / cam.z,
    y: (localY - cam.y) / cam.z,
  };
}

/**
 * Snaps a coordinate (x, y) to the nearest grid intersection.
 */
export function snapToGrid(x: number, y: number, gridSize = 32): Point {
  const size = gridSize > 0 ? gridSize : 32;
  return {
    x: Math.round(x / size) * size,
    y: Math.round(y / size) * size,
  };
}

/**
 * Snaps angle between (x1, y1) and (x2, y2) to common increments (0°, 15°, 30°, 45°, 60°, 90°, etc.)
 * as featured in Microsoft Whiteboard. Preserves line length.
 */
export function snapAngle(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stepDeg = 15,
  toleranceDeg = 5.5
): Point {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 4) return { x: x2, y: y2 };

  const angleRad = Math.atan2(dy, dx);
  let angleDeg = (angleRad * 180) / Math.PI;
  if (angleDeg < 0) angleDeg += 360;

  const nearestStep = Math.round(angleDeg / stepDeg) * stepDeg;
  const diff = Math.abs(angleDeg - nearestStep);

  if (diff <= toleranceDeg || diff >= 360 - toleranceDeg) {
    const targetRad = ((nearestStep % 360) * Math.PI) / 180;
    return {
      x: x1 + dist * Math.cos(targetRad),
      y: y1 + dist * Math.sin(targetRad),
    };
  }

  return { x: x2, y: y2 };
}

/**
 * Microsoft Whiteboard-style smart alignment snapping
 */
export function calcSmartSnap(
  targetBox: Box,
  otherBoxes: Box[],
  threshold = 8
): SmartSnapResult {
  let minDx = 0;
  let minDy = 0;
  let bestDistX = threshold + 1;
  let bestDistY = threshold + 1;
  const guides: AlignmentGuide[] = [];

  const tLeft = targetBox.x;
  const tCenterX = targetBox.x + targetBox.w / 2;
  const tRight = targetBox.x + targetBox.w;

  const tTop = targetBox.y;
  const tCenterY = targetBox.y + targetBox.h / 2;
  const tBottom = targetBox.y + targetBox.h;

  for (const b of otherBoxes) {
    const oLeft = b.x;
    const oCenterX = b.x + b.w / 2;
    const oRight = b.x + b.w;

    const oTop = b.y;
    const oCenterY = b.y + b.h / 2;
    const oBottom = b.y + b.h;

    const xPairs = [
      { t: tLeft, o: oLeft, shift: oLeft - tLeft },
      { t: tLeft, o: oRight, shift: oRight - tLeft },
      { t: tCenterX, o: oCenterX, shift: oCenterX - tCenterX },
      { t: tRight, o: oLeft, shift: oLeft - tRight },
      { t: tRight, o: oRight, shift: oRight - tRight },
    ];

    for (const pair of xPairs) {
      const dist = Math.abs(pair.shift);
      if (dist < bestDistX) {
        bestDistX = dist;
        minDx = pair.shift;
      }
    }

    const yPairs = [
      { t: tTop, o: oTop, shift: oTop - tTop },
      { t: tTop, o: oBottom, shift: oBottom - tTop },
      { t: tCenterY, o: oCenterY, shift: oCenterY - tCenterY },
      { t: tBottom, o: oTop, shift: oTop - tBottom },
      { t: tBottom, o: oBottom, shift: oBottom - tBottom },
    ];

    for (const pair of yPairs) {
      const dist = Math.abs(pair.shift);
      if (dist < bestDistY) {
        bestDistY = dist;
        minDy = pair.shift;
      }
    }
  }

  if (bestDistX <= threshold) {
    const finalTLeft = tLeft + minDx;
    const finalTCenterX = tCenterX + minDx;
    const finalTRight = tRight + minDx;

    for (const b of otherBoxes) {
      const oXValues = [b.x, b.x + b.w / 2, b.x + b.w];
      const matchX = [finalTLeft, finalTCenterX, finalTRight].find((tx) =>
        oXValues.some((ox) => Math.abs(tx - ox) < 0.5)
      );

      if (matchX !== undefined) {
        const minY = Math.min(targetBox.y + minDy, b.y) - 16;
        const maxY = Math.max(targetBox.y + targetBox.h + minDy, b.y + b.h) + 16;
        guides.push({
          type: 'vertical',
          pos: Math.round(matchX),
          min: minY,
          max: maxY,
        });
      }
    }
  } else {
    minDx = 0;
  }

  if (bestDistY <= threshold) {
    const finalTTop = tTop + minDy;
    const finalTCenterY = tCenterY + minDy;
    const finalTBottom = tBottom + minDy;

    for (const b of otherBoxes) {
      const oYValues = [b.y, b.y + b.h / 2, b.y + b.h];
      const matchY = [finalTTop, finalTCenterY, finalTBottom].find((ty) =>
        oYValues.some((oy) => Math.abs(ty - oy) < 0.5)
      );

      if (matchY !== undefined) {
        const minX = Math.min(targetBox.x + minDx, b.x) - 16;
        const maxX = Math.max(targetBox.x + targetBox.w + minDx, b.x + b.w) + 16;
        guides.push({
          type: 'horizontal',
          pos: Math.round(matchY),
          min: minX,
          max: maxX,
        });
      }
    }
  } else {
    minDy = 0;
  }

  return { dx: minDx, dy: minDy, guides };
}

export interface CartesianAxesStroke {
  id: string | number;
  type: 'axes';
  color: string;
  size: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  step?: number;
}

export function getAxesGeometry(s: CartesianAxesStroke) {
  const minX = Math.min(s.x1, s.x2);
  const maxX = Math.max(s.x1, s.x2);
  const minY = Math.min(s.y1, s.y2);
  const maxY = Math.max(s.y1, s.y2);

  const ox = (minX + maxX) / 2;
  const oy = (minY + maxY) / 2;
  const step = s.step && s.step > 8 ? s.step : 32;

  return {
    origin: { x: ox, y: oy },
    xAxis: {
      from: { x: minX, y: oy },
      to: { x: maxX, y: oy },
    },
    yAxis: {
      from: { x: ox, y: maxY },
      to: { x: ox, y: minY },
    },
    step,
    bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
  };
}

export interface PhysicsFormulaItem {
  code: string;
  section: string;
  subtopic: string;
  title: string;
  latex: string;
  hint: string;
  keywords: string;
}

/**
 * Filters physics formulas by section, subtopic, and search query
 */
export function filterPhysicsFormulas(
  formulas: PhysicsFormulaItem[],
  section: string,
  subtopic: string,
  query: string
): PhysicsFormulaItem[] {
  const q = query.trim().toLowerCase();
  return formulas.filter((item) => {
    if (q) {
      return (
        item.title.toLowerCase().includes(q) ||
        item.code.toLowerCase().includes(q) ||
        item.hint.toLowerCase().includes(q) ||
        item.keywords.toLowerCase().includes(q) ||
        item.latex.toLowerCase().includes(q)
      );
    }
    if (section !== 'all' && item.section !== section) return false;
    if (subtopic !== 'all' && item.subtopic !== subtopic) return false;
    return true;
  });
}

/**
 * Computes proportional width & height for a cropped PDF fragment or page
 * without stretching vertically or horizontally.
 */
export function calcAspectFitBox(
  rawW: number,
  rawH: number,
  maxW = 560,
  maxH = 520,
  minSize = 36
): { w: number; h: number } {
  const safeW = Math.max(1, rawW);
  const safeH = Math.max(1, rawH);
  let scale = 1;
  if (safeW > maxW || safeH > maxH) {
    scale = Math.min(maxW / safeW, maxH / safeH);
  }
  const scaledW = safeW * scale;
  const scaledH = safeH * scale;
  if (scaledW < minSize && scaledH < minSize) {
    const up = Math.min(minSize / scaledW, maxW / scaledW);
    return {
      w: Math.round(scaledW * up),
      h: Math.round(scaledH * up),
    };
  }
  return {
    w: Math.max(1, Math.round(scaledW)),
    h: Math.max(1, Math.round(scaledH)),
  };
}

export type GridMode = 'grid-lines' | 'grid-dots' | 'grid-ruled' | 'grid-none';

export const GRID_MODES: GridMode[] = ['grid-lines', 'grid-dots', 'grid-ruled', 'grid-none'];

export function getNextGridMode(current: string): GridMode {
  const idx = GRID_MODES.indexOf(current as GridMode);
  if (idx === -1) return GRID_MODES[0];
  return GRID_MODES[(idx + 1) % GRID_MODES.length];
}

/**
 * Returns the effective world-space grid step for a given camera zoom so visual
 * grid lines and snap-to-grid nodes remain crisp and 1:1 aligned at any zoom.
 */
export function getEffectiveGridSize(zoom: number, baseGridSize = 32): number {
  const base = baseGridSize > 0 ? baseGridSize : 32;
  const safeZ = zoom > 0 ? zoom : 1;
  let step = base;
  while (step * safeZ < 12) {
    step *= 2;
  }
  return step;
}

export interface GridLinePosition {
  world: number;
  screen: number;
}

/**
 * Computes exact world & screen coordinates for visible grid lines/dots
 * given camera transform and viewport dimensions.
 */
export function getGridDrawPositions(
  cam: { x: number; y: number; z: number },
  viewportW: number,
  viewportH: number,
  baseGridSize = 32
): { step: number; xs: GridLinePosition[]; ys: GridLinePosition[] } {
  const z = cam.z > 0 ? cam.z : 1;
  const step = getEffectiveGridSize(z, baseGridSize);
  const minWX = -cam.x / z;
  const maxWX = (viewportW - cam.x) / z;
  const minWY = -cam.y / z;
  const maxWY = (viewportH - cam.y) / z;

  const startX = Math.floor(minWX / step) * step;
  const startY = Math.floor(minWY / step) * step;

  const xs: GridLinePosition[] = [];
  for (let wx = startX; wx <= maxWX + step * 0.5; wx += step) {
    xs.push({ world: wx, screen: wx * z + cam.x });
  }
  const ys: GridLinePosition[] = [];
  for (let wy = startY; wy <= maxWY + step * 0.5; wy += step) {
    ys.push({ world: wy, screen: wy * z + cam.y });
  }
  return { step, xs, ys };
}

export interface SnapVertex extends Point {
  strokeId?: string | number;
  label?: string;
}

export interface CombinedSnapResult extends Point {
  source: 'vertex' | 'grid' | 'angle' | 'none';
  vertex: SnapVertex | null;
}

export function findNearestSnapVertex(
  pt: Point,
  vertices: SnapVertex[],
  maxDist: number
): SnapVertex | null {
  if (!Array.isArray(vertices) || vertices.length === 0 || maxDist <= 0) return null;
  let best: SnapVertex | null = null;
  let bestDist = maxDist;
  for (const v of vertices) {
    const d = Math.hypot(pt.x - v.x, pt.y - v.y);
    if (d <= bestDist) {
      bestDist = d;
      best = v;
    }
  }
  return best;
}

/**
 * Resolves snapping when Linear Mode (vertex snapping) and/or Snap-to-Grid are active.
 * Nearby existing vertices take priority over grid nodes so connections never pull away
 * from rotated/off-grid vertices, while empty areas snap cleanly to grid intersections.
 */
export function snapPointCombined(
  rawPt: Point,
  vertices: SnapVertex[],
  opts: {
    snapToVertex: boolean;
    snapToGrid: boolean;
    vertexRadius?: number;
    gridSize?: number;
  }
): CombinedSnapResult {
  const vertexRadius = opts.vertexRadius ?? 14;
  const gridSize = opts.gridSize ?? 32;

  if (opts.snapToVertex) {
    const hit = findNearestSnapVertex(rawPt, vertices, vertexRadius);
    if (hit) {
      return { x: hit.x, y: hit.y, source: 'vertex', vertex: hit };
    }
  }

  if (opts.snapToGrid) {
    const g = snapToGrid(rawPt.x, rawPt.y, gridSize);
    return { x: g.x, y: g.y, source: 'grid', vertex: null };
  }

  return { x: rawPt.x, y: rawPt.y, source: 'none', vertex: null };
}

/**
 * Computes endpoint snapping for straight lines in Linear Mode + optional Snap-to-Grid.
 */
export function computeLinearSnappedEndpoint(
  startPt: Point,
  rawEndPt: Point,
  vertices: SnapVertex[],
  opts: {
    snapToVertex: boolean;
    snapToGrid: boolean;
    forceAngleSnap?: boolean;
    vertexRadius?: number;
    gridSize?: number;
  }
): CombinedSnapResult {
  const vertexRadius = opts.vertexRadius ?? 14;
  const gridSize = opts.gridSize ?? 32;

  if (opts.snapToVertex) {
    const hit = findNearestSnapVertex(rawEndPt, vertices, vertexRadius);
    if (hit) {
      return { x: hit.x, y: hit.y, source: 'vertex', vertex: hit };
    }
  }

  if (opts.snapToGrid) {
    const candidate = opts.forceAngleSnap
      ? snapAngle(startPt.x, startPt.y, rawEndPt.x, rawEndPt.y, 15, 7)
      : rawEndPt;
    const g = snapToGrid(candidate.x, candidate.y, gridSize);
    return { x: g.x, y: g.y, source: 'grid', vertex: null };
  }

  if (opts.snapToVertex || opts.forceAngleSnap) {
    const stepDeg = opts.forceAngleSnap ? 15 : 45;
    const tolDeg = opts.forceAngleSnap ? 7 : 4.2;
    const ang = snapAngle(startPt.x, startPt.y, rawEndPt.x, rawEndPt.y, stepDeg, tolDeg);
    if (ang.x !== rawEndPt.x || ang.y !== rawEndPt.y) {
      return { x: ang.x, y: ang.y, source: 'angle', vertex: null };
    }
  }

  return { x: rawEndPt.x, y: rawEndPt.y, source: 'none', vertex: null };
}

/**
 * Sanitizes a user-defined board title into a safe downloadable filename
 * while preserving Cyrillic and Latin characters.
 */
export function sanitizeExportFilename(title: string | undefined | null, ext: string): string {
  const cleanExt = String(ext || '').replace(/^\.+/, '').trim() || 'png';
  const base = String(title || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return `${base || 'whiteboard-pro'}.${cleanExt}`;
}

/**
 * Computes world-space nudge delta for Arrow key presses on selected items.
 */
export function computeArrowNudgeDelta(
  key: string,
  shiftKey: boolean,
  gridSize = 32
): Point | null {
  const step = shiftKey ? (gridSize > 0 ? gridSize : 32) : 4;
  switch (key) {
    case 'ArrowLeft':
      return { x: -step, y: 0 };
    case 'ArrowRight':
      return { x: step, y: 0 };
    case 'ArrowUp':
      return { x: 0, y: -step };
    case 'ArrowDown':
      return { x: 0, y: step };
    default:
      return null;
  }
}

export interface StudentPermissionsConfig {
  deleteStrokes?: boolean;
  deleteObjects?: boolean;
  editMaterials?: boolean;
}

/**
 * Determines whether the current user is allowed to delete/edit a given board object.
 */
export function canStudentModifyObject(
  userRole: string,
  objAuthorRole: string | undefined,
  action: 'delete_stroke' | 'delete_object' | 'edit_material',
  permissions?: StudentPermissionsConfig,
  isLocked?: boolean
): boolean {
  if (isLocked) return false;
  if (userRole !== 'student') return true;
  const author = objAuthorRole || 'teacher';
  if (author === 'student') return true;
  const perms = permissions || {};
  if (action === 'delete_stroke') return perms.deleteStrokes !== false;
  if (action === 'delete_object') return perms.deleteObjects !== false;
  if (action === 'edit_material') return perms.editMaterials !== false;
  return true;
}

/**
 * Pure bounded undo/redo history push helper that prevents step drift when truncating.
 */
export function pushHistoryEntry<T>(
  history: T[],
  currentStep: number,
  snapshot: T,
  maxSize = 50
): { history: T[]; step: number } {
  const limit = Math.max(2, maxSize);
  if (currentStep >= 0 && history[currentStep] === snapshot) {
    return { history, step: currentStep };
  }
  const next = history.slice(0, Math.max(0, currentStep + 1));
  next.push(snapshot);
  while (next.length > limit) {
    next.shift();
  }
  return { history: next, step: next.length - 1 };
}

export type PdfBlankPageStyle = 'grid' | 'ruled' | 'blank';

export const PDF_BLANK_PAGE_STYLES: PdfBlankPageStyle[] = ['grid', 'ruled', 'blank'];

export function getPdfBlankPageStyleLabel(style: string): string {
  if (style === 'ruled') return 'Линейчатая';
  if (style === 'blank') return 'Без разметки';
  return 'Клетчатая';
}

/**
 * Shifts page-indexed records (e.g. strokesByPage) upward by +1 for all keys >= insertIdx
 * when a new blank page is inserted into a multi-page PDF document.
 */
export function shiftIndexedRecordOnInsert<T>(
  record: Record<number, T> | undefined | null,
  insertIdx: number
): Record<number, T> {
  const result: Record<number, T> = {};
  if (!record) return result;
  const threshold = Math.max(0, Math.floor(insertIdx));
  for (const [rawKey, value] of Object.entries(record)) {
    const k = Number(rawKey);
    if (!Number.isInteger(k) || k < 0) continue;
    const nextKey = k >= threshold ? k + 1 : k;
    result[nextKey] = value;
  }
  return result;
}

export interface PdfJpegPageInput {
  width: number;
  height: number;
  jpegBytes: Uint8Array;
}

/**
 * Builds a valid multi-page %PDF-1.4 binary document from an array of JPEG-encoded pages.
 */
export function buildMultiPagePdfBytes(pages: PdfJpegPageInput[]): Uint8Array {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('Cannot build PDF with 0 pages');
  }

  const enc = (str: string) => new TextEncoder().encode(str);
  const header = enc('%PDF-1.4\n');
  const objs: Uint8Array[] = [];

  // Object 1: Catalog
  objs.push(enc('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'));

  // Compute object numbers for each page (3 objects per page: Page, Image XObject, Content)
  const kidRefs: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    kidRefs.push(`${3 + i * 3} 0 R`);
  }

  // Object 2: Pages tree
  objs.push(
    enc(`2 0 obj\n<< /Type /Pages /Kids [${kidRefs.join(' ')}] /Count ${pages.length} >>\nendobj\n`)
  );

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const w = Math.max(1, Math.round(p.width));
    const h = Math.max(1, Math.round(p.height));
    const jpeg = p.jpegBytes;
    const pageObjNum = 3 + i * 3;
    const imgObjNum = pageObjNum + 1;
    const contentObjNum = pageObjNum + 2;
    const contentStr = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;

    objs.push(
      enc(
        `${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${imgObjNum} 0 R >> >> /Contents ${contentObjNum} 0 R >>\nendobj\n`
      )
    );

    const imgHead = enc(
      `${imgObjNum} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`
    );
    const imgFoot = enc('\nendstream\nendobj\n');
    const imgObj = new Uint8Array(imgHead.length + jpeg.length + imgFoot.length);
    imgObj.set(imgHead, 0);
    imgObj.set(jpeg, imgHead.length);
    imgObj.set(imgFoot, imgHead.length + jpeg.length);
    objs.push(imgObj);

    objs.push(
      enc(
        `${contentObjNum} 0 obj\n<< /Length ${contentStr.length} >>\nstream\n${contentStr}\nendstream\nendobj\n`
      )
    );
  }

  const offsets: number[] = [];
  let offset = header.length;
  for (const o of objs) {
    offsets.push(offset);
    offset += o.length;
  }

  let xrefStr = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xrefStr += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  const trailerBytes = enc(
    `${xrefStr}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF`
  );

  const totalLen = header.length + objs.reduce((acc, o) => acc + o.length, 0) + trailerBytes.length;
  const out = new Uint8Array(totalLen);
  let cursor = 0;
  out.set(header, cursor);
  cursor += header.length;
  for (const o of objs) {
    out.set(o, cursor);
    cursor += o.length;
  }
  out.set(trailerBytes, cursor);
  return out;
}

/**
 * Normalizes a PDF document's rowCounts into a 2D array of flattened page indices
 * ordered strictly left-to-right within each row, then top-to-bottom across rows.
 */
export function normalizePdfPageRows(
  totalPages: number,
  rowCounts?: number[] | null
): number[][] {
  const safeTotal = Math.max(0, Math.floor(totalPages || 0));
  if (safeTotal === 0) return [];

  const counts: number[] = [];
  let sum = 0;
  if (Array.isArray(rowCounts)) {
    for (const raw of rowCounts) {
      const c = Math.floor(Number(raw) || 0);
      if (c > 0) {
        const take = Math.min(c, safeTotal - sum);
        if (take > 0) {
          counts.push(take);
          sum += take;
        }
      }
      if (sum >= safeTotal) break;
    }
  }
  while (sum < safeTotal) {
    counts.push(1);
    sum += 1;
  }

  const rows: number[][] = [];
  let idx = 0;
  for (const c of counts) {
    const row: number[] = [];
    for (let j = 0; j < c; j++) {
      row.push(idx++);
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Computes updated rowCounts and flattened insertion index when adding a blank page
 * either to the side ('side', right next to targetIdx in the same row) or below ('below',
 * as a new row immediately beneath targetIdx's row).
 */
export function insertPdfPageInRows(
  totalPages: number,
  rowCounts: number[] | null | undefined,
  targetIdx: number,
  placement: 'below' | 'side' = 'below'
): { rowCounts: number[]; insertIdx: number } {
  const rows = normalizePdfPageRows(totalPages, rowCounts);
  if (rows.length === 0) {
    return { rowCounts: [1], insertIdx: 0 };
  }
  const safeTarget = Math.max(0, Math.min(Math.floor(targetIdx || 0), totalPages - 1));
  const counts = rows.map(r => r.length);

  let targetRow = 0;
  let rowEndIdx = rows[0][rows[0].length - 1];
  for (let r = 0; r < rows.length; r++) {
    if (rows[r].includes(safeTarget)) {
      targetRow = r;
      rowEndIdx = rows[r][rows[r].length - 1];
      break;
    }
  }

  if (placement === 'side') {
    counts[targetRow] += 1;
    return { rowCounts: counts, insertIdx: safeTarget + 1 };
  }

  // placement === 'below': create a new row immediately underneath targetRow
  counts.splice(targetRow + 1, 0, 1);
  return { rowCounts: counts, insertIdx: rowEndIdx + 1 };
}

/**
 * Removes a page index from rowCounts (guarding against removing the last remaining page)
 * and returns the next active page index.
 */
export function removePdfPageFromRows(
  totalPages: number,
  rowCounts: number[] | null | undefined,
  removeIdx: number
): { rowCounts: number[]; removed: boolean; nextActiveIdx: number } {
  const rows = normalizePdfPageRows(totalPages, rowCounts);
  if (totalPages <= 1 || rows.length === 0) {
    return {
      rowCounts: rows.map(r => r.length),
      removed: false,
      nextActiveIdx: 0
    };
  }
  const safeRemove = Math.max(0, Math.min(Math.floor(removeIdx || 0), totalPages - 1));
  const counts = rows.map(r => r.length);
  for (let r = 0; r < rows.length; r++) {
    if (rows[r].includes(safeRemove)) {
      counts[r] -= 1;
      if (counts[r] <= 0) counts.splice(r, 1);
      break;
    }
  }
  const nextTotal = totalPages - 1;
  return {
    rowCounts: counts,
    removed: true,
    nextActiveIdx: Math.max(0, Math.min(safeRemove, nextTotal - 1))
  };
}

/**
 * Deletes an entry at removeIdx and shifts all higher integer keys down by 1.
 */
export function shiftIndexedRecordOnDelete<T>(
  record: Record<number, T> | null | undefined,
  removeIdx: number
): Record<number, T> {
  const next: Record<number, T> = {};
  if (!record) return next;
  const target = Math.max(0, Math.floor(removeIdx));
  for (const [rawKey, value] of Object.entries(record)) {
    const k = Number(rawKey);
    if (!Number.isInteger(k) || k < 0 || k === target) continue;
    next[k > target ? k - 1 : k] = value;
  }
  return next;
}

/**
 * Splits a multi-equation LaTeX string into clean wrap-friendly sub-expressions
 * on top-level \quad / \qquad separators and between adjacent \begin{cases} blocks,
 * without ever splitting inside braces {} or environments.
 */
export function splitLatexFormulaParts(latex: string): string[] {
  const src = (latex || '').trim();
  if (!src) return [];

  const parts: string[] = [];
  let braceDepth = 0;
  let envDepth = 0;
  let buf = '';
  let i = 0;

  const flush = () => {
    const cleaned = buf.replace(/^\s*[,;]\s*/, '').replace(/\s*[,;]\s*$/, '').trim();
    if (cleaned) parts.push(cleaned);
    buf = '';
  };

  while (i < src.length) {
    if (src.startsWith('\\begin{', i)) {
      envDepth++;
      buf += '\\begin{';
      i += 7;
      continue;
    }
    if (src.startsWith('\\end{', i)) {
      const closeIdx = src.indexOf('}', i + 5);
      if (closeIdx !== -1) {
        const endToken = src.slice(i, closeIdx + 1);
        buf += endToken;
        envDepth = Math.max(0, envDepth - 1);
        i = closeIdx + 1;
        if (braceDepth === 0 && envDepth === 0) {
          const betweenCases = src.slice(i).match(/^\s*[,;]?\s*(?:\\;|\\,|\\q?quad)?\s*(?=\\begin\{)/);
          if (betweenCases) {
            flush();
            i += betweenCases[0].length;
          }
        }
        continue;
      }
    }

    const ch = src[i];
    if (ch === '{' && src[i - 1] !== '\\') {
      braceDepth++;
      buf += ch;
      i++;
      continue;
    }
    if (ch === '}' && src[i - 1] !== '\\') {
      braceDepth = Math.max(0, braceDepth - 1);
      buf += ch;
      i++;
      continue;
    }

    if (braceDepth === 0 && envDepth === 0) {
      const sepMatch = src.slice(i).match(/^[,;]?\s*\\q?quad\b\s*/);
      if (sepMatch) {
        flush();
        i += sepMatch[0].length;
        continue;
      }
    }

    buf += ch;
    i++;
  }

  flush();
  return parts.length > 0 ? parts : [src];
}

/**
 * Formats Russian plural label for a formula count (e.g., "1 формула", "33 формулы", "15 формул").
 */
export function formatFormulaCountRu(count: number): string {
  const n = Math.max(0, Math.floor(count));
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${n} формул`;
  if (mod10 === 1) return `${n} формула`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} формулы`;
  return `${n} формул`;
}


