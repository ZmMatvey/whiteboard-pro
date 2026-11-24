window.WB = window.WB || {};

WB.toWorld = function(sx, sy) {
  const canvas = document.getElementById('board');
  let localX = sx;
  let localY = sy;
  if (canvas) {
    const rect = canvas.getBoundingClientRect();
    localX = sx - rect.left;
    localY = sy - rect.top;
  }
  return {
    x: (localX - WB.cam.x) / WB.cam.z,
    y: (localY - WB.cam.y) / WB.cam.z
  };
};

WB.distToSegment = function(px, py, x1, y1, x2, y2) {
  const A = px - x1, B = py - y1, C = x2 - x1, D = y2 - y1;
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = lenSq !== 0 ? dot / lenSq : -1;
  let xx, yy;
  if (param < 0) { xx = x1; yy = y1; }
  else if (param > 1) { xx = x2; yy = y2; }
  else { xx = x1 + param * C; yy = y1 + param * D; }
  return Math.hypot(px - xx, py - yy);
};

// --- SNAP TO GRID (ПРИВЯЗКА К УЗЛАМ СЕТКИ С УЧЁТОМ МАСШТАБА) ---
WB.getEffectiveGridSize = function(zoom = (WB.cam?.z || 1), baseGridSize = (WB.gridSize || 32)) {
  const base = baseGridSize > 0 ? baseGridSize : 32;
  const safeZ = zoom > 0 ? zoom : 1;
  let step = base;
  while (step * safeZ < 12) {
    step *= 2;
  }
  return step;
};

WB.snapToGrid = function(x, y, gridSize = null) {
  const size = (typeof gridSize === 'number' && gridSize > 0)
    ? gridSize
    : WB.getEffectiveGridSize(WB.cam?.z || 1, WB.gridSize || 32);
  return {
    x: Math.round(x / size) * size,
    y: Math.round(y / size) * size
  };
};

// --- СБОР ВСЕХ ВЕРШИН И ТОЧЕК ПРИВЯЗКИ НА ДОСКЕ ДЛЯ ЛИНЕЙНОГО РЕЖИМА ---
WB.collectSnapVertices = function(excludeStrokeId = null) {
  const pts = [];
  const seen = new Set();
  const pushPt = (x, y, strokeId, label = '') => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const key = `${Math.round(x * 10)}_${Math.round(y * 10)}`;
    if (seen.has(key)) return;
    seen.add(key);
    pts.push({ x, y, strokeId, label });
  };

  for (const s of (WB.state?.strokes || [])) {
    if (!s || (excludeStrokeId !== null && s.id === excludeStrokeId)) continue;

    if (s.type === 'line' || s.type === 'arrow') {
      pushPt(s.x1, s.y1, s.id);
      pushPt(s.x2, s.y2, s.id);
      continue;
    }

    if (s.type === 'polygon' && Array.isArray(s.vertices)) {
      for (const v of s.vertices) pushPt(v.x, v.y, s.id);
      continue;
    }

    if (s.type === 'axes' && typeof WB.getAxesGeometry === 'function') {
      const g = WB.getAxesGeometry(s);
      pushPt(g.origin.x, g.origin.y, s.id, 'O');
      pushPt(g.xAxis.from.x, g.xAxis.from.y, s.id);
      pushPt(g.xAxis.to.x, g.xAxis.to.y, s.id);
      pushPt(g.yAxis.from.x, g.yAxis.from.y, s.id);
      pushPt(g.yAxis.to.x, g.yAxis.to.y, s.id);
      continue;
    }

    if (typeof WB.is3DShapeStroke === 'function' && WB.is3DShapeStroke(s)) {
      const prim = WB.get3DShapePrimitives(s);
      if (prim) {
        for (const v of (prim.vertices2d || [])) pushPt(v.x, v.y, s.id, v.label || '');
        for (const cp of (prim.customPoints2d || [])) pushPt(cp.x, cp.y, s.id, cp.label || '');
      }
      continue;
    }

    if (typeof WB.get2DShapeVertices === 'function') {
      const verts2d = WB.get2DShapeVertices(s);
      if (verts2d && verts2d.length > 0) {
        for (const v of verts2d) pushPt(v.x, v.y, s.id);
        continue;
      }
    }

    if (s.type === 'circle' || s.type === 'ellipse' || s.type === 'unit_circle') {
      const b = WB.getNormalizedShapeBox(s);
      pushPt(b.cx, b.cy, s.id);
      pushPt(b.cx, b.minY, s.id);
      pushPt(b.maxX, b.cy, s.id);
      pushPt(b.cx, b.maxY, s.id);
      pushPt(b.minX, b.cy, s.id);
      continue;
    }

    if (Array.isArray(s.points) && s.points.length >= 2) {
      pushPt(s.points[0].x, s.points[0].y, s.id);
      pushPt(s.points[s.points.length - 1].x, s.points[s.points.length - 1].y, s.id);
    }
  }
  return pts;
};

WB.findNearestSnapVertex = function(pt, vertices, maxDist) {
  if (!pt || !Array.isArray(vertices) || vertices.length === 0 || maxDist <= 0) return null;
  let best = null;
  let bestDist = maxDist;
  for (const v of vertices) {
    const d = Math.hypot(pt.x - v.x, pt.y - v.y);
    if (d <= bestDist) {
      bestDist = d;
      best = v;
    }
  }
  return best;
};

WB.snapPointCombined = function(rawPt, excludeStrokeId = null, opts = {}) {
  const z = WB.cam?.z || 1;
  const vertexRadius = opts.vertexRadius ?? (14 / z);
  const snapToVertex = opts.snapToVertex !== undefined ? !!opts.snapToVertex : !!WB.autoShapeEnabled;
  const snapToGridFlag = opts.snapToGrid !== undefined ? !!opts.snapToGrid : !!WB.snapToGridEnabled;
  const gridSize = opts.gridSize || WB.getEffectiveGridSize(z, WB.gridSize || 32);

  if (snapToVertex) {
    const vertices = opts.vertices || WB.collectSnapVertices(excludeStrokeId);
    const hit = WB.findNearestSnapVertex(rawPt, vertices, vertexRadius);
    if (hit) {
      return { x: hit.x, y: hit.y, source: 'vertex', vertex: hit };
    }
  }

  if (snapToGridFlag) {
    const g = WB.snapToGrid(rawPt.x, rawPt.y, gridSize);
    return { x: g.x, y: g.y, source: 'grid', vertex: null };
  }

  return { x: rawPt.x, y: rawPt.y, source: 'none', vertex: null };
};

WB.computeLinearSnappedEndpoint = function(startPt, rawEndPt, excludeStrokeId = null, opts = {}) {
  const z = WB.cam?.z || 1;
  const vertexRadius = opts.vertexRadius ?? (14 / z);
  const snapToVertex = opts.snapToVertex !== undefined ? !!opts.snapToVertex : !!WB.autoShapeEnabled;
  const snapToGridFlag = opts.snapToGrid !== undefined ? !!opts.snapToGrid : !!WB.snapToGridEnabled;
  const forceAngleSnap = !!opts.forceAngleSnap;
  const gridSize = opts.gridSize || WB.getEffectiveGridSize(z, WB.gridSize || 32);

  if (snapToVertex) {
    const vertices = opts.vertices || WB.collectSnapVertices(excludeStrokeId);
    const hit = WB.findNearestSnapVertex(rawEndPt, vertices, vertexRadius);
    if (hit) {
      return { x: hit.x, y: hit.y, source: 'vertex', vertex: hit };
    }
  }

  if (snapToGridFlag) {
    const candidate = forceAngleSnap
      ? WB.snapAngle(startPt.x, startPt.y, rawEndPt.x, rawEndPt.y, 15, 7)
      : rawEndPt;
    const g = WB.snapToGrid(candidate.x, candidate.y, gridSize);
    return { x: g.x, y: g.y, source: 'grid', vertex: null };
  }

  if (snapToVertex || forceAngleSnap) {
    const stepDeg = forceAngleSnap ? 15 : 45;
    const tolDeg = forceAngleSnap ? 7 : 4.2;
    const ang = WB.snapAngle(startPt.x, startPt.y, rawEndPt.x, rawEndPt.y, stepDeg, tolDeg);
    if (ang.x !== rawEndPt.x || ang.y !== rawEndPt.y) {
      return { x: ang.x, y: ang.y, source: 'angle', vertex: null };
    }
  }

  return { x: rawEndPt.x, y: rawEndPt.y, source: 'none', vertex: null };
};

// --- ANGLE SNAPPING (УГЛОВОЕ ЗАЛИПАНИЕ КАК В MS WHITEBOARD) ---
WB.snapAngle = function(x1, y1, x2, y2, stepDeg = 15, toleranceDeg = 5.5) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 5) return { x: x2, y: y2 };

  const angleRad = Math.atan2(dy, dx);
  let angleDeg = (angleRad * 180) / Math.PI;
  if (angleDeg < 0) angleDeg += 360;

  const nearestStep = Math.round(angleDeg / stepDeg) * stepDeg;
  const diff = Math.abs(angleDeg - nearestStep);

  if (diff <= toleranceDeg || diff >= 360 - toleranceDeg) {
    const targetRad = ((nearestStep % 360) * Math.PI) / 180;
    return {
      x: x1 + dist * Math.cos(targetRad),
      y: y1 + dist * Math.sin(targetRad)
    };
  }

  return { x: x2, y: y2 };
};

// --- ДЕКАРТОВА СИСТЕМА КООРДИНАТ (БЕЗ ПОДПИСИ НАЗВАНИЙ ОСЕЙ) ---
WB.getAxesGeometry = function(s) {
  const minX = Math.min(s.x1, s.x2);
  const maxX = Math.max(s.x1, s.x2);
  const minY = Math.min(s.y1, s.y2);
  const maxY = Math.max(s.y1, s.y2);

  // Центр начала координат O
  const ox = s.ox !== undefined ? s.ox : (minX + maxX) / 2;
  const oy = s.oy !== undefined ? s.oy : (minY + maxY) / 2;
  const step = s.step && s.step >= 16 ? s.step : (WB.gridSize || 32);

  return {
    origin: { x: ox, y: oy },
    xAxis: {
      from: { x: minX, y: oy },
      to: { x: maxX, y: oy }
    },
    yAxis: {
      from: { x: ox, y: maxY },
      to: { x: ox, y: minY } // Наверх, к меньшему Y
    },
    step,
    bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  };
};

WB.getStrokeBounds = function(s) {
  const pad = (s.size || 4) / 2 + 6;
  if (s.type === 'axes') {
    const minX = Math.min(s.x1, s.x2);
    const minY = Math.min(s.y1, s.y2);
    const maxX = Math.max(s.x1, s.x2);
    const maxY = Math.max(s.y1, s.y2);
    return { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
  }

  if (typeof WB.is3DShapeStroke === 'function' && WB.is3DShapeStroke(s) && typeof WB.get3DShapePrimitives === 'function') {
    const prim = WB.get3DShapePrimitives(s);
    if (prim) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const includePt = (x, y) => {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      };
      for (const poly of prim.solidLines) for (const p of poly) includePt(p.x, p.y);
      for (const poly of prim.dashedLines) for (const p of poly) includePt(p.x, p.y);
      for (const arc of prim.arcs) {
        includePt(arc.cx - arc.rx, arc.cy - arc.ry);
        includePt(arc.cx + arc.rx, arc.cy + arc.ry);
      }
      for (const cp of prim.customPoints2d) includePt(cp.x, cp.y);
      if (isFinite(minX)) {
        const extraPad = pad + 8;
        return {
          x: minX - extraPad,
          y: minY - extraPad,
          w: Math.max(20, (maxX - minX) + extraPad * 2),
          h: Math.max(20, (maxY - minY) + extraPad * 2)
        };
      }
    }
  }

  const ptsList = s.vertices || s.points;
  if (ptsList && ptsList.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of ptsList) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
  } else if (typeof WB.getNormalizedShapeBox === 'function') {
    const b = WB.getNormalizedShapeBox(s);
    const extra = s.type === 'unit_circle' ? Math.max(14, Math.min(b.w, b.h) * 0.11) : 0;
    return {
      x: b.minX - pad - extra,
      y: b.minY - pad - extra,
      w: b.w + (pad + extra) * 2,
      h: b.h + (pad + extra) * 2
    };
  } else {
    const minX = Math.min(s.x1, s.x2);
    const minY = Math.min(s.y1, s.y2);
    const maxX = Math.max(s.x1, s.x2);
    const maxY = Math.max(s.y1, s.y2);
    return { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
  }
};

WB.getWidgetBounds = function(w) {
  return { x: w.x, y: w.y, w: w.w, h: w.h };
};

