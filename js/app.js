window.WB = window.WB || {};

WB.autoShapeEnabled = false;

let isSpacePressed = false;
let isPointerDown = false;
let isPanning = false;
let isTouchGesture = false;
let lastTouchMid = { x: 0, y: 0 };
let lastTouchDist = 0;
let lastTapTime = 0;
let lastTapWorld = { x: 0, y: 0 };
let panStart = { x: 0, y: 0 };
let currentStroke = null;
let shapeHoldTimer = null;

// Состояние мультитача (Pointer Events), защиты от ладони (стилус) и отката первого пальца
const activeTouchPointers = new Map();
let activePrimaryPointerId = null;
let isPenDown = false;
let lastPenActiveMs = 0;
let touchFirstActionRollback = null;
WB._isTouchGestureActive = false;
WB._activeWidgetTouchCancel = null;

// Режимы выделителя: 'none' | 'marquee' | 'drag-selection' | 'scale-selection' | 'drag-vertex'
let selectMode = 'none';
let dragLastWorld = { x: 0, y: 0 };
let scaleSnapshot = null;
let activeVertexHit = null;
let lastEraseWorld = { x: 0, y: 0 };

WB._TOAST_ICONS = {
  info: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  success: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  warning: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  error: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
};

WB.hideToast = function() {
  const banner = document.getElementById('toastBanner');
  if (!banner) return;
  clearTimeout(banner._hideTimer);
  clearTimeout(banner._cleanupTimer);
  banner.classList.remove('is-visible');
  banner._cleanupTimer = setTimeout(() => {
    if (!banner.classList.contains('is-visible')) {
      banner.style.display = 'none';
    }
  }, 200);
};

WB.showToast = function(msg, duration = 2400, variant = '') {
  const banner = document.getElementById('toastBanner');
  if (!banner) return;

  const rawText = String(msg || '').trim();
  if (!rawText) return;

  // Автоматически определяем семантический тип и убираем разнородные эмодзи-префиксы
  let resolvedVariant = variant;
  if (!resolvedVariant) {
    if (/^(✅|💾|📂|🖼️)/.test(rawText)) resolvedVariant = 'success';
    else if (/^(⚠️|❌)/.test(rawText) || /ошибка|не удалось|неверный формат/i.test(rawText)) resolvedVariant = 'error';
    else if (/^(🔒|🔓)/.test(rawText) || /запретил|заблокирован/i.test(rawText)) resolvedVariant = 'warning';
    else resolvedVariant = 'info';
  }
  if (!WB._TOAST_ICONS[resolvedVariant]) resolvedVariant = 'info';

  const cleanText = rawText.replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F\u200D]+\s*/u, '').trim() || rawText;

  banner.classList.remove('toast-info', 'toast-success', 'toast-warning', 'toast-error');
  banner.classList.add('toast-' + resolvedVariant);

  const iconEl = document.getElementById('toastIcon');
  const textEl = document.getElementById('toastText');
  if (iconEl) iconEl.innerHTML = WB._TOAST_ICONS[resolvedVariant];
  if (textEl) textEl.textContent = cleanText;
  else banner.textContent = cleanText;

  clearTimeout(banner._hideTimer);
  clearTimeout(banner._cleanupTimer);
  banner.style.display = 'inline-flex';
  // Перезапускаем плавное появление
  banner.classList.remove('is-visible');
  void banner.offsetWidth;
  banner.classList.add('is-visible');

  const safeDuration = Math.max(1200, Number(duration) || 2400);
  banner._hideTimer = setTimeout(() => {
    WB.hideToast();
  }, safeDuration);
};

WB._confirmCallback = null;
WB.openConfirmModal = function(opts = {}) {
  const modal = document.getElementById('confirmActionModal');
  if (!modal) {
    if (typeof opts.onConfirm === 'function') opts.onConfirm();
    return;
  }
  const titleEl = document.getElementById('confirmActionTitle');
  const msgEl = document.getElementById('confirmActionMessage');
  const acceptBtn = document.getElementById('confirmActionAcceptBtn');
  if (titleEl) titleEl.textContent = opts.title || 'Подтвердите действие';
  if (msgEl) msgEl.textContent = opts.message || 'Вы уверены?';
  if (acceptBtn) acceptBtn.textContent = opts.confirmLabel || 'Подтвердить';
  WB._confirmCallback = typeof opts.onConfirm === 'function' ? opts.onConfirm : null;
  modal.style.display = 'flex';
  if (acceptBtn) setTimeout(() => acceptBtn.focus(), 30);
};

WB.closeConfirmModal = function() {
  const modal = document.getElementById('confirmActionModal');
  if (modal) modal.style.display = 'none';
  WB._confirmCallback = null;
};

WB.acceptConfirmModal = function() {
  const fn = WB._confirmCallback;
  WB.closeConfirmModal();
  if (typeof fn === 'function') fn();
};

WB.openShortcutsModal = function() {
  const modal = document.getElementById('shortcutsModal');
  if (!modal) return;
  WB.closeAllDropdowns();
  modal.style.display = 'flex';
};

WB.closeShortcutsModal = function() {
  const modal = document.getElementById('shortcutsModal');
  if (modal) modal.style.display = 'none';
};

// Управление выпадающими меню (с переносом в body для защиты от обрезания на мобильных экранах)
WB.toggleDropdown = function(menuId, event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById(menuId);
  if (!menu) return;
  const wasOpen = menu.classList.contains('open');
  WB.closeAllDropdowns();
  if (wasOpen) return;

  const trigger = event?.currentTarget || document.querySelector(`[onclick*="'${menuId}'"]`);
  if (menu.parentElement !== document.body) {
    document.body.appendChild(menu);
  }
  menu.classList.add('open');
  menu.style.position = 'fixed';
  menu.style.zIndex = '180';

  if (trigger && typeof trigger.getBoundingClientRect === 'function') {
    const tr = trigger.getBoundingClientRect();
    const mw = menu.offsetWidth || 245;
    const mh = menu.offsetHeight || 220;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const isDropUp = menu.classList.contains('drop-up');

    let left = tr.left;
    if (left + mw > vw - 10) left = vw - mw - 10;
    if (left < 10) left = 10;
    menu.style.left = Math.round(left) + 'px';
    menu.style.right = 'auto';

    if (isDropUp) {
      const bottom = Math.max(10, vh - tr.top + 8);
      menu.style.top = 'auto';
      menu.style.bottom = Math.round(bottom) + 'px';
      menu.style.maxHeight = Math.max(160, Math.round(tr.top - 64)) + 'px';
      menu.style.overflowY = 'auto';
    } else {
      const maxH = Math.max(160, Math.round(vh - tr.bottom - 18));
      const top = Math.min(vh - Math.min(mh, maxH) - 10, tr.bottom + 8);
      menu.style.bottom = 'auto';
      menu.style.top = Math.round(Math.max(10, top)) + 'px';
      menu.style.maxHeight = maxH + 'px';
      menu.style.overflowY = 'auto';
    }
  }
};

WB.getLineStylePreviewSvg = function(style) {
  if (style === 'dashed') {
    return '<svg width="24" height="10" viewBox="0 0 24 10" fill="none"><line x1="1.5" y1="5" x2="6" y2="5" stroke="currentColor" stroke-width="2.2"/><line x1="9" y1="5" x2="13.5" y2="5" stroke="currentColor" stroke-width="2.2"/><line x1="16.5" y1="5" x2="21.5" y2="5" stroke="currentColor" stroke-width="2.2"/></svg>';
  }
  if (style === 'dotted') {
    return '<svg width="24" height="10" viewBox="0 0 24 10" fill="none"><rect x="2" y="3.8" width="2.4" height="2.4" fill="currentColor"/><rect x="7" y="3.8" width="2.4" height="2.4" fill="currentColor"/><rect x="12" y="3.8" width="2.4" height="2.4" fill="currentColor"/><rect x="17" y="3.8" width="2.4" height="2.4" fill="currentColor"/><rect x="21.2" y="3.8" width="2.2" height="2.4" fill="currentColor"/></svg>';
  }
  if (style === 'dashdot') {
    return '<svg width="24" height="10" viewBox="0 0 24 10" fill="none"><line x1="1.5" y1="5" x2="7.5" y2="5" stroke="currentColor" stroke-width="2.2"/><rect x="10.2" y="3.8" width="2.4" height="2.4" fill="currentColor"/><line x1="15.5" y1="5" x2="22" y2="5" stroke="currentColor" stroke-width="2.2"/></svg>';
  }
  return '<svg width="24" height="10" viewBox="0 0 24 10" fill="none"><line x1="2" y1="5" x2="22" y2="5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
};

WB.positionHeaderPopover = function(popoverEl, triggerEl, opts = {}) {
  if (!popoverEl) return;
  if (popoverEl.parentElement !== document.body) {
    document.body.appendChild(popoverEl);
  }
  popoverEl.style.position = 'fixed';
  popoverEl.style.zIndex = String(opts.zIndex || 185);
  popoverEl.style.right = 'auto';
  popoverEl.style.bottom = 'auto';

  const anchor = triggerEl && typeof triggerEl.getBoundingClientRect === 'function' ? triggerEl : null;
  if (!anchor) return;

  const tr = anchor.getBoundingClientRect();
  const pw = popoverEl.offsetWidth || opts.fallbackWidth || 300;
  const ph = popoverEl.offsetHeight || opts.fallbackHeight || 220;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = opts.margin ?? 10;
  const gap = opts.gap ?? 8;
  const align = opts.align || 'right';

  let left = align === 'right' ? (tr.right - pw) : tr.left;
  if (left + pw > vw - margin) left = vw - pw - margin;
  if (left < margin) left = margin;

  let top = tr.bottom + gap;
  if (top + ph > vh - margin) {
    top = Math.max(margin, vh - ph - margin);
  }
  if (top < margin) top = margin;

  popoverEl.style.left = Math.round(left) + 'px';
  popoverEl.style.top = Math.round(top) + 'px';
};

WB.repositionOpenHeaderPopovers = function() {
  const peersDd = document.getElementById('peersDropdown');
  if (peersDd && peersDd.classList.contains('open')) {
    const trigger = document.querySelector('.peers-wrap') || document.querySelector('.peers-chevron-btn');
    WB.positionHeaderPopover(peersDd, trigger, { align: 'right', fallbackWidth: 344, fallbackHeight: 220 });
  }
  const pagesDd = document.getElementById('pagesDropdown');
  if (pagesDd && pagesDd.classList.contains('open')) {
    const trigger = document.getElementById('pagesMenuBtn');
    WB.positionHeaderPopover(pagesDd, trigger, { align: 'right', fallbackWidth: 295, fallbackHeight: 230 });
  }
};

WB.closeAllDropdowns = function() {
  document.querySelectorAll('.dropdown-menu.open, #peersDropdown.open, #pagesDropdown.open, #pdfThumbsPopover.open, #pdfAddPagePopover.open, .s2d-popover.open').forEach(m => m.classList.remove('open'));
  document.getElementById('pagesMenuBtn')?.setAttribute('aria-expanded', 'false');
  document.querySelector('.peers-chevron-btn')?.setAttribute('aria-expanded', 'false');
  const sbWrap = document.getElementById('styleBlockWrap');
  if (sbWrap) {
    sbWrap.classList.remove('expanded');
    document.getElementById('styleCompactToggle')?.setAttribute('aria-expanded', 'false');
  }
  const pdfSbWrap = document.getElementById('pdfStyleBlockWrap');
  if (pdfSbWrap) {
    pdfSbWrap.classList.remove('expanded');
    document.getElementById('pdfStyleCompactToggle')?.setAttribute('aria-expanded', 'false');
  }
  if (WB.collab && WB.collab.editingPeerId) {
    WB.collab.editingPeerId = null;
  }
  document.body.classList.remove('mobile-style-open');
};

WB.toggleDockCollapsed = function() {
  document.body.classList.toggle('dock-collapsed');
  if (typeof WB.sync3DFloatingUI === 'function') WB.sync3DFloatingUI();
  if (typeof WB.sync2DFloatingUI === 'function') WB.sync2DFloatingUI();
};

WB.syncStyleSummaryUI = function() {
  const colorPicker = document.getElementById('colorPicker');
  const sizePicker = document.getElementById('sizePicker');
  const lineEl = document.getElementById('styleSummaryLinePreview');
  const dot = document.getElementById('styleSummaryColorDot');
  const sizeLbl = document.getElementById('styleSummarySize');
  const style = WB.currentLineStyle || 'solid';
  if (lineEl) lineEl.innerHTML = WB.getLineStylePreviewSvg(style);
  if (dot && colorPicker) dot.style.background = colorPicker.value || '#1e293b';
  if (sizeLbl && sizePicker) sizeLbl.textContent = `${sizePicker.value || 4}px`;
};
WB.syncMobileStyleBadge = WB.syncStyleSummaryUI;

WB.toggleStyleBlock = function(event) {
  if (event) event.stopPropagation();
  const wrap = document.getElementById('styleBlockWrap');
  if (!wrap) return;
  const willExpand = !wrap.classList.contains('expanded');
  WB.closeAllDropdowns();
  if (willExpand) {
    wrap.classList.add('expanded');
    document.getElementById('styleCompactToggle')?.setAttribute('aria-expanded', 'true');
  }
};
WB.toggleMobileStylePopover = WB.toggleStyleBlock;

WB.togglePagesDropdown = function(event) {
  if (event) event.stopPropagation();
  const dd = document.getElementById('pagesDropdown');
  if (!dd) return;
  const wasOpen = dd.classList.contains('open');
  WB.closeAllDropdowns();
  if (!wasOpen) {
    if (typeof WB.renderPagesDropdown === 'function') WB.renderPagesDropdown();
    dd.classList.add('open');
    const trigger = document.getElementById('pagesMenuBtn') || event?.currentTarget;
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    WB.positionHeaderPopover(dd, trigger, { align: 'right', fallbackWidth: 295, fallbackHeight: 230 });
  }
};

WB.setShapeDrawOrigin = function(fromCenter, event) {
  if (event) event.stopPropagation();
  WB.shapeDrawFromCenter = !!fromCenter;
  const boxBtn = document.getElementById('shapeOriginBoxBtn');
  const centerBtn = document.getElementById('shapeOriginCenterBtn');
  if (boxBtn) boxBtn.classList.toggle('active', !WB.shapeDrawFromCenter);
  if (centerBtn) centerBtn.classList.toggle('active', WB.shapeDrawFromCenter);
};

WB.togglePeersDropdown = function(event) {
  if (event) event.stopPropagation();
  const dd = document.getElementById('peersDropdown');
  if (!dd) return;
  const wasOpen = dd.classList.contains('open');
  WB.closeAllDropdowns();
  if (!wasOpen) {
    if (typeof WB.renderPeersAvatarBar === 'function') WB.renderPeersAvatarBar();
    dd.classList.add('open');
    const trigger = document.querySelector('.peers-wrap') || event?.currentTarget;
    document.querySelector('.peers-chevron-btn')?.setAttribute('aria-expanded', 'true');
    WB.positionHeaderPopover(dd, trigger, { align: 'right', fallbackWidth: 374, fallbackHeight: 220 });
  }
};

WB.closeAllModals = function() {
  if (typeof WB.closePdfEditor === 'function') WB.closePdfEditor();
  if (typeof WB.closePhysicsModal === 'function') WB.closePhysicsModal();
  if (typeof WB.closeLatexModal === 'function') WB.closeLatexModal();
  if (typeof WB.closeStudentInviteModal === 'function') WB.closeStudentInviteModal();
  if (typeof WB.closeSearchModal === 'function') WB.closeSearchModal();
  if (typeof WB.closeConfirmModal === 'function') WB.closeConfirmModal();
  if (typeof WB.closeShortcutsModal === 'function') WB.closeShortcutsModal();
  if (typeof WB.toggleShareModal === 'function') WB.toggleShareModal(false);
};

window.addEventListener('click', (e) => {
  const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
  if (path.some(el => el && (el.id === 'peersDropdown' || el.id === 'pagesDropdown' || el.id === 'pdfThumbsPopover' || el.id === 'pdfAddPagePopover' || el.id === 'shapesMenu' || el.id === 'eraserMenu' || el.id === 'styleBlockWrap' || el.id === 'pdfStyleBlockWrap'))) return;
  if (e.target && e.target.closest && (e.target.closest('#peersDropdown') || e.target.closest('#pagesDropdown') || e.target.closest('#pdfThumbsPopover') || e.target.closest('#pdfAddPageWrap') || e.target.closest('#pdfAddPagePopover') || e.target.closest('.pdf-insert-between-btn') || e.target.closest('.pdf-insert-side-btn') || e.target.closest('#shapesMenu') || e.target.closest('#eraserMenu') || e.target.closest('.s2d-pop-anchor') || e.target.closest('#styleBlockWrap') || e.target.closest('#pdfStyleBlockWrap'))) return;
  WB.closeAllDropdowns();
});

