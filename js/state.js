window.WB = window.WB || {};

WB.cam = { x: 0, y: 0, z: 1 };

WB.state = {
  strokes: [],
  widgets: []
};

WB.selection = {
  strokeIds: new Set(),
  widgetIds: new Set(),
  marquee: null,
  bounds: null
};

WB.currentTool = 'pen';
WB.currentLineStyle = 'solid'; // 'solid' | 'dashed' | 'dotted' | 'dashdot'
WB.eraserConfig = {
  target: 'pen_and_highlighter', // 'pen_and_highlighter' | 'highlighter_only' | 'pen_only' | 'all'
  wholeStroke: false
};
WB.isStudentBlocked = false;
WB.history = [];
WB.historyStep = -1;

// Режимы построения
WB.snapToGridEnabled = true;  // Режим построения по узлам клеток (включён по умолчанию)
WB.shapeDrawFromCenter = false; // Построение фигур: false = По рамке, true = Из центра
WB.gridSize = 32;             // Размер клетки
WB.userRole = 'teacher';      // Роль: 'teacher' | 'student'
WB.boardTitle = localStorage.getItem('wb_board_title') || 'Новый урок';
WB.prevCam = null;            // Предыдущая позиция камеры для кнопки «Вернуться к прежнему месту»
WB.clipboard = { strokes: [], widgets: [] }; // Буфер обмена для Ctrl+C / Ctrl+V
WB.boardAccessOpen = true;    // Доступ к доске для учеников по ссылке

// Многостраничность доски (раздел «Страницы» как в LearnBoard)
WB.pages = [
  {
    id: 'page_1',
    name: 'Страница 1',
    strokes: WB.state.strokes,
    widgets: WB.state.widgets,
    cam: { x: 0, y: 0, z: 1 }
  }
];
WB.currentPageIndex = 0;

WB.syncCurrentPage = function() {
  if (!Array.isArray(WB.pages) || WB.pages.length === 0) {
    WB.pages = [{
      id: 'page_1',
      name: 'Страница 1',
      strokes: WB.state.strokes || [],
      widgets: WB.state.widgets || [],
      cam: { x: WB.cam.x, y: WB.cam.y, z: WB.cam.z }
    }];
    WB.currentPageIndex = 0;
  }
  const cur = WB.pages[WB.currentPageIndex] || WB.pages[0];
  if (cur) {
    cur.strokes = WB.state.strokes;
    cur.widgets = WB.state.widgets;
    cur.cam = { x: WB.cam.x, y: WB.cam.y, z: WB.cam.z };
  }
};

WB.switchPage = function(index, opts) {
  if (!Array.isArray(WB.pages) || index < 0 || index >= WB.pages.length) return;
  WB.syncCurrentPage();
  WB.currentPageIndex = index;
  const target = WB.pages[index];
  WB.state = {
    strokes: Array.isArray(target.strokes) ? target.strokes : [],
    widgets: Array.isArray(target.widgets) ? target.widgets : []
  };
  target.strokes = WB.state.strokes;
  target.widgets = WB.state.widgets;
  if (target.cam && !(opts && opts.keepCam)) {
    WB.cam = {
      x: Number(target.cam.x) || 0,
      y: Number(target.cam.y) || 0,
      z: Number(target.cam.z) || 1
    };
  }
  if (typeof WB.clearSelection === 'function') WB.clearSelection();
  if (typeof WB.resetLinearChain === 'function') WB.resetLinearChain();
  if (typeof WB.renderWidgetsDOM === 'function') WB.renderWidgetsDOM();
  if (typeof WB.updateCameraUI === 'function') WB.updateCameraUI();
  WB.history = [JSON.stringify(WB.state)];
  WB.historyStep = 0;
  WB.saveToStorage();
  WB.renderPagesDropdown();
  WB.updateUndoRedoButtons();
  if (!(opts && opts.silentSync) && typeof WB.broadcastPeerViewport === 'function') {
    WB.broadcastPeerViewport(true);
  }
};