WB.getAllContentBounds = function() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let count = 0;

  for (const s of WB.state.strokes) {
    const b = WB.getStrokeBounds(s);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
    count++;
  }
  for (const w of WB.state.widgets) {
    const b = WB.getWidgetBounds(w);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
    count++;
  }
  if (count === 0) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};

WB.boxesIntersect = function(a, b) {
  return !(b.x > a.x + a.w || b.x + b.w < a.x || b.y > a.y + a.h || b.y + b.h < a.y);
};

WB.pointInBox = function(x, y, box) {
  if (!box) return false;
  return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
};

// --- ГЕОМЕТРИЯ 2D И 3D ФИГУР (СТЕРЕОМЕТРИЯ И ПЛАНИМЕТРИЯ LEARNBOARD) ---
WB.ALL_SHAPE_TYPES = [
  'line', 'arrow', 'axes',
  'rect', 'square', 'ellipse', 'circle', 'unit_circle',
  'triangle', 'rhombus', 'parallelogram', 'trapezoid', 'pentagon', 'hexagon',
  'cube', 'parallelepiped', 'prism', 'pyramid', 'tetrahedron', 'cylinder', 'cone', 'sphere'
];

WB.getNormalizedShapeBox = function(s) {
  const x1 = Number(s.x1) || 0;
  const y1 = Number(s.y1) || 0;
  let x2 = Number(s.x2) || 0;
  let y2 = Number(s.y2) || 0;

  if (s.type === 'square' || s.type === 'circle' || s.type === 'unit_circle' || s.type === 'cube' || s.type === 'sphere') {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    x2 = x1 + (dx >= 0 ? side : -side);
    y2 = y1 + (dy >= 0 ? side : -side);
  }

  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  const w = Math.max(2, maxX - minX);
  const h = Math.max(2, maxY - minY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { minX, minY, maxX, maxY, w, h, cx, cy, x1, y1, x2, y2 };
};

WB.get2DShapeVertices = function(s) {
  const b = WB.getNormalizedShapeBox(s);
  const { minX, minY, maxX, maxY, w, h, cx, cy } = b;

  if (s.type === 'rect' || s.type === 'square') {
    return [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY }
    ];
  }
  if (s.type === 'triangle') {
    return [
      { x: cx, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY }
    ];
  }
  if (s.type === 'rhombus') {
    return [
      { x: cx, y: minY },
      { x: maxX, y: cy },
      { x: cx, y: maxY },
      { x: minX, y: cy }
    ];
  }
  if (s.type === 'parallelogram') {
    const skew = w * 0.24;
    return [
      { x: minX + skew, y: minY },
      { x: maxX, y: minY },
      { x: maxX - skew, y: maxY },
      { x: minX, y: maxY }
    ];
  }
  if (s.type === 'trapezoid') {
    const inset = w * 0.22;
    return [
      { x: minX + inset, y: minY },
      { x: maxX - inset, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY }
    ];
  }
  if (s.type === 'pentagon' || s.type === 'hexagon') {
    const n = s.type === 'pentagon' ? 5 : 6;
    const rx = w / 2;
    const ry = h / 2;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
    }
    return pts;
  }
  return null;
};

WB.SHAPE_2D_TYPES = [
  'line', 'arrow', 'axes',
  'rect', 'square', 'ellipse', 'circle', 'unit_circle',
  'triangle', 'rhombus', 'parallelogram', 'trapezoid', 'pentagon', 'hexagon', 'polygon'
];

WB.is2DShapeStroke = function(s) {
  return !!(s && WB.SHAPE_2D_TYPES.includes(s.type));
};

WB.SHAPE_3D_TYPES = ['cube', 'parallelepiped', 'prism', 'pyramid', 'tetrahedron', 'cylinder', 'cone', 'sphere'];

WB.SHAPE_3D_TITLES = {
  cube: 'Куб',
  parallelepiped: 'Параллелепипед',
  prism: 'Призма',
  pyramid: 'Пирамида',
  tetrahedron: 'Тетраэдр',
  cylinder: 'Цилиндр',
  cone: 'Конус',
  sphere: 'Сфера'
};

WB.is3DShapeStroke = function(s) {
  return !!(s && WB.SHAPE_3D_TYPES.includes(s.type));
};

WB.DEFAULT_3D_YAW = -0.62;
WB.DEFAULT_3D_PITCH = 0.36;

WB.ensure3DConfig = function(s) {
  if (!s) return null;
  if (!s.s3d) {
    let defaultRadius = 2;
    if (s.type === 'cube') defaultRadius = 3;
    else if (s.type === 'parallelepiped') defaultRadius = 4;
    else if (s.type === 'sphere') defaultRadius = 2.5;

    s.s3d = {
      yaw: WB.DEFAULT_3D_YAW,
      pitch: WB.DEFAULT_3D_PITCH,
      radius: defaultRadius,
      depth: 2,
      height: 3,
      baseSides: s.type === 'prism' ? 5 : 4,
      boxKind: 'rectangular', // 'rectangular' | 'right' | 'oblique'
      baseAngle: 45,
      tiltX: 36,
      tiltY: -25,
      pyramidKind: s.type === 'tetrahedron' ? 'tetrahedron' : 'regular', // 'regular' | 'truncated' | 'tetrahedron'
      coneKind: 'cone', // 'cone' | 'frustum'
      topShiftX: 0,
      topShiftY: 0,
      topRatio: 0.5,
      topRadius: 1,
      showLabels: true,
      showDiagonals: false,
      showHiddenEdges: true,
      showFaces: s.type !== 'sphere',
      snapPoints: true,
      customPoints: [], // { id, label, edgeIdx, t, x3, y3, z3 }
      customLines: [],  // { id, label, aRef, bRef }
      customPlanes: []  // { id, label, pointRefs: [] }
    };
  }
  const c = s.s3d;
  if (c.depth === undefined) c.depth = 2;
  if (c.boxKind === undefined) c.boxKind = 'rectangular';
  if (c.baseAngle === undefined) c.baseAngle = 45;
  if (c.tiltX === undefined) c.tiltX = 36;
  if (c.tiltY === undefined) c.tiltY = -25;
  if (c.pyramidKind === undefined) c.pyramidKind = s.type === 'tetrahedron' ? 'tetrahedron' : 'regular';
  if (c.coneKind === undefined) c.coneKind = 'cone';
  if (c.topShiftX === undefined) c.topShiftX = 0;
  if (c.topShiftY === undefined) c.topShiftY = 0;
  if (c.topRatio === undefined) c.topRatio = 0.5;
  if (c.topRadius === undefined) c.topRadius = 1;
  if (c.showDiagonals === undefined) c.showDiagonals = false;
  if (c.snapPoints === undefined) c.snapPoints = true;
  return c;
};

WB.rotate3DPoint = function(pt, yaw, pitch) {
  const cy = Math.cos(yaw || 0), sy = Math.sin(yaw || 0);
  const cp = Math.cos(pitch || 0), sp = Math.sin(pitch || 0);
  const x1 = pt.x * cy + pt.z * sy;
  const z1 = -pt.x * sy + pt.z * cy;
  const y1 = pt.y;
  const y2 = y1 * cp - z1 * sp;
  const z2 = y1 * sp + z1 * cp;
  return { x: x1, y: y2, z: z2 };
};

WB.unrotate3DPoint = function(pt, yaw, pitch) {
  const cy = Math.cos(yaw || 0), sy = Math.sin(yaw || 0);
  const cp = Math.cos(pitch || 0), sp = Math.sin(pitch || 0);
  const x1 = pt.x;
  const y1 = pt.y * cp + pt.z * sp;
  const z1 = -pt.y * sp + pt.z * cp;
  return {
    x: x1 * cy - z1 * sy,
    y: y1,
    z: x1 * sy + z1 * cy
  };
};

WB.get3DBodyDimensionMeta = function(bodyType, cfg = {}) {
  const base = {
    title: (WB.SHAPE_3D_TITLES && WB.SHAPE_3D_TITLES[bodyType]) || 'Фигура 3D',
    radiusLabel: 'Радиус основания',
    showDepth: false,
    depthLabel: 'Ширина b',
    showHeight: true,
    heightLabel: 'Высота h',
    showBaseSides: false,
    baseSidesLabel: 'Число сторон основания',
    showBaseAngle: false,
    showTiltXY: false,
    showTopShift: false,
    showTopRatio: false,
    showTopRadius: false,
    showDiagonals: false,
    showFaces: true,
    subtypePlacement: 'none', // 'none' | 'top' | 'cone'
    subtypeLabel: '',
    subtypeKey: '',
    subtypeValue: '',
    subtypeOptions: []
  };

  switch (bodyType) {
    case 'cube':
      return {
        ...base,
        title: 'Куб',
        radiusLabel: 'Длина ребра',
        showHeight: false,
        showDiagonals: true
      };
    case 'parallelepiped': {
      const boxKind = (cfg.boxKind === 'right' || cfg.boxKind === 'oblique') ? cfg.boxKind : 'rectangular';
      const titleMap = {
        rectangular: 'Прямоугольный параллелепипед',
        right: 'Прямой параллелепипед',
        oblique: 'Наклонный параллелепипед'
      };
      return {
        ...base,
        title: titleMap[boxKind],
        radiusLabel: 'Длина a',
        showDepth: true,
        depthLabel: 'Ширина b',
        showHeight: true,
        showBaseAngle: boxKind === 'right' || boxKind === 'oblique',
        showTiltXY: boxKind === 'oblique',
        showDiagonals: true,
        subtypePlacement: 'top',
        subtypeLabel: 'Вид',
        subtypeKey: 'boxKind',
        subtypeValue: boxKind,
        subtypeOptions: [
          { value: 'rectangular', label: 'Прямоугольный' },
          { value: 'right', label: 'Прямой' },
          { value: 'oblique', label: 'Наклонный' }
        ]
      };
    }
    case 'prism':
      return {
        ...base,
        title: 'Призма',
        radiusLabel: 'Радиус правильного основания',
        showBaseSides: true,
        showTopShift: true,
        showHeight: true
      };
    case 'pyramid':
    case 'tetrahedron': {
      const fallbackKind = bodyType === 'tetrahedron' ? 'tetrahedron' : 'regular';
      const pKind = (cfg.pyramidKind === 'regular' || cfg.pyramidKind === 'truncated' || cfg.pyramidKind === 'tetrahedron')
        ? cfg.pyramidKind
        : fallbackKind;
      const titleMap = {
        regular: 'Пирамида',
        truncated: 'Усечённая пирамида',
        tetrahedron: 'Тетраэдр'
      };
      return {
        ...base,
        title: titleMap[pKind],
        radiusLabel: 'Радиус правильного основания',
        showBaseSides: pKind !== 'tetrahedron',
        showTopShift: pKind !== 'tetrahedron',
        showHeight: pKind !== 'tetrahedron',
        showTopRatio: pKind === 'truncated',
        subtypePlacement: 'top',
        subtypeLabel: 'Пирамида',
        subtypeKey: 'pyramidKind',
        subtypeValue: pKind,
        subtypeOptions: [
          { value: 'regular', label: 'Пирамида' },
          { value: 'truncated', label: 'Усечённая пирамида' },
          { value: 'tetrahedron', label: 'Правильный тетраэдр' }
        ]
      };
    }
    case 'cylinder':
      return {
        ...base,
        title: 'Цилиндр',
        radiusLabel: 'Радиус основания',
        showHeight: true
      };
    case 'cone': {
      const cKind = cfg.coneKind === 'frustum' ? 'frustum' : 'cone';
      return {
        ...base,
        title: cKind === 'frustum' ? 'Усечённый конус' : 'Конус',
        radiusLabel: 'Радиус основания',
        showHeight: true,
        showTopRadius: cKind === 'frustum',
        subtypePlacement: 'cone',
        subtypeLabel: 'Тело',
        subtypeKey: 'coneKind',
        subtypeValue: cKind,
        subtypeOptions: [
          { value: 'cone', label: 'Конус' },
          { value: 'frustum', label: 'Усечённый конус' }
        ]
      };
    }
    case 'sphere':
      return {
        ...base,
        title: 'Сфера',
        radiusLabel: 'Радиус',
        showHeight: false,
        showFaces: false
      };
    default:
      return base;
  }
};