window.addEventListener('resize', () => {
  if (typeof WB.repositionOpenHeaderPopovers === 'function') WB.repositionOpenHeaderPopovers();
});

WB.setBoardTitle = function(val) {
  const clean = String(val || '').trim() || 'Новый урок';
  WB.boardTitle = clean;
  try { localStorage.setItem('wb_board_title', clean); } catch (_) {}
};

WB.updateReturnPrevSpotUI = function() {
  const btn = document.getElementById('returnPrevSpotBtn');
  if (!btn) return;
  btn.classList.toggle('has-prev', !!WB.prevCam);
};

WB.fitAllContent = function(silent = false) {
  const bounds = typeof WB.getAllContentBounds === 'function' ? WB.getAllContentBounds() : null;
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) {
    WB.resetCamera();
    if (!silent) WB.showToast('ℹ️ Доска пока пуста — сброс к центру (100%)');
    return;
  }
  if (typeof WB.savePrevCamera === 'function') WB.savePrevCamera();
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 720;
  const padding = vw < 768 ? 48 : 96;
  const availW = Math.max(200, vw - padding * 2);
  const availH = Math.max(160, vh - padding * 2);
  const z = Math.min(2.0, Math.max(0.2, +(Math.min(availW / bounds.w, availH / bounds.h)).toFixed(2)));
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  WB.cam = {
    x: Math.round(vw / 2 - cx * z),
    y: Math.round(vh / 2 - cy * z),
    z
  };
  WB.updateCameraUI();
  if (!silent) WB.showToast('⛶ Показано всё содержимое доски');
};

// --- МОДАЛЬНОЕ ОКНО «НАЙТИ НА ДОСКЕ» (LEARNBOARD STYLE) ---
WB.searchModal = {
  isOpen: false,
  category: 'all',
  query: '',
  selectedIndex: 0
};

