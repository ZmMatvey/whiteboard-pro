window.WB = window.WB || {};

WB.noteColors = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#fed7aa'];
WB.latexColors = ['#1e293b', '#2563eb', '#ef4444', '#16a34a', '#7e22ce'];

let currentEditingLatexId = null;
const activeIntervals = {}; // Хранилище интервалов для таймеров и секундомеров

// Надёжное распознавание двойного тапа на iOS/Android для интерактивных виджетов
function attachTouchDoubleTap(targetEl, onDoubleTap, opts = {}) {
  if (!targetEl || typeof onDoubleTap !== 'function') return;
  let downPos = null;
  let downId = null;
  let lastTapTime = 0;
  let lastTapPos = { x: 0, y: 0 };
  let suppressDblClickUntil = 0;

  targetEl.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType !== 'touch' || WB._isTouchGestureActive) {
      downPos = null;
      return;
    }
    if (opts.ignoreSelector && ev.target.closest(opts.ignoreSelector)) {
      downPos = null;
      return;
    }
    downId = ev.pointerId;
    downPos = { x: ev.clientX, y: ev.clientY };
  });

  targetEl.addEventListener('pointercancel', () => {
    downPos = null;
    downId = null;
  });

  targetEl.addEventListener('pointerup', (ev) => {
    if (ev.pointerType !== 'touch' || !downPos || ev.pointerId !== downId || WB._isTouchGestureActive) {
      downPos = null;
      downId = null;
      return;
    }
    const moved = Math.hypot(ev.clientX - downPos.x, ev.clientY - downPos.y);
    downPos = null;
    downId = null;
    if (moved > 18) return;

    const now = performance.now();
    const dist = Math.hypot(ev.clientX - lastTapPos.x, ev.clientY - lastTapPos.y);
    if (now - lastTapTime < 360 && dist < 34) {
      lastTapTime = 0;
      suppressDblClickUntil = now + 500;
      ev.stopPropagation();
      onDoubleTap(ev);
    } else {
      lastTapTime = now;
      lastTapPos = { x: ev.clientX, y: ev.clientY };
    }
  });

  targetEl.addEventListener('dblclick', (ev) => {
    if (opts.ignoreSelector && ev.target.closest(opts.ignoreSelector)) return;
    if (performance.now() < suppressDblClickUntil) {
      ev.stopPropagation();
      return;
    }
    ev.stopPropagation();
    onDoubleTap(ev);
  });
}

// Рендер формул LaTeX через KaTeX (с офлайн фоллбэком)
WB.renderLatexInto = function(latexStr, targetEl) {
  if (!targetEl) return;
  const cleanLatex = (latexStr || '').trim();
  if (!cleanLatex) {
    targetEl.innerHTML = '<span style="opacity:0.4; font-style:italic;">Пустая формула</span>';
    return;
  }

  if (window.katex && typeof window.katex.render === 'function') {
    try {
      window.katex.render(cleanLatex, targetEl, {
        throwOnError: false,
        displayMode: true
      });
      return;
    } catch (e) {}
  }

  // Офлайн фоллбэк
  let html = cleanLatex
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1)/($2)')
    .replace(/\\sqrt\{([^}]+)\}/g, '√($1)')
    .replace(/\\sqrt\[([^\]]+)\]\{([^}]+)\}/g, '$1√($2)')
    .replace(/\\int_\{([^}]+)\}\^\{([^}]+)\}/g, '∫_{$1}^{$2}')
    .replace(/\\int/g, '∫')
    .replace(/\\sum_\{([^}]+)\}\^\{([^}]+)\}/g, '∑_{$1}^{$2}')
    .replace(/\\sum/g, '∑')
    .replace(/\\pm/g, '±')
    .replace(/\\times/g, '×')
    .replace(/\\cdot/g, '·')
    .replace(/\\div/g, '÷')
    .replace(/\\neq/g, '≠')
    .replace(/\\leq/g, '≤')
    .replace(/\\geq/g, '≥')
    .replace(/\\approx/g, '≈')
    .replace(/\\infty/g, '∞')
    .replace(/\\alpha/g, 'α')
    .replace(/\\beta/g, 'β')
    .replace(/\\gamma/g, 'γ')
    .replace(/\\pi/g, 'π')
    .replace(/\\theta/g, 'θ')
    .replace(/\\Delta/g, 'Δ')
    .replace(/\\angle/g, '∠')
    .replace(/\\vec\{([^}]+)\}/g, '→$1')
    .replace(/\^\{([^}]+)\}/g, '<sup>$1</sup>')
    .replace(/\^([0-9a-zA-Z])/g, '<sup>$1</sup>')
    .replace(/_\{([^}]+)\}/g, '<sub>$1</sub>')
    .replace(/_([0-9a-zA-Z])/g, '<sub>$1</sub>');

  targetEl.innerHTML = `<span class="latex-fallback-rendered">${html}</span>`;
};

// Добавление виджета на доску (или на активную страницу PDF, если открыт PDF-редактор)
WB.addWidget = function(type, customData = {}) {
  WB.closeAllDropdowns();
  if (WB.pdfEditor && WB.pdfEditor.isOpen && type !== 'image' && typeof WB.addPdfPageWidget === 'function') {
    WB.addPdfPageWidget(type, customData);
    return;
  }
  WB.setTool('select');
  const center = WB.toWorld(window.innerWidth / 2, window.innerHeight / 2);
  let w = 210, h = 180;

  if (type === 'note') {
    w = 210; h = 180;
  } else if (type === 'text') {
    w = 240; h = 80;
  } else if (type === 'latex') {
    w = customData.w || 300;
    h = customData.h || 120;
  } else if (type === 'timer') {
    w = 240; h = 175;
  } else if (type === 'stopwatch') {
    w = 240; h = 185;
  } else if (type === 'calculator') {
    w = customData.w || 312;
    h = customData.h || 552;
  } else if (type === 'table') {
    w = customData.w || 380;
    h = customData.h || 216;
  } else {
    w = customData.w || 340;
    h = customData.h || 260;
  }

  const widgetObj = {
    id: customData.id || ('w_' + Date.now() + Math.floor(Math.random() * 1000)),
    type,
    x: customData.x !== undefined ? customData.x : (center.x - w / 2 + (Math.random() * 20 - 10)),
    y: customData.y !== undefined ? customData.y : (center.y - h / 2 + (Math.random() * 20 - 10)),
    w, h,
    color: customData.color || (type === 'latex' ? '#1e293b' : WB.noteColors[Math.floor(Math.random() * WB.noteColors.length)]),
    text: customData.text ?? (type === 'note' ? 'Двойной клик для текста...' : 'Двойной клик для текста...'),
    latex: customData.latex || (type === 'latex' ? 'f(x) = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}' : null),
    lawTitle: customData.lawTitle || null,
    src: customData.src || null,
    // Метаданные для документов (PDF, DOCX) и фото на доске
    isPdf: customData.isPdf || false,
    isDocx: Boolean(customData.isDocx),
    isPhoto: customData.isPhoto !== undefined
      ? Boolean(customData.isPhoto)
      : (type === 'image' && !customData.isPdf && !customData.isDocx),
    docType: customData.docType || customData.docKind || (customData.isDocx ? 'docx' : (customData.isPdf ? 'pdf' : (type === 'image' ? 'photo' : null))),
    docLabel: customData.docLabel || (customData.isDocx ? 'DOCX' : (customData.isPdf ? 'PDF' : (type === 'image' ? 'ФОТО' : null))),
    docEmoji: customData.docEmoji || (customData.isDocx ? '📘' : (customData.isPdf ? '📕' : (type === 'image' ? '🖼️' : null))),
    docAccent: customData.docAccent || (customData.isDocx ? '#2563eb' : (customData.isPdf ? '#dc2626' : (type === 'image' ? '#0d9488' : null))),
    pdfTitle: customData.pdfTitle || (type === 'image' && !customData.isPdf ? 'Фото.png' : 'Документ'),
    pdfPages: customData.pdfPages || ((customData.isPdf || type === 'image') && customData.src ? [customData.src] : null),
    docxPages: Array.isArray(customData.docxPages)
      ? customData.docxPages.map(p => (p ? Object.assign({}, p) : null))
      : null,
    currentPage: customData.currentPage || 0,
    // Состояние виджетов LearnBoard и Таблицы
    timerTotalSec: customData.timerTotalSec || 300,
    timerRemainSec: customData.timerRemainSec ?? 300,
    stopwatchMs: customData.stopwatchMs || 0,
    calcExpr: customData.calcExpr || '',
    calcDisplayResult: customData.calcDisplayResult || '',
    calcHistoryExpr: customData.calcHistoryExpr || '',
    calcMode: customData.calcMode || 'DEG',
    calcAppMode: customData.calcAppMode || 'COMP',
    calcDispFmt: customData.calcDispFmt || 'NORM',
    calcDispDigits: customData.calcDispDigits ?? 2,
    calcMem: customData.calcMem || 0,
    calcVars: customData.calcVars ? Object.assign({}, customData.calcVars) : { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, X: 0, Y: 0, M: 0 },
    calcSdData: Array.isArray(customData.calcSdData) ? customData.calcSdData.slice() : [],
    calcLastAns: customData.calcLastAns || '0',
    calcLastNumeric: customData.calcLastNumeric ?? 0,
    calcFracState: 0,
    calcShift: false,
    calcAlpha: false,
    calcHyp: false,
    calcSto: false,
    calcRcl: false,
    calcIns: false,
    calcOff: false,
    calcMenu: null,
    calcCursorPos: 0,
    calcEngOffset: 0,
    calcHistoryLog: Array.isArray(customData.calcHistoryLog) ? customData.calcHistoryLog : [],
    calcReplayIdx: -1,
    calcJustEvaluated: false,
    tableData: Array.isArray(customData.tableData)
      ? customData.tableData.map(row => [...row])
      : (type === 'table'
        ? [['Столбец 1', 'Столбец 2', 'Столбец 3'], ['', '', ''], ['', '', '']]
        : null)
  };

  if (WB.snapToGridEnabled && customData.x === undefined) {
    const sn = WB.snapToGrid(widgetObj.x, widgetObj.y);
    widgetObj.x = sn.x;
    widgetObj.y = sn.y;
  }

  WB.state.widgets.push(widgetObj);
  WB.clearSelection();
  WB.selection.widgetIds.add(widgetObj.id);
  WB.renderWidgetsDOM();
  WB.updateSelectionBounds();
  WB.saveHistory();

  if (type === 'latex' && !customData.latex) {
    WB.openLatexModal(widgetObj.id);
  }
  return widgetObj;
};

WB.syncWidgetPositionsDOM = function() {
  const worldLayer = document.getElementById('world-layer');
  if (!worldLayer) return;
  for (const w of WB.state.widgets) {
    const el = worldLayer.querySelector(`.widget[data-id="${w.id}"]`);
    if (el) {
      el.style.left = w.x + 'px';
      el.style.top = w.y + 'px';
      el.style.width = w.w + 'px';
      el.style.height = w.h + 'px';
    }
  }
};

WB.syncWidgetSelectionDOM = function() {
  document.querySelectorAll('.widget').forEach(el => {
    el.classList.toggle('selected', WB.selection.widgetIds.has(el.dataset.id));
  });
};