WB.snap3DEdgeRatio = function(rawT, snapEnabled) {
  const t = Math.max(0.03, Math.min(0.97, rawT));
  if (!snapEnabled) {
    return { t: Number(t.toFixed(3)), snapLabel: null };
  }
  const landmarks = [
    { val: 0.5, label: '1/2', tol: 0.085 },
    { val: 1 / 3, label: '1/3', tol: 0.045 },
    { val: 2 / 3, label: '2/3', tol: 0.045 },
    { val: 0.25, label: '1/4', tol: 0.035 },
    { val: 0.75, label: '3/4', tol: 0.035 }
  ];
  for (const lm of landmarks) {
    if (Math.abs(t - lm.val) <= lm.tol) {
      return { t: Number(lm.val.toFixed(4)), snapLabel: lm.label };
    }
  }
  return { t: Number(t.toFixed(3)), snapLabel: null };
};

WB.getNextConstructionPointLabel = function(existingLabels) {
  const pool = ['P', 'Q', 'R', 'T', 'M', 'N', 'K', 'E', 'F', 'H', 'L'];
  const used = new Set(existingLabels || []);
  for (const ch of pool) {
    if (!used.has(ch)) return ch;
  }
  let idx = 1;
  while (used.has(`P${idx}`)) idx++;
  return `P${idx}`;
};