WB.getSearchItems = function() {
  const q = String(WB.searchModal.query || '').trim().toLowerCase();
  const catFilter = WB.searchModal.category || 'all';
  const items = [];
  for (const w of WB.state.widgets || []) {
    let category = 'other';
    let title = '';
    let subtitle = '';
    let icon = 'other';

    if (w.isPdf || w.type === 'pdf') {
      category = 'books';
      title = w.pdfTitle || 'Документ PDF';
      subtitle = 'Книга';
      icon = 'book';
    } else if (w.type === 'text' || w.type === 'note') {
      category = 'text';
      title = (w.text || '').replace(/\s+/g, ' ').trim() || (w.type === 'note' ? 'Стикер' : 'Текст');
      subtitle = w.type === 'note' ? 'Стикер' : 'Текст';
      icon = 'text';
    } else if (w.type === 'latex') {
      category = 'other';
      title = w.lawTitle || w.latex || 'Формула';
      subtitle = 'Формула';
      icon = 'formula';
    } else if (w.type === 'table') {
      category = 'other';
      const firstCell = w.tableData?.[0]?.[0] || '';
      title = firstCell ? `Таблица: ${firstCell}` : 'Таблица';
      subtitle = 'Таблица';
      icon = 'table';
    } else if (w.type === 'calculator') {
      category = 'other';
      title = 'Калькулятор ЕГЭ';
      subtitle = 'Виджет';
    } else if (w.type === 'timer') {
      category = 'other';
      title = 'Таймер';
      subtitle = 'Виджет';
    } else if (w.type === 'stopwatch') {
      category = 'other';
      title = 'Секундомер';
      subtitle = 'Виджет';
    } else if (w.type === 'image') {
      category = 'other';
      title = w.pdfTitle || 'Изображение';
      subtitle = 'Картинка';
    } else {
      category = 'other';
      title = w.type || 'Объект';
      subtitle = 'Другое';
    }

    if (catFilter !== 'all' && category !== catFilter) continue;
    if (q) {
      const hay = `${title} ${subtitle} ${w.latex || ''} ${w.text || ''}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    items.push({ id: w.id, title, subtitle, category, icon, x: w.x, y: w.y, w: w.w, h: w.h });
  }
  return items;
};

WB.renderSearchResults = function() {
  const listEl = document.getElementById('searchResultsList');
  const countEl = document.getElementById('searchCountLabel');
  if (!listEl) return;

  document.querySelectorAll('.search-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cat === WB.searchModal.category);
  });

  const items = WB.getSearchItems();
  if (countEl) countEl.textContent = `На этой странице · ${items.length}`;

  if (WB.searchModal.selectedIndex >= items.length) {
    WB.searchModal.selectedIndex = Math.max(0, items.length - 1);
  }

  if (items.length === 0) {
    listEl.innerHTML = `<div class="search-empty-state">Ничего не найдено. Попробуйте изменить запрос или добавьте PDF, текст или стикер на доску.</div>`;
    return;
  }

  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const iconSvg = (kind) => {
    if (kind === 'book') {
      return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>';
    }
    if (kind === 'text') {
      return '<span style="font-weight:700;font-size:14px;">T</span>';
    }
    if (kind === 'formula') {
      return '<span style="font-weight:700;font-size:14px;">∑</span>';
    }
    return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>';
  };

  listEl.innerHTML = items.map((item, idx) => `
    <button type="button" class="search-result-row ${idx === WB.searchModal.selectedIndex ? 'selected' : ''}" data-wid="${esc(item.id)}">
      <span class="search-row-icon">${iconSvg(item.icon)}</span>
      <span class="search-row-text">
        <span class="search-row-title">${esc(item.title)}</span>
        <span class="search-row-sub">${esc(item.subtitle)}</span>
      </span>
      <span class="search-row-arrow">›</span>
    </button>
  `).join('');

  listEl.querySelectorAll('.search-result-row').forEach(btn => {
    btn.addEventListener('click', () => WB.jumpToWidgetById(btn.dataset.wid));
  });
};

WB.openSearchModal = function() {
  WB.closeAllDropdowns();
  const modal = document.getElementById('searchBoardModal');
  const input = document.getElementById('searchBoardInput');
  if (!modal) return;
  WB.searchModal.isOpen = true;
  WB.searchModal.selectedIndex = 0;
  modal.style.display = 'flex';
  WB.renderSearchResults();
  if (input) {
    input.value = WB.searchModal.query || '';
    setTimeout(() => { input.focus(); input.select(); }, 30);
  }
};

WB.closeSearchModal = function() {
  WB.searchModal.isOpen = false;
  const modal = document.getElementById('searchBoardModal');
  if (modal) modal.style.display = 'none';
};

WB.setSearchCategory = function(cat) {
  WB.searchModal.category = cat || 'all';
  WB.searchModal.selectedIndex = 0;
  WB.renderSearchResults();
};

WB.onSearchInput = function(val) {
  WB.searchModal.query = val || '';
  WB.searchModal.selectedIndex = 0;
  WB.renderSearchResults();
};

WB.jumpToWidgetById = function(widgetId) {
  const w = (WB.state.widgets || []).find(item => String(item.id) === String(widgetId));
  if (!w) return;
  if (typeof WB.savePrevCamera === 'function') WB.savePrevCamera();
  const z = Math.max(0.55, Math.min(1.4, WB.cam.z || 1));
  WB.cam = {
    x: Math.round((window.innerWidth || 1280) / 2 - (w.x + w.w / 2) * z),
    y: Math.round((window.innerHeight || 720) / 2 - (w.y + w.h / 2) * z),
    z
  };
  WB.updateCameraUI();
  WB.setTool('select');
  WB.selection.widgetIds.add(w.id);
  WB.updateSelectionBounds();
  WB.closeSearchModal();
  WB.showToast('📍 Переход к объекту на доске');
};

// Переключатель режима построения по узлам клеток (без всплывающих сообщений)
WB.toggleSnapToGrid = function() {
  WB.snapToGridEnabled = !WB.snapToGridEnabled;
  const btn = document.getElementById('snapGridBtn');
  if (btn) {
    btn.classList.toggle('active', WB.snapToGridEnabled);
    btn.classList.toggle('active-green', WB.snapToGridEnabled);
  }

  // Если сетка была выключена — включаем линии сетки для наглядности
  if (WB.snapToGridEnabled && (WB.gridMode === 'grid-none' || document.body.classList.contains('grid-none'))) {
    if (typeof WB.setGridMode === 'function') WB.setGridMode('grid-lines');
  }
};

// Линейный режим (построение линий от точки к точке; выход — кнопка «Линейный» или Enter)
WB.linearChain = {
  anchor: null,
  chainStart: null,
  segmentCount: 0,
  anchorSource: 'none',
  previewEnd: null,
  endSource: 'none'
};

WB.resetLinearChain = function() {
  WB.linearChain = {
    anchor: null,
    chainStart: null,
    segmentCount: 0,
    anchorSource: 'none',
    previewEnd: null,
    endSource: 'none'
  };
  WB.linearSnapState = null;
};

WB.setAutoShape = function(enabled) {
  const next = Boolean(enabled);
  WB.autoShapeEnabled = next;
  WB.resetLinearChain();
  const btn = document.getElementById('autoShapeBtn');
  if (btn) {
    btn.classList.toggle('active', next);
    btn.setAttribute('aria-pressed', next ? 'true' : 'false');
    if (document.activeElement === btn && typeof btn.blur === 'function') {
      btn.blur();
    }
  }
  const canvas = document.getElementById('board');
  if (next) {
    if (typeof WB.clearSelection === 'function') WB.clearSelection();
    if (canvas) canvas.style.cursor = 'crosshair';
  } else if (canvas) {
    canvas.style.cursor = WB.currentTool === 'hand' ? 'grab' : (WB.currentTool === 'select' ? 'default' : 'crosshair');
  }
};

WB.toggleAutoShape = function() {
  WB.setAutoShape(!WB.autoShapeEnabled);
};

// Выбор типа линии (Сплошная, Штриховая, Точечная, Штрихпунктирная)
WB.setLineStyle = function(style) {
  const validStyles = ['solid', 'dashed', 'dotted', 'dashdot'];
  WB.currentLineStyle = validStyles.includes(style) ? style : 'solid';

  document.querySelectorAll('#styleBlock .line-style-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lineStyle === WB.currentLineStyle);
  });
  if (typeof WB.syncStyleSummaryUI === 'function') WB.syncStyleSummaryUI();

  if (WB.selection && WB.selection.strokeIds && WB.selection.strokeIds.size > 0) {
    let changed = false;
    for (const s of WB.state.strokes) {
      if (WB.selection.strokeIds.has(s.id) && !s.locked) {
        s.lineStyle = WB.currentLineStyle;
        changed = true;
      }
    }
    if (changed) WB.saveHistory();
  }
};

// Обработчик кнопки «Ластик» и меню настроек ластика / очистки страницы
WB.handleEraserBtnClick = function(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('eraserMenu');
  const isPdfOpen = !!(WB.pdfEditor && WB.pdfEditor.isOpen);
  const wasEraser = isPdfOpen ? (WB.pdfEditor.tool === 'eraser') : (WB.currentTool === 'eraser');
  const wasMenuOpen = menu && menu.classList.contains('open');

  WB.setTool('eraser');
  if (!wasEraser || !wasMenuOpen) {
    WB.toggleDropdown('eraserMenu', event);
  }
};

WB.setEraserTarget = function(target) {
  WB.eraserConfig = WB.eraserConfig || { target: 'pen_and_highlighter', wholeStroke: false };
  WB.eraserConfig.target = target;

  const map = {
    pen_and_highlighter: 'eraserTargetPenHighlighter',
    highlighter_only: 'eraserTargetHighlighter',
    pen_only: 'eraserTargetPen',
    all: 'eraserTargetAll'
  };
  Object.entries(map).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', key === target);
  });
  const isPdfOpen = !!(WB.pdfEditor && WB.pdfEditor.isOpen);
  const isCurrentlyEraser = isPdfOpen ? (WB.pdfEditor.tool === 'eraser') : (WB.currentTool === 'eraser');
  if (!isCurrentlyEraser) {
    WB.setTool('eraser');
  }
};

WB.toggleEraseWholeStroke = function(checked) {
  WB.eraserConfig = WB.eraserConfig || { target: 'pen_and_highlighter', wholeStroke: false };
  WB.eraserConfig.wholeStroke = !!checked;
};

WB.clearPageStrokes = function(kind) {
  if (WB.userRole === 'student' && (kind === 'teacher' || kind === 'all_strokes')) {
    if (typeof WB.showToast === 'function') WB.showToast('ℹ️ Очищать чужие штрихи может только преподаватель', 2400);
    return;
  }
  if (WB.pdfEditor && WB.pdfEditor.isOpen && typeof WB.clearCurrentPdfPageStrokes === 'function') {
    WB.clearCurrentPdfPageStrokes(kind);
    return;
  }
  if (!WB.state || !Array.isArray(WB.state.strokes)) return;
  const beforeCount = WB.state.strokes.length;

  if (kind === 'all_strokes') {
    WB.state.strokes = [];
  } else if (kind === 'highlighter') {
    WB.state.strokes = WB.state.strokes.filter(s => !(s.isHighlighter || s.type === 'highlighter'));
  } else if (kind === 'student') {
    WB.state.strokes = WB.state.strokes.filter(s => s.authorRole !== 'student');
  } else if (kind === 'teacher') {
    WB.state.strokes = WB.state.strokes.filter(s => (s.authorRole || 'teacher') !== 'teacher');
  }

  WB.clearSelection();
  WB.closeAllDropdowns();
  if (WB.state.strokes.length !== beforeCount) {
    WB.saveHistory();
  }
};

// Живое обновление толщины
WB.updateSizeUI = function(val) {
  const label = document.getElementById('sizeValueLabel');
  if (label) label.textContent = val + 'px';
  if (typeof WB.syncMobileStyleBadge === 'function') WB.syncMobileStyleBadge();

  if (WB.selection.strokeIds.size > 0) {
    const newSize = Number(val);
    let changed = false;
    for (const s of WB.state.strokes) {
      if (WB.selection.strokeIds.has(s.id) && !s.locked) {
        s.size = newSize;
        changed = true;
      }
    }
    if (changed) {
      WB.updateSelectionBounds();
      WB.saveToStorage();
    }
  }
};

WB.showZoomHud = function(zoomRatio) {
  const hud = document.getElementById('zoomToastHud');
  if (!hud) return;
  const pct = Math.max(10, Math.round((Number(zoomRatio) || 1) * 100));
  hud.textContent = pct + '%';
  hud.classList.add('is-visible');
  hud.setAttribute('aria-hidden', 'false');
  clearTimeout(hud._hideTimer);
  hud._hideTimer = setTimeout(() => {
    hud.classList.remove('is-visible');
    hud.setAttribute('aria-hidden', 'true');
  }, 900);
};

WB.updateCameraUI = function() {
  const worldLayer = document.getElementById('world-layer');
  const zoomLabel = document.getElementById('zoomLabel');
  if (worldLayer) worldLayer.style.transform = `translate(${WB.cam.x}px, ${WB.cam.y}px) scale(${WB.cam.z})`;
  if (zoomLabel) zoomLabel.textContent = Math.round(WB.cam.z * 100) + '%';
  if (typeof WB.sync3DFloatingUI === 'function') WB.sync3DFloatingUI();
  if (typeof WB.sync2DFloatingUI === 'function') WB.sync2DFloatingUI();
};

WB.changeZoom = function(delta, centerX = window.innerWidth / 2, centerY = window.innerHeight / 2) {
  const oldZ = WB.cam.z;
  WB.cam.z = Math.min(4, Math.max(0.2, +(WB.cam.z + delta).toFixed(2)));
  WB.cam.x = centerX - (centerX - WB.cam.x) * (WB.cam.z / oldZ);
  WB.cam.y = centerY - (centerY - WB.cam.y) * (WB.cam.z / oldZ);
  WB.updateCameraUI();
  WB.showZoomHud(WB.cam.z);
};

WB.resetCamera = function() {
  WB.cam = { x: 0, y: 0, z: 1 };
  WB.updateCameraUI();
  WB.showZoomHud(WB.cam.z);
};

WB.setTool = function(tool) {
  if (WB.pdfEditor && WB.pdfEditor.isOpen && typeof WB.setPdfEditorTool === 'function') {
    WB.closeAllDropdowns();
    WB.setPdfEditorTool(tool === 'pen' ? 'draw' : tool);
    return;
  }
  WB.currentTool = tool;
  if (tool !== 'select') WB.clearSelection();
  WB.closeAllDropdowns();

  document.body.classList.toggle('select-mode', tool === 'select');

  document.querySelectorAll('.toolbar .tool-btn').forEach(b => {
    if (b.id !== 'autoShapeBtn' && b.id !== 'snapGridBtn') {
      b.classList.remove('active');
    }
  });
  const btn = document.getElementById(tool + 'Btn');
  if (btn) btn.classList.add('active');

  const shapeLabels = {
    rect: 'Прямоуг.',
    square: 'Квадрат',
    ellipse: 'Эллипс',
    circle: 'Круг',
    unit_circle: 'Триг. круг',
    triangle: 'Треуг.',
    rhombus: 'Ромб',
    parallelogram: 'Паралл.',
    trapezoid: 'Трапеция',
    pentagon: '5-угольник',
    hexagon: '6-угольник',
    cube: 'Куб',
    parallelepiped: 'Паралл-д',
    prism: 'Призма',
    pyramid: 'Пирамида',
    tetrahedron: 'Тетраэдр',
    cylinder: 'Цилиндр',
    cone: 'Конус',
    sphere: 'Сфера',
    line: 'Линия',
    arrow: 'Стрелка',
    axes: 'Оси'
  };

  const shapesMenuBtn = document.getElementById('shapesMenuBtn');
  const shapesMenuBtnLabel = document.getElementById('shapesMenuBtnLabel');
  if (shapesMenuBtn) {
    if (shapeLabels[tool]) {
      if (shapesMenuBtnLabel) shapesMenuBtnLabel.textContent = shapeLabels[tool];
      shapesMenuBtn.classList.add('active');
    } else {
      if (shapesMenuBtnLabel) shapesMenuBtnLabel.textContent = 'Фигуры';
    }
  }

  const canvas = document.getElementById('board');
  if (canvas) {
    if (WB.autoShapeEnabled) {
      canvas.style.cursor = 'crosshair';
    } else {
      canvas.style.cursor = tool === 'hand' ? 'grab' : (tool === 'select' ? 'default' : 'crosshair');
    }
  }
};

WB.selectColor = function(color, el) {
  const picker = document.getElementById('colorPicker');
  if (picker) picker.value = color;
  document.querySelectorAll('#styleBlock .color-swatch').forEach(s => s.classList.remove('active'));
  if (el) el.classList.add('active');
  if (typeof WB.syncStyleSummaryUI === 'function') WB.syncStyleSummaryUI();

  if (WB.selection.strokeIds.size > 0) {
    let changed = false;
    for (const s of WB.state.strokes) {
      if (WB.selection.strokeIds.has(s.id) && !s.locked) {
        s.color = color;
        changed = true;
      }
    }
    if (changed) {
      WB.saveHistory();
      if (typeof WB.sync2DFloatingUI === 'function') WB.sync2DFloatingUI();
    }
  }
};

WB.applyTheme = function(isDark, persist = true) {
  const dark = !!isDark;
  const colorPicker = document.getElementById('colorPicker');
  document.documentElement.classList.toggle('dark', dark);
  document.body.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'only dark' : 'only light';
  document.body.style.colorScheme = dark ? 'only dark' : 'only light';

  const metaColorScheme = document.getElementById('metaColorScheme') || document.querySelector('meta[name="color-scheme"]');
  if (metaColorScheme) {
    metaColorScheme.setAttribute('content', dark ? 'only dark' : 'only light');
  }

  const metaTheme = document.getElementById('metaThemeColor') || document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', dark ? '#0f172a' : '#ffffff');
  }

  const themeBtn = document.getElementById('themeToggleBtn');
  if (themeBtn) {
    const label = dark ? 'Переключить на дневную тему' : 'Переключить на ночную тему';
    themeBtn.setAttribute('aria-pressed', String(dark));
    themeBtn.setAttribute('aria-label', label);
    themeBtn.title = label;
    themeBtn.setAttribute('data-tooltip-bottom', dark ? 'Дневная тема' : 'Ночная тема');
  }

  const menuThemeLbl = document.getElementById('actionsThemeToggleLabel');
  if (menuThemeLbl) {
    menuThemeLbl.textContent = dark ? 'Дневная тема' : 'Ночная тема';
  }
  const menuThemeIcon = document.getElementById('actionsThemeToggleIcon');
  if (menuThemeIcon) {
    menuThemeIcon.innerHTML = dark
      ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>'
      : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  }

  if (persist) {
    try { localStorage.setItem('wb_theme', dark ? 'dark' : 'light'); } catch (_) {}
  }
  if (colorPicker) {
    if (dark && colorPicker.value === '#1e293b') {
      WB.selectColor('#f8fafc', null);
    } else if (!dark && colorPicker.value === '#f8fafc') {
      WB.selectColor('#1e293b', document.querySelector('.color-swatch'));
    }
  }
};

WB.toggleTheme = function() {
  const nextDark = !document.body.classList.contains('dark');
  WB.applyTheme(nextDark, true);
};

const grids = ['grid-lines', 'grid-dots', 'grid-ruled', 'grid-none'];
WB.gridMode = document.body.classList.contains('grid-dots')
  ? 'grid-dots'
  : (document.body.classList.contains('grid-ruled')
    ? 'grid-ruled'
    : (document.body.classList.contains('grid-none') ? 'grid-none' : 'grid-lines'));

WB.syncGridButtonUI = function() {
  const btn = document.getElementById('gridToggleBtn');
  const iconWrap = document.getElementById('gridBtnIcon');
  const lbl = btn?.querySelector('.grid-btn-lbl');
  const mode = WB.gridMode || 'grid-lines';

  const meta = {
    'grid-lines': {
      label: 'Клетка',
      tip: 'Фоновая сетка: Клетка (нажмите для смены)',
      svg: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>'
    },
    'grid-dots': {
      label: 'Точки',
      tip: 'Фоновая сетка: Точки (нажмите для смены)',
      svg: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="12" cy="8" r="1" fill="currentColor"/><circle cx="16" cy="8" r="1" fill="currentColor"/><circle cx="8" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="16" cy="12" r="1" fill="currentColor"/><circle cx="8" cy="16" r="1" fill="currentColor"/><circle cx="12" cy="16" r="1" fill="currentColor"/><circle cx="16" cy="16" r="1" fill="currentColor"/></svg>'
    },
    'grid-ruled': {
      label: 'Линейная',
      tip: 'Фоновая сетка: Линейная (нажмите для смены)',
      svg: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 8.5h18M3 12.5h18M3 16.5h18"/></svg>'
    },
    'grid-none': {
      label: 'Чисто',
      tip: 'Фоновая сетка: Без сетки (нажмите для смены)',
      svg: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 3"/></svg>'
    }
  }[mode] || { label: 'Клетка', tip: 'Фоновая сетка', svg: '' };

  if (iconWrap && meta.svg) iconWrap.innerHTML = meta.svg;
  if (lbl) lbl.textContent = meta.label;
  if (btn) {
    btn.title = meta.tip;
    btn.setAttribute('data-tooltip-bottom', meta.label);
  }
};

WB.setGridMode = function(mode, persist = true) {
  const next = grids.includes(mode) ? mode : 'grid-lines';
  grids.forEach(g => document.body.classList.remove(g));
  document.body.classList.add(next);
  WB.gridMode = next;
  if (persist) {
    try { localStorage.setItem('wb_grid_mode', next); } catch (_) {}
  }
  WB.syncGridButtonUI();
};

WB.cycleGrid = function() {
  const idx = grids.indexOf(WB.gridMode);
  const next = grids[(idx === -1 ? 0 : idx + 1) % grids.length];
  WB.setGridMode(next, true);
};

WB.clearBoard = function() {
  if (WB.userRole === 'student') return;
  WB.closeAllDropdowns();
  WB.openConfirmModal({
    title: 'Очистить текущую страницу?',
    message: 'Все рисунки, фигуры и виджеты на этой странице будут удалены. Действие можно отменить через Ctrl+Z.',
    confirmLabel: 'Очистить страницу',
    onConfirm: () => {
      WB.state = { strokes: [], widgets: [] };
      WB.clearSelection();
      if (typeof WB.resetLinearChain === 'function') WB.resetLinearChain();
      WB.renderWidgetsDOM();
      WB.saveHistory();
      WB.showToast('🧹 Страница очищена (Ctrl+Z для отмены)', 2400);
    }
  });
};

// --- 3D СТЕРЕОМЕТРИЯ: ПЛАВАЮЩАЯ ПАНЕЛЬ, НАСТРОЙКИ И ПОСТРОЕНИЯ (ТОЧКИ, ЛИНИИ, СЕЧЕНИЯ) ---
WB.s3dEditor = {
  strokeId: null,
  mode: 'move', // 'move' | 'rotate' | 'point' | 'line' | 'plane'
  settingsOpen: false,
  activeTab: 'dimensions', // 'dimensions' | 'constructions'
  anglesOpen: false,
  openDropdown: null, // null | 'top' | 'cone'
  pendingPointRefs: [],
  customPos: null,
  customOffset: null,
  lockedPos: null
};

let rotate3dState = null;

WB.getActive3DStroke = function() {
  if (!WB.selection || WB.selection.strokeIds.size !== 1) return null;
  const onlyId = Array.from(WB.selection.strokeIds)[0];
  const s = (WB.state.strokes || []).find(st => st.id === onlyId);
  if (s && typeof WB.is3DShapeStroke === 'function' && WB.is3DShapeStroke(s)) {
    if (WB.s3dEditor.strokeId !== s.id) {
      WB.s3dEditor.strokeId = s.id;
      WB.s3dEditor.pendingPointRefs = [];
      WB.s3dEditor.customPos = null;
      WB.s3dEditor.customOffset = null;
      WB.s3dEditor.lockedPos = null;
      WB.s3dEditor.openDropdown = null;
    }
    return s;
  }
  return null;
};

WB.set3DEditMode = function(mode) {
  WB.s3dEditor.mode = mode || 'move';
  WB.s3dEditor.pendingPointRefs = [];
  if (WB.currentTool !== 'select') {
    WB.setTool('select');
  }
  WB.sync3DFloatingUI();
};

WB.toggle3DSnapMode = function() {
  const s = WB.getActive3DStroke();
  if (!s) return;
  const cfg = WB.ensure3DConfig(s);
  cfg.snapPoints = !(cfg.snapPoints !== false);
  WB.saveHistory();
  WB.sync3DFloatingUI();
};
WB.toggle3DFrameMode = WB.toggle3DSnapMode;

WB.toggle3DSettingsPanel = function(forceState) {
  const nextState = typeof forceState === 'boolean' ? forceState : !WB.s3dEditor.settingsOpen;
  WB.s3dEditor.settingsOpen = nextState;
  WB.s3dEditor.openDropdown = null;
  if (nextState) {
    const s = WB.getActive3DStroke();
    if (s) {
      const baseAnchor = WB.get3DFloatingBaseAnchor(s, 348);
      const dx = WB.s3dEditor.customOffset ? WB.s3dEditor.customOffset.dx : 0;
      const dy = WB.s3dEditor.customOffset ? WB.s3dEditor.customOffset.dy : 0;
      const maxLeft = Math.max(12, window.innerWidth - 348 - 12);
      const maxTop = Math.max(58, window.innerHeight - 120);
      WB.s3dEditor.lockedPos = {
        left: Math.round(Math.max(12, Math.min(maxLeft, baseAnchor.left + dx))),
        top: Math.round(Math.max(58, Math.min(maxTop, baseAnchor.top + dy)))
      };
    }
  } else {
    WB.s3dEditor.lockedPos = null;
  }
  WB.sync3DFloatingUI();
};

WB.switch3DTab = function(tab) {
  WB.s3dEditor.activeTab = tab === 'constructions' ? 'constructions' : 'dimensions';
  WB.s3dEditor.openDropdown = null;
  WB.sync3DFloatingUI();
};

WB.toggle3DSubtypeDropdown = function(slot) {
  const s = WB.getActive3DStroke();
  if (!s) return;
  const cfg = WB.ensure3DConfig(s);
  if ((cfg.customPoints?.length || 0) > 0) return;
  WB.s3dEditor.openDropdown = WB.s3dEditor.openDropdown === slot ? null : slot;
  WB.sync3DFloatingUI();
};

WB.select3DSubtype = function(key, value) {
  WB.s3dEditor.openDropdown = null;
  WB.updateActive3DParam(key, value, true);
};

WB.toggle3DAnglesSection = function() {
  WB.s3dEditor.anglesOpen = !WB.s3dEditor.anglesOpen;
  WB.sync3DFloatingUI();
};

WB.reset3DView = function() {
  const s = WB.getActive3DStroke();
  if (!s) return;
  const cfg = WB.ensure3DConfig(s);
  cfg.yaw = WB.DEFAULT_3D_YAW ?? -0.62;
  cfg.pitch = WB.DEFAULT_3D_PITCH ?? 0.36;
  WB.updateSelectionBounds();
  WB.saveHistory();
  WB.sync3DFloatingUI();
};

WB.updateActive3DParam = function(key, val, commitHistory = true) {
  const s = WB.getActive3DStroke();
  if (!s) return;
  const cfg = WB.ensure3DConfig(s);
  let boundsChanged = false;
  if (key === 'radius') {
    const num = parseFloat(val);
    if (!Number.isNaN(num)) {
      cfg.radius = Math.max(0.5, Math.min(10, num));
      boundsChanged = true;
    }
  } else if (key === 'depth') {
    const num = parseFloat(val);
    if (!Number.isNaN(num)) {
      cfg.depth = Math.max(0.5, Math.min(10, num));
      boundsChanged = true;
    }
  } else if (key === 'height') {
    const num = parseFloat(val);
    if (!Number.isNaN(num)) {
      cfg.height = Math.max(0.5, Math.min(10, num));
      boundsChanged = true;
    }
  } else if (key === 'baseSides') {
    if ((cfg.customPoints?.length || 0) > 0) return;
    const num = parseInt(val, 10);
    if (!Number.isNaN(num)) {
      cfg.baseSides = Math.max(3, Math.min(8, num));
      boundsChanged = true;
    }
  } else if (key === 'baseAngle') {
    const num = parseFloat(val);
    if (!Number.isNaN(num)) {
      cfg.baseAngle = Math.max(20, Math.min(160, num));
      boundsChanged = true;
    }
  } else if (key === 'tiltX') {
    const num = parseFloat(val);
    if (!Number.isNaN(num)) {
      cfg.tiltX = Math.max(-60, Math.min(60, num));
      boundsChanged = true;
    }
  } else if (key === 'tiltY') {
    const num = parseFloat(val);
    if (!Number.isNaN(num)) {
      cfg.tiltY = Math.max(-60, Math.min(60, num));
      boundsChanged = true;
    }
  } else if (key === 'topShiftX') {
    const num = parseFloat(val);
    if (!Number.isNaN(num)) {
      cfg.topShiftX = Math.max(-4, Math.min(4, num));
      boundsChanged = true;
    }
  } else if (key === 'topShiftY') {
    const num = parseFloat(val);
    if (!Number.isNaN(num)) {
      cfg.topShiftY = Math.max(-4, Math.min(4, num));
      boundsChanged = true;
    }
  } else if (key === 'topRatio') {
    const num = parseFloat(val);
    if (!Number.isNaN(num)) {
      cfg.topRatio = Math.max(0.1, Math.min(0.95, num));
      boundsChanged = true;
    }
  } else if (key === 'topRadius') {
    const num = parseFloat(val);
    if (!Number.isNaN(num)) {
      cfg.topRadius = Math.max(0.2, Math.min(7.5, num));
      boundsChanged = true;
    }
  } else if (key === 'boxKind') {
    if ((cfg.customPoints?.length || 0) > 0) return;
    if (val === 'rectangular' || val === 'right' || val === 'oblique') {
      cfg.boxKind = val;
      boundsChanged = true;
    }
  } else if (key === 'pyramidKind') {
    if ((cfg.customPoints?.length || 0) > 0) return;
    if (val === 'regular' || val === 'truncated' || val === 'tetrahedron') {
      cfg.pyramidKind = val;
      if (val === 'tetrahedron') s.type = 'tetrahedron';
      else s.type = 'pyramid';
      boundsChanged = true;
    }
  } else if (key === 'coneKind') {
    if ((cfg.customPoints?.length || 0) > 0) return;
    if (val === 'cone' || val === 'frustum') {
      cfg.coneKind = val;
      boundsChanged = true;
    }
  } else if (key === 'yawDeg') {
    const num = parseFloat(val);
    if (!Number.isNaN(num)) {
      cfg.yaw = (Math.max(-180, Math.min(180, num)) * Math.PI) / 180;
      boundsChanged = true;
    }
  } else if (key === 'pitchDeg') {
    const num = parseFloat(val);
    if (!Number.isNaN(num)) {
      cfg.pitch = (Math.max(-80, Math.min(80, num)) * Math.PI) / 180;
      boundsChanged = true;
    }
  } else if (key === 'showLabels') {
    cfg.showLabels = !!val;
  } else if (key === 'showDiagonals') {
    cfg.showDiagonals = !!val;
  } else if (key === 'showHiddenEdges') {
    cfg.showHiddenEdges = !!val;
  } else if (key === 'showFaces') {
    cfg.showFaces = !!val;
  }
  if (boundsChanged) {
    WB.updateSelectionBounds();
  } else {
    WB.sync3DFloatingUI();
  }
  if (commitHistory !== false) {
    WB.saveHistory();
  }
};

WB.delete3DConstruction = function(kind, id) {
  const s = WB.getActive3DStroke();
  if (!s) return;
  const cfg = WB.ensure3DConfig(s);
  if (kind === 'point') {
    cfg.customPoints = (cfg.customPoints || []).filter(p => p.id !== id);
    cfg.customLines = (cfg.customLines || []).filter(l => l.aRef !== id && l.bRef !== id);
    cfg.customPlanes = (cfg.customPlanes || []).filter(pl => !(pl.pointRefs || []).includes(id));
  } else if (kind === 'line') {
    cfg.customLines = (cfg.customLines || []).filter(l => l.id !== id);
  } else if (kind === 'plane') {
    cfg.customPlanes = (cfg.customPlanes || []).filter(pl => pl.id !== id);
  }
  WB.s3dEditor.pendingPointRefs = [];
  WB.updateSelectionBounds();
  WB.saveHistory();
  WB.sync3DFloatingUI();
};

WB.close3DEditor = function() {
  WB.s3dEditor.settingsOpen = false;
  WB.s3dEditor.openDropdown = null;
  WB.s3dEditor.pendingPointRefs = [];
  WB.s3dEditor.customPos = null;
  WB.s3dEditor.customOffset = null;
  WB.s3dEditor.lockedPos = null;
  WB.clearSelection();
  WB.sync3DFloatingUI();
};

WB.get3DFloatingBaseAnchor = function(s, uiWidth = 348) {
  const b = WB.getStrokeBounds(s);
  const z = WB.cam?.z || 1;
  if (WB.s3dEditor.settingsOpen) {
    const bLeft = b.x * z + WB.cam.x;
    const bRight = (b.x + b.w) * z + WB.cam.x;
    const bTop = b.y * z + WB.cam.y;
    const panelW = 348;
    let leftPos = bRight + 22;
    if (leftPos + panelW > window.innerWidth - 16) {
      leftPos = Math.max(16, bLeft - panelW - 22);
    }
    const maxTop = Math.max(66, window.innerHeight - 520);
    const topPos = Math.max(66, Math.min(maxTop, bTop - 14));
    return { left: Math.round(leftPos), top: Math.round(topPos), panelW };
  }
  const panelW = Math.max(260, uiWidth || 350);
  const screenCx = (b.x + b.w / 2) * z + WB.cam.x;
  const screenTop = b.y * z + WB.cam.y - 68;
  const rawLeft = screenCx - panelW / 2;
  const clampedLeft = Math.max(12, Math.min(window.innerWidth - panelW - 12, rawLeft));
  const clampedTop = Math.max(64, Math.min(window.innerHeight - 130, screenTop));
  return { left: Math.round(clampedLeft), top: Math.round(clampedTop), panelW };
};

WB.sync3DFloatingUI = function() {
  const ui = document.getElementById('shape3dFloatingUi');
  if (!ui) return;
  const s = WB.getActive3DStroke();
  if (!s) {
    ui.classList.add('hidden');
    ui.classList.remove('s3d-has-card');
    ui.style.display = 'none';
    WB.s3dEditor.strokeId = null;
    WB.s3dEditor.customPos = null;
    WB.s3dEditor.customOffset = null;
    WB.s3dEditor.lockedPos = null;
    WB.s3dEditor.pendingPointRefs = [];
    return;
  }

  const cfg = WB.ensure3DConfig(s);
  ui.classList.remove('hidden');
  ui.style.display = 'flex';
  ui.classList.toggle('s3d-has-card', !!WB.s3dEditor.settingsOpen);

  // Фиксируем координаты карточки настроек, чтобы ползунки ширины/высоты не вызывали дёргание панели
  const measuredW = WB.s3dEditor.settingsOpen ? 348 : (ui.offsetWidth || 350);
  const maxLeft = Math.max(12, window.innerWidth - measuredW - 12);
  const maxTop = Math.max(58, window.innerHeight - 120);
  let clampedLeft;
  let clampedTop;

  if (WB.s3dEditor.settingsOpen) {
    if (!WB.s3dEditor.lockedPos) {
      const baseAnchor = WB.get3DFloatingBaseAnchor(s, measuredW);
      const dx = WB.s3dEditor.customOffset ? WB.s3dEditor.customOffset.dx : 0;
      const dy = WB.s3dEditor.customOffset ? WB.s3dEditor.customOffset.dy : 0;
      WB.s3dEditor.lockedPos = {
        left: Math.round(Math.max(12, Math.min(maxLeft, baseAnchor.left + dx))),
        top: Math.round(Math.max(58, Math.min(maxTop, baseAnchor.top + dy)))
      };
    }
    clampedLeft = Math.max(12, Math.min(maxLeft, WB.s3dEditor.lockedPos.left));
    clampedTop = Math.max(58, Math.min(maxTop, WB.s3dEditor.lockedPos.top));
  } else {
    const baseAnchor = WB.get3DFloatingBaseAnchor(s, measuredW);
    const dx = WB.s3dEditor.customOffset ? WB.s3dEditor.customOffset.dx : 0;
    const dy = WB.s3dEditor.customOffset ? WB.s3dEditor.customOffset.dy : 0;
    clampedLeft = Math.max(12, Math.min(maxLeft, baseAnchor.left + dx));
    clampedTop = Math.max(58, Math.min(maxTop, baseAnchor.top + dy));
  }

  ui.style.left = `${Math.round(clampedLeft)}px`;
  ui.style.top = `${Math.round(clampedTop)}px`;
  ui.style.transform = 'none';

  // Кнопки режимов 1..5
  const modeMap = {
    move: 's3dToolMove',
    rotate: 's3dToolRotate',
    point: 's3dToolPoint',
    line: 's3dToolLine',
    plane: 's3dToolPlane'
  };
  Object.entries(modeMap).forEach(([m, btnId]) => {
    const btn = document.getElementById(btnId);
    if (btn) btn.classList.toggle('active', WB.s3dEditor.mode === m);
  });

  const snapBtn = document.getElementById('s3dToolSnap');
  if (snapBtn) snapBtn.classList.toggle('active', cfg.snapPoints !== false);

  const settingsBtn = document.getElementById('s3dToolSettings');
  if (settingsBtn) settingsBtn.classList.toggle('active', !!WB.s3dEditor.settingsOpen);

  const card = document.getElementById('s3dSettingsCard');
  if (card) {
    card.classList.toggle('hidden', !WB.s3dEditor.settingsOpen);
    card.style.display = WB.s3dEditor.settingsOpen ? 'flex' : 'none';
  }

  // Метаданные конкретного 3D-тела и его вида (полное соответствие 27-страничному референсу)
  const dimMeta = typeof WB.get3DBodyDimensionMeta === 'function'
    ? WB.get3DBodyDimensionMeta(s.type, cfg)
    : { title: 'Фигура 3D', radiusLabel: 'Радиус основания', showHeight: true, heightLabel: 'Высота h', showFaces: true };

  const titleEl = document.getElementById('s3dBodyTitle');
  if (titleEl) titleEl.textContent = dimMeta.title || (WB.SHAPE_3D_TITLES && WB.SHAPE_3D_TITLES[s.type]) || 'Фигура 3D';

  const pts = cfg.customPoints || [];
  const lns = cfg.customLines || [];
  const pls = cfg.customPlanes || [];
  const totalConstructions = pts.length + lns.length + pls.length;
  const hasCustomPts = pts.length > 0;

  const countEl = document.getElementById('s3dConstructionsCount');
  if (countEl) countEl.textContent = String(totalConstructions);

  const isDimTab = WB.s3dEditor.activeTab !== 'constructions';
  const tabDim = document.getElementById('s3dTabDimensionsBtn');
  const tabCon = document.getElementById('s3dTabConstructionsBtn');
  const panelDim = document.getElementById('s3dPaneDimensions');
  const panelCon = document.getElementById('s3dPaneConstructions');
  if (tabDim) tabDim.classList.toggle('active', isDimTab);
  if (tabCon) tabCon.classList.toggle('active', !isDimTab);
  if (panelDim) {
    panelDim.classList.toggle('hidden', !isDimTab);
    panelDim.style.display = isDimTab ? 'flex' : 'none';
  }
  if (panelCon) {
    panelCon.classList.toggle('hidden', isDimTab);
    panelCon.style.display = isDimTab ? 'none' : 'flex';
  }

  const syncRangePct = (sliderEl) => {
    if (!sliderEl) return;
    const min = Number(sliderEl.min);
    const max = Number(sliderEl.max);
    const val = Number(sliderEl.value);
    const pct = max > min ? Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100)) : 0;
    sliderEl.style.setProperty('--pct', `${pct.toFixed(1)}%`);
  };

  const syncParamPair = (groupId, visible, sliderId, inputId, value, disabled = false) => {
    const grp = document.getElementById(groupId);
    if (grp) grp.style.display = visible ? 'flex' : 'none';
    const sl = document.getElementById(sliderId);
    const inp = document.getElementById(inputId);
    const strVal = String(value);
    if (sl) {
      sl.value = strVal;
      sl.disabled = !!disabled;
      syncRangePct(sl);
    }
    if (inp) {
      if (document.activeElement !== inp) inp.value = strVal;
      inp.disabled = !!disabled;
    }
  };

  const syncSubtypeSlot = (slot, groupId, labelId, ddId, trigId, valId, menuId) => {
    const grp = document.getElementById(groupId);
    const activeHere = dimMeta.subtypePlacement === slot && Array.isArray(dimMeta.subtypeOptions) && dimMeta.subtypeOptions.length > 0;
    if (grp) grp.style.display = activeHere ? 'flex' : 'none';
    if (!activeHere) return;
    const lbl = document.getElementById(labelId);
    if (lbl) lbl.textContent = dimMeta.subtypeLabel;
    const activeOpt = dimMeta.subtypeOptions.find(o => o.value === dimMeta.subtypeValue) || dimMeta.subtypeOptions[0];
    const valEl = document.getElementById(valId);
    if (valEl && activeOpt) valEl.textContent = activeOpt.label;
    const isOpen = WB.s3dEditor.openDropdown === slot && !hasCustomPts;
    const dd = document.getElementById(ddId);
    if (dd) dd.classList.toggle('open', isOpen);
    const trig = document.getElementById(trigId);
    if (trig) {
      trig.disabled = hasCustomPts;
      trig.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }
    const menu = document.getElementById(menuId);
    if (menu) {
      const checkSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;
      menu.innerHTML = dimMeta.subtypeOptions.map(opt => {
        const selected = opt.value === dimMeta.subtypeValue;
        return `<button type="button" role="option" aria-selected="${selected ? 'true' : 'false'}" class="s3d-dropdown-option${selected ? ' selected' : ''}" onclick="WB.select3DSubtype('${dimMeta.subtypeKey}', '${opt.value}')"><span>${opt.label}</span>${selected ? checkSvg : ''}</button>`;
      }).join('');
    }
  };

  // Синхронизация контролов на вкладке "Размеры и вид"
  const lblCheck = document.getElementById('s3dShowLabelsCheck');
  if (lblCheck) lblCheck.checked = cfg.showLabels !== false;

  syncSubtypeSlot('top', 's3dSubtypeTopGroup', 's3dSubtypeTopLabel', 's3dSubtypeTopDropdown', 's3dSubtypeTopTrigger', 's3dSubtypeTopValue', 's3dSubtypeTopMenu');
  syncSubtypeSlot('cone', 's3dSubtypeConeGroup', 's3dSubtypeConeLabel', 's3dSubtypeConeDropdown', 's3dSubtypeConeTrigger', 's3dSubtypeConeValue', 's3dSubtypeConeMenu');

  const rLabel = document.getElementById('s3dRadiusLabel');
  if (rLabel) rLabel.textContent = dimMeta.radiusLabel;
  syncParamPair('s3dRadiusGroup', true, 's3dRadiusSlider', 's3dRadiusInput', cfg.radius ?? 2, false);

  const dLabel = document.getElementById('s3dDepthLabel');
  if (dLabel) dLabel.textContent = dimMeta.depthLabel || 'Ширина b';
  syncParamPair('s3dDepthGroup', !!dimMeta.showDepth, 's3dDepthSlider', 's3dDepthInput', cfg.depth ?? 2, false);

  const hLabel = document.getElementById('s3dHeightLabel');
  if (hLabel) hLabel.textContent = dimMeta.heightLabel || 'Высота h';
  syncParamPair('s3dHeightGroup', !!dimMeta.showHeight, 's3dHeightSlider', 's3dHeightInput', cfg.height ?? 3, false);

  const sidesLabel = document.getElementById('s3dSidesLabel');
  if (sidesLabel) sidesLabel.textContent = dimMeta.baseSidesLabel || 'Число сторон основания';
  syncParamPair('s3dSidesGroup', !!dimMeta.showBaseSides, 's3dSidesSlider', 's3dSidesInput', cfg.baseSides ?? (s.type === 'prism' ? 5 : 4), hasCustomPts);

  syncParamPair('s3dBaseAngleGroup', !!dimMeta.showBaseAngle, 's3dBaseAngleSlider', 's3dBaseAngleInput', Math.round(cfg.baseAngle ?? 45), false);
  syncParamPair('s3dTiltXGroup', !!dimMeta.showTiltXY, 's3dTiltXSlider', 's3dTiltXInput', Math.round(cfg.tiltX ?? 36), false);
  syncParamPair('s3dTiltYGroup', !!dimMeta.showTiltXY, 's3dTiltYSlider', 's3dTiltYInput', Math.round(cfg.tiltY ?? -25), false);
  syncParamPair('s3dTopShiftXGroup', !!dimMeta.showTopShift, 's3dTopShiftXSlider', 's3dTopShiftXInput', cfg.topShiftX ?? 0, false);
  syncParamPair('s3dTopShiftYGroup', !!dimMeta.showTopShift, 's3dTopShiftYSlider', 's3dTopShiftYInput', cfg.topShiftY ?? 0, false);
  syncParamPair('s3dTopRatioGroup', !!dimMeta.showTopRatio, 's3dTopRatioSlider', 's3dTopRatioInput', cfg.topRatio ?? 0.5, false);
  syncParamPair('s3dTopRadiusGroup', !!dimMeta.showTopRadius, 's3dTopRadiusSlider', 's3dTopRadiusInput', cfg.topRadius ?? 1, false);

  // Чекбоксы: Диагонали, Невидимые рёбра, Заливка граней
  const diagWrap = document.getElementById('s3dDiagonalsWrap');
  if (diagWrap) diagWrap.style.display = dimMeta.showDiagonals ? 'inline-flex' : 'none';
  const diagCheck = document.getElementById('s3dDiagonalsCheck');
  if (diagCheck) diagCheck.checked = !!cfg.showDiagonals;

  const hidCheck = document.getElementById('s3dHiddenEdgesCheck');
  if (hidCheck) hidCheck.checked = cfg.showHiddenEdges !== false;

  const faceWrap = document.getElementById('s3dFaceFillWrap');
  if (faceWrap) faceWrap.style.display = dimMeta.showFaces !== false ? 'inline-flex' : 'none';
  const faceCheck = document.getElementById('s3dFaceFillCheck');
  if (faceCheck) faceCheck.checked = cfg.showFaces !== false;

  // Раскрывающийся блок «Поворот по углам»
  const angBtn = document.getElementById('s3dAnglesToggleBtn');
  const angBody = document.getElementById('s3dAnglesBody');
  const isAngOpen = !!WB.s3dEditor.anglesOpen;
  if (angBtn) {
    angBtn.classList.toggle('open', isAngOpen);
    angBtn.setAttribute('aria-expanded', isAngOpen ? 'true' : 'false');
  }
  if (angBody) {
    angBody.style.display = isAngOpen ? 'flex' : 'none';
  }
  const yawDeg = Math.round(((Number(cfg.yaw) || 0) * 180) / Math.PI);
  const pitchDeg = Math.round(((Number(cfg.pitch) || 0) * 180) / Math.PI);
  const yawSl = document.getElementById('s3dYawSlider');
  const yawInp = document.getElementById('s3dYawInput');
  if (yawSl) { yawSl.value = String(yawDeg); syncRangePct(yawSl); }
  if (yawInp && document.activeElement !== yawInp) yawInp.value = String(yawDeg);
  const pitSl = document.getElementById('s3dPitchSlider');
  const pitInp = document.getElementById('s3dPitchInput');
  if (pitSl) { pitSl.value = String(pitchDeg); syncRangePct(pitSl); }
  if (pitInp && document.activeElement !== pitInp) pitInp.value = String(pitchDeg);

  const hintEl = document.getElementById('s3dFooterHint');
  if (hintEl) {
    hintEl.style.display = hasCustomPts ? 'block' : 'none';
  }

  // Синхронизация списка построений на вкладке "Построения (N)"
  const listEl = document.getElementById('s3dConstructionsList');
  if (listEl) {
    if (totalConstructions === 0) {
      listEl.innerHTML = `<div class="s3d-empty-constructions">Нет добавленных построений. Выберите «Точка · 3», «Линия · 4» или «Плоскость · 5».</div>`;
    } else {
      const itemsHtml = [];
      const trashSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
      const ptIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>`;
      const lnIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="4" y1="12" x2="20" y2="12"/></svg>`;
      const plIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>`;

      for (const p of pts) {
        itemsHtml.push(`
          <div class="s3d-construction-item">
            <div class="s3d-construction-left">
              <span class="s3d-construction-icon">${ptIcon}</span>
              <span class="s3d-construction-label">${p.label}</span>
            </div>
            <button type="button" class="s3d-construction-del" title="Удалить ${p.label}" onclick="WB.delete3DConstruction('point', '${p.id}')">${trashSvg}</button>
          </div>
        `);
      }
      for (const l of lns) {
        itemsHtml.push(`
          <div class="s3d-construction-item">
            <div class="s3d-construction-left">
              <span class="s3d-construction-icon">${lnIcon}</span>
              <span class="s3d-construction-label">${l.label}</span>
            </div>
            <button type="button" class="s3d-construction-del" title="Удалить ${l.label}" onclick="WB.delete3DConstruction('line', '${l.id}')">${trashSvg}</button>
          </div>
        `);
      }
      for (const pl of pls) {
        itemsHtml.push(`
          <div class="s3d-construction-item">
            <div class="s3d-construction-left">
              <span class="s3d-construction-icon">${plIcon}</span>
              <span class="s3d-construction-label">${pl.label}</span>
            </div>
            <button type="button" class="s3d-construction-del" title="Удалить ${pl.label}" onclick="WB.delete3DConstruction('plane', '${pl.id}')">${trashSvg}</button>
          </div>
        `);
      }
      listEl.innerHTML = itemsHtml.join('');
    }
  }
};

