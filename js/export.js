window.WB = window.WB || {};

// Пропорциональный расчёт размеров фрагмента/страницы без вертикального растягивания
WB.calcAspectFitBox = function(rawW, rawH, maxW = 560, maxH = 520, minSize = 36) {
  const safeW = Math.max(1, Number(rawW) || 1);
  const safeH = Math.max(1, Number(rawH) || 1);
  let scale = 1;
  if (safeW > maxW || safeH > maxH) {
    scale = Math.min(maxW / safeW, maxH / safeH);
  }
  const scaledW = safeW * scale;
  const scaledH = safeH * scale;
  if (scaledW < minSize && scaledH < minSize) {
    const up = Math.min(minSize / Math.max(scaledW, scaledH), maxW / scaledW, maxH / scaledH);
    return {
      w: Math.max(1, Math.round(scaledW * up)),
      h: Math.max(1, Math.round(scaledH * up))
    };
  }
  return {
    w: Math.max(1, Math.round(scaledW)),
    h: Math.max(1, Math.round(scaledH))
  };
};

WB.measureImageDimensions = function(src) {
  return new Promise((resolve) => {
    if (!src) return resolve({ width: 440, height: 560 });
    const img = new Image();
    img.onload = () => resolve({
      width: img.naturalWidth || img.width || 440,
      height: img.naturalHeight || img.height || 560
    });
    img.onerror = () => resolve({ width: 440, height: 560 });
    img.src = src;
  });
};

// Состояние встроенного PDF-редактора (многостраничный 2D-режим со всеми инструментами доски)
WB.PDF_SHAPE_TOOLS = new Set([
  'line', 'arrow', 'axes',
  'rect', 'square', 'ellipse', 'circle', 'unit_circle',
  'triangle', 'rhombus', 'parallelogram', 'trapezoid', 'pentagon', 'hexagon',
  'cube', 'parallelepiped', 'prism', 'pyramid', 'tetrahedron', 'cylinder', 'cone', 'sphere'
]);

WB.pdfEditor = {
  isOpen: false,
  targetWidgetId: null,
  title: 'Документ PDF',
  pages: [],           // Массив dataURL всех страниц в порядке чтения (слева направо, сверху вниз)
  rowCounts: [],       // Количество страниц в каждом ряду, например [2, 1] -> ряд 1: стр 1-2, ряд 2: стр 3
  pageDims: {},        // Кэш натуральных размеров страниц { [idx]: { width, height } }
  currentPage: 0,
  zoom: 1.0,
  tool: 'crop',        // 'crop' | 'select' | 'hand' | 'draw' | 'highlighter' | 'eraser' | 'laser' | <shape>
  drawColor: '#ef4444',
  drawSize: 4,
  drawLineStyle: 'solid',
  highlighterColor: '#facc15',
  highlighterSize: 22,
  highlighterLineStyle: 'solid',
  blankPageStyle: 'grid', // 'grid' (Клетчатая по умолчанию) | 'ruled' (Линейчатая) | 'blank' (Без разметки)
  pendingInsertTarget: null, // { pageIdx, placement: 'below' | 'side' }
  cropBox: null,       // { x, y, w, h } в натуральных координатах страницы
  cropPageIdx: null,   // Индекс страницы, на которой выделен фрагмент
  activeDragPageIdx: null,
  activeOverlay: null,
  isDragging: false,
  didErase: false,
  startPt: { x: 0, y: 0 },
  currentStroke: null,
  selectedStroke: null, // { pageIdx, strokeIdx, dragOffsetX, dragOffsetY, moved }
  handPan: null,        // { startClientX, startClientY, scrollLeft, scrollTop }
  laserPageIdx: null,
  laserPoints: [],
  laserRaf: null,
  isPhoto: false,
  strokesByPage: {},   // Несохранённые штрихи и фигуры по индексам страниц (в натуральных координатах)
  widgetsByPage: {},   // Текст, стикеры, формулы, таблицы по индексам страниц
  history: [],         // Документная история снимков { pages, rowCounts, strokesByPage, widgetsByPage, currentPage }
  historyStep: -1
};

WB.getPdfBlankPageStyleLabel = function(style) {
  if (style === 'ruled') return 'Линейчатая';
  if (style === 'blank') return 'Без разметки';
  return 'Клетчатая';
};

WB.normalizePdfPageRows = function(totalPages, rowCounts) {
  const safeTotal = Math.max(0, Math.floor(totalPages || 0));
  if (safeTotal === 0) return [];
  const counts = [];
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
  const rows = [];
  let idx = 0;
  for (const c of counts) {
    const row = [];
    for (let j = 0; j < c; j++) row.push(idx++);
    rows.push(row);
  }
  return rows;
};

WB.insertPdfPageInRows = function(totalPages, rowCounts, targetIdx, placement = 'below') {
  const rows = WB.normalizePdfPageRows(totalPages, rowCounts);
  if (rows.length === 0) return { rowCounts: [1], insertIdx: 0 };
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
  counts.splice(targetRow + 1, 0, 1);
  return { rowCounts: counts, insertIdx: rowEndIdx + 1 };
};

WB.removePdfPageFromRows = function(totalPages, rowCounts, removeIdx) {
  const rows = WB.normalizePdfPageRows(totalPages, rowCounts);
  if (totalPages <= 1 || rows.length === 0) {
    return { rowCounts: rows.map(r => r.length), removed: false, nextActiveIdx: 0 };
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
};

WB.shiftPdfStrokesOnInsert = function(record, insertIdx) {
  const next = {};
  if (!record) return next;
  const threshold = Math.max(0, Math.floor(insertIdx));
  for (const [rawKey, value] of Object.entries(record)) {
    const k = Number(rawKey);
    if (!Number.isInteger(k) || k < 0) continue;
    const nextKey = k >= threshold ? k + 1 : k;
    next[nextKey] = value;
  }
  return next;
};

WB.shiftPdfRecordOnDelete = function(record, removeIdx) {
  const next = {};
  if (!record) return next;
  const target = Math.max(0, Math.floor(removeIdx));
  for (const [rawKey, value] of Object.entries(record)) {
    const k = Number(rawKey);
    if (!Number.isInteger(k) || k < 0 || k === target) continue;
    next[k > target ? k - 1 : k] = value;
  }
  return next;
};

WB.clonePdfStrokes = function(strokes) {
  if (!Array.isArray(strokes)) return [];
  return strokes.map(s => {
    const copy = {
      id: s.id || ('ps_' + Math.random().toString(36).slice(2, 9)),
      type: s.type || (s.isHighlighter ? 'highlighter' : 'pen'),
      color: s.color,
      size: s.size,
      lineStyle: s.lineStyle || 'solid',
      isHighlighter: !!s.isHighlighter,
      alpha: typeof s.alpha === 'number' ? s.alpha : (s.isHighlighter ? 0.36 : 1)
    };
    if (Array.isArray(s.points)) {
      copy.points = s.points.map(p => ({ x: p.x, y: p.y }));
    }
    if (typeof s.x1 === 'number') {
      copy.x1 = s.x1; copy.y1 = s.y1; copy.x2 = s.x2; copy.y2 = s.y2;
    }
    if (s.fillColor) copy.fillColor = s.fillColor;
    if (s.shape3d) copy.shape3d = JSON.parse(JSON.stringify(s.shape3d));
    return copy;
  });
};

WB.cloneAllPdfStrokesByPage = function(map) {
  const out = {};
  if (!map) return out;
  for (const [k, list] of Object.entries(map)) {
    if (Array.isArray(list) && list.length > 0) {
      out[Number(k)] = WB.clonePdfStrokes(list);
    }
  }
  return out;
};

WB.clonePdfWidgets = function(widgets) {
  if (!Array.isArray(widgets)) return [];
  return widgets.map(w => JSON.parse(JSON.stringify(w)));
};

WB.cloneAllPdfWidgetsByPage = function(map) {
  const out = {};
  if (!map) return out;
  for (const [k, list] of Object.entries(map)) {
    if (Array.isArray(list) && list.length > 0) {
      out[Number(k)] = WB.clonePdfWidgets(list);
    }
  }
  return out;
};

WB.getPdfDashArray = function(style, size) {
  if (typeof WB.getLineDashPattern === 'function') {
    return WB.getLineDashPattern(style || 'solid', size || 4);
  }
  const w = Math.max(2, Number(size) || 4);
  if (style === 'dashed') return [Math.max(8, w * 2.5), Math.max(6, w * 1.8)];
  if (style === 'dotted') return [Math.max(1, w * 0.25), Math.max(6, w * 2.1)];
  if (style === 'dashdot') return [Math.max(9, w * 2.6), Math.max(5, w * 1.6), Math.max(1, w * 0.3), Math.max(5, w * 1.6)];
  return [];
};

WB.getPdfStrokeBounds = function(s) {
  if (!s) return null;
  if (Array.isArray(s.points) && s.points.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of s.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const pad = Math.max(6, (s.size || 4) / 2);
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }
  if (typeof s.x1 === 'number' && typeof s.x2 === 'number') {
    const pad = Math.max(8, (s.size || 4) / 2);
    return {
      minX: Math.min(s.x1, s.x2) - pad,
      minY: Math.min(s.y1, s.y2) - pad,
      maxX: Math.max(s.x1, s.x2) + pad,
      maxY: Math.max(s.y1, s.y2) + pad
    };
  }
  return null;
};

WB.drawPdfStrokeList = function(ctx, strokes, compositeOverPage = false) {
  if (!ctx || !Array.isArray(strokes) || strokes.length === 0) return;

  // 1. Сначала рисуем полупрозрачный фломастер
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) {
    if (!s || !s.isHighlighter || !Array.isArray(s.points) || s.points.length < 2) continue;
    ctx.save();
    ctx.globalCompositeOperation = compositeOverPage ? 'multiply' : 'source-over';
    ctx.globalAlpha = typeof s.alpha === 'number' ? s.alpha : (compositeOverPage ? 0.42 : 0.36);
    ctx.strokeStyle = s.color || '#facc15';
    const w = s.size || 22;
    ctx.lineWidth = w;
    ctx.setLineDash(WB.getPdfDashArray(s.lineStyle || 'solid', w));
    ctx.beginPath();
    ctx.moveTo(s.points[0].x, s.points[0].y);
    for (let i = 1; i < s.points.length; i++) {
      ctx.lineTo(s.points[i].x, s.points[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 2. Затем плотные линии маркера и геометрические фигуры (2D / 3D)
  for (const s of strokes) {
    if (!s || s.isHighlighter) continue;
    if (s.type && WB.PDF_SHAPE_TOOLS.has(s.type) && typeof WB.drawStrokeObject === 'function') {
      ctx.save();
      WB.drawStrokeObject(ctx, s, false);
      ctx.restore();
      continue;
    }
    if (!Array.isArray(s.points) || s.points.length < 2) continue;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = typeof s.alpha === 'number' ? s.alpha : 1;
    ctx.strokeStyle = s.color || '#ef4444';
    const w = s.size || 4;
    ctx.lineWidth = w;
    ctx.setLineDash(WB.getPdfDashArray(s.lineStyle || 'solid', w));
    ctx.beginPath();
    ctx.moveTo(s.points[0].x, s.points[0].y);
    for (let i = 1; i < s.points.length; i++) {
      ctx.lineTo(s.points[i].x, s.points[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
};

WB.drawPdfWidgetsOnCanvas = function(ctx, widgets) {
  if (!ctx || !Array.isArray(widgets) || widgets.length === 0) return;
  for (const w of widgets) {
    ctx.save();
    if (w.type === 'note') {
      ctx.fillStyle = w.color || '#fef08a';
      ctx.shadowColor = 'rgba(15, 23, 42, 0.16)';
      ctx.shadowBlur = 10;
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      ctx.fillRect(w.x, w.y, w.w, 24);
      ctx.fillStyle = '#1e293b';
      ctx.font = '16px Inter, Segoe UI, sans-serif';
      WB.drawWrappedText(ctx, w.text || '', w.x + 12, w.y + 44, Math.max(40, w.w - 24), 22);
    } else if (w.type === 'text') {
      ctx.fillStyle = w.color || '#0f172a';
      ctx.font = '600 20px Inter, Segoe UI, sans-serif';
      WB.drawWrappedText(ctx, w.text || '', w.x + 8, w.y + 28, Math.max(40, w.w - 16), 26);
    } else if (w.type === 'latex') {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.5;
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.strokeRect(w.x, w.y, w.w, w.h);
      if (w.lawTitle) {
        ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
        ctx.fillRect(w.x, w.y, w.w, 26);
        ctx.fillStyle = '#2563eb';
        ctx.font = 'bold 12px Inter, Segoe UI, sans-serif';
        ctx.fillText(String(w.lawTitle), w.x + 10, w.y + 18, w.w - 20);
      }
      ctx.fillStyle = '#0f172a';
      ctx.font = 'italic 20px "Cambria Math", "STIX Two Math", Georgia, serif';
      WB.drawWrappedText(ctx, w.latex || '', w.x + 12, w.y + (w.lawTitle ? 54 : 38), Math.max(40, w.w - 24), 24);
    } else if (w.type === 'table' && Array.isArray(w.tableData)) {
      const rows = w.tableData.length || 1;
      const cols = (w.tableData[0] && w.tableData[0].length) || 1;
      const cellW = w.w / cols;
      const cellH = w.h / rows;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(w.x, w.y, w.w, cellH);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1;
      ctx.strokeRect(w.x, w.y, w.w, w.h);
      for (let r = 1; r < rows; r++) {
        ctx.beginPath();
        ctx.moveTo(w.x, w.y + r * cellH);
        ctx.lineTo(w.x + w.w, w.y + r * cellH);
        ctx.stroke();
      }
      for (let c = 1; c < cols; c++) {
        ctx.beginPath();
        ctx.moveTo(w.x + c * cellW, w.y);
        ctx.lineTo(w.x + c * cellW, w.y + w.h);
        ctx.stroke();
      }
      ctx.fillStyle = '#0f172a';
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const val = String((w.tableData[r] && w.tableData[r][c]) || '');
          ctx.font = r === 0 ? 'bold 13px Inter, Segoe UI, sans-serif' : '13px Inter, Segoe UI, sans-serif';
          ctx.fillText(val.slice(0, 32), w.x + c * cellW + 8, w.y + r * cellH + cellH * 0.62, Math.max(20, cellW - 14));
        }
      }
    }
    ctx.restore();
  }
};

WB.erasePdfStrokeSegments = function(strokes, pt, radius = 16) {
  if (!Array.isArray(strokes) || strokes.length === 0) {
    return { strokes: [], changed: false };
  }
  const cfg = WB.eraserConfig || { target: 'pen_and_highlighter', wholeStroke: false };
  const target = cfg.target || 'pen_and_highlighter';
  const wholeStroke = !!cfg.wholeStroke;
  const r = Math.max(2, Number(radius) || 16);
  const next = [];
  let changed = false;

  for (const s of strokes) {
    const isHL = !!s.isHighlighter;
    const isShape = !!(s.type && WB.PDF_SHAPE_TOOLS.has(s.type));
    const canErase =
      target === 'all' ||
      (target === 'highlighter_only' && isHL) ||
      (target === 'pen_only' && !isHL && !isShape) ||
      (target === 'pen_and_highlighter' && !isShape);

    if (!canErase) {
      next.push(s);
      continue;
    }

    if (isShape) {
      const b = WB.getPdfStrokeBounds(s);
      if (b && pt.x >= b.minX - r && pt.x <= b.maxX + r && pt.y >= b.minY - r && pt.y <= b.maxY + r) {
        changed = true;
        continue;
      }
      next.push(s);
      continue;
    }

    const pts = Array.isArray(s && s.points) ? s.points : [];
    if (pts.length < 2) {
      changed = true;
      continue;
    }
    const extraHit = isHL ? Math.max(r, (s.size || 20) * 0.5) : r;
    if (wholeStroke) {
      const anyHit = pts.some(p => Math.hypot(p.x - pt.x, p.y - pt.y) <= extraHit);
      if (anyHit) {
        changed = true;
        continue;
      }
      next.push(s);
      continue;
    }

    let currentChunk = [];
    let strokeTouched = false;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const hit = Math.hypot(p.x - pt.x, p.y - pt.y) <= extraHit;
      if (hit) {
        strokeTouched = true;
        if (currentChunk.length >= 2) {
          next.push({
            color: s.color,
            size: s.size,
            lineStyle: s.lineStyle || 'solid',
            isHighlighter: isHL,
            alpha: s.alpha,
            points: currentChunk
          });
        }
        currentChunk = [];
      } else {
        currentChunk.push({ x: p.x, y: p.y });
      }
    }
    if (currentChunk.length >= 2) {
      next.push({
        color: s.color,
        size: s.size,
        lineStyle: s.lineStyle || 'solid',
        isHighlighter: isHL,
        alpha: s.alpha,
        points: currentChunk
      });
    } else if (currentChunk.length === 1) {
      strokeTouched = true;
    }
    if (strokeTouched) changed = true;
  }

  return { strokes: next, changed };
};

WB.resetPdfHistory = function() {
  WB.pdfEditor.history = [{
    pages: WB.pdfEditor.pages.slice(),
    rowCounts: WB.pdfEditor.rowCounts.slice(),
    docxPages: Array.isArray(WB.pdfEditor.docxPages)
      ? WB.pdfEditor.docxPages.map(p => p ? Object.assign({}, p) : null)
      : null,
    strokesByPage: WB.cloneAllPdfStrokesByPage(WB.pdfEditor.strokesByPage),
    widgetsByPage: WB.cloneAllPdfWidgetsByPage(WB.pdfEditor.widgetsByPage),
    currentPage: WB.pdfEditor.currentPage
  }];
  WB.pdfEditor.historyStep = 0;
  WB.updatePdfHistoryButtons();
};

WB.updatePdfHistoryButtons = function() {
  const stack = WB.pdfEditor.history || [];
  const step = WB.pdfEditor.historyStep ?? -1;
  const undoBtn = document.getElementById('pdfUndoBtn');
  const redoBtn = document.getElementById('pdfRedoBtn');
  if (undoBtn) undoBtn.disabled = step <= 0;
  if (redoBtn) redoBtn.disabled = step >= stack.length - 1;
};

WB.syncPdfAnnotationsToWidget = function() {
  if (!WB.pdfEditor || !WB.pdfEditor.targetWidgetId) return null;
  const w = WB.state.widgets.find(item => item.id === WB.pdfEditor.targetWidgetId);
  if (!w) return null;
  w.pdfStrokesByPage = WB.cloneAllPdfStrokesByPage(WB.pdfEditor.strokesByPage);
  w.pdfWidgetsByPage = WB.cloneAllPdfWidgetsByPage(WB.pdfEditor.widgetsByPage);
  if (typeof WB.scheduleSaveToStorage === 'function') WB.scheduleSaveToStorage(700);
  return w;
};

WB.pushPdfHistorySnapshot = function() {
  if (!Array.isArray(WB.pdfEditor.history) || WB.pdfEditor.history.length === 0) {
    WB.resetPdfHistory();
  }
  const trimmed = WB.pdfEditor.history.slice(0, WB.pdfEditor.historyStep + 1);
  trimmed.push({
    pages: WB.pdfEditor.pages.slice(),
    rowCounts: WB.pdfEditor.rowCounts.slice(),
    docxPages: Array.isArray(WB.pdfEditor.docxPages)
      ? WB.pdfEditor.docxPages.map(p => p ? Object.assign({}, p) : null)
      : null,
    strokesByPage: WB.cloneAllPdfStrokesByPage(WB.pdfEditor.strokesByPage),
    widgetsByPage: WB.cloneAllPdfWidgetsByPage(WB.pdfEditor.widgetsByPage),
    currentPage: WB.pdfEditor.currentPage
  });
  if (trimmed.length > 35) trimmed.shift();
  WB.pdfEditor.history = trimmed;
  WB.pdfEditor.historyStep = trimmed.length - 1;
  WB.syncPdfAnnotationsToWidget();
  WB.updatePdfHistoryButtons();
};

WB.applyPdfHistorySnapshot = function(snap) {
  if (!snap) return;
  const prevPages = WB.pdfEditor.pages || [];
  const prevRows = (WB.pdfEditor.rowCounts || []).join(',');
  const nextPages = Array.isArray(snap.pages) ? snap.pages.slice() : [];
  const nextRowCounts = Array.isArray(snap.rowCounts) && snap.rowCounts.length > 0
    ? snap.rowCounts.slice()
    : WB.normalizePdfPageRows(nextPages.length, null).map(r => r.length);
  const pagesChanged =
    prevPages.length !== nextPages.length ||
    prevRows !== nextRowCounts.join(',') ||
    nextPages.some((src, i) => src !== prevPages[i]);

  WB.pdfEditor.pages = nextPages;
  WB.pdfEditor.rowCounts = nextRowCounts;
  if (Array.isArray(snap.docxPages)) {
    WB.pdfEditor.docxPages = snap.docxPages.map(p => p ? Object.assign({}, p) : null);
  }
  WB.pdfEditor.strokesByPage = WB.cloneAllPdfStrokesByPage(snap.strokesByPage);
  WB.pdfEditor.widgetsByPage = WB.cloneAllPdfWidgetsByPage(snap.widgetsByPage);
  WB.pdfEditor.currentPage = Math.max(0, Math.min(snap.currentPage || 0, Math.max(0, nextPages.length - 1)));
  WB.pdfEditor.cropBox = null;
  WB.pdfEditor.cropPageIdx = null;
  WB.pdfEditor.selectedStroke = null;
  WB.updatePdfCropButtons(false);
  WB.syncPdfAnnotationsToWidget();

  if (pagesChanged) {
    const w = WB.state.widgets.find(item => item.id === WB.pdfEditor.targetWidgetId);
    if (w) {
      w.pdfPages = WB.pdfEditor.pages.slice();
      w.pdfRowCounts = WB.pdfEditor.rowCounts.slice();
      if (WB.pdfEditor.isDocx && Array.isArray(WB.pdfEditor.docxPages)) {
        w.docxPages = WB.pdfEditor.docxPages.map(p => p ? Object.assign({}, p) : null);
      }
      w.currentPage = WB.pdfEditor.currentPage;
      if (WB.pdfEditor.pages[WB.pdfEditor.currentPage]) {
        w.src = WB.pdfEditor.pages[WB.pdfEditor.currentPage];
      }
      WB.renderWidgetsDOM();
      if (typeof WB.scheduleSaveToStorage === 'function') WB.scheduleSaveToStorage(600);
      else WB.saveToStorage();
      if (typeof WB.syncDiffBaselineFromCurrentState === 'function') WB.syncDiffBaselineFromCurrentState();
      if (typeof WB.pushRoomSnapshotToServer === 'function' && /^https?:$/i.test(window.location.protocol)) {
        WB.pushRoomSnapshotToServer(true);
      } else if (typeof WB.saveHistory === 'function') {
        WB.saveHistory();
      }
    }
    WB.renderPdfEditorThumbnails();
    WB.renderAllPdfPages(false);
  } else {
    if (WB.pdfEditor.isPhoto) {
      WB.syncPhotoRibbonUI();
    }
    WB.drawAllPdfEditorOverlays();
    WB.renderAllPdfPageWidgets();
    WB.setPdfActivePageMeta(WB.pdfEditor.currentPage);
    if (typeof WB.broadcastPdfEvent === 'function' && WB.pdfEditor.targetWidgetId) {
      const idx = WB.pdfEditor.currentPage || 0;
      WB.broadcastPdfEvent('pdf_strokes_replace', {
        widgetId: WB.pdfEditor.targetWidgetId,
        pageIdx: idx,
        strokes: WB.pdfEditor.strokesByPage[idx] || []
      });
      WB.broadcastPdfEvent('pdf_widgets_replace', {
        widgetId: WB.pdfEditor.targetWidgetId,
        pageIdx: idx,
        widgets: WB.pdfEditor.widgetsByPage[idx] || []
      });
    }
  }
  WB.updatePdfHistoryButtons();
};

WB.pdfUndo = function() {
  if (WB.pdfEditor.historyStep <= 0) return;
  WB.pdfEditor.historyStep -= 1;
  WB.applyPdfHistorySnapshot(WB.pdfEditor.history[WB.pdfEditor.historyStep]);
};

WB.pdfRedo = function() {
  if (WB.pdfEditor.historyStep >= WB.pdfEditor.history.length - 1) return;
  WB.pdfEditor.historyStep += 1;
  WB.applyPdfHistorySnapshot(WB.pdfEditor.history[WB.pdfEditor.historyStep]);
};

WB.sanitizeExportFilename = function(title, ext) {
  const cleanExt = String(ext || '').replace(/^\.+/, '').trim() || 'png';
  const base = String(title || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return `${base || 'whiteboard-pro'}.${cleanExt}`;
};

WB.triggerDownload = function(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.style.display = 'none';
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();

  setTimeout(() => {
    if (link.parentNode) document.body.removeChild(link);
  }, 1000);

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 15000);

  if (typeof WB.showToast === 'function') {
    WB.showToast(`💾 Сохранён файл: ${filename}`, 2400, 'success');
  }
};

WB.buildExportCanvas = async function() {
  const contentBounds = typeof WB.getAllContentBounds === 'function' ? WB.getAllContentBounds() : null;
  const pad = 60;

  let exportX, exportY, exportW, exportH;
  if (contentBounds) {
    exportX = contentBounds.x - pad;
    exportY = contentBounds.y - pad;
    exportW = Math.max(600, Math.min(4096, Math.ceil(contentBounds.w + pad * 2)));
    exportH = Math.max(400, Math.min(4096, Math.ceil(contentBounds.h + pad * 2)));
  } else {
    exportX = -WB.cam.x / WB.cam.z;
    exportY = -WB.cam.y / WB.cam.z;
    exportW = window.innerWidth || 1280;
    exportH = window.innerHeight || 720;
  }

  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = exportW;
  exportCanvas.height = exportH;
  const exCtx = exportCanvas.getContext('2d');

  const isDark = document.body.classList.contains('dark');
  exCtx.fillStyle = isDark ? '#0f172a' : '#f8fafc';
  exCtx.fillRect(0, 0, exportW, exportH);

  exCtx.save();
  exCtx.translate(-exportX, -exportY);

  // Отрисовываем активную фоновую сетку (Клетка / Линейная / Точки) на экспортируемом изображении
  const gridMode = WB.gridMode || 'grid-lines';
  if (gridMode !== 'grid-none') {
    const step = WB.gridSize || 32;
    const startX = Math.floor(exportX / step) * step;
    const endX = exportX + exportW + step;
    const startY = Math.floor(exportY / step) * step;
    const endY = exportY + exportH + step;

    exCtx.save();
    if (gridMode === 'grid-lines') {
      exCtx.strokeStyle = isDark ? 'rgba(51, 65, 85, 0.72)' : 'rgba(203, 213, 225, 0.8)';
      exCtx.lineWidth = 1;
      exCtx.beginPath();
      for (let gx = startX; gx <= endX; gx += step) {
        exCtx.moveTo(gx, exportY);
        exCtx.lineTo(gx, exportY + exportH);
      }
      for (let gy = startY; gy <= endY; gy += step) {
        exCtx.moveTo(exportX, gy);
        exCtx.lineTo(exportX + exportW, gy);
      }
      exCtx.stroke();
    } else if (gridMode === 'grid-ruled') {
      exCtx.strokeStyle = isDark ? 'rgba(71, 85, 105, 0.72)' : 'rgba(148, 163, 184, 0.48)';
      exCtx.lineWidth = 1;
      exCtx.beginPath();
      for (let gy = startY; gy <= endY; gy += step) {
        exCtx.moveTo(exportX, gy);
        exCtx.lineTo(exportX + exportW, gy);
      }
      exCtx.stroke();
    } else if (gridMode === 'grid-dots') {
      exCtx.fillStyle = isDark ? 'rgba(100, 116, 139, 0.85)' : 'rgba(148, 163, 184, 0.85)';
      for (let gx = startX; gx <= endX; gx += step) {
        for (let gy = startY; gy <= endY; gy += step) {
          exCtx.beginPath();
          exCtx.arc(gx, gy, 1.35, 0, Math.PI * 2);
          exCtx.fill();
        }
      }
    }
    exCtx.restore();
  }

  for (const w of WB.state.widgets) {
    if (w.type === 'note') {
      exCtx.save();
      exCtx.fillStyle = w.color;
      exCtx.shadowColor = 'rgba(0,0,0,0.15)';
      exCtx.shadowBlur = 12;
      exCtx.fillRect(w.x, w.y, w.w, w.h);
      exCtx.restore();

      exCtx.fillStyle = 'rgba(0,0,0,0.06)';
      exCtx.fillRect(w.x, w.y, w.w, 28);

      exCtx.fillStyle = '#1e293b';
      exCtx.font = '16px Segoe UI, sans-serif';
      WB.drawWrappedText(exCtx, w.text, w.x + 12, w.y + 48, w.w - 24, 22);
    } else if (w.type === 'text') {
      exCtx.fillStyle = isDark ? '#f8fafc' : '#1e293b';
      exCtx.font = 'bold 20px Segoe UI, sans-serif';
      WB.drawWrappedText(exCtx, w.text, w.x + 10, w.y + 52, w.w - 20, 26);
    } else if (w.type === 'latex') {
      exCtx.save();
      exCtx.fillStyle = isDark ? '#1e293b' : '#ffffff';
      exCtx.strokeStyle = isDark ? '#334155' : '#e2e8f0';
      exCtx.lineWidth = 1.5;
      exCtx.fillRect(w.x, w.y, w.w, w.h);
      exCtx.strokeRect(w.x, w.y, w.w, w.h);

      exCtx.fillStyle = isDark ? 'rgba(96,165,250,0.15)' : 'rgba(37,99,235,0.08)';
      exCtx.fillRect(w.x, w.y, w.w, 26);

      exCtx.fillStyle = '#2563eb';
      exCtx.font = 'bold 12px Segoe UI, sans-serif';
      exCtx.fillText(w.lawTitle || 'LaTeX Формула', w.x + 10, w.y + 18);

      exCtx.fillStyle = w.color || (isDark ? '#f8fafc' : '#1e293b');
      exCtx.font = 'italic 18px "Cambria Math", "STIX Two Math", serif';
      WB.drawWrappedText(exCtx, w.latex, w.x + 14, w.y + 54, w.w - 28, 24);
      exCtx.restore();
    } else if (w.type === 'table' && Array.isArray(w.tableData)) {
      const rows = w.tableData.length || 1;
      const cols = (w.tableData[0] && w.tableData[0].length) || 1;
      const bodyTop = w.y + 28;
      const bodyH = Math.max(24, w.h - 28);
      const cellW = w.w / cols;
      const cellH = bodyH / rows;
      exCtx.save();
      exCtx.fillStyle = isDark ? '#1e293b' : '#ffffff';
      exCtx.fillRect(w.x, bodyTop, w.w, bodyH);
      exCtx.fillStyle = isDark ? '#334155' : '#f1f5f9';
      exCtx.fillRect(w.x, bodyTop, w.w, cellH);
      exCtx.strokeStyle = isDark ? '#475569' : '#cbd5e1';
      exCtx.lineWidth = 1;
      exCtx.strokeRect(w.x, bodyTop, w.w, bodyH);
      for (let r = 1; r < rows; r++) {
        exCtx.beginPath();
        exCtx.moveTo(w.x, bodyTop + r * cellH);
        exCtx.lineTo(w.x + w.w, bodyTop + r * cellH);
        exCtx.stroke();
      }
      for (let c = 1; c < cols; c++) {
        exCtx.beginPath();
        exCtx.moveTo(w.x + c * cellW, bodyTop);
        exCtx.lineTo(w.x + c * cellW, bodyTop + bodyH);
        exCtx.stroke();
      }
      exCtx.fillStyle = isDark ? '#f8fafc' : '#0f172a';
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const val = String((w.tableData[r] && w.tableData[r][c]) || '');
          exCtx.font = r === 0 ? 'bold 13px Segoe UI, sans-serif' : '13px Segoe UI, sans-serif';
          exCtx.fillText(val.slice(0, 28), w.x + c * cellW + 8, bodyTop + r * cellH + cellH * 0.6, cellW - 14);
        }
      }
      exCtx.restore();
    } else if (w.type === 'image' && w.src) {
      await new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
          const boxW = Math.max(1, w.w);
          const boxH = Math.max(1, w.h - 28);
          if (w.isPdf) {
            exCtx.fillStyle = '#ffffff';
            exCtx.fillRect(w.x, w.y + 28, boxW, boxH);
          }
          const iw = img.naturalWidth || img.width || boxW;
          const ih = img.naturalHeight || img.height || boxH;
          const scale = Math.min(boxW / iw, boxH / ih);
          const dw = iw * scale;
          const dh = ih * scale;
          const dx = w.x + (boxW - dw) / 2;
          const dy = (w.y + 28) + (boxH - dh) / 2;
          exCtx.drawImage(img, dx, dy, dw, dh);
          resolve();
        };
        img.onerror = resolve;
        img.src = w.src;
      });
    }
  }

  for (const s of WB.state.strokes) {
    WB.drawStrokeObject(exCtx, s, false);
  }

  exCtx.restore();
  return exportCanvas;
};