WB.startEditingWidget = function(id) {
  const w = WB.state.widgets.find(item => item.id === id);
  if (!w) return;

  if (w.type === 'latex') {
    WB.openLatexModal(id);
    return;
  }
  if (w.isPdf || w.type === 'pdf' || w.type === 'image') {
    if (typeof WB.openPdfEditorForWidget === 'function') {
      WB.openPdfEditorForWidget(id);
    }
    return;
  }

  const el = document.querySelector(`.widget[data-id="${id}"]`);
  if (!el) return;
  if (w.type === 'table') {
    el.classList.add('editing');
    const firstCell = el.querySelector('.wb-table td, .wb-table th');
    if (firstCell) {
      firstCell.focus();
      const range = document.createRange();
      range.selectNodeContents(firstCell);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    return;
  }
  const bodyEl = el.querySelector('.widget-body');
  if (!bodyEl) return;

  if (w.text === 'Двойной клик для текста...') {
    w.text = '';
    bodyEl.innerText = '';
  }

  el.classList.add('editing');
  bodyEl.focus();

  const range = document.createRange();
  range.selectNodeContents(bodyEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
};

function formatTimeMMSS(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function formatStopwatch(ms) {
  const totalTenths = Math.floor(ms / 100);
  const tenths = totalTenths % 10;
  const totalSec = Math.floor(totalTenths / 10);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths}`;
}

function calcFactorial(n) {
  if (!Number.isFinite(n) || n < 0 || n > 170 || Math.floor(n) !== n) {
    throw new Error('Domain');
  }
  let res = 1;
  for (let i = 2; i <= n; i++) res *= i;
  return res;
}

function calcNPr(n, r) {
  if (!Number.isFinite(n) || !Number.isFinite(r) || n < 0 || r < 0 || r > n || Math.floor(n) !== n || Math.floor(r) !== r) {
    throw new Error('Domain');
  }
  return calcFactorial(n) / calcFactorial(n - r);
}

function calcNCr(n, r) {
  if (!Number.isFinite(n) || !Number.isFinite(r) || n < 0 || r < 0 || r > n || Math.floor(n) !== n || Math.floor(r) !== r) {
    throw new Error('Domain');
  }
  return calcFactorial(n) / (calcFactorial(r) * calcFactorial(n - r));
}

function calcAngleToRad(v, angleMode = 'DEG') {
  if (angleMode === 'DEG') return (v * Math.PI) / 180;
  if (angleMode === 'GRAD') return (v * Math.PI) / 200;
  return v;
}

function calcRadToAngle(v, angleMode = 'DEG') {
  if (angleMode === 'DEG') return (v * 180) / Math.PI;
  if (angleMode === 'GRAD') return (v * 200) / Math.PI;
  return v;
}

function formatCalcResult(num, dispFmt = 'NORM', dispDigits = 2) {
  if (!Number.isFinite(num)) return 'Ошибка';
  if (Object.is(num, -0) || num === 0) {
    if (dispFmt === 'FIX') return (0).toFixed(Math.max(0, Math.min(9, dispDigits)));
    if (dispFmt === 'SCI') {
      const d = Math.max(0, Math.min(9, dispDigits));
      return (0).toExponential(d === 0 ? 9 : Math.max(0, d - 1));
    }
    return '0';
  }
  if (dispFmt === 'FIX') {
    const d = Math.max(0, Math.min(9, dispDigits));
    if (Math.abs(num) >= 1e10) return num.toExponential(Math.min(9, Math.max(1, d))).replace(/\.?0+e/, 'e');
    return num.toFixed(d);
  }
  if (dispFmt === 'SCI') {
    const d = Math.max(0, Math.min(9, dispDigits));
    const frac = d === 0 ? 9 : Math.max(0, d - 1);
    return num.toExponential(frac);
  }
  const rounded = Number(num.toPrecision(10));
  if (!Number.isFinite(rounded)) return 'Ошибка';
  if (Math.abs(rounded) >= 1e10 || (Math.abs(rounded) > 0 && Math.abs(rounded) < 1e-5)) {
    return rounded.toExponential(6).replace(/\.?0+e/, 'e');
  }
  return String(rounded);
}

function decimalToFractionStr(val, improper = false, maxDen = 9999) {
  if (!Number.isFinite(val) || Math.abs(val) > 1e7) return null;
  const sign = val < 0 ? '-' : '';
  const abs = Math.abs(val);
  if (Math.abs(abs - Math.round(abs)) < 1e-10) return `${sign}${Math.round(abs)}`;

  let h1 = 1, h2 = 0, k1 = 0, k2 = 1;
  let b = abs;
  for (let iter = 0; iter < 32; iter++) {
    const a = Math.floor(b);
    const h = a * h1 + h2;
    const k = a * k1 + k2;
    if (k > maxDen) break;
    h2 = h1; h1 = h;
    k2 = k1; k1 = k;
    if (Math.abs(abs - h1 / k1) < 1e-10) break;
    const rem = b - a;
    if (rem < 1e-12) break;
    b = 1 / rem;
  }
  if (k1 <= 0 || Math.abs(abs - h1 / k1) > 1e-7) return null;
  if (k1 === 1) return `${sign}${h1}`;
  if (improper || h1 < k1) return `${sign}${h1}┘${k1}`;
  const whole = Math.floor(h1 / k1);
  const rem = h1 % k1;
  if (rem === 0) return `${sign}${whole}`;
  return `${sign}${whole}┘${rem}┘${k1}`;
}

function formatDMS(val) {
  if (!Number.isFinite(val)) return 'Ошибка';
  const sign = val < 0 ? '-' : '';
  const abs = Math.abs(val);
  let deg = Math.floor(abs + 1e-12);
  const minFloat = (abs - deg) * 60;
  let min = Math.floor(minFloat + 1e-10);
  let sec = Math.round((minFloat - min) * 60 * 100) / 100;
  if (sec >= 60) { sec = 0; min += 1; }
  if (min >= 60) { min = 0; deg += 1; }
  return `${sign}${deg}°${min}′${sec}″`;
}

function formatEng(val, offsetSteps = 0) {
  if (!Number.isFinite(val)) return 'Ошибка';
  if (val === 0) return '0e+0';
  const baseExp = Math.floor(Math.log10(Math.abs(val)) / 3) * 3 - offsetSteps * 3;
  const mantissa = Number((val / Math.pow(10, baseExp)).toPrecision(9));
  return `${mantissa}e${baseExp >= 0 ? '+' + baseExp : baseExp}`;
}

function computeSdStatsLocal(samples) {
  const clean = (samples || []).filter(v => Number.isFinite(v));
  const n = clean.length;
  if (n === 0) return { n: 0, sumX: 0, sumX2: 0, mean: NaN, sigmaN: NaN, sigmaN1: NaN };
  let sumX = 0;
  let sumX2 = 0;
  for (const x of clean) {
    sumX += x;
    sumX2 += x * x;
  }
  const mean = sumX / n;
  const sigmaN = Math.sqrt(Math.max(0, sumX2 / n - mean * mean));
  const sigmaN1 = n > 1 ? Math.sqrt(Math.max(0, (sumX2 - (sumX * sumX) / n) / (n - 1))) : NaN;
  return { n, sumX, sumX2, mean, sigmaN, sigmaN1 };
}

function preprocessComixExpr(raw, angleMode) {
  let s = String(raw || '').trim();
  // Градусы-минуты-секунды: 45°30'15" или 45°30°15°
  s = s.replace(/(\d+(?:\.\d+)?)°(?:(\d+(?:\.\d+)?)[°'′](?:(\d+(?:\.\d+)?)[°"″]?)?)?/g, (_, d, m, sec) => {
    const degVal = (Number(d) || 0) + (Number(m) || 0) / 60 + (Number(sec) || 0) / 3600;
    if (angleMode === 'RAD') return `(${(degVal * Math.PI) / 180})`;
    if (angleMode === 'GRAD') return `(${(degVal * 200) / 180})`;
    return `(${degVal})`;
  });
  // Суффиксы углов DRG▸: ʳ (радианы), ᵍ (грады)
  s = s.replace(/(\d+(?:\.\d+)?|π)ʳ/g, (_, val) => {
    const radExpr = val === 'π' ? String(Math.PI) : val;
    if (angleMode === 'DEG') return `((${radExpr})*180/${Math.PI})`;
    if (angleMode === 'GRAD') return `((${radExpr})*200/${Math.PI})`;
    return `(${radExpr})`;
  });
  s = s.replace(/(\d+(?:\.\d+)?)ᵍ/g, (_, val) => {
    if (angleMode === 'DEG') return `((${val})*0.9)`;
    if (angleMode === 'RAD') return `((${val})*${Math.PI}/200)`;
    return `(${val})`;
  });
  // Обыкновенные и смешанные дроби: a┘b┘c и a┘b
  s = s.replace(/(\d+)┘(\d+)┘(\d+)/g, '($1+$2/$3)');
  s = s.replace(/(\d+)┘(\d+)/g, '($1/$2)');
  return s;
}

WB.evaluatePolRec = function(rawExpr, angleMode = 'DEG', vars = {}) {
  const trimmed = String(rawExpr || '').trim().replace(/;/g, ',');
  const polMatch = trimmed.match(/^Pol\(\s*([^,]+)\s*,\s*([^)]+)\s*\)$/i);
  if (polMatch) {
    const x = WB.evaluatePhysicsCalcNumeric(polMatch[1], angleMode, vars);
    const y = WB.evaluatePhysicsCalcNumeric(polMatch[2], angleMode, vars);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const r = Math.hypot(x, y);
    const theta = calcRadToAngle(Math.atan2(y, x), angleMode);
    return { primary: r, secondary: theta, xVal: r, yVal: theta, kind: 'Pol' };
  }
  const recMatch = trimmed.match(/^Rec\(\s*([^,]+)\s*,\s*([^)]+)\s*\)$/i);
  if (recMatch) {
    const r = WB.evaluatePhysicsCalcNumeric(recMatch[1], angleMode, vars);
    const th = WB.evaluatePhysicsCalcNumeric(recMatch[2], angleMode, vars);
    if (!Number.isFinite(r) || !Number.isFinite(th)) return null;
    const rad = calcAngleToRad(th, angleMode);
    const x = r * Math.cos(rad);
    const y = r * Math.sin(rad);
    return { primary: x, secondary: y, xVal: x, yVal: y, kind: 'Rec' };
  }
  return null;
};

WB.evaluatePhysicsCalcNumeric = function(rawExpr, angleMode = 'DEG', vars = {}) {
  let trimmed = String(rawExpr || '').trim();
  if (!trimmed) return 0;

  const openCount = (trimmed.match(/\(/g) || []).length;
  const closeCount = (trimmed.match(/\)/g) || []).length;
  if (openCount > closeCount) {
    trimmed += ')'.repeat(openCount - closeCount);
  }

  const pr = WB.evaluatePolRec(trimmed, angleMode, vars);
  if (pr) return pr.primary;

  const s = preprocessComixExpr(trimmed, angleMode)
    .replace(/\s+/g, '')
    .replace(/;/g, ',')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/ˣ√/g, '§')
    .replace(/√\(/g, 'sqrt(')
    .replace(/√/g, 'sqrt')
    .replace(/∛\(/g, 'cbrt(')
    .replace(/∛/g, 'cbrt');

  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      let numStr = '';
      let hasDot = false;
      while (i < s.length && ((s[i] >= '0' && s[i] <= '9') || (s[i] === '.' && !hasDot))) {
        if (s[i] === '.') hasDot = true;
        numStr += s[i++];
      }
      if (i < s.length && s[i] === 'E') {
        let expPart = 'E';
        let j = i + 1;
        if (j < s.length && (s[j] === '+' || s[j] === '-')) expPart += s[j++];
        let expDigits = '';
        while (j < s.length && s[j] >= '0' && s[j] <= '9') expDigits += s[j++];
        if (expDigits.length > 0) {
          numStr += expPart + expDigits;
          i = j;
        }
      }
      const val = Number(numStr);
      if (Number.isNaN(val)) throw new Error('Invalid');
      tokens.push({ type: 'num', value: val });
      continue;
    }
    if (ch === 'π') {
      tokens.push({ type: 'num', value: Math.PI });
      i++;
      continue;
    }
    if (ch === '(') { tokens.push({ type: 'lparen' }); i++; continue; }
    if (ch === ')') { tokens.push({ type: 'rparen' }); i++; continue; }
    if (ch === ',') { tokens.push({ type: 'comma' }); i++; continue; }
    if ('+-*/^%!§'.includes(ch)) { tokens.push({ type: 'op', value: ch }); i++; continue; }

    if (ch === 'C' || ch === 'P') {
      const prev = tokens[tokens.length - 1];
      const nextCh = s[i + 1] || '';
      const isBinaryComb = prev && (prev.type === 'num' || prev.type === 'rparen') && ((nextCh >= '0' && nextCh <= '9') || nextCh === '(');
      if (isBinaryComb) {
        tokens.push({ type: 'op', value: ch === 'C' ? 'nCr' : 'nPr' });
        i++;
        continue;
      }
      if (ch === 'C' && vars && vars.C !== undefined) {
        tokens.push({ type: 'num', value: Number(vars.C) || 0 });
        i++;
        continue;
      }
    }

    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) {
      let id = '';
      while (i < s.length && ((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= '0' && s[i] <= '9'))) {
        id += s[i++];
      }
      const lower = id.toLowerCase();
      if (lower === 'pi') tokens.push({ type: 'num', value: Math.PI });
      else if (id === 'e') tokens.push({ type: 'num', value: Math.E });
      else if (lower === 'ans') tokens.push({ type: 'num', value: Number(vars?.Ans ?? 0) });
      else if (/^[ABDEFXYM]$/.test(id)) tokens.push({ type: 'num', value: Number(vars?.[id] ?? 0) });
      else if (lower === 'ncr' || id === 'C') {
        if (s[i] === '(') tokens.push({ type: 'fn', value: 'ncr' });
        else tokens.push({ type: 'op', value: 'nCr' });
      } else if (lower === 'npr' || id === 'P') {
        if (s[i] === '(') tokens.push({ type: 'fn', value: 'npr' });
        else tokens.push({ type: 'op', value: 'nPr' });
      } else if ([
        'sin', 'cos', 'tg', 'tan', 'arcsin', 'asin', 'arccos', 'acos', 'arctg', 'atan',
        'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
        'lg', 'log', 'log10', 'ln', 'sqrt', 'cbrt', 'exp', 'abs', 'pol', 'rec'
      ].includes(lower)) {
        tokens.push({ type: 'fn', value: lower });
      } else {
        throw new Error('Unknown');
      }
      continue;
    }
    throw new Error('Unexpected');
  }

  if (tokens.length === 0) return 0;
  let pos = 0;
  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];
  const needsImplicitMul = (next) => next && (next.type === 'num' || next.type === 'fn' || next.type === 'lparen');
  const toRad = (v) => calcAngleToRad(v, angleMode);
  const fromRad = (v) => calcRadToAngle(v, angleMode);

  const parseExpr = () => {
    let left = parseTerm();
    while (peek()?.type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = consume().value;
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  };

  const parseTerm = () => {
    let left = parseCombinatorics();
    while (true) {
      const next = peek();
      if (next?.type === 'op' && (next.value === '*' || next.value === '/')) {
        consume();
        const right = parseCombinatorics();
        if (next.value === '/') {
          if (right === 0) throw new Error('Div0');
          left = left / right;
        } else {
          left = left * right;
        }
      } else if (needsImplicitMul(next)) {
        left = left * parseCombinatorics();
      } else {
        break;
      }
    }
    return left;
  };

  const parseCombinatorics = () => {
    let left = parseUnary();
    while (peek()?.type === 'op' && (peek().value === 'nCr' || peek().value === 'nPr')) {
      const op = consume().value;
      const right = parseUnary();
      left = op === 'nCr' ? calcNCr(left, right) : calcNPr(left, right);
    }
    return left;
  };

  const parseUnary = () => {
    const next = peek();
    if (next?.type === 'op' && (next.value === '+' || next.value === '-')) {
      consume();
      const v = parseUnary();
      return next.value === '-' ? -v : v;
    }
    return parsePower();
  };

  const parsePower = () => {
    const base = parsePostfix();
    if (peek()?.type === 'op' && (peek().value === '^' || peek().value === '§')) {
      const op = consume().value;
      const exp = parseUnary();
      if (op === '§') {
        if (base === 0) throw new Error('Domain');
        if (exp < 0 && Math.abs(base % 2) === 1) return -Math.pow(-exp, 1 / base);
        if (exp < 0) throw new Error('Domain');
        return Math.pow(exp, 1 / base);
      }
      return Math.pow(base, exp);
    }
    return base;
  };

  const parsePostfix = () => {
    let val = parsePrimary();
    while (peek()?.type === 'op' && (peek().value === '!' || peek().value === '%')) {
      const op = consume().value;
      val = op === '!' ? calcFactorial(val) : val / 100;
    }
    return val;
  };

  const parsePrimary = () => {
    const tok = peek();
    if (!tok) throw new Error('EOF');
    if (tok.type === 'num') { consume(); return tok.value; }
    if (tok.type === 'lparen') {
      consume();
      const val = parseExpr();
      if (peek()?.type !== 'rparen') throw new Error('Paren');
      consume();
      return val;
    }
    if (tok.type === 'fn') {
      consume();
      let arg1;
      let arg2 = null;
      if (peek()?.type === 'lparen') {
        consume();
        arg1 = parseExpr();
        if (peek()?.type === 'comma') {
          consume();
          arg2 = parseExpr();
        }
        if (peek()?.type !== 'rparen') throw new Error('Paren');
        consume();
      } else {
        arg1 = parseUnary();
      }
      switch (tok.value) {
        case 'sin':
          if (angleMode === 'DEG' && Math.abs(arg1 % 180) < 1e-12) return 0;
          if (angleMode === 'GRAD' && Math.abs(arg1 % 200) < 1e-12) return 0;
          return Math.sin(toRad(arg1));
        case 'cos':
          if (angleMode === 'DEG' && Math.abs((Math.abs(arg1) % 180) - 90) < 1e-12) return 0;
          if (angleMode === 'GRAD' && Math.abs((Math.abs(arg1) % 200) - 100) < 1e-12) return 0;
          return Math.cos(toRad(arg1));
        case 'tg':
        case 'tan':
          if (angleMode === 'DEG' && Math.abs((Math.abs(arg1) % 180) - 90) < 1e-12) throw new Error('Tan90');
          if (angleMode === 'GRAD' && Math.abs((Math.abs(arg1) % 200) - 100) < 1e-12) throw new Error('Tan100g');
          return Math.tan(toRad(arg1));
        case 'arcsin':
        case 'asin':
          if (arg1 < -1 || arg1 > 1) throw new Error('Domain');
          return fromRad(Math.asin(arg1));
        case 'arccos':
        case 'acos':
          if (arg1 < -1 || arg1 > 1) throw new Error('Domain');
          return fromRad(Math.acos(arg1));
        case 'arctg':
        case 'atan':
          return fromRad(Math.atan(arg1));
        case 'sinh': return Math.sinh(arg1);
        case 'cosh': return Math.cosh(arg1);
        case 'tanh': return Math.tanh(arg1);
        case 'asinh': return Math.asinh(arg1);
        case 'acosh': if (arg1 < 1) throw new Error('Domain'); return Math.acosh(arg1);
        case 'atanh': if (arg1 <= -1 || arg1 >= 1) throw new Error('Domain'); return Math.atanh(arg1);
        case 'lg':
        case 'log':
        case 'log10': if (arg1 <= 0) throw new Error('Domain'); return Math.log10(arg1);
        case 'ln': if (arg1 <= 0) throw new Error('Domain'); return Math.log(arg1);
        case 'sqrt': if (arg1 < 0) throw new Error('Domain'); return Math.sqrt(arg1);
        case 'cbrt': return Math.cbrt(arg1);
        case 'exp': return Math.exp(arg1);
        case 'abs': return Math.abs(arg1);
        case 'ncr': return calcNCr(arg1, arg2 ?? 0);
        case 'npr': return calcNPr(arg1, arg2 ?? 0);
        case 'pol': return Math.hypot(arg1, arg2 ?? 0);
        case 'rec': return arg1 * Math.cos(toRad(arg2 ?? 0));
        default: throw new Error('Fn');
      }
    }
    throw new Error('Token');
  };

  const result = parseExpr();
  if (pos !== tokens.length) throw new Error('Trailing');
  return result;
};

WB.buildComixCalculatorHTML = function(w) {
  const mode = w.calcMode || 'DEG';
  const modeLetter = mode === 'RAD' ? 'R' : (mode === 'GRAD' ? 'G' : 'D');
  const vars = w.calcVars || {};
  const mVal = Number(vars.M ?? w.calcMem ?? 0);
  const hasMem = mVal !== 0 && Number.isFinite(mVal);
  const isShift = !!w.calcShift;
  const isAlpha = !!w.calcAlpha;
  const isHyp = !!w.calcHyp;
  const isSto = !!w.calcSto;
  const isRcl = !!w.calcRcl;
  const isSd = (w.calcAppMode || 'COMP') === 'SD';
  const dispFmt = w.calcDispFmt || 'NORM';
  const isOff = !!w.calcOff;

  return `
    <div class="lb-widget-body calc-body cs85-shell ${isShift ? 'shift-on' : ''} ${isAlpha ? 'alpha-on' : ''} ${isOff ? 'calc-off' : ''}" tabindex="0" aria-label="Инженерный калькулятор Comix CS-85">
      <div class="cs85-inner-face">
        <!-- Верхняя глянцевая панель корпуса Comix CS-85 -->
        <div class="cs85-top-hood">
          <div class="cs85-brand-top">
            <span class="cs85-brand-logo" aria-label="Comix">
              <svg width="70" height="16" viewBox="0 0 112 24" fill="none" aria-hidden="true">
                <path d="M5 19.5V8.2C5 5.4 7.1 3.5 10.2 3.5H23.5L21 8H11.6C10.5 8 9.8 8.6 9.8 9.7V16.8C9.8 17.8 10.5 18.4 11.6 18.4H23.2V22.5H9.8C6.9 22.5 5 21.1 5 19.5Z" fill="#f8fafc"/>
                <text x="25" y="21.5" fill="#f8fafc" font-family="'Plus Jakarta Sans',system-ui,sans-serif" font-weight="800" font-size="21" letter-spacing="0.4">omix</text>
              </svg>
            </span>
            <span class="cs85-brand-model">CS-85</span>
          </div>
          <div class="cs85-brand-sub">240 FUNCTION CALCULATOR</div>

          <!-- Двухстрочный ЖКИ-дисплей Comix CS-85 -->
          <div class="cs85-lcd-bezel">
            <div class="cs85-lcd">
              <div class="cs85-lcd-indicators">
                <span class="cs85-ind cs85-ind-shift ${isShift ? 'on' : ''}">S</span>
                <span class="cs85-ind cs85-ind-alpha ${isAlpha ? 'on' : ''}">A</span>
                <span class="cs85-ind cs85-ind-mem ${hasMem ? 'on' : ''}" title="Память M">M</span>
                <span class="cs85-ind cs85-ind-sto ${isSto ? 'on' : ''}">STO</span>
                <span class="cs85-ind cs85-ind-rcl ${isRcl ? 'on' : ''}">RCL</span>
                <span class="cs85-ind cs85-ind-sd ${isSd ? 'on' : ''}">SD</span>
                <span class="cs85-ind cs85-ind-hyp ${isHyp ? 'on' : ''}">HYP</span>
                <span class="cs85-ind cs85-ind-fmt ${dispFmt !== 'NORM' ? 'on' : ''}">${dispFmt !== 'NORM' ? dispFmt : ''}</span>
                <span class="cs85-ind-angle" title="Единица угла (${mode})">${modeLetter}</span>
                <span class="cs85-ind cs85-ind-replay" title="История REPLAY">▲</span>
              </div>
              <div class="calc-expr-line cs85-lcd-top" aria-live="polite"></div>
              <div class="calc-screen cs85-lcd-bottom" aria-label="Экран результата">0.</div>
            </div>
          </div>
        </div>

        <!-- Панель управления с круглым 4-позиционным диском REPLAY -->
        <div class="cs85-control-area">
          <div class="cs85-side-col left">
            <div class="cs85-top-ctrl-row">
              <div class="cs85-ctrl-cell">
                <span class="cs85-ctrl-lbl gold">2ndF</span>
                <button type="button" class="cs85-kidney-btn shift-key ${isShift ? 'active' : ''}" data-action="SHIFT" aria-label="2ndF" title="Вторая функция (2ndF)"></button>
              </div>
              <div class="cs85-ctrl-cell">
                <span class="cs85-ctrl-lbl pink">ALPHA</span>
                <button type="button" class="cs85-kidney-btn alpha-key ${isAlpha ? 'active' : ''}" data-action="ALPHA" aria-label="ALPHA" title="Переменные A–F, X, Y, M и константа e (ALPHA)"></button>
              </div>
            </div>
            <div class="cs85-top-fn-row">
              <div class="cs85-key-cell">
                <span class="cs85-sub-row"><span class="cs85-sub gold" data-shift-k="!"><i>x</i>!</span></span>
                <button type="button" data-k="inv" data-shift-k="!" class="calc-key cs85-sci-btn" title="Обратное число x⁻¹ (2ndF: факториал x!)"><i>x</i><sup>−1</sup></button>
              </div>
              <div class="cs85-key-cell">
                <span class="cs85-sub-row"><span class="cs85-sub gold" data-shift-k="P">A<span class="cs85-mn"><sup>m</sup><sub>n</sub></span></span></span>
                <button type="button" data-k="C_comb" data-shift-k="P" class="calc-key cs85-sci-btn" title="Сочетания nCr (2ndF: размещения nPr)">C<span class="cs85-mn"><sup>m</sup><sub>n</sub></span></button>
              </div>
            </div>
          </div>

          <!-- Круглый серебристый 4-позиционный диск REPLAY -->
          <div class="cs85-replay-pad" role="group" aria-label="REPLAY навигация">
            <button type="button" class="cs85-replay-dir up" data-action="REPLAY_UP" aria-label="Предыдущее вычисление" title="История назад (▲)">▲</button>
            <button type="button" class="cs85-replay-dir left" data-action="REPLAY_LEFT" aria-label="Курсор влево" title="Курсор влево (◀)">◀</button>
            <span class="cs85-replay-center">REPLAY</span>
            <button type="button" class="cs85-replay-dir right" data-action="REPLAY_RIGHT" aria-label="Курсор вправо" title="Курсор вправо (▶)">▶</button>
            <button type="button" class="cs85-replay-dir down" data-action="REPLAY_DOWN" aria-label="Следующее вычисление" title="История вперёд (▼)">▼</button>
          </div>

          <div class="cs85-side-col right">
            <div class="cs85-top-ctrl-row">
              <div class="cs85-ctrl-cell">
                <span class="cs85-ctrl-lbl"><b class="pink">MODE</b> <b class="gold">CLR</b></span>
                <button type="button" class="cs85-kidney-btn mode-key" data-action="MODE" aria-label="MODE CLR" title="Режимы COMP/SD, DEG/RAD/GRAD, FIX/SCI/NORM (2ndF: CLR)"></button>
              </div>
              <div class="cs85-ctrl-cell">
                <span class="cs85-ctrl-lbl pink">ON</span>
                <button type="button" class="cs85-kidney-btn on-key" data-action="ON" aria-label="ON" title="Включить / очистить экран (ON)"></button>
              </div>
            </div>
            <div class="cs85-top-fn-row">
              <div class="cs85-key-cell">
                <span class="cs85-sub-row dual"><span class="cs85-sub gold" data-shift-k="Pol(">→rθ</span><span class="cs85-sub pink" data-alpha-k=":">:</span></span>
                <button type="button" data-k="Rec(" data-shift-k="Pol(" data-alpha-k=":" class="calc-key cs85-sci-btn" title="Прямоугольные Rec(r,θ) → X,Y (2ndF: полярные Pol(x,y) → X,Y)">→xy</button>
              </div>
              <div class="cs85-key-cell">
                <span class="cs85-sub-row"><span class="cs85-sub gold" data-shift-k="cbrt("><sup>3</sup>√</span></span>
                <button type="button" data-k="cube" data-shift-k="cbrt(" class="calc-key cs85-sci-btn" title="Куб x³ (2ndF: кубический корень ∛)"><i>x</i><sup>3</sup></button>
              </div>
            </div>
          </div>
        </div>

        <!-- Научная клавиатура 6×3 (Comix CS-85) -->
        <div class="cs85-sci-grid">
          <!-- Ряд 2 -->
          <div class="cs85-key-cell">
            <span class="cs85-sub-row"><span class="cs85-sub gold" data-shift-k="FRAC_DC">d/c</span></span>
            <button type="button" data-k="FRAC_ABC" data-shift-k="FRAC_DC" class="calc-key cs85-sci-btn" title="Дробь a b/c и перевод десятичной в дробь (2ndF: неправильная d/c)">a<sup>b</sup>/<sub>c</sub></button>
          </div>
          <div class="cs85-key-cell">
            <span class="cs85-sub-row">&nbsp;</span>
            <button type="button" data-k="sqrt(" class="calc-key cs85-sci-btn" title="Квадратный корень √">√</button>
          </div>
          <div class="cs85-key-cell">
            <span class="cs85-sub-row">&nbsp;</span>
            <button type="button" data-k="sq" class="calc-key cs85-sci-btn" title="Квадрат x²"><i>x</i><sup>2</sup></button>
          </div>
          <div class="cs85-key-cell">
            <span class="cs85-sub-row"><span class="cs85-sub gold" data-shift-k="ˣ√"><sup>x</sup>√</span></span>
            <button type="button" data-k="^" data-shift-k="ˣ√" class="calc-key cs85-sci-btn" title="Степень yˣ (2ndF: корень степени x)"><i>y</i><sup>x</sup></button>
          </div>
          <div class="cs85-key-cell">
            <span class="cs85-sub-row"><span class="cs85-sub gold" data-shift-k="10^(">10<sup>x</sup></span></span>
            <button type="button" data-k="lg(" data-shift-k="10^(" class="calc-key cs85-sci-btn" title="Десятичный логарифм lg (2ndF: 10ˣ)">lg</button>
          </div>
          <div class="cs85-key-cell">
            <span class="cs85-sub-row dual"><span class="cs85-sub gold" data-shift-k="exp(">e<sup>x</sup></span><span class="cs85-sub pink" data-alpha-k="e"><i>e</i></span></span>
            <button type="button" data-k="ln(" data-shift-k="exp(" data-alpha-k="e" class="calc-key cs85-sci-btn" title="Натуральный логарифм ln (2ndF: eˣ, ALPHA: e)">ln</button>
          </div>

          <!-- Ряд 3 -->
          <div class="cs85-key-cell">
            <span class="cs85-sub-row right-only"><span class="cs85-sub pink" data-alpha-k="A">A</span></span>
            <button type="button" data-k="SIGN" data-var="A" data-alpha-k="A" class="calc-key cs85-sci-btn" title="Знак минус (−) (ALPHA/STO/RCL: A)">(−)</button>
          </div>
          <div class="cs85-key-cell">
            <span class="cs85-sub-row dual"><span class="cs85-sub gold" data-shift-k="DMS">←</span><span class="cs85-sub pink" data-alpha-k="B">B</span></span>
            <button type="button" data-k="DMS" data-shift-k="DMS" data-var="B" data-alpha-k="B" class="calc-key cs85-sci-btn" title="Градусы-минуты-секунды DMS (ALPHA/STO/RCL: B)">DMS</button>
          </div>
          <div class="cs85-key-cell">
            <span class="cs85-sub-row right-only"><span class="cs85-sub pink" data-alpha-k="C">C</span></span>
            <button type="button" data-action="HYP" data-var="C" data-alpha-k="C" class="calc-key cs85-sci-btn ${isHyp ? 'hyp-active' : ''}" title="Гиперболические функции hyp (ALPHA/STO/RCL: C)">hyp</button>
          </div>
          <div class="cs85-key-cell">
            <span class="cs85-sub-row dual"><span class="cs85-sub gold" data-shift-k="arcsin(">sin<sup>−1</sup></span><span class="cs85-sub pink" data-alpha-k="D">D</span></span>
            <button type="button" data-k="sin(" data-shift-k="arcsin(" data-var="D" data-alpha-k="D" class="calc-key cs85-sci-btn" title="sin (2ndF: sin⁻¹, ALPHA/STO/RCL: D)">sin</button>
          </div>
          <div class="cs85-key-cell">
            <span class="cs85-sub-row dual"><span class="cs85-sub gold" data-shift-k="arccos(">cos<sup>−1</sup></span><span class="cs85-sub pink" data-alpha-k="E">E</span></span>
            <button type="button" data-k="cos(" data-shift-k="arccos(" data-var="E" data-alpha-k="E" class="calc-key cs85-sci-btn" title="cos (2ndF: cos⁻¹, ALPHA/STO/RCL: E)">cos</button>
          </div>
          <div class="cs85-key-cell">
            <span class="cs85-sub-row dual"><span class="cs85-sub gold" data-shift-k="arctg(">tan<sup>−1</sup></span><span class="cs85-sub pink" data-alpha-k="F">F</span></span>
            <button type="button" data-k="tan(" data-shift-k="arctg(" data-var="F" data-alpha-k="F" class="calc-key cs85-sci-btn" title="tan (2ndF: tan⁻¹, ALPHA/STO/RCL: F)">tan</button>
          </div>

          <!-- Ряд 4 -->
          <div class="cs85-key-cell">
            <span class="cs85-sub-row"><span class="cs85-sub gold" data-shift-k="STO_MODE">STO</span></span>
            <button type="button" data-k="RCL_MODE" data-shift-k="STO_MODE" class="calc-key cs85-sci-btn" title="Вызвать переменную RCL (2ndF: сохранить STO)">RCL</button>
          </div>
          <div class="cs85-key-cell">
            <span class="cs85-sub-row"><span class="cs85-sub gold" data-shift-k="ENG_LEFT">←</span></span>
            <button type="button" data-k="ENG_RIGHT" data-shift-k="ENG_LEFT" class="calc-key cs85-sci-btn" title="Инженерный формат ENG ×10³ (2ndF: ← сдвиг влево)">ENG</button>
          </div>
          <div class="cs85-key-cell">
            <span class="cs85-sub-row">&nbsp;</span>
            <button type="button" data-k="(" class="calc-key cs85-sci-btn">(</button>
          </div>
          <div class="cs85-key-cell">
            <span class="cs85-sub-row right-only"><span class="cs85-sub pink" data-alpha-k="X">X</span></span>
            <button type="button" data-k=")" data-var="X" data-alpha-k="X" class="calc-key cs85-sci-btn" title="Закрывающая скобка ) (ALPHA/STO/RCL: X)">)</button>
          </div>
          <div class="cs85-key-cell">
            <span class="cs85-sub-row dual"><span class="cs85-sub gold" data-shift-k=";">;</span><span class="cs85-sub pink" data-alpha-k="Y">Y</span></span>
            <button type="button" data-k="," data-shift-k=";" data-var="Y" data-alpha-k="Y" class="calc-key cs85-sci-btn" title="Разделитель аргументов (ALPHA/STO/RCL: Y)">,</button>
          </div>
          <div class="cs85-key-cell">
            <span class="cs85-sub-row dual"><span class="cs85-sub gold" data-shift-k="M-">M−</span><span class="cs85-sub pink" data-alpha-k="M">M</span></span>
            <button type="button" data-k="M+" data-shift-k="M-" data-var="M" data-alpha-k="M" class="calc-key cs85-sci-btn" title="Прибавить в M+ / добавить данные DT в SD (2ndF: M− / CL)">M+</button>
          </div>
        </div>

        <!-- Основная цифровая клавиатура 5×4 (Comix CS-85) -->
        <div class="cs85-num-grid">
          <div class="cs85-num-cell">
            <span class="cs85-sub-row">&nbsp;</span>
            <button type="button" data-k="7" class="calc-key cs85-num-btn">7</button>
          </div>
          <div class="cs85-num-cell">
            <span class="cs85-sub-row">&nbsp;</span>
            <button type="button" data-k="8" class="calc-key cs85-num-btn">8</button>
          </div>
          <div class="cs85-num-cell">
            <span class="cs85-sub-row">&nbsp;</span>
            <button type="button" data-k="9" class="calc-key cs85-num-btn">9</button>
          </div>
          <div class="cs85-num-cell">
            <span class="cs85-sub-row"><span class="cs85-sub gold" data-shift-k="INS">INS</span></span>
            <button type="button" data-k="BACK" data-shift-k="INS" class="calc-key cs85-orange-btn" title="Удалить символ DEL (2ndF: режим вставки INS)">DEL</button>
          </div>
          <div class="cs85-num-cell">
            <span class="cs85-sub-row"><span class="cs85-sub gold" data-shift-k="OFF">OFF</span></span>
            <button type="button" data-k="AC" data-shift-k="OFF" class="calc-key cs85-orange-btn" title="Сброс AC (2ndF: выключить OFF)">AC</button>
          </div>

          <div class="cs85-num-cell">
            <span class="cs85-sub-row">&nbsp;</span>
            <button type="button" data-k="4" class="calc-key cs85-num-btn">4</button>
          </div>
          <div class="cs85-num-cell">
            <span class="cs85-sub-row">&nbsp;</span>
            <button type="button" data-k="5" class="calc-key cs85-num-btn">5</button>
          </div>
          <div class="cs85-num-cell">
            <span class="cs85-sub-row">&nbsp;</span>
            <button type="button" data-k="6" class="calc-key cs85-num-btn">6</button>
          </div>
          <div class="cs85-num-cell">
            <span class="cs85-sub-row">&nbsp;</span>
            <button type="button" data-k="×" class="calc-key cs85-num-btn op">×</button>
          </div>
          <div class="cs85-num-cell">
            <span class="cs85-sub-row">&nbsp;</span>
            <button type="button" data-k="÷" class="calc-key cs85-num-btn op">÷</button>
          </div>

          <div class="cs85-num-cell">
            <span class="cs85-sub-row"><span class="cs85-sub gold sd-tag" data-shift-k="S-SUM">S-SUM</span></span>
            <button type="button" data-k="1" data-shift-k="S-SUM" class="calc-key cs85-num-btn">1</button>
          </div>
          <div class="cs85-num-cell">
            <span class="cs85-sub-row"><span class="cs85-sub gold sd-tag" data-shift-k="S-VAR">S-VAR</span></span>
            <button type="button" data-k="2" data-shift-k="S-VAR" class="calc-key cs85-num-btn">2</button>
          </div>
          <div class="cs85-num-cell">
            <span class="cs85-sub-row">&nbsp;</span>
            <button type="button" data-k="3" class="calc-key cs85-num-btn">3</button>
          </div>
          <div class="cs85-num-cell">
            <span class="cs85-sub-row">&nbsp;</span>
            <button type="button" data-k="+" class="calc-key cs85-num-btn op">+</button>
          </div>
          <div class="cs85-num-cell">
            <span class="cs85-sub-row">&nbsp;</span>
            <button type="button" data-k="−" class="calc-key cs85-num-btn op">−</button>
          </div>

          <div class="cs85-num-cell">
            <span class="cs85-sub-row"><span class="cs85-sub gold" data-shift-k="RND">Rnd</span></span>
            <button type="button" data-k="0" data-shift-k="RND" class="calc-key cs85-num-btn">0</button>
          </div>
          <div class="cs85-num-cell">
            <span class="cs85-sub-row"><span class="cs85-sub gold" data-shift-k="RAN">Ran#</span></span>
            <button type="button" data-k="." data-shift-k="RAN" class="calc-key cs85-num-btn">·</button>
          </div>
          <div class="cs85-num-cell">
            <span class="cs85-sub-row"><span class="cs85-sub gold" data-shift-k="π">π</span></span>
            <button type="button" data-k="E" data-shift-k="π" class="calc-key cs85-num-btn exp-btn" title="×10ⁿ (2ndF: π)">EXP</button>
          </div>
          <div class="cs85-num-cell">
            <span class="cs85-sub-row"><span class="cs85-sub gold" data-shift-k="DRG_MENU">DRG▸</span></span>
            <button type="button" data-k="ANS" data-shift-k="DRG_MENU" class="calc-key cs85-num-btn ans-btn" title="Последний ответ Ans (2ndF: единицы угла DRG▸)">Ans</button>
          </div>
          <div class="cs85-num-cell">
            <span class="cs85-sub-row"><span class="cs85-sub gold" data-shift-k="%">%</span></span>
            <button type="button" data-k="=" data-shift-k="%" class="calc-key cs85-num-btn eq-btn" title="Вычислить = (2ndF: %)">=</button>
          </div>
        </div>
      </div>
    </div>
  `;
};

WB.bindComixCalculator = function(rootEl, w, opts = {}) {
  const body = rootEl.querySelector('.cs85-shell');
  if (!body) return;
  body.addEventListener('pointerdown', e => e.stopPropagation());

  if (!w.calcVars || typeof w.calcVars !== 'object') {
    w.calcVars = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, X: 0, Y: 0, M: Number(w.calcMem) || 0 };
  }
  if (!Array.isArray(w.calcSdData)) w.calcSdData = [];
  if (!Array.isArray(w.calcHistoryLog)) w.calcHistoryLog = [];
  if (w.calcCursorPos === undefined) w.calcCursorPos = (w.calcExpr || '').length;

  const lcdTop = body.querySelector('.cs85-lcd-top');
  const lcdBottom = body.querySelector('.cs85-lcd-bottom');
  const shiftBtn = body.querySelector('[data-action="SHIFT"]');
  const alphaBtn = body.querySelector('[data-action="ALPHA"]');
  const hypBtn = body.querySelector('[data-action="HYP"]');
  const shiftInd = body.querySelector('.cs85-ind-shift');
  const alphaInd = body.querySelector('.cs85-ind-alpha');
  const hypInd = body.querySelector('.cs85-ind-hyp');
  const memInd = body.querySelector('.cs85-ind-mem');
  const stoInd = body.querySelector('.cs85-ind-sto');
  const rclInd = body.querySelector('.cs85-ind-rcl');
  const sdInd = body.querySelector('.cs85-ind-sd');
  const fmtInd = body.querySelector('.cs85-ind-fmt');
  const angleInd = body.querySelector('.cs85-ind-angle');
  const replayInd = body.querySelector('.cs85-ind-replay');

  const onSave = typeof opts.onSave === 'function' ? opts.onSave : () => {};

  const getVarsWithAns = () => Object.assign({}, w.calcVars, {
    M: Number(w.calcVars.M ?? w.calcMem ?? 0),
    Ans: Number(w.calcLastNumeric ?? Number(w.calcLastAns) ?? 0)
  });

  const formatNum = (n) => formatCalcResult(n, w.calcDispFmt || 'NORM', w.calcDispDigits ?? 2);

  const renderExprWithCursor = (expr, pos, insMode) => {
    const safePos = Math.max(0, Math.min(expr.length, pos));
    const before = escapeHtmlCell(expr.slice(0, safePos));
    const after = escapeHtmlCell(expr.slice(safePos));
    return `${before}<span class="cs85-cursor ${insMode ? 'ins' : ''}"></span>${after}`;
  };

  const getMenuText = (menu) => {
    switch (menu) {
      case 'MODE_1': return { top: 'COMP   SD', bottom: ' 1     2' };
      case 'MODE_2': return { top: 'Deg  Rad  Gra', bottom: ' 1    2    3' };
      case 'MODE_3': return { top: 'Fix  Sci  Norm', bottom: ' 1    2    3' };
      case 'FIX_DIGITS': return { top: 'Fix 0~9?', bottom: '0 .. 9' };
      case 'SCI_DIGITS': return { top: 'Sci 0~9?', bottom: '0 .. 9' };
      case 'CLR': return { top: 'Mcl  Mode  All', bottom: ' 1    2    3' };
      case 'DRG': return { top: 'D    R    G', bottom: '1    2    3' };
      case 'S-SUM': return { top: 'Σx²   Σx    n', bottom: ' 1    2    3' };
      case 'S-VAR': return { top: 'x̄    xσn  xσn-1', bottom: ' 1    2     3' };
      default: return null;
    }
  };

  const syncUI = () => {
    const isOff = !!w.calcOff;
    body.classList.toggle('calc-off', isOff);
    body.classList.toggle('shift-on', !!w.calcShift);
    body.classList.toggle('alpha-on', !!w.calcAlpha);

    const mode = w.calcMode || 'DEG';
    const modeLetter = mode === 'RAD' ? 'R' : (mode === 'GRAD' ? 'G' : 'D');
    const mVal = Number(w.calcVars.M || 0);
    const hasHistory = w.calcHistoryLog.length > 0;

    if (angleInd) {
      angleInd.textContent = modeLetter;
      angleInd.title = `Единица угла (${mode})`;
    }
    if (shiftBtn) shiftBtn.classList.toggle('active', !!w.calcShift);
    if (alphaBtn) alphaBtn.classList.toggle('active', !!w.calcAlpha);
    if (hypBtn) hypBtn.classList.toggle('hyp-active', !!w.calcHyp);
    if (shiftInd) shiftInd.classList.toggle('on', !!w.calcShift);
    if (alphaInd) alphaInd.classList.toggle('on', !!w.calcAlpha);
    if (hypInd) hypInd.classList.toggle('on', !!w.calcHyp);
    if (stoInd) stoInd.classList.toggle('on', !!w.calcSto);
    if (rclInd) rclInd.classList.toggle('on', !!w.calcRcl);
    if (sdInd) sdInd.classList.toggle('on', (w.calcAppMode || 'COMP') === 'SD');
    if (memInd) {
      memInd.classList.toggle('on', mVal !== 0);
      memInd.title = mVal !== 0 ? `M = ${formatNum(mVal)}` : 'Память M';
    }
    if (fmtInd) {
      const df = w.calcDispFmt || 'NORM';
      fmtInd.textContent = df !== 'NORM' ? df : '';
      fmtInd.classList.toggle('on', df !== 'NORM');
    }
    if (replayInd) {
      replayInd.classList.toggle('on', hasHistory);
      replayInd.textContent = w.calcReplayIdx >= 0 && w.calcReplayIdx < w.calcHistoryLog.length - 1 ? '▲▼' : '▲';
    }

    if (isOff) {
      if (lcdTop) lcdTop.textContent = '';
      if (lcdBottom) lcdBottom.textContent = '';
      return;
    }

    const menuView = w.calcMenu ? getMenuText(w.calcMenu) : null;
    if (menuView) {
      if (lcdTop) lcdTop.textContent = menuView.top;
      if (lcdBottom) lcdBottom.textContent = menuView.bottom;
      return;
    }

    if (w.calcJustEvaluated) {
      if (lcdTop) lcdTop.textContent = w.calcHistoryExpr || '';
      if (lcdBottom) lcdBottom.textContent = w.calcDisplayResult || '0.';
    } else {
      const expr = w.calcExpr || '';
      if (lcdTop) {
        if (expr) {
          lcdTop.innerHTML = renderExprWithCursor(expr, w.calcCursorPos, !!w.calcIns);
        } else {
          lcdTop.innerHTML = `<span class="cs85-cursor ${w.calcIns ? 'ins' : ''}"></span>`;
        }
      }
      if (lcdBottom) {
        lcdBottom.textContent = expr ? (w.calcDisplayResult || '0.') : '0.';
      }
    }
  };

  const insertAtCursor = (str) => {
    const expr = w.calcExpr || '';
    const pos = Math.max(0, Math.min(expr.length, w.calcCursorPos ?? expr.length));
    if (w.calcIns && pos < expr.length) {
      w.calcExpr = expr.slice(0, pos) + str + expr.slice(pos + 1);
    } else {
      w.calcExpr = expr.slice(0, pos) + str + expr.slice(pos);
    }
    w.calcCursorPos = pos + str.length;
  };

  const deleteAtCursor = () => {
    const expr = w.calcExpr || '';
    if (!expr) return;
    let pos = Math.max(0, Math.min(expr.length, w.calcCursorPos ?? expr.length));
    if (pos === 0) return;
    const before = expr.slice(0, pos);
    const fnMatch = before.match(/(asinh|acosh|atanh|arcsin|arccos|arctg|sinh|cosh|tanh|sqrt|cbrt|exp|Pol|Rec|10\^|sin|cos|tan|tg|lg|ln|Ans)\($|Ans$|ˣ√$/);
    if (fnMatch) {
      w.calcExpr = expr.slice(0, pos - fnMatch[0].length) + expr.slice(pos);
      w.calcCursorPos = pos - fnMatch[0].length;
    } else {
      w.calcExpr = expr.slice(0, pos - 1) + expr.slice(pos);
      w.calcCursorPos = pos - 1;
    }
  };

  const evaluateCurrentExpr = (overrideExpr) => {
    const raw = (overrideExpr !== undefined ? overrideExpr : (w.calcExpr || '0')).trim() || '0';
    const vars = getVarsWithAns();
    const angle = w.calcMode || 'DEG';
    const polRec = WB.evaluatePolRec(raw, angle, vars);
    if (polRec) {
      w.calcVars.X = polRec.xVal;
      w.calcVars.Y = polRec.yVal;
      const formattedX = formatNum(polRec.xVal);
      const formattedY = formatNum(polRec.yVal);
      w.calcHistoryExpr = `${raw}  [Y=${formattedY}]`;
      w.calcDisplayResult = formattedX;
      w.calcLastNumeric = polRec.xVal;
      w.calcLastAns = formattedX;
      w.calcEngOffset = 0;
      w.calcFracState = 0;
      w.calcHistoryLog.push({ expr: raw, res: formattedX, num: polRec.xVal });
      if (w.calcHistoryLog.length > 25) w.calcHistoryLog.shift();
      w.calcReplayIdx = -1;
      w.calcJustEvaluated = true;
      return;
    }

    try {
      const numVal = WB.evaluatePhysicsCalcNumeric(raw, angle, vars);
      if (!Number.isFinite(numVal)) throw new Error('NaN');
      const resStr = formatNum(numVal);
      w.calcHistoryExpr = raw;
      w.calcDisplayResult = resStr;
      w.calcLastNumeric = numVal;
      w.calcLastAns = resStr;
      w.calcEngOffset = 0;
      w.calcFracState = 0;
      w.calcHistoryLog.push({ expr: raw, res: resStr, num: numVal });
      if (w.calcHistoryLog.length > 25) w.calcHistoryLog.shift();
      w.calcReplayIdx = -1;
      w.calcJustEvaluated = true;
    } catch (_) {
      w.calcHistoryExpr = raw;
      w.calcDisplayResult = 'Math ERROR';
      w.calcJustEvaluated = true;
    }
  };

  const handleMenuChoice = (digit) => {
    const m = w.calcMenu;
    if (!m) return false;
    const d = String(digit);

    if (m === 'MODE_1') {
      if (d === '1') { w.calcAppMode = 'COMP'; w.calcMenu = null; w.calcHistoryExpr = 'COMP'; w.calcDisplayResult = '0.'; w.calcJustEvaluated = true; }
      else if (d === '2') { w.calcAppMode = 'SD'; w.calcMenu = null; w.calcHistoryExpr = `SD (n=${w.calcSdData.length})`; w.calcDisplayResult = '0.'; w.calcJustEvaluated = true; }
      else return false;
      return true;
    }
    if (m === 'MODE_2') {
      if (d === '1') { w.calcMode = 'DEG'; w.calcMenu = null; }
      else if (d === '2') { w.calcMode = 'RAD'; w.calcMenu = null; }
      else if (d === '3') { w.calcMode = 'GRAD'; w.calcMenu = null; }
      else return false;
      return true;
    }
    if (m === 'MODE_3') {
      if (d === '1') { w.calcMenu = 'FIX_DIGITS'; return true; }
      if (d === '2') { w.calcMenu = 'SCI_DIGITS'; return true; }
      if (d === '3') {
        w.calcDispFmt = 'NORM';
        w.calcMenu = null;
        if (w.calcJustEvaluated && Number.isFinite(w.calcLastNumeric)) {
          w.calcDisplayResult = formatNum(w.calcLastNumeric);
        }
        return true;
      }
      return false;
    }
    if (m === 'FIX_DIGITS' || m === 'SCI_DIGITS') {
      if (/^[0-9]$/.test(d)) {
        w.calcDispFmt = m === 'FIX_DIGITS' ? 'FIX' : 'SCI';
        w.calcDispDigits = Number(d);
        w.calcMenu = null;
        if (w.calcJustEvaluated && Number.isFinite(w.calcLastNumeric)) {
          w.calcDisplayResult = formatNum(w.calcLastNumeric);
        }
        return true;
      }
      return false;
    }
    if (m === 'CLR') {
      if (d === '1') {
        w.calcVars = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, X: 0, Y: 0, M: 0 };
        w.calcMem = 0;
        w.calcSdData = [];
        w.calcMenu = null;
        w.calcHistoryExpr = 'Mem clear';
        w.calcDisplayResult = '0.';
        w.calcJustEvaluated = true;
        return true;
      }
      if (d === '2') {
        w.calcMode = 'DEG';
        w.calcAppMode = 'COMP';
        w.calcDispFmt = 'NORM';
        w.calcMenu = null;
        w.calcHistoryExpr = 'Mode clear';
        w.calcDisplayResult = '0.';
        w.calcJustEvaluated = true;
        return true;
      }
      if (d === '3') {
        w.calcVars = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, X: 0, Y: 0, M: 0 };
        w.calcMem = 0;
        w.calcSdData = [];
        w.calcHistoryLog = [];
        w.calcExpr = '';
        w.calcLastAns = '0';
        w.calcLastNumeric = 0;
        w.calcMode = 'DEG';
        w.calcAppMode = 'COMP';
        w.calcDispFmt = 'NORM';
        w.calcMenu = null;
        w.calcHistoryExpr = 'Reset All';
        w.calcDisplayResult = '0.';
        w.calcJustEvaluated = true;
        return true;
      }
      return false;
    }
    if (m === 'DRG') {
      if (!['1', '2', '3'].includes(d)) return false;
      w.calcMenu = null;
      const suffix = d === '1' ? '°' : (d === '2' ? 'ʳ' : 'ᵍ');
      const modeName = d === '1' ? 'DEG' : (d === '2' ? 'RAD' : 'GRAD');
      if (!w.calcJustEvaluated && w.calcExpr) {
        insertAtCursor(suffix);
      } else {
        w.calcMode = modeName;
      }
      return true;
    }
    if (m === 'S-SUM' || m === 'S-VAR') {
      if (!['1', '2', '3'].includes(d)) return false;
      const stats = computeSdStatsLocal(w.calcSdData);
      w.calcMenu = null;
      let label = '';
      let val = NaN;
      if (m === 'S-SUM') {
        if (d === '1') { label = 'Σx²'; val = stats.sumX2; }
        else if (d === '2') { label = 'Σx'; val = stats.sumX; }
        else { label = 'n'; val = stats.n; }
      } else {
        if (d === '1') { label = 'x̄'; val = stats.mean; }
        else if (d === '2') { label = 'xσn'; val = stats.sigmaN; }
        else { label = 'xσn-1'; val = stats.sigmaN1; }
      }
      w.calcHistoryExpr = label;
      if (Number.isFinite(val)) {
        const resStr = formatNum(val);
        w.calcDisplayResult = resStr;
        w.calcLastNumeric = val;
        w.calcLastAns = resStr;
      } else {
        w.calcDisplayResult = 'Math ERROR';
      }
      w.calcJustEvaluated = true;
      return true;
    }
    return false;
  };

  const handleVarRegisterAction = (varName) => {
    if (!varName) return false;
    if (w.calcSto) {
      let val = w.calcLastNumeric ?? 0;
      if (!w.calcJustEvaluated && w.calcExpr) {
        try {
          val = WB.evaluatePhysicsCalcNumeric(w.calcExpr, w.calcMode || 'DEG', getVarsWithAns());
        } catch (_) {
          val = NaN;
        }
      }
      w.calcSto = false;
      w.calcShift = false;
      if (Number.isFinite(val)) {
        w.calcVars[varName] = val;
        if (varName === 'M') w.calcMem = val;
        const formatted = formatNum(val);
        w.calcHistoryExpr = `${w.calcExpr || 'Ans'}→${varName}`;
        w.calcDisplayResult = formatted;
        w.calcLastNumeric = val;
        w.calcLastAns = formatted;
        w.calcJustEvaluated = true;
      } else {
        w.calcDisplayResult = 'Math ERROR';
        w.calcJustEvaluated = true;
      }
      return true;
    }
    if (w.calcRcl) {
      const val = Number(w.calcVars[varName] || 0);
      const formatted = formatNum(val);
      w.calcRcl = false;
      w.calcShift = false;
      w.calcHistoryExpr = `${varName}=`;
      w.calcDisplayResult = formatted;
      w.calcLastNumeric = val;
      w.calcLastAns = formatted;
      w.calcExpr = formatted;
      w.calcCursorPos = formatted.length;
      w.calcJustEvaluated = true;
      return true;
    }
    return false;
  };

  const handleCalcKey = (rawKey, varName = null) => {
    if (!rawKey) return;

    if (w.calcOff && rawKey !== 'ON') return;

    // Если открыто меню MODE / CLR / DRG / S-SUM / S-VAR и нажата цифра
    if (w.calcMenu && /^[0-9]$/.test(rawKey)) {
      if (handleMenuChoice(rawKey)) {
        w.calcShift = false;
        w.calcAlpha = false;
        syncUI();
        onSave();
        return;
      }
    }

    // Если ожидается переменная для STO или RCL
    if ((w.calcSto || w.calcRcl) && varName) {
      if (handleVarRegisterAction(varName)) {
        syncUI();
        onSave();
        return;
      }
    }

    let k = rawKey;
    if (w.calcMenu && !['MODE', 'ON', 'AC'].includes(k)) {
      w.calcMenu = null;
    }

    // Гиперболические функции (hyp + sin/cos/tan или 2ndF sin/cos/tan)
    if (w.calcHyp) {
      if (k === 'sin(') k = 'sinh(';
      else if (k === 'cos(') k = 'cosh(';
      else if (k === 'tan(' || k === 'tg(') k = 'tanh(';
      else if (k === 'arcsin(') k = 'asinh(';
      else if (k === 'arccos(') k = 'acosh(';
      else if (k === 'arctg(') k = 'atanh(';
      w.calcHyp = false;
    }

    if (w.calcDisplayResult === 'Math ERROR' || w.calcDisplayResult === 'Ошибка') {
      if (!['AC', 'ON', 'OFF'].includes(k)) {
        w.calcExpr = '';
        w.calcCursorPos = 0;
        w.calcDisplayResult = '';
        w.calcHistoryExpr = '';
        w.calcJustEvaluated = false;
      }
    }

    if (k === 'ON') {
      w.calcOff = false;
      w.calcMenu = null;
      w.calcExpr = '';
      w.calcCursorPos = 0;
      w.calcHistoryExpr = '';
      w.calcDisplayResult = '0.';
      w.calcJustEvaluated = false;
      w.calcSto = false;
      w.calcRcl = false;
      w.calcHyp = false;
      w.calcReplayIdx = -1;
      w.calcEngOffset = 0;
      w.calcFracState = 0;
    } else if (k === 'OFF') {
      w.calcOff = true;
      w.calcMenu = null;
      w.calcShift = false;
      w.calcAlpha = false;
      w.calcSto = false;
      w.calcRcl = false;
    } else if (k === 'AC') {
      w.calcMenu = null;
      w.calcExpr = '';
      w.calcCursorPos = 0;
      w.calcHistoryExpr = '';
      w.calcDisplayResult = '0.';
      w.calcJustEvaluated = false;
      w.calcSto = false;
      w.calcRcl = false;
      w.calcHyp = false;
      w.calcReplayIdx = -1;
      w.calcEngOffset = 0;
      w.calcFracState = 0;
    } else if (k === 'INS') {
      w.calcIns = !w.calcIns;
    } else if (k === 'STO_MODE') {
      w.calcSto = !w.calcSto;
      if (w.calcSto) w.calcRcl = false;
    } else if (k === 'RCL_MODE') {
      w.calcRcl = !w.calcRcl;
      if (w.calcRcl) w.calcSto = false;
    } else if (k === 'DRG_MENU') {
      w.calcMenu = 'DRG';
    } else if (k === 'S-SUM') {
      w.calcMenu = 'S-SUM';
    } else if (k === 'S-VAR') {
      w.calcMenu = 'S-VAR';
    } else if (k === 'BACK') {
      if (w.calcJustEvaluated) {
        // Возврат к редактированию выражения в конце
        w.calcExpr = (w.calcHistoryExpr || '').replace(/\s*\[Y=.*\]$/, '');
        w.calcCursorPos = w.calcExpr.length;
        w.calcJustEvaluated = false;
      } else {
        deleteAtCursor();
      }
    } else if (k === '=') {
      evaluateCurrentExpr();
    } else if (k === 'FRAC_ABC' || k === 'FRAC_DC') {
      if (w.calcJustEvaluated && Number.isFinite(w.calcLastNumeric)) {
        if (k === 'FRAC_DC') {
          const nextImproper = w.calcFracState !== 2;
          const frac = decimalToFractionStr(w.calcLastNumeric, nextImproper);
          if (frac) {
            w.calcDisplayResult = frac;
            w.calcFracState = nextImproper ? 2 : 1;
          }
        } else {
          if (w.calcFracState === 0) {
            const frac = decimalToFractionStr(w.calcLastNumeric, false);
            if (frac) {
              w.calcDisplayResult = frac;
              w.calcFracState = 1;
            }
          } else {
            w.calcDisplayResult = formatNum(w.calcLastNumeric);
            w.calcFracState = 0;
          }
        }
      } else {
        if (w.calcJustEvaluated) {
          w.calcExpr = w.calcLastAns || '';
          w.calcCursorPos = w.calcExpr.length;
          w.calcJustEvaluated = false;
        }
        insertAtCursor('┘');
      }
    } else if (k === 'M+' || k === 'M-') {
      const isSd = (w.calcAppMode || 'COMP') === 'SD';
      let val = w.calcLastNumeric ?? 0;
      if (!w.calcJustEvaluated && w.calcExpr) {
        try {
          val = WB.evaluatePhysicsCalcNumeric(w.calcExpr, w.calcMode || 'DEG', getVarsWithAns());
        } catch (_) {
          val = NaN;
        }
      }
      if (Number.isFinite(val)) {
        if (isSd) {
          if (k === 'M+') {
            w.calcSdData.push(val);
          } else {
            const idx = w.calcSdData.lastIndexOf(val);
            if (idx >= 0) w.calcSdData.splice(idx, 1);
            else if (w.calcSdData.length > 0) w.calcSdData.pop();
          }
          w.calcHistoryExpr = `n=`;
          w.calcDisplayResult = String(w.calcSdData.length);
          w.calcJustEvaluated = true;
        } else {
          w.calcVars.M = (Number(w.calcVars.M) || 0) + (k === 'M+' ? val : -val);
          w.calcMem = w.calcVars.M;
          w.calcHistoryExpr = `${k === 'M+' ? 'M+' : 'M−'} (${formatNum(val)})`;
          w.calcDisplayResult = formatNum(val);
          w.calcLastNumeric = val;
          w.calcLastAns = formatNum(val);
          w.calcJustEvaluated = true;
        }
      }
    } else if (k === 'ENG_RIGHT' || k === 'ENG_LEFT') {
      let curVal = w.calcLastNumeric;
      if (!w.calcJustEvaluated && w.calcExpr) {
        try {
          curVal = WB.evaluatePhysicsCalcNumeric(w.calcExpr, w.calcMode || 'DEG', getVarsWithAns());
        } catch (_) {
          curVal = NaN;
        }
      }
      if (Number.isFinite(curVal)) {
        if (!w.calcJustEvaluated) {
          w.calcHistoryExpr = w.calcExpr || formatNum(curVal);
          w.calcLastNumeric = curVal;
          w.calcEngOffset = 0;
        } else {
          w.calcEngOffset = (w.calcEngOffset || 0) + (k === 'ENG_RIGHT' ? 1 : -1);
        }
        w.calcDisplayResult = formatEng(curVal, w.calcEngOffset);
        w.calcJustEvaluated = true;
      }
    } else if (k === 'DMS') {
      if (w.calcJustEvaluated && Number.isFinite(w.calcLastNumeric)) {
        const isCurrentlyDms = String(w.calcDisplayResult || '').includes('°');
        w.calcDisplayResult = isCurrentlyDms ? formatNum(w.calcLastNumeric) : formatDMS(w.calcLastNumeric);
      } else {
        insertAtCursor('°');
      }
    } else if (k === 'RND') {
      const val = Number(formatNum(w.calcLastNumeric ?? 0));
      if (Number.isFinite(val)) {
        w.calcLastNumeric = val;
        w.calcLastAns = formatNum(val);
        w.calcHistoryExpr = 'Rnd';
        w.calcDisplayResult = w.calcLastAns;
        w.calcJustEvaluated = true;
      }
    } else if (k === 'RAN') {
      const rVal = Math.floor(Math.random() * 1000) / 1000;
      const rStr = rVal.toFixed(3);
      if (w.calcJustEvaluated) {
        w.calcExpr = '';
        w.calcCursorPos = 0;
        w.calcJustEvaluated = false;
      }
      insertAtCursor(rStr);
    } else if (k === 'C_comb' || k === 'P') {
      const sym = k === 'C_comb' ? 'C' : 'P';
      if (w.calcJustEvaluated) {
        w.calcExpr = 'Ans';
        w.calcCursorPos = 3;
        w.calcJustEvaluated = false;
      }
      insertAtCursor(sym);
    } else if (k === 'ANS') {
      if (w.calcJustEvaluated) {
        w.calcExpr = '';
        w.calcCursorPos = 0;
        w.calcJustEvaluated = false;
      }
      insertAtCursor('Ans');
    } else if (k === 'sq' || k === 'cube') {
      const p = k === 'sq' ? '^2' : '^3';
      if (w.calcJustEvaluated) {
        w.calcExpr = 'Ans' + p;
        w.calcCursorPos = w.calcExpr.length;
        w.calcJustEvaluated = false;
      } else {
        insertAtCursor(p);
      }
    } else if (k === 'inv') {
      if (w.calcJustEvaluated) {
        w.calcExpr = 'Ans^(-1)';
        w.calcCursorPos = w.calcExpr.length;
        w.calcJustEvaluated = false;
      } else {
        insertAtCursor('^(-1)');
      }
    } else if (k === 'SIGN') {
      if (w.calcJustEvaluated) {
        w.calcExpr = '−';
        w.calcCursorPos = 1;
        w.calcJustEvaluated = false;
      } else {
        insertAtCursor('−');
      }
    } else if (k === 'E') {
      if (w.calcJustEvaluated) {
        w.calcExpr = 'Ans';
        w.calcCursorPos = 3;
        w.calcJustEvaluated = false;
      }
      const before = (w.calcExpr || '').slice(0, w.calcCursorPos);
      if (!before || /[+\-−×÷*/^(,;]$/.test(before)) {
        insertAtCursor('1E');
      } else if (!/E[+-]?[0-9]*$/.test(before)) {
        insertAtCursor('E');
      }
    } else if (['+', '−', '-', '×', '*', '÷', '/', '^', 'ˣ√', '%', '!', ','].includes(k)) {
      if (w.calcJustEvaluated && k !== ',') {
        w.calcExpr = 'Ans';
        w.calcCursorPos = 3;
        w.calcJustEvaluated = false;
      } else if (w.calcJustEvaluated) {
        w.calcExpr = '';
        w.calcCursorPos = 0;
        w.calcJustEvaluated = false;
      }
      insertAtCursor(k);
    } else {
      if (w.calcJustEvaluated) {
        w.calcExpr = '';
        w.calcCursorPos = 0;
        w.calcHistoryExpr = '';
        w.calcJustEvaluated = false;
      }
      insertAtCursor(k);
    }

    if (k !== 'STO_MODE' && k !== 'RCL_MODE') {
      w.calcShift = false;
      w.calcAlpha = false;
    } else {
      w.calcShift = false;
      w.calcAlpha = false;
    }
    syncUI();
    onSave();
  };

  // Кнопки верхнего ряда управления: 2ndF, ALPHA, MODE/CLR, ON, HYP
  if (shiftBtn) {
    shiftBtn.addEventListener('click', () => {
      if (w.calcOff) return;
      w.calcShift = !w.calcShift;
      if (w.calcShift) { w.calcAlpha = false; w.calcSto = false; w.calcRcl = false; }
      syncUI();
    });
  }
  if (alphaBtn) {
    alphaBtn.addEventListener('click', () => {
      if (w.calcOff) return;
      w.calcAlpha = !w.calcAlpha;
      if (w.calcAlpha) { w.calcShift = false; w.calcSto = false; w.calcRcl = false; }
      syncUI();
    });
  }
  const modeBtn = body.querySelector('[data-action="MODE"]');
  if (modeBtn) {
    modeBtn.addEventListener('click', () => {
      if (w.calcOff) return;
      if (w.calcShift) {
        w.calcShift = false;
        w.calcMenu = w.calcMenu === 'CLR' ? null : 'CLR';
      } else {
        if (!w.calcMenu || !w.calcMenu.startsWith('MODE_')) w.calcMenu = 'MODE_1';
        else if (w.calcMenu === 'MODE_1') w.calcMenu = 'MODE_2';
        else if (w.calcMenu === 'MODE_2') w.calcMenu = 'MODE_3';
        else w.calcMenu = null;
      }
      syncUI();
    });
  }
  const onBtn = body.querySelector('[data-action="ON"]');
  if (onBtn) {
    onBtn.addEventListener('click', () => handleCalcKey('ON'));
  }
  if (hypBtn) {
    hypBtn.addEventListener('click', () => {
      if (w.calcOff) return;
      if (w.calcSto || w.calcRcl) {
        handleVarRegisterAction('C');
        syncUI();
        onSave();
        return;
      }
      if (w.calcAlpha) {
        handleCalcKey('C');
        return;
      }
      w.calcHyp = !w.calcHyp;
      syncUI();
    });
  }

  // 4-позиционный диск REPLAY (▲▼ история, ◀▶ курсор в выражении)
  const replayUp = body.querySelector('[data-action="REPLAY_UP"]');
  const replayDown = body.querySelector('[data-action="REPLAY_DOWN"]');
  const replayLeft = body.querySelector('[data-action="REPLAY_LEFT"]');
  const replayRight = body.querySelector('[data-action="REPLAY_RIGHT"]');

  if (replayUp) {
    replayUp.addEventListener('click', () => {
      if (w.calcOff) return;
      w.calcMenu = null;
      const log = w.calcHistoryLog;
      if (!log.length) return;
      if (w.calcReplayIdx < 0) w.calcReplayIdx = log.length - 1;
      else w.calcReplayIdx = Math.max(0, w.calcReplayIdx - 1);
      const entry = log[w.calcReplayIdx];
      if (entry) {
        w.calcExpr = entry.expr;
        w.calcHistoryExpr = entry.expr;
        w.calcDisplayResult = entry.res;
        w.calcCursorPos = entry.expr.length;
        w.calcJustEvaluated = true;
        syncUI();
      }
    });
  }
  if (replayDown) {
    replayDown.addEventListener('click', () => {
      if (w.calcOff) return;
      w.calcMenu = null;
      const log = w.calcHistoryLog;
      if (!log.length || w.calcReplayIdx < 0) return;
      if (w.calcReplayIdx < log.length - 1) {
        w.calcReplayIdx++;
        const entry = log[w.calcReplayIdx];
        if (entry) {
          w.calcExpr = entry.expr;
          w.calcHistoryExpr = entry.expr;
          w.calcDisplayResult = entry.res;
          w.calcCursorPos = entry.expr.length;
          w.calcJustEvaluated = true;
        }
      } else {
        w.calcReplayIdx = -1;
        w.calcExpr = '';
        w.calcHistoryExpr = '';
        w.calcDisplayResult = '0.';
        w.calcCursorPos = 0;
        w.calcJustEvaluated = false;
      }
      syncUI();
    });
  }
  if (replayLeft) {
    replayLeft.addEventListener('click', () => {
      if (w.calcOff) return;
      w.calcMenu = null;
      if (w.calcJustEvaluated) {
        const src = (w.calcHistoryExpr || '').replace(/\s*\[Y=.*\]$/, '');
        if (src && !['Mem clear', 'Mode clear', 'Reset All', 'COMP', 'Rnd'].includes(src)) {
          w.calcExpr = src;
          w.calcCursorPos = src.length;
          w.calcJustEvaluated = false;
        }
      } else {
        w.calcCursorPos = Math.max(0, (w.calcCursorPos ?? 0) - 1);
      }
      syncUI();
    });
  }
  if (replayRight) {
    replayRight.addEventListener('click', () => {
      if (w.calcOff) return;
      w.calcMenu = null;
      if (w.calcJustEvaluated) {
        const src = (w.calcHistoryExpr || '').replace(/\s*\[Y=.*\]$/, '');
        if (src && !['Mem clear', 'Mode clear', 'Reset All', 'COMP', 'Rnd'].includes(src)) {
          w.calcExpr = src;
          w.calcCursorPos = 0;
          w.calcJustEvaluated = false;
        }
      } else {
        w.calcCursorPos = Math.min((w.calcExpr || '').length, (w.calcCursorPos ?? 0) + 1);
      }
      syncUI();
    });
  }

  // Прямой клик по жёлтым 2ndF и розовым ALPHA подписям над клавишами
  body.querySelectorAll('.cs85-sub[data-shift-k]').forEach(sub => {
    sub.addEventListener('click', (ev) => {
      ev.stopPropagation();
      handleCalcKey(sub.dataset.shiftK);
    });
  });
  body.querySelectorAll('.cs85-sub[data-alpha-k]').forEach(sub => {
    sub.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const ch = sub.dataset.alphaK;
      if ((w.calcSto || w.calcRcl) && /^[A-FXYM]$/.test(ch)) {
        handleVarRegisterAction(ch);
        syncUI();
        onSave();
        return;
      }
      handleCalcKey(ch);
    });
  });

  // Основные клавиши калькулятора
  body.querySelectorAll('.calc-key[data-k]').forEach(btn => {
    btn.addEventListener('click', () => {
      const varName = btn.dataset.var || null;
      if ((w.calcSto || w.calcRcl) && varName) {
        handleVarRegisterAction(varName);
        syncUI();
        onSave();
        return;
      }
      let k = btn.dataset.k;
      if (w.calcShift && btn.dataset.shiftK) k = btn.dataset.shiftK;
      else if (w.calcAlpha && btn.dataset.alphaK) k = btn.dataset.alphaK;
      handleCalcKey(k, varName);
    });
  });

  // Ввод с физической клавиатуры при фокусе на калькуляторе
  body.addEventListener('keydown', (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const key = ev.key;
    if (/^[0-9]$/.test(key)) { ev.preventDefault(); ev.stopPropagation(); handleCalcKey(key); }
    else if (key === '.') { ev.preventDefault(); ev.stopPropagation(); handleCalcKey('.'); }
    else if (key === '+') { ev.preventDefault(); ev.stopPropagation(); handleCalcKey('+'); }
    else if (key === '-') { ev.preventDefault(); ev.stopPropagation(); handleCalcKey('−'); }
    else if (key === '*') { ev.preventDefault(); ev.stopPropagation(); handleCalcKey('×'); }
    else if (key === '/') { ev.preventDefault(); ev.stopPropagation(); handleCalcKey('÷'); }
    else if (key === '(' || key === ')' || key === '^' || key === '!' || key === '%' || key === ',') {
      ev.preventDefault(); ev.stopPropagation(); handleCalcKey(key);
    }
    else if (key === 'Enter' || key === '=') { ev.preventDefault(); ev.stopPropagation(); handleCalcKey('='); }
    else if (key === 'Backspace') { ev.preventDefault(); ev.stopPropagation(); handleCalcKey('BACK'); }
    else if (key === 'Escape' || key === 'Delete') { ev.preventDefault(); ev.stopPropagation(); handleCalcKey('AC'); }
    else if (key === 'ArrowLeft' && replayLeft) { ev.preventDefault(); ev.stopPropagation(); replayLeft.click(); }
    else if (key === 'ArrowRight' && replayRight) { ev.preventDefault(); ev.stopPropagation(); replayRight.click(); }
    else if (key === 'ArrowUp' && replayUp) { ev.preventDefault(); ev.stopPropagation(); replayUp.click(); }
    else if (key === 'ArrowDown' && replayDown) { ev.preventDefault(); ev.stopPropagation(); replayDown.click(); }
  });

  syncUI();
};

WB.mountComixCalculator = function(containerEl, stateObj = {}, opts = {}) {
  if (!containerEl) return;
  containerEl.innerHTML = WB.buildComixCalculatorHTML(stateObj);
  WB.bindComixCalculator(containerEl, stateObj, opts);
};

function escapeHtmlCell(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

WB.renderWidgetsDOM = function() {
  const worldLayer = document.getElementById('world-layer');
  if (!worldLayer) return;

  // Очищаем интервалы удалённых или находящихся на другой странице таймеров/секундомеров
  const aliveIds = new Set((WB.state.widgets || []).map(item => String(item.id)));
  for (const activeId in activeIntervals) {
    if (!aliveIds.has(String(activeId))) {
      clearInterval(activeIntervals[activeId]);
      delete activeIntervals[activeId];
    }
  }

  worldLayer.innerHTML = '';

  for (const w of WB.state.widgets) {
    const isSelected = WB.selection.widgetIds.has(w.id);
    const el = document.createElement('div');
    el.className = `widget ${w.type}-widget ${w.isPdf ? 'pdf-widget' : ''} ${isSelected ? 'selected' : ''}`;
    el.dataset.id = w.id;
    el.style.left = w.x + 'px';
    el.style.top = w.y + 'px';
    el.style.width = w.w + 'px';
    el.style.height = w.h + 'px';

    if (w.type === 'note') {
      el.style.background = w.color;
    }

    let headerLeft = '<span></span>';
    if (w.type === 'note') {
      headerLeft = `<div class="note-colors">${WB.noteColors.map(c => `<span class="note-color-dot" style="background:${c}" data-color="${c}"></span>`).join('')}</div>`;
    } else if (w.type === 'latex') {
      headerLeft = `
        <div class="latex-header-left">
          <span class="latex-badge">${w.lawTitle ? '⚛️ ' + w.lawTitle : '∑ LaTeX'}</span>
          <button class="latex-edit-btn" title="Редактировать формулу">✏️</button>
          <div class="note-colors">${WB.latexColors.map(c => `<span class="note-color-dot" style="background:${c}" data-color="${c}"></span>`).join('')}</div>
        </div>
      `;
    } else if (w.isPdf) {
      const totalP = w.pdfPages ? w.pdfPages.length : 1;
      const curP = (w.currentPage || 0) + 1;
      const fmtLabel = w.docLabel || 'PDF';
      const fmtEmoji = w.docEmoji || '📕';
      headerLeft = `
        <div class="pdf-widget-controls">
          <span class="pdf-badge">${fmtEmoji} ${escapeHtmlCell(fmtLabel)} ${curP}/${totalP}</span>
          ${totalP > 1 ? `<button class="pdf-nav-mini prev" title="Предыдущая страница">◀</button><button class="pdf-nav-mini next" title="Следующая страница">▶</button>` : ''}
          <button class="pdf-open-editor-btn" title="Двойной клик или нажмите, чтобы открыть редактор документа">🔍 Редактор</button>
        </div>
      `;
    } else if (w.type === 'image') {
      const totalP = w.pdfPages ? w.pdfPages.length : 1;
      const curP = (w.currentPage || 0) + 1;
      headerLeft = `
        <div class="pdf-widget-controls photo-widget-controls">
          <span class="pdf-badge photo-badge">🖼️ ФОТО${totalP > 1 ? ` ${curP}/${totalP}` : ''}</span>
          ${totalP > 1 ? `<button class="pdf-nav-mini prev" title="Предыдущая страница">◀</button><button class="pdf-nav-mini next" title="Следующая страница">▶</button>` : ''}
          <button class="pdf-open-editor-btn" title="Двойной клик или нажмите, чтобы открыть редактор фото">🔍 Редактор</button>
        </div>
      `;
    } else if (w.type === 'timer') {
      headerLeft = `<span class="lb-widget-title">⏳ Таймер</span>`;
    } else if (w.type === 'stopwatch') {
      headerLeft = `<span class="lb-widget-title">⏱️ Секундомер</span>`;
    } else if (w.type === 'calculator') {
      headerLeft = `<span class="cs85-drag-grip" aria-hidden="true"><span></span><span></span><span></span></span>`;
    } else if (w.type === 'table') {
      headerLeft = `
        <div class="table-header-controls">
          <span class="lb-widget-title">Таблица</span>
          <button type="button" class="table-mini-btn add-row" title="Добавить строку">+Стр</button>
          <button type="button" class="table-mini-btn del-row" title="Удалить строку">−Стр</button>
          <button type="button" class="table-mini-btn add-col" title="Добавить столбец">+Стлб</button>
          <button type="button" class="table-mini-btn del-col" title="Удалить столбец">−Стлб</button>
        </div>
      `;
    }

    let bodyHTML = '';
    if (w.type === 'image') {
      if (w.isPdf) {
        bodyHTML = `
          <img src="${w.src}" alt="${escapeHtmlCell(w.pdfTitle || 'Документ')}" title="Двойной клик — открыть в редакторе документа">
          <div class="pdf-card-footer" title="Двойной клик по странице открывает редактор документа">${escapeHtmlCell(w.pdfTitle || 'Документ')}</div>
        `;
      } else {
        bodyHTML = `<img src="${w.src}" alt="${escapeHtmlCell(w.pdfTitle || 'Фото')}" title="Двойной клик — открыть в редакторе фото">`;
      }
    } else if (w.type === 'latex') {
      bodyHTML = `<div class="latex-content" style="color:${w.color || 'inherit'}" title="Двойной клик для редактирования формулы"></div>`;
    } else if (w.type === 'timer') {
      const pct = w.timerTotalSec > 0 ? Math.round((w.timerRemainSec / w.timerTotalSec) * 100) : 0;
      bodyHTML = `
        <div class="lb-widget-body timer-body">
          <div class="timer-display">${formatTimeMMSS(w.timerRemainSec)}</div>
          <div class="timer-progress-wrap"><div class="timer-progress-bar" style="width:${pct}%"></div></div>
          <div class="timer-presets">
            <button data-add="60">+1м</button>
            <button data-add="300">+5м</button>
            <button data-set="60">1м</button>
            <button data-set="300">5м</button>
            <button data-set="600">10м</button>
          </div>
          <div class="timer-actions">
            <button class="lb-btn primary timer-toggle">${activeIntervals[w.id] ? '⏸ Пауза' : '▶ Старт'}</button>
            <button class="lb-btn secondary timer-reset">🔄 Сброс</button>
          </div>
        </div>
      `;
    } else if (w.type === 'stopwatch') {
      bodyHTML = `
        <div class="lb-widget-body stopwatch-body">
          <div class="stopwatch-display">${formatStopwatch(w.stopwatchMs || 0)}</div>
          <div class="timer-actions">
            <button class="lb-btn primary sw-toggle">${activeIntervals[w.id] ? '⏸ Стоп' : '▶ Старт'}</button>
            <button class="lb-btn secondary sw-reset">🔄 Сброс</button>
          </div>
        </div>
      `;
    } else if (w.type === 'calculator') {
      bodyHTML = WB.buildComixCalculatorHTML(w);
    } else if (w.type === 'table') {
      const rows = Array.isArray(w.tableData) && w.tableData.length
        ? w.tableData
        : [['Столбец 1', 'Столбец 2', 'Столбец 3'], ['', '', ''], ['', '', '']];
      w.tableData = rows;
      const rowsHtml = rows.map((row, rIdx) => {
        const tag = rIdx === 0 ? 'th' : 'td';
        const cells = row.map((cell, cIdx) =>
          `<${tag} contenteditable="true" data-r="${rIdx}" data-c="${cIdx}" spellcheck="false">${escapeHtmlCell(cell)}</${tag}>`
        ).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      bodyHTML = `
        <div class="table-wrap">
          <table class="wb-table">
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      `;
    } else {
      bodyHTML = `<div class="widget-body" contenteditable="true">${w.text}</div>`;
    }

    el.innerHTML = `
      <div class="widget-header" title="Потяните для перемещения">
        ${headerLeft}
        <button type="button" class="delete-widget" title="${w.isPdf ? 'Закрыть и удалить PDF' : 'Удалить'}">×</button>
      </div>
      ${bodyHTML}
      <div class="resize-handle" title="Изменить размер"></div>
    `;

    // --- Обработчики виджетов PDF / DOCX / Фото (включая dblclick для входа в редактор) ---
    if (w.isPdf || w.type === 'image') {
      const openBtn = el.querySelector('.pdf-open-editor-btn');
      if (openBtn) {
        openBtn.addEventListener('pointerdown', e => e.stopPropagation());
        openBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (typeof WB.openPdfEditorForWidget === 'function') WB.openPdfEditorForWidget(w.id);
        });
      }
      const prevBtn = el.querySelector('.pdf-nav-mini.prev');
      const nextBtn = el.querySelector('.pdf-nav-mini.next');
      if (prevBtn) {
        prevBtn.addEventListener('pointerdown', e => e.stopPropagation());
        prevBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (w.pdfPages && w.currentPage > 0) {
            w.currentPage--;
            w.src = w.pdfPages[w.currentPage];
            WB.renderWidgetsDOM();
            WB.saveHistory();
          }
        });
      }
      if (nextBtn) {
        nextBtn.addEventListener('pointerdown', e => e.stopPropagation());
        nextBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (w.pdfPages && w.currentPage < w.pdfPages.length - 1) {
            w.currentPage++;
            w.src = w.pdfPages[w.currentPage];
            WB.renderWidgetsDOM();
            WB.saveHistory();
          }
        });
      }
      attachTouchDoubleTap(el, () => {
        if (typeof WB.openPdfEditorForWidget === 'function') WB.openPdfEditorForWidget(w.id);
      }, { ignoreSelector: 'button, .resize-handle' });
    }

    // --- Обработчики LaTeX виджета ---
    if (w.type === 'latex') {
      const latexContainer = el.querySelector('.latex-content');
      WB.renderLatexInto(w.latex, latexContainer);

      const editBtn = el.querySelector('.latex-edit-btn');
      if (editBtn) {
        editBtn.addEventListener('pointerdown', e => e.stopPropagation());
        editBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          WB.openLatexModal(w.id);
        });
      }

      latexContainer.addEventListener('pointerdown', (ev) => {
        if (WB._isTouchGestureActive) return;
        if (!WB.selection.widgetIds.has(w.id)) {
          if (!ev.shiftKey) WB.clearSelection();
          WB.selection.widgetIds.add(w.id);
          WB.updateSelectionBounds();
        }
      });

      attachTouchDoubleTap(latexContainer, () => {
        WB.openLatexModal(w.id);
      });
    }

    // --- Обработчики Таймера ---
    if (w.type === 'timer') {
      const body = el.querySelector('.timer-body');
      body.addEventListener('pointerdown', e => e.stopPropagation());
      const disp = el.querySelector('.timer-display');
      const bar = el.querySelector('.timer-progress-bar');
      const toggleBtn = el.querySelector('.timer-toggle');
      const resetBtn = el.querySelector('.timer-reset');

      const updateTimerDOM = () => {
        const liveEl = document.querySelector(`.widget[data-id="${w.id}"]`);
        const liveDisp = liveEl ? liveEl.querySelector('.timer-display') : disp;
        const liveBar = liveEl ? liveEl.querySelector('.timer-progress-bar') : bar;
        if (liveDisp) liveDisp.textContent = formatTimeMMSS(w.timerRemainSec);
        if (liveBar) {
          const pct = w.timerTotalSec > 0 ? Math.max(0, Math.min(100, (w.timerRemainSec / w.timerTotalSec) * 100)) : 0;
          liveBar.style.width = pct + '%';
        }
      };

      el.querySelectorAll('.timer-presets button').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.dataset.add) {
            const add = Number(btn.dataset.add);
            w.timerRemainSec += add;
            w.timerTotalSec = Math.max(w.timerTotalSec, w.timerRemainSec);
          } else if (btn.dataset.set) {
            const setVal = Number(btn.dataset.set);
            w.timerTotalSec = setVal;
            w.timerRemainSec = setVal;
          }
          updateTimerDOM();
          WB.saveToStorage();
        });
      });

      toggleBtn.addEventListener('click', () => {
        if (activeIntervals[w.id]) {
          clearInterval(activeIntervals[w.id]);
          delete activeIntervals[w.id];
          toggleBtn.textContent = '▶ Старт';
        } else {
          if (w.timerRemainSec <= 0) w.timerRemainSec = w.timerTotalSec || 300;
          toggleBtn.textContent = '⏸ Пауза';
          activeIntervals[w.id] = setInterval(() => {
            const liveWidget = (WB.state.widgets || []).find(item => item.id === w.id);
            if (!liveWidget) {
              clearInterval(activeIntervals[w.id]);
              delete activeIntervals[w.id];
              return;
            }
            liveWidget.timerRemainSec = Math.max(0, (liveWidget.timerRemainSec || 0) - 1);
            w.timerRemainSec = liveWidget.timerRemainSec;
            updateTimerDOM();
            if (liveWidget.timerRemainSec <= 0) {
              clearInterval(activeIntervals[w.id]);
              delete activeIntervals[w.id];
              const liveEl = document.querySelector(`.widget[data-id="${w.id}"]`);
              const liveToggle = liveEl?.querySelector('.timer-toggle');
              if (liveToggle) liveToggle.textContent = '▶ Старт';
              if (liveEl) {
                liveEl.classList.add('timer-finished');
                setTimeout(() => liveEl.classList.remove('timer-finished'), 3000);
              }
              WB.showToast('⏰ Время таймера вышло!', 3500);
            }
          }, 1000);
        }
      });

      resetBtn.addEventListener('click', () => {
        if (activeIntervals[w.id]) {
          clearInterval(activeIntervals[w.id]);
          delete activeIntervals[w.id];
        }
        w.timerRemainSec = w.timerTotalSec || 300;
        toggleBtn.textContent = '▶ Старт';
        updateTimerDOM();
      });
    }

    // --- Обработчики Секундомера ---
    if (w.type === 'stopwatch') {
      const body = el.querySelector('.stopwatch-body');
      body.addEventListener('pointerdown', e => e.stopPropagation());
      const disp = el.querySelector('.stopwatch-display');
      const toggleBtn = el.querySelector('.sw-toggle');
      const resetBtn = el.querySelector('.sw-reset');

      toggleBtn.addEventListener('click', () => {
        if (activeIntervals[w.id]) {
          clearInterval(activeIntervals[w.id]);
          delete activeIntervals[w.id];
          toggleBtn.textContent = '▶ Старт';
        } else {
          toggleBtn.textContent = '⏸ Стоп';
          let lastT = performance.now();
          activeIntervals[w.id] = setInterval(() => {
            const liveWidget = (WB.state.widgets || []).find(item => item.id === w.id);
            if (!liveWidget) {
              clearInterval(activeIntervals[w.id]);
              delete activeIntervals[w.id];
              return;
            }
            const now = performance.now();
            liveWidget.stopwatchMs = (liveWidget.stopwatchMs || 0) + (now - lastT);
            w.stopwatchMs = liveWidget.stopwatchMs;
            lastT = now;
            const liveDisp = document.querySelector(`.widget[data-id="${w.id}"] .stopwatch-display`);
            if (liveDisp) liveDisp.textContent = formatStopwatch(liveWidget.stopwatchMs);
          }, 100);
        }
      });

      resetBtn.addEventListener('click', () => {
        if (activeIntervals[w.id]) {
          clearInterval(activeIntervals[w.id]);
          delete activeIntervals[w.id];
        }
        w.stopwatchMs = 0;
        toggleBtn.textContent = '▶ Старт';
        if (disp) disp.textContent = formatStopwatch(0);
      });
    }

    // --- Обработчики Калькулятора (Comix CS-85 · 240 функций) ---
    if (w.type === 'calculator') {
      WB.bindComixCalculator(el, w, { onSave: () => WB.saveToStorage() });
    }

    // --- Обработчики Таблицы ---
    if (w.type === 'table') {
      const resizeTable = (dRows, dCols) => {
        const cur = Array.isArray(w.tableData) ? w.tableData : [['Столбец 1', 'Столбец 2', 'Столбец 3']];
        const nextRows = Math.max(1, Math.min(16, cur.length + dRows));
        const nextCols = Math.max(1, Math.min(12, (cur[0]?.length || 1) + dCols));
        const nextData = [];
        for (let r = 0; r < nextRows; r++) {
          const src = cur[r] || [];
          const row = [];
          for (let c = 0; c < nextCols; c++) {
            row.push(src[c] !== undefined ? src[c] : (r === 0 ? `Столбец ${c + 1}` : ''));
          }
          nextData.push(row);
        }
        w.tableData = nextData;
        if (dRows > 0) w.h = Math.max(w.h, 28 + nextRows * 46);
        if (dCols > 0) w.w = Math.max(w.w, nextCols * 96);
        WB.renderWidgetsDOM();
        WB.updateSelectionBounds();
        WB.saveHistory();
      };

      const bindMini = (sel, dR, dC) => {
        const btn = el.querySelector(sel);
        if (btn) {
          btn.addEventListener('pointerdown', e => e.stopPropagation());
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            resizeTable(dR, dC);
          });
        }
      };
      bindMini('.add-row', 1, 0);
      bindMini('.del-row', -1, 0);
      bindMini('.add-col', 0, 1);
      bindMini('.del-col', 0, -1);

      const tableWrap = el.querySelector('.table-wrap');
      if (tableWrap) {
        tableWrap.addEventListener('pointerdown', e => e.stopPropagation());
        tableWrap.addEventListener('mousedown', e => e.stopPropagation());
      }

      const cells = el.querySelectorAll('.wb-table td, .wb-table th');
      const cellList = Array.from(cells);
      const colCount = Math.max(1, (w.tableData && w.tableData[0] && w.tableData[0].length) || 1);

      cells.forEach(cell => {
        cell.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          if (!WB.selection.widgetIds.has(w.id)) {
            WB.clearSelection();
            WB.selection.widgetIds.add(w.id);
            WB.syncWidgetSelectionDOM();
          }
          el.classList.add('editing');
        });
        cell.addEventListener('mousedown', (e) => {
          e.stopPropagation();
        });
        cell.addEventListener('click', (e) => {
          e.stopPropagation();
          if (document.activeElement !== cell) {
            cell.focus();
          }
        });
        cell.addEventListener('focus', () => {
          el.classList.add('editing');
        });
        cell.addEventListener('input', () => {
          const r = Number(cell.dataset.r);
          const c = Number(cell.dataset.c);
          if (w.tableData && w.tableData[r]) {
            w.tableData[r][c] = cell.innerText;
            WB.saveToStorage();
          }
        });
        cell.addEventListener('blur', (e) => {
          const r = Number(cell.dataset.r);
          const c = Number(cell.dataset.c);
          if (w.tableData && w.tableData[r]) {
            w.tableData[r][c] = cell.innerText;
          }
          const nextFocused = e.relatedTarget;
          if (!nextFocused || !el.contains(nextFocused)) {
            el.classList.remove('editing');
          }
          WB.saveHistory();
        });
        cell.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            cell.blur();
            return;
          }
          if (e.key === 'Tab') {
            e.preventDefault();
            e.stopPropagation();
            const idx = cellList.indexOf(cell);
            const nextIdx = e.shiftKey ? (idx - 1 + cellList.length) % cellList.length : (idx + 1) % cellList.length;
            cellList[nextIdx]?.focus();
            return;
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            const idx = cellList.indexOf(cell);
            const nextRowIdx = idx + colCount;
            if (nextRowIdx < cellList.length) {
              cellList[nextRowIdx]?.focus();
            } else {
              cell.blur();
            }
            return;
          }
          e.stopPropagation();
        });
      });
    }

    // Перетаскивание за заголовок
    const header = el.querySelector('.widget-header');
    header.addEventListener('pointerdown', (e) => {
      if (WB._isTouchGestureActive) return;
      if (e.target.closest('button') || e.target.classList.contains('note-color-dot')) return;
      e.stopPropagation();

      const preDragWidgets = e.pointerType === 'touch'
        ? WB.state.widgets.map(item => ({ id: item.id, x: item.x, y: item.y }))
        : null;
      const preDragSelectedStrokes = (e.pointerType === 'touch' && WB.selection && WB.selection.strokeIds && WB.selection.strokeIds.size > 0)
        ? JSON.stringify(WB.state.strokes)
        : null;
      const dragPointerId = e.pointerId;

      if (!WB.selection.widgetIds.has(w.id)) {
        if (!e.shiftKey) WB.clearSelection();
        WB.selection.widgetIds.add(w.id);
        WB.updateSelectionBounds();
      }

      let lastWorld = WB.toWorld(e.clientX, e.clientY);
      let cancelled = false;

      function cleanup() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        if (WB._activeWidgetTouchCancel === onCancel) {
          WB._activeWidgetTouchCancel = null;
        }
      }
      function onMove(ev) {
        if (cancelled || WB._isTouchGestureActive) return;
        if (ev.pointerId !== dragPointerId) return;
        const cur = WB.toWorld(ev.clientX, ev.clientY);
        WB.moveSelection(cur.x - lastWorld.x, cur.y - lastWorld.y);
        lastWorld = cur;
      }
      function onCancel() {
        if (cancelled) return;
        cancelled = true;
        cleanup();
        if (preDragWidgets) {
          try {
            const posMap = new Map(preDragWidgets.map(p => [p.id, p]));
            WB.state.widgets.forEach(item => {
              const orig = posMap.get(item.id);
              if (orig) {
                item.x = orig.x;
                item.y = orig.y;
                const domEl = document.querySelector(`#world-layer .widget[data-id="${item.id}"]`);
                if (domEl) {
                  domEl.style.left = orig.x + 'px';
                  domEl.style.top = orig.y + 'px';
                }
              }
            });
            if (preDragSelectedStrokes) {
              WB.state.strokes = JSON.parse(preDragSelectedStrokes);
            }
            WB.updateConnectedArrows();
            WB.updateSelectionBounds();
          } catch (_) {}
        }
      }
      function onUp(ev) {
        if (ev && ev.pointerId !== dragPointerId) return;
        if (cancelled) return;
        cleanup();
        WB.saveHistory();
      }
      if (e.pointerType === 'touch') {
        WB._activeWidgetTouchCancel = onCancel;
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    });

    // Смена цвета
    el.querySelectorAll('.note-color-dot').forEach(dot => {
      dot.addEventListener('pointerdown', e => e.stopPropagation());
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        w.color = dot.dataset.color;
        if (w.type === 'note') el.style.background = w.color;
        if (w.type === 'latex') {
          const content = el.querySelector('.latex-content');
          if (content) content.style.color = w.color;
        }
        WB.saveHistory();
      });
    });

    // Удаление виджета
    const delBtn = el.querySelector('.delete-widget');
    delBtn.addEventListener('pointerdown', e => e.stopPropagation());
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (activeIntervals[w.id]) {
        clearInterval(activeIntervals[w.id]);
        delete activeIntervals[w.id];
      }
      WB.state.widgets = WB.state.widgets.filter(item => item.id !== w.id);
      WB.selection.widgetIds.delete(w.id);
      WB.updateConnectedArrows();
      WB.renderWidgetsDOM();
      WB.updateSelectionBounds();
      WB.saveHistory();
    });

    // Редактирование текста обычного стикера
    const bodyEl = el.querySelector('.widget-body');
    if (bodyEl) {
      bodyEl.addEventListener('pointerdown', (e) => {
        if (el.classList.contains('editing')) e.stopPropagation();
      });
      bodyEl.addEventListener('focus', () => {
        if (w.text === 'Двойной клик для текста...') {
          w.text = '';
          bodyEl.innerText = '';
        }
      });
      bodyEl.addEventListener('input', () => {
        w.text = bodyEl.innerText;
        WB.saveToStorage();
      });
      bodyEl.addEventListener('blur', () => {
        el.classList.remove('editing');
        if (!bodyEl.innerText.trim()) {
          w.text = 'Двойной клик для текста...';
          bodyEl.innerText = w.text;
        }
        WB.saveHistory();
      });
    }

    // Ресайзер виджета
    const resizer = el.querySelector('.resize-handle');
    resizer.addEventListener('pointerdown', (e) => {
      if (WB._isTouchGestureActive) return;
      e.stopPropagation();
      const dragPointerId = e.pointerId;
      const startWorld = WB.toWorld(e.clientX, e.clientY);
      const origW = w.w, origH = w.h;
      let cancelled = false;

      function cleanup() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        if (WB._activeWidgetTouchCancel === onCancel) {
          WB._activeWidgetTouchCancel = null;
        }
      }
      function onMove(ev) {
        if (cancelled || WB._isTouchGestureActive) return;
        if (ev.pointerId !== dragPointerId) return;
        const cur = WB.toWorld(ev.clientX, ev.clientY);
        w.w = Math.max(80, origW + (cur.x - startWorld.x));
        w.h = Math.max(48, origH + (cur.y - startWorld.y));
        el.style.width = w.w + 'px';
        el.style.height = w.h + 'px';
        WB.updateConnectedArrows();
        WB.updateSelectionBounds();
      }
      function onCancel() {
        if (cancelled) return;
        cancelled = true;
        cleanup();
        w.w = origW;
        w.h = origH;
        el.style.width = w.w + 'px';
        el.style.height = w.h + 'px';
        WB.updateConnectedArrows();
        WB.updateSelectionBounds();
      }
      function onUp(ev) {
        if (ev && ev.pointerId !== dragPointerId) return;
        if (cancelled) return;
        cleanup();
        WB.saveHistory();
      }
      if (e.pointerType === 'touch') {
        WB._activeWidgetTouchCancel = onCancel;
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    });

    worldLayer.appendChild(el);
  }
};