// --- ПЛАВАЮЩАЯ ПАНЕЛЬ ДЛЯ ВЫДЕЛЕННЫХ 2D-ФИГУР (СТР. 4-5 PDF) ---
WB.getSelected2DShapes = function() {
  if (!WB.selection || !WB.selection.strokeIds || WB.selection.strokeIds.size === 0) return [];
  if (WB.selection.widgetIds && WB.selection.widgetIds.size > 0) return [];
  if (typeof WB.getActive3DStroke === 'function' && WB.getActive3DStroke()) return [];
  const selected = (WB.state.strokes || []).filter(s => WB.selection.strokeIds.has(s.id));
  if (selected.length === 0) return [];
  if (!selected.every(s => typeof WB.is2DShapeStroke === 'function' && WB.is2DShapeStroke(s))) {
    return [];
  }
  return selected;
};

WB.sync2DFloatingUI = function() {
  const ui = document.getElementById('shape2dFloatingUi');
  if (!ui) return;
  const shapes = WB.getSelected2DShapes();
  if (shapes.length === 0 || WB.currentTool !== 'select' || !WB.selection.bounds) {
    ui.classList.add('hidden');
    ui.style.display = 'none';
    ui.querySelectorAll('.s2d-popover.open').forEach(p => p.classList.remove('open'));
    return;
  }

  ui.classList.remove('hidden');
  ui.style.display = 'inline-flex';

  const b = WB.selection.bounds;
  const z = WB.cam?.z || 1;
  const screenBox = {
    left: b.x * z + WB.cam.x,
    top: b.y * z + WB.cam.y,
    width: b.w * z,
    height: b.h * z
  };
  const barW = ui.offsetWidth || 292;
  const barH = ui.offsetHeight || 44;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cx = screenBox.left + screenBox.width / 2;
  const halfW = barW / 2;
  const minCenterX = halfW + 12;
  const maxCenterX = Math.max(minCenterX, vw - halfW - 12);
  const clampedCenterX = Math.max(minCenterX, Math.min(maxCenterX, cx));

  let topPos = screenBox.top - barH - 14;
  if (topPos < 58) {
    const below = screenBox.top + screenBox.height + 14;
    topPos = (below + barH <= vh - 86) ? below : 58;
  }
  const maxTop = Math.max(58, vh - barH - 86);
  topPos = Math.max(58, Math.min(maxTop, topPos));

  ui.style.left = `${Math.round(clampedCenterX - halfW)}px`;
  ui.style.top = `${Math.round(topPos)}px`;

  const allLocked = shapes.every(s => !!s.locked);
  const lockBtn = document.getElementById('s2dLockBtn');
  const iconOpen = document.getElementById('s2dLockIconOpen');
  const iconClosed = document.getElementById('s2dLockIconClosed');
  if (lockBtn) {
    lockBtn.classList.toggle('is-locked', allLocked);
    const tip = allLocked ? 'Разблокировать' : 'Заблокировать';
    lockBtn.setAttribute('data-s2d-tip', tip);
    lockBtn.setAttribute('aria-label', tip);
  }
  if (iconOpen) iconOpen.style.display = allLocked ? 'none' : 'block';
  if (iconClosed) iconClosed.style.display = allLocked ? 'block' : 'none';

  const curSize = Math.round(Number(shapes[0].size) || 2);
  const sizeLabel = document.getElementById('s2dSizeLabel');
  if (sizeLabel) sizeLabel.textContent = `${curSize}px`;
  document.querySelectorAll('#s2dSizePopover .s2d-menu-opt').forEach(opt => {
    opt.classList.toggle('active', Number(opt.dataset.size) === curSize);
  });

  const colorInput = document.getElementById('s2dCustomColorInput');
  if (colorInput && shapes[0].color && /^#[0-9a-f]{6}$/i.test(shapes[0].color)) {
    colorInput.value = shapes[0].color;
  }
};