WB.downloadBoard = async function(format = 'png') {
  const exportCanvas = await WB.buildExportCanvas();
  const isJpg = format === 'jpg' || format === 'jpeg';
  const mime = isJpg ? 'image/jpeg' : 'image/png';
  const ext = isJpg ? 'jpg' : 'png';

  exportCanvas.toBlob((blob) => {
    if (blob) WB.triggerDownload(blob, WB.sanitizeExportFilename(WB.boardTitle, ext));
  }, mime, 0.92);
};

WB.buildMultiPagePDFBlob = function(canvases) {
  const list = Array.isArray(canvases) ? canvases.filter(Boolean) : [];
  if (list.length === 0) return null;

  const enc = (str) => new TextEncoder().encode(str);
  const header = enc('%PDF-1.4\n');
  const objs = [];

  objs.push(enc('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'));

  const kidRefs = list.map((_, i) => `${3 + i * 3} 0 R`);
  objs.push(enc(`2 0 obj\n<< /Type /Pages /Kids [${kidRefs.join(' ')}] /Count ${list.length} >>\nendobj\n`));

  for (let i = 0; i < list.length; i++) {
    const canvas = list[i];
    const w = Math.max(1, Math.round(canvas.width));
    const h = Math.max(1, Math.round(canvas.height));
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    const raw = atob(dataUrl.split(',')[1]);
    const jpegBytes = new Uint8Array(raw.length);
    for (let j = 0; j < raw.length; j++) jpegBytes[j] = raw.charCodeAt(j);

    const pageObjNum = 3 + i * 3;
    const imgObjNum = pageObjNum + 1;
    const contentObjNum = pageObjNum + 2;
    const contentStr = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;

    objs.push(enc(`${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${imgObjNum} 0 R >> >> /Contents ${contentObjNum} 0 R >>\nendobj\n`));

    const imgHead = enc(`${imgObjNum} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`);
    const imgFoot = enc('\nendstream\nendobj\n');
    const imgObj = new Uint8Array(imgHead.length + jpegBytes.length + imgFoot.length);
    imgObj.set(imgHead, 0);
    imgObj.set(jpegBytes, imgHead.length);
    imgObj.set(imgFoot, imgHead.length + jpegBytes.length);
    objs.push(imgObj);

    objs.push(enc(`${contentObjNum} 0 obj\n<< /Length ${contentStr.length} >>\nstream\n${contentStr}\nendstream\nendobj\n`));
  }

  const offsets = [];
  let offset = header.length;
  for (const o of objs) {
    offsets.push(offset);
    offset += o.length;
  }

  let xrefStr = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xrefStr += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  const trailerStr = `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF`;

  return new Blob([header, ...objs, enc(xrefStr + trailerStr)], { type: 'application/pdf' });
};

WB.buildPDFBlobFromCanvas = function(canvas) {
  return WB.buildMultiPagePDFBlob([canvas]);
};

WB.downloadPDF = async function() {
  const exportCanvas = await WB.buildExportCanvas();
  const pdfBlob = WB.buildPDFBlobFromCanvas(exportCanvas);
  if (pdfBlob) WB.triggerDownload(pdfBlob, WB.sanitizeExportFilename(WB.boardTitle, 'pdf'));
};

// --- ЗАГРУЗКА PDF.JS И РЕНДЕР СТРАНИЦ ---
WB.loadPdfJsLib = function() {
  return new Promise((resolve, reject) => {
    if (window.pdfjsLib) return resolve(window.pdfjsLib);
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    script.onerror = () => reject(new Error('Не удалось загрузить модуль PDF.js (проверьте интернет).'));
    document.head.appendChild(script);
  });
};

WB.renderPdfBufferToPages = async function(arrayBuf, maxPagesToRender = 18) {
  const pdfjsLib = await WB.loadPdfJsLib();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
  const count = Math.min(pdf.numPages, maxPagesToRender);
  const pages = [];

  for (let pageNum = 1; pageNum <= count; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.5 });
    const offCanvas = document.createElement('canvas');
    offCanvas.width = viewport.width;
    offCanvas.height = viewport.height;
    await page.render({ canvasContext: offCanvas.getContext('2d'), viewport }).promise;
    pages.push(offCanvas.toDataURL('image/jpeg', 0.88));
  }
  return pages;
};

WB.importPDFFileToBoard = async function(file) {
  if (!file) return;
  try {
    if (typeof WB.showToast === 'function') WB.showToast('📄 Рендеринг страниц PDF...', 4000);
    const arrayBuf = await file.arrayBuffer();
    const pages = await WB.renderPdfBufferToPages(arrayBuf, 20);
    if (!pages || pages.length === 0) return;

    const dims = await WB.measureImageDimensions(pages[0]);
    const fit = WB.calcAspectFitBox(dims.width, dims.height, 480, 560, 140);
    const center = WB.toWorld(window.innerWidth / 2, window.innerHeight / 2);
    const widgetObj = WB.addWidget('image', {
      x: center.x - fit.w / 2,
      y: center.y - (fit.h + 56) / 2,
      w: fit.w,
      h: fit.h + 56,
      src: pages[0],
      isPdf: true,
      pdfTitle: file.name || 'Документ PDF',
      pdfPages: pages,
      currentPage: 0
    });

    if (typeof WB.showToast === 'function') {
      WB.showToast(`✅ Загружен PDF (${pages.length} стр.). Двойной клик открывает PDF-редактор!`);
    }
    // Сразу открываем в PDF-редакторе для удобства выбора страниц и фрагментов
    WB.openPdfEditorForWidget(widgetObj.id);
  } catch (err) {
    if (typeof WB.showToast === 'function') {
      WB.showToast('⚠️ Ошибка импорта PDF: ' + (err?.message || 'проверьте файл'), 3600, 'error');
    }
  }
};

WB.openPdfUrlInEditor = async function(url, title = 'Кодификатор ЕГЭ 2027 — Физика.pdf') {
  try {
    if (typeof WB.showToast === 'function') WB.showToast('📕 Открываем PDF документ в редакторе...', 3500);
    const resp = await fetch(url);
    const buf = await resp.arrayBuffer();
    const pages = await WB.renderPdfBufferToPages(buf, 28);
    if (!pages || pages.length === 0) return;

    const dims = await WB.measureImageDimensions(pages[0]);
    const fit = WB.calcAspectFitBox(dims.width, dims.height, 480, 560, 140);
    const center = WB.toWorld(window.innerWidth / 2, window.innerHeight / 2);
    const widgetObj = WB.addWidget('image', {
      x: center.x - fit.w / 2,
      y: center.y - (fit.h + 56) / 2,
      w: fit.w,
      h: fit.h + 56,
      src: pages[0],
      isPdf: true,
      pdfTitle: title,
      pdfPages: pages,
      currentPage: 0
    });

    WB.openPdfEditorForWidget(widgetObj.id);
  } catch (err) {
    if (typeof WB.showToast === 'function') {
      WB.showToast('⚠️ Не удалось открыть PDF: ' + (err?.message || 'ошибка сети'), 3600, 'error');
    }
  }
};

// --- ВСТРОЕННЫЙ МНОГОСТРАНИЧНЫЙ PDF-РЕДАКТОР ---
WB.openPdfEditorForWidget = function(widgetId, opts) {
  const w = WB.state.widgets.find(item => item.id === widgetId);
  if (!w) return;

  const isDocx = !!(w.isDocx || w.docKind === 'docx' || w.docType === 'docx' || /\.docx$/i.test(w.pdfTitle || ''));
  const isPhoto = !isDocx && Boolean(w.isPhoto || w.docType === 'photo' || (w.type === 'image' && !w.isPdf));

  WB.pdfEditor.isOpen = true;
  WB.pdfEditor.isDocx = isDocx;
  WB.pdfEditor.isPhoto = isPhoto;
  WB.pdfEditor.docxDirty = false;
  WB.pdfEditor.targetWidgetId = w.id;
  WB.pdfEditor.title = w.pdfTitle || (isDocx ? 'Документ.docx' : (isPhoto ? 'Фото.png' : 'Документ PDF'));
  WB.pdfEditor.pages = Array.isArray(w.pdfPages) && w.pdfPages.length > 0 ? w.pdfPages.slice() : [w.src];
  WB.pdfEditor.docxPages = isDocx
    ? WB.pdfEditor.pages.map((_, i) => {
        const existing = Array.isArray(w.docxPages) ? w.docxPages[i] : null;
        return existing ? Object.assign({}, existing) : { kind: 'docx', html: '<p><br></p>' };
      })
    : null;
  WB.pdfEditor.rowCounts = WB.normalizePdfPageRows(WB.pdfEditor.pages.length, w.pdfRowCounts).map(r => r.length);
  WB.pdfEditor.pageDims = {};
  const requestedPage = (opts && typeof opts.pageIdx === 'number') ? opts.pageIdx : (w.currentPage || 0);
  WB.pdfEditor.currentPage = Math.max(0, Math.min(requestedPage, WB.pdfEditor.pages.length - 1));
  WB.pdfEditor.zoom = (opts && typeof opts.zoom === 'number' && opts.zoom > 0.2) ? opts.zoom : 1.0;
  WB.pdfEditor.cropBox = null;
  WB.pdfEditor.cropPageIdx = null;
  WB.pdfEditor.activeDragPageIdx = null;
  WB.pdfEditor.activeOverlay = null;
  WB.pdfEditor.didErase = false;
  WB.pdfEditor.selectedStroke = null;
  WB.pdfEditor.pendingInsertTarget = null;
  WB.pdfEditor.strokesByPage = w.pdfStrokesByPage ? WB.cloneAllPdfStrokesByPage(w.pdfStrokesByPage) : {};
  WB.pdfEditor.widgetsByPage = w.pdfWidgetsByPage ? WB.cloneAllPdfWidgetsByPage(w.pdfWidgetsByPage) : {};
  if (!WB.pdfEditor.blankPageStyle) WB.pdfEditor.blankPageStyle = 'grid';

  document.body.classList.add('pdf-editor-open');
  if (typeof WB.closeAllDropdowns === 'function') WB.closeAllDropdowns();

  const modal = document.getElementById('pdfEditorModal');
  const titleEl = document.getElementById('pdfEditorTitle');
  const fmtBadge = document.getElementById('pdfEditorFormatBadge');
  if (titleEl) titleEl.textContent = WB.pdfEditor.title;
  if (fmtBadge) {
    fmtBadge.textContent = isDocx ? 'DOCX' : (isPhoto ? 'ФОТО' : 'PDF');
    fmtBadge.style.background = isDocx ? '#2563eb' : (isPhoto ? '#0d9488' : '#dc2626');
  }
  if (modal) modal.style.display = 'flex';

  document.getElementById('pdfThumbsPopover')?.classList.remove('open');
  document.getElementById('pdfAddPagePopover')?.classList.remove('open');
  const pdfSbWrap = document.getElementById('pdfStyleBlockWrap');
  if (pdfSbWrap) {
    pdfSbWrap.classList.remove('expanded');
    document.getElementById('pdfStyleCompactToggle')?.setAttribute('aria-expanded', 'false');
  }

  WB.resetPdfHistory();
  WB.syncPdfBlankPageStyleUI();
  WB.setPdfEditorTool(isDocx ? 'word' : (WB.userRole === 'student' ? 'draw' : 'crop'));
  WB.renderPdfEditorThumbnails();
  WB.renderAllPdfPages(true);
  if (typeof WB.updateWordRibbonVisibility === 'function') WB.updateWordRibbonVisibility();
  if (typeof WB.syncPhotoRibbonUI === 'function') WB.syncPhotoRibbonUI();
  if (!(opts && opts.silentSync) && typeof WB.broadcastPeerViewport === 'function') {
    WB.broadcastPeerViewport(true);
  }
};