WB.get3DShapePrimitives = function(s) {
  if (!WB.is3DShapeStroke(s)) return null;
  const cfg = WB.ensure3DConfig(s);
  const b = WB.getNormalizedShapeBox(s);
  const { minX, minY, w, h, cx, cy } = b;
  const solidLines = [];
  const dashedLines = [];
  const diagonalLines = [];
  const arcs = [];
  const filledFaces = [];
  const vertices2d = []; // { id, label, x, y, x3, y3, z3, hideDefaultLabel? }
  const edges3d = [];    // { idx, aIdx, bIdx, a2d, b2d, dashed }

  const yaw = Number(cfg.yaw) || 0;
  const pitch = Number(cfg.pitch) || 0;
  const baseUnit = Math.max(14, Math.min(w, h) * 0.215);
  const radScale = Math.max(0.25, Math.min(3.5, (Number(cfg.radius) || 2) / 2));
  const rawHScale = Math.max(0.25, Math.min(3.5, (Number(cfg.height) || 3) / 3));
  const scaleX = baseUnit;
  const scaleY = baseUnit;

  const project3D = (pt3) => {
    const r = WB.rotate3DPoint(pt3, yaw, pitch);
    return {
      x: cx + r.x * scaleX,
      y: cy - r.y * scaleY,
      z: r.z,
      x3: pt3.x,
      y3: pt3.y,
      z3: pt3.z
    };
  };

  const buildPolyhedron = (verts3, facesDef, edgesDef, diagPairs) => {
    const proj = verts3.map((v, idx) => {
      const p = project3D(v);
      return { id: `v_${idx}`, index: idx, label: v.label || '', x: p.x, y: p.y, z: p.z, x3: v.x, y3: v.y, z3: v.z };
    });
    vertices2d.push(...proj);

    // Determine front-facing vs back-facing faces via 2D signed area (screen space Y is down)
    const faceFront = facesDef.map(f => {
      if (f.length < 3) return true;
      const p0 = proj[f[0]], p1 = proj[f[1]], p2 = proj[f[2]];
      const crossZ = (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);
      return crossZ < 0;
    });

    if (cfg.showFaces) {
      facesDef.forEach((f, fIdx) => {
        if (faceFront[fIdx]) {
          filledFaces.push(f.map(vi => ({ x: proj[vi].x, y: proj[vi].y })));
        }
      });
    }

    edgesDef.forEach((e, eIdx) => {
      const [i1, i2, adjFaces] = e;
      const p1 = proj[i1], p2 = proj[i2];
      let isVisible = true;
      if (Array.isArray(adjFaces) && adjFaces.length > 0) {
        isVisible = adjFaces.some(fi => faceFront[fi]);
      } else {
        isVisible = (p1.z + p2.z) >= -0.05;
      }
      edges3d.push({ idx: eIdx, aIdx: i1, bIdx: i2, a2d: p1, b2d: p2, dashed: !isVisible });
      if (isVisible) {
        solidLines.push([{ x: p1.x, y: p1.y }, { x: p2.x, y: p2.y }]);
      } else if (cfg.showHiddenEdges !== false) {
        dashedLines.push([{ x: p1.x, y: p1.y }, { x: p2.x, y: p2.y }]);
      }
    });

    if (cfg.showDiagonals && Array.isArray(diagPairs)) {
      for (const [ia, ib] of diagPairs) {
        if (proj[ia] && proj[ib]) {
          diagonalLines.push([{ x: proj[ia].x, y: proj[ia].y }, { x: proj[ib].x, y: proj[ib].y }]);
        }
      }
    }
  };

  if (s.type === 'cube' || s.type === 'parallelepiped') {
    const isBox = s.type === 'parallelepiped';
    const boxKind = isBox ? (cfg.boxKind || 'rectangular') : 'rectangular';
    const aLen = Math.max(0.5, Math.min(10, Number(cfg.radius) || (isBox ? 4 : 3)));
    const bLen = isBox ? Math.max(0.5, Math.min(10, Number(cfg.depth) || 2)) : aLen;
    const hLen = isBox ? Math.max(0.5, Math.min(10, Number(cfg.height) || 3)) : aLen;

    const ha = aLen / 2;
    const hb = bLen / 2;
    const hh = hLen / 2;

    const phiDeg = (boxKind === 'right' || boxKind === 'oblique')
      ? Math.max(20, Math.min(160, Number(cfg.baseAngle) || 45))
      : 90;
    const phi = (phiDeg * Math.PI) / 180;

    // Base vectors: u along X (length a), v at base angle phi (width b)
    const uVec = { x: ha, y: 0, z: 0 };
    const vVec = { x: hb * Math.cos(phi), y: 0, z: hb * Math.sin(phi) };

    // Lateral edge vector w: vertical for rectangular/right, tilted by tiltX/tiltY for oblique
    let wVec = { x: 0, y: hh, z: 0 };
    if (boxKind === 'oblique') {
      const txDeg = Math.max(-60, Math.min(60, Number(cfg.tiltX) || 0));
      const tyDeg = Math.max(-60, Math.min(60, Number(cfg.tiltY) || 0));
      wVec = {
        x: Math.tan((txDeg * Math.PI) / 180) * hh,
        y: hh,
        z: Math.tan((tyDeg * Math.PI) / 180) * hh
      };
    }

    const pt = (su, sv, sw, label) => ({
      x: su * uVec.x + sv * vVec.x + sw * wVec.x,
      y: su * uVec.y + sv * vVec.y + sw * wVec.y,
      z: su * uVec.z + sv * vVec.z + sw * wVec.z,
      label
    });

    // Vertex placement matches pages 1-2: A back-bottom, B left-bottom, C front-bottom, D right-bottom
    const verts3 = [
      pt(-1, -1, -1, 'A'),  // 0
      pt(-1,  1, -1, 'B'),  // 1
      pt( 1,  1, -1, 'C'),  // 2
      pt( 1, -1, -1, 'D'),  // 3
      pt(-1, -1,  1, 'A₁'), // 4
      pt(-1,  1,  1, 'B₁'), // 5
      pt( 1,  1,  1, 'C₁'), // 6
      pt( 1, -1,  1, 'D₁')  // 7
    ];
    // Outward-facing faces (CCW from outside)
    const faces = [
      [1, 2, 6, 5], // 0: front-left (+v: B-C-C1-B1)
      [2, 3, 7, 6], // 1: front-right (+u: C-D-D1-C1)
      [3, 0, 4, 7], // 2: back-right (-v: D-A-A1-D1)
      [0, 1, 5, 4], // 3: back-left (-u: A-B-B1-A1)
      [4, 5, 6, 7], // 4: top (+w: A1-B1-C1-D1)
      [0, 3, 2, 1]  // 5: bottom (-w: A-D-C-B)
    ];
    const edges = [
      [0, 1, [3, 5]], [1, 2, [0, 5]], [2, 3, [1, 5]], [3, 0, [2, 5]],
      [4, 5, [3, 4]], [5, 6, [0, 4]], [6, 7, [1, 4]], [7, 4, [2, 4]],
      [0, 4, [2, 3]], [1, 5, [0, 3]], [2, 6, [0, 1]], [3, 7, [1, 2]]
    ];
    const diags = [[0, 6], [1, 7], [2, 4], [3, 5]];
    buildPolyhedron(verts3, faces, edges, diags);
  } else if (s.type === 'prism') {
    const n = Math.max(3, Math.min(8, Math.round(Number(cfg.baseSides) || 5)));
    const R = Math.max(0.5, Math.min(8, Number(cfg.radius) || 2));
    const hh = Math.max(0.5, Math.min(10, Number(cfg.height) || 3)) / 2;
    const sx = Number(cfg.topShiftX) || 0;
    const sy = Number(cfg.topShiftY) || 0;
    const verts3 = [];
    for (let i = 0; i < n; i++) {
      const ang = Math.PI / 2 - (i * 2 * Math.PI) / n;
      const letter = String.fromCharCode(65 + i);
      verts3.push({ x: Math.cos(ang) * R, y: -hh, z: Math.sin(ang) * R, label: letter });
    }
    for (let i = 0; i < n; i++) {
      const ang = Math.PI / 2 - (i * 2 * Math.PI) / n;
      const letter = String.fromCharCode(65 + i) + '₁';
      verts3.push({ x: Math.cos(ang) * R + sx, y: hh, z: Math.sin(ang) * R + sy, label: letter });
    }
    const faces = [];
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      faces.push([i, next, n + next, n + i]);
    }
    const topFace = [];
    const botFace = [];
    for (let i = 0; i < n; i++) {
      topFace.push(n + i);
      botFace.push(n - 1 - i);
    }
    faces.push(topFace);
    faces.push(botFace);

    const edges = [];
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      edges.push([i, next, [i, n + 1]]);
      edges.push([n + i, n + next, [i, n]]);
      edges.push([i, n + i, [i, (i - 1 + n) % n]]);
    }
    buildPolyhedron(verts3, faces, edges);
  } else if (s.type === 'pyramid' || s.type === 'tetrahedron') {
    const pKind = cfg.pyramidKind || (s.type === 'tetrahedron' ? 'tetrahedron' : 'regular');
    const R = Math.max(0.5, Math.min(8, Number(cfg.radius) || 2));

    if (pKind === 'truncated') {
      const n = Math.max(3, Math.min(8, Math.round(Number(cfg.baseSides) || 4)));
      const hh = Math.max(0.5, Math.min(10, Number(cfg.height) || 3)) / 2;
      const ratio = Math.max(0.1, Math.min(0.95, Number(cfg.topRatio) || 0.5));
      const Rtop = R * ratio;
      const sx = Number(cfg.topShiftX) || 0;
      const sy = Number(cfg.topShiftY) || 0;
      const phase = n === 4 ? Math.PI / 4 : 0;

      const verts3 = [];
      for (let i = 0; i < n; i++) {
        const ang = Math.PI / 2 - (i * 2 * Math.PI) / n - phase;
        const letter = String.fromCharCode(65 + i);
        verts3.push({ x: Math.cos(ang) * R, y: -hh, z: Math.sin(ang) * R, label: letter });
      }
      for (let i = 0; i < n; i++) {
        const ang = Math.PI / 2 - (i * 2 * Math.PI) / n - phase;
        const letter = String.fromCharCode(65 + i) + '₁';
        verts3.push({ x: Math.cos(ang) * Rtop + sx, y: hh, z: Math.sin(ang) * Rtop + sy, label: letter });
      }
      const faces = [];
      for (let i = 0; i < n; i++) {
        const next = (i + 1) % n;
        faces.push([i, next, n + next, n + i]);
      }
      const topFace = [];
      const botFace = [];
      for (let i = 0; i < n; i++) {
        topFace.push(n + i);
        botFace.push(n - 1 - i);
      }
      faces.push(topFace);
      faces.push(botFace);

      const edges = [];
      for (let i = 0; i < n; i++) {
        const next = (i + 1) % n;
        edges.push([i, next, [i, n + 1]]);
        edges.push([n + i, n + next, [i, n]]);
        edges.push([i, n + i, [i, (i - 1 + n) % n]]);
      }
      buildPolyhedron(verts3, faces, edges);
    } else {
      const isTet = pKind === 'tetrahedron';
      const n = isTet ? 3 : Math.max(3, Math.min(8, Math.round(Number(cfg.baseSides) || 4)));
      const hTotal = isTet ? R * Math.SQRT2 : Math.max(0.5, Math.min(10, Number(cfg.height) || 3));
      const hh = hTotal / 2;
      const sx = isTet ? 0 : (Number(cfg.topShiftX) || 0);
      const sy = isTet ? 0 : (Number(cfg.topShiftY) || 0);
      const phase = n === 4 ? Math.PI / 4 : 0;

      const verts3 = [];
      for (let i = 0; i < n; i++) {
        const ang = Math.PI / 2 - (i * 2 * Math.PI) / n - phase;
        const letter = String.fromCharCode(65 + i);
        verts3.push({ x: Math.cos(ang) * R, y: -hh, z: Math.sin(ang) * R, label: letter });
      }
      verts3.push({ x: sx, y: hh, z: sy, label: 'S' });
      const apexIdx = n;
      const faces = [];
      for (let i = 0; i < n; i++) {
        const next = (i + 1) % n;
        faces.push([i, next, apexIdx]);
      }
      const botFace = [];
      for (let i = 0; i < n; i++) botFace.push(n - 1 - i);
      faces.push(botFace);

      const edges = [];
      for (let i = 0; i < n; i++) {
        const next = (i + 1) % n;
        edges.push([i, next, [i, n]]);
        edges.push([i, apexIdx, [i, (i - 1 + n) % n]]);
      }
      buildPolyhedron(verts3, faces, edges);
    }
  } else if (s.type === 'cylinder') {
    const rx = Math.max(16, (w / 2) * radScale * 0.88);
    const absSin = Math.abs(Math.sin(pitch));
    const tilt = Math.max(0.16, Math.min(0.68, absSin * 0.72 + 0.1));
    const ry = rx * tilt;
    const halfH = Math.max(18, (h / 2) * rawHScale * Math.max(0.28, Math.cos(pitch)));
    const topY = cy - halfH;
    const botY = cy + halfH;
    const lookingFromAbove = pitch >= 0;

    if (cfg.showFaces) {
      filledFaces.push([
        { x: cx - rx, y: topY },
        { x: cx + rx, y: topY },
        { x: cx + rx, y: botY },
        { x: cx - rx, y: botY }
      ]);
    }

    if (lookingFromAbove) {
      arcs.push({ cx, cy: topY, rx, ry, start: 0, end: Math.PI * 2, dashed: false, fill: cfg.showFaces });
      arcs.push({ cx, cy: botY, rx, ry, start: 0, end: Math.PI, dashed: false, fill: cfg.showFaces });
      if (cfg.showHiddenEdges !== false) {
        arcs.push({ cx, cy: botY, rx, ry, start: Math.PI, end: Math.PI * 2, dashed: true });
      }
    } else {
      arcs.push({ cx, cy: botY, rx, ry, start: 0, end: Math.PI * 2, dashed: false, fill: cfg.showFaces });
      arcs.push({ cx, cy: topY, rx, ry, start: Math.PI, end: Math.PI * 2, dashed: false, fill: cfg.showFaces });
      if (cfg.showHiddenEdges !== false) {
        arcs.push({ cx, cy: topY, rx, ry, start: 0, end: Math.PI, dashed: true });
      }
    }
    solidLines.push([{ x: cx - rx, y: topY }, { x: cx - rx, y: botY }]);
    solidLines.push([{ x: cx + rx, y: topY }, { x: cx + rx, y: botY }]);

    const ptAtAngle = (ang, yCoord, x3y) => ({
      x: cx + Math.cos(ang) * rx,
      y: yCoord + Math.sin(ang) * ry,
      x3: Math.cos(ang),
      y3: x3y,
      z3: Math.sin(ang)
    });
    const pA = ptAtAngle(Math.PI + yaw, botY, -1);
    const pB = ptAtAngle(yaw, botY, -1);
    const pA1 = ptAtAngle(Math.PI + yaw, topY, 1);
    const pB1 = ptAtAngle(yaw, topY, 1);

    const vList = [
      { id: 'v_0', index: 0, label: 'O₁', x: cx, y: topY, x3: 0, y3: 1, z3: 0, hideDefaultLabel: true },
      { id: 'v_1', index: 1, label: 'O', x: cx, y: botY, x3: 0, y3: -1, z3: 0, hideDefaultLabel: true },
      { id: 'v_2', index: 2, label: 'A', ...pA, hideDefaultLabel: true },
      { id: 'v_3', index: 3, label: 'B', ...pB, hideDefaultLabel: true },
      { id: 'v_4', index: 4, label: 'A₁', ...pA1, hideDefaultLabel: true },
      { id: 'v_5', index: 5, label: 'B₁', ...pB1, hideDefaultLabel: true }
    ];
    vertices2d.push(...vList);
    edges3d.push(
      { idx: 0, aIdx: 4, bIdx: 2, a2d: { x: cx - rx, y: topY }, b2d: { x: cx - rx, y: botY }, dashed: false },
      { idx: 1, aIdx: 5, bIdx: 3, a2d: { x: cx + rx, y: topY }, b2d: { x: cx + rx, y: botY }, dashed: false },
      { idx: 2, aIdx: 0, bIdx: 1, a2d: vList[0], b2d: vList[1], dashed: true }
    );
  } else if (s.type === 'cone') {
    const isFrustum = cfg.coneKind === 'frustum';
    const baseRVal = Math.max(0.5, Math.min(8, Number(cfg.radius) || 2));
    const rx = Math.max(16, (w / 2) * radScale * 0.9);
    const absSin = Math.abs(Math.sin(pitch));
    const tilt = Math.max(0.16, Math.min(0.68, absSin * 0.72 + 0.1));
    const ry = rx * tilt;
    const halfH = Math.max(20, (h / 2) * rawHScale * Math.max(0.32, Math.cos(pitch)));
    const topY = cy - halfH;
    const botY = cy + halfH - ry * 0.25;
    const leftPt = { x: cx - rx, y: botY };
    const rightPt = { x: cx + rx, y: botY };
    const centerPt = { x: cx, y: botY };
    const lookingFromAbove = pitch >= 0;

    if (isFrustum) {
      const topRVal = Math.max(0.15, Math.min(7.5, Number(cfg.topRadius) || 1));
      const topRatio = Math.max(0.12, Math.min(1.6, topRVal / baseRVal));
      const rxTop = Math.max(8, rx * topRatio);
      const ryTop = rxTop * tilt;
      const topLeft = { x: cx - rxTop, y: topY };
      const topRight = { x: cx + rxTop, y: topY };

      if (cfg.showFaces) {
        filledFaces.push([topLeft, topRight, rightPt, leftPt]);
      }

      solidLines.push([topLeft, leftPt]);
      solidLines.push([topRight, rightPt]);

      if (lookingFromAbove) {
        arcs.push({ cx, cy: topY, rx: rxTop, ry: ryTop, start: 0, end: Math.PI * 2, dashed: false, fill: cfg.showFaces });
        arcs.push({ cx, cy: botY, rx, ry, start: 0, end: Math.PI, dashed: false, fill: cfg.showFaces });
        if (cfg.showHiddenEdges !== false) {
          arcs.push({ cx, cy: botY, rx, ry, start: Math.PI, end: Math.PI * 2, dashed: true });
        }
      } else {
        arcs.push({ cx, cy: botY, rx, ry, start: 0, end: Math.PI * 2, dashed: false, fill: cfg.showFaces });
        arcs.push({ cx, cy: topY, rx: rxTop, ry: ryTop, start: Math.PI, end: Math.PI * 2, dashed: false, fill: cfg.showFaces });
        if (cfg.showHiddenEdges !== false) {
          arcs.push({ cx, cy: topY, rx: rxTop, ry: ryTop, start: 0, end: Math.PI, dashed: true });
        }
      }

      const vList = [
        { id: 'v_0', index: 0, label: 'O₁', x: cx, y: topY, x3: 0, y3: 1, z3: 0, hideDefaultLabel: true },
        { id: 'v_1', index: 1, label: 'O', x: cx, y: botY, x3: 0, y3: -1, z3: 0, hideDefaultLabel: true },
        { id: 'v_2', index: 2, label: 'A', x: leftPt.x, y: leftPt.y, x3: -1, y3: -1, z3: 0, hideDefaultLabel: true },
        { id: 'v_3', index: 3, label: 'B', x: rightPt.x, y: rightPt.y, x3: 1, y3: -1, z3: 0, hideDefaultLabel: true },
        { id: 'v_4', index: 4, label: 'A₁', x: topLeft.x, y: topLeft.y, x3: -topRatio, y3: 1, z3: 0, hideDefaultLabel: true },
        { id: 'v_5', index: 5, label: 'B₁', x: topRight.x, y: topRight.y, x3: topRatio, y3: 1, z3: 0, hideDefaultLabel: true }
      ];
      vertices2d.push(...vList);
      edges3d.push(
        { idx: 0, aIdx: 4, bIdx: 2, a2d: topLeft, b2d: leftPt, dashed: false },
        { idx: 1, aIdx: 5, bIdx: 3, a2d: topRight, b2d: rightPt, dashed: false },
        { idx: 2, aIdx: 0, bIdx: 1, a2d: vList[0], b2d: vList[1], dashed: true }
      );
    } else {
      const apex = { x: cx, y: topY };
      if (cfg.showFaces) {
        filledFaces.push([apex, leftPt, rightPt]);
      }

      solidLines.push([apex, leftPt]);
      solidLines.push([apex, rightPt]);

      if (lookingFromAbove) {
        arcs.push({ cx, cy: botY, rx, ry, start: 0, end: Math.PI, dashed: false, fill: cfg.showFaces });
        if (cfg.showHiddenEdges !== false) {
          arcs.push({ cx, cy: botY, rx, ry, start: Math.PI, end: Math.PI * 2, dashed: true });
        }
      } else {
        arcs.push({ cx, cy: botY, rx, ry, start: 0, end: Math.PI * 2, dashed: false, fill: cfg.showFaces });
      }

      const pA = {
        x: cx + Math.cos(Math.PI + yaw) * rx,
        y: botY + Math.sin(Math.PI + yaw) * ry,
        x3: Math.cos(Math.PI + yaw),
        y3: -1,
        z3: Math.sin(Math.PI + yaw)
      };
      const pB = {
        x: cx + Math.cos(yaw) * rx,
        y: botY + Math.sin(yaw) * ry,
        x3: Math.cos(yaw),
        y3: -1,
        z3: Math.sin(yaw)
      };

      const vList = [
        { id: 'v_0', index: 0, label: 'S', x: apex.x, y: apex.y, x3: 0, y3: 1, z3: 0 },
        { id: 'v_1', index: 1, label: 'O', x: centerPt.x, y: centerPt.y, x3: 0, y3: -1, z3: 0, hideDefaultLabel: true },
        { id: 'v_2', index: 2, label: 'A', ...pA, hideDefaultLabel: true },
        { id: 'v_3', index: 3, label: 'B', ...pB, hideDefaultLabel: true }
      ];
      vertices2d.push(...vList);
      edges3d.push(
        { idx: 0, aIdx: 0, bIdx: 2, a2d: apex, b2d: leftPt, dashed: false },
        { idx: 1, aIdx: 0, bIdx: 3, a2d: apex, b2d: rightPt, dashed: false },
        { idx: 2, aIdx: 0, bIdx: 1, a2d: vList[0], b2d: vList[1], dashed: true }
      );
    }
  } else if (s.type === 'sphere') {
    const r = Math.max(18, (Math.min(w, h) / 2) * ((Number(cfg.radius) || 2.5) / 2.5) * 0.9);
    const tilt = Math.max(0.18, Math.min(0.68, Math.abs(Math.sin(pitch)) * 0.72 + 0.14));
    const ry = r * tilt;
    arcs.push({ cx, cy, rx: r, ry: r, start: 0, end: Math.PI * 2, dashed: false, fill: false });
    if (pitch >= 0) {
      arcs.push({ cx, cy, rx: r, ry, start: 0, end: Math.PI, dashed: false });
      if (cfg.showHiddenEdges !== false) {
        arcs.push({ cx, cy, rx: r, ry, start: Math.PI, end: Math.PI * 2, dashed: true });
      }
    } else {
      arcs.push({ cx, cy, rx: r, ry, start: Math.PI, end: Math.PI * 2, dashed: false });
      if (cfg.showHiddenEdges !== false) {
        arcs.push({ cx, cy, rx: r, ry, start: 0, end: Math.PI, dashed: true });
      }
    }

    const pO = { id: 'v_0', index: 0, label: 'O', x: cx, y: cy, x3: 0, y3: 0, z3: 0, hideDefaultLabel: true };
    const rotN = WB.rotate3DPoint({ x: 0, y: 1, z: 0 }, yaw, pitch);
    const rotA = WB.rotate3DPoint({ x: -1, y: 0, z: 0 }, yaw, pitch);
    const rotB = WB.rotate3DPoint({ x: 1, y: 0, z: 0 }, yaw, pitch);
    const pN = { id: 'v_1', index: 1, label: 'N', x: cx + rotN.x * r, y: cy - rotN.y * r, x3: 0, y3: 1, z3: 0, hideDefaultLabel: true };
    const pA = { id: 'v_2', index: 2, label: 'A', x: cx + rotA.x * r, y: cy - rotA.y * r, x3: -1, y3: 0, z3: 0, hideDefaultLabel: true };
    const pB = { id: 'v_3', index: 3, label: 'B', x: cx + rotB.x * r, y: cy - rotB.y * r, x3: 1, y3: 0, z3: 0, hideDefaultLabel: true };

    vertices2d.push(pO, pN, pA, pB);
    edges3d.push(
      { idx: 0, aIdx: 1, bIdx: 0, a2d: pN, b2d: pO, dashed: true },
      { idx: 1, aIdx: 0, bIdx: 3, a2d: pO, b2d: pB, dashed: true },
      { idx: 2, aIdx: 2, bIdx: 3, a2d: pA, b2d: pB, dashed: true }
    );
  }

  // Resolve custom constructed points (P, Q, R, T...)
  const customPoints2d = [];
  const pointMap = {};
  for (const v of vertices2d) {
    pointMap[v.id] = v;
  }

  if (Array.isArray(cfg.customPoints)) {
    for (const cp of cfg.customPoints) {
      let x = cx, y = cy;
      if (typeof cp.edgeIdx === 'number' && edges3d[cp.edgeIdx]) {
        const edge = edges3d[cp.edgeIdx];
        const t = Math.max(0, Math.min(1, Number(cp.t) ?? 0.5));
        x = edge.a2d.x + (edge.b2d.x - edge.a2d.x) * t;
        y = edge.a2d.y + (edge.b2d.y - edge.a2d.y) * t;
      } else if (typeof cp.x3 === 'number' && typeof cp.y3 === 'number' && typeof cp.z3 === 'number') {
        const pr = project3D({ x: cp.x3, y: cp.y3, z: cp.z3 });
        x = pr.x;
        y = pr.y;
      } else if (typeof cp.rx === 'number' && typeof cp.ry === 'number') {
        x = minX + cp.rx * w;
        y = minY + cp.ry * h;
      }
      const resolved = { id: cp.id, label: cp.label, x, y, raw: cp };
      customPoints2d.push(resolved);
      pointMap[cp.id] = resolved;
    }
  }

  const customLines2d = [];
  if (Array.isArray(cfg.customLines)) {
    for (const cl of cfg.customLines) {
      const pa = pointMap[cl.aRef];
      const pb = pointMap[cl.bRef];
      if (pa && pb) {
        customLines2d.push({ id: cl.id, label: cl.label || `${pa.label}${pb.label}`, a: pa, b: pb });
      }
    }
  }

  const customPlanes2d = [];
  if (Array.isArray(cfg.customPlanes)) {
    for (const pl of cfg.customPlanes) {
      const pts = (pl.pointRefs || []).map(ref => pointMap[ref]).filter(Boolean);
      if (pts.length >= 3) {
        customPlanes2d.push({
          id: pl.id,
          label: pl.label || pts.map(p => p.label).join(''),
          points: pts
        });
      }
    }
  }

  return {
    solidLines,
    dashedLines,
    diagonalLines,
    arcs,
    filledFaces,
    vertices2d,
    edges3d,
    customPoints2d,
    customLines2d,
    customPlanes2d,
    cfg,
    scaleX,
    scaleY,
    cx,
    cy
  };
};

