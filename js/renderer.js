window.WB = window.WB || {};

WB.laserPoints = [];
WB.mouseWorld = { x: 0, y: 0 };

WB.resizeCanvas = function() {
  const canvas = document.getElementById('board');
  const gridCanvas = document.getElementById('gridCanvas');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = document.documentElement.clientWidth || window.innerWidth;
  const h = document.documentElement.clientHeight || window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  if (gridCanvas) {
    gridCanvas.width = Math.round(w * dpr);
    gridCanvas.height = Math.round(h * dpr);
    gridCanvas.style.width = w + 'px';
    gridCanvas.style.height = h + 'px';
  }
  if (typeof WB.sync3DFloatingUI === 'function') WB.sync3DFloatingUI();
  if (typeof WB.sync2DFloatingUI === 'function') WB.sync2DFloatingUI();
};

WB.linearSnapState = null;

WB.drawBackgroundGrid = function(ctx, vw, vh) {
  const isDark = document.body.classList.contains('dark');
  ctx.save();
  ctx.fillStyle = isDark ? '#0f172a' : '#f8fafc';
  ctx.fillRect(0, 0, vw, vh);
  ctx.restore();

  let mode = WB.gridMode;
  if (!mode) {
    if (document.body.classList.contains('grid-none')) mode = 'grid-none';
    else if (document.body.classList.contains('grid-dots')) mode = 'grid-dots';
    else if (document.body.classList.contains('grid-ruled')) mode = 'grid-ruled';
    else mode = 'grid-lines';
  }
  if (mode === 'grid-none') return;

  const z = WB.cam?.z > 0 ? WB.cam.z : 1;
  const step = typeof WB.getEffectiveGridSize === 'function'
    ? WB.getEffectiveGridSize(z, WB.gridSize || 32)
    : (WB.gridSize || 32);

  const gridColor = getComputedStyle(document.body).getPropertyValue('--grid-color').trim()
    || (isDark ? '#334155' : '#cbd5e1');

  const minWX = -WB.cam.x / z;
  const maxWX = (vw - WB.cam.x) / z;
  const minWY = -WB.cam.y / z;
  const maxWY = (vh - WB.cam.y) / z;

  const startX = Math.floor(minWX / step) * step;
  const startY = Math.floor(minWY / step) * step;

  ctx.save();
  if (mode === 'grid-lines') {
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let wx = startX; wx <= maxWX + step * 0.5; wx += step) {
      const sx = Math.round(wx * z + WB.cam.x) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, vh);
    }
    for (let wy = startY; wy <= maxWY + step * 0.5; wy += step) {
      const sy = Math.round(wy * z + WB.cam.y) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(vw, sy);
    }
    ctx.stroke();
  } else if (mode === 'grid-ruled') {
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let wy = startY; wy <= maxWY + step * 0.5; wy += step) {
      const sy = Math.round(wy * z + WB.cam.y) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(vw, sy);
    }
    ctx.stroke();
  } else if (mode === 'grid-dots') {
    ctx.fillStyle = gridColor;
    const dotR = Math.max(1.1, Math.min(2.1, 1.5 * Math.sqrt(z)));
    ctx.beginPath();
    for (let wx = startX; wx <= maxWX + step * 0.5; wx += step) {
      const sx = wx * z + WB.cam.x;
      for (let wy = startY; wy <= maxWY + step * 0.5; wy += step) {
        const sy = wy * z + WB.cam.y;
        ctx.moveTo(sx + dotR, sy);
        ctx.arc(sx, sy, dotR, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }
  ctx.restore();
};

WB.drawSnapAndLinearOverlay = function(ctx) {
  const z = WB.cam?.z || 1;
  const isDark = document.body.classList.contains('dark');
  const ringStroke = isDark ? '#f8fafc' : '#0f172a';
  const ringFill = isDark ? '#0f172a' : '#ffffff';

  const drawVertexRing = (pt) => {
    if (!pt) return;
    const r = 5.4 / z;
    ctx.save();
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    ctx.fillStyle = ringFill;
    ctx.fill();
    ctx.strokeStyle = ringStroke;
    ctx.lineWidth = 2.2 / z;
    ctx.stroke();
    ctx.restore();
  };

  const drawGridDot = (pt) => {
    if (!pt) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 3.2 / z, 0, Math.PI * 2);
    ctx.fillStyle = '#22c55e';
    ctx.fill();
    ctx.restore();
  };

  const drawAnchorPoint = (pt) => {
    if (!pt) return;
    const r = 5.4 / z;
    ctx.save();
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#0d9488';
    ctx.fill();
    ctx.strokeStyle = isDark ? '#0f172a' : '#ffffff';
    ctx.lineWidth = 2.2 / z;
    ctx.stroke();
    ctx.restore();
  };

  const st = WB.linearSnapState;
  if (st && st.active) {
    if (st.showPreviewLine && st.startPt && st.endPt) {
      const segLen = Math.hypot(st.endPt.x - st.startPt.x, st.endPt.y - st.startPt.y);
      if (st.pointToPoint && segLen > 1 / z) {
        const pickerColor = document.getElementById('colorPicker')?.value || (isDark ? '#f8fafc' : '#0f172a');
        const pickerSize = Number(document.getElementById('sizePicker')?.value) || 4;
        const isHl = WB.currentTool === 'highlighter';
        const lineW = isHl ? pickerSize * 3.2 : pickerSize;
        const activeStyle = WB.currentLineStyle || 'solid';
        const dash = activeStyle === 'solid'
          ? [8 / z, 5 / z]
          : (typeof WB.getLineDashPattern === 'function' ? WB.getLineDashPattern(activeStyle, lineW) : [8 / z, 5 / z]);

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = pickerColor;
        ctx.lineWidth = lineW;
        ctx.globalAlpha = isHl ? 0.28 : 0.72;
        ctx.setLineDash(dash);
        ctx.beginPath();
        ctx.moveTo(st.startPt.x, st.startPt.y);
        ctx.lineTo(st.endPt.x, st.endPt.y);
        ctx.stroke();
        ctx.setLineDash([]);

        if (WB.currentTool === 'arrow' && segLen > 8 / z) {
          const headLen = Math.max(12, Math.min(26, lineW * 3.8));
          const angle = Math.atan2(st.endPt.y - st.startPt.y, st.endPt.x - st.startPt.x);
          const spread = Math.PI / 7;
          ctx.beginPath();
          ctx.moveTo(st.endPt.x, st.endPt.y);
          ctx.lineTo(st.endPt.x - headLen * Math.cos(angle - spread), st.endPt.y - headLen * Math.sin(angle - spread));
          ctx.lineTo(st.endPt.x - headLen * Math.cos(angle + spread), st.endPt.y - headLen * Math.sin(angle + spread));
          ctx.closePath();
          ctx.fillStyle = pickerColor;
          ctx.fill();
        }
        ctx.restore();
      } else if (!st.pointToPoint) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(st.startPt.x, st.startPt.y);
        ctx.lineTo(st.endPt.x, st.endPt.y);
        ctx.setLineDash([6 / z, 4 / z]);
        ctx.strokeStyle = isDark ? 'rgba(248, 250, 252, 0.85)' : 'rgba(15, 23, 42, 0.78)';
        ctx.lineWidth = 1.6 / z;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    if (st.pointToPoint && st.chainStart && (st.segmentCount || 0) >= 2) {
      drawVertexRing(st.chainStart);
    }

    if (st.pointToPoint && st.startPt) {
      drawAnchorPoint(st.startPt);
    } else if (st.startPt && (st.startSource === 'vertex' || st.showPreviewLine)) {
      drawVertexRing(st.startPt);
    } else if (st.startPt && st.startSource === 'grid' && !st.showPreviewLine) {
      drawGridDot(st.startPt);
    }

    if (st.endPt) {
      if (st.endSource === 'vertex') {
        drawVertexRing(st.endPt);
      } else if (st.endSource === 'grid') {
        drawGridDot(st.endPt);
      } else if (st.pointToPoint) {
        const r = 3.4 / z;
        ctx.save();
        ctx.beginPath();
        ctx.arc(st.endPt.x, st.endPt.y, r, 0, Math.PI * 2);
        ctx.fillStyle = '#0d9488';
        ctx.globalAlpha = 0.75;
        ctx.fill();
        ctx.restore();
      }
    }
    return;
  }

  // Hover preview when not actively dragging
  if (WB.isPointerDrawing) return;
  const tool = WB.currentTool;
  if (!WB.autoShapeEnabled && (tool === 'hand' || tool === 'select' || tool === 'eraser' || tool === 'laser')) return;
  if (!WB.autoShapeEnabled && !WB.snapToGridEnabled) return;

  if (typeof WB.snapPointCombined === 'function') {
    const hoverSnap = WB.snapPointCombined(WB.mouseWorld, null, {
      snapToVertex: !!WB.autoShapeEnabled,
      snapToGrid: !!WB.snapToGridEnabled
    });
    if (hoverSnap.source === 'vertex') {
      drawVertexRing(hoverSnap);
    } else if (hoverSnap.source === 'grid') {
      drawGridDot(hoverSnap);
    }
  } else if (WB.snapToGridEnabled) {
    drawGridDot(WB.snapToGrid(WB.mouseWorld.x, WB.mouseWorld.y));
  }
};

WB.renderLoop = function() {
  if (WB.pdfEditor && WB.pdfEditor.isOpen) {
    requestAnimationFrame(WB.renderLoop);
    return;
  }
  const canvas = document.getElementById('board');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const gridCanvas = document.getElementById('gridCanvas');
  const gridCtx = gridCanvas ? gridCanvas.getContext('2d') : null;
  const sizePicker = document.getElementById('sizePicker');
  const dpr = window.devicePixelRatio || 1;
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = document.documentElement.clientHeight || window.innerHeight;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, vw, vh);

  // Отрисовка фоновой сетки на отдельном фоновом слое (#gridCanvas, z-index: 1),
  // строго позади #world-layer (виджеты/картинки/PDF), чтобы сетка никогда не просвечивала сквозь объекты
  if (gridCtx) {
    gridCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gridCtx.clearRect(0, 0, vw, vh);
    WB.drawBackgroundGrid(gridCtx, vw, vh);
  } else {
    WB.drawBackgroundGrid(ctx, vw, vh);
  }

  ctx.save();
  ctx.translate(WB.cam.x, WB.cam.y);
  ctx.scale(WB.cam.z, WB.cam.z);

  // Отрисовка всех векторных объектов (штрихи, фигуры, декартовы оси)
  for (const s of WB.state.strokes) {
    const isSelected = WB.selection.strokeIds.has(s.id);
    WB.drawStrokeObject(ctx, s, isSelected);
  }

  // Отрисовка рамки и маркеров выделения
  WB.drawSelectionOverlay(ctx);

  // Живой предпросмотр привязок и построений на активной 3D-фигуре (Точка · 3, Линия · 4, Плоскость · 5)
  if (typeof WB.draw3DEditorOverlay === 'function') {
    WB.draw3DEditorOverlay(ctx);
  }

  // Отрисовка лазерной указки
  const now = performance.now();
  WB.laserPoints = WB.laserPoints.filter(p => now - p.time < 900);
  if (WB.laserPoints.length > 1) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < WB.laserPoints.length; i++) {
      const p1 = WB.laserPoints[i - 1];
      const p2 = WB.laserPoints[i];
      if (Math.hypot(p2.x - p1.x, p2.y - p1.y) > 150) continue;
      const age = 1 - (now - p2.time) / 900;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.strokeStyle = `rgba(239, 68, 68, ${age})`;
      ctx.lineWidth = (8 * age) / WB.cam.z;
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 12;
      ctx.stroke();
    }
    ctx.restore();
  }

  // Курсор ластика
  if (WB.currentTool === 'eraser' && sizePicker) {
    ctx.beginPath();
    ctx.arc(WB.mouseWorld.x, WB.mouseWorld.y, (Number(sizePicker.value) * 3) / WB.cam.z, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(100,116,139,0.85)';
    ctx.lineWidth = 1.5 / WB.cam.z;
    ctx.stroke();
  }

  // Индикаторы привязки к узлам сетки и вершинам (Линейный режим + К узлам)
  WB.drawSnapAndLinearOverlay(ctx);

  ctx.restore();
  requestAnimationFrame(WB.renderLoop);
};