WB.closePdfEditor = function(opts) {
  WB.syncPdfAnnotationsToWidget();
  if (WB.pdfEditor.isDocx && typeof WB.syncActiveDocxLayersToState === 'function') {
    WB.syncActiveDocxLayersToState({ silentSync: true });
    WB.saveToStorage();
  }
  WB.pdfEditor.isOpen = false;
  WB.pdfEditor.isDocx = false;
  WB.pdfEditor.isPhoto = false;
  WB.pdfEditor.docxDirty = false;
  WB.pdfEditor.isDragging = false;
  WB.pdfEditor.didErase = false;
  WB.pdfEditor.currentStroke = null;
  WB.pdfEditor.activeOverlay = null;
  WB.pdfEditor.activeDragPageIdx = null;
  WB.pdfEditor.selectedStroke = null;
  WB.pdfEditor.handPan = null;
  WB.pdfEditor.pendingInsertTarget = null;
  if (WB.pdfEditor.laserRaf) {
    cancelAnimationFrame(WB.pdfEditor.laserRaf);
    WB.pdfEditor.laserRaf = null;
  }
  WB.pdfEditor.laserPoints = [];

  document.body.classList.remove('pdf-editor-open');
  document.getElementById('pdfThumbsPopover')?.classList.remove('open');
  document.getElementById('pdfAddPagePopover')?.classList.remove('open');
  const wordWrap = document.getElementById('wordRibbonWrap');
  if (wordWrap) wordWrap.style.display = 'none';
  const rotLeftBtn = document.getElementById('photoRotateLeftBtn');
  if (rotLeftBtn) rotLeftBtn.style.display = 'none';
  const rotRightBtn = document.getElementById('photoRotateRightBtn');
  if (rotRightBtn) rotRightBtn.style.display = 'none';
  const photoCropBtn = document.getElementById('photoCropApplyBtn');
  if (photoCropBtn) photoCropBtn.style.display = 'none';
  const floatLayer = document.getElementById('pdfFloatingToolsLayer');
  if (floatLayer) floatLayer.innerHTML = '';
  const pdfSbWrap = document.getElementById('pdfStyleBlockWrap');
  if (pdfSbWrap) {
    pdfSbWrap.classList.remove('expanded');
    document.getElementById('pdfStyleCompactToggle')?.setAttribute('aria-expanded', 'false');
  }
  const modal = document.getElementById('pdfEditorModal');
  if (modal) modal.style.display = 'none';
  if (typeof WB.updateSelectionBounds === 'function') {
    WB.updateSelectionBounds();
  }
  if (typeof WB.setTool === 'function') {
    WB.setTool(WB.currentTool || 'pen');
  }
  if (!(opts && opts.silentSync) && typeof WB.broadcastPeerViewport === 'function') {
    WB.broadcastPeerViewport(true);
  }
};
WB.closePdfEditorModal = WB.closePdfEditor;

WB.prevPdfEditorPage = function() {
  if (WB.pdfEditor.currentPage > 0) {
    WB.selectPdfEditorPage(WB.pdfEditor.currentPage - 1, true);
  }
};

WB.nextPdfEditorPage = function() {
  if (WB.pdfEditor.currentPage < WB.pdfEditor.pages.length - 1) {
    WB.selectPdfEditorPage(WB.pdfEditor.currentPage + 1, true);
  }
};

WB.positionPdfPopover = function(pop, triggerEl) {
  if (!pop || !triggerEl) return;
  if (pop.parentElement !== document.body) {
    document.body.appendChild(pop);
  }
  const tr = triggerEl.getBoundingClientRect();
  const pw = pop.offsetWidth || 240;
  const ph = pop.offsetHeight || 226;
  const vw = window.innerWidth || 1024;
  const vh = window.innerHeight || 700;
  const left = Math.max(10, Math.min(vw - pw - 10, tr.left + tr.width / 2 - pw / 2));
  let top = tr.bottom + 8;
  if (top + ph > vh - 76) {
    top = Math.max(12, tr.top - ph - 8);
  }
  pop.style.position = 'fixed';
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
  pop.style.transform = 'none';
  pop.style.zIndex = '195';
};

WB.togglePdfThumbsPopover = function(e) {
  if (e) e.stopPropagation();
  document.getElementById('pdfAddPagePopover')?.classList.remove('open');
  const pop = document.getElementById('pdfThumbsPopover');
  if (!pop) return;
  const willOpen = !pop.classList.contains('open');
  pop.classList.toggle('open', willOpen);
  if (willOpen) {
    const trigger = e?.currentTarget || document.getElementById('pdfPageSelectBtn');
    WB.positionPdfPopover(pop, trigger);
  }
};

WB.openPdfAddPagePopoverAt = function(triggerEl, targetIdx, placement = 'below', e) {
  if (e) e.stopPropagation();
  document.getElementById('pdfThumbsPopover')?.classList.remove('open');
  const pop = document.getElementById('pdfAddPagePopover');
  if (!pop) return;

  const sameTarget =
    pop.classList.contains('open') &&
    WB.pdfEditor.pendingInsertTarget &&
    WB.pdfEditor.pendingInsertTarget.pageIdx === targetIdx &&
    WB.pdfEditor.pendingInsertTarget.placement === placement;

  if (sameTarget) {
    pop.classList.remove('open');
    WB.pdfEditor.pendingInsertTarget = null;
    return;
  }

  WB.pdfEditor.pendingInsertTarget = {
    pageIdx: typeof targetIdx === 'number' ? targetIdx : WB.pdfEditor.currentPage,
    placement: placement === 'side' ? 'side' : 'below'
  };
  const hdr = document.getElementById('pdfAddPagePopoverTitle');
  if (hdr) {
    hdr.textContent = placement === 'side' ? 'Новая страница сбоку' : 'Новая страница ниже';
  }
  WB.syncPdfBlankPageStyleUI();
  pop.classList.add('open');
  WB.positionPdfPopover(pop, triggerEl);
};

WB.syncPdfBlankPageStyleUI = function() {
  const activeStyle = WB.pdfEditor.blankPageStyle || 'grid';
  document.querySelectorAll('#pdfAddPagePopover .pdf-add-page-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.blankStyle === activeStyle);
  });
};

WB.generateBlankPdfPageDataUrl = function(style = 'grid', width = 892, height = 1262) {
  const w = Math.max(320, Math.round(Number(width) || 892));
  const h = Math.max(320, Math.round(Number(height) || 1262));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  if (style === 'grid') {
    const step = 28;
    ctx.strokeStyle = '#d8e3ef';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = step; x < w; x += step) {
      const px = Math.round(x) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
    }
    for (let y = step; y < h; y += step) {
      const py = Math.round(y) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
    }
    ctx.stroke();
  } else if (style === 'ruled') {
    const step = 34;
    const topMargin = 68;
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = topMargin; y < h - 32; y += step) {
      const py = Math.round(y) + 0.5;
      ctx.moveTo(32, py);
      ctx.lineTo(w - 32, py);
    }
    ctx.stroke();
  }

  return canvas.toDataURL('image/png');
};

WB.insertBlankPdfPageFromMenu = function(style) {
  WB.pdfEditor.blankPageStyle = style || 'grid';
  document.getElementById('pdfAddPagePopover')?.classList.remove('open');
  const pending = WB.pdfEditor.pendingInsertTarget || { pageIdx: WB.pdfEditor.currentPage, placement: 'below' };
  WB.pdfEditor.pendingInsertTarget = null;
  WB.syncPdfBlankPageStyleUI();
  return WB.insertBlankPdfPage(pending.pageIdx, WB.pdfEditor.blankPageStyle, pending.placement);
};

WB.insertBlankPdfPage = async function(afterIdx, style, placement = 'below') {
  const targetAfter = typeof afterIdx === 'number'
    ? Math.max(0, Math.min(afterIdx, Math.max(0, WB.pdfEditor.pages.length - 1)))
    : WB.pdfEditor.currentPage;
  const pageStyle = style || WB.pdfEditor.blankPageStyle || 'grid';
  const mode = placement === 'side' ? 'side' : 'below';
  WB.pdfEditor.blankPageStyle = pageStyle;

  let refDims = WB.pdfEditor.pageDims[targetAfter];
  if (!refDims && WB.pdfEditor.pages[targetAfter]) {
    refDims = await WB.measureImageDimensions(WB.pdfEditor.pages[targetAfter]);
  }
  const pageW = (refDims && refDims.width) || 892;
  const pageH = (refDims && refDims.height) || 1262;
  const blankUrl = WB.generateBlankPdfPageDataUrl(pageStyle, pageW, pageH);

  if (WB.pdfEditor.isDocx && typeof WB.syncActiveDocxLayersToState === 'function') {
    WB.syncActiveDocxLayersToState({ silentSync: true });
  }
  const rowRes = WB.insertPdfPageInRows(WB.pdfEditor.pages.length, WB.pdfEditor.rowCounts, targetAfter, mode);
  const insertIdx = rowRes.insertIdx;
  WB.pdfEditor.pages.splice(insertIdx, 0, blankUrl);
  if (WB.pdfEditor.isDocx && Array.isArray(WB.pdfEditor.docxPages)) {
    WB.pdfEditor.docxPages.splice(insertIdx, 0, { kind: 'blank', blankStyle: pageStyle });
  }
  WB.pdfEditor.rowCounts = rowRes.rowCounts;
  WB.pdfEditor.strokesByPage = WB.shiftPdfStrokesOnInsert(WB.pdfEditor.strokesByPage, insertIdx);
  WB.pdfEditor.widgetsByPage = WB.shiftPdfStrokesOnInsert(WB.pdfEditor.widgetsByPage, insertIdx);
  WB.pdfEditor.pageDims = WB.shiftPdfStrokesOnInsert(WB.pdfEditor.pageDims, insertIdx);
  WB.pdfEditor.pageDims[insertIdx] = { width: pageW, height: pageH };
  WB.pdfEditor.currentPage = insertIdx;
  WB.pdfEditor.cropBox = null;
  WB.pdfEditor.cropPageIdx = null;
  WB.pdfEditor.selectedStroke = null;
  WB.updatePdfCropButtons(false);

  const w = WB.state.widgets.find(item => item.id === WB.pdfEditor.targetWidgetId);
  if (w) {
    w.pdfPages = WB.pdfEditor.pages.slice();
    w.pdfRowCounts = WB.pdfEditor.rowCounts.slice();
    w.pdfStrokesByPage = WB.cloneAllPdfStrokesByPage(WB.pdfEditor.strokesByPage);
    w.pdfWidgetsByPage = WB.cloneAllPdfWidgetsByPage(WB.pdfEditor.widgetsByPage);
    if (WB.pdfEditor.isDocx && Array.isArray(WB.pdfEditor.docxPages)) {
      w.docxPages = WB.pdfEditor.docxPages.map(p => p ? Object.assign({}, p) : null);
    }
    w.currentPage = insertIdx;
    w.src = blankUrl;
    WB.renderWidgetsDOM();
    if (typeof WB.scheduleSaveToStorage === 'function') WB.scheduleSaveToStorage(600);
    else WB.saveToStorage();
    if (typeof WB.syncDiffBaselineFromCurrentState === 'function') WB.syncDiffBaselineFromCurrentState();
    if (typeof WB.broadcastPdfEvent === 'function' && WB.pdfEditor.targetWidgetId) {
      WB.broadcastPdfEvent('pdf_page_insert', {
        widgetId: WB.pdfEditor.targetWidgetId,
        afterIdx: targetAfter,
        insertIdx,
        style: pageStyle,
        placement: mode,
        pageW,
        pageH,
        rowCounts: WB.pdfEditor.rowCounts.slice()
      });
    }
    if (typeof WB.scheduleRoomServerPush === 'function') WB.scheduleRoomServerPush(1000);
  }
  if (typeof WB.updateWordRibbonVisibility === 'function') WB.updateWordRibbonVisibility();

  WB.pushPdfHistorySnapshot();
  WB.syncPdfBlankPageStyleUI();
  WB.renderPdfEditorThumbnails();
  WB.renderAllPdfPages(false);
  requestAnimationFrame(() => WB.scrollPdfPageIntoView(insertIdx, true));

  if (typeof WB.showToast === 'function') {
    const posLabel = mode === 'side' ? 'сбоку' : 'снизу';
    WB.showToast(`📄 Добавлена страница ${insertIdx + 1} (${WB.getPdfBlankPageStyleLabel(pageStyle)}, ${posLabel})`, 2400, 'success');
  }
};

WB.confirmDeletePdfPage = function(pageIdx, e) {
  if (e) e.stopPropagation();
  const total = WB.pdfEditor.pages.length;
  if (total <= 1) {
    if (typeof WB.showToast === 'function') {
      WB.showToast('ℹ️ Нельзя удалить единственную страницу документа', 2400);
    }
    return;
  }
  const safeIdx = Math.max(0, Math.min(Number(pageIdx) || 0, total - 1));
  if (typeof WB.openConfirmModal === 'function') {
    WB.openConfirmModal({
      title: 'Удалить страницу?',
      message: `Страница №${safeIdx + 1} и все пометки на ней будут удалены. При необходимости действие можно отменить (Ctrl+Z).`,
      confirmLabel: 'Удалить',
      onConfirm: () => WB.deletePdfPage(safeIdx)
    });
  } else {
    WB.deletePdfPage(safeIdx);
  }
};

WB.deletePdfPage = function(pageIdx) {
  const total = WB.pdfEditor.pages.length;
  if (total <= 1) return;
  const safeIdx = Math.max(0, Math.min(Number(pageIdx) || 0, total - 1));

  const res = WB.removePdfPageFromRows(total, WB.pdfEditor.rowCounts, safeIdx);
  if (!res.removed) return;

  if (WB.pdfEditor.isDocx && typeof WB.syncActiveDocxLayersToState === 'function') {
    WB.syncActiveDocxLayersToState({ silentSync: true });
  }
  WB.pdfEditor.pages.splice(safeIdx, 1);
  if (WB.pdfEditor.isDocx && Array.isArray(WB.pdfEditor.docxPages)) {
    WB.pdfEditor.docxPages.splice(safeIdx, 1);
  }
  WB.pdfEditor.rowCounts = res.rowCounts;
  WB.pdfEditor.strokesByPage = WB.shiftPdfRecordOnDelete(WB.pdfEditor.strokesByPage, safeIdx);
  WB.pdfEditor.widgetsByPage = WB.shiftPdfRecordOnDelete(WB.pdfEditor.widgetsByPage, safeIdx);
  WB.pdfEditor.pageDims = WB.shiftPdfRecordOnDelete(WB.pdfEditor.pageDims, safeIdx);
  WB.pdfEditor.currentPage = res.nextActiveIdx;
  WB.pdfEditor.cropBox = null;
  WB.pdfEditor.cropPageIdx = null;
  WB.pdfEditor.selectedStroke = null;
  WB.updatePdfCropButtons(false);

  const w = WB.state.widgets.find(item => item.id === WB.pdfEditor.targetWidgetId);
  if (w) {
    w.pdfPages = WB.pdfEditor.pages.slice();
    w.pdfRowCounts = WB.pdfEditor.rowCounts.slice();
    w.pdfStrokesByPage = WB.cloneAllPdfStrokesByPage(WB.pdfEditor.strokesByPage);
    w.pdfWidgetsByPage = WB.cloneAllPdfWidgetsByPage(WB.pdfEditor.widgetsByPage);
    if (WB.pdfEditor.isDocx && Array.isArray(WB.pdfEditor.docxPages)) {
      w.docxPages = WB.pdfEditor.docxPages.map(p => p ? Object.assign({}, p) : null);
    }
    w.currentPage = WB.pdfEditor.currentPage;
    w.src = WB.pdfEditor.pages[WB.pdfEditor.currentPage] || w.src;
    WB.renderWidgetsDOM();
    if (typeof WB.scheduleSaveToStorage === 'function') WB.scheduleSaveToStorage(600);
    else WB.saveToStorage();
    if (typeof WB.syncDiffBaselineFromCurrentState === 'function') WB.syncDiffBaselineFromCurrentState();
    if (typeof WB.broadcastPdfEvent === 'function' && WB.pdfEditor.targetWidgetId) {
      WB.broadcastPdfEvent('pdf_page_delete', {
        widgetId: WB.pdfEditor.targetWidgetId,
        pageIdx: safeIdx,
        rowCounts: WB.pdfEditor.rowCounts.slice()
      });
    }
    if (typeof WB.scheduleRoomServerPush === 'function') WB.scheduleRoomServerPush(1000);
  }
  if (typeof WB.updateWordRibbonVisibility === 'function') WB.updateWordRibbonVisibility();

  WB.pushPdfHistorySnapshot();
  WB.renderPdfEditorThumbnails();
  WB.renderAllPdfPages(false);
  if (typeof WB.showToast === 'function') {
    WB.showToast(`🗑️ Страница ${safeIdx + 1} удалена`, 2200);
  }
};

WB.setPdfActivePageMeta = function(index) {
  const total = WB.pdfEditor.pages.length;
  if (total === 0) return;
  const cur = Math.max(0, Math.min(index, total - 1));
  WB.pdfEditor.currentPage = cur;

  const pageLabel = document.getElementById('pdfEditorPageIndicator');
  if (pageLabel) pageLabel.textContent = `Стр. ${cur + 1} из ${total}`;

  document.querySelectorAll('#pdfPagesStack .pdf-page-card').forEach(card => {
    card.classList.toggle('active-page', Number(card.dataset.pageIdx) === cur);
  });
  document.querySelectorAll('#pdfEditorThumbs .pdf-thumb-item').forEach((item, idx) => {
    item.classList.toggle('active', idx === cur);
  });

  const w = WB.state.widgets.find(item => item.id === WB.pdfEditor.targetWidgetId);
  if (w && w.currentPage !== cur) {
    w.currentPage = cur;
    w.src = WB.pdfEditor.pages[cur];
    WB.renderWidgetsDOM();
    WB.saveToStorage();
  }
  if (WB.pdfEditor.isPhoto && typeof WB.syncPhotoRibbonUI === 'function') {
    WB.syncPhotoRibbonUI();
  }
};

WB.scrollPdfPageIntoView = function(index, smooth = true) {
  const card = document.querySelector(`#pdfPagesStack .pdf-page-card[data-page-idx="${index}"]`);
  if (card && typeof card.scrollIntoView === 'function') {
    card.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start', inline: 'nearest' });
  }
};

WB.applyPdfZoomToAllPages = function() {
  const zoomLabel = document.getElementById('pdfZoomLabel');
  if (zoomLabel) zoomLabel.textContent = `${Math.round(WB.pdfEditor.zoom * 100)}%`;

  document.querySelectorAll('#pdfPagesStack .pdf-canvas-stage').forEach(stage => {
    const idx = Number(stage.dataset.pageIdx);
    const dims = WB.pdfEditor.pageDims[idx];
    if (!dims) return;
    const cssW = Math.max(120, Math.round(dims.width * WB.pdfEditor.zoom));
    const cssH = Math.max(120, Math.round(dims.height * WB.pdfEditor.zoom));
    stage.style.width = `${cssW}px`;
    stage.style.height = `${cssH}px`;
    const wLayer = stage.querySelector('.pdf-page-widgets-layer');
    if (wLayer) {
      wLayer.style.width = `${dims.width}px`;
      wLayer.style.height = `${dims.height}px`;
      wLayer.style.transform = `scale(${WB.pdfEditor.zoom})`;
    }
    const docxLayer = stage.querySelector('.docx-word-layer');
    if (docxLayer) {
      docxLayer.style.width = `${dims.width}px`;
      docxLayer.style.minHeight = `${dims.height}px`;
      docxLayer.style.transform = `scale(${WB.pdfEditor.zoom})`;
    }
  });

  if (WB.pdfEditor.cropBox && WB.pdfEditor.cropPageIdx !== null) {
    WB.updatePdfCropButtons(true);
  }
};

WB.changePdfEditorZoom = function(delta) {
  const next = Math.min(2.5, Math.max(0.4, +(WB.pdfEditor.zoom + delta).toFixed(2)));
  if (next === WB.pdfEditor.zoom) return;
  WB.pdfEditor.zoom = next;
  WB.applyPdfZoomToAllPages();
  if (typeof WB.showZoomHud === 'function') WB.showZoomHud(WB.pdfEditor.zoom);
};