// Snaps a world point (wx, wy) to the nearest 3D edge (with midpoint/third landmarks when button 6 is active) or projects into 3D space
WB.snapPointOn3DFigure = function(s, wx, wy) {
  const prim = WB.get3DShapePrimitives(s);
  if (!prim) return null;
  const cfg = prim.cfg || WB.ensure3DConfig(s);
  const snapEnabled = cfg.snapPoints !== false;

  if (snapEnabled) {
    let bestEdgeIdx = -1;
    let bestT = 0.5;
    let bestSnapLabel = null;
    let bestDist = Infinity;

    for (const edge of prim.edges3d) {
      const ax = edge.a2d.x, ay = edge.a2d.y;
      const bx = edge.b2d.x, by = edge.b2d.y;
      const l2 = (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
      const rawT = l2 > 0 ? ((wx - ax) * (bx - ax) + (wy - ay) * (by - ay)) / l2 : 0.5;
      const snapped = WB.snap3DEdgeRatio(rawT, true);
      const px = ax + (bx - ax) * snapped.t;
      const py = ay + (by - ay) * snapped.t;
      const d = Math.hypot(wx - px, wy - py);
      if (d < bestDist) {
        bestDist = d;
        bestEdgeIdx = edge.idx;
        bestT = snapped.t;
        bestSnapLabel = snapped.snapLabel;
      }
    }

    const snapTol = 28 / (WB.cam?.z || 1);
    if (bestEdgeIdx >= 0 && bestDist <= snapTol) {
      return { edgeIdx: bestEdgeIdx, t: bestT, snapLabel: bestSnapLabel };
    }
  }

  // Convert screen-plane delta back to model 3D space so points rotate cleanly with the figure
  const norm = {
    x: (wx - prim.cx) / Math.max(1, prim.scaleX),
    y: -(wy - prim.cy) / Math.max(1, prim.scaleY),
    z: 0.25
  };
  const pt3 = WB.unrotate3DPoint(norm, Number(cfg.yaw) || 0, Number(cfg.pitch) || 0);
  return {
    x3: Number(pt3.x.toFixed(4)),
    y3: Number(pt3.y.toFixed(4)),
    z3: Number(pt3.z.toFixed(4))
  };
};

// Finds nearest vertex or custom point on a 3D shape (for connecting lines/planes or dragging points)
WB.findNearest3DAnchor = function(s, wx, wy, maxDistWorld = 24) {
  const prim = WB.get3DShapePrimitives(s);
  if (!prim) return null;
  let best = null;
  let bestD = maxDistWorld;

  for (const cp of prim.customPoints2d) {
    const d = Math.hypot(wx - cp.x, wy - cp.y);
    if (d <= bestD) {
      bestD = d;
      best = { ref: cp.id, label: cp.label, x: cp.x, y: cp.y, isCustom: true };
    }
  }
  for (const v of prim.vertices2d) {
    const d = Math.hypot(wx - v.x, wy - v.y);
    if (d <= bestD) {
      bestD = d;
      best = { ref: v.id, label: v.label, x: v.x, y: v.y, isCustom: false };
    }
  }
  return best;
};

WB.add3DPointAtWorldPos = function(s, wx, wy) {
  if (!WB.is3DShapeStroke(s)) return null;
  const cfg = WB.ensure3DConfig(s);
  const existingLabels = [
    ...(WB.get3DShapePrimitives(s)?.vertices2d || []).map(v => v.label),
    ...cfg.customPoints.map(p => p.label)
  ];
  const label = WB.getNextConstructionPointLabel(existingLabels);
  const snap = WB.snapPointOn3DFigure(s, wx, wy);
  const pt = {
    id: 'pt_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    label,
    ...snap
  };
  delete pt.snapLabel;
  cfg.customPoints.push(pt);
  return pt;
};

// --- ПОЛУЧЕНИЕ И ПЕРЕМЕЩЕНИЕ КРАЁВ ОТРЕЗКОВ И ВЕРШИН ФИГУР ---
WB.getEditableVertices = function(s) {
  if (!s) return [];
  if (s.type === 'line' || s.type === 'arrow') {
    return [
      { x: s.x1, y: s.y1, role: 'p1' },
      { x: s.x2, y: s.y2, role: 'p2' }
    ];
  }
  if (s.type === 'axes') {
    const geom = WB.getAxesGeometry(s);
    return [
      { x: geom.origin.x, y: geom.origin.y, role: 'axes_origin' },
      { x: geom.xAxis.to.x, y: geom.xAxis.to.y, role: 'axes_xtip' },
      { x: geom.yAxis.to.x, y: geom.yAxis.to.y, role: 'axes_ytip' },
      { x: geom.xAxis.from.x, y: geom.xAxis.from.y, role: 'axes_xstart' },
      { x: geom.yAxis.from.x, y: geom.yAxis.from.y, role: 'axes_ystart' }
    ];
  }
  if (WB.is3DShapeStroke(s)) {
    const prim = WB.get3DShapePrimitives(s);
    if (prim && prim.customPoints2d) {
      return prim.customPoints2d.map((cp, idx) => ({
        x: cp.x,
        y: cp.y,
        role: 's3d_point',
        pointId: cp.id,
        index: idx
      }));
    }
    return [];
  }
  if (s.type === 'polygon' && s.vertices) {
    return s.vertices.map((v, idx) => ({ x: v.x, y: v.y, role: 'v', index: idx }));
  }
  const polyVerts = WB.get2DShapeVertices(s);
  if (polyVerts) {
    return polyVerts.map((v, idx) => ({ x: v.x, y: v.y, role: 'shape2d', index: idx }));
  }
  return [];
};

// Проверка попадания мыши в край отрезка или вершину выделенной фигуры
WB.getVertexHandleHit = function(wx, wy) {
  const tol = 12 / WB.cam.z;
  for (const s of WB.state.strokes) {
    if (!WB.selection.strokeIds.has(s.id) || s.locked) continue;
    const handles = WB.getEditableVertices(s);
    for (const h of handles) {
      if (Math.hypot(wx - h.x, wy - h.y) <= tol) {
        return { stroke: s, handle: h };
      }
    }
  }
  return null;
};

// Перемещение конкретного края отрезка или вершины фигуры
WB.moveSingleVertex = function(hitInfo, rawX, rawY) {
  let newX = rawX, newY = rawY;
  const { stroke: s, handle: h } = hitInfo;
  if (h.role !== 's3d_point') {
    const snapped = WB.snapPointCombined({ x: rawX, y: rawY }, s.id, {
      snapToVertex: !!WB.autoShapeEnabled,
      snapToGrid: !!WB.snapToGridEnabled
    });
    newX = snapped.x;
    newY = snapped.y;
    WB.linearSnapState = snapped.source === 'vertex'
      ? {
          active: true,
          startPt: { x: newX, y: newY },
          startSource: 'vertex',
          endPt: { x: newX, y: newY },
          endSource: 'vertex',
          showPreviewLine: false
        }
      : null;
  }
  if (h.role === 's3d_point' && s.s3d && Array.isArray(s.s3d.customPoints)) {
    const cp = s.s3d.customPoints.find(p => p.id === h.pointId);
    if (cp) {
      const snap = WB.snapPointOn3DFigure(s, rawX, rawY);
      delete cp.edgeIdx;
      delete cp.t;
      delete cp.rx;
      delete cp.ry;
      Object.assign(cp, snap);
    }
    return;
  }
  if (h.role === 'p1') {
    s.x1 = newX;
    s.y1 = newY;
    delete s.startBind;
  } else if (h.role === 'p2') {
    s.x2 = newX;
    s.y2 = newY;
    delete s.endBind;
  } else if (h.role === 'axes_origin') {
    const dx = newX - h.x;
    const dy = newY - h.y;
    s.x1 += dx; s.x2 += dx;
    s.y1 += dy; s.y2 += dy;
    if (s.ox !== undefined) s.ox += dx;
    if (s.oy !== undefined) s.oy += dy;
  } else if (h.role === 'axes_xtip') {
    s.x2 = newX;
  } else if (h.role === 'axes_ytip') {
    s.y1 = newY;
  } else if (h.role === 'axes_xstart') {
    s.x1 = newX;
  } else if (h.role === 'axes_ystart') {
    s.y2 = newY;
  } else if (h.role === 'v' && s.vertices && s.vertices[h.index]) {
    s.vertices[h.index].x = newX;
    s.vertices[h.index].y = newY;
  } else if (h.role === 'shape2d' || h.role === 'tri' || h.role === 'rect') {
    const verts = WB.get2DShapeVertices(s);
    if (verts) {
      s.vertices = verts.map(p => ({ x: p.x, y: p.y }));
      s.type = 'polygon';
      s.closed = true;
      s.vertices[h.index] = { x: newX, y: newY };
      h.role = 'v';
    }
  }
  WB.updateSelectionBounds();
};

function subdividePolygonEdges(corners, step = 6) {
  if (!corners || corners.length < 2) return corners || [];
  const out = [];
  for (let i = 0; i < corners.length - 1; i++) {
    const p1 = corners[i], p2 = corners[i + 1];
    const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const n = Math.max(1, Math.ceil(d / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({ x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t });
    }
  }
  out.push(corners[corners.length - 1]);
  return out;
}

function sampleArcPoints(cx, cy, rx, ry, start, end, steps = 40) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = start + ((end - start) * i) / steps;
    pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return pts;
}

WB.getArrowHeadGeometry = function(x1, y1, x2, y2, strokeSize = 4) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const rawHeadLen = Math.max(17, strokeSize * 4.2);
  const headLen = len > 0 ? Math.min(rawHeadLen, len * 0.65) : rawHeadLen;
  const halfAngle = Math.PI / 6.3;

  const baseLeft = {
    x: x2 - headLen * Math.cos(angle - halfAngle),
    y: y2 - headLen * Math.sin(angle - halfAngle)
  };
  const baseRight = {
    x: x2 - headLen * Math.cos(angle + halfAngle),
    y: y2 - headLen * Math.sin(angle + halfAngle)
  };
  const baseCenterLen = headLen * Math.cos(halfAngle);
  const shaftEnd = {
    x: x2 - baseCenterLen * 0.9 * Math.cos(angle),
    y: y2 - baseCenterLen * 0.9 * Math.sin(angle)
  };

  return {
    tip: { x: x2, y: y2 },
    baseLeft,
    baseRight,
    shaftEnd
  };
};