WB.addPage = function(customName) {
  WB.syncCurrentPage();
  const input = document.getElementById('newPageNameInput');
  const rawName = customName !== undefined ? customName : (input ? input.value : '');
  const nextNum = (WB.pages?.length || 0) + 1;
  const name = String(rawName || '').trim() || `Страница ${nextNum}`;
  if (input && customName === undefined) input.value = '';

  const newPage = {
    id: 'page_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    name,
    strokes: [],
    widgets: [],
    cam: { x: 0, y: 0, z: 1 }
  };
  WB.pages.push(newPage);
  WB.switchPage(WB.pages.length - 1);
  if (typeof WB.broadcastBoardPageEvent === 'function') {
    WB.broadcastBoardPageEvent('board_page_add', { page: newPage });
  }
  if (typeof WB.syncDiffBaselineFromCurrentState === 'function') WB.syncDiffBaselineFromCurrentState();
  if (typeof WB.scheduleRoomServerPush === 'function') WB.scheduleRoomServerPush(1000);
  if (typeof WB.showToast === 'function') {
    WB.showToast(`📄 Добавлена «${name}»`);
  }
};

WB.renamePage = function(index, newName) {
  if (!Array.isArray(WB.pages) || !WB.pages[index]) return;
  const currentName = WB.pages[index].name || `Страница ${index + 1}`;
  let finalName = newName;
  if (finalName === undefined) {
    const row = document.querySelector(`.page-row-item[data-page-idx="${index}"]`);
    if (row) {
      const nameSpan = row.querySelector('.page-row-name');
      if (nameSpan) {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'page-inline-rename';
        inp.value = currentName;
        nameSpan.replaceWith(inp);
        inp.focus();
        inp.select();
        const commit = () => {
          const val = inp.value.trim() || currentName;
          WB.pages[index].name = val;
          WB.saveToStorage();
          WB.renderPagesDropdown();
          if (typeof WB.broadcastPagesMeta === 'function') WB.broadcastPagesMeta();
        };
        inp.addEventListener('blur', commit);
        inp.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); }
          if (ev.key === 'Escape') { inp.value = currentName; inp.blur(); }
        });
        return;
      }
    }
    return;
  }
  const clean = String(finalName || '').trim();
  if (!clean) return;
  WB.pages[index].name = clean;
  WB.saveToStorage();
  WB.renderPagesDropdown();
  if (typeof WB.broadcastPagesMeta === 'function') WB.broadcastPagesMeta();
};

WB.deletePage = function(index) {
  if (!Array.isArray(WB.pages) || WB.pages.length <= 1) {
    if (typeof WB.showToast === 'function') {
      WB.showToast('ℹ️ На доске должна оставаться хотя бы одна страница');
    }
    return;
  }
  if (!WB.pages[index]) return;
  WB.syncCurrentPage();
  const removedPage = WB.pages[index];
  const removedName = removedPage.name || `Страница ${index + 1}`;
  const removedId = removedPage.id || '';
  const prevIdx = WB.currentPageIndex;
  WB.pages.splice(index, 1);

  let nextIdx = prevIdx;
  if (index < prevIdx) {
    nextIdx = Math.max(0, prevIdx - 1);
  } else if (index === prevIdx) {
    nextIdx = Math.max(0, Math.min(index, WB.pages.length - 1));
  } else {
    nextIdx = Math.max(0, Math.min(prevIdx, WB.pages.length - 1));
  }

  WB.currentPageIndex = nextIdx;
  const target = WB.pages[nextIdx];
  WB.state = {
    strokes: Array.isArray(target.strokes) ? target.strokes : [],
    widgets: Array.isArray(target.widgets) ? target.widgets : []
  };
  target.strokes = WB.state.strokes;
  target.widgets = WB.state.widgets;
  if (target.cam) {
    WB.cam = {
      x: Number(target.cam.x) || 0,
      y: Number(target.cam.y) || 0,
      z: Number(target.cam.z) || 1
    };
  }
  if (typeof WB.clearSelection === 'function') WB.clearSelection();
  if (typeof WB.resetLinearChain === 'function') WB.resetLinearChain();
  if (typeof WB.renderWidgetsDOM === 'function') WB.renderWidgetsDOM();
  if (typeof WB.updateCameraUI === 'function') WB.updateCameraUI();
  WB.history = [JSON.stringify(WB.state)];
  WB.historyStep = 0;
  WB.saveToStorage();
  WB.renderPagesDropdown();
  WB.updateUndoRedoButtons();
  if (typeof WB.broadcastBoardPageEvent === 'function') {
    WB.broadcastBoardPageEvent('board_page_delete', { pageId: removedId, index });
  }
  if (typeof WB.syncDiffBaselineFromCurrentState === 'function') WB.syncDiffBaselineFromCurrentState();
  if (typeof WB.scheduleRoomServerPush === 'function') WB.scheduleRoomServerPush(1000);
  if (typeof WB.broadcastPeerViewport === 'function') WB.broadcastPeerViewport(true);
  if (typeof WB.showToast === 'function') {
    WB.showToast(`🗑️ Удалена «${removedName}»`);
  }
};