WB.buildCompositePdfPageCanvas = async function(pageIdx) {
  const strokes = WB.pdfEditor.strokesByPage[pageIdx] || [];
  const widgets = WB.pdfEditor.widgetsByPage[pageIdx] || [];

  // Для DOCX-страниц с живым Word-слоем растеризуем актуальный отредактированный текст + таблицы + пометки
  if (
    WB.pdfEditor.isDocx &&
    Array.isArray(WB.pdfEditor.docxPages) &&
    WB.pdfEditor.docxPages[pageIdx] &&
    WB.pdfEditor.docxPages[pageIdx].kind === 'docx' &&
    typeof WB.renderDocxBlocksToCanvas === 'function' &&
    typeof WB.parseWordHtmlToBlocks === 'function'
  ) {
    const liveLayer = document.querySelector(`#pdfPagesStack .docx-word-layer[data-page-idx="${pageIdx}"]`);
    const html = liveLayer ? liveLayer.innerHTML : (WB.pdfEditor.docxPages[pageIdx].html || '');
    const dims = WB.pdfEditor.pageDims[pageIdx] || { width: 892, height: 1262 };
    const blocks = WB.parseWordHtmlToBlocks(html);
    const out = await WB.renderDocxBlocksToCanvas(blocks, dims.width, dims.height);
    const ctx = out.getContext('2d');
    WB.drawPdfStrokeList(ctx, strokes, true);
    WB.drawPdfWidgetsOnCanvas(ctx, widgets);
    return out;
  }

  return new Promise((resolve) => {
    const src = WB.pdfEditor.pages[pageIdx];
    const domBase = document.querySelector(`#pdfPagesStack .pdf-page-base[data-page-idx="${pageIdx}"]`);

    if (domBase && domBase.width > 0 && domBase.height > 0) {
      const out = document.createElement('canvas');
      out.width = domBase.width;
      out.height = domBase.height;
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(domBase, 0, 0);
      WB.drawPdfStrokeList(ctx, strokes, true);
      WB.drawPdfWidgetsOnCanvas(ctx, widgets);
      return resolve(out);
    }

    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => {
      const out = document.createElement('canvas');
      out.width = img.naturalWidth || img.width || 892;
      out.height = img.naturalHeight || img.height || 1262;
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(img, 0, 0, out.width, out.height);
      WB.drawPdfStrokeList(ctx, strokes, true);
      WB.drawPdfWidgetsOnCanvas(ctx, widgets);
      resolve(out);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
};

WB.downloadEditedPdf = async function() {
  const total = WB.pdfEditor.pages.length;
  if (total === 0) return;
  if (typeof WB.showToast === 'function') {
    WB.showToast(`📕 Формируем PDF (${total} стр.)...`, 2000);
  }
  const canvases = [];
  for (let i = 0; i < total; i++) {
    const c = await WB.buildCompositePdfPageCanvas(i);
    if (c) canvases.push(c);
  }
  if (canvases.length === 0) return;
  const pdfBlob = WB.buildMultiPagePDFBlob(canvases);
  if (!pdfBlob) return;
  const baseName = (WB.pdfEditor.title || 'document').replace(/\.pdf$/i, '');
  WB.triggerDownload(pdfBlob, WB.sanitizeExportFilename(baseName, 'pdf'));
};
WB.downloadCurrentPdfPage = WB.downloadEditedPdf;

WB.updatePdfCropButtons = function(show) {
  const cropActionBtn = document.getElementById('pdfCropConfirmBtn');
  if (cropActionBtn) cropActionBtn.style.display = show ? 'inline-flex' : 'none';
  const photoCropBtn = document.getElementById('photoCropApplyBtn');
  if (photoCropBtn) photoCropBtn.style.display = (show && WB.pdfEditor.isPhoto) ? 'inline-flex' : 'none';

  document.querySelectorAll('#pdfPagesStack .pdf-floating-crop-btn').forEach(btn => {
    btn.style.display = 'none';
  });

  if (!show || !WB.pdfEditor.cropBox || WB.pdfEditor.cropPageIdx === null) return;
  const pageIdx = WB.pdfEditor.cropPageIdx;
  const stage = document.querySelector(`#pdfPagesStack .pdf-canvas-stage[data-page-idx="${pageIdx}"]`);
  const overlay = stage ? stage.querySelector('.pdf-page-overlay') : null;
  const floatBtn = stage ? stage.querySelector('.pdf-floating-crop-btn') : null;
  if (!overlay || !floatBtn) return;

  const b = WB.pdfEditor.cropBox;
  const r = overlay.getBoundingClientRect();
  const scaleX = (r.width || 1) / (overlay.width || 1);
  const scaleY = (r.height || 1) / (overlay.height || 1);
  floatBtn.style.display = 'inline-flex';
  floatBtn.style.left = Math.max(8, Math.round(b.x * scaleX)) + 'px';
  floatBtn.style.top = Math.max(8, Math.round((b.y + b.h) * scaleY + 8)) + 'px';
};

WB.togglePdfStyleBlock = function(event) {
  if (event) event.stopPropagation();
  const wrap = document.getElementById('pdfStyleBlockWrap');
  if (!wrap) return;
  const willExpand = !wrap.classList.contains('expanded');
  document.getElementById('pdfThumbsPopover')?.classList.remove('open');
  document.getElementById('pdfAddPagePopover')?.classList.remove('open');
  wrap.classList.toggle('expanded', willExpand);
  document.getElementById('pdfStyleCompactToggle')?.setAttribute('aria-expanded', willExpand ? 'true' : 'false');
};

WB.syncPdfStyleUI = function() {
  const isHL = WB.pdfEditor.tool === 'highlighter';
  const color = isHL ? (WB.pdfEditor.highlighterColor || '#facc15') : (WB.pdfEditor.drawColor || '#ef4444');
  const size = isHL ? (WB.pdfEditor.highlighterSize || 22) : (WB.pdfEditor.drawSize || 4);
  const lineStyle = isHL ? (WB.pdfEditor.highlighterLineStyle || 'solid') : (WB.pdfEditor.drawLineStyle || 'solid');

  const lineEl = document.getElementById('pdfStyleSummaryLinePreview');
  const dot = document.getElementById('pdfStyleSummaryColorDot');
  const sumSize = document.getElementById('pdfStyleSummarySize');
  if (lineEl && typeof WB.getLineStylePreviewSvg === 'function') {
    lineEl.innerHTML = WB.getLineStylePreviewSvg(lineStyle);
  }
  if (dot) dot.style.background = color;
  if (sumSize) sumSize.textContent = `${size}px`;

  document.querySelectorAll('#pdfStyleBlock .pdf-line-style-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.pdfLineStyle === lineStyle);
  });
  document.querySelectorAll('#pdfStyleBlock .pdf-color-swatch').forEach(sw => {
    sw.classList.toggle('active', (sw.dataset.color || '').toLowerCase() === color.toLowerCase());
  });
  const picker = document.getElementById('pdfStyleColorPicker');
  if (picker) picker.value = color;
  const slider = document.getElementById('pdfStyleSizePicker');
  const lbl = document.getElementById('pdfStyleSizeLabel');
  if (slider) slider.value = String(size);
  if (lbl) lbl.textContent = `${size}px`;
};

WB.setPdfLineStyle = function(style) {
  const valid = ['solid', 'dashed', 'dotted', 'dashdot'];
  const next = valid.includes(style) ? style : 'solid';
  if (WB.pdfEditor.tool === 'highlighter') {
    WB.pdfEditor.highlighterLineStyle = next;
  } else {
    WB.pdfEditor.drawLineStyle = next;
    if (WB.pdfEditor.tool !== 'draw' && !WB.PDF_SHAPE_TOOLS.has(WB.pdfEditor.tool)) {
      WB.setPdfEditorTool('draw');
    }
  }
  WB.syncPdfStyleUI();
};

WB.selectPdfColor = function(color, el) {
  const safeColor = color || '#ef4444';
  if (WB.pdfEditor.tool === 'highlighter') {
    WB.pdfEditor.highlighterColor = safeColor;
  } else {
    WB.pdfEditor.drawColor = safeColor;
    if (WB.pdfEditor.tool !== 'draw' && !WB.PDF_SHAPE_TOOLS.has(WB.pdfEditor.tool)) {
      WB.setPdfEditorTool('draw');
    }
  }
  WB.syncPdfStyleUI();
  if (el) {
    document.querySelectorAll('#pdfStyleBlock .pdf-color-swatch').forEach(s => s.classList.remove('active'));
    el.classList.add('active');
  }
};

WB.updatePdfSizeUI = function(val) {
  const num = Math.max(2, Math.min(36, Number(val) || 4));
  if (WB.pdfEditor.tool === 'highlighter') {
    WB.pdfEditor.highlighterSize = num;
  } else {
    WB.pdfEditor.drawSize = num;
    if (WB.pdfEditor.tool !== 'draw' && !WB.PDF_SHAPE_TOOLS.has(WB.pdfEditor.tool)) {
      WB.setPdfEditorTool('draw');
    }
  }
  WB.syncPdfStyleUI();
};

WB.syncPdfBottomDockActive = function(pdfTool) {
  const dock = document.getElementById('bottomDock');
  if (!dock) return;
  dock.querySelectorAll('.tool-btn').forEach(b => {
    if (b.id !== 'autoShapeBtn' && b.id !== 'snapGridBtn') {
      b.classList.remove('active');
    }
  });
  const dockIdMap = {
    select: 'selectBtn',
    hand: 'handBtn',
    draw: 'penBtn',
    highlighter: 'highlighterBtn',
    eraser: 'eraserBtn',
    laser: 'laserBtn'
  };
  const targetId = dockIdMap[pdfTool];
  if (targetId) {
    document.getElementById(targetId)?.classList.add('active');
  }
  const shapesMenuBtn = document.getElementById('shapesMenuBtn');
  const shapesMenuBtnLabel = document.getElementById('shapesMenuBtnLabel');
  if (shapesMenuBtn) {
    if (WB.PDF_SHAPE_TOOLS.has(pdfTool)) {
      shapesMenuBtn.classList.add('active');
    } else if (shapesMenuBtnLabel) {
      shapesMenuBtnLabel.textContent = 'Фигуры';
    }
  }
};

WB.setPdfEditorTool = function(tool) {
  const normalized = tool === 'pen' ? 'draw' : tool;
  WB.pdfEditor.tool = normalized;
  WB.pdfEditor.cropBox = null;
  WB.pdfEditor.cropPageIdx = null;
  if (normalized !== 'select') WB.pdfEditor.selectedStroke = null;

  document.getElementById('pdfToolCropBtn')?.classList.toggle('active', normalized === 'crop');
  WB.syncPdfBottomDockActive(normalized);

  const isWordEditing = normalized === 'word';
  const cursor = normalized === 'eraser'
    ? 'cell'
    : (normalized === 'hand' ? 'grab' : ((normalized === 'select' || isWordEditing) ? 'default' : 'crosshair'));
  document.querySelectorAll('#pdfPagesStack .pdf-page-overlay').forEach(ov => {
    ov.style.cursor = cursor;
    ov.style.pointerEvents = isWordEditing ? 'none' : 'auto';
  });
  document.querySelectorAll('#pdfPagesStack .docx-word-layer').forEach(layer => {
    layer.classList.toggle('editing-word', isWordEditing);
  });
  document.querySelectorAll('#pdfPagesStack .pdf-page-widgets-layer').forEach(layer => {
    layer.classList.toggle('interactive', normalized === 'select');
  });

  if (typeof WB.syncWordRibbonState === 'function') WB.syncWordRibbonState();
  WB.syncPdfStyleUI();
  WB.updatePdfCropButtons(false);
  WB.drawAllPdfEditorOverlays();
};

WB.clearCurrentPdfPageStrokes = function(kind) {
  const idx = WB.pdfEditor.currentPage;
  const list = WB.pdfEditor.strokesByPage[idx] || [];
  const before = list.length;
  if (kind === 'highlighter') {
    WB.pdfEditor.strokesByPage[idx] = list.filter(s => !s.isHighlighter);
  } else if (kind === 'student') {
    WB.pdfEditor.strokesByPage[idx] = list.filter(s => s.authorRole !== 'student');
  } else if (kind === 'teacher') {
    if (WB.userRole === 'student') return;
    WB.pdfEditor.strokesByPage[idx] = list.filter(s => (s.authorRole || 'teacher') !== 'teacher');
  } else {
    if (WB.userRole === 'student') return;
    WB.pdfEditor.strokesByPage[idx] = [];
  }
  WB.pdfEditor.selectedStroke = null;
  if ((WB.pdfEditor.strokesByPage[idx] || []).length !== before) {
    WB.pushPdfHistorySnapshot();
    if (typeof WB.broadcastPdfEvent === 'function' && WB.pdfEditor.targetWidgetId) {
      WB.broadcastPdfEvent('pdf_strokes_replace', {
        widgetId: WB.pdfEditor.targetWidgetId,
        pageIdx: idx,
        strokes: WB.pdfEditor.strokesByPage[idx] || []
      });
    }
  }
  WB.drawPdfEditorOverlayForPage(idx);
  if (typeof WB.closeAllDropdowns === 'function') WB.closeAllDropdowns();
};

WB.selectPdfEditorPage = function(index, scroll = true) {
  if (index < 0 || index >= WB.pdfEditor.pages.length) return;
  document.getElementById('pdfThumbsPopover')?.classList.remove('open');
  WB.setPdfActivePageMeta(index);
  if (scroll) {
    WB.scrollPdfPageIntoView(index, true);
  }
};

WB.renderPdfEditorThumbnails = function() {
  const list = document.getElementById('pdfEditorThumbs');
  if (!list) return;
  list.innerHTML = '';

  WB.pdfEditor.pages.forEach((src, idx) => {
    const item = document.createElement('div');
    item.className = `pdf-thumb-item ${idx === WB.pdfEditor.currentPage ? 'active' : ''}`;
    item.innerHTML = `
      <img class="pdf-thumb-preview" src="${src}" alt="Стр. ${idx + 1}">
      <span>Стр. ${idx + 1}</span>
    `;
    item.addEventListener('click', () => WB.selectPdfEditorPage(idx, true));
    list.appendChild(item);
  });
};

// Виджеты на страницах PDF (Текст, Стикер, Формула LaTeX / Физика ЕГЭ, Таблица)
WB.addPdfPageWidget = function(type, customData = {}) {
  if (!WB.pdfEditor.isOpen) return null;
  if (type === 'timer' || type === 'stopwatch' || type === 'calculator') {
    WB.openPdfFloatingUtility(type);
    return null;
  }

  const pageIdx = WB.pdfEditor.currentPage || 0;
  const dims = WB.pdfEditor.pageDims[pageIdx] || { width: 892, height: 1262 };
  const list = WB.pdfEditor.widgetsByPage[pageIdx] || [];
  const offset = (list.length % 5) * 24;

  let w = 240, h = 90;
  if (type === 'note') { w = 220; h = 170; }
  else if (type === 'text') { w = 260; h = 76; }
  else if (type === 'latex') { w = customData.w || 340; h = customData.h || 118; }
  else if (type === 'table') { w = 380; h = 180; }

  const item = {
    id: 'pw_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    type,
    x: Math.max(24, Math.min(dims.width - w - 24, Math.round(dims.width * 0.5 - w * 0.5 + offset))),
    y: Math.max(24, Math.min(dims.height - h - 24, Math.round(dims.height * 0.25 + offset))),
    w,
    h,
    color: customData.color || (type === 'note' ? '#fef08a' : '#0f172a'),
    text: customData.text ?? (type === 'note' ? 'Заметка...' : 'Текст...'),
    latex: customData.latex || (type === 'latex' ? 'F = m \\cdot a' : null),
    lawTitle: customData.lawTitle || null,
    tableData: type === 'table'
      ? (Array.isArray(customData.tableData)
        ? customData.tableData.map(r => [...r])
        : [['Столбец 1', 'Столбец 2', 'Столбец 3'], ['', '', ''], ['', '', '']])
      : null
  };

  if (!WB.pdfEditor.widgetsByPage[pageIdx]) WB.pdfEditor.widgetsByPage[pageIdx] = [];
  WB.pdfEditor.widgetsByPage[pageIdx].push(item);
  WB.setPdfEditorTool('select');
  WB.renderPdfPageWidgets(pageIdx);
  WB.pushPdfHistorySnapshot();
  if (typeof WB.broadcastPdfEvent === 'function' && WB.pdfEditor.targetWidgetId) {
    WB.broadcastPdfEvent('pdf_widgets_replace', {
      widgetId: WB.pdfEditor.targetWidgetId,
      pageIdx,
      widgets: WB.pdfEditor.widgetsByPage[pageIdx] || []
    });
  }

  if (type === 'text' || type === 'note') {
    requestAnimationFrame(() => {
      const ta = document.querySelector(`.pdf-page-widget[data-widget-id="${item.id}"] textarea`);
      if (ta) { ta.focus(); ta.select(); }
    });
  }
  return item;
};

WB.deletePdfPageWidget = function(pageIdx, widgetId) {
  const list = WB.pdfEditor.widgetsByPage[pageIdx];
  if (!Array.isArray(list)) return;
  const idx = list.findIndex(item => item.id === widgetId);
  if (idx === -1) return;
  list.splice(idx, 1);
  WB.renderPdfPageWidgets(pageIdx);
  WB.pushPdfHistorySnapshot();
  if (typeof WB.broadcastPdfEvent === 'function' && WB.pdfEditor.targetWidgetId) {
    WB.broadcastPdfEvent('pdf_widgets_replace', {
      widgetId: WB.pdfEditor.targetWidgetId,
      pageIdx,
      widgets: WB.pdfEditor.widgetsByPage[pageIdx] || []
    });
  }
};

WB.renderPdfPageWidgets = function(pageIdx) {
  const layer = document.querySelector(`#pdfPagesStack .pdf-page-widgets-layer[data-page-idx="${pageIdx}"]`);
  if (!layer) return;
  layer.innerHTML = '';
  layer.classList.toggle('interactive', WB.pdfEditor.tool === 'select');

  const widgets = WB.pdfEditor.widgetsByPage[pageIdx] || [];
  for (const w of widgets) {
    const el = document.createElement('div');
    el.className = `pdf-page-widget pdf-pw-${w.type}`;
    el.dataset.widgetId = w.id;
    el.style.left = `${w.x}px`;
    el.style.top = `${w.y}px`;
    el.style.width = `${w.w}px`;
    el.style.minHeight = `${w.h}px`;
    if (w.type === 'note') el.style.background = w.color || '#fef08a';

    const bar = document.createElement('div');
    bar.className = 'pdf-pw-bar';
    const titleSpan = document.createElement('span');
    titleSpan.className = 'pdf-pw-title';
    titleSpan.textContent = w.type === 'note' ? 'Стикер'
      : (w.type === 'text' ? 'Текст'
      : (w.type === 'table' ? 'Таблица' : (w.lawTitle || 'Формула')));
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'pdf-pw-del';
    delBtn.title = 'Удалить блок';
    delBtn.setAttribute('aria-label', 'Удалить блок');
    delBtn.textContent = '×';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      WB.deletePdfPageWidget(pageIdx, w.id);
    });
    bar.appendChild(titleSpan);
    bar.appendChild(delBtn);
    el.appendChild(bar);

    // Drag by header bar
    bar.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      e.stopPropagation();
      e.preventDefault();
      const startX = e.clientX, startY = e.clientY;
      const origX = w.x, origY = w.y;
      const z = WB.pdfEditor.zoom || 1;
      let moved = false;
      const onMove = (ev) => {
        const dx = (ev.clientX - startX) / z;
        const dy = (ev.clientY - startY) / z;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
        w.x = Math.max(0, Math.round(origX + dx));
        w.y = Math.max(0, Math.round(origY + dy));
        el.style.left = `${w.x}px`;
        el.style.top = `${w.y}px`;
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (moved) {
          WB.pushPdfHistorySnapshot();
          if (typeof WB.broadcastPdfEvent === 'function' && WB.pdfEditor.targetWidgetId) {
            WB.broadcastPdfEvent('pdf_widgets_replace', {
              widgetId: WB.pdfEditor.targetWidgetId,
              pageIdx,
              widgets: WB.pdfEditor.widgetsByPage[pageIdx] || []
            });
          }
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });

    const body = document.createElement('div');
    body.className = 'pdf-pw-body';
    if (w.type === 'text' || w.type === 'note') {
      const ta = document.createElement('textarea');
      ta.className = 'pdf-pw-textarea';
      ta.value = w.text || '';
      ta.addEventListener('pointerdown', (e) => e.stopPropagation());
      let taSyncTimer = null;
      ta.addEventListener('input', () => {
        w.text = ta.value;
        if (taSyncTimer) clearTimeout(taSyncTimer);
        taSyncTimer = setTimeout(() => {
          WB.syncPdfAnnotationsToWidget();
          if (typeof WB.broadcastPdfEvent === 'function' && WB.pdfEditor.targetWidgetId) {
            WB.broadcastPdfEvent('pdf_widgets_replace', {
              widgetId: WB.pdfEditor.targetWidgetId,
              pageIdx,
              widgets: WB.pdfEditor.widgetsByPage[pageIdx] || []
            });
          }
        }, 220);
      });
      ta.addEventListener('blur', () => {
        WB.pushPdfHistorySnapshot();
        if (typeof WB.broadcastPdfEvent === 'function' && WB.pdfEditor.targetWidgetId) {
          WB.broadcastPdfEvent('pdf_widgets_replace', {
            widgetId: WB.pdfEditor.targetWidgetId,
            pageIdx,
            widgets: WB.pdfEditor.widgetsByPage[pageIdx] || []
          });
        }
      });
      body.appendChild(ta);
    } else if (w.type === 'latex') {
      const box = document.createElement('div');
      box.className = 'pdf-pw-latex';
      if (typeof WB.renderLatexInto === 'function') {
        WB.renderLatexInto(w.latex || '', box);
      } else {
        box.textContent = w.latex || '';
      }
      body.appendChild(box);
    } else if (w.type === 'table' && Array.isArray(w.tableData)) {
      const tbl = document.createElement('table');
      tbl.className = 'pdf-pw-table';
      w.tableData.forEach((row, rIdx) => {
        const tr = document.createElement('tr');
        row.forEach((cellVal, cIdx) => {
          const cell = document.createElement(rIdx === 0 ? 'th' : 'td');
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.value = cellVal || '';
          inp.addEventListener('pointerdown', (e) => e.stopPropagation());
          inp.addEventListener('input', () => { w.tableData[rIdx][cIdx] = inp.value; });
          inp.addEventListener('blur', () => {
            WB.pushPdfHistorySnapshot();
            if (typeof WB.broadcastPdfEvent === 'function' && WB.pdfEditor.targetWidgetId) {
              WB.broadcastPdfEvent('pdf_widgets_replace', {
                widgetId: WB.pdfEditor.targetWidgetId,
                pageIdx,
                widgets: WB.pdfEditor.widgetsByPage[pageIdx] || []
              });
            }
          });
          cell.appendChild(inp);
          tr.appendChild(cell);
        });
        tbl.appendChild(tr);
      });
      body.appendChild(tbl);
    }
    el.appendChild(body);
    layer.appendChild(el);
  }
};

WB.renderAllPdfPageWidgets = function() {
  for (let i = 0; i < WB.pdfEditor.pages.length; i++) {
    WB.renderPdfPageWidgets(i);
  }
};