WB.shapeToPointsGroups = function(s) {
  if (s.points) return [s.points];

  if (s.type === 'axes') {
    const geom = WB.getAxesGeometry(s);
    const groups = [];

    // Горизонтальная ось
    groups.push([{ x: geom.xAxis.from.x, y: geom.xAxis.from.y }, { x: geom.xAxis.to.x, y: geom.xAxis.to.y }]);
    // Вертикальная ось
    groups.push([{ x: geom.yAxis.from.x, y: geom.yAxis.from.y }, { x: geom.yAxis.to.x, y: geom.yAxis.to.y }]);

    // Стрелочка оси X (направо)
    const hLen = 14;
    groups.push(subdividePolygonEdges([
      { x: geom.xAxis.to.x - hLen, y: geom.xAxis.to.y - 6 },
      { x: geom.xAxis.to.x, y: geom.xAxis.to.y },
      { x: geom.xAxis.to.x - hLen, y: geom.xAxis.to.y + 6 }
    ], 3));

    // Стрелочка оси Y (наверх)
    groups.push(subdividePolygonEdges([
      { x: geom.yAxis.to.x - 6, y: geom.yAxis.to.y + hLen },
      { x: geom.yAxis.to.x, y: geom.yAxis.to.y },
      { x: geom.yAxis.to.x + 6, y: geom.yAxis.to.y + hLen }
    ], 3));

    // Засечки делений по осям
    const tick = 5;
    const step = geom.step;
    for (let x = geom.origin.x + step; x < geom.xAxis.to.x - 16; x += step) {
      groups.push([{ x, y: geom.origin.y - tick }, { x, y: geom.origin.y + tick }]);
    }
    for (let x = geom.origin.x - step; x > geom.xAxis.from.x + 10; x -= step) {
      groups.push([{ x, y: geom.origin.y - tick }, { x, y: geom.origin.y + tick }]);
    }
    for (let y = geom.origin.y - step; y > geom.yAxis.to.y + 16; y -= step) {
      groups.push([{ x: geom.origin.x - tick, y }, { x: geom.origin.x + tick, y }]);
    }
    for (let y = geom.origin.y + step; y < geom.yAxis.from.y - 10; y += step) {
      groups.push([{ x: geom.origin.x - tick, y }, { x: geom.origin.x + tick, y }]);
    }

    return groups;
  }

  if (s.type === 'polygon' && s.vertices && s.vertices.length > 1) {
    const ring = s.closed ? [...s.vertices, { ...s.vertices[0] }] : [...s.vertices];
    return [subdividePolygonEdges(ring, 6)];
  }

  if (s.type === 'line') {
    return [[{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }]];
  }

  if (s.type === 'arrow') {
    const g = WB.getArrowHeadGeometry(s.x1, s.y1, s.x2, s.y2, s.size || 4);
    return [
      [{ x: s.x1, y: s.y1 }, { x: g.tip.x, y: g.tip.y }],
      subdividePolygonEdges([g.baseLeft, g.tip, g.baseRight, g.baseLeft], 4)
    ];
  }

  const poly2d = WB.get2DShapeVertices(s);
  if (poly2d && poly2d.length > 1) {
    return [subdividePolygonEdges([...poly2d, poly2d[0]], 6)];
  }

  if (s.type === 'ellipse' || s.type === 'circle' || s.type === 'unit_circle') {
    const b = WB.getNormalizedShapeBox(s);
    const rx = b.w / 2;
    const ry = b.h / 2;
    const groups = [sampleArcPoints(b.cx, b.cy, rx, ry, 0, Math.PI * 2, 64)];
    if (s.type === 'unit_circle') {
      const ext = Math.max(14, Math.min(rx, ry) * 0.22);
      groups.push([{ x: b.minX - ext, y: b.cy }, { x: b.maxX + ext, y: b.cy }]);
      groups.push([{ x: b.cx, y: b.maxY + ext }, { x: b.cx, y: b.minY - ext }]);
    }
    return groups;
  }

  const prim3d = WB.get3DShapePrimitives(s);
  if (prim3d) {
    const groups = [];
    for (const poly of prim3d.solidLines) {
      groups.push(subdividePolygonEdges(poly, 6));
    }
    for (const poly of prim3d.dashedLines) {
      groups.push(subdividePolygonEdges(poly, 6));
    }
    for (const arc of prim3d.arcs) {
      groups.push(sampleArcPoints(arc.cx, arc.cy, arc.rx, arc.ry, arc.start, arc.end, 36));
    }
    if (Array.isArray(prim3d.customLines2d)) {
      for (const cl of prim3d.customLines2d) {
        groups.push(subdividePolygonEdges([{ x: cl.a.x, y: cl.a.y }, { x: cl.b.x, y: cl.b.y }], 6));
      }
    }
    return groups;
  }

  return [];
};

WB.isStrokeHit = function(s, x, y, worldRadius = 10) {
  const tol = worldRadius + (s.size || 4) / 2;
  const b = WB.getStrokeBounds(s);
  if (x < b.x - tol || x > b.x + b.w + tol || y < b.y - tol || y > b.y + b.h + tol) {
    return false;
  }

  const groups = WB.shapeToPointsGroups(s);
  for (const pts of groups) {
    if (pts.length === 1) {
      if (Math.hypot(pts[0].x - x, pts[0].y - y) <= tol) return true;
    } else {
      for (let i = 0; i < pts.length - 1; i++) {
        if (WB.distToSegment(x, y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) <= tol) {
          return true;
        }
      }
    }
  }
  return false;
};

WB.shouldEraseStroke = function(s, target = 'pen_and_highlighter') {
  if (!s) return false;
  const isHl = !!(s.isHighlighter || s.type === 'highlighter');
  const isPen = !isHl && (s.type === 'pen' || Array.isArray(s.points));
  if (target === 'highlighter_only') return isHl;
  if (target === 'pen_only') return isPen;
  if (target === 'all') return true;
  return isPen || isHl;
};

WB.canCurrentUserModify = function(obj, action) {
  if (!obj) return false;
  if (obj.locked) return false;
  if (WB.userRole !== 'student') return true;
  const author = obj.authorRole || 'teacher';
  if (author === 'student') return true;
  const perms = WB.studentPermissions || {};
  if (action === 'delete_stroke') return perms.deleteStrokes !== false;
  if (action === 'delete_object') return perms.deleteObjects !== false;
  if (action === 'edit_material') return perms.editMaterials !== false;
  return true;
};

WB.eraseAt = function(x, y, worldRadius) {
  const nextStrokes = [];
  let changed = false;
  const step = Math.max(2, worldRadius / 3);
  const cfg = WB.eraserConfig || { target: 'pen_and_highlighter', wholeStroke: false };

  if (cfg.target === 'all' && Array.isArray(WB.state.widgets) && WB.state.widgets.length > 0) {
    const beforeW = WB.state.widgets.length;
    WB.state.widgets = WB.state.widgets.filter(w => {
      if (!WB.canCurrentUserModify(w, 'delete_object')) return true;
      const b = WB.getWidgetBounds(w);
      return !(x >= b.x - worldRadius && x <= b.x + b.w + worldRadius && y >= b.y - worldRadius && y <= b.y + b.h + worldRadius);
    });
    if (WB.state.widgets.length !== beforeW) {
      changed = true;
      if (typeof WB.renderWidgetsDOM === 'function') WB.renderWidgetsDOM();
    }
  }

  for (const s of WB.state.strokes) {
    if (!WB.canCurrentUserModify(s, 'delete_stroke') || !WB.shouldEraseStroke(s, cfg.target) || !WB.isStrokeHit(s, x, y, worldRadius)) {
      nextStrokes.push(s);
      continue;
    }

    changed = true;
    if (cfg.wholeStroke) {
      // Стирать штрих целиком
      continue;
    }

    const tol = worldRadius + (s.size || 4) / 2;
    const groups = WB.shapeToPointsGroups(s);
    const isHl = s.type === 'highlighter' || s.isHighlighter;

    for (const rawPts of groups) {
      if (rawPts.length === 1) {
        if (Math.hypot(rawPts[0].x - x, rawPts[0].y - y) > tol) {
          nextStrokes.push(s);
        }
        continue;
      }

      const dense = [rawPts[0]];
      for (let i = 0; i < rawPts.length - 1; i++) {
        const p1 = rawPts[i], p2 = rawPts[i + 1];
        const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        if (d > step && WB.distToSegment(x, y, p1.x, p1.y, p2.x, p2.y) <= tol + step) {
          const n = Math.ceil(d / step);
          for (let k = 1; k < n; k++) {
            const t = k / n;
            dense.push({ x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t });
          }
        }
        dense.push(p2);
      }

      let currentChunk = [];
      for (const p of dense) {
        if (Math.hypot(p.x - x, p.y - y) <= tol) {
          if (currentChunk.length >= 2) {
            nextStrokes.push({
              id: Date.now() + Math.random(),
              type: isHl ? 'highlighter' : 'pen',
              isHighlighter: isHl,
              color: s.color,
              size: s.size,
              lineStyle: s.lineStyle || 'solid',
              authorRole: s.authorRole || 'teacher',
              points: currentChunk
            });
          }
          currentChunk = [];
        } else {
          currentChunk.push(p);
        }
      }

      if (currentChunk.length >= 2) {
        nextStrokes.push({
          id: Date.now() + Math.random(),
          type: isHl ? 'highlighter' : 'pen',
          isHighlighter: isHl,
          color: s.color,
          size: s.size,
          lineStyle: s.lineStyle || 'solid',
          authorRole: s.authorRole || 'teacher',
          points: currentChunk
        });
      }
    }
  }

  if (changed) WB.state.strokes = nextStrokes;
  return changed;
};

WB.eraseSegment = function(x1, y1, x2, y2, worldRadius) {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.ceil(dist / Math.max(2, worldRadius / 2)));
  let anyChanged = false;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (WB.eraseAt(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, worldRadius)) anyChanged = true;
  }
  return anyChanged;
};

// --- АЛГОРИТМ ПОИСКА РЕАЛЬНЫХ ВЕРШИН РАМЕРА — ДУГЛАСА — ПЕКЕРА (RDP) ---
WB.simplifyRDP = function(points, epsilon) {
  if (points.length < 3) return points.slice();
  let dmax = 0, index = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i++) {
    const d = WB.distToSegment(points[i].x, points[i].y, points[0].x, points[0].y, points[end].x, points[end].y);
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }
  if (dmax > epsilon) {
    const rec1 = WB.simplifyRDP(points.slice(0, index + 1), epsilon);
    const rec2 = WB.simplifyRDP(points.slice(index), epsilon);
    return rec1.slice(0, -1).concat(rec2);
  }
  return [points[0], points[end]];
};

function extractTrueCorners(pts, diag, isClosed) {
  let simpl = WB.simplifyRDP(pts, diag * 0.055);

  if (isClosed && simpl.length > 2) {
    if (Math.hypot(simpl[0].x - simpl[simpl.length - 1].x, simpl[0].y - simpl[simpl.length - 1].y) < diag * 0.28) {
      simpl.pop();
    }
  }

  const merged = [];
  for (const p of simpl) {
    if (merged.length === 0 || Math.hypot(p.x - merged[merged.length - 1].x, p.y - merged[merged.length - 1].y) >= diag * 0.12) {
      merged.push({ x: p.x, y: p.y });
    }
  }
  if (isClosed && merged.length > 2 && Math.hypot(merged[0].x - merged[merged.length - 1].x, merged[0].y - merged[merged.length - 1].y) < diag * 0.12) {
    merged.pop();
  }

  const out = [];
  const n = merged.length;
  if (n < 3) return merged;

  for (let i = 0; i < n; i++) {
    if (!isClosed && (i === 0 || i === n - 1)) {
      out.push(merged[i]);
      continue;
    }
    const prev = merged[(i - 1 + n) % n];
    const curr = merged[i];
    const next = merged[(i + 1) % n];
    const a1 = Math.atan2(curr.y - prev.y, curr.x - prev.x);
    const a2 = Math.atan2(next.y - curr.y, next.x - curr.x);
    let diff = Math.abs(a2 - a1) % (Math.PI * 2);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    const deg = (diff * 180) / Math.PI;
    if (deg >= 26) {
      out.push(curr);
    }
  }
  return out;
}