// --- МОДАЛЬНЫЙ РЕДАКТОР LATEX ФОРМУЛ ---
WB.openLatexModal = function(targetWidgetId = null) {
  currentEditingLatexId = targetWidgetId;
  const modal = document.getElementById('latexModal');
  const input = document.getElementById('latexInput');

  if (!modal || !input) return;

  if (targetWidgetId) {
    const w = WB.state.widgets.find(item => item.id === targetWidgetId);
    input.value = w?.latex || '';
  } else {
    input.value = input.value || '\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}';
  }

  modal.style.display = 'flex';
  WB.updateLatexPreview();
  setTimeout(() => {
    input.focus();
    input.select();
  }, 50);
};

WB.closeLatexModal = function() {
  const modal = document.getElementById('latexModal');
  if (modal) modal.style.display = 'none';
  currentEditingLatexId = null;
};

WB.updateLatexPreview = function() {
  const input = document.getElementById('latexInput');
  const preview = document.getElementById('latexPreview');
  if (input && preview) {
    WB.renderLatexInto(input.value, preview);
  }
};

WB.insertLatexSymbol = function(snippet) {
  const input = document.getElementById('latexInput');
  if (!input) return;

  const start = input.selectionStart || 0;
  const end = input.selectionEnd || 0;
  const val = input.value;

  input.value = val.substring(0, start) + snippet + val.substring(end);
  const newPos = start + snippet.length;
  input.focus();
  input.setSelectionRange(newPos, newPos);
  WB.updateLatexPreview();
};