// Плавающие утилиты (Калькулятор, Таймер, Секундомер) поверх PDF-режима
WB.openPdfFloatingUtility = function(type) {
  const layer = document.getElementById('pdfFloatingToolsLayer');
  if (!layer) return;
  const existing = layer.querySelector(`.pdf-float-util[data-util="${type}"]`);
  if (existing) {
    existing.remove();
    return;
  }

  const card = document.createElement('div');
  card.className = type === 'calculator' ? 'pdf-float-util panel pdf-comix-calc' : 'pdf-float-util panel';
  card.dataset.util = type;
  card.style.right = '22px';
  card.style.bottom = type === 'calculator' ? '74px' : '96px';
  card.addEventListener('click', (e) => e.stopPropagation());

  const titles = { timer: '⏳ Таймер', stopwatch: '⏱ Секундомер', calculator: '' };
  const head = document.createElement('div');
  head.className = 'pdf-float-util-head';
  head.innerHTML = type === 'calculator'
    ? `<span class="cs85-drag-grip" aria-hidden="true"><span></span><span></span><span></span></span>`
    : `<span>${titles[type] || 'Виджет'}</span>`;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'pdf-float-util-close';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'Закрыть виджет');
  head.appendChild(closeBtn);
  card.appendChild(head);

  let intervalId = null;
  const destroy = () => {
    if (intervalId) clearInterval(intervalId);
    card.remove();
  };
  closeBtn.addEventListener('click', destroy);

  // Drag handle
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    const r = card.getBoundingClientRect();
    card.style.left = `${r.left}px`;
    card.style.top = `${r.top}px`;
    card.style.right = 'auto';
    card.style.bottom = 'auto';
    const ox = e.clientX - r.left;
    const oy = e.clientY - r.top;
    const onMove = (ev) => {
      card.style.left = `${Math.max(8, Math.min(window.innerWidth - r.width - 8, ev.clientX - ox))}px`;
      card.style.top = `${Math.max(56, Math.min(window.innerHeight - r.height - 8, ev.clientY - oy))}px`;
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  const body = document.createElement('div');
  body.className = 'pdf-float-util-body';
  if (type === 'timer') {
    let sec = 300;
    let running = false;
    const disp = document.createElement('div');
    disp.className = 'pdf-util-readout';
    const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    disp.textContent = fmt(sec);
    const controls = document.createElement('div');
    controls.className = 'pdf-util-btns';
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'pdf-util-btn primary';
    toggleBtn.textContent = 'Старт';
    toggleBtn.onclick = () => {
      if (running) {
        clearInterval(intervalId); intervalId = null; running = false; toggleBtn.textContent = 'Старт';
      } else {
        running = true; toggleBtn.textContent = 'Пауза';
        intervalId = setInterval(() => {
          if (sec > 0) { sec--; disp.textContent = fmt(sec); }
          else { clearInterval(intervalId); intervalId = null; running = false; toggleBtn.textContent = 'Старт'; }
        }, 1000);
      }
    };
    const plusBtn = document.createElement('button');
    plusBtn.type = 'button'; plusBtn.className = 'pdf-util-btn'; plusBtn.textContent = '+1м';
    plusBtn.onclick = () => { sec += 60; disp.textContent = fmt(sec); };
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button'; resetBtn.className = 'pdf-util-btn'; resetBtn.textContent = 'Сброс';
    resetBtn.onclick = () => { if (intervalId) clearInterval(intervalId); intervalId = null; running = false; sec = 300; disp.textContent = fmt(sec); toggleBtn.textContent = 'Старт'; };
    controls.append(toggleBtn, plusBtn, resetBtn);
    body.append(disp, controls);
  } else if (type === 'stopwatch') {
    let ms = 0; let running = false; let last = 0;
    const disp = document.createElement('div');
    disp.className = 'pdf-util-readout';
    const fmt = (t) => {
      const m = Math.floor(t / 60000);
      const s = Math.floor((t % 60000) / 1000);
      const d = Math.floor((t % 1000) / 100);
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`;
    };
    disp.textContent = fmt(0);
    const controls = document.createElement('div');
    controls.className = 'pdf-util-btns';
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button'; toggleBtn.className = 'pdf-util-btn primary'; toggleBtn.textContent = 'Старт';
    toggleBtn.onclick = () => {
      if (running) { clearInterval(intervalId); intervalId = null; running = false; toggleBtn.textContent = 'Старт'; }
      else {
        running = true; last = Date.now(); toggleBtn.textContent = 'Пауза';
        intervalId = setInterval(() => { const now = Date.now(); ms += now - last; last = now; disp.textContent = fmt(ms); }, 100);
      }
    };
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button'; resetBtn.className = 'pdf-util-btn'; resetBtn.textContent = 'Сброс';
    resetBtn.onclick = () => { if (intervalId) clearInterval(intervalId); intervalId = null; running = false; ms = 0; disp.textContent = fmt(0); toggleBtn.textContent = 'Старт'; };
    controls.append(toggleBtn, resetBtn);
    body.append(disp, controls);
  } else {
    if (typeof WB.mountComixCalculator === 'function') {
      WB.mountComixCalculator(body, {
        calcMode: 'DEG',
        calcAppMode: 'COMP',
        calcDispFmt: 'NORM',
        calcDispDigits: 2,
        calcVars: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, X: 0, Y: 0, M: 0 },
        calcSdData: [],
        calcHistoryLog: []
      });
    }
  }
  card.appendChild(body);
  layer.appendChild(card);
};

WB.renderAllPdfPages = function(scrollToCurrent = false) {
  const stack = document.getElementById('pdfPagesStack');
  const pageLabel = document.getElementById('pdfEditorPageIndicator');
  const zoomLabel = document.getElementById('pdfZoomLabel');
  if (!stack) return;

  const total = WB.pdfEditor.pages.length;
  const cur = Math.max(0, Math.min(WB.pdfEditor.currentPage, Math.max(0, total - 1)));
  WB.pdfEditor.currentPage = cur;
  if (pageLabel) pageLabel.textContent = `Стр. ${cur + 1} из ${total}`;
  if (zoomLabel) zoomLabel.textContent = `${Math.round(WB.pdfEditor.zoom * 100)}%`;

  const rows = WB.normalizePdfPageRows(total, WB.pdfEditor.rowCounts);
  WB.pdfEditor.rowCounts = rows.map(r => r.length);

  stack.innerHTML = '';
  const cursor = WB.pdfEditor.tool === 'eraser'
    ? 'cell'
    : (WB.pdfEditor.tool === 'hand' ? 'grab' : (WB.pdfEditor.tool === 'select' ? 'default' : 'crosshair'));

  rows.forEach((rowIndices, rowIdx) => {
    const rowGroup = document.createElement('div');
    rowGroup.className = 'pdf-page-row-group';
    rowGroup.dataset.rowIdx = String(rowIdx);

    const rowEl = document.createElement('div');
    rowEl.className = 'pdf-page-row';

    rowIndices.forEach((idx) => {
      const src = WB.pdfEditor.pages[idx];
      const cellWrap = document.createElement('div');
      cellWrap.className = 'pdf-page-cell-wrap';

      const card = document.createElement('div');
      card.className = `pdf-page-card ${idx === cur ? 'active-page' : ''}`;
      card.dataset.pageIdx = String(idx);

      const head = document.createElement('div');
      head.className = 'pdf-page-card-head';
      head.innerHTML = `<span class="pdf-page-card-num">Страница ${idx + 1} из ${total}</span>`;

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'pdf-page-delete-btn';
      delBtn.disabled = total <= 1;
      delBtn.title = total <= 1 ? 'Нельзя удалить единственную страницу' : `Удалить страницу ${idx + 1}`;
      delBtn.setAttribute('aria-label', `Удалить страницу ${idx + 1}`);
      delBtn.innerHTML = `
        <svg width="13.5" height="13.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      `;
      delBtn.addEventListener('click', (e) => WB.confirmDeletePdfPage(idx, e));
      head.appendChild(delBtn);
      card.appendChild(head);

      const stage = document.createElement('div');
      stage.className = 'pdf-canvas-stage';
      stage.dataset.pageIdx = String(idx);

      const baseCanvas = document.createElement('canvas');
      baseCanvas.className = 'pdf-page-base';
      baseCanvas.dataset.pageIdx = String(idx);

      const overlayCanvas = document.createElement('canvas');
      overlayCanvas.className = 'pdf-page-overlay';
      overlayCanvas.dataset.pageIdx = String(idx);
      overlayCanvas.style.cursor = cursor;

      const widgetsLayer = document.createElement('div');
      widgetsLayer.className = `pdf-page-widgets-layer ${WB.pdfEditor.tool === 'select' ? 'interactive' : ''}`;
      widgetsLayer.dataset.pageIdx = String(idx);

      const floatBtn = document.createElement('button');
      floatBtn.type = 'button';
      floatBtn.className = 'pdf-floating-crop-btn';
      floatBtn.dataset.pageIdx = String(idx);
      floatBtn.style.display = 'none';
      floatBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <span>Вставить фрагмент на доску</span>
      `;
      floatBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        WB.cropPdfSelectionToBoard();
      });

      stage.appendChild(baseCanvas);
      stage.appendChild(overlayCanvas);
      stage.appendChild(widgetsLayer);
      stage.appendChild(floatBtn);
      card.appendChild(stage);
      cellWrap.appendChild(card);

      // Кнопка добавления пустой страницы сбоку (справа от текущей страницы в том же ряду)
      const sideBtn = document.createElement('button');
      sideBtn.type = 'button';
      sideBtn.className = 'pdf-insert-side-btn';
      sideBtn.dataset.afterIdx = String(idx);
      sideBtn.title = `Добавить пустую страницу сбоку от страницы ${idx + 1}`;
      sideBtn.setAttribute('aria-label', `Добавить пустую страницу сбоку от страницы ${idx + 1}`);
      sideBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span class="pdf-insert-side-lbl">Сбоку</span>
      `;
      sideBtn.addEventListener('click', (e) => WB.openPdfAddPagePopoverAt(sideBtn, idx, 'side', e));
      cellWrap.appendChild(sideBtn);

      rowEl.appendChild(cellWrap);

      if (src) {
        const img = new Image();
        img.onload = () => {
          const natW = img.naturalWidth || img.width || 892;
          const natH = img.naturalHeight || img.height || 1262;
          WB.pdfEditor.pageDims[idx] = { width: natW, height: natH };

          if (scrollToCurrent && idx === cur) {
            const maxViewW = Math.max(320, window.innerWidth - 110);
            if (natW * WB.pdfEditor.zoom > maxViewW) {
              WB.pdfEditor.zoom = Math.max(0.35, +(maxViewW / natW).toFixed(2));
              WB.applyPdfZoomToAllPages();
            }
          }

          baseCanvas.width = natW;
          baseCanvas.height = natH;
          overlayCanvas.width = natW;
          overlayCanvas.height = natH;

          const cssW = Math.max(120, Math.round(natW * WB.pdfEditor.zoom));
          const cssH = Math.max(120, Math.round(natH * WB.pdfEditor.zoom));
          stage.style.width = `${cssW}px`;
          stage.style.height = `${cssH}px`;
          widgetsLayer.style.width = `${natW}px`;
          widgetsLayer.style.height = `${natH}px`;
          widgetsLayer.style.transform = `scale(${WB.pdfEditor.zoom})`;

          const ctx = baseCanvas.getContext('2d');
          ctx.clearRect(0, 0, natW, natH);
          ctx.drawImage(img, 0, 0, natW, natH);
          if (WB.pdfEditor.isPhoto && idx === WB.pdfEditor.currentPage) {
            WB.syncPhotoRibbonUI();
          }
          if (WB.pdfEditor.isDocx && typeof WB.mountDocxWordLayer === 'function') {
            WB.mountDocxWordLayer(stage, idx, natW, natH);
          }
          overlayCanvas.style.pointerEvents = WB.pdfEditor.tool === 'word' ? 'none' : 'auto';
          WB.drawPdfEditorOverlayForPage(idx);
          WB.renderPdfPageWidgets(idx);

          if (scrollToCurrent && idx === cur) {
            WB.scrollPdfPageIntoView(cur, false);
          }
        };
        img.src = src;
      }
    });

    rowGroup.appendChild(rowEl);

    // Кнопка «+ Пустая страница» под рядом (открывает выбор типа разметки: Клетчатая / Линейчатая / Без разметки)
    const lastIdxInRow = rowIndices[rowIndices.length - 1];
    const insertRow = document.createElement('div');
    insertRow.className = 'pdf-insert-between-row';
    const insertBtn = document.createElement('button');
    insertBtn.type = 'button';
    insertBtn.className = 'pdf-insert-between-btn';
    insertBtn.dataset.afterIdx = String(lastIdxInRow);
    insertBtn.title = 'Выбрать разметку и добавить пустую страницу ниже';
    insertBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      <span>Пустая страница</span>
    `;
    insertBtn.addEventListener('click', (e) => WB.openPdfAddPagePopoverAt(insertBtn, lastIdxInRow, 'below', e));
    insertRow.appendChild(insertBtn);
    rowGroup.appendChild(insertRow);

    stack.appendChild(rowGroup);
  });
};

WB.drawPdfEditorOverlayForPage = function(pageIdx) {
  const overlayCanvas = document.querySelector(`#pdfPagesStack .pdf-page-overlay[data-page-idx="${pageIdx}"]`);
  if (!overlayCanvas) return;
  const ctx = overlayCanvas.getContext('2d');
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  const strokes = WB.pdfEditor.strokesByPage[pageIdx] || [];
  WB.drawPdfStrokeList(ctx, strokes, false);

  // Рамка выделенного штриха/фигуры в режиме «Выбор»
  if (WB.pdfEditor.selectedStroke && WB.pdfEditor.selectedStroke.pageIdx === pageIdx) {
    const sel = strokes[WB.pdfEditor.selectedStroke.strokeIdx];
    const b = WB.getPdfStrokeBounds(sel);
    if (b) {
      ctx.save();
      ctx.strokeStyle = '#059669';
      ctx.lineWidth = Math.max(1.5, 1.5 / (WB.pdfEditor.zoom || 1));
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
      ctx.restore();
    }
  }

  // Лазерная указка (затухающий красный след)
  if (WB.pdfEditor.laserPageIdx === pageIdx && WB.pdfEditor.laserPoints.length > 0) {
    const now = Date.now();
    const alive = WB.pdfEditor.laserPoints.filter(p => now - p.t < 750);
    WB.pdfEditor.laserPoints = alive;
    if (alive.length > 1) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 1; i < alive.length; i++) {
        const alpha = Math.max(0, 1 - (now - alive[i].t) / 750);
        ctx.strokeStyle = `rgba(239, 68, 68, ${alpha.toFixed(2)})`;
        ctx.lineWidth = Math.max(3, 7 * alpha);
        ctx.beginPath();
        ctx.moveTo(alive[i - 1].x, alive[i - 1].y);
        ctx.lineTo(alive[i].x, alive[i].y);
        ctx.stroke();
      }
      const head = alive[alive.length - 1];
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(head.x, head.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  if (WB.pdfEditor.cropBox && WB.pdfEditor.cropPageIdx === pageIdx) {
    const b = WB.pdfEditor.cropBox;
    ctx.save();
    ctx.fillStyle = 'rgba(4, 120, 87, 0.14)';
    ctx.strokeStyle = '#047857';
    ctx.lineWidth = Math.max(2, 2 / (WB.pdfEditor.zoom || 1));
    ctx.setLineDash([6, 4]);
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.restore();
  }
};

WB.tickPdfLaserFade = function() {
  if (!WB.pdfEditor.isOpen || WB.pdfEditor.laserPoints.length === 0) {
    WB.pdfEditor.laserRaf = null;
    return;
  }
  const idx = WB.pdfEditor.laserPageIdx;
  if (idx !== null && idx !== undefined) {
    WB.drawPdfEditorOverlayForPage(idx);
  }
  if (WB.pdfEditor.laserPoints.length > 0) {
    WB.pdfEditor.laserRaf = requestAnimationFrame(WB.tickPdfLaserFade);
  } else {
    WB.pdfEditor.laserRaf = null;
  }
};

WB.drawAllPdfEditorOverlays = function() {
  for (let i = 0; i < WB.pdfEditor.pages.length; i++) {
    WB.drawPdfEditorOverlayForPage(i);
  }
};

// Вырезать выделенную область PDF и вставить карточкой на доску с точными пропорциями
WB.cropPdfSelectionToBoard = function() {
  if (WB.userRole === 'student') return;
  const b = WB.pdfEditor.cropBox;
  const pageIdx = WB.pdfEditor.cropPageIdx !== null ? WB.pdfEditor.cropPageIdx : WB.pdfEditor.currentPage;
  const mainCanvas = document.querySelector(`#pdfPagesStack .pdf-page-base[data-page-idx="${pageIdx}"]`);
  if (!b || b.w < 12 || b.h < 12 || !mainCanvas) {
    if (typeof WB.showToast === 'function') {
      WB.showToast('✂️ Выделите прямоугольную область на странице PDF', 2800, 'error');
    }
    return;
  }

  const cropX = Math.max(0, Math.round(b.x));
  const cropY = Math.max(0, Math.round(b.y));
  const cropW = Math.max(12, Math.min(mainCanvas.width - cropX, Math.round(b.w)));
  const cropH = Math.max(12, Math.min(mainCanvas.height - cropY, Math.round(b.h)));

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = cropW;
  cropCanvas.height = cropH;
  const cCtx = cropCanvas.getContext('2d');

  // Копируем саму страницу без рамки выделения
  cCtx.drawImage(mainCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  // Дорисовываем пометки, фигуры и виджеты
  const strokes = WB.pdfEditor.strokesByPage[pageIdx] || [];
  const widgets = WB.pdfEditor.widgetsByPage[pageIdx] || [];
  if (strokes.length > 0 || widgets.length > 0) {
    cCtx.save();
    cCtx.translate(-cropX, -cropY);
    WB.drawPdfStrokeList(cCtx, strokes, true);
    WB.drawPdfWidgetsOnCanvas(cCtx, widgets);
    cCtx.restore();
  }

  const croppedDataUrl = cropCanvas.toDataURL('image/png');
  const targetW = WB.state.widgets.find(item => item.id === WB.pdfEditor.targetWidgetId);
  const placeX = targetW ? targetW.x + targetW.w + 32 : undefined;
  const placeY = targetW ? targetW.y : undefined;

  const fit = WB.calcAspectFitBox(cropW, cropH, 560, 520, 48);

  WB.closePdfEditor();
  WB.addWidget('image', {
    x: placeX,
    y: placeY,
    w: fit.w,
    h: fit.h + 28,
    src: croppedDataUrl
  });

  if (typeof WB.showToast === 'function') {
    WB.showToast('✂️ Вырезанный фрагмент PDF добавлен на доску!');
  }
};

// Сохранить нарисованные пометки, блоки и правки Word на ВСЕХ изменённых страницах документа
WB.savePdfAnnotationsToPage = async function() {
  if (WB.userRole === 'student') return;
  if (WB.pdfEditor.isDocx && typeof WB.syncActiveDocxLayersToState === 'function') {
    WB.syncActiveDocxLayersToState({ silentSync: true });
  }
  const modifiedSet = new Set();
  for (const [k, list] of Object.entries(WB.pdfEditor.strokesByPage)) {
    if (Array.isArray(list) && list.length > 0) modifiedSet.add(Number(k));
  }
  for (const [k, list] of Object.entries(WB.pdfEditor.widgetsByPage)) {
    if (Array.isArray(list) && list.length > 0) modifiedSet.add(Number(k));
  }
  if (WB.pdfEditor.isDocx && WB.pdfEditor.docxDirty && Array.isArray(WB.pdfEditor.docxPages)) {
    WB.pdfEditor.docxPages.forEach((dp, i) => {
      if (dp && dp.kind === 'docx') modifiedSet.add(i);
    });
  }
  const modifiedIndices = Array.from(modifiedSet);

  if (modifiedIndices.length === 0) {
    WB.showToast('ℹ️ Нет новых изменений для сохранения');
    return;
  }

  for (const idx of modifiedIndices) {
    const mergedCanvas = await WB.buildCompositePdfPageCanvas(idx);
    if (!mergedCanvas) continue;
    WB.pdfEditor.pages[idx] = WB.pdfEditor.isPhoto
      ? mergedCanvas.toDataURL('image/png')
      : mergedCanvas.toDataURL('image/jpeg', 0.92);
    // Для DOCX оставляем Word-текст редактируемым; для PDF/Фото/пустых страниц запекаем в слой изображения
    if (!WB.pdfEditor.isDocx || !WB.pdfEditor.docxPages?.[idx] || WB.pdfEditor.docxPages[idx].kind !== 'docx') {
      WB.pdfEditor.strokesByPage[idx] = [];
      WB.pdfEditor.widgetsByPage[idx] = [];
    }
  }

  WB.pdfEditor.docxDirty = false;
  WB.pdfEditor.selectedStroke = null;
  WB.pushPdfHistorySnapshot();

  const w = WB.state.widgets.find(item => item.id === WB.pdfEditor.targetWidgetId);
  if (w) {
    w.pdfPages = WB.pdfEditor.pages.slice();
    w.pdfRowCounts = WB.pdfEditor.rowCounts.slice();
    if (WB.pdfEditor.isDocx && Array.isArray(WB.pdfEditor.docxPages)) {
      w.docxPages = WB.pdfEditor.docxPages.map(p => p ? Object.assign({}, p) : null);
    }
    if (WB.pdfEditor.isPhoto) {
      const dims = WB.pdfEditor.pageDims[WB.pdfEditor.currentPage];
      if (dims && dims.width > 0 && dims.height > 0 && typeof WB.calcAspectFitBox === 'function') {
        const fit = WB.calcAspectFitBox(dims.width, dims.height, 560, 560, 48);
        w.w = fit.w;
        w.h = fit.h + 28;
      }
    }
    w.currentPage = WB.pdfEditor.currentPage;
    w.src = WB.pdfEditor.pages[WB.pdfEditor.currentPage] || w.src;
    WB.renderWidgetsDOM();
    if (typeof WB.updateSelectionBounds === 'function') WB.updateSelectionBounds();
    WB.saveHistory();
  }

  WB.renderPdfEditorThumbnails();
  WB.renderAllPdfPages(false);
  if (WB.pdfEditor.isPhoto) WB.syncPhotoRibbonUI();
  const docLbl = WB.pdfEditor.isDocx ? 'DOCX' : (WB.pdfEditor.isPhoto ? 'фото' : 'PDF');
  WB.showToast(
    modifiedIndices.length === 1
      ? `💾 Изменения сохранены на ${WB.pdfEditor.isPhoto ? 'фото' : 'странице ' + docLbl}!`
      : `💾 Изменения сохранены на ${modifiedIndices.length} страницах (${docLbl})!`,
    2500,
    'success'
  );
};

// =====================================================================
// РЕЖИМ РАБОТЫ С ФОТО (поворот на 90°, обрезка, пометки и экспорт)
// =====================================================================
WB.syncPhotoRibbonUI = function() {
  const isPhoto = !!(WB.pdfEditor && WB.pdfEditor.isOpen && WB.pdfEditor.isPhoto);
  const rotLeftBtn = document.getElementById('photoRotateLeftBtn');
  const rotRightBtn = document.getElementById('photoRotateRightBtn');
  if (rotLeftBtn) rotLeftBtn.style.display = isPhoto ? 'inline-flex' : 'none';
  if (rotRightBtn) rotRightBtn.style.display = isPhoto ? 'inline-flex' : 'none';
};

WB.transformPhotoPoint = function(x, y, w, h, mode) {
  if (mode === 'rot-right') return { x: h - y, y: x };
  if (mode === 'rot-left') return { x: y, y: w - x };
  return { x, y };
};

WB.transformCurrentPhotoPage = async function(mode) {
  if (WB.userRole === 'student') return;
  if (!WB.pdfEditor.isOpen || !WB.pdfEditor.isPhoto) return;
  const idx = WB.pdfEditor.currentPage || 0;
  const src = WB.pdfEditor.pages[idx];
  if (!src) return;

  const img = await new Promise((resolve) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => resolve(null);
    el.src = src;
  });
  if (!img) return;

  const srcW = img.naturalWidth || img.width || 800;
  const srcH = img.naturalHeight || img.height || 600;
  const isSwap = mode === 'rot-right' || mode === 'rot-left';
  const dstW = isSwap ? srcH : srcW;
  const dstH = isSwap ? srcW : srcH;

  const canvas = document.createElement('canvas');
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.translate(dstW / 2, dstH / 2);
  if (mode === 'rot-right') ctx.rotate(Math.PI / 2);
  else if (mode === 'rot-left') ctx.rotate(-Math.PI / 2);
  ctx.drawImage(img, -srcW / 2, -srcH / 2, srcW, srcH);
  ctx.restore();

  // Трансформируем текущие несохранённые штрихи и виджеты вместе с фото
  const strokes = WB.pdfEditor.strokesByPage[idx] || [];
  strokes.forEach(s => {
    if (Array.isArray(s.points)) {
      s.points = s.points.map(pt => WB.transformPhotoPoint(pt.x, pt.y, srcW, srcH, mode));
    }
    if (typeof s.x1 === 'number' && typeof s.y1 === 'number') {
      const p1 = WB.transformPhotoPoint(s.x1, s.y1, srcW, srcH, mode);
      const p2 = WB.transformPhotoPoint(s.x2, s.y2, srcW, srcH, mode);
      s.x1 = p1.x; s.y1 = p1.y; s.x2 = p2.x; s.y2 = p2.y;
    }
  });
  const widgets = WB.pdfEditor.widgetsByPage[idx] || [];
  widgets.forEach(pw => {
    const cx = (pw.x || 0) + (pw.w || 160) / 2;
    const cy = (pw.y || 0) + (pw.h || 80) / 2;
    const nc = WB.transformPhotoPoint(cx, cy, srcW, srcH, mode);
    pw.x = Math.max(0, Math.min(dstW - (pw.w || 80), Math.round(nc.x - (pw.w || 160) / 2)));
    pw.y = Math.max(0, Math.min(dstH - (pw.h || 40), Math.round(nc.y - (pw.h || 80) / 2)));
  });

  const nextUrl = canvas.toDataURL('image/png');
  WB.pdfEditor.pages[idx] = nextUrl;
  WB.pdfEditor.pageDims[idx] = { width: dstW, height: dstH };
  WB.pdfEditor.cropBox = null;
  WB.pdfEditor.cropPageIdx = null;
  WB.pdfEditor.selectedStroke = null;
  WB.updatePdfCropButtons(false);

  const w = WB.state.widgets.find(item => item.id === WB.pdfEditor.targetWidgetId);
  if (w) {
    w.pdfPages = WB.pdfEditor.pages.slice();
    if (w.currentPage === idx) {
      w.src = nextUrl;
      if (typeof WB.calcAspectFitBox === 'function') {
        const fit = WB.calcAspectFitBox(dstW, dstH, 560, 560, 48);
        w.w = fit.w;
        w.h = fit.h + 28;
      }
    }
    WB.renderWidgetsDOM();
    if (typeof WB.updateSelectionBounds === 'function') WB.updateSelectionBounds();
    WB.saveToStorage();
  }

  WB.pushPdfHistorySnapshot();
  WB.renderPdfEditorThumbnails();
  WB.renderAllPdfPages(false);
  WB.syncPhotoRibbonUI();
};

WB.cropPhotoInPlace = async function() {
  if (WB.userRole === 'student') return;
  if (!WB.pdfEditor.isOpen || !WB.pdfEditor.isPhoto) return;
  const b = WB.pdfEditor.cropBox;
  const pageIdx = WB.pdfEditor.cropPageIdx !== null ? WB.pdfEditor.cropPageIdx : WB.pdfEditor.currentPage;
  const mainCanvas = document.querySelector(`#pdfPagesStack .pdf-page-base[data-page-idx="${pageIdx}"]`);
  if (!b || b.w < 16 || b.h < 16 || !mainCanvas) {
    if (typeof WB.showToast === 'function') {
      WB.showToast('✂️ Выделите область на фото для обрезки', 2500, 'error');
    }
    return;
  }

  const cropX = Math.max(0, Math.round(b.x));
  const cropY = Math.max(0, Math.round(b.y));
  const cropW = Math.max(16, Math.min(mainCanvas.width - cropX, Math.round(b.w)));
  const cropH = Math.max(16, Math.min(mainCanvas.height - cropY, Math.round(b.h)));

  const out = document.createElement('canvas');
  out.width = cropW;
  out.height = cropH;
  const ctx = out.getContext('2d');
  ctx.drawImage(mainCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  // Сдвигаем несохранённые штрихи и виджеты в новые координаты после кадрирования
  const strokes = WB.pdfEditor.strokesByPage[pageIdx] || [];
  strokes.forEach(s => {
    if (Array.isArray(s.points)) {
      s.points = s.points.map(pt => ({ x: pt.x - cropX, y: pt.y - cropY }));
    }
    if (typeof s.x1 === 'number') s.x1 -= cropX;
    if (typeof s.y1 === 'number') s.y1 -= cropY;
    if (typeof s.x2 === 'number') s.x2 -= cropX;
    if (typeof s.y2 === 'number') s.y2 -= cropY;
  });
  const widgets = WB.pdfEditor.widgetsByPage[pageIdx] || [];
  widgets.forEach(pw => {
    pw.x = Math.max(0, (pw.x || 0) - cropX);
    pw.y = Math.max(0, (pw.y || 0) - cropY);
  });

  const croppedUrl = out.toDataURL('image/png');
  WB.pdfEditor.pages[pageIdx] = croppedUrl;
  WB.pdfEditor.pageDims[pageIdx] = { width: cropW, height: cropH };
  WB.pdfEditor.cropBox = null;
  WB.pdfEditor.cropPageIdx = null;
  WB.pdfEditor.selectedStroke = null;
  WB.updatePdfCropButtons(false);

  const w = WB.state.widgets.find(item => item.id === WB.pdfEditor.targetWidgetId);
  if (w) {
    w.pdfPages = WB.pdfEditor.pages.slice();
    if (w.currentPage === pageIdx) {
      w.src = croppedUrl;
      if (typeof WB.calcAspectFitBox === 'function') {
        const fit = WB.calcAspectFitBox(cropW, cropH, 560, 560, 48);
        w.w = fit.w;
        w.h = fit.h + 28;
      }
    }
    WB.renderWidgetsDOM();
    if (typeof WB.updateSelectionBounds === 'function') WB.updateSelectionBounds();
    WB.saveToStorage();
  }

  WB.pushPdfHistorySnapshot();
  WB.renderPdfEditorThumbnails();
  WB.renderAllPdfPages(false);
  WB.syncPhotoRibbonUI();

  if (typeof WB.showToast === 'function') {
    WB.showToast(`✂️ Фото обрезано до ${cropW}×${cropH} px`, 2200, 'success');
  }
};

WB.downloadEditedPhoto = async function(format = 'png') {
  const cur = WB.pdfEditor.currentPage || 0;
  const canvas = await WB.buildCompositePdfPageCanvas(cur);
  if (!canvas) return;
  const isJpg = format === 'jpg' || format === 'jpeg';
  const mime = isJpg ? 'image/jpeg' : 'image/png';
  const ext = isJpg ? 'jpg' : 'png';
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, isJpg ? 0.93 : undefined));
  if (!blob) return;
  const baseName = (WB.pdfEditor.title || 'Фото').replace(/\.(png|jpe?g|webp|gif|pdf)$/i, '');
  const filename = typeof WB.sanitizeExportFilename === 'function'
    ? WB.sanitizeExportFilename(baseName, ext)
    : `${baseName}.${ext}`;
  WB.triggerDownload(blob, filename);
  if (typeof WB.showToast === 'function') {
    WB.showToast(`🖼️ Фото сохранено как ${ext.toUpperCase()}!`, 2200, 'success');
  }
};