WB.toggle2DPopover = function(popoverId, event) {
  if (event) event.stopPropagation();
  const pop = document.getElementById(popoverId);
  if (!pop) return;
  const wasOpen = pop.classList.contains('open');
  document.querySelectorAll('.s2d-popover.open').forEach(p => p.classList.remove('open'));
  if (!wasOpen) pop.classList.add('open');
};

WB.toggle2DSelectionLock = function() {
  const shapes = WB.getSelected2DShapes();
  if (shapes.length === 0) return;
  const targetLocked = !shapes.every(s => !!s.locked);
  for (const s of shapes) {
    s.locked = targetLocked;
  }
  WB.saveHistory();
  WB.sync2DFloatingUI();
};

WB.apply2DStrokeColor = function(color) {
  const shapes = WB.getSelected2DShapes();
  if (shapes.length === 0) return;
  let changed = false;
  for (const s of shapes) {
    if (!s.locked) {
      s.color = color;
      changed = true;
    }
  }
  document.querySelectorAll('.s2d-popover.open').forEach(p => p.classList.remove('open'));
  if (changed) {
    WB.saveHistory();
    WB.sync2DFloatingUI();
  }
};

WB.apply2DFillColor = function(color, isHex = false) {
  const shapes = WB.getSelected2DShapes();
  if (shapes.length === 0) return;
  let finalColor = color;
  if (isHex && /^#[0-9a-f]{6}$/i.test(color)) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    finalColor = `rgba(${r}, ${g}, ${b}, 0.28)`;
  }
  let changed = false;
  for (const s of shapes) {
    if (!s.locked) {
      s.fillColor = finalColor;
      changed = true;
    }
  }
  document.querySelectorAll('.s2d-popover.open').forEach(p => p.classList.remove('open'));
  if (changed) {
    WB.saveHistory();
    WB.sync2DFloatingUI();
  }
};

WB.apply2DStrokeSize = function(px) {
  const shapes = WB.getSelected2DShapes();
  if (shapes.length === 0) return;
  const val = Math.max(1, Number(px) || 2);
  let changed = false;
  for (const s of shapes) {
    if (!s.locked) {
      s.size = val;
      changed = true;
    }
  }
  document.querySelectorAll('.s2d-popover.open').forEach(p => p.classList.remove('open'));
  if (changed) {
    WB.updateSelectionBounds();
    WB.saveHistory();
  }
};

WB.reorder2DSelectionLayer = function(action) {
  const shapes = WB.getSelected2DShapes();
  if (shapes.length === 0 || !Array.isArray(WB.state.strokes)) return;
  const sel = new Set(shapes.map(s => s.id));
  const arr = WB.state.strokes.slice();
  if (action === 'front') {
    WB.state.strokes = [...arr.filter(s => !sel.has(s.id)), ...arr.filter(s => sel.has(s.id))];
  } else if (action === 'back') {
    WB.state.strokes = [...arr.filter(s => sel.has(s.id)), ...arr.filter(s => !sel.has(s.id))];
  } else if (action === 'forward') {
    for (let i = arr.length - 2; i >= 0; i--) {
      if (sel.has(arr[i].id) && !sel.has(arr[i + 1].id)) {
        const tmp = arr[i];
        arr[i] = arr[i + 1];
        arr[i + 1] = tmp;
      }
    }
    WB.state.strokes = arr;
  } else if (action === 'backward') {
    for (let i = 1; i < arr.length; i++) {
      if (sel.has(arr[i].id) && !sel.has(arr[i - 1].id)) {
        const tmp = arr[i];
        arr[i] = arr[i - 1];
        arr[i - 1] = tmp;
      }
    }
    WB.state.strokes = arr;
  }
  document.querySelectorAll('.s2d-popover.open').forEach(p => p.classList.remove('open'));
  WB.saveHistory();
  WB.sync2DFloatingUI();
};