WB.renderPagesDropdown = function() {
  const listEl = document.getElementById('pagesListContainer');
  const badgeEl = document.getElementById('pagesHeaderBadge');
  if (badgeEl && Array.isArray(WB.pages)) {
    const total = WB.pages.length;
    if (total > 1) {
      badgeEl.textContent = `${WB.currentPageIndex + 1}/${total}`;
      badgeEl.style.display = 'inline-flex';
    } else {
      badgeEl.style.display = 'none';
    }
  }
  if (!listEl || !Array.isArray(WB.pages)) return;

  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const canDelete = WB.pages.length > 1;
  listEl.innerHTML = WB.pages.map((p, idx) => {
    const active = idx === WB.currentPageIndex ? 'active' : '';
    const pageName = p.name || ('Страница ' + (idx + 1));
    return `
      <div class="page-row-item ${active}" data-page-idx="${idx}" onclick="WB.switchPage(${idx})">
        <span class="page-row-num">${idx + 1}</span>
        <span class="page-row-name">${esc(pageName)}</span>
        <div class="page-row-actions" onclick="event.stopPropagation()">
          <button type="button" class="page-act-btn rename" onclick="WB.renamePage(${idx})" title="Переименовать страницу" aria-label="Переименовать ${esc(pageName)}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
          </button>
          <button type="button" class="page-act-btn delete danger" ${canDelete ? '' : 'disabled'} onclick="WB.deletePage(${idx})" title="${canDelete ? 'Удалить страницу' : 'Должна остаться хотя бы одна страница'}" aria-label="Удалить ${esc(pageName)}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  if (typeof WB.repositionOpenHeaderPopovers === 'function') {
    WB.repositionOpenHeaderPopovers();
  }
};

WB.savePrevCamera = function() {
  if (typeof WB.getMyViewportSnapshot === 'function') {
    WB.prevCam = WB.getMyViewportSnapshot();
  } else {
    WB.prevCam = {
      pageIndex: WB.currentPageIndex || 0,
      cam: { x: WB.cam.x, y: WB.cam.y, z: WB.cam.z },
      pdfView: { isOpen: false }
    };
  }
  if (typeof WB.updateReturnPrevSpotUI === 'function') WB.updateReturnPrevSpotUI();
};

WB.returnToPrevPlace = function() {
  if (!WB.prevCam) {
    return;
  }
  const current = typeof WB.getMyViewportSnapshot === 'function'
    ? WB.getMyViewportSnapshot()
    : { pageIndex: WB.currentPageIndex || 0, cam: { x: WB.cam.x, y: WB.cam.y, z: WB.cam.z }, pdfView: { isOpen: false } };
  const target = WB.prevCam;
  WB.prevCam = current;

  if (typeof WB.applyRemoteViewportSnapshot === 'function' && (target.cam || target.pdfView)) {
    WB.applyRemoteViewportSnapshot(target, null, { savePrev: false });
  } else {
    if (WB.pdfEditor && WB.pdfEditor.isOpen && typeof WB.closePdfEditor === 'function') {
      WB.closePdfEditor();
    }
    const c = target.cam || target;
    WB.cam = { x: Number(c.x) || 0, y: Number(c.y) || 0, z: Number(c.z) || 1 };
    if (typeof WB.updateCameraUI === 'function') WB.updateCameraUI();
  }
  if (typeof WB.updateReturnPrevSpotUI === 'function') WB.updateReturnPrevSpotUI();
};

WB.updateUndoRedoButtons = function() {
  const undoBtn = document.getElementById('undoTopBtn');
  const redoBtn = document.getElementById('redoTopBtn');
  const canUndo = WB.historyStep > 0;
  const canRedo = WB.historyStep >= 0 && WB.historyStep < WB.history.length - 1;
  if (undoBtn) {
    undoBtn.disabled = !canUndo;
    undoBtn.setAttribute('aria-disabled', String(!canUndo));
  }
  if (redoBtn) {
    redoBtn.disabled = !canRedo;
    redoBtn.setAttribute('aria-disabled', String(!canRedo));
  }
};

WB.saveHistory = function() {
  WB.syncCurrentPage();
  const snapshot = JSON.stringify(WB.state);
  if (WB.historyStep >= 0 && WB.history[WB.historyStep] === snapshot) {
    WB.updateUndoRedoButtons();
    return;
  }
  WB.history = WB.history.slice(0, Math.max(0, WB.historyStep + 1));
  WB.history.push(snapshot);
  while (WB.history.length > 50) {
    WB.history.shift();
  }
  WB.historyStep = WB.history.length - 1;
  WB.saveToStorage();
  WB.updateUndoRedoButtons();
};

WB.undo = function() {
  if (WB.historyStep > 0) {
    WB.historyStep--;
    WB.state = JSON.parse(WB.history[WB.historyStep]);
    WB.syncCurrentPage();
    WB.clearSelection();
    if (typeof WB.resetLinearChain === 'function') WB.resetLinearChain();
    WB.renderWidgetsDOM();
    WB.saveToStorage();
    WB.updateUndoRedoButtons();
  }
};

WB.redo = function() {
  if (WB.historyStep < WB.history.length - 1) {
    WB.historyStep++;
    WB.state = JSON.parse(WB.history[WB.historyStep]);
    WB.syncCurrentPage();
    WB.clearSelection();
    if (typeof WB.resetLinearChain === 'function') WB.resetLinearChain();
    WB.renderWidgetsDOM();
    WB.saveToStorage();
    WB.updateUndoRedoButtons();
  }
};

WB.saveToStorage = function() {
  try {
    WB.syncCurrentPage();
    localStorage.setItem('whiteboard_pro_v2', JSON.stringify(WB.state));
    localStorage.setItem('whiteboard_pro_pages_v11', JSON.stringify({
      currentPageIndex: WB.currentPageIndex,
      pages: WB.pages
    }));
  } catch (e) {}
};

WB._storageSaveTimer = null;
WB.scheduleSaveToStorage = function(delayMs = 650) {
  if (WB._storageSaveTimer) clearTimeout(WB._storageSaveTimer);
  WB._storageSaveTimer = setTimeout(() => {
    WB._storageSaveTimer = null;
    WB.saveToStorage();
  }, delayMs);
};

WB.loadFromStorage = function() {
  try {
    const pagesRaw = localStorage.getItem('whiteboard_pro_pages_v11');
    if (pagesRaw) {
      const parsedPages = JSON.parse(pagesRaw);
      if (Array.isArray(parsedPages.pages) && parsedPages.pages.length > 0) {
        WB.pages = parsedPages.pages;
        WB.currentPageIndex = Math.max(0, Math.min(Number(parsedPages.currentPageIndex) || 0, WB.pages.length - 1));
        const active = WB.pages[WB.currentPageIndex];
        WB.state.strokes = Array.isArray(active.strokes) ? active.strokes : [];
        WB.state.widgets = Array.isArray(active.widgets) ? active.widgets : [];
        active.strokes = WB.state.strokes;
        active.widgets = WB.state.widgets;
        WB.renderWidgetsDOM();
        WB.renderPagesDropdown();
        return;
      }
    }
    const raw = localStorage.getItem('whiteboard_pro_v2');
    if (raw) {
      const parsed = JSON.parse(raw);
      WB.state.strokes = Array.isArray(parsed.strokes) ? parsed.strokes : [];
      WB.state.widgets = Array.isArray(parsed.widgets) ? parsed.widgets : [];
      WB.syncCurrentPage();
      WB.renderWidgetsDOM();
      WB.renderPagesDropdown();
    } else {
      WB.renderPagesDropdown();
    }
  } catch (e) {
    WB.state = { strokes: [], widgets: [] };
    WB.syncCurrentPage();
  }
};