// Инициализация событий мыши/тача и прокрутки внутри многостраничного PDF-редактора
window.addEventListener('DOMContentLoaded', () => {
  WB.syncPdfStyleUI();
  const viewport = document.getElementById('pdfCanvasViewport');
  const stack = document.getElementById('pdfPagesStack');
  if (!stack) return;

  // Отслеживание активной страницы при прокрутке + мягкое обновление позиции для «Притянуться к участнику»
  if (viewport) {
    let scrollRaf = null;
    let lastScrollViewBroadcast = 0;
    viewport.addEventListener('scroll', () => {
      if (!WB.pdfEditor.isOpen || scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = null;
        const vRect = viewport.getBoundingClientRect();
        const anchorY = vRect.top + vRect.height * 0.35;
        const anchorX = vRect.left + vRect.width * 0.5;
        let bestIdx = WB.pdfEditor.currentPage;
        let bestDist = Infinity;
        stack.querySelectorAll('.pdf-page-card').forEach(card => {
          const r = card.getBoundingClientRect();
          const midY = r.top + r.height * 0.5;
          const midX = r.left + r.width * 0.5;
          const dist = Math.abs(midY - anchorY) + Math.abs(midX - anchorX) * 0.25;
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = Number(card.dataset.pageIdx);
          }
        });
        if (bestIdx !== WB.pdfEditor.currentPage) {
          WB.setPdfActivePageMeta(bestIdx);
        }
        const now = performance.now();
        if (now - lastScrollViewBroadcast > 320 && typeof WB.broadcastPeerViewport === 'function') {
          lastScrollViewBroadcast = now;
          WB.broadcastPeerViewport(false);
        }
      });
    }, { passive: true });
  }

  const getLocalPt = (overlay, e) => {
    const r = overlay.getBoundingClientRect();
    const scaleX = overlay.width / (r.width || 1);
    const scaleY = overlay.height / (r.height || 1);
    return {
      x: (e.clientX - r.left) * scaleX,
      y: (e.clientY - r.top) * scaleY
    };
  };

  let lastPdfLiveSentAt = 0;
  let lastPdfLivePtIdx = 0;
  let lastPdfLaserSentAt = 0;

  // Мультитач (Pinch-to-Zoom + панорамирование двумя пальцами), откат первого пальца и защита от ладони в PDF
  const pdfTouchPointers = new Map();
  let pdfIsPinching = false;
  let pdfPinchLastMid = { x: 0, y: 0 };
  let pdfPinchLastDist = 0;
  let pdfActivePointerId = null;
  let pdfPenDown = false;
  let pdfLastPenMs = 0;
  let pdfTouchRollback = null;

  const rollbackPdfFirstFinger = () => {
    const activeOv = WB.pdfEditor.activeOverlay;
    if (activeOv && pdfActivePointerId !== null) {
      try { activeOv.releasePointerCapture(pdfActivePointerId); } catch (_) {}
    }
    WB.pdfEditor.handPan = null;
    if (viewport) viewport.style.cursor = '';
    WB.pdfEditor.isDragging = false;
    WB.pdfEditor.didErase = false;
    pdfActivePointerId = null;

    const pIdx = WB.pdfEditor.activeDragPageIdx;
    const unfinished = WB.pdfEditor.currentStroke;
    WB.pdfEditor.currentStroke = null;
    WB.pdfEditor.activeOverlay = null;
    WB.pdfEditor.activeDragPageIdx = null;

    if (unfinished && pIdx !== null && pIdx !== undefined) {
      const arr = WB.pdfEditor.strokesByPage[pIdx] || [];
      const i = arr.indexOf(unfinished);
      if (i !== -1) arr.splice(i, 1);
    }

    if (pdfTouchRollback) {
      const rb = pdfTouchRollback;
      pdfTouchRollback = null;
      if (rb.pageIdx !== null && rb.pageIdx !== undefined) {
        if (rb.strokesJson !== undefined) {
          try {
            WB.pdfEditor.strokesByPage[rb.pageIdx] = JSON.parse(rb.strokesJson);
          } catch (_) {}
        }
        if (rb.cropBoxJson !== undefined) {
          try {
            WB.pdfEditor.cropBox = rb.cropBoxJson ? JSON.parse(rb.cropBoxJson) : null;
            WB.pdfEditor.cropPageIdx = rb.cropPageIdx;
          } catch (_) {}
        }
        WB.drawPdfEditorOverlayForPage(rb.pageIdx);
      }
    } else if (pIdx !== null && pIdx !== undefined) {
      WB.drawPdfEditorOverlayForPage(pIdx);
    }
  };

  if (viewport) {
    // Предотвращаем системный зум Safari при двух пальцах внутри просмотрщика PDF
    viewport.addEventListener('touchstart', (e) => {
      if (WB.pdfEditor.isOpen && e.touches && e.touches.length >= 2) {
        e.preventDefault();
      }
    }, { passive: false });
    viewport.addEventListener('touchmove', (e) => {
      if (WB.pdfEditor.isOpen && e.touches && e.touches.length >= 2) {
        e.preventDefault();
      }
    }, { passive: false });

    viewport.addEventListener('pointerdown', (e) => {
      if (!WB.pdfEditor.isOpen) return;
      if (e.pointerType === 'pen') {
        pdfPenDown = true;
        pdfLastPenMs = performance.now();
        return;
      }
      if (e.pointerType !== 'touch') return;
      if (e.target && e.target.closest && e.target.closest('button, input, textarea, select, [contenteditable="true"]')) {
        return;
      }
      if (pdfPenDown) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      pdfTouchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pdfTouchPointers.size >= 2) {
        e.preventDefault();
        e.stopPropagation();
        if (!pdfIsPinching) {
          pdfIsPinching = true;
          rollbackPdfFirstFinger();
        }
        const pts = Array.from(pdfTouchPointers.values());
        pdfPinchLastMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        pdfPinchLastDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        if (typeof WB.showZoomHud === 'function') WB.showZoomHud(WB.pdfEditor.zoom);
      }
    }, true);

    window.addEventListener('pointermove', (e) => {
      if (!WB.pdfEditor.isOpen) return;
      if (e.pointerType === 'pen') {
        if (e.buttons > 0) pdfPenDown = true;
        pdfLastPenMs = performance.now();
        return;
      }
      if (e.pointerType !== 'touch') return;
      if (!pdfTouchPointers.has(e.pointerId)) return;

      pdfTouchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pdfIsPinching && pdfTouchPointers.size >= 2) {
        e.preventDefault();
        e.stopPropagation();
        const pts = Array.from(pdfTouchPointers.values());
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const panDx = mid.x - pdfPinchLastMid.x;
        const panDy = mid.y - pdfPinchLastMid.y;

        if (pdfPinchLastDist > 12 && dist > 12) {
          const oldZoom = WB.pdfEditor.zoom || 1;
          const nextZoom = Math.min(2.5, Math.max(0.4, +(oldZoom * (dist / pdfPinchLastDist)).toFixed(3)));
          const rect = viewport.getBoundingClientRect();
          const focusX = mid.x - rect.left;
          const focusY = mid.y - rect.top;
          const contentX = viewport.scrollLeft + focusX;
          const contentY = viewport.scrollTop + focusY;

          if (Math.abs(nextZoom - oldZoom) >= 0.002) {
            WB.pdfEditor.zoom = nextZoom;
            WB.applyPdfZoomToAllPages();
            const ratio = nextZoom / oldZoom;
            viewport.scrollLeft = Math.max(0, Math.round(contentX * ratio - focusX - panDx));
            viewport.scrollTop = Math.max(0, Math.round(contentY * ratio - focusY - panDy));
          } else {
            viewport.scrollLeft = Math.max(0, viewport.scrollLeft - panDx);
            viewport.scrollTop = Math.max(0, viewport.scrollTop - panDy);
          }
          if (typeof WB.showZoomHud === 'function') WB.showZoomHud(WB.pdfEditor.zoom);
        } else {
          viewport.scrollLeft = Math.max(0, viewport.scrollLeft - panDx);
          viewport.scrollTop = Math.max(0, viewport.scrollTop - panDy);
        }

        pdfPinchLastMid = mid;
        pdfPinchLastDist = dist;
      }
    }, true);

    const endPdfTouchPointer = (e) => {
      if (e.pointerType === 'pen') {
        pdfPenDown = false;
        pdfLastPenMs = performance.now();
        return;
      }
      if (e.pointerType !== 'touch') return;
      if (!pdfTouchPointers.has(e.pointerId)) return;
      pdfTouchPointers.delete(e.pointerId);

      if (pdfIsPinching) {
        e.stopPropagation();
        if (pdfTouchPointers.size >= 2) {
          const pts = Array.from(pdfTouchPointers.values());
          pdfPinchLastMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
          pdfPinchLastDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        } else if (pdfTouchPointers.size === 0) {
          pdfIsPinching = false;
          pdfTouchRollback = null;
        }
      }
    };
    window.addEventListener('pointerup', endPdfTouchPointer, true);
    window.addEventListener('pointercancel', endPdfTouchPointer, true);
  }

  stack.addEventListener('pointerdown', (e) => {
    if (!WB.pdfEditor.isOpen) return;
    if (pdfIsPinching || pdfTouchPointers.size >= 2) return;
    if (e.pointerType === 'touch') {
      const now = performance.now();
      if (pdfPenDown || (pdfLastPenMs > 0 && now - pdfLastPenMs < 650) || (pdfLastPenMs > 0 && now - pdfLastPenMs < 4000 && Math.max(e.width || 0, e.height || 0) >= 52)) {
        e.preventDefault();
        return;
      }
    }
    if (WB.pdfEditor.isDragging && pdfActivePointerId !== null && e.pointerId !== pdfActivePointerId) return;

    // Режим «Рука» — панорамирование области PDF
    if (WB.pdfEditor.tool === 'hand' && viewport && !e.target.closest('button')) {
      e.preventDefault();
      pdfActivePointerId = e.pointerId;
      WB.pdfEditor.handPan = {
        startClientX: e.clientX,
        startClientY: e.clientY,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop
      };
      viewport.style.cursor = 'grabbing';
      return;
    }

    const overlay = e.target && e.target.closest ? e.target.closest('.pdf-page-overlay') : null;
    if (!overlay) return;

    e.preventDefault();
    if (e.pointerType !== 'touch') {
      try { overlay.setPointerCapture(e.pointerId); } catch (_) {}
    }
    document.getElementById('pdfThumbsPopover')?.classList.remove('open');
    document.getElementById('pdfAddPagePopover')?.classList.remove('open');
    if (typeof WB.closeAllDropdowns === 'function') {
      document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
    }
    const pdfSbWrap = document.getElementById('pdfStyleBlockWrap');
    if (pdfSbWrap) {
      pdfSbWrap.classList.remove('expanded');
      document.getElementById('pdfStyleCompactToggle')?.setAttribute('aria-expanded', 'false');
    }

    const pageIdx = Number(overlay.dataset.pageIdx);
    const pt = getLocalPt(overlay, e);

    WB.setPdfActivePageMeta(pageIdx);
    WB.pdfEditor.activeOverlay = overlay;
    WB.pdfEditor.activeDragPageIdx = pageIdx;
    WB.pdfEditor.isDragging = true;
    WB.pdfEditor.didErase = false;
    WB.pdfEditor.startPt = pt;
    pdfActivePointerId = e.pointerId;
    lastPdfLiveSentAt = 0;
    lastPdfLivePtIdx = 0;

    const tool = WB.pdfEditor.tool;
    if (e.pointerType === 'touch' && (tool === 'eraser' || tool === 'select' || tool === 'crop')) {
      pdfTouchRollback = {
        pageIdx,
        strokesJson: JSON.stringify(WB.pdfEditor.strokesByPage[pageIdx] || []),
        cropBoxJson: WB.pdfEditor.cropBox ? JSON.stringify(WB.pdfEditor.cropBox) : null,
        cropPageIdx: WB.pdfEditor.cropPageIdx
      };
    } else {
      pdfTouchRollback = null;
    }

    if (tool === 'crop') {
      if (WB.userRole === 'student') {
        WB.pdfEditor.isDragging = false;
        pdfActivePointerId = null;
        return;
      }
      const prevCropPage = WB.pdfEditor.cropPageIdx;
      WB.pdfEditor.cropPageIdx = pageIdx;
      WB.pdfEditor.cropBox = { x: pt.x, y: pt.y, w: 0, h: 0 };
      WB.updatePdfCropButtons(false);
      if (prevCropPage !== null && prevCropPage !== pageIdx) {
        WB.drawPdfEditorOverlayForPage(prevCropPage);
      }
    } else if (tool === 'select') {
      const list = WB.pdfEditor.strokesByPage[pageIdx] || [];
      let hitIdx = -1;
      for (let i = list.length - 1; i >= 0; i--) {
        const b = WB.getPdfStrokeBounds(list[i]);
        if (b && pt.x >= b.minX && pt.x <= b.maxX && pt.y >= b.minY && pt.y <= b.maxY) {
          hitIdx = i;
          break;
        }
      }
      if (hitIdx !== -1) {
        WB.pdfEditor.selectedStroke = { pageIdx, strokeIdx: hitIdx, lastPt: pt, moved: false };
      } else {
        WB.pdfEditor.selectedStroke = null;
      }
    } else if (tool === 'laser') {
      WB.pdfEditor.laserPageIdx = pageIdx;
      WB.pdfEditor.laserPoints = [{ x: pt.x, y: pt.y, t: Date.now() }];
      if (!WB.pdfEditor.laserRaf) WB.pdfEditor.laserRaf = requestAnimationFrame(WB.tickPdfLaserFade);
      if (typeof WB.broadcastPdfEvent === 'function' && WB.pdfEditor.targetWidgetId) {
        WB.broadcastPdfEvent('pdf_laser', { widgetId: WB.pdfEditor.targetWidgetId, pageIdx, x: Math.round(pt.x), y: Math.round(pt.y) });
      }
    } else if (tool === 'draw' || tool === 'highlighter') {
      if (!WB.pdfEditor.strokesByPage[pageIdx]) WB.pdfEditor.strokesByPage[pageIdx] = [];
      const isHL = tool === 'highlighter';
      const color = isHL
        ? (WB.pdfEditor.highlighterColor || '#facc15')
        : (WB.pdfEditor.drawColor || '#ef4444');
      const size = isHL
        ? (WB.pdfEditor.highlighterSize || 22)
        : (WB.pdfEditor.drawSize || 4);
      const lineStyle = isHL
        ? (WB.pdfEditor.highlighterLineStyle || 'solid')
        : (WB.pdfEditor.drawLineStyle || 'solid');
      WB.pdfEditor.currentStroke = {
        id: 'ps_' + Date.now() + '_' + Math.floor(Math.random() * 9999),
        type: isHL ? 'highlighter' : 'pen',
        color,
        size,
        lineStyle,
        isHighlighter: isHL,
        alpha: isHL ? 0.36 : 1,
        authorRole: WB.userRole || 'teacher',
        points: [pt]
      };
      WB.pdfEditor.strokesByPage[pageIdx].push(WB.pdfEditor.currentStroke);
    } else if (WB.PDF_SHAPE_TOOLS.has(tool)) {
      if (!WB.pdfEditor.strokesByPage[pageIdx]) WB.pdfEditor.strokesByPage[pageIdx] = [];
      const color = WB.pdfEditor.drawColor || '#ef4444';
      const size = WB.pdfEditor.drawSize || 4;
      const lineStyle = WB.pdfEditor.drawLineStyle || 'solid';
      WB.pdfEditor.currentStroke = {
        id: 'ps_' + Date.now() + '_' + Math.floor(Math.random() * 9999),
        type: tool,
        color,
        size,
        lineStyle,
        isHighlighter: false,
        alpha: 1,
        authorRole: WB.userRole || 'teacher',
        x1: pt.x,
        y1: pt.y,
        x2: pt.x,
        y2: pt.y
      };
      WB.pdfEditor.strokesByPage[pageIdx].push(WB.pdfEditor.currentStroke);
    } else if (tool === 'eraser') {
      const existing = WB.pdfEditor.strokesByPage[pageIdx] || [];
      const res = WB.erasePdfStrokeSegments(existing, pt, 18);
      if (res.changed) {
        WB.pdfEditor.strokesByPage[pageIdx] = res.strokes;
        WB.pdfEditor.didErase = true;
      }
    }
    WB.drawPdfEditorOverlayForPage(pageIdx);
  });

  stack.addEventListener('pointermove', (e) => {
    if (pdfIsPinching || pdfTouchPointers.size >= 2) return;
    if (pdfActivePointerId !== null && e.pointerId !== pdfActivePointerId) return;
    if (WB.pdfEditor.handPan && viewport) {
      const hp = WB.pdfEditor.handPan;
      viewport.scrollLeft = hp.scrollLeft - (e.clientX - hp.startClientX);
      viewport.scrollTop = hp.scrollTop - (e.clientY - hp.startClientY);
      return;
    }
    if (!WB.pdfEditor.isDragging || !WB.pdfEditor.activeOverlay) return;
    const overlay = WB.pdfEditor.activeOverlay;
    const pageIdx = WB.pdfEditor.activeDragPageIdx;
    if (pageIdx === null || pageIdx === undefined) return;
    const pt = getLocalPt(overlay, e);
    const tool = WB.pdfEditor.tool;
    const now = performance.now();

    if (tool === 'crop') {
      const s = WB.pdfEditor.startPt;
      WB.pdfEditor.cropBox = {
        x: Math.min(s.x, pt.x),
        y: Math.min(s.y, pt.y),
        w: Math.abs(pt.x - s.x),
        h: Math.abs(pt.y - s.y)
      };
    } else if (tool === 'select' && WB.pdfEditor.selectedStroke && WB.pdfEditor.selectedStroke.pageIdx === pageIdx) {
      const selMeta = WB.pdfEditor.selectedStroke;
      const stroke = (WB.pdfEditor.strokesByPage[pageIdx] || [])[selMeta.strokeIdx];
      if (stroke && selMeta.lastPt) {
        const dx = pt.x - selMeta.lastPt.x;
        const dy = pt.y - selMeta.lastPt.y;
        if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) selMeta.moved = true;
        if (Array.isArray(stroke.points)) {
          for (const p of stroke.points) { p.x += dx; p.y += dy; }
        }
        if (typeof stroke.x1 === 'number') {
          stroke.x1 += dx; stroke.y1 += dy; stroke.x2 += dx; stroke.y2 += dy;
        }
        selMeta.lastPt = pt;
      }
    } else if (tool === 'laser') {
      WB.pdfEditor.laserPoints.push({ x: pt.x, y: pt.y, t: Date.now() });
      if (!WB.pdfEditor.laserRaf) WB.pdfEditor.laserRaf = requestAnimationFrame(WB.tickPdfLaserFade);
      if (now - lastPdfLaserSentAt >= 38 && typeof WB.broadcastPdfEvent === 'function' && WB.pdfEditor.targetWidgetId) {
        lastPdfLaserSentAt = now;
        WB.broadcastPdfEvent('pdf_laser', { widgetId: WB.pdfEditor.targetWidgetId, pageIdx, x: Math.round(pt.x), y: Math.round(pt.y) });
      }
    } else if ((tool === 'draw' || tool === 'highlighter') && WB.pdfEditor.currentStroke) {
      const s = WB.pdfEditor.currentStroke;
      s.points.push(pt);
      if (now - lastPdfLiveSentAt >= 36 && typeof WB.broadcastPdfEvent === 'function' && WB.pdfEditor.targetWidgetId) {
        lastPdfLiveSentAt = now;
        const chunk = s.points.slice(lastPdfLivePtIdx).map(p => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }));
        const isFirst = lastPdfLivePtIdx === 0;
        lastPdfLivePtIdx = s.points.length;
        if (chunk.length > 0) {
          WB.broadcastPdfEvent('pdf_stroke_live', {
            widgetId: WB.pdfEditor.targetWidgetId,
            pageIdx,
            strokeId: s.id,
            meta: isFirst ? { type: s.type, color: s.color, size: s.size, lineStyle: s.lineStyle, isHighlighter: s.isHighlighter, alpha: s.alpha, authorRole: s.authorRole } : null,
            points: chunk
          });
        }
      }
    } else if (WB.PDF_SHAPE_TOOLS.has(tool) && WB.pdfEditor.currentStroke) {
      const s = WB.pdfEditor.currentStroke;
      s.x2 = pt.x;
      s.y2 = pt.y;
      if (now - lastPdfLiveSentAt >= 45 && typeof WB.broadcastPdfEvent === 'function' && WB.pdfEditor.targetWidgetId) {
        lastPdfLiveSentAt = now;
        WB.broadcastPdfEvent('pdf_stroke_upsert', {
          widgetId: WB.pdfEditor.targetWidgetId,
          pageIdx,
          stroke: s
        });
      }
    } else if (tool === 'eraser') {
      const existing = WB.pdfEditor.strokesByPage[pageIdx] || [];
      const res = WB.erasePdfStrokeSegments(existing, pt, 18);
      if (res.changed) {
        WB.pdfEditor.strokesByPage[pageIdx] = res.strokes;
        WB.pdfEditor.didErase = true;
      }
    }
    WB.drawPdfEditorOverlayForPage(pageIdx);
  });

  const finishPdfPointer = (e) => {
    if (pdfIsPinching) return;
    if (pdfActivePointerId !== null && e && e.pointerId !== undefined && e.pointerId !== pdfActivePointerId) return;
    pdfActivePointerId = null;
    pdfTouchRollback = null;
    if (WB.pdfEditor.handPan && viewport) {
      WB.pdfEditor.handPan = null;
      viewport.style.cursor = '';
    }
    const overlay = WB.pdfEditor.activeOverlay;
    if (overlay && e && e.pointerId !== undefined) {
      try { overlay.releasePointerCapture(e.pointerId); } catch (_) {}
    }
    if (!WB.pdfEditor.isDragging) return;
    WB.pdfEditor.isDragging = false;
    const pageIdx = WB.pdfEditor.activeDragPageIdx;
    const finishedStroke = WB.pdfEditor.currentStroke;
    const tool = WB.pdfEditor.tool;
    WB.pdfEditor.currentStroke = null;
    WB.pdfEditor.activeOverlay = null;
    WB.pdfEditor.activeDragPageIdx = null;

    if (tool === 'crop' && WB.pdfEditor.cropBox && WB.pdfEditor.cropBox.w > 12 && WB.pdfEditor.cropBox.h > 12) {
      WB.updatePdfCropButtons(true);
    } else if (tool === 'select' && WB.pdfEditor.selectedStroke && WB.pdfEditor.selectedStroke.moved) {
      WB.pdfEditor.selectedStroke.moved = false;
      WB.pushPdfHistorySnapshot();
      if (typeof WB.broadcastPdfEvent === 'function' && WB.pdfEditor.targetWidgetId) {
        WB.broadcastPdfEvent('pdf_strokes_replace', {
          widgetId: WB.pdfEditor.targetWidgetId,
          pageIdx,
          strokes: WB.pdfEditor.strokesByPage[pageIdx] || []
        });
      }
    } else if ((tool === 'draw' || tool === 'highlighter') && finishedStroke) {
      if (!finishedStroke.points || finishedStroke.points.length < 2) {
        const arr = WB.pdfEditor.strokesByPage[pageIdx] || [];
        const i = arr.indexOf(finishedStroke);
        if (i !== -1) arr.splice(i, 1);
        WB.drawPdfEditorOverlayForPage(pageIdx);
      } else {
        WB.pushPdfHistorySnapshot();
        if (typeof WB.broadcastPdfEvent === 'function' && WB.pdfEditor.targetWidgetId) {
          WB.broadcastPdfEvent('pdf_stroke_upsert', {
            widgetId: WB.pdfEditor.targetWidgetId,
            pageIdx,
            stroke: finishedStroke
          });
        }
      }
    } else if (WB.PDF_SHAPE_TOOLS.has(tool) && finishedStroke) {
      const dist = Math.hypot((finishedStroke.x2 || 0) - (finishedStroke.x1 || 0), (finishedStroke.y2 || 0) - (finishedStroke.y1 || 0));
      if (dist < 6) {
        const arr = WB.pdfEditor.strokesByPage[pageIdx] || [];
        const i = arr.indexOf(finishedStroke);
        if (i !== -1) arr.splice(i, 1);
        WB.drawPdfEditorOverlayForPage(pageIdx);
      } else {
        WB.pushPdfHistorySnapshot();
        if (typeof WB.broadcastPdfEvent === 'function' && WB.pdfEditor.targetWidgetId) {
          WB.broadcastPdfEvent('pdf_stroke_upsert', {
            widgetId: WB.pdfEditor.targetWidgetId,
            pageIdx,
            stroke: finishedStroke
          });
        }
      }
    } else if (tool === 'eraser' && WB.pdfEditor.didErase) {
      WB.pdfEditor.didErase = false;
      WB.pushPdfHistorySnapshot();
      if (typeof WB.broadcastPdfEvent === 'function' && WB.pdfEditor.targetWidgetId) {
        WB.broadcastPdfEvent('pdf_strokes_replace', {
          widgetId: WB.pdfEditor.targetWidgetId,
          pageIdx,
          strokes: WB.pdfEditor.strokesByPage[pageIdx] || []
        });
      }
    }
  };
  stack.addEventListener('pointerup', finishPdfPointer);
  stack.addEventListener('pointercancel', finishPdfPointer);
  window.addEventListener('pointerup', () => {
    if (WB.pdfEditor.handPan && viewport) {
      WB.pdfEditor.handPan = null;
      viewport.style.cursor = '';
    }
  });
});