// Универсальный обработчик двойного клика / двойного тапа по виджетам на доске
WB.handleDoubleActivateAt = function(wPos) {
  const hitWidget = WB.findWidgetAt(wPos.x, wPos.y);
  if (!hitWidget) return false;
  if (hitWidget.isPdf || hitWidget.type === 'pdf' || hitWidget.type === 'image') {
    if (typeof WB.openPdfEditorForWidget === 'function') {
      WB.openPdfEditorForWidget(hitWidget.id);
    }
    return true;
  } else if (hitWidget.type === 'note' || hitWidget.type === 'text') {
    WB.setTool('select');
    WB.startEditingWidget(hitWidget.id);
    return true;
  } else if (hitWidget.type === 'latex') {
    WB.openLatexModal(hitWidget.id);
    return true;
  }
  return false;
};

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('board');
  const colorPicker = document.getElementById('colorPicker');
  const sizePicker = document.getElementById('sizePicker');
  const titleInput = document.getElementById('boardTitleInput');
  if (titleInput) titleInput.value = WB.boardTitle || 'Новый урок';

  // Перетаскивание плавающей панели 3D-фигуры за ручку ⋮⋮ (#s3dDragHandle)
  const s3dDragHandle = document.getElementById('s3dDragHandle');
  if (s3dDragHandle) {
    let s3dDragging = false;
    let s3dOffset = { x: 0, y: 0 };
    s3dDragHandle.addEventListener('pointerdown', (ev) => {
      const ui = document.getElementById('shape3dFloatingUi');
      if (!ui) return;
      ev.preventDefault();
      ev.stopPropagation();
      const rect = ui.getBoundingClientRect();
      s3dDragging = true;
      s3dOffset = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
      try { s3dDragHandle.setPointerCapture(ev.pointerId); } catch (_) {}
    });
    window.addEventListener('pointermove', (ev) => {
      if (!s3dDragging) return;
      const active3d = WB.getActive3DStroke();
      if (!active3d) return;
      const ui = document.getElementById('shape3dFloatingUi');
      const measuredW = WB.s3dEditor.settingsOpen ? 348 : (ui?.offsetWidth || 350);
      const baseAnchor = WB.get3DFloatingBaseAnchor(active3d, measuredW);
      const left = Math.max(12, Math.min(window.innerWidth - 260, ev.clientX - s3dOffset.x));
      const top = Math.max(54, Math.min(window.innerHeight - 80, ev.clientY - s3dOffset.y));
      WB.s3dEditor.customPos = { left: Math.round(left), top: Math.round(top) };
      if (WB.s3dEditor.settingsOpen) {
        WB.s3dEditor.lockedPos = { left: Math.round(left), top: Math.round(top) };
      }
      WB.s3dEditor.customOffset = {
        dx: Math.round(left - baseAnchor.left),
        dy: Math.round(top - baseAnchor.top)
      };
      WB.sync3DFloatingUI();
    });
    window.addEventListener('pointerup', () => {
      s3dDragging = false;
    });
  }

  const searchInput = document.getElementById('searchBoardInput');
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      const items = WB.getSearchItems();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (items.length) {
          WB.searchModal.selectedIndex = (WB.searchModal.selectedIndex + 1) % items.length;
          WB.renderSearchResults();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (items.length) {
          WB.searchModal.selectedIndex = (WB.searchModal.selectedIndex - 1 + items.length) % items.length;
          WB.renderSearchResults();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const picked = items[WB.searchModal.selectedIndex] || items[0];
        if (picked) WB.jumpToWidgetById(picked.id);
      } else if (e.key === 'Escape') {
        WB.closeSearchModal();
      }
    });
  }

  WB.resizeCanvas();
  window.addEventListener('resize', WB.resizeCanvas);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', WB.resizeCanvas);
  }

  // Восстановление сохранённой темы и фоновой сетки (синхронизируем color-scheme и theme-color для мобильных)
  try {
    const savedTheme = localStorage.getItem('wb_theme');
    WB.applyTheme(savedTheme === 'dark', false);
    const savedGrid = localStorage.getItem('wb_grid_mode');
    if (savedGrid) WB.setGridMode(savedGrid, false);
  } catch (_) {
    WB.applyTheme(false, false);
  }

  WB.loadFromStorage();
  WB.saveHistory();
  WB.updateCameraUI();
  WB.syncGridButtonUI();
  WB.updateReturnPrevSpotUI();
  WB.syncMobileStyleBadge();
  if (typeof WB.renderPagesDropdown === 'function') WB.renderPagesDropdown();
  if (typeof WB.updateUndoRedoButtons === 'function') WB.updateUndoRedoButtons();
  const newPageInput = document.getElementById('newPageNameInput');
  if (newPageInput) {
    newPageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        WB.addPage();
      }
    });
  }
  requestAnimationFrame(WB.renderLoop);

  sizePicker.addEventListener('change', () => {
    if (WB.selection.strokeIds.size > 0) WB.saveHistory();
  });

  // Drag & drop файлов (PDF, DOCX, XLSX, PPTX, CSV, TXT, MD, RTF, HTML, фото)
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (typeof WB.importAnyFileToBoard === 'function') {
      WB.importAnyFileToBoard(file);
    } else if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
      WB.importPDFFileToBoard(file);
    } else if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => WB.insertImageSource(ev.target.result);
      reader.readAsDataURL(file);
    }
  });

  window.addEventListener('wheel', (e) => {
    if (e.target.closest('.toolbar') || e.target.closest('.top-bar') || e.target.closest('.modal-window') || e.target.closest('.modal-backdrop') || e.target.closest('.peers-dropdown') || e.target.closest('.pages-dropdown') || e.target.closest('.s3d-floating-ui') || e.target.closest('.s2d-floating-ui')) return;
    e.preventDefault();
    WB.changeZoom(e.deltaY < 0 ? 0.1 : -0.1, e.clientX, e.clientY);
  }, { passive: false });

  // Закрытие любого модального окна по клику на полупрозрачный фон (backdrop)
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        WB.closeAllModals();
      }
    });
  });

  // Проверка: попадает ли сенсорное касание в рабочую область доски (холст или слой виджетов, но не UI/модалки)
  const isBoardGestureTarget = (target) => {
    if (!target || !(target instanceof Element)) return false;
    if (WB.pdfEditor && WB.pdfEditor.isOpen) return false;
    if (
      target.closest('.top-bar') ||
      target.closest('.toolbar') ||
      target.closest('.modal-backdrop') ||
      target.closest('.modal-window') ||
      target.closest('.dropdown-menu') ||
      target.closest('.peers-dropdown') ||
      target.closest('.pages-dropdown') ||
      target.closest('.s3d-floating-ui') ||
      target.closest('.s2d-floating-ui') ||
      target.closest('.top-left-modes') ||
      target.closest('.floating-peer-controls') ||
      target.closest('.dock-expand-fab')
    ) {
      return false;
    }
    if (target.closest('input, textarea, select, [contenteditable="true"]')) {
      const editingWidget = target.closest('.widget.editing, .widget.table-widget');
      if (editingWidget) return false;
    }
    return target === canvas || target === document.body || Boolean(target.closest('#world-layer'));
  };

  const shouldRejectBoardPalmTouch = (e) => {
    if (!e || e.pointerType !== 'touch') return false;
    // Если уже идёт 2-пальцевый щипок и стилус поднят — не блокируем щипок
    if (isPenDown) return true;
    const now = performance.now();
    if (lastPenActiveMs > 0 && (now - lastPenActiveMs) < 650) return true;
    const w = Number(e.width) || 0;
    const h = Number(e.height) || 0;
    if (lastPenActiveMs > 0 && (now - lastPenActiveMs) < 4000 && Math.max(w, h) >= 52) return true;
    return false;
  };

  // Полный откат незавершённого действия первого пальца при переходе в жест масштабирования двумя пальцами
  const rollbackFirstFingerAction = () => {
    clearTimeout(shapeHoldTimer);
    isPointerDown = false;
    WB.isPointerDrawing = false;
    isPanning = false;
    activePrimaryPointerId = null;
    selectMode = 'none';
    scaleSnapshot = null;
    activeVertexHit = null;
    if (typeof rotate3dState !== 'undefined') rotate3dState = null;
    if (WB.selection) WB.selection.marquee = null;
    if (!(WB.autoShapeEnabled && WB.linearChain && WB.linearChain.anchor && WB.linearSnapState && WB.linearSnapState.pointToPoint)) {
      WB.linearSnapState = null;
    }

    if (typeof WB._activeWidgetTouchCancel === 'function') {
      try { WB._activeWidgetTouchCancel(); } catch (_) {}
      WB._activeWidgetTouchCancel = null;
    }

    if (currentStroke) {
      const idx = WB.state.strokes.indexOf(currentStroke);
      if (idx !== -1) {
        WB.state.strokes.splice(idx, 1);
      }
      currentStroke = null;
    }

    if (touchFirstActionRollback) {
      const rb = touchFirstActionRollback;
      touchFirstActionRollback = null;
      if (rb.kind === 'snapshot' && rb.stateJson) {
        try {
          WB.state = JSON.parse(rb.stateJson);
          if (rb.linearChainJson !== undefined) {
            WB.linearChain = rb.linearChainJson ? JSON.parse(rb.linearChainJson) : null;
          }
          if (WB.selection) {
            WB.selection.strokeIds = new Set(rb.selectionStrokeIds || []);
            WB.selection.widgetIds = new Set(rb.selectionWidgetIds || []);
            WB.selection.marquee = null;
          }
          WB.syncCurrentPage();
          WB.renderWidgetsDOM();
          WB.updateSelectionBounds();
          if (typeof WB.sync3DFloatingUI === 'function') WB.sync3DFloatingUI();
          if (typeof WB.sync2DFloatingUI === 'function') WB.sync2DFloatingUI();
        } catch (_) {}
      } else if (rb.kind === 'stroke' && rb.strokeRef) {
        const idx = WB.state.strokes.indexOf(rb.strokeRef);
        if (idx !== -1) WB.state.strokes.splice(idx, 1);
      }
    }
  };

  // Запрет системного масштабирования страницы в Safari (iOS/iPadOS) при жестах щипка
  const preventSafariPageZoom = (e) => {
    if (e.target && e.target.closest && e.target.closest('input, textarea, select')) return;
    e.preventDefault();
  };
  document.addEventListener('gesturestart', preventSafariPageZoom, { passive: false });
  document.addEventListener('gesturechange', preventSafariPageZoom, { passive: false });
  document.addEventListener('gestureend', preventSafariPageZoom, { passive: false });

  // Блокируем нативный зум страницы на iOS/Android при 2+ касаниях поверх доски и слоя виджетов
  const preventMultiTouchScroll = (e) => {
    if (e.touches && e.touches.length >= 2 && isBoardGestureTarget(e.target)) {
      e.preventDefault();
    }
  };
  window.addEventListener('touchstart', preventMultiTouchScroll, { passive: false, capture: true });
  window.addEventListener('touchmove', preventMultiTouchScroll, { passive: false, capture: true });

  // Единый менеджер мультитача на Pointer Events (работает поверх #board и #world-layer, включая режим «Выбор»)
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'pen') {
      isPenDown = true;
      lastPenActiveMs = performance.now();
      return;
    }
    if (e.pointerType !== 'touch') return;
    if (!isBoardGestureTarget(e.target)) return;

    // Если стилус сейчас касается экрана — игнорируем ладонь целиком
    if (isPenDown) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    activeTouchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activeTouchPointers.size >= 2) {
      e.preventDefault();
      e.stopPropagation();
      if (!isTouchGesture) {
        isTouchGesture = true;
        WB._isTouchGestureActive = true;
        rollbackFirstFingerAction();
      }
      const pts = Array.from(activeTouchPointers.values());
      const p0 = pts[0];
      const p1 = pts[1];
      lastTouchMid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      lastTouchDist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      WB.showZoomHud(WB.cam.z);
    }
  }, true);

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'pen') {
      if (e.buttons > 0) isPenDown = true;
      lastPenActiveMs = performance.now();
      return;
    }
    if (e.pointerType !== 'touch') return;
    if (!activeTouchPointers.has(e.pointerId)) return;

    activeTouchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (isTouchGesture) {
      e.preventDefault();
      e.stopPropagation();
      if (activeTouchPointers.size >= 2) {
        const pts = Array.from(activeTouchPointers.values());
        const p0 = pts[0];
        const p1 = pts[1];
        const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
        const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);

        WB.cam.x += (mid.x - lastTouchMid.x);
        WB.cam.y += (mid.y - lastTouchMid.y);

        if (lastTouchDist > 12 && dist > 12) {
          const oldZ = WB.cam.z;
          const scaleFactor = dist / lastTouchDist;
          const newZ = Math.min(4, Math.max(0.2, +(oldZ * scaleFactor).toFixed(4)));
          WB.cam.x = mid.x - (mid.x - WB.cam.x) * (newZ / oldZ);
          WB.cam.y = mid.y - (mid.y - WB.cam.y) * (newZ / oldZ);
          WB.cam.z = newZ;
        }

        lastTouchMid = mid;
        lastTouchDist = dist;
        WB.updateCameraUI();
        WB.showZoomHud(WB.cam.z);
      }
    }
  }, true);

  const finishTrackedTouchPointer = (e) => {
    if (e.pointerType === 'pen') {
      isPenDown = false;
      lastPenActiveMs = performance.now();
      return;
    }
    if (e.pointerType !== 'touch') return;
    if (!activeTouchPointers.has(e.pointerId)) return;

    activeTouchPointers.delete(e.pointerId);

    if (isTouchGesture) {
      e.stopPropagation();
      if (activeTouchPointers.size >= 2) {
        const pts = Array.from(activeTouchPointers.values());
        lastTouchMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        lastTouchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      } else if (activeTouchPointers.size === 0) {
        isTouchGesture = false;
        WB._isTouchGestureActive = false;
        touchFirstActionRollback = null;
      }
    }
  };

  window.addEventListener('pointerup', finishTrackedTouchPointer, true);
  window.addEventListener('pointercancel', finishTrackedTouchPointer, true);
  window.addEventListener('blur', () => {
    activeTouchPointers.clear();
    isTouchGesture = false;
    WB._isTouchGestureActive = false;
    isPenDown = false;
    touchFirstActionRollback = null;
  });

  canvas.addEventListener('dblclick', (e) => {
    const wPos = WB.toWorld(e.clientX, e.clientY);
    WB.handleDoubleActivateAt(wPos);
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (isTouchGesture || activeTouchPointers.size >= 2) return;
    if (shouldRejectBoardPalmTouch(e)) {
      e.preventDefault();
      return;
    }
    // Если уже рисует другой указатель (например, второй палец пришёл на долю мс раньше) — не начинаем новое действие
    if (isPointerDown && activePrimaryPointerId !== null && e.pointerId !== activePrimaryPointerId) {
      return;
    }

    WB.closeAllDropdowns();
    if (document.activeElement && document.activeElement.classList.contains('widget-body')) {
      document.activeElement.blur();
    }
    try { window.getSelection?.()?.removeAllRanges?.(); } catch (_) {}

    let wPos = WB.toWorld(e.clientX, e.clientY);
    WB.mouseWorld = wPos;

    // Распознавание двойного нажатия (double-tap) на сенсорных экранах (телефон/планшет)
    if (e.pointerType === 'touch') {
      const now = performance.now();
      if (now - lastTapTime < 380 && Math.hypot(wPos.x - lastTapWorld.x, wPos.y - lastTapWorld.y) < 42 / WB.cam.z) {
        if (WB.handleDoubleActivateAt(wPos)) {
          lastTapTime = 0;
          return;
        }
      }
      lastTapTime = now;
      lastTapWorld = { x: wPos.x, y: wPos.y };
    }

    if (e.button === 1 || isSpacePressed || WB.currentTool === 'hand') {
      isPanning = true;
      activePrimaryPointerId = e.pointerId;
      panStart = { x: e.clientX - WB.cam.x, y: e.clientY - WB.cam.y };
      canvas.style.cursor = 'grabbing';
      if (e.pointerType !== 'touch') {
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      }
      return;
    }

    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (WB.isStudentBlocked && WB.userRole === 'student') {
      return;
    }

    // Сохраняем откат первого касания для инструментов, которые мутируют доску до начала щипка
    if (e.pointerType === 'touch') {
      if (WB.autoShapeEnabled || WB.currentTool === 'eraser' || WB.currentTool === 'select') {
        touchFirstActionRollback = {
          kind: 'snapshot',
          stateJson: JSON.stringify(WB.state),
          linearChainJson: WB.linearChain ? JSON.stringify(WB.linearChain) : null,
          selectionStrokeIds: Array.from(WB.selection?.strokeIds || []),
          selectionWidgetIds: Array.from(WB.selection?.widgetIds || [])
        };
      } else {
        touchFirstActionRollback = null;
      }
    } else {
      touchFirstActionRollback = null;
    }

    // Линейный режим: построение прямых от точки к точке по кликам (выход — кнопка «Линейный» или Enter)
    if (WB.autoShapeEnabled) {
      const z = WB.cam?.z || 1;
      const chain = WB.linearChain || {
        anchor: null,
        chainStart: null,
        segmentCount: 0,
        anchorSource: 'none',
        previewEnd: null,
        endSource: 'none'
      };

      if (!chain.anchor) {
        const startSnap = WB.snapPointCombined(wPos, null, {
          snapToVertex: true,
          snapToGrid: !!WB.snapToGridEnabled
        });
        const pt = { x: startSnap.x, y: startSnap.y };
        WB.linearChain = {
          anchor: pt,
          chainStart: { x: pt.x, y: pt.y },
          segmentCount: 0,
          anchorSource: startSnap.source,
          previewEnd: { x: pt.x, y: pt.y },
          endSource: startSnap.source
        };
        WB.linearSnapState = {
          active: true,
          pointToPoint: true,
          startPt: pt,
          startSource: startSnap.source,
          endPt: pt,
          endSource: startSnap.source,
          chainStart: WB.linearChain.chainStart,
          segmentCount: 0,
          showPreviewLine: true
        };
        canvas.style.cursor = 'crosshair';
        return;
      }

      const endSnap = WB.computeLinearSnappedEndpoint(chain.anchor, wPos, null, {
        snapToVertex: true,
        snapToGrid: !!WB.snapToGridEnabled,
        forceAngleSnap: e.shiftKey
      });
      const nextPt = { x: endSnap.x, y: endSnap.y };
      const minSeg = 4 / z;
      const distFromAnchor = Math.hypot(nextPt.x - chain.anchor.x, nextPt.y - chain.anchor.y);

      if (distFromAnchor < minSeg) {
        // Повторный клик в текущую опорную точку завершает текущую цепочку, оставляя линейный режим активным
        WB.resetLinearChain();
        return;
      }

      const segType = WB.currentTool === 'arrow' ? 'arrow' : 'line';
      const isHl = WB.currentTool === 'highlighter';
      const newStroke = {
        id: Date.now() + Math.random(),
        type: segType,
        isHighlighter: isHl,
        color: colorPicker.value,
        size: Number(sizePicker.value),
        lineStyle: WB.currentLineStyle || 'solid',
        authorRole: WB.userRole || 'teacher',
        x1: chain.anchor.x,
        y1: chain.anchor.y,
        x2: nextPt.x,
        y2: nextPt.y
      };
      WB.state.strokes.push(newStroke);
      if (typeof WB.bindConnectorEndpoints === 'function') {
        WB.bindConnectorEndpoints(newStroke);
      }
      WB.saveHistory();

      const closesLoop = Boolean(chain.chainStart) &&
        chain.segmentCount >= 2 &&
        Math.hypot(nextPt.x - chain.chainStart.x, nextPt.y - chain.chainStart.y) <= Math.max(minSeg, 6 / z);

      if (closesLoop) {
        WB.resetLinearChain();
      } else {
        WB.linearChain = {
          anchor: nextPt,
          chainStart: chain.chainStart || chain.anchor,
          segmentCount: (chain.segmentCount || 0) + 1,
          anchorSource: endSnap.source,
          previewEnd: { x: nextPt.x, y: nextPt.y },
          endSource: endSnap.source
        };
        WB.linearSnapState = {
          active: true,
          pointToPoint: true,
          startPt: nextPt,
          startSource: endSnap.source,
          endPt: nextPt,
          endSource: endSnap.source,
          chainStart: WB.linearChain.chainStart,
          segmentCount: WB.linearChain.segmentCount,
          showPreviewLine: true
        };
      }
      canvas.style.cursor = 'crosshair';
      return;
    }

    isPointerDown = true;
    activePrimaryPointerId = e.pointerId;
    WB.isPointerDrawing = WB.currentTool !== 'select' && WB.currentTool !== 'eraser' && WB.currentTool !== 'laser';
    if (e.pointerType !== 'touch') {
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    }

    if (WB.currentTool === 'select') {
      const active3d = WB.getActive3DStroke();
      if (active3d && WB.selection.bounds) {
        const padded3dBox = {
          x: WB.selection.bounds.x - 24 / WB.cam.z,
          y: WB.selection.bounds.y - 24 / WB.cam.z,
          w: WB.selection.bounds.w + 48 / WB.cam.z,
          h: WB.selection.bounds.h + 48 / WB.cam.z
        };
        const inside3d = WB.pointInBox(wPos.x, wPos.y, padded3dBox);

        if (WB.s3dEditor.mode === 'rotate' && inside3d) {
          const cfg = WB.ensure3DConfig(active3d);
          selectMode = 'rotate-3d';
          rotate3dState = {
            stroke: active3d,
            startX: e.clientX,
            startY: e.clientY,
            startYaw: Number(cfg.yaw) || 0,
            startPitch: Number(cfg.pitch) || 0
          };
          canvas.style.cursor = 'grabbing';
          return;
        }

        if (WB.s3dEditor.mode === 'point' && inside3d) {
          WB.add3DPointAtWorldPos(active3d, wPos.x, wPos.y);
          WB.saveHistory();
          WB.sync3DFloatingUI();
          selectMode = 'none';
          return;
        }

        if ((WB.s3dEditor.mode === 'line' || WB.s3dEditor.mode === 'plane') && inside3d) {
          const cfg = WB.ensure3DConfig(active3d);
          let anchor = WB.findNearest3DAnchor(active3d, wPos.x, wPos.y, 28 / WB.cam.z);
          if (!anchor) {
            const newPt = WB.add3DPointAtWorldPos(active3d, wPos.x, wPos.y);
            anchor = { ref: newPt.id, label: newPt.label, isCustom: true };
          }
          if (anchor && !WB.s3dEditor.pendingPointRefs.includes(anchor.ref)) {
            WB.s3dEditor.pendingPointRefs.push(anchor.ref);
          }

          const prim = WB.get3DShapePrimitives(active3d);
          const getRefLabel = (ref) => {
            const v = (prim?.vertices2d || []).find(item => item.id === ref);
            if (v) return v.label;
            const cp = (cfg.customPoints || []).find(item => item.id === ref);
            return cp ? cp.label : '';
          };

          if (WB.s3dEditor.mode === 'line' && WB.s3dEditor.pendingPointRefs.length >= 2) {
            const [aRef, bRef] = WB.s3dEditor.pendingPointRefs;
            const label = `${getRefLabel(aRef)}${getRefLabel(bRef)}`;
            cfg.customLines.push({
              id: 'ln_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
              label,
              aRef,
              bRef
            });
            WB.s3dEditor.pendingPointRefs = [];
            WB.saveHistory();
          } else if (WB.s3dEditor.mode === 'plane' && WB.s3dEditor.pendingPointRefs.length >= 3) {
            const refs = WB.s3dEditor.pendingPointRefs.slice(0, 3);
            const label = refs.map(getRefLabel).join('');
            cfg.customPlanes.push({
              id: 'pl_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
              label,
              pointRefs: refs
            });
            WB.s3dEditor.pendingPointRefs = [];
            WB.saveHistory();
          }

          WB.sync3DFloatingUI();
          selectMode = 'none';
          return;
        }
      }

      // 1. Клик по круглой ручке края отрезка или вершины фигуры/осей/3D-точки
      const vHit = WB.getVertexHandleHit(wPos.x, wPos.y);
      if (vHit) {
        selectMode = 'drag-vertex';
        activeVertexHit = vHit;
        canvas.style.cursor = 'crosshair';
        return;
      }

      // 2. Клик по квадратному маркеру угла рамки для масштабирования
      const corner = WB.getSelectionCornerHit(wPos.x, wPos.y);
      const hasUnlockedInSel = WB.selection.widgetIds.size > 0 || WB.state.strokes.some(s => WB.selection.strokeIds.has(s.id) && !s.locked);
      if (corner && WB.selection.bounds && hasUnlockedInSel) {
        selectMode = 'scale-selection';
        const b = WB.selection.bounds;
        const ax = (corner === 'nw' || corner === 'sw') ? b.x + b.w : b.x;
        const ay = (corner === 'nw' || corner === 'ne') ? b.y + b.h : b.y;
        const cx0 = (corner === 'nw' || corner === 'sw') ? b.x : b.x + b.w;
        const cy0 = (corner === 'nw' || corner === 'ne') ? b.y : b.y + b.h;

        const strokesSnap = {};
        for (const s of WB.state.strokes) {
          if (WB.selection.strokeIds.has(s.id) && !s.locked) strokesSnap[s.id] = JSON.parse(JSON.stringify(s));
        }
        const widgetsSnap = {};
        for (const w of WB.state.widgets) {
          if (WB.selection.widgetIds.has(w.id)) widgetsSnap[w.id] = JSON.parse(JSON.stringify(w));
        }

        scaleSnapshot = { ax, ay, cx0, cy0, strokesSnap, widgetsSnap };
        return;
      }

      // 3. Клик внутри выделенной области — параллельное перемещение
      if (WB.selection.bounds && WB.pointInBox(wPos.x, wPos.y, WB.selection.bounds)) {
        selectMode = 'drag-selection';
        dragLastWorld = wPos;
        canvas.style.cursor = 'move';
        return;
      }

      // 4. Клик по одиночному объекту
      const hitWidget = WB.findWidgetAt(wPos.x, wPos.y);
      const hitStroke = !hitWidget ? WB.findStrokeAt(wPos.x, wPos.y) : null;

      if (hitWidget || hitStroke) {
        if (!e.shiftKey) WB.clearSelection();
        if (hitWidget) WB.selection.widgetIds.add(hitWidget.id);
        if (hitStroke) WB.selection.strokeIds.add(hitStroke.id);
        WB.updateSelectionBounds();
        selectMode = 'drag-selection';
        dragLastWorld = wPos;
        canvas.style.cursor = 'move';
        return;
      }

      // 5. Клик в пустоту — растягивание рамки выделения
      if (!e.shiftKey) WB.clearSelection();
      selectMode = 'marquee';
      WB.selection.marquee = { x1: wPos.x, y1: wPos.y, x2: wPos.x, y2: wPos.y };
      return;
    }

    if (WB.currentTool === 'eraser') {
      const radius = (Number(sizePicker.value) * 3) / WB.cam.z;
      lastEraseWorld = wPos;
      WB.eraseAt(wPos.x, wPos.y, radius);
      return;
    }

    if (WB.currentTool === 'laser') {
      WB.laserPoints.push({ x: wPos.x, y: wPos.y, time: performance.now() });
      return;
    }

    // Единая привязка начальной точки: Линейный режим (вершины) + К узлам (сетка)
    let startSnap = { x: wPos.x, y: wPos.y, source: 'none' };
    if (WB.currentTool === 'pen' || WB.currentTool === 'highlighter') {
      if (WB.autoShapeEnabled) {
        startSnap = WB.snapPointCombined(wPos, null, {
          snapToVertex: true,
          snapToGrid: !!WB.snapToGridEnabled
        });
        wPos = { x: startSnap.x, y: startSnap.y };
      }
    } else if (WB.autoShapeEnabled || WB.snapToGridEnabled) {
      startSnap = WB.snapPointCombined(wPos, null, {
        snapToVertex: !!WB.autoShapeEnabled,
        snapToGrid: !!WB.snapToGridEnabled
      });
      wPos = { x: startSnap.x, y: startSnap.y };
    }

    if (WB.currentTool === 'pen' || WB.currentTool === 'highlighter') {
      currentStroke = {
        id: Date.now() + Math.random(),
        type: WB.currentTool,
        isHighlighter: WB.currentTool === 'highlighter',
        color: colorPicker.value,
        size: Number(sizePicker.value),
        lineStyle: WB.currentLineStyle || 'solid',
        authorRole: WB.userRole || 'teacher',
        points: [{ x: wPos.x, y: wPos.y }]
      };
      if (WB.autoShapeEnabled) {
        currentStroke._linearStartPt = { x: wPos.x, y: wPos.y };
        currentStroke._linearStartSource = startSnap.source;
        currentStroke._linearEndPt = { x: wPos.x, y: wPos.y };
        currentStroke._linearEndSource = startSnap.source;
        WB.linearSnapState = {
          active: true,
          strokeId: currentStroke.id,
          startPt: { x: wPos.x, y: wPos.y },
          startSource: startSnap.source,
          endPt: { x: wPos.x, y: wPos.y },
          endSource: startSnap.source,
          showPreviewLine: true
        };
      }
      WB.state.strokes.push(currentStroke);
    } else if (WB.currentTool === 'axes') {
      // Создание прямоугольной декартовой системы координат без подписи названий осей
      currentStroke = {
        id: Date.now() + Math.random(),
        type: 'axes',
        color: colorPicker.value,
        size: Math.max(2, Number(sizePicker.value)),
        lineStyle: WB.currentLineStyle || 'solid',
        authorRole: WB.userRole || 'teacher',
        x1: wPos.x, y1: wPos.y,
        x2: wPos.x, y2: wPos.y,
        step: WB.gridSize || 32
      };
      WB.state.strokes.push(currentStroke);
    } else if ((WB.ALL_SHAPE_TYPES || ['line', 'arrow', 'rect', 'ellipse']).includes(WB.currentTool)) {
      currentStroke = {
        id: Date.now() + Math.random(),
        type: WB.currentTool,
        color: colorPicker.value,
        size: Number(sizePicker.value),
        lineStyle: WB.currentLineStyle || 'solid',
        authorRole: WB.userRole || 'teacher',
        originX: wPos.x,
        originY: wPos.y,
        fromCenter: !!WB.shapeDrawFromCenter,
        x1: wPos.x, y1: wPos.y,
        x2: wPos.x, y2: wPos.y
      };
      if (WB.autoShapeEnabled || WB.snapToGridEnabled) {
        currentStroke._linearStartSource = startSnap.source;
        WB.linearSnapState = {
          active: true,
          startPt: { x: wPos.x, y: wPos.y },
          startSource: startSnap.source,
          endPt: { x: wPos.x, y: wPos.y },
          endSource: startSnap.source,
          showPreviewLine: false
        };
      }
      if (WB.is3DShapeStroke(currentStroke)) {
        WB.ensure3DConfig(currentStroke);
      }
      WB.state.strokes.push(currentStroke);
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (isTouchGesture || activeTouchPointers.size >= 2) return;
    if ((isPointerDown || isPanning) && activePrimaryPointerId !== null && e.pointerId !== activePrimaryPointerId) {
      return;
    }

    let wPos = WB.toWorld(e.clientX, e.clientY);
    WB.mouseWorld = wPos;

    if (isPanning) {
      WB.cam.x = e.clientX - panStart.x;
      WB.cam.y = e.clientY - panStart.y;
      WB.updateCameraUI();
      if (typeof WB.sync3DFloatingUI === 'function') WB.sync3DFloatingUI();
      return;
    }

    if (WB.autoShapeEnabled && !isPointerDown) {
      canvas.style.cursor = 'crosshair';
      if (WB.linearChain && WB.linearChain.anchor) {
        const endSnap = WB.computeLinearSnappedEndpoint(WB.linearChain.anchor, wPos, null, {
          snapToVertex: true,
          snapToGrid: !!WB.snapToGridEnabled,
          forceAngleSnap: e.shiftKey
        });
        WB.linearChain.previewEnd = { x: endSnap.x, y: endSnap.y };
        WB.linearChain.endSource = endSnap.source;
        WB.linearSnapState = {
          active: true,
          pointToPoint: true,
          startPt: WB.linearChain.anchor,
          startSource: WB.linearChain.anchorSource || 'none',
          endPt: WB.linearChain.previewEnd,
          endSource: endSnap.source,
          chainStart: WB.linearChain.chainStart,
          segmentCount: WB.linearChain.segmentCount || 0,
          showPreviewLine: true
        };
      }
      return;
    }

    if (!isPointerDown && WB.currentTool === 'select') {
      const active3d = WB.getActive3DStroke();
      if (active3d && WB.s3dEditor.mode === 'rotate') {
        canvas.style.cursor = 'grab';
        return;
      }
      if (active3d && (WB.s3dEditor.mode === 'point' || WB.s3dEditor.mode === 'line' || WB.s3dEditor.mode === 'plane')) {
        canvas.style.cursor = 'crosshair';
        return;
      }
      if (WB.getVertexHandleHit(wPos.x, wPos.y)) {
        canvas.style.cursor = 'pointer';
      } else {
        const corner = WB.getSelectionCornerHit(wPos.x, wPos.y);
        if (corner) {
          canvas.style.cursor = (corner === 'nw' || corner === 'se') ? 'nwse-resize' : 'nesw-resize';
        } else if (WB.selection.bounds && WB.pointInBox(wPos.x, wPos.y, WB.selection.bounds)) {
          canvas.style.cursor = 'move';
        } else {
          canvas.style.cursor = 'default';
        }
      }
      return;
    }

    if (!isPointerDown) return;

    if (WB.currentTool === 'select') {
      if (selectMode === 'rotate-3d' && rotate3dState && rotate3dState.stroke) {
        const cfg = WB.ensure3DConfig(rotate3dState.stroke);
        const dx = e.clientX - rotate3dState.startX;
        const dy = e.clientY - rotate3dState.startY;
        cfg.yaw = Number((rotate3dState.startYaw + dx * 0.012).toFixed(4));
        cfg.pitch = Math.max(-1.35, Math.min(1.35, Number((rotate3dState.startPitch + dy * 0.012).toFixed(4))));
        return;
      }
      if (selectMode === 'drag-vertex' && activeVertexHit) {
        WB.moveSingleVertex(activeVertexHit, wPos.x, wPos.y);
      } else if (selectMode === 'scale-selection' && scaleSnapshot) {
        let sx = (wPos.x - scaleSnapshot.ax) / (scaleSnapshot.cx0 - scaleSnapshot.ax || 1);
        let sy = (wPos.y - scaleSnapshot.ay) / (scaleSnapshot.cy0 - scaleSnapshot.ay || 1);
        if (e.shiftKey) {
          const uniform = Math.max(Math.abs(sx), Math.abs(sy));
          sx = uniform * Math.sign(sx || 1);
          sy = uniform * Math.sign(sy || 1);
        }
        if (Math.abs(sx) < 0.15) sx = 0.15 * Math.sign(sx || 1);
        if (Math.abs(sy) < 0.15) sy = 0.15 * Math.sign(sy || 1);
        WB.scaleSelectionFromSnapshot(scaleSnapshot, sx, sy);
      } else if (selectMode === 'drag-selection') {
        const dx = wPos.x - dragLastWorld.x;
        const dy = wPos.y - dragLastWorld.y;
        WB.moveSelection(dx, dy);
        dragLastWorld = wPos;
      } else if (selectMode === 'marquee' && WB.selection.marquee) {
        WB.selection.marquee.x2 = wPos.x;
        WB.selection.marquee.y2 = wPos.y;

        const m = WB.selection.marquee;
        const box = {
          x: Math.min(m.x1, m.x2),
          y: Math.min(m.y1, m.y2),
          w: Math.abs(m.x2 - m.x1),
          h: Math.abs(m.y2 - m.y1)
        };

        WB.selection.strokeIds.clear();
        WB.selection.widgetIds.clear();

        for (const s of WB.state.strokes) {
          if (WB.boxesIntersect(box, WB.getStrokeBounds(s))) {
            WB.selection.strokeIds.add(s.id);
          }
        }
        for (const w of WB.state.widgets) {
          if (WB.boxesIntersect(box, WB.getWidgetBounds(w))) {
            WB.selection.widgetIds.add(w.id);
          }
        }
        WB.updateSelectionBounds();
      }
      return;
    }

    if (WB.currentTool === 'eraser') {
      const radius = (Number(sizePicker.value) * 3) / WB.cam.z;
      WB.eraseSegment(lastEraseWorld.x, lastEraseWorld.y, wPos.x, wPos.y, radius);
      lastEraseWorld = wPos;
      return;
    }

    if (WB.currentTool === 'laser') {
      WB.laserPoints.push({ x: wPos.x, y: wPos.y, time: performance.now() });
      return;
    }

    if (!currentStroke) return;

    if (currentStroke.points) {
      const lastPt = currentStroke.points[currentStroke.points.length - 1];
      if (Math.hypot(wPos.x - lastPt.x, wPos.y - lastPt.y) >= 2 / WB.cam.z) {
        currentStroke.points.push({ x: wPos.x, y: wPos.y });
        if (typeof WB.streamBoardStrokeLive === 'function') {
          WB.streamBoardStrokeLive(currentStroke);
        }

        if (WB.autoShapeEnabled && (WB.currentTool === 'pen' || WB.currentTool === 'highlighter')) {
          const pts = currentStroke.points;
          const p0 = currentStroke._linearStartPt || pts[0];
          let pathLen = 0;
          for (let i = 1; i < pts.length; i++) {
            pathLen += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
          }
          const directDist = Math.hypot(wPos.x - pts[0].x, wPos.y - pts[0].y);
          const isStraightSoFar = pathLen < 22 / WB.cam.z || (directDist / Math.max(1, pathLen)) > 0.86;

          if (isStraightSoFar) {
            const endSnap = WB.computeLinearSnappedEndpoint(p0, wPos, currentStroke.id, {
              snapToVertex: true,
              snapToGrid: !!WB.snapToGridEnabled,
              forceAngleSnap: e.shiftKey
            });
            currentStroke._linearEndPt = { x: endSnap.x, y: endSnap.y };
            currentStroke._linearEndSource = endSnap.source;
            WB.linearSnapState = {
              active: true,
              strokeId: currentStroke.id,
              startPt: p0,
              startSource: currentStroke._linearStartSource || 'none',
              endPt: { x: endSnap.x, y: endSnap.y },
              endSource: endSnap.source,
              showPreviewLine: true
            };
          } else {
            currentStroke._linearEndPt = null;
            currentStroke._linearEndSource = null;
            const cornerSnap = WB.snapPointCombined(wPos, currentStroke.id, {
              snapToVertex: true,
              snapToGrid: !!WB.snapToGridEnabled
            });
            WB.linearSnapState = cornerSnap.source === 'vertex'
              ? {
                  active: true,
                  strokeId: currentStroke.id,
                  startPt: p0,
                  startSource: currentStroke._linearStartSource || 'none',
                  endPt: { x: cornerSnap.x, y: cornerSnap.y },
                  endSource: 'vertex',
                  showPreviewLine: false
                }
              : null;
          }

          clearTimeout(shapeHoldTimer);
          const strokeRef = currentStroke;
          shapeHoldTimer = setTimeout(() => {
            if (isPointerDown && currentStroke === strokeRef) {
              const shapeName = WB.tryConvertInkToShape(strokeRef);
              if (shapeName) {
                currentStroke = null;
                WB.linearSnapState = null;
                WB.saveHistory();
              }
            }
          }, 420);
        }
      }
    } else {
      let finalX = wPos.x;
      let finalY = wPos.y;
      let endSource = 'none';

      if (currentStroke.type === 'line' || currentStroke.type === 'arrow') {
        const endSnap = WB.computeLinearSnappedEndpoint(
          { x: currentStroke.x1, y: currentStroke.y1 },
          wPos,
          currentStroke.id,
          {
            snapToVertex: !!WB.autoShapeEnabled,
            snapToGrid: !!WB.snapToGridEnabled,
            forceAngleSnap: e.shiftKey
          }
        );
        finalX = endSnap.x;
        finalY = endSnap.y;
        endSource = endSnap.source;
      } else if (WB.autoShapeEnabled || WB.snapToGridEnabled) {
        const endSnap = WB.snapPointCombined(wPos, currentStroke.id, {
          snapToVertex: !!WB.autoShapeEnabled,
          snapToGrid: !!WB.snapToGridEnabled
        });
        finalX = endSnap.x;
        finalY = endSnap.y;
        endSource = endSnap.source;
      }

      if (WB.autoShapeEnabled || WB.snapToGridEnabled) {
        WB.linearSnapState = {
          active: true,
          startPt: { x: currentStroke.x1, y: currentStroke.y1 },
          startSource: currentStroke._linearStartSource || 'none',
          endPt: { x: finalX, y: finalY },
          endSource,
          showPreviewLine: false
        };
      }

      if (currentStroke.fromCenter && currentStroke.type !== 'line' && currentStroke.type !== 'arrow' && currentStroke.type !== 'axes') {
        const ox = currentStroke.originX ?? currentStroke.x1;
        const oy = currentStroke.originY ?? currentStroke.y1;
        currentStroke.x1 = 2 * ox - finalX;
        currentStroke.y1 = 2 * oy - finalY;
        currentStroke.x2 = finalX;
        currentStroke.y2 = finalY;
      } else {
        currentStroke.x2 = finalX;
        currentStroke.y2 = finalY;
      }
      if (typeof WB.streamBoardStrokeLive === 'function') {
        WB.streamBoardStrokeLive(currentStroke);
      }
    }
  });

  const handlePointerEnd = (e) => {
    if (isTouchGesture) return;
    if ((isPointerDown || isPanning) && activePrimaryPointerId !== null && e && e.pointerId !== undefined && e.pointerId !== activePrimaryPointerId) {
      return;
    }
    clearTimeout(shapeHoldTimer);
    if (!(WB.autoShapeEnabled && WB.linearChain && WB.linearChain.anchor && WB.linearSnapState && WB.linearSnapState.pointToPoint)) {
      WB.linearSnapState = null;
    }

    try {
      if (e && e.pointerId !== undefined && canvas.hasPointerCapture?.(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
    } catch (_) {}

    if (isPanning) {
      isPanning = false;
      activePrimaryPointerId = null;
      canvas.style.cursor = WB.autoShapeEnabled
        ? 'crosshair'
        : (WB.currentTool === 'hand' ? 'grab' : (WB.currentTool === 'select' ? 'default' : 'crosshair'));
    }

    if (isPointerDown) {
      isPointerDown = false;
      activePrimaryPointerId = null;
      touchFirstActionRollback = null;
      WB.isPointerDrawing = false;
      if (WB.currentTool === 'select') {
        WB.selection.marquee = null;
        if (selectMode === 'rotate-3d' && rotate3dState) {
          rotate3dState = null;
          WB.saveHistory();
          WB.sync3DFloatingUI();
        } else if (selectMode === 'drag-vertex' && activeVertexHit) {
          const s = activeVertexHit.stroke;
          if (s.type === 'line' || s.type === 'arrow') WB.bindConnectorEndpoints(s);
          WB.saveHistory();
        } else if (selectMode === 'drag-selection' || selectMode === 'scale-selection') {
          WB.saveHistory();
        }
        selectMode = 'none';
        scaleSnapshot = null;
        activeVertexHit = null;
      } else if (currentStroke || WB.currentTool === 'eraser') {
        if (currentStroke && currentStroke.points && WB.autoShapeEnabled) {
          WB.tryConvertInkToShape(currentStroke);
        }
        if (currentStroke && (currentStroke.type === 'arrow' || currentStroke.type === 'line')) {
          WB.bindConnectorEndpoints(currentStroke);
        }
        const finishedStroke = currentStroke;
        currentStroke = null;

        // Если создана 3D-фигура — задаём минимальный размер (если был клик) и сразу открываем 3D-панель
        if (finishedStroke && typeof WB.is3DShapeStroke === 'function' && WB.is3DShapeStroke(finishedStroke)) {
          if (Math.abs(finishedStroke.x2 - finishedStroke.x1) < 36 || Math.abs(finishedStroke.y2 - finishedStroke.y1) < 36) {
            finishedStroke.x2 = finishedStroke.x1 + 192;
            finishedStroke.y2 = finishedStroke.y1 + 192;
          }
          WB.ensure3DConfig(finishedStroke);
          WB.setTool('select');
          WB.clearSelection();
          WB.selection.strokeIds.add(finishedStroke.id);
          WB.s3dEditor.strokeId = finishedStroke.id;
          WB.s3dEditor.mode = 'move';
          WB.s3dEditor.settingsOpen = false;
          WB.s3dEditor.activeTab = 'dimensions';
          WB.s3dEditor.customPos = null;
          WB.s3dEditor.customOffset = null;
          WB.updateSelectionBounds();
        }

        WB.saveHistory();
      }
    }
  };

  window.addEventListener('pointerup', handlePointerEnd);
  window.addEventListener('pointercancel', handlePointerEnd);

  let pendingPasteFallback = null;
  let lastKeyCopyTime = 0;

  const isEditableTarget = (target) => {
    if (!target) return false;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
    if (target.isContentEditable) {
      // Ячейки таблицы всегда доступны для редактирования; для текста/стикера требуется .widget.editing
      const widgetEl = target.closest?.('.widget');
      if (widgetEl) {
        if (widgetEl.classList.contains('table-widget')) return true;
        return widgetEl.classList.contains('editing');
      }
      return true;
    }
    return false;
  };

  window.addEventListener('copy', (e) => {
    if (isEditableTarget(e.target)) return;
    if (WB.pdfEditor && WB.pdfEditor.isOpen) return;
    const hasBoardSel = WB.selection && (WB.selection.strokeIds.size > 0 || WB.selection.widgetIds.size > 0);
    if (!hasBoardSel) return;

    const justCopied = performance.now() - lastKeyCopyTime < 150;
    if (typeof WB.copySelection === 'function') {
      WB.copySelection(justCopied);
    }
    if (e.clipboardData) {
      e.preventDefault();
      e.clipboardData.setData('application/x-whiteboard-pro', String(WB.clipboard?.seq || Date.now()));
      e.clipboardData.setData('text/plain', '');
    }
  });

  window.addEventListener('cut', (e) => {
    if (isEditableTarget(e.target)) return;
    if (WB.pdfEditor && WB.pdfEditor.isOpen) return;
    const hasBoardSel = WB.selection && (WB.selection.strokeIds.size > 0 || WB.selection.widgetIds.size > 0);
    if (!hasBoardSel) return;

    e.preventDefault();
    if (typeof WB.cutSelection === 'function') {
      WB.cutSelection();
    }
    if (e.clipboardData) {
      e.clipboardData.setData('application/x-whiteboard-pro', String(WB.clipboard?.seq || Date.now()));
      e.clipboardData.setData('text/plain', '');
    }
  });

  window.addEventListener('paste', (e) => {
    clearTimeout(pendingPasteFallback);
    pendingPasteFallback = null;
    if (isEditableTarget(e.target)) return;
    if (WB.pdfEditor && WB.pdfEditor.isOpen) return;

    const types = Array.from(e.clipboardData?.types || []);
    const hasInternalMarker = types.includes('application/x-whiteboard-pro');

    if (hasInternalMarker) {
      e.preventDefault();
      if (typeof WB.pasteClipboard === 'function') WB.pasteClipboard();
      return;
    }

    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (ev) => WB.insertImageSource(ev.target.result);
          reader.readAsDataURL(file);
          e.preventDefault();
          return;
        }
      }
    }

    if (WB.clipboard && ((WB.clipboard.strokes && WB.clipboard.strokes.length > 0) || (WB.clipboard.widgets && WB.clipboard.widgets.length > 0))) {
      e.preventDefault();
      if (typeof WB.pasteClipboard === 'function') WB.pasteClipboard();
    }
  });

  let nudgeSaveTimer = null;

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (WB.pdfEditor && WB.pdfEditor.isOpen) {
        const subModalOpen = ['confirmActionModal', 'physicsModal', 'latexModal'].some(id => {
          const el = document.getElementById(id);
          return el && el.style.display && el.style.display !== 'none';
        });
        const subDropdownOpen = !!document.querySelector('.dropdown-menu.open, #pdfThumbsPopover.open, #pdfAddPagePopover.open');
        if (subModalOpen || subDropdownOpen) {
          WB.closeAllDropdowns();
          ['confirmActionModal', 'physicsModal', 'latexModal'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
          });
          return;
        }
        if (typeof WB.closePdfEditor === 'function') WB.closePdfEditor();
        return;
      }
      if (WB.autoShapeEnabled && WB.linearChain && WB.linearChain.anchor) {
        WB.resetLinearChain();
        return;
      }
      if (WB.s3dEditor && Array.isArray(WB.s3dEditor.pendingPointRefs) && WB.s3dEditor.pendingPointRefs.length > 0) {
        WB.s3dEditor.pendingPointRefs = [];
        WB.sync3DFloatingUI();
        return;
      }
      const hasOpenOverlay = !!document.querySelector('.dropdown-menu.open, #peersDropdown.open, #pagesDropdown.open, .s2d-popover.open') ||
        Array.from(document.querySelectorAll('.modal-backdrop')).some(m => m.style.display && m.style.display !== 'none');
      WB.closeAllDropdowns();
      WB.closeAllModals();
      if (!hasOpenOverlay && WB.selection && (WB.selection.strokeIds.size > 0 || WB.selection.widgetIds.size > 0)) {
        WB.clearSelection();
      }
      return;
    }

    if (isEditableTarget(e.target)) return;

    if (e.key === 'Enter' && WB.autoShapeEnabled && !(WB.pdfEditor && WB.pdfEditor.isOpen)) {
      const hasOpenModal = Array.from(document.querySelectorAll('.modal-backdrop')).some(
        m => m.style.display && m.style.display !== 'none'
      );
      if (!hasOpenModal) {
        e.preventDefault();
        e.stopPropagation();
        WB.setAutoShape(false);
        return;
      }
    }

    if (WB.pdfEditor && WB.pdfEditor.isOpen) {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey && typeof WB.pdfRedo === 'function') WB.pdfRedo();
        else if (typeof WB.pdfUndo === 'function') WB.pdfUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
        e.preventDefault();
        if (typeof WB.pdfRedo === 'function') WB.pdfRedo();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && WB.pdfEditor.selectedStroke) {
        e.preventDefault();
        const sel = WB.pdfEditor.selectedStroke;
        const arr = WB.pdfEditor.strokesByPage[sel.pageIdx];
        if (Array.isArray(arr)) {
          const i = arr.indexOf(sel.stroke);
          if (i !== -1) {
            arr.splice(i, 1);
            WB.pdfEditor.selectedStroke = null;
            if (typeof WB.pushPdfHistory === 'function') WB.pushPdfHistory();
            if (typeof WB.redrawPdfOverlay === 'function') WB.redrawPdfOverlay(sel.pageIdx);
          }
        }
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const pdfKeyMap = {
          KeyV: 'select', KeyH: 'hand', KeyP: 'pen',
          KeyM: 'highlighter', KeyL: 'laser', KeyE: 'eraser',
          KeyA: 'arrow', KeyR: 'rect', KeyQ: 'square',
          KeyO: 'ellipse', KeyC: 'circle', KeyW: 'triangle'
        };
        if (pdfKeyMap[e.code]) {
          e.preventDefault();
          WB.setTool(pdfKeyMap[e.code]);
          return;
        }
        if (e.code === 'KeyT') { e.preventDefault(); WB.addWidget('text'); return; }
        if (e.code === 'KeyS' || e.code === 'KeyN') { e.preventDefault(); WB.addWidget('note'); return; }
        if (e.code === 'KeyX') { e.preventDefault(); WB.openLatexModal(); return; }
        if (e.code === 'KeyF' && typeof WB.openPhysicsModal === 'function') { e.preventDefault(); WB.openPhysicsModal(); return; }
      }
      return;
    }

    if (e.key === '?' || e.key === 'F1') {
      e.preventDefault();
      WB.openShortcutsModal();
      return;
    }

    if (e.code === 'Space' && !isSpacePressed) {
      isSpacePressed = true;
      canvas.style.cursor = 'grab';
    }

    // Сдвиг выделенных объектов стрелками (4px, с Shift — на 1 шаг сетки)
    if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      if (WB.selection && (WB.selection.strokeIds.size > 0 || WB.selection.widgetIds.size > 0)) {
        e.preventDefault();
        const step = e.shiftKey ? (WB.gridSize || 32) : 4;
        const dx = e.key === 'ArrowLeft' ? -step : (e.key === 'ArrowRight' ? step : 0);
        const dy = e.key === 'ArrowUp' ? -step : (e.key === 'ArrowDown' ? step : 0);
        WB.moveSelection(dx, dy);
        clearTimeout(nudgeSaveTimer);
        nudgeSaveTimer = setTimeout(() => WB.saveHistory(), 280);
        return;
      }
    }

    // Горячие клавиши масштаба: Ctrl+0, Ctrl++, Ctrl+-
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (e.code === 'Digit0' || e.code === 'Numpad0') {
        e.preventDefault();
        WB.resetCamera();
        return;
      }
      if (e.code === 'Equal' || e.code === 'NumpadAdd') {
        e.preventDefault();
        WB.changeZoom(0.15);
        return;
      }
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
        e.preventDefault();
        WB.changeZoom(-0.15);
        return;
      }
    }

    // Горячие клавиши 1..7 для плавающей панели 3D-фигуры
    if (!e.ctrlKey && !e.metaKey && !e.altKey && WB.getActive3DStroke()) {
      if (e.code === 'Digit1') { e.preventDefault(); WB.set3DEditMode('move'); return; }
      if (e.code === 'Digit2') { e.preventDefault(); WB.set3DEditMode('rotate'); return; }
      if (e.code === 'Digit3') { e.preventDefault(); WB.set3DEditMode('point'); return; }
      if (e.code === 'Digit4') { e.preventDefault(); WB.set3DEditMode('line'); return; }
      if (e.code === 'Digit5') { e.preventDefault(); WB.set3DEditMode('plane'); return; }
      if (e.code === 'Digit6') { e.preventDefault(); WB.toggle3DSnapMode(); return; }
      if (e.code === 'Digit7') { e.preventDefault(); WB.toggle3DSettingsPanel(); return; }
    }

    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
      e.preventDefault();
      e.shiftKey ? WB.redo() : WB.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
      e.preventDefault();
      WB.redo();
      return;
    }
    const lowerKey = (e.key || '').toLowerCase();
    const isSelectAllKey = (e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'KeyA' || lowerKey === 'a' || lowerKey === 'ф');
    if (isSelectAllKey) {
      e.preventDefault();
      if (typeof WB.selectAllOnPage === 'function') WB.selectAllOnPage();
      return;
    }
    const isCopyKey = (e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'KeyC' || lowerKey === 'c' || lowerKey === 'с');
    const isCutKey = (e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'KeyX' || lowerKey === 'x' || lowerKey === 'ч');
    const isPasteKey = (e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'KeyV' || lowerKey === 'v' || lowerKey === 'м');

    if (isCopyKey) {
      if (WB.selection.strokeIds.size > 0 || WB.selection.widgetIds.size > 0) {
        lastKeyCopyTime = performance.now();
        if (typeof WB.copySelection === 'function') WB.copySelection();
        return;
      }
    }
    if (isCutKey) {
      if (WB.selection.strokeIds.size > 0 || WB.selection.widgetIds.size > 0) {
        e.preventDefault();
        if (typeof WB.cutSelection === 'function') WB.cutSelection();
        return;
      }
    }
    if (isPasteKey) {
      if (WB.clipboard && ((WB.clipboard.strokes && WB.clipboard.strokes.length > 0) || (WB.clipboard.widgets && WB.clipboard.widgets.length > 0))) {
        clearTimeout(pendingPasteFallback);
        pendingPasteFallback = setTimeout(() => {
          pendingPasteFallback = null;
          if (typeof WB.pasteClipboard === 'function') WB.pasteClipboard();
        }, 35);
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') {
      e.preventDefault();
      WB.duplicateSelection();
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      WB.deleteSelection();
      return;
    }

    // Горячие клавиши для режимов и вставки
    if (e.code === 'KeyG' || (e.shiftKey && e.code === 'KeyS')) {
      e.preventDefault();
      WB.toggleSnapToGrid();
      return;
    }
    if (e.code === 'KeyS' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      WB.addWidget('note');
      return;
    }
    if (e.code === 'KeyX' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      WB.openLatexModal();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyF') {
      e.preventDefault();
      WB.openSearchModal();
      return;
    }
    if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (typeof WB.openPhysicsModal === 'function') WB.openPhysicsModal();
      return;
    }

    const keyMap = {
      KeyV: 'select', KeyH: 'hand', KeyP: 'pen',
      KeyM: 'highlighter', KeyL: 'laser', KeyE: 'eraser',
      KeyA: 'arrow', KeyR: 'rect', KeyQ: 'square',
      KeyO: 'ellipse', KeyC: 'circle', KeyW: 'triangle'
    };
    if (keyMap[e.code] && !e.ctrlKey && !e.metaKey && !e.altKey) WB.setTool(keyMap[e.code]);
    if (e.code === 'KeyN' && !e.ctrlKey && !e.metaKey) WB.addWidget('note');
    if (e.code === 'KeyT' && !e.ctrlKey && !e.metaKey) WB.addWidget('text');
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      isSpacePressed = false;
      canvas.style.cursor = WB.currentTool === 'hand' ? 'grab' : (WB.currentTool === 'select' ? 'default' : 'crosshair');
    }
  });
});