WB.drawSelectionOverlay = function(ctx) {
  if (WB.selection.marquee) {
    const m = WB.selection.marquee;
    const x = Math.min(m.x1, m.x2);
    const y = Math.min(m.y1, m.y2);
    const w = Math.abs(m.x2 - m.x1);
    const h = Math.abs(m.y2 - m.y1);

    ctx.save();
    ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1.5 / WB.cam.z;
    ctx.setLineDash([6 / WB.cam.z, 4 / WB.cam.z]);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  if (WB.selection.bounds) {
    const b = WB.selection.bounds;
    ctx.save();
    ctx.fillStyle = 'rgba(37, 99, 235, 0.04)';
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1.8 / WB.cam.z;
    ctx.setLineDash([8 / WB.cam.z, 5 / WB.cam.z]);
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeRect(b.x, b.y, b.w, b.h);

    // Квадратные маркеры масштабирования области по углам рамки
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2 / WB.cam.z;
    const hs = 9 / WB.cam.z;
    const corners = [
      [b.x, b.y], [b.x + b.w, b.y],
      [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]
    ];
    for (const [cx, cy] of corners) {
      ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
      ctx.strokeRect(cx - hs / 2, cy - hs / 2, hs, hs);
    }

    // Круглые маркеры на концах выделенных отрезков, вершинах и осях!
    if (typeof WB.getEditableVertices === 'function') {
      const r = 5.5 / WB.cam.z;
      ctx.fillStyle = '#eff6ff';
      ctx.strokeStyle = '#1d4ed8';
      ctx.lineWidth = 2.2 / WB.cam.z;
      for (const s of WB.state.strokes) {
        if (!WB.selection.strokeIds.has(s.id) || s.locked) continue;
        const handles = WB.getEditableVertices(s);
        for (const h of handles) {
          ctx.beginPath();
          ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    ctx.restore();
  }
};

WB.draw3DEditorOverlay = function(ctx) {
  if (WB.currentTool !== 'select' || !WB.s3dEditor || typeof WB.getActive3DStroke !== 'function') return;
  const active3d = WB.getActive3DStroke();
  if (!active3d) return;

  const mode = WB.s3dEditor.mode;
  if (mode !== 'point' && mode !== 'line' && mode !== 'plane') return;

  const prim = WB.get3DShapePrimitives(active3d);
  if (!prim) return;

  const b = WB.selection?.bounds || WB.getStrokeBounds(active3d);
  const wx = WB.mouseWorld.x;
  const wy = WB.mouseWorld.y;
  const pad = 28 / (WB.cam?.z || 1);
  const inside = wx >= b.x - pad && wx <= b.x + b.w + pad && wy >= b.y - pad && wy <= b.y + b.h + pad;

  const refMap = {};
  for (const v of (prim.vertices2d || [])) refMap[v.id] = v;
  for (const cp of (prim.customPoints2d || [])) refMap[cp.id] = cp;

  const pendingPts = (WB.s3dEditor.pendingPointRefs || []).map(r => refMap[r]).filter(Boolean);

  let target = null;
  if (inside) {
    const anchor = (mode === 'line' || mode === 'plane')
      ? WB.findNearest3DAnchor(active3d, wx, wy, 28 / (WB.cam?.z || 1))
      : null;
    if (anchor) {
      target = { x: anchor.x, y: anchor.y, snapLabel: anchor.label || null, isAnchor: true };
    } else {
      const snap = WB.snapPointOn3DFigure(active3d, wx, wy);
      if (snap && typeof snap.edgeIdx === 'number' && prim.edges3d[snap.edgeIdx]) {
        const edge = prim.edges3d[snap.edgeIdx];
        target = {
          x: edge.a2d.x + (edge.b2d.x - edge.a2d.x) * snap.t,
          y: edge.a2d.y + (edge.b2d.y - edge.a2d.y) * snap.t,
          snapLabel: snap.snapLabel || null,
          isEdge: true
        };
      } else {
        target = { x: wx, y: wy, snapLabel: null, isEdge: false };
      }
    }
  }

  const z = WB.cam?.z || 1;
  ctx.save();

  // Предпросмотр строящейся линии (Линия · 4) или плоскости сечения (Плоскость · 5)
  if (mode === 'line' && pendingPts.length === 1 && target) {
    ctx.beginPath();
    ctx.moveTo(pendingPts[0].x, pendingPts[0].y);
    ctx.lineTo(target.x, target.y);
    ctx.setLineDash([6 / z, 4 / z]);
    ctx.strokeStyle = '#0d9488';
    ctx.lineWidth = 2.2 / z;
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (mode === 'plane' && pendingPts.length >= 1) {
    const polyPts = target ? [...pendingPts, target] : [...pendingPts];
    if (polyPts.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(polyPts[0].x, polyPts[0].y);
      for (let i = 1; i < polyPts.length; i++) ctx.lineTo(polyPts[i].x, polyPts[i].y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(13, 148, 136, 0.14)';
      ctx.fill();
      ctx.setLineDash([6 / z, 4 / z]);
      ctx.strokeStyle = '#0d9488';
      ctx.lineWidth = 2 / z;
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (polyPts.length === 2) {
      ctx.beginPath();
      ctx.moveTo(polyPts[0].x, polyPts[0].y);
      ctx.lineTo(polyPts[1].x, polyPts[1].y);
      ctx.setLineDash([6 / z, 4 / z]);
      ctx.strokeStyle = '#0d9488';
      ctx.lineWidth = 2 / z;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Живое кольцо прицела и бейдж доли ребра (1/2, 1/3, 2/3, 1/4, 3/4)
  if (target) {
    const outerR = (target.isAnchor ? 7 : 5.2) / z;
    ctx.beginPath();
    ctx.arc(target.x, target.y, outerR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.fill();
    ctx.strokeStyle = '#0d9488';
    ctx.lineWidth = 2 / z;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(target.x, target.y, 2.2 / z, 0, Math.PI * 2);
    ctx.fillStyle = '#0d9488';
    ctx.fill();

    if (target.snapLabel) {
      const labelText = String(target.snapLabel);
      ctx.font = `700 ${11 / z}px "Inter", "Segoe UI", sans-serif`;
      const tw = ctx.measureText(labelText).width;
      const bw = tw + 10 / z;
      const bh = 18 / z;
      const bx = target.x + 10 / z;
      const by = target.y - bh - 6 / z;
      const rr = 5 / z;

      ctx.beginPath();
      ctx.moveTo(bx + rr, by);
      ctx.lineTo(bx + bw - rr, by);
      ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + rr);
      ctx.lineTo(bx + bw, by + bh - rr);
      ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - rr, by + bh);
      ctx.lineTo(bx + rr, by + bh);
      ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - rr);
      ctx.lineTo(bx, by + rr);
      ctx.quadraticCurveTo(bx, by, bx + rr, by);
      ctx.closePath();
      ctx.fillStyle = '#0f172a';
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labelText, bx + bw / 2, by + bh / 2);
    }
  }

  ctx.restore();
};

WB.getLineDashPattern = function(style, size = 4) {
  const w = Math.max(2, Number(size) || 4);
  if (style === 'dashed') return [Math.max(8, w * 2.5), Math.max(6, w * 1.8)];
  if (style === 'dotted') return [Math.max(1, w * 0.25), Math.max(6, w * 2.1)];
  if (style === 'dashdot') return [Math.max(9, w * 2.6), Math.max(5, w * 1.6), Math.max(1, w * 0.3), Math.max(5, w * 1.6)];
  return [];
};

WB.drawStrokeObject = function(c, s, isSelected = false) {
  c.save();
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.strokeStyle = s.color;

  const isHl = s.type === 'highlighter' || s.isHighlighter;
  c.lineWidth = isHl ? (s.size || 4) * 3.2 : (s.size || 4);
  c.globalAlpha = isHl ? 0.34 : 1.0;
  if (WB.linearSnapState && WB.linearSnapState.active && WB.linearSnapState.showPreviewLine && s.id === WB.linearSnapState.strokeId) {
    c.globalAlpha *= 0.25;
  }

  const strokeDash = WB.getLineDashPattern(s.lineStyle || 'solid', c.lineWidth);
  c.setLineDash(strokeDash);

  if (isSelected) {
    c.shadowColor = '#2563eb';
    c.shadowBlur = 8;
  }

  c.beginPath();

  if (s.type === 'axes') {
    c.setLineDash([]);
    // --- ДЕКАРТОВА СИСТЕМА КООРДИНАТ БЕЗ ПОДПИСИ НАЗВАНИЙ ОСЕЙ ---
    const geom = WB.getAxesGeometry(s);
    const step = geom.step;
    const tickLen = 5.5 / WB.cam.z;
    const hLen = 13 / WB.cam.z;

    // Горизонтальная ось X (от geom.xAxis.from.x до geom.xAxis.to.x)
    c.moveTo(geom.xAxis.from.x, geom.origin.y);
    c.lineTo(geom.xAxis.to.x, geom.origin.y);

    // Вертикальная ось Y (от geom.yAxis.from.y до geom.yAxis.to.y)
    c.moveTo(geom.origin.x, geom.yAxis.from.y);
    c.lineTo(geom.origin.x, geom.yAxis.to.y);
    c.stroke();

    // Стрелочка оси X (направо)
    c.beginPath();
    c.moveTo(geom.xAxis.to.x, geom.origin.y);
    c.lineTo(geom.xAxis.to.x - hLen, geom.origin.y - hLen * 0.42);
    c.moveTo(geom.xAxis.to.x, geom.origin.y);
    c.lineTo(geom.xAxis.to.x - hLen, geom.origin.y + hLen * 0.42);
    c.stroke();

    // Стрелочка оси Y (наверх)
    c.beginPath();
    c.moveTo(geom.origin.x, geom.yAxis.to.y);
    c.lineTo(geom.origin.x - hLen * 0.42, geom.yAxis.to.y + hLen);
    c.moveTo(geom.origin.x, geom.yAxis.to.y);
    c.lineTo(geom.origin.x + hLen * 0.42, geom.yAxis.to.y + hLen);
    c.stroke();

    // Деления (засечки единичных отрезков) без букв X и Y
    c.beginPath();
    // По горизонтальной оси
    for (let x = geom.origin.x + step; x < geom.xAxis.to.x - 14; x += step) {
      c.moveTo(x, geom.origin.y - tickLen);
      c.lineTo(x, geom.origin.y + tickLen);
    }
    for (let x = geom.origin.x - step; x > geom.xAxis.from.x + 8; x -= step) {
      c.moveTo(x, geom.origin.y - tickLen);
      c.lineTo(x, geom.origin.y + tickLen);
    }
    // По вертикальной оси
    for (let y = geom.origin.y - step; y > geom.yAxis.to.y + 14; y -= step) {
      c.moveTo(geom.origin.x - tickLen, y);
      c.lineTo(geom.origin.x + tickLen, y);
    }
    for (let y = geom.origin.y + step; y < geom.yAxis.from.y - 8; y += step) {
      c.moveTo(geom.origin.x - tickLen, y);
      c.lineTo(geom.origin.x + tickLen, y);
    }
    c.stroke();

    // Точка начала координат O (0,0)
    c.beginPath();
    c.arc(geom.origin.x, geom.origin.y, 2.8 / WB.cam.z, 0, Math.PI * 2);
    c.fillStyle = s.color;
    c.fill();

  } else if (s.type === 'polygon' && s.vertices && s.vertices.length > 1) {
    c.moveTo(s.vertices[0].x, s.vertices[0].y);
    for (let i = 1; i < s.vertices.length; i++) {
      c.lineTo(s.vertices[i].x, s.vertices[i].y);
    }
    if (s.closed) {
      c.closePath();
      if (s.fillColor && s.fillColor !== 'transparent') {
        c.save();
        c.fillStyle = s.fillColor;
        c.fill();
        c.restore();
      }
    }
    c.stroke();
  } else if (s.points) {
    const pts = s.points;
    if (pts.length === 1) {
      c.setLineDash([]);
      c.arc(pts[0].x, pts[0].y, c.lineWidth / 2, 0, Math.PI * 2);
      c.fillStyle = s.color;
      c.fill();
    } else if (pts.length > 1) {
      c.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const midX = (pts[i].x + pts[i + 1].x) / 2;
        const midY = (pts[i].y + pts[i + 1].y) / 2;
        c.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
      }
      c.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      c.stroke();
    }
  } else if (s.type === 'line') {
    c.moveTo(s.x1, s.y1);
    c.lineTo(s.x2, s.y2);
    c.stroke();
  } else if (s.type === 'arrow') {
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    if (Math.hypot(dx, dy) > 1) {
      const g = typeof WB.getArrowHeadGeometry === 'function'
        ? WB.getArrowHeadGeometry(s.x1, s.y1, s.x2, s.y2, s.size || 4)
        : (() => {
            const ang = Math.atan2(dy, dx);
            const hl = Math.max(15, (s.size || 4) * 3.8);
            const ha = Math.PI / 7.5;
            return {
              tip: { x: s.x2, y: s.y2 },
              baseLeft: { x: s.x2 - hl * Math.cos(ang - ha), y: s.y2 - hl * Math.sin(ang - ha) },
              baseRight: { x: s.x2 - hl * Math.cos(ang + ha), y: s.y2 - hl * Math.sin(ang + ha) },
              shaftEnd: { x: s.x2 - hl * Math.cos(ha) * 0.9 * Math.cos(ang), y: s.y2 - hl * Math.cos(ha) * 0.9 * Math.sin(ang) }
            };
          })();

      c.moveTo(s.x1, s.y1);
      c.lineTo(g.shaftEnd.x, g.shaftEnd.y);
      c.stroke();

      c.setLineDash([]);
      c.beginPath();
      c.moveTo(g.tip.x, g.tip.y);
      c.lineTo(g.baseLeft.x, g.baseLeft.y);
      c.lineTo(g.baseRight.x, g.baseRight.y);
      c.closePath();
      c.fillStyle = s.color;
      c.fill();
    } else {
      c.moveTo(s.x1, s.y1);
      c.lineTo(s.x2, s.y2);
      c.stroke();
    }
  } else if (s.type === 'ellipse' || s.type === 'circle' || s.type === 'unit_circle') {
    const b = typeof WB.getNormalizedShapeBox === 'function'
      ? WB.getNormalizedShapeBox(s)
      : {
          minX: Math.min(s.x1, s.x2),
          maxX: Math.max(s.x1, s.x2),
          minY: Math.min(s.y1, s.y2),
          maxY: Math.max(s.y1, s.y2),
          w: Math.abs(s.x2 - s.x1),
          h: Math.abs(s.y2 - s.y1),
          cx: (s.x1 + s.x2) / 2,
          cy: (s.y1 + s.y2) / 2
        };
    const rx = Math.max(1, b.w / 2);
    const ry = Math.max(1, b.h / 2);
    c.beginPath();
    c.ellipse(b.cx, b.cy, rx, ry, 0, 0, Math.PI * 2);
    if (s.fillColor && s.fillColor !== 'transparent') {
      c.save();
      c.fillStyle = s.fillColor;
      c.fill();
      c.restore();
    }
    c.stroke();

    if (s.type === 'unit_circle') {
      const ext = Math.max(14, Math.min(rx, ry) * 0.22);
      const hLen = 11 / WB.cam.z;
      const xStart = b.minX - ext;
      const xEnd = b.maxX + ext;
      const yStart = b.maxY + ext;
      const yEnd = b.minY - ext;

      c.beginPath();
      c.moveTo(xStart, b.cy);
      c.lineTo(xEnd, b.cy);
      c.moveTo(b.cx, yStart);
      c.lineTo(b.cx, yEnd);
      c.stroke();

      // Стрелки осей тригонометрического круга
      c.beginPath();
      c.moveTo(xEnd, b.cy);
      c.lineTo(xEnd - hLen, b.cy - hLen * 0.42);
      c.moveTo(xEnd, b.cy);
      c.lineTo(xEnd - hLen, b.cy + hLen * 0.42);
      c.moveTo(b.cx, yEnd);
      c.lineTo(b.cx - hLen * 0.42, yEnd + hLen);
      c.moveTo(b.cx, yEnd);
      c.lineTo(b.cx + hLen * 0.42, yEnd + hLen);
      c.stroke();

      // Точки на окружности (0, π/2, π, 3π/2 и ключевые углы 30°, 45°, 60°)
      const dotR = Math.max(2.2, (s.size || 3) * 0.72);
      const keyAngles = [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330];
      c.fillStyle = s.color;
      for (const deg of keyAngles) {
        const rad = (deg * Math.PI) / 180;
        const px = b.cx + rx * Math.cos(rad);
        const py = b.cy - ry * Math.sin(rad);
        c.beginPath();
        c.arc(px, py, deg % 90 === 0 ? dotR * 1.25 : dotR * 0.85, 0, Math.PI * 2);
        c.fill();
      }
    }
  } else if (typeof WB.get2DShapeVertices === 'function' && WB.get2DShapeVertices(s)) {
    const verts = WB.get2DShapeVertices(s);
    if (verts.length > 1) {
      c.beginPath();
      c.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) {
        c.lineTo(verts[i].x, verts[i].y);
      }
      c.closePath();
      if (s.fillColor && s.fillColor !== 'transparent') {
        c.save();
        c.fillStyle = s.fillColor;
        c.fill();
        c.restore();
      }
      c.stroke();
    }
  } else if (typeof WB.get3DShapePrimitives === 'function' && WB.get3DShapePrimitives(s)) {
    const prim = WB.get3DShapePrimitives(s);
    const dashStep = Math.max(5, (s.size || 3) * 1.8);
    const b = WB.getNormalizedShapeBox(s);

    // 1. Заливка видимых граней в фирменном светло-бирюзовом оттенке (стр. 1–6 референса)
    if (prim.cfg && prim.cfg.showFaces && s.type !== 'sphere') {
      c.save();
      c.setLineDash([]);
      c.fillStyle = document.body.classList.contains('dark')
        ? 'rgba(45, 212, 191, 0.14)'
        : 'rgba(94, 234, 212, 0.20)';
      c.globalAlpha = 1;
      if (Array.isArray(prim.filledFaces)) {
        for (const face of prim.filledFaces) {
          if (!face || face.length < 3) continue;
          c.beginPath();
          c.moveTo(face[0].x, face[0].y);
          for (let i = 1; i < face.length; i++) {
            c.lineTo(face[i].x, face[i].y);
          }
          c.closePath();
          c.fill();
        }
      }
      for (const arc of prim.arcs) {
        if (arc.fill) {
          c.beginPath();
          c.ellipse(arc.cx, arc.cy, Math.max(1, arc.rx), Math.max(1, arc.ry), 0, 0, Math.PI * 2);
          c.fill();
        }
      }
      c.restore();
    }

    // 2. Построенные плоскости сечений (Плоскость · 5)
    if (Array.isArray(prim.customPlanes2d) && prim.customPlanes2d.length > 0) {
      c.save();
      for (const pl of prim.customPlanes2d) {
        if (!pl.points || pl.points.length < 3) continue;
        c.beginPath();
        c.moveTo(pl.points[0].x, pl.points[0].y);
        for (let i = 1; i < pl.points.length; i++) {
          c.lineTo(pl.points[i].x, pl.points[i].y);
        }
        c.closePath();
        c.fillStyle = 'rgba(13, 148, 136, 0.22)';
        c.fill();
        c.setLineDash([]);
        c.lineWidth = Math.max(2, (s.size || 3) * 0.85);
        c.strokeStyle = '#0d9488';
        c.stroke();
      }
      c.restore();
    }

    // 2b. Пространственные диагонали (чекбокс «Диагонали» для куба и параллелепипеда)
    if (Array.isArray(prim.diagonalLines) && prim.diagonalLines.length > 0) {
      c.save();
      c.strokeStyle = document.body.classList.contains('dark')
        ? 'rgba(45, 212, 191, 0.78)'
        : 'rgba(13, 148, 136, 0.74)';
      c.lineWidth = Math.max(1.4, (s.size || 2.5) * 0.65);
      c.setLineDash([5, 4]);
      for (const diag of prim.diagonalLines) {
        if (!diag || diag.length < 2) continue;
        c.beginPath();
        c.moveTo(diag[0].x, diag[0].y);
        c.lineTo(diag[1].x, diag[1].y);
        c.stroke();
      }
      c.restore();
    }

    // 3. Сплошные видимые рёбра
    c.setLineDash([]);
    for (const poly of prim.solidLines) {
      if (!poly || poly.length < 2) continue;
      c.beginPath();
      c.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) {
        c.lineTo(poly[i].x, poly[i].y);
      }
      c.stroke();
    }

    // 4. Невидимые задние рёбра (пунктиром)
    c.setLineDash([dashStep, dashStep * 0.85]);
    for (const poly of prim.dashedLines) {
      if (!poly || poly.length < 2) continue;
      c.beginPath();
      c.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) {
        c.lineTo(poly[i].x, poly[i].y);
      }
      c.stroke();
    }

    // 5. Дуги и эллипсы (для цилиндра, конуса и сферы)
    for (const arc of prim.arcs) {
      c.setLineDash(arc.dashed ? [dashStep, dashStep * 0.85] : []);
      c.beginPath();
      c.ellipse(arc.cx, arc.cy, Math.max(1, arc.rx), Math.max(1, arc.ry), 0, arc.start, arc.end);
      c.stroke();
    }
    c.setLineDash([]);

    // 6. Построенные дополнительные отрезки (Линия · 4)
    if (Array.isArray(prim.customLines2d) && prim.customLines2d.length > 0) {
      c.save();
      c.strokeStyle = '#0d9488';
      c.lineWidth = Math.max(2.2, (s.size || 3) * 0.9);
      c.setLineDash([]);
      for (const cl of prim.customLines2d) {
        c.beginPath();
        c.moveTo(cl.a.x, cl.a.y);
        c.lineTo(cl.b.x, cl.b.y);
        c.stroke();
      }
      c.restore();
    }

    // 7. Подписи вершин и построенные точки (P, Q, R, T...)
    const showLabels = !prim.cfg || prim.cfg.showLabels !== false;
    const pendingRefs = (WB.s3dEditor && WB.s3dEditor.strokeId === s.id && Array.isArray(WB.s3dEditor.pendingPointRefs))
      ? new Set(WB.s3dEditor.pendingPointRefs)
      : null;

    if (showLabels && Array.isArray(prim.vertices2d)) {
      c.save();
      c.font = '500 13.5px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      c.fillStyle = document.body.classList.contains('dark') ? '#e2e8f0' : '#334155';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      for (const v of prim.vertices2d) {
        if (!v.label || v.hideDefaultLabel) continue;
        let lx, ly;
        if (v.label === 'O' || v.label === 'O₁') {
          lx = v.x - 11;
          ly = v.y - 10;
        } else {
          const refCx = prim.cx ?? b.cx;
          const refCy = prim.cy ?? b.cy;
          const dx = v.x - refCx;
          const dy = v.y - refCy;
          const dist = Math.hypot(dx, dy);
          if (dist < 2) {
            lx = v.x - 11;
            ly = v.y - 10;
          } else {
            lx = v.x + (dx / dist) * 14;
            ly = v.y + (dy / dist) * 14;
          }
        }
        c.fillText(v.label, lx, ly);
        if (pendingRefs && pendingRefs.has(v.id)) {
          c.beginPath();
          c.arc(v.x, v.y, 6, 0, Math.PI * 2);
          c.strokeStyle = '#0d9488';
          c.lineWidth = 2;
          c.stroke();
        }
      }
      c.restore();
    }

    if (Array.isArray(prim.customPoints2d) && prim.customPoints2d.length > 0) {
      c.save();
      c.font = '700 13px "Inter", "Segoe UI", sans-serif';
      c.textAlign = 'left';
      c.textBaseline = 'bottom';
      for (const cp of prim.customPoints2d) {
        const isPending = pendingRefs && pendingRefs.has(cp.id);
        c.beginPath();
        c.arc(cp.x, cp.y, isPending ? 6.5 : 4.5, 0, Math.PI * 2);
        c.fillStyle = '#ffffff';
        c.fill();
        c.lineWidth = 2;
        c.strokeStyle = isPending ? '#0f766e' : '#0d9488';
        c.stroke();

        c.beginPath();
        c.arc(cp.x, cp.y, 2, 0, Math.PI * 2);
        c.fillStyle = '#0d9488';
        c.fill();

        if (showLabels && cp.label) {
          c.fillStyle = '#0f766e';
          c.fillText(cp.label, cp.x + 7, cp.y - 5);
        }
      }
      c.restore();
    }
  }

  // Зеленые индикаторы липких стрелок к виджетам
  if (s.startBind || s.endBind) {
    c.globalAlpha = 1.0;
    c.fillStyle = '#16a34a';
    if (s.startBind) {
      c.beginPath();
      c.arc(s.x1, s.y1, 4.5, 0, Math.PI * 2);
      c.fill();
    }
    if (s.endBind) {
      c.beginPath();
      c.arc(s.x2, s.y2, 4.5, 0, Math.PI * 2);
      c.fill();
    }
  }

  c.restore();
};