// Приём событий реального времени внутри PDF/DOCX/Фото от другого участника
WB.handleRemotePdfEvent = function(data) {
  if (!data || !data.widgetId) return;
  const widgetId = data.widgetId;
  const pageIdx = typeof data.pageIdx === 'number' ? data.pageIdx : 0;

  // Находим виджет на текущей странице или среди всех страниц доски
  let targetWidget = (WB.state && Array.isArray(WB.state.widgets))
    ? WB.state.widgets.find(item => item.id === widgetId)
    : null;
  if (!targetWidget && Array.isArray(WB.pages)) {
    for (const p of WB.pages) {
      if (Array.isArray(p.widgets)) {
        const found = p.widgets.find(item => item.id === widgetId);
        if (found) { targetWidget = found; break; }
      }
    }
  }

  const isOpenSame = !!(WB.pdfEditor && WB.pdfEditor.isOpen && WB.pdfEditor.targetWidgetId === widgetId);

  if (data.type === 'pdf_laser') {
    if (!isOpenSame) return;
    WB.pdfEditor.laserPageIdx = pageIdx;
    WB.pdfEditor.laserPoints.push({ x: Number(data.x) || 0, y: Number(data.y) || 0, t: Date.now() });
    if (!WB.pdfEditor.laserRaf) WB.pdfEditor.laserRaf = requestAnimationFrame(WB.tickPdfLaserFade);
    WB.drawPdfEditorOverlayForPage(pageIdx);
    return;
  }

  if (data.type === 'pdf_stroke_live') {
    const applyLive = (mapObj) => {
      if (!mapObj[pageIdx]) mapObj[pageIdx] = [];
      const arr = mapObj[pageIdx];
      let s = arr.find(item => item.id === data.strokeId);
      if (!s) {
        const m = data.meta || {};
        s = {
          id: data.strokeId,
          type: m.type || 'pen',
          color: m.color || '#ef4444',
          size: m.size || 4,
          lineStyle: m.lineStyle || 'solid',
          isHighlighter: !!m.isHighlighter,
          alpha: typeof m.alpha === 'number' ? m.alpha : (m.isHighlighter ? 0.36 : 1),
          authorRole: m.authorRole || 'teacher',
          points: []
        };
        arr.push(s);
      }
      if (Array.isArray(data.points) && data.points.length > 0) {
        if (!Array.isArray(s.points)) s.points = [];
        for (const pt of data.points) s.points.push({ x: pt.x, y: pt.y });
      }
    };
    if (targetWidget) {
      if (!targetWidget.pdfStrokesByPage) targetWidget.pdfStrokesByPage = {};
      applyLive(targetWidget.pdfStrokesByPage);
    }
    if (isOpenSame) {
      applyLive(WB.pdfEditor.strokesByPage);
      WB.drawPdfEditorOverlayForPage(pageIdx);
    }
    return;
  }

  if (data.type === 'pdf_stroke_upsert' && data.stroke) {
    const applyUpsert = (mapObj) => {
      if (!mapObj[pageIdx]) mapObj[pageIdx] = [];
      const arr = mapObj[pageIdx];
      const idx = arr.findIndex(item => item.id === data.stroke.id);
      if (idx !== -1) arr[idx] = data.stroke;
      else arr.push(data.stroke);
    };
    if (targetWidget) {
      if (!targetWidget.pdfStrokesByPage) targetWidget.pdfStrokesByPage = {};
      applyUpsert(targetWidget.pdfStrokesByPage);
    }
    if (isOpenSame) {
      applyUpsert(WB.pdfEditor.strokesByPage);
      WB.drawPdfEditorOverlayForPage(pageIdx);
    }
    if (typeof WB.scheduleSaveToStorage === 'function') WB.scheduleSaveToStorage(800);
    return;
  }

  if (data.type === 'pdf_strokes_replace') {
    const list = Array.isArray(data.strokes) ? data.strokes : [];
    if (targetWidget) {
      if (!targetWidget.pdfStrokesByPage) targetWidget.pdfStrokesByPage = {};
      targetWidget.pdfStrokesByPage[pageIdx] = list;
    }
    if (isOpenSame) {
      WB.pdfEditor.strokesByPage[pageIdx] = list.map(s => Object.assign({}, s, Array.isArray(s.points) ? { points: s.points.map(p => ({ x: p.x, y: p.y })) } : {}));
      WB.drawPdfEditorOverlayForPage(pageIdx);
    }
    if (typeof WB.scheduleSaveToStorage === 'function') WB.scheduleSaveToStorage(800);
    return;
  }

  if (data.type === 'pdf_widgets_replace') {
    const list = Array.isArray(data.widgets) ? data.widgets : [];
    if (targetWidget) {
      if (!targetWidget.pdfWidgetsByPage) targetWidget.pdfWidgetsByPage = {};
      targetWidget.pdfWidgetsByPage[pageIdx] = list;
    }
    if (isOpenSame) {
      WB.pdfEditor.widgetsByPage[pageIdx] = list;
      WB.renderPdfPageWidgets(pageIdx);
    }
    if (typeof WB.scheduleSaveToStorage === 'function') WB.scheduleSaveToStorage(800);
    return;
  }

  if (data.type === 'pdf_page_insert') {
    const pageStyle = data.style || 'grid';
    const pageW = Math.max(120, Number(data.pageW) || 892);
    const pageH = Math.max(120, Number(data.pageH) || 1262);
    const blankUrl = WB.generateBlankPdfPageDataUrl(pageStyle, pageW, pageH);
    const mode = data.placement === 'side' ? 'side' : 'below';

    if (targetWidget) {
      if (!Array.isArray(targetWidget.pdfPages) || targetWidget.pdfPages.length === 0) {
        targetWidget.pdfPages = targetWidget.src ? [targetWidget.src] : [];
      }
      const wInsertIdx = Math.max(0, Math.min(Number(data.insertIdx) || 0, targetWidget.pdfPages.length));
      targetWidget.pdfPages.splice(wInsertIdx, 0, blankUrl);
      if (Array.isArray(data.rowCounts) && data.rowCounts.length > 0) {
        targetWidget.pdfRowCounts = data.rowCounts.slice();
      } else {
        targetWidget.pdfRowCounts = WB.insertPdfPageInRows(targetWidget.pdfPages.length - 1, targetWidget.pdfRowCounts, Number(data.afterIdx) || 0, mode).rowCounts;
      }
      targetWidget.pdfStrokesByPage = WB.shiftPdfStrokesOnInsert(targetWidget.pdfStrokesByPage || {}, wInsertIdx);
      targetWidget.pdfWidgetsByPage = WB.shiftPdfStrokesOnInsert(targetWidget.pdfWidgetsByPage || {}, wInsertIdx);
      if (Array.isArray(targetWidget.docxPages)) {
        targetWidget.docxPages.splice(wInsertIdx, 0, { kind: 'blank', blankStyle: pageStyle });
      }
    }

    if (isOpenSame) {
      const vp = document.getElementById('pdfCanvasViewport');
      const prevScrollTop = vp ? vp.scrollTop : 0;
      const eInsertIdx = Math.max(0, Math.min(Number(data.insertIdx) || 0, WB.pdfEditor.pages.length));
      WB.pdfEditor.pages.splice(eInsertIdx, 0, blankUrl);
      if (WB.pdfEditor.isDocx && Array.isArray(WB.pdfEditor.docxPages)) {
        WB.pdfEditor.docxPages.splice(eInsertIdx, 0, { kind: 'blank', blankStyle: pageStyle });
      }
      WB.pdfEditor.rowCounts = (Array.isArray(data.rowCounts) && data.rowCounts.length > 0)
        ? data.rowCounts.slice()
        : WB.insertPdfPageInRows(WB.pdfEditor.pages.length - 1, WB.pdfEditor.rowCounts, Number(data.afterIdx) || 0, mode).rowCounts;
      WB.pdfEditor.strokesByPage = WB.shiftPdfStrokesOnInsert(WB.pdfEditor.strokesByPage, eInsertIdx);
      WB.pdfEditor.widgetsByPage = WB.shiftPdfStrokesOnInsert(WB.pdfEditor.widgetsByPage, eInsertIdx);
      WB.pdfEditor.pageDims = WB.shiftPdfStrokesOnInsert(WB.pdfEditor.pageDims, eInsertIdx);
      WB.pdfEditor.pageDims[eInsertIdx] = { width: pageW, height: pageH };
      if (WB.pdfEditor.currentPage >= eInsertIdx) {
        WB.pdfEditor.currentPage = Math.min(WB.pdfEditor.pages.length - 1, WB.pdfEditor.currentPage + 1);
      }
      WB.pdfEditor.cropBox = null;
      WB.pdfEditor.cropPageIdx = null;
      WB.pdfEditor.selectedStroke = null;
      if (typeof WB.updateWordRibbonVisibility === 'function') WB.updateWordRibbonVisibility();
      WB.renderPdfEditorThumbnails();
      WB.renderAllPdfPages(false);
      if (vp) requestAnimationFrame(() => { vp.scrollTop = prevScrollTop; });
    }

    if (typeof WB.renderWidgetsDOM === 'function') WB.renderWidgetsDOM();
    if (typeof WB.scheduleSaveToStorage === 'function') WB.scheduleSaveToStorage(700);
    return;
  }

  if (data.type === 'pdf_page_delete') {
    const safeIdx = Number(data.pageIdx);
    if (isNaN(safeIdx) || safeIdx < 0) return;

    if (targetWidget && Array.isArray(targetWidget.pdfPages) && targetWidget.pdfPages.length > 1 && safeIdx < targetWidget.pdfPages.length) {
      targetWidget.pdfPages.splice(safeIdx, 1);
      if (Array.isArray(data.rowCounts) && data.rowCounts.length > 0) {
        targetWidget.pdfRowCounts = data.rowCounts.slice();
      } else {
        targetWidget.pdfRowCounts = WB.removePdfPageFromRows(targetWidget.pdfPages.length + 1, targetWidget.pdfRowCounts, safeIdx).rowCounts;
      }
      targetWidget.pdfStrokesByPage = WB.shiftPdfRecordOnDelete(targetWidget.pdfStrokesByPage || {}, safeIdx);
      targetWidget.pdfWidgetsByPage = WB.shiftPdfRecordOnDelete(targetWidget.pdfWidgetsByPage || {}, safeIdx);
      if (Array.isArray(targetWidget.docxPages) && safeIdx < targetWidget.docxPages.length) {
        targetWidget.docxPages.splice(safeIdx, 1);
      }
      targetWidget.currentPage = Math.max(0, Math.min(Number(targetWidget.currentPage) || 0, targetWidget.pdfPages.length - 1));
      if (targetWidget.pdfPages[targetWidget.currentPage]) {
        targetWidget.src = targetWidget.pdfPages[targetWidget.currentPage];
      }
    }

    if (isOpenSame && WB.pdfEditor.pages.length > 1 && safeIdx < WB.pdfEditor.pages.length) {
      const vp = document.getElementById('pdfCanvasViewport');
      const prevScrollTop = vp ? vp.scrollTop : 0;
      WB.pdfEditor.pages.splice(safeIdx, 1);
      if (WB.pdfEditor.isDocx && Array.isArray(WB.pdfEditor.docxPages) && safeIdx < WB.pdfEditor.docxPages.length) {
        WB.pdfEditor.docxPages.splice(safeIdx, 1);
      }
      WB.pdfEditor.rowCounts = (Array.isArray(data.rowCounts) && data.rowCounts.length > 0)
        ? data.rowCounts.slice()
        : WB.removePdfPageFromRows(WB.pdfEditor.pages.length + 1, WB.pdfEditor.rowCounts, safeIdx).rowCounts;
      WB.pdfEditor.strokesByPage = WB.shiftPdfRecordOnDelete(WB.pdfEditor.strokesByPage, safeIdx);
      WB.pdfEditor.widgetsByPage = WB.shiftPdfRecordOnDelete(WB.pdfEditor.widgetsByPage, safeIdx);
      WB.pdfEditor.pageDims = WB.shiftPdfRecordOnDelete(WB.pdfEditor.pageDims, safeIdx);
      if (WB.pdfEditor.currentPage > safeIdx) {
        WB.pdfEditor.currentPage -= 1;
      }
      WB.pdfEditor.currentPage = Math.max(0, Math.min(WB.pdfEditor.currentPage, WB.pdfEditor.pages.length - 1));
      WB.pdfEditor.cropBox = null;
      WB.pdfEditor.cropPageIdx = null;
      WB.pdfEditor.selectedStroke = null;
      if (typeof WB.updateWordRibbonVisibility === 'function') WB.updateWordRibbonVisibility();
      WB.renderPdfEditorThumbnails();
      WB.renderAllPdfPages(false);
      if (vp) requestAnimationFrame(() => { vp.scrollTop = prevScrollTop; });
    }

    if (typeof WB.renderWidgetsDOM === 'function') WB.renderWidgetsDOM();
    if (typeof WB.scheduleSaveToStorage === 'function') WB.scheduleSaveToStorage(700);
    return;
  }

  if (data.type === 'pdf_docx_html') {
    const html = typeof data.html === 'string' ? data.html : '';
    if (targetWidget && Array.isArray(targetWidget.docxPages) && targetWidget.docxPages[pageIdx]) {
      targetWidget.docxPages[pageIdx].html = html;
    }
    if (isOpenSame && WB.pdfEditor.isDocx && Array.isArray(WB.pdfEditor.docxPages) && WB.pdfEditor.docxPages[pageIdx]) {
      WB.pdfEditor.docxPages[pageIdx].html = html;
      const layer = document.querySelector(`#pdfPagesStack .docx-word-layer[data-page-idx="${pageIdx}"]`);
      if (layer && document.activeElement !== layer && layer.innerHTML !== html) {
        layer.innerHTML = html;
      }
      if (typeof WB.updateDocxWordCount === 'function') WB.updateDocxWordCount();
    }
    if (typeof WB.scheduleSaveToStorage === 'function') WB.scheduleSaveToStorage(800);
  }
};