WB.applyLatexModal = function() {
  const input = document.getElementById('latexInput');
  if (!input) return;
  const formula = input.value.trim();
  if (!formula) {
    if (typeof WB.showToast === 'function') {
      WB.showToast('⚠️ Введите код формулы LaTeX', 2600, 'error');
    }
    input.focus();
    return;
  }

  if (currentEditingLatexId) {
    const w = WB.state.widgets.find(item => item.id === currentEditingLatexId);
    if (w) {
      w.latex = formula;
      WB.renderWidgetsDOM();
      WB.saveHistory();
    }
  } else {
    WB.addWidget('latex', { latex: formula });
  }

  WB.closeLatexModal();
  if (typeof WB.showToast === 'function') {
    const inPdf = !!(WB.pdfEditor && WB.pdfEditor.isOpen);
    WB.showToast(inPdf ? '📐 Формула LaTeX добавлена на страницу PDF!' : '📐 Формула LaTeX добавлена на доску!');
  }
};

WB.insertImageSource = function(dataUrl, customOpts = {}) {
  const img = new Image();
  img.onload = () => {
    const natW = img.naturalWidth || img.width || 800;
    const natH = img.naturalHeight || img.height || 600;
    // Сохраняем высокое разрешение (до 1800px) для чёткой работы в режиме редактирования фото
    const maxEdge = 1800;
    const scale = Math.min(1, maxEdge / Math.max(natW, natH));
    const storeW = Math.max(16, Math.round(natW * scale));
    const storeH = Math.max(16, Math.round(natH * scale));
    const off = document.createElement('canvas');
    off.width = storeW;
    off.height = storeH;
    off.getContext('2d').drawImage(img, 0, 0, storeW, storeH);
    const highResUrl = off.toDataURL('image/png');

    const fit = typeof WB.calcAspectFitBox === 'function'
      ? WB.calcAspectFitBox(natW, natH, 560, 560, 48)
      : { w: Math.min(560, natW), h: Math.min(560, natH) };

    const { openEditor, title, ...restOpts } = customOpts || {};
    const photoTitle = title || restOpts.pdfTitle || 'Фото.png';
    const widgetObj = WB.addWidget('image', {
      src: highResUrl,
      w: fit.w,
      h: fit.h + 28,
      isPdf: false,
      isDocx: false,
      isPhoto: true,
      docType: 'photo',
      docLabel: 'ФОТО',
      docEmoji: '🖼️',
      docAccent: '#0d9488',
      pdfTitle: photoTitle,
      pdfPages: [highResUrl],
      currentPage: 0,
      ...restOpts
    });

    if (openEditor && widgetObj && typeof WB.openPdfEditorForWidget === 'function') {
      WB.openPdfEditorForWidget(widgetObj.id);
    }
  };
  img.src = dataUrl;
};

WB.insertImageFile = function(file, opts = {}) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    WB.insertImageSource(ev.target.result, {
      title: file.name || 'Фото.png',
      openEditor: opts.openEditor !== false,
      ...opts
    });
  };
  reader.readAsDataURL(file);
};

WB.handleImageUpload = function(e) {
  const file = e.target.files[0];
  if (!file) return;
  WB.insertImageFile(file, { openEditor: true });
  e.target.value = '';
};