function calcPolygonFitError(pts, corners, isClosed) {
  if (!corners || corners.length < 2) return Infinity;
  let total = 0;
  const n = corners.length;
  const edges = isClosed ? n : n - 1;
  for (const p of pts) {
    let minD = Infinity;
    for (let i = 0; i < edges; i++) {
      const c1 = corners[i], c2 = corners[(i + 1) % n];
      const d = WB.distToSegment(p.x, p.y, c1.x, c1.y, c2.x, c2.y);
      if (d < minD) minD = d;
    }
    total += minD;
  }
  return total / pts.length;
}

// --- РАСПОЗНАВАНИЕ ФИГУР (INK-TO-SHAPE + ЛИНЕЙНЫЙ РЕЖИМ) ---
WB.tryConvertInkToShape = function(s) {
  if (!s || !s.points || s.points.length < 2) return false;
  const pts = s.points;
  const first = s._linearStartPt || pts[0];
  const last = s._linearEndPt || pts[pts.length - 1];

  if (s.type === 'highlighter') {
    s.isHighlighter = true;
  }

  let pathLen = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (i > 0) pathLen += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
  }

  const z = WB.cam?.z || 1;
  const minLineLen = Math.max(10, 14 / z);
  const rawFirst = pts[0], rawLast = pts[pts.length - 1];
  const rawDirectDist = Math.hypot(rawLast.x - rawFirst.x, rawLast.y - rawFirst.y);
  const directDist = Math.hypot(last.x - first.x, last.y - first.y);

  if (pathLen >= minLineLen && rawDirectDist >= minLineLen && (rawDirectDist / Math.max(1, pathLen) > 0.88)) {
    const p1 = s._linearStartPt
      ? { x: s._linearStartPt.x, y: s._linearStartPt.y }
      : WB.snapPointCombined(first, s.id, { snapToVertex: !!WB.autoShapeEnabled, snapToGrid: !!WB.snapToGridEnabled });
    const p2 = s._linearEndPt
      ? { x: s._linearEndPt.x, y: s._linearEndPt.y }
      : WB.computeLinearSnappedEndpoint(p1, last, s.id, { snapToVertex: !!WB.autoShapeEnabled, snapToGrid: !!WB.snapToGridEnabled });

    delete s.points;
    delete s._linearStartPt;
    delete s._linearStartSource;
    delete s._linearEndPt;
    delete s._linearEndSource;
    s.type = 'line';
    s.x1 = p1.x; s.y1 = p1.y;
    s.x2 = p2.x; s.y2 = p2.y;
    WB.bindConnectorEndpoints(s);
    return 'Отрезок';
  }

  if (pts.length < 5 || pathLen < 35) return false;

  const w = maxX - minX, h = maxY - minY;
  const diag = Math.hypot(w, h);
  if (diag < 25) return false;

  const isClosed = directDist < Math.max(65, pathLen * 0.28);

  const snapCorners = (corners) => corners.map((c) => {
    const sn = WB.snapPointCombined(c, s.id, {
      snapToVertex: !!WB.autoShapeEnabled,
      snapToGrid: !!WB.snapToGridEnabled
    });
    return { x: sn.x, y: sn.y };
  });

  if (isClosed && w > 20 && h > 20) {
    const corners = extractTrueCorners(pts, diag, true);
    const polyErr = calcPolygonFitError(pts, corners, true);

    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const rx = Math.max(1, w / 2), ry = Math.max(1, h / 2);
    const norm = Math.hypot(rx, ry);
    let errEllipsePx = 0;
    for (const p of pts) {
      const nd = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry);
      errEllipsePx += Math.abs(nd - 1) * (norm * 0.7);
    }
    errEllipsePx /= pts.length;

    if (corners.length >= 3 && corners.length <= 6 && (polyErr < errEllipsePx * 0.85 || (corners.length <= 4 && polyErr < diag * 0.05))) {
      delete s.points;
      delete s._linearStartPt;
      delete s._linearStartSource;
      delete s._linearEndPt;
      delete s._linearEndSource;
      s.type = 'polygon';
      s.closed = true;
      s.vertices = snapCorners(corners);

      const names = {
        3: 'Треугольник (по вершинам)',
        4: 'Четырёхугольник (по вершинам)',
        5: 'Пятиугольник',
        6: 'Шестиугольник'
      };
      return names[corners.length] || `Многоугольник (${corners.length} углов)`;
    }

    if (errEllipsePx < diag * 0.085) {
      delete s.points;
      delete s._linearStartPt;
      delete s._linearStartSource;
      delete s._linearEndPt;
      delete s._linearEndSource;
      s.type = 'ellipse';
      s.x1 = minX; s.y1 = minY;
      s.x2 = maxX; s.y2 = maxY;
      return 'Эллипс / Круг';
    }
  } else {
    const openCorners = extractTrueCorners(pts, diag, false);
    const openErr = calcPolygonFitError(pts, openCorners, false);
    if (openCorners.length >= 3 && openCorners.length <= 7 && openErr < diag * 0.045) {
      delete s.points;
      delete s._linearStartPt;
      delete s._linearStartSource;
      delete s._linearEndPt;
      delete s._linearEndSource;
      s.type = 'polygon';
      s.closed = false;
      s.vertices = snapCorners(openCorners);
      return `Ломаная (${openCorners.length} вершин)`;
    }
  }

  return false;
};

WB.findWidgetAtWithMargin = function(x, y, margin = 16) {
  for (let i = WB.state.widgets.length - 1; i >= 0; i--) {
    const w = WB.state.widgets[i];
    const box = { x: w.x - margin, y: w.y - margin, w: w.w + margin * 2, h: w.h + margin * 2 };
    if (WB.pointInBox(x, y, box)) return w;
  }
  return null;
};

WB.bindConnectorEndpoints = function(s) {
  if (!s || (s.type !== 'arrow' && s.type !== 'line')) return;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  const wStart = WB.findWidgetAtWithMargin(s.x1, s.y1, 18);
  if (wStart) {
    s.startBind = {
      widgetId: wStart.id,
      rx: clamp01((s.x1 - wStart.x) / wStart.w),
      ry: clamp01((s.y1 - wStart.y) / wStart.h)
    };
  } else {
    delete s.startBind;
  }

  const wEnd = WB.findWidgetAtWithMargin(s.x2, s.y2, 18);
  if (wEnd && (!wStart || wEnd.id !== wStart.id)) {
    s.endBind = {
      widgetId: wEnd.id,
      rx: clamp01((s.x2 - wEnd.x) / wEnd.w),
      ry: clamp01((s.y2 - wEnd.y) / wEnd.h)
    };
  } else {
    delete s.endBind;
  }
};

WB.updateConnectedArrows = function() {
  const widgetMap = {};
  for (const w of WB.state.widgets) widgetMap[w.id] = w;

  for (const s of WB.state.strokes) {
    if (s.type !== 'arrow' && s.type !== 'line') continue;
    if (s.startBind) {
      const w = widgetMap[s.startBind.widgetId];
      if (w) {
        s.x1 = w.x + w.w * s.startBind.rx;
        s.y1 = w.y + w.h * s.startBind.ry;
      } else {
        delete s.startBind;
      }
    }
    if (s.endBind) {
      const w = widgetMap[s.endBind.widgetId];
      if (w) {
        s.x2 = w.x + w.w * s.endBind.rx;
        s.y2 = w.y + w.h * s.endBind.ry;
      } else {
        delete s.endBind;
      }
    }
  }
};

WB.findStrokeAt = function(x, y) {
  for (let i = WB.state.strokes.length - 1; i >= 0; i--) {
    if (WB.isStrokeHit(WB.state.strokes[i], x, y, 8 / WB.cam.z)) return WB.state.strokes[i];
  }
  return null;
};

WB.findWidgetAt = function(x, y) {
  for (let i = WB.state.widgets.length - 1; i >= 0; i--) {
    const w = WB.state.widgets[i];
    if (WB.pointInBox(x, y, WB.getWidgetBounds(w))) return w;
  }
  return null;
};

WB.getSelectionCornerHit = function(x, y) {
  const b = WB.selection.bounds;
  if (!b) return null;
  const tol = 12 / WB.cam.z;
  const corners = {
    nw: [b.x, b.y],
    ne: [b.x + b.w, b.y],
    sw: [b.x, b.y + b.h],
    se: [b.x + b.w, b.y + b.h]
  };
  for (const key in corners) {
    const [cx, cy] = corners[key];
    if (Math.hypot(x - cx, y - cy) <= tol) return key;
  }
  return null;
};

WB.updateSelectionBounds = function() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let count = 0;

  for (const s of WB.state.strokes) {
    if (WB.selection.strokeIds.has(s.id)) {
      const b = WB.getStrokeBounds(s);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
      count++;
    }
  }

  for (const w of WB.state.widgets) {
    if (WB.selection.widgetIds.has(w.id)) {
      const b = WB.getWidgetBounds(w);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
      count++;
    }
  }

  if (count > 0) {
    const pad = 12;
    WB.selection.bounds = {
      x: minX - pad,
      y: minY - pad,
      w: Math.max(20, (maxX - minX) + pad * 2),
      h: Math.max(20, (maxY - minY) + pad * 2)
    };
  } else {
    WB.selection.bounds = null;
  }

  WB.syncWidgetSelectionDOM();
  if (typeof WB.sync3DFloatingUI === 'function') WB.sync3DFloatingUI();
  if (typeof WB.sync2DFloatingUI === 'function') WB.sync2DFloatingUI();
};

WB.clearSelection = function() {
  WB.selection.strokeIds.clear();
  WB.selection.widgetIds.clear();
  WB.selection.marquee = null;
  WB.selection.bounds = null;
  if (WB.s3dEditor) {
    WB.s3dEditor.strokeId = null;
    WB.s3dEditor.customPos = null;
    WB.s3dEditor.customOffset = null;
    WB.s3dEditor.lockedPos = null;
    WB.s3dEditor.pendingPointRefs = [];
  }
  const activeEl = document.activeElement;
  const isEditingField = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.closest?.('.widget.editing'));
  if (!isEditingField) {
    try { window.getSelection?.()?.removeAllRanges?.(); } catch (_) {}
  }
  WB.syncWidgetSelectionDOM();
  if (typeof WB.sync3DFloatingUI === 'function') WB.sync3DFloatingUI();
  if (typeof WB.sync2DFloatingUI === 'function') WB.sync2DFloatingUI();
};

WB.moveSelection = function(dx, dy) {
  const appliedDx = dx;
  const appliedDy = dy;

  let movedAny = false;
  for (const w of WB.state.widgets) {
    if (WB.selection.widgetIds.has(w.id)) {
      if (!WB.canCurrentUserModify(w, 'edit_material')) continue;
      w.x += appliedDx;
      w.y += appliedDy;
      movedAny = true;
    }
  }

  for (const s of WB.state.strokes) {
    if (WB.selection.strokeIds.has(s.id)) {
      if (!WB.canCurrentUserModify(s, 'edit_material')) continue;
      movedAny = true;
      if (s.points) {
        for (const p of s.points) { p.x += appliedDx; p.y += appliedDy; }
      } else if (s.vertices) {
        for (const v of s.vertices) { v.x += appliedDx; v.y += appliedDy; }
      } else {
        if (!s.startBind || !WB.selection.widgetIds.has(s.startBind.widgetId)) {
          s.x1 += appliedDx; s.y1 += appliedDy;
        }
        if (!s.endBind || !WB.selection.widgetIds.has(s.endBind.widgetId)) {
          s.x2 += appliedDx; s.y2 += appliedDy;
        }
        if (s.ox !== undefined) s.ox += appliedDx;
        if (s.oy !== undefined) s.oy += appliedDy;
      }
    }
  }

  WB.updateConnectedArrows();
  for (const s of WB.state.strokes) {
    if (WB.selection.strokeIds.has(s.id) && WB.canCurrentUserModify(s, 'edit_material') && (s.type === 'arrow' || s.type === 'line')) {
      WB.bindConnectorEndpoints(s);
    }
  }

  if (movedAny && WB.selection.bounds) {
    WB.selection.bounds.x += appliedDx;
    WB.selection.bounds.y += appliedDy;
  }

  WB.syncWidgetPositionsDOM();
  if (typeof WB.sync3DFloatingUI === 'function') WB.sync3DFloatingUI();
  if (typeof WB.sync2DFloatingUI === 'function') WB.sync2DFloatingUI();
};