// Обновление открытого PDF/DOCX/Фото-редактора при получении полного снимка виджета (например, после Undo/Redo или room_sync_pull)
WB.refreshOpenPdfEditorFromWidget = function(widget) {
  if (!widget || !WB.pdfEditor || !WB.pdfEditor.isOpen || WB.pdfEditor.targetWidgetId !== widget.id) return;
  const nextPages = Array.isArray(widget.pdfPages) && widget.pdfPages.length > 0
    ? widget.pdfPages.slice()
    : (widget.src ? [widget.src] : []);
  if (nextPages.length === 0) return;

  const nextRows = Array.isArray(widget.pdfRowCounts) && widget.pdfRowCounts.length > 0
    ? widget.pdfRowCounts.slice()
    : WB.normalizePdfPageRows(nextPages.length, null).map(r => r.length);

  const prevPages = WB.pdfEditor.pages || [];
  const prevRowsStr = (WB.pdfEditor.rowCounts || []).join(',');
  const pagesChanged =
    prevPages.length !== nextPages.length ||
    prevRowsStr !== nextRows.join(',') ||
    nextPages.some((src, i) => src !== prevPages[i]);

  WB.pdfEditor.pages = nextPages;
  WB.pdfEditor.rowCounts = nextRows;
  if (Array.isArray(widget.docxPages)) {
    WB.pdfEditor.docxPages = widget.docxPages.map(p => p ? Object.assign({}, p) : null);
  }
  if (widget.pdfStrokesByPage && typeof widget.pdfStrokesByPage === 'object') {
    WB.pdfEditor.strokesByPage = WB.cloneAllPdfStrokesByPage(widget.pdfStrokesByPage);
  }
  if (widget.pdfWidgetsByPage && typeof widget.pdfWidgetsByPage === 'object') {
    WB.pdfEditor.widgetsByPage = WB.cloneAllPdfWidgetsByPage(widget.pdfWidgetsByPage);
  }
  WB.pdfEditor.currentPage = Math.max(0, Math.min(WB.pdfEditor.currentPage || 0, nextPages.length - 1));

  if (pagesChanged) {
    const vp = document.getElementById('pdfCanvasViewport');
    const prevScrollTop = vp ? vp.scrollTop : 0;
    WB.pdfEditor.pageDims = {};
    if (typeof WB.updateWordRibbonVisibility === 'function') WB.updateWordRibbonVisibility();
    WB.renderPdfEditorThumbnails();
    WB.renderAllPdfPages(false);
    if (vp) requestAnimationFrame(() => { vp.scrollTop = prevScrollTop; });
  } else {
    WB.drawAllPdfEditorOverlays();
    WB.renderAllPdfPageWidgets();
  }
};

WB.buildSVGString = function() {
  const contentBounds = typeof WB.getAllContentBounds === 'function' ? WB.getAllContentBounds() : null;
  const pad = 60;
  const bx = contentBounds ? contentBounds.x - pad : 0;
  const by = contentBounds ? contentBounds.y - pad : 0;
  const bw = contentBounds ? Math.max(600, Math.ceil(contentBounds.w + pad * 2)) : 1200;
  const bh = contentBounds ? Math.max(400, Math.ceil(contentBounds.h + pad * 2)) : 800;

  const isDark = document.body.classList.contains('dark');
  const bg = isDark ? '#0f172a' : '#f8fafc';
  const esc = (str) => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bx} ${by} ${bw} ${bh}" width="${bw}" height="${bh}">`,
    `  <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="${bg}"/>`
  ];

  for (const w of WB.state.widgets) {
    if (w.type === 'note') {
      lines.push(`  <rect x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" rx="6" fill="${w.color}"/>`);
      lines.push(`  <text x="${w.x + 12}" y="${w.y + 50}" font-family="Segoe UI, sans-serif" font-size="16" fill="#1e293b">${esc(w.text)}</text>`);
    } else if (w.type === 'text') {
      const tColor = isDark ? '#f8fafc' : '#1e293b';
      lines.push(`  <text x="${w.x + 10}" y="${w.y + 50}" font-family="Segoe UI, sans-serif" font-weight="bold" font-size="20" fill="${tColor}">${esc(w.text)}</text>`);
    } else if (w.type === 'latex') {
      const boxBg = isDark ? '#1e293b' : '#ffffff';
      const tColor = w.color || (isDark ? '#f8fafc' : '#1e293b');
      lines.push(`  <rect x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" rx="6" fill="${boxBg}" stroke="#e2e8f0"/>`);
      lines.push(`  <text x="${w.x + 14}" y="${w.y + 50}" font-family="Cambria Math, serif" font-style="italic" font-size="18" fill="${tColor}">${esc(w.latex)}</text>`);
    } else if (w.type === 'table' && Array.isArray(w.tableData)) {
      const rows = w.tableData.length || 1;
      const cols = (w.tableData[0] && w.tableData[0].length) || 1;
      const bodyTop = w.y + 28;
      const bodyH = Math.max(24, w.h - 28);
      const cellW = w.w / cols;
      const cellH = bodyH / rows;
      const boxBg = isDark ? '#1e293b' : '#ffffff';
      const hdrBg = isDark ? '#334155' : '#f1f5f9';
      const brd = isDark ? '#475569' : '#cbd5e1';
      const tColor = isDark ? '#f8fafc' : '#0f172a';
      lines.push(`  <rect x="${w.x}" y="${bodyTop}" width="${w.w}" height="${bodyH}" fill="${boxBg}" stroke="${brd}"/>`);
      lines.push(`  <rect x="${w.x}" y="${bodyTop}" width="${w.w}" height="${cellH}" fill="${hdrBg}" stroke="${brd}"/>`);
      for (let r = 1; r < rows; r++) {
        lines.push(`  <line x1="${w.x}" y1="${bodyTop + r * cellH}" x2="${w.x + w.w}" y2="${bodyTop + r * cellH}" stroke="${brd}"/>`);
      }
      for (let c = 1; c < cols; c++) {
        lines.push(`  <line x1="${w.x + c * cellW}" y1="${bodyTop}" x2="${w.x + c * cellW}" y2="${bodyTop + bodyH}" stroke="${brd}"/>`);
      }
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const val = String((w.tableData[r] && w.tableData[r][c]) || '');
          const fw = r === 0 ? ' font-weight="bold"' : '';
          lines.push(`  <text x="${w.x + c * cellW + 8}" y="${bodyTop + r * cellH + cellH * 0.62}" font-family="Segoe UI, sans-serif" font-size="13"${fw} fill="${tColor}">${esc(val)}</text>`);
        }
      }
    }
  }

  for (const s of WB.state.strokes) {
    const isHl = s.type === 'highlighter' || s.isHighlighter;
    const sw = isHl ? (s.size || 4) * 3.2 : (s.size || 4);
    const op = isHl ? 0.34 : 1.0;
    const dashArr = typeof WB.getLineDashPattern === 'function' ? WB.getLineDashPattern(s.lineStyle || 'solid', sw) : [];
    const dashAttr = dashArr.length ? ` stroke-dasharray="${dashArr.map(n => n.toFixed(1)).join(',')}"` : '';
    const common = `fill="none" stroke="${s.color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${op}"${dashAttr}`;

    const hasFill = s.fillColor && s.fillColor !== 'transparent';
    const closedFill = hasFill ? s.fillColor : 'none';
    const filledCommon = `fill="${closedFill}" stroke="${s.color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${op}"${dashAttr}`;

    if (s.type === 'axes') {
      const geom = WB.getAxesGeometry(s);
      lines.push(`  <line x1="${geom.xAxis.from.x}" y1="${geom.origin.y}" x2="${geom.xAxis.to.x}" y2="${geom.origin.y}" ${common}/>`);
      lines.push(`  <line x1="${geom.origin.x}" y1="${geom.yAxis.from.y}" x2="${geom.origin.x}" y2="${geom.yAxis.to.y}" ${common}/>`);
      lines.push(`  <polyline points="${geom.xAxis.to.x - 12},${geom.origin.y - 5} ${geom.xAxis.to.x},${geom.origin.y} ${geom.xAxis.to.x - 12},${geom.origin.y + 5}" ${common}/>`);
      lines.push(`  <polyline points="${geom.origin.x - 5},${geom.yAxis.to.y + 12} ${geom.origin.x},${geom.yAxis.to.y} ${geom.origin.x + 5},${geom.yAxis.to.y + 12}" ${common}/>`);
    } else if (s.type === 'polygon' && s.vertices && s.vertices.length > 1) {
      const ptsAttr = s.vertices.map(v => `${v.x.toFixed(1)},${v.y.toFixed(1)}`).join(' ');
      const tag = s.closed ? 'polygon' : 'polyline';
      lines.push(`  <${tag} points="${ptsAttr}" ${s.closed ? filledCommon : common}/>`);
    } else if (s.points && s.points.length > 0) {
      const d = s.points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
      lines.push(`  <path d="${d}" ${common}/>`);
    } else if (s.type === 'line') {
      lines.push(`  <line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" ${common}/>`);
    } else if (s.type === 'arrow') {
      const g = WB.getArrowHeadGeometry(s.x1, s.y1, s.x2, s.y2, s.size || 4);
      lines.push(`  <line x1="${s.x1}" y1="${s.y1}" x2="${g.shaftEnd.x.toFixed(2)}" y2="${g.shaftEnd.y.toFixed(2)}" ${common}/>`);
      lines.push(`  <polygon points="${g.tip.x.toFixed(2)},${g.tip.y.toFixed(2)} ${g.baseLeft.x.toFixed(2)},${g.baseLeft.y.toFixed(2)} ${g.baseRight.x.toFixed(2)},${g.baseRight.y.toFixed(2)}" fill="${s.color}" fill-opacity="${op}"/>`);
    } else if (s.type === 'ellipse' || s.type === 'circle' || s.type === 'unit_circle') {
      const b = typeof WB.getNormalizedShapeBox === 'function'
        ? WB.getNormalizedShapeBox(s)
        : {
            minX: Math.min(s.x1, s.x2), maxX: Math.max(s.x1, s.x2),
            minY: Math.min(s.y1, s.y2), maxY: Math.max(s.y1, s.y2),
            w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1),
            cx: (s.x1 + s.x2) / 2, cy: (s.y1 + s.y2) / 2
          };
      const rx = b.w / 2, ry = b.h / 2;
      lines.push(`  <ellipse cx="${b.cx}" cy="${b.cy}" rx="${rx}" ry="${ry}" ${filledCommon}/>`);
      if (s.type === 'unit_circle') {
        const ext = Math.max(14, Math.min(rx, ry) * 0.22);
        lines.push(`  <line x1="${b.minX - ext}" y1="${b.cy}" x2="${b.maxX + ext}" y2="${b.cy}" ${common}/>`);
        lines.push(`  <line x1="${b.cx}" y1="${b.maxY + ext}" x2="${b.cx}" y2="${b.minY - ext}" ${common}/>`);
      }
    } else if (typeof WB.get2DShapeVertices === 'function' && WB.get2DShapeVertices(s)) {
      const verts = WB.get2DShapeVertices(s);
      const ptsAttr = verts.map(v => `${v.x.toFixed(1)},${v.y.toFixed(1)}`).join(' ');
      lines.push(`  <polygon points="${ptsAttr}" ${filledCommon}/>`);
    } else if (typeof WB.get3DShapePrimitives === 'function' && WB.get3DShapePrimitives(s)) {
      const prim = WB.get3DShapePrimitives(s);
      const dashStep = Math.max(5, (s.size || 3) * 1.8);
      const b = WB.getNormalizedShapeBox ? WB.getNormalizedShapeBox(s) : { cx: (s.x1 + s.x2) / 2, cy: (s.y1 + s.y2) / 2 };
      if (prim.cfg && prim.cfg.showFaces && Array.isArray(prim.filledFaces)) {
        for (const face of prim.filledFaces) {
          const ptsAttr = face.map(v => `${v.x.toFixed(1)},${v.y.toFixed(1)}`).join(' ');
          lines.push(`  <polygon points="${ptsAttr}" fill="${s.color || '#1e293b'}" fill-opacity="0.065" stroke="none"/>`);
        }
      }
      if (Array.isArray(prim.customPlanes2d)) {
        for (const pl of prim.customPlanes2d) {
          const ptsAttr = pl.points.map(v => `${v.x.toFixed(1)},${v.y.toFixed(1)}`).join(' ');
          lines.push(`  <polygon points="${ptsAttr}" fill="#0d9488" fill-opacity="0.22" stroke="#0d9488" stroke-width="2"/>`);
        }
      }
      for (const poly of prim.solidLines) {
        const ptsAttr = poly.map(v => `${v.x.toFixed(1)},${v.y.toFixed(1)}`).join(' ');
        lines.push(`  <polyline points="${ptsAttr}" ${common}/>`);
      }
      for (const poly of prim.dashedLines) {
        const ptsAttr = poly.map(v => `${v.x.toFixed(1)},${v.y.toFixed(1)}`).join(' ');
        lines.push(`  <polyline points="${ptsAttr}" stroke-dasharray="${dashStep},${(dashStep * 0.85).toFixed(1)}" ${common}/>`);
      }
      for (const arc of prim.arcs) {
        if (Math.abs(arc.end - arc.start - Math.PI * 2) < 0.01) {
          lines.push(`  <ellipse cx="${arc.cx}" cy="${arc.cy}" rx="${arc.rx}" ry="${arc.ry}" ${arc.dashed ? `stroke-dasharray="${dashStep},${(dashStep * 0.85).toFixed(1)}"` : ''} ${common}/>`);
        } else {
          const sx = arc.cx + arc.rx * Math.cos(arc.start);
          const sy = arc.cy + arc.ry * Math.sin(arc.start);
          const ex = arc.cx + arc.rx * Math.cos(arc.end);
          const ey = arc.cy + arc.ry * Math.sin(arc.end);
          lines.push(`  <path d="M ${sx.toFixed(1)} ${sy.toFixed(1)} A ${arc.rx.toFixed(1)} ${arc.ry.toFixed(1)} 0 0 1 ${ex.toFixed(1)} ${ey.toFixed(1)}" ${arc.dashed ? `stroke-dasharray="${dashStep},${(dashStep * 0.85).toFixed(1)}"` : ''} ${common}/>`);
        }
      }
      if (Array.isArray(prim.customLines2d)) {
        for (const cl of prim.customLines2d) {
          lines.push(`  <line x1="${cl.a.x.toFixed(1)}" y1="${cl.a.y.toFixed(1)}" x2="${cl.b.x.toFixed(1)}" y2="${cl.b.y.toFixed(1)}" stroke="#0d9488" stroke-width="2.2" stroke-linecap="round"/>`);
        }
      }
      if ((!prim.cfg || prim.cfg.showLabels !== false) && Array.isArray(prim.vertices2d)) {
        for (const v of prim.vertices2d) {
          if (!v.label) continue;
          const dx = v.x - b.cx, dy = v.y - b.cy;
          const dist = Math.hypot(dx, dy) || 1;
          const lx = (v.x + (dx / dist) * 14).toFixed(1);
          const ly = (v.y + (dy / dist) * 14).toFixed(1);
          lines.push(`  <text x="${lx}" y="${ly}" fill="${s.color || '#1e293b'}" font-family="serif" font-style="italic" font-weight="600" font-size="14" text-anchor="middle" dominant-baseline="middle">${v.label}</text>`);
        }
      }
      if (Array.isArray(prim.customPoints2d)) {
        for (const cp of prim.customPoints2d) {
          lines.push(`  <circle cx="${cp.x.toFixed(1)}" cy="${cp.y.toFixed(1)}" r="4.5" fill="#ffffff" stroke="#0d9488" stroke-width="2"/>`);
          if (!prim.cfg || prim.cfg.showLabels !== false) {
            lines.push(`  <text x="${(cp.x + 7).toFixed(1)}" y="${(cp.y - 5).toFixed(1)}" fill="#0f766e" font-family="sans-serif" font-weight="700" font-size="13">${cp.label}</text>`);
          }
        }
      }
    }
  }

  lines.push(`</svg>`);
  return lines.join('\n');
};

WB.downloadSVG = function() {
  const svgStr = WB.buildSVGString();
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  WB.triggerDownload(blob, WB.sanitizeExportFilename(WB.boardTitle, 'svg'));
};

WB.saveProjectFile = function() {
  if (WB.userRole === 'student') return;
  if (typeof WB.syncCurrentPage === 'function') WB.syncCurrentPage();
  const data = JSON.stringify({
    version: 12,
    savedAt: new Date().toISOString(),
    boardTitle: WB.boardTitle || 'Новый урок',
    gridMode: WB.gridMode || 'grid-lines',
    cam: WB.cam,
    snapToGrid: WB.snapToGridEnabled,
    currentPageIndex: WB.currentPageIndex || 0,
    pages: WB.pages || [],
    state: WB.state
  }, null, 2);

  const blob = new Blob([data], { type: 'application/json;charset=utf-8' });
  const datedTitle = `${WB.boardTitle || 'whiteboard'}_${new Date().toISOString().slice(0, 10)}`;
  WB.triggerDownload(blob, WB.sanitizeExportFilename(datedTitle, 'wb'));
};

WB.loadProjectFile = function(e) {
  if (WB.userRole === 'student') return;
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const parsed = JSON.parse(ev.target.result);
      if (parsed.state && Array.isArray(parsed.state.strokes)) {
        WB.state = parsed.state;
        if (Array.isArray(parsed.pages) && parsed.pages.length > 0) {
          WB.pages = parsed.pages;
          WB.currentPageIndex = Math.max(0, Math.min(Number(parsed.currentPageIndex) || 0, WB.pages.length - 1));
        } else if (typeof WB.syncCurrentPage === 'function') {
          WB.pages = [{
            id: 'page_1',
            name: 'Страница 1',
            strokes: WB.state.strokes,
            widgets: WB.state.widgets,
            cam: parsed.cam || { x: 0, y: 0, z: 1 }
          }];
          WB.currentPageIndex = 0;
        }
        if (parsed.boardTitle) {
          if (typeof WB.setBoardTitle === 'function') WB.setBoardTitle(parsed.boardTitle);
          const titleInp = document.getElementById('boardTitleInput');
          if (titleInp) titleInp.value = WB.boardTitle;
        }
        if (parsed.gridMode && typeof WB.setGridMode === 'function') {
          WB.setGridMode(parsed.gridMode);
        }
        if (parsed.cam) {
          WB.cam = parsed.cam;
          WB.updateCameraUI();
        }
        if (parsed.snapToGrid !== undefined) {
          WB.snapToGridEnabled = parsed.snapToGrid;
          const snapBtn = document.getElementById('snapGridBtn');
          if (snapBtn) {
            snapBtn.classList.toggle('active', WB.snapToGridEnabled);
            snapBtn.classList.toggle('active-green', WB.snapToGridEnabled);
          }
        }
        WB.clearSelection();
        WB.renderWidgetsDOM();
        if (typeof WB.renderPagesDropdown === 'function') WB.renderPagesDropdown();
        WB.saveHistory();
        if (typeof WB.showToast === 'function') WB.showToast('📂 Проект успешно загружен!', 2600, 'success');
      } else if (typeof WB.showToast === 'function') {
        WB.showToast('⚠️ Неверный формат файла .wb', 3200, 'error');
      }
    } catch (err) {
      if (typeof WB.showToast === 'function') {
        WB.showToast('⚠️ Ошибка чтения файла проекта: ' + (err?.message || 'повреждён JSON'), 3600, 'error');
      }
    }
  };
  reader.readAsText(file);
  e.target.value = '';
};

WB.drawWrappedText = function(c, text, x, y, maxWidth, lineHeight) {
  const paragraphs = (text || '').split('\n');
  for (const para of paragraphs) {
    const words = para.split(' ');
    let line = '';
    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + ' ';
      if (c.measureText(testLine).width > maxWidth && n > 0) {
        c.fillText(line, x, y);
        line = words[n] + ' ';
        y += lineHeight;
      } else {
        line = testLine;
      }
    }
    c.fillText(line, x, y);
    y += lineHeight;
  }
};