WB.scaleSelectionFromSnapshot = function(snap, scaleX, scaleY) {
  const { ax, ay, strokesSnap, widgetsSnap } = snap;

  for (const s of WB.state.strokes) {
    const s0 = strokesSnap[s.id];
    if (!s0 || s.locked || s0.locked || !WB.canCurrentUserModify(s, 'edit_material')) continue;
    if (s0.points) {
      s.points = s0.points.map(p => ({
        x: ax + (p.x - ax) * scaleX,
        y: ay + (p.y - ay) * scaleY
      }));
    } else if (s0.vertices) {
      s.vertices = s0.vertices.map(v => ({
        x: ax + (v.x - ax) * scaleX,
        y: ay + (v.y - ay) * scaleY
      }));
    } else {
      s.x1 = ax + (s0.x1 - ax) * scaleX;
      s.y1 = ay + (s0.y1 - ay) * scaleY;
      s.x2 = ax + (s0.x2 - ax) * scaleX;
      s.y2 = ay + (s0.y2 - ay) * scaleY;
      if (s0.ox !== undefined) s.ox = ax + (s0.ox - ax) * scaleX;
      if (s0.oy !== undefined) s.oy = ay + (s0.oy - ay) * scaleY;
    }
  }

  for (const w of WB.state.widgets) {
    const w0 = widgetsSnap[w.id];
    if (!w0 || !WB.canCurrentUserModify(w, 'edit_material')) continue;
    const x1 = ax + (w0.x - ax) * scaleX;
    const y1 = ay + (w0.y - ay) * scaleY;
    const x2 = ax + (w0.x + w0.w - ax) * scaleX;
    const y2 = ay + (w0.y + w0.h - ay) * scaleY;
    w.x = Math.min(x1, x2);
    w.y = Math.min(y1, y2);
    w.w = Math.max(90, Math.abs(x2 - x1));
    w.h = Math.max(55, Math.abs(y2 - y1));
  }

  WB.updateConnectedArrows();
  WB.syncWidgetPositionsDOM();
  WB.updateSelectionBounds();
};

WB.deleteSelection = function() {
  if (WB.selection.strokeIds.size === 0 && WB.selection.widgetIds.size === 0) return;
  let hadLockedOnly = false;
  let blockedByPerms = false;
  const beforeStrokes = WB.state.strokes.length;
  const beforeWidgets = WB.state.widgets.length;
  WB.state.strokes = WB.state.strokes.filter(s => {
    if (!WB.selection.strokeIds.has(s.id)) return true;
    if (s.locked) {
      hadLockedOnly = true;
      return true;
    }
    if (!WB.canCurrentUserModify(s, 'delete_stroke')) {
      blockedByPerms = true;
      return true;
    }
    return false;
  });
  WB.state.widgets = WB.state.widgets.filter(w => {
    if (!WB.selection.widgetIds.has(w.id)) return true;
    if (!WB.canCurrentUserModify(w, 'delete_object')) {
      blockedByPerms = true;
      return true;
    }
    return false;
  });
  const deletedAny = WB.state.strokes.length !== beforeStrokes || WB.state.widgets.length !== beforeWidgets;
  if (!deletedAny) {
    if (blockedByPerms && typeof WB.showToast === 'function') {
      WB.showToast('🔒 Преподаватель ограничил удаление этих объектов', 2800, 'error');
    } else if (hadLockedOnly && typeof WB.showToast === 'function') {
      WB.showToast('🔒 Фигура заблокирована — сначала разблокируйте её');
    }
    return;
  }
  const remainingStrokeIds = new Set(WB.state.strokes.map(s => s.id));
  for (const sid of Array.from(WB.selection.strokeIds)) {
    if (!remainingStrokeIds.has(sid)) WB.selection.strokeIds.delete(sid);
  }
  const remainingWidgetIds = new Set(WB.state.widgets.map(w => w.id));
  for (const wid of Array.from(WB.selection.widgetIds)) {
    if (!remainingWidgetIds.has(wid)) WB.selection.widgetIds.delete(wid);
  }
  WB.updateSelectionBounds();
  WB.renderWidgetsDOM();
  WB.saveHistory();
};

WB.duplicateSelection = function() {
  if (WB.selection.strokeIds.size === 0 && WB.selection.widgetIds.size === 0) return;
  const newStrokeIds = new Set();
  const newWidgetIds = new Set();
  const offset = 32; // Ровно 1 шаг сетки

  const strokesToCopy = WB.state.strokes.filter(s => WB.selection.strokeIds.has(s.id));
  for (const s of strokesToCopy) {
    const copy = JSON.parse(JSON.stringify(s));
    copy.id = Date.now() + Math.random();
    delete copy.locked;
    copy.authorRole = WB.userRole || 'teacher';
    if (copy.points) {
      copy.points.forEach(p => { p.x += offset; p.y += offset; });
    } else if (copy.vertices) {
      copy.vertices.forEach(v => { v.x += offset; v.y += offset; });
    } else {
      copy.x1 += offset; copy.y1 += offset;
      copy.x2 += offset; copy.y2 += offset;
      if (copy.ox !== undefined) copy.ox += offset;
      if (copy.oy !== undefined) copy.oy += offset;
      delete copy.startBind;
      delete copy.endBind;
    }
    WB.state.strokes.push(copy);
    newStrokeIds.add(copy.id);
  }

  const widgetsToCopy = WB.state.widgets.filter(w => WB.selection.widgetIds.has(w.id));
  for (const w of widgetsToCopy) {
    const copy = JSON.parse(JSON.stringify(w));
    copy.id = 'w_' + Date.now() + Math.floor(Math.random() * 10000);
    copy.authorRole = WB.userRole || 'teacher';
    copy.x += offset;
    copy.y += offset;
    WB.state.widgets.push(copy);
    newWidgetIds.add(copy.id);
  }

  WB.selection.strokeIds = newStrokeIds;
  WB.selection.widgetIds = newWidgetIds;
  WB.renderWidgetsDOM();
  WB.updateSelectionBounds();
  WB.saveHistory();
};

// Копирование выделенного в буфер обмена (Ctrl+C), вырезание (Ctrl+X) и вставка (Ctrl+V)
WB.copySelection = function(silent = false) {
  if (WB.selection.strokeIds.size === 0 && WB.selection.widgetIds.size === 0) return false;
  const strokes = WB.state.strokes
    .filter(s => WB.selection.strokeIds.has(s.id))
    .map(s => JSON.parse(JSON.stringify(s)));
  const widgets = WB.state.widgets
    .filter(w => WB.selection.widgetIds.has(w.id))
    .map(w => JSON.parse(JSON.stringify(w)));

  const seq = ((WB.clipboard && WB.clipboard.seq) || 0) + 1;
  WB.clipboard = { strokes, widgets, pasteCount: 0, seq, copiedAt: Date.now() };
  if (!silent && typeof WB.showToast === 'function') {
    WB.showToast(`📋 Скопировано объектов: ${strokes.length + widgets.length}`);
  }
  return true;
};

WB.cutSelection = function() {
  if (!WB.copySelection(true)) return false;
  WB.deleteSelection();
  if (typeof WB.showToast === 'function') {
    WB.showToast('✂️ Вырезано в буфер обмена');
  }
  return true;
};

WB.pasteClipboard = function() {
  if (!WB.clipboard || (!WB.clipboard.strokes?.length && !WB.clipboard.widgets?.length)) {
    return false;
  }
  WB.clipboard.pasteCount = (WB.clipboard.pasteCount || 0) + 1;

  // Вычисляем границы скопированного набора, чтобы при уходе экрана вставлять по центру вида
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of (WB.clipboard.strokes || [])) {
    const b = WB.getStrokeBounds(s);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  for (const w of (WB.clipboard.widgets || [])) {
    const b = WB.getWidgetBounds(w);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }

  let dx = 32 * WB.clipboard.pasteCount;
  let dy = 32 * WB.clipboard.pasteCount;
  if (Number.isFinite(minX) && Number.isFinite(maxX)) {
    const z = WB.cam?.z || 1;
    const vw = window.innerWidth || 1280;
    const vh = window.innerHeight || 720;
    const viewLeft = -WB.cam.x / z;
    const viewTop = -WB.cam.y / z;
    const viewRight = (vw - WB.cam.x) / z;
    const viewBottom = (vh - WB.cam.y) / z;
    const isVisible = !(maxX < viewLeft || minX > viewRight || maxY < viewTop || minY > viewBottom);
    if (!isVisible) {
      const boxCx = (minX + maxX) / 2;
      const boxCy = (minY + maxY) / 2;
      const viewCx = (viewLeft + viewRight) / 2;
      const viewCy = (viewTop + viewBottom) / 2;
      dx = viewCx - boxCx + 24 * (WB.clipboard.pasteCount - 1);
      dy = viewCy - boxCy + 24 * (WB.clipboard.pasteCount - 1);
      if (WB.snapToGridEnabled) {
        const sn = WB.snapToGrid(minX + dx, minY + dy);
        dx += sn.x - (minX + dx);
        dy += sn.y - (minY + dy);
      }
    }
  }

  const newStrokeIds = new Set();
  const newWidgetIds = new Set();
  const pastedStrokes = [];
  const baseStamp = Date.now();
  let seqIdx = 0;

  for (const s of (WB.clipboard.strokes || [])) {
    seqIdx++;
    const copy = JSON.parse(JSON.stringify(s));
    copy.id = baseStamp + seqIdx * 0.001 + Math.random() * 0.0005;
    delete copy.locked;
    copy.authorRole = WB.userRole || 'teacher';
    if (copy.points) {
      copy.points.forEach(p => { p.x += dx; p.y += dy; });
    } else if (copy.vertices) {
      copy.vertices.forEach(v => { v.x += dx; v.y += dy; });
    } else {
      copy.x1 += dx; copy.y1 += dy;
      copy.x2 += dx; copy.y2 += dy;
      if (copy.ox !== undefined) copy.ox += dx;
      if (copy.oy !== undefined) copy.oy += dy;
      delete copy.startBind;
      delete copy.endBind;
    }
    WB.state.strokes.push(copy);
    newStrokeIds.add(copy.id);
    pastedStrokes.push(copy);
  }

  for (const w of (WB.clipboard.widgets || [])) {
    seqIdx++;
    const copy = JSON.parse(JSON.stringify(w));
    copy.id = 'w_' + baseStamp + '_' + seqIdx + '_' + Math.floor(Math.random() * 10000);
    copy.authorRole = WB.userRole || 'teacher';
    copy.x += dx;
    copy.y += dy;
    WB.state.widgets.push(copy);
    newWidgetIds.add(copy.id);
  }

  WB.setTool('select');
  WB.selection.strokeIds = newStrokeIds;
  WB.selection.widgetIds = newWidgetIds;
  if (WB.s3dEditor && pastedStrokes.length === 1 && newWidgetIds.size === 0 && typeof WB.is3DShapeStroke === 'function' && WB.is3DShapeStroke(pastedStrokes[0])) {
    WB.s3dEditor.strokeId = pastedStrokes[0].id;
    WB.s3dEditor.mode = 'move';
    WB.s3dEditor.settingsOpen = false;
    WB.s3dEditor.customPos = null;
    WB.s3dEditor.customOffset = null;
    WB.s3dEditor.lockedPos = null;
  }
  WB.renderWidgetsDOM();
  WB.updateSelectionBounds();
  WB.saveHistory();
  if (typeof WB.showToast === 'function') {
    WB.showToast(`📋 Вставлено объектов: ${newStrokeIds.size + newWidgetIds.size}`);
  }
  return true;
};

WB.selectAllOnPage = function() {
  const strokes = WB.state.strokes || [];
  const widgets = WB.state.widgets || [];
  const total = strokes.length + widgets.length;
  if (total === 0) {
    if (typeof WB.showToast === 'function') WB.showToast('ℹ️ На текущей странице пока нет объектов');
    return false;
  }
  if (typeof WB.setTool === 'function') WB.setTool('select');
  WB.selection.strokeIds = new Set(strokes.map(s => s.id));
  WB.selection.widgetIds = new Set(widgets.map(w => w.id));
  WB.updateSelectionBounds();
  if (typeof WB.showToast === 'function') {
    WB.showToast(`☑️ Выделено объектов: ${total}`);
  }
  return true;
};
