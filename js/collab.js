window.WB = window.WB || {};

// Список публичных WSS-серверов, доступных из РФ без VPN (с автопереключением)
WB.BROKERS = [
  { name: 'EMQX (Основной РФ/Азия)', url: 'wss://broker.emqx.io:8084/mqtt' },
  { name: 'HiveMQ (Резерв 1)', url: 'wss://broker.hivemq.com:8884/mqtt' },
  { name: 'Mosquitto (Резерв 2)', url: 'wss://test.mosquitto.org:8081/mqtt' }
];

WB.collab = {
  mode: 'offline', // 'offline' | 'connecting' | 'online'
  roomId: null,
  ws: null, // MQTT bridge WebSocket (работает в РФ без VPN через EMQX)
  serverWs: null, // Native Express WebSocket (/ws)
  serverWsReconnectTimer: null,
  serverPingTimer: null,
  helloRetryTimer: null,
  hasReceivedInit: false,
  bc: null, // Локальный канал между вкладками браузера
  pingTimer: null,
  brokerIdx: 0,
  brokerName: '',
  serverPublicBaseUrl: '',
  isPublicInternetUrl: false,
  isRoomPublished: false,
  tempLinkUrl: '',
  tempLinkBaseUrl: '',
  tempLinkIsTunnel: false,
  tempLinkLoading: false,
  tempLinkError: '',
  tempHeartbeatTimer: null,
  studentWatchTimer: null,
  serverSupportsWs: true,
  hasMqttPeer: false,
  wasKicked: false,
  kickedPeerIds: new Set(),
  lastSyncedBoard: { pageIndex: 0, pageCount: 1, strokes: new Map(), widgets: new Map() },
  liveStream: { id: null, sentPoints: 0, lastSentAt: 0 },
  lastViewSentAt: 0,
  syncRev: 0,
  pendingRoomPushTimer: null,
  seenMsgIds: [],
  seenMsgSet: new Set(),
  myId: 'u_' + Math.random().toString(36).substring(2, 9),
  myName: localStorage.getItem('wb_username') || (WB.userRole === 'student' ? 'Ученик' : 'Преподаватель'),
  myColor: ['#ef4444', '#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2'][Math.floor(Math.random() * 6)],
  remotePeers: {},
  editingPeerId: null,
  pendingJoinRoomId: null,
  isApplyingRemote: false
};

WB.peersDropdownView = 'list'; // 'list' | 'permissions'
WB.studentPermissions = {
  deleteStrokes: false,
  deleteObjects: false,
  editMaterials: true
};

WB.applyRoleUI = function() {
  const isStudent = WB.userRole === 'student';
  if (document.documentElement) {
    document.documentElement.classList.toggle('role-student', isStudent);
  }
  if (document.body) {
    document.body.classList.toggle('role-student', isStudent);
  }
  const titleInput = document.getElementById('boardTitleInput');
  if (titleInput) {
    titleInput.readOnly = isStudent;
    titleInput.tabIndex = isStudent ? -1 : 0;
  }
  if (isStudent && WB.peersDropdownView === 'permissions') {
    WB.peersDropdownView = 'list';
  }
};

WB.setPeersDropdownView = function(view, event) {
  if (event) event.stopPropagation();
  if (WB.userRole === 'student') {
    WB.peersDropdownView = 'list';
    return;
  }
  WB.peersDropdownView = view === 'permissions' ? 'permissions' : 'list';
  WB.renderPeersAvatarBar();
  if (typeof WB.repositionOpenHeaderPopovers === 'function') {
    WB.repositionOpenHeaderPopovers();
  }
};

WB.toggleStudentPermission = function(key, checked, event) {
  if (event) event.stopPropagation();
  if (WB.userRole === 'student') return;
  WB.studentPermissions = WB.studentPermissions || { deleteStrokes: false, deleteObjects: false, editMaterials: true };
  WB.studentPermissions[key] = !!checked;
  WB.broadcastData({
    type: 'student_permissions',
    permissions: WB.studentPermissions
  });
};

// --- ВСТРОЕННЫЙ МИНИ-КЛИЕНТ MQTT OVER WEBSOCKETS ---
function encodeVarInt(len) {
  const out = [];
  do {
    let b = len % 128;
    len = Math.floor(len / 128);
    if (len > 0) b |= 128;
    out.push(b);
  } while (len > 0);
  return out;
}

function decodeVarInt(buf, offset) {
  let mult = 1, val = 0, read = 0;
  while (true) {
    if (offset + read >= buf.length) return null;
    const b = buf[offset + read];
    val += (b & 127) * mult;
    mult *= 128;
    read++;
    if ((b & 128) === 0) break;
  }
  return { value: val, bytesRead: read };
}

function encodeMqttStr(str) {
  const bytes = new TextEncoder().encode(str);
  return [(bytes.length >> 8) & 0xff, bytes.length & 0xff, ...bytes];
}

function buildConnectPacket(clientId) {
  const body = [
    ...encodeMqttStr('MQTT'),
    0x04,
    0x02,
    0x00, 0x3c,
    ...encodeMqttStr(clientId)
  ];
  return new Uint8Array([0x10, ...encodeVarInt(body.length), ...body]);
}

function buildSubscribePacket(topic) {
  const body = [0x00, 0x01, ...encodeMqttStr(topic), 0x00];
  return new Uint8Array([0x82, ...encodeVarInt(body.length), ...body]);
}

function buildPublishPacket(topic, jsonStr) {
  const topicBytes = new Uint8Array(encodeMqttStr(topic));
  const payloadBytes = new TextEncoder().encode(jsonStr);
  const remLen = topicBytes.length + payloadBytes.length;
  const header = new Uint8Array([0x30, ...encodeVarInt(remLen)]);
  const pkt = new Uint8Array(header.length + remLen);
  pkt.set(header, 0);
  pkt.set(topicBytes, header.length);
  pkt.set(payloadBytes, header.length + topicBytes.length);
  return pkt;
}

// --- УПРАВЛЕНИЕ ЕДИНЫМ ОКНОМ «ПОДЕЛИТЬСЯ» (ОТДЕЛЬНАЯ СТРАНИЦА КОМНАТЫ В ИНТЕРНЕТЕ) ---
WB.sanitizeRoomId = function(raw) {
  const clean = String(raw || '').trim().replace(/[^a-z0-9_-]/gi, '');
  return /^[a-z0-9][a-z0-9_-]{2,47}$/i.test(clean) ? clean : '';
};

WB.isForeignCloudPreviewHost = function(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed);
    return /^ais-(dev|pre)-[a-z0-9-]+\.[a-z0-9-]+\.run\.app(?::\d+)?$/i.test(parsed.host);
  } catch (_) {
    return false;
  }
};

WB.normalizePublicOrigin = function(rawUrl) {
  let trimmed = String(rawUrl || '').trim();
  if (!trimmed) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    if (/^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(?:\/.*)?$/i.test(trimmed)) {
      trimmed = 'https://' + trimmed;
    } else {
      return '';
    }
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (_) {
    return '';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
  let pathname = parsed.pathname || '';
  pathname = pathname.replace(/\/(shared|room)\/[^/?#]*\/?$/i, '');
  pathname = pathname.replace(/\/index\.html?$/i, '');
  pathname = pathname.replace(/\/+$/, '');
  return `${parsed.protocol}//${parsed.host}${pathname}`;
};

WB.isLocalOrBrowserOnlyUrl = function(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return true;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (_) {
    return true;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
  return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(parsed.hostname);
};

WB.getShareLinkStyle = function() {
  try {
    const saved = localStorage.getItem('wb_share_link_style');
    if (saved === 'path' || saved === 'query' || saved === 'auto') return saved;
  } catch (_) {}
  return 'auto';
};

WB.setShareLinkStyle = function(style) {
  const clean = style === 'path' || style === 'query' ? style : 'auto';
  try { localStorage.setItem('wb_share_link_style', clean); } catch (_) {}
  WB.refreshShareModalLinkAndQR();
};

WB.detectPreferredLinkStyle = function(baseUrl, preferred) {
  const pref = preferred || WB.getShareLinkStyle();
  if (pref === 'path' || pref === 'query') return pref;
  const clean = WB.normalizePublicOrigin(baseUrl);
  if (!clean) return 'path';
  try {
    const parsed = new URL(clean);
    const hasSubpath = parsed.pathname && parsed.pathname !== '/' && parsed.pathname.length > 1;
    const isStaticHost = /(^|\.)(github\.io|gitlab\.io|netlify\.app|vercel\.app|pages\.dev|surge\.sh|yandexcloud\.net|hb\.vkcs\.cloud|selstorage\.ru)$/i.test(parsed.hostname);
    if (hasSubpath || isStaticHost) return 'query';
  } catch (_) {}
  return 'path';
};

WB.getCustomPublicHost = function() {
  try {
    return WB.normalizePublicOrigin(localStorage.getItem('wb_public_host_url') || '');
  } catch (_) {
    return '';
  }
};

WB.saveCustomPublicHost = function(valOverride) {
  const input = document.getElementById('customPublicHostInput');
  const raw = typeof valOverride === 'string' ? valOverride : (input ? input.value : '');
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    WB.resetCustomPublicHost();
    return;
  }
  const normalized = WB.normalizePublicOrigin(trimmed);
  if (!normalized || WB.isLocalOrBrowserOnlyUrl(normalized)) {
    if (typeof WB.showToast === 'function') {
      WB.showToast('Введите публичный интернет-адрес (например, https://my-board.cloudpub.ru)', 2800);
    }
    return;
  }
  try { localStorage.setItem('wb_public_host_url', normalized); } catch (_) {}
  if (input) input.value = normalized;
  WB.refreshShareModalLinkAndQR();
  if (WB.boardAccessOpen !== false) {
    WB.publishRoomToServer(WB.collab.roomId || WB.getOrCreatePersistentRoomId(false), false);
  }
  if (typeof WB.showToast === 'function') {
    WB.showToast('Адрес веб-сервера сохранён', 2000);
  }
};

WB.resetCustomPublicHost = function() {
  try { localStorage.removeItem('wb_public_host_url'); } catch (_) {}
  const input = document.getElementById('customPublicHostInput');
  if (input) input.value = '';
  WB.refreshShareModalLinkAndQR();
  if (typeof WB.showToast === 'function') {
    WB.showToast('Пользовательский адрес сброшен', 1800);
  }
};

WB.extractRoomInfoFromLocation = function() {
  const pathname = String(window.location.pathname || '');
  const sharedPath = pathname.match(/\/shared\/([^/?#]+)/i);
  if (sharedPath && sharedPath[1]) {
    try {
      const fromShared = WB.sanitizeRoomId(decodeURIComponent(sharedPath[1]));
      if (fromShared) return { roomId: fromShared, isSharedStudentLink: true };
    } catch (_) {}
  }
  const roomPath = pathname.match(/\/room\/([^/?#]+)/i);
  let roleIsStudent = false;
  try {
    const params = new URLSearchParams(window.location.search || '');
    roleIsStudent = params.get('role') === 'student';
    if (roomPath && roomPath[1]) {
      try {
        const fromPath = WB.sanitizeRoomId(decodeURIComponent(roomPath[1]));
        if (fromPath) return { roomId: fromPath, isSharedStudentLink: roleIsStudent };
      } catch (_) {}
    }
    const fromSharedQuery = WB.sanitizeRoomId(params.get('shared'));
    if (fromSharedQuery) return { roomId: fromSharedQuery, isSharedStudentLink: true };
    const fromQuery = WB.sanitizeRoomId(params.get('room'));
    if (fromQuery) return { roomId: fromQuery, isSharedStudentLink: roleIsStudent };
  } catch (_) {}

  const cleanHash = String(window.location.hash || '').replace(/^#/, '');
  if (cleanHash) {
    const hashShared = cleanHash.match(/^shared=([^&]+)/i);
    if (hashShared && hashShared[1]) {
      try {
        const fromHash = WB.sanitizeRoomId(decodeURIComponent(hashShared[1]));
        if (fromHash) return { roomId: fromHash, isSharedStudentLink: true };
      } catch (_) {}
    }
    const hashRoom = cleanHash.match(/^room=([^&]+)/i);
    if (hashRoom && hashRoom[1]) {
      try {
        const fromHash = WB.sanitizeRoomId(decodeURIComponent(hashRoom[1]));
        if (fromHash) return { roomId: fromHash, isSharedStudentLink: roleIsStudent };
      } catch (_) {}
    }
  }
  return { roomId: '', isSharedStudentLink: false };
};

WB.extractRoomIdFromLocation = function() {
  return WB.extractRoomInfoFromLocation().roomId;
};

WB.parseRoomCodeOrUrl = function(rawInput) {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed) || trimmed.includes('/shared/') || trimmed.includes('/room/') || trimmed.includes('?')) {
    try {
      const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : 'https://placeholder.local/' + trimmed.replace(/^\/+/, ''));
      const pathname = parsed.pathname || '';
      const sm = pathname.match(/\/shared\/([^/?#]+)/i);
      if (sm && sm[1]) {
        const id = WB.sanitizeRoomId(decodeURIComponent(sm[1]));
        if (id) return id;
      }
      const rm = pathname.match(/\/room\/([^/?#]+)/i);
      if (rm && rm[1]) {
        const id = WB.sanitizeRoomId(decodeURIComponent(rm[1]));
        if (id) return id;
      }
      const params = new URLSearchParams(parsed.search || '');
      const qs = WB.sanitizeRoomId(params.get('shared')) || WB.sanitizeRoomId(params.get('room'));
      if (qs) return qs;
    } catch (_) {}
  }
  return WB.sanitizeRoomId(trimmed);
};

WB.getOrCreatePersistentRoomId = function(forceNew = false) {
  if (!forceNew && WB.collab.roomId) return WB.collab.roomId;
  if (!forceNew) {
    const fromUrl = WB.extractRoomIdFromLocation();
    if (fromUrl) return fromUrl;
    try {
      const saved = WB.sanitizeRoomId(localStorage.getItem('wb_my_room_id'));
      if (saved) return saved;
    } catch (_) {}
  }
  const fresh = 'wb-' + Math.random().toString(36).substring(2, 10);
  try { localStorage.setItem('wb_my_room_id', fresh); } catch (_) {}
  return fresh;
};

WB.resolveShareBase = function() {
  const customNorm = WB.getCustomPublicHost();
  if (customNorm && !WB.isLocalOrBrowserOnlyUrl(customNorm)) {
    return {
      baseUrl: customNorm,
      isPublicInternet: true,
      isForeignCloudPreview: WB.isForeignCloudPreviewHost(customNorm),
      needsPublicHost: false,
      linkStyle: WB.detectPreferredLinkStyle(customNorm),
      source: 'custom'
    };
  }
  const serverNorm = WB.normalizePublicOrigin(WB.collab.serverPublicBaseUrl);
  if (serverNorm && !WB.isLocalOrBrowserOnlyUrl(serverNorm) && !WB.isForeignCloudPreviewHost(serverNorm)) {
    return {
      baseUrl: serverNorm,
      isPublicInternet: true,
      isForeignCloudPreview: false,
      needsPublicHost: false,
      linkStyle: WB.detectPreferredLinkStyle(serverNorm),
      source: 'server'
    };
  }
  const locNorm = WB.normalizePublicOrigin(window.location.href);
  if (locNorm && !WB.isLocalOrBrowserOnlyUrl(locNorm)) {
    return {
      baseUrl: locNorm,
      isPublicInternet: true,
      isForeignCloudPreview: WB.isForeignCloudPreviewHost(locNorm),
      needsPublicHost: false,
      linkStyle: WB.detectPreferredLinkStyle(locNorm),
      source: 'location'
    };
  }
  return {
    baseUrl: '',
    isPublicInternet: false,
    isForeignCloudPreview: false,
    needsPublicHost: true,
    linkStyle: WB.getShareLinkStyle() === 'query' ? 'query' : 'path',
    source: 'none'
  };
};

WB.getApiBaseUrl = function() {
  if (/^https?:$/i.test(window.location.protocol)) {
    return '';
  }
  const resolved = WB.resolveShareBase();
  return resolved.baseUrl && resolved.linkStyle === 'path' ? resolved.baseUrl : '';
};

WB.getWsBaseUrl = function() {
  if (/^https?:$/i.test(window.location.protocol)) {
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProto}//${window.location.host}`;
  }
  const resolved = WB.resolveShareBase();
  if (!resolved.baseUrl || resolved.linkStyle !== 'path') return '';
  try {
    const parsed = new URL(resolved.baseUrl);
    const wsProto = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProto}//${parsed.host}`;
  } catch (_) {
    return '';
  }
};

WB.getCleanBaseUrl = function() {
  const resolved = WB.resolveShareBase();
  return resolved.baseUrl || window.location.origin || '';
};

WB.getStudentInviteUrl = function(roomIdOverride) {
  if (WB.collab.tempLinkUrl && !roomIdOverride) {
    return WB.collab.tempLinkUrl;
  }
  const rId = WB.sanitizeRoomId(roomIdOverride) || WB.collab.roomId || WB.getOrCreatePersistentRoomId(false);
  if (WB.collab.tempLinkBaseUrl) {
    return `${WB.collab.tempLinkBaseUrl}/shared/${encodeURIComponent(rId)}`;
  }
  const resolved = WB.resolveShareBase();
  if (!resolved.baseUrl || resolved.isForeignCloudPreview) return '';
  if (resolved.linkStyle === 'query') {
    return `${resolved.baseUrl}/?shared=${encodeURIComponent(rId)}`;
  }
  return `${resolved.baseUrl}/shared/${encodeURIComponent(rId)}`;
};

WB.startTeacherTempHeartbeat = function() {
  if (WB.userRole === 'student') return;
  if (WB.collab.tempHeartbeatTimer) clearInterval(WB.collab.tempHeartbeatTimer);
  WB.collab.tempHeartbeatTimer = setInterval(async () => {
    if (WB.userRole === 'student' || WB.boardAccessOpen === false || !WB.collab.roomId) {
      WB.stopTeacherTempHeartbeat();
      return;
    }
    const apiBase = WB.getApiBaseUrl();
    if (!/^https?:$/i.test(window.location.protocol) && !apiBase) return;
    try {
      const resp = await fetch(`${apiBase}/api/temp-link/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: WB.collab.roomId })
      });
      if (!resp.ok) return;
      const data = await resp.json();
      if (data && data.ok && data.active && data.url && data.url !== WB.collab.tempLinkUrl) {
        WB.collab.tempLinkUrl = data.url;
        WB.refreshShareModalLinkAndQR();
      }
    } catch (_) {}
  }, 10000);
};

WB.stopTeacherTempHeartbeat = function() {
  if (WB.collab.tempHeartbeatTimer) {
    clearInterval(WB.collab.tempHeartbeatTimer);
    WB.collab.tempHeartbeatTimer = null;
  }
};

WB.ensureTemporaryLink = async function(forceNew = false, forceRetry = false) {
  if (WB.userRole === 'student') return null;
  const apiBase = WB.getApiBaseUrl();
  if (!/^https?:$/i.test(window.location.protocol) && !apiBase) {
    WB.collab.tempLinkLoading = false;
    WB.collab.tempLinkUrl = '';
    WB.collab.tempLinkError = 'Запустите доску через ЗАПУСК_ДОСКИ_НА_ПК.bat, чтобы автоматически создать временную ссылку.';
    WB.refreshShareModalLinkAndQR();
    return null;
  }

  if (!forceNew && !forceRetry && WB.collab.tempLinkUrl && WB.boardAccessOpen !== false) {
    WB.startTeacherTempHeartbeat();
    WB.refreshShareModalLinkAndQR();
    return { ok: true, url: WB.collab.tempLinkUrl, roomId: WB.collab.roomId };
  }

  if (WB.collab.tempLinkLoading) return null;
  WB.collab.tempLinkLoading = true;
  WB.collab.tempLinkError = '';
  WB.refreshShareModalLinkAndQR();

  if (typeof WB.syncCurrentPage === 'function') WB.syncCurrentPage();
  const prevRoomId = WB.collab.roomId;
  const payload = {
    roomId: forceNew ? '' : (WB.collab.roomId || WB.getOrCreatePersistentRoomId(false)),
    forceNew: !!forceNew,
    boardTitle: WB.boardTitle || 'Новый урок',
    state: WB.state || { strokes: [], widgets: [] },
    pages: Array.isArray(WB.pages) ? WB.pages : [],
    currentPageIndex: typeof WB.currentPageIndex === 'number' ? WB.currentPageIndex : 0,
    permissions: WB.studentPermissions || { deleteStrokes: false, deleteObjects: false, editMaterials: true }
  };

  try {
    const resp = await fetch(`${apiBase}/api/temp-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok || !data.url) {
      throw new Error(data.message || 'Не удалось создать временную ссылку.');
    }

    if (forceNew && prevRoomId && prevRoomId !== data.roomId) {
      fetch(`${apiBase}/api/temp-link/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: prevRoomId, immediate: true })
      }).catch(() => {});
    }

    WB.collab.tempLinkUrl = data.url;
    WB.collab.tempLinkBaseUrl = data.baseUrl || '';
    WB.collab.tempLinkIsTunnel = !!data.isTunnel;
    WB.collab.isRoomPublished = true;
    WB.collab.tempLinkError = '';
    if (data.roomId) {
      try { localStorage.setItem('wb_my_room_id', data.roomId); } catch (_) {}
      if (WB.collab.roomId !== data.roomId || WB.collab.mode === 'offline') {
        WB.connectToRoom(data.roomId);
      }
    }
    WB.startTeacherTempHeartbeat();
    return data;
  } catch (err) {
    WB.collab.tempLinkUrl = '';
    WB.collab.tempLinkError = (err && err.message)
      ? err.message
      : 'Не удалось создать временную ссылку. Проверьте интернет и нажмите «Создать временную ссылку заново».';
    return null;
  } finally {
    WB.collab.tempLinkLoading = false;
    WB.refreshShareModalLinkAndQR();
  }
};

WB.closeTemporaryLink = function(immediate = true) {
  if (WB.userRole === 'student') return;
  const rId = WB.collab.roomId;
  WB.stopTeacherTempHeartbeat();
  if (immediate) {
    WB.collab.tempLinkUrl = '';
    WB.collab.tempLinkBaseUrl = '';
    WB.collab.tempLinkError = '';
  }
  if (!rId) return;
  const apiBase = WB.getApiBaseUrl();
  if (!/^https?:$/i.test(window.location.protocol) && !apiBase) return;
  const body = JSON.stringify({ roomId: rId, immediate: !!immediate });
  const endpoint = `${apiBase}/api/temp-link/close`;
  if (!immediate && navigator.sendBeacon) {
    try {
      navigator.sendBeacon(endpoint, new Blob([body], { type: 'text/plain;charset=UTF-8' }));
      return;
    } catch (_) {}
  }
  fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true
  }).catch(() => {});
};

WB.copyRoomCode = function() {
  const rId = WB.collab.roomId || WB.getOrCreatePersistentRoomId(false);
  WB.copyTextSafe(rId, null).then(() => {
    if (typeof WB.showToast === 'function') {
      WB.showToast(`Код комнаты ${rId} скопирован`, 2200);
    }
  });
};

WB.joinRoomByCode = async function(rawOverride) {
  const input = document.getElementById('joinRoomCodeInput');
  const raw = typeof rawOverride === 'string' ? rawOverride : (input ? input.value : '');
  const targetRoomId = WB.parseRoomCodeOrUrl(raw);
  if (!targetRoomId) {
    if (typeof WB.showToast === 'function') {
      WB.showToast('Введите корректный код комнаты (например, wb-a1b2c3d4)', 2600);
    }
    return;
  }
  WB.userRole = 'student';
  WB.collab.myName = localStorage.getItem('wb_username') || 'Ученик';
  WB.collab.hasReceivedInit = false;
  WB.applyRoleUI();
  try { localStorage.setItem('wb_my_room_id', targetRoomId); } catch (_) {}
  if (input) input.value = '';
  WB.closeStudentInviteModal();
  const loaded = await WB.loadRoomFromServer(targetRoomId);
  if (loaded && loaded.closed) return;
  WB.connectToRoom(targetRoomId);
  const prompted = WB.openStudentJoinNameModal(targetRoomId);
  if (!prompted && typeof WB.showToast === 'function') {
    WB.showToast(`Подключение к комнате ${targetRoomId}…`, 2600, 'info');
  }
};

WB.downloadStudentInviteHtml = async function() {
  const btn = document.getElementById('downloadStudentHtmlBtn');
  const apiBase = WB.getApiBaseUrl();
  if (!/^https?:$/i.test(window.location.protocol) && !apiBase) {
    if (typeof WB.showToast === 'function') {
      WB.showToast('Запустите доску через ЗАПУСК_ДОСКИ_НА_ПК.bat для создания файла-приглашения, либо передайте код комнаты.', 4200);
    }
    return;
  }
  if (typeof WB.syncCurrentPage === 'function') WB.syncCurrentPage();
  const rId = WB.collab.roomId || WB.getOrCreatePersistentRoomId(false);
  if (btn) btn.disabled = true;
  try {
    const resp = await fetch(`${apiBase}/api/student-invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: rId,
        boardTitle: WB.boardTitle || 'Новый урок',
        state: WB.state || { strokes: [], widgets: [] },
        pages: Array.isArray(WB.pages) ? WB.pages : [],
        currentPageIndex: typeof WB.currentPageIndex === 'number' ? WB.currentPageIndex : 0,
        permissions: WB.studentPermissions || { deleteStrokes: false, deleteObjects: false, editMaterials: true }
      })
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const blob = await resp.blob();
    const dlUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeTitle = String(WB.boardTitle || 'Урок').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 40) || 'Урок';
    a.href = dlUrl;
    a.download = `Whiteboard_${safeTitle}_${rId}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(dlUrl), 4000);
    if (typeof WB.showToast === 'function') {
      WB.showToast('Файл-приглашение (.html) скачан — отправьте его ученику в Telegram или VK', 3200);
    }
  } catch (_) {
    if (typeof WB.showToast === 'function') {
      WB.showToast('Не удалось сформировать файл. Запустите локальный сервер через ЗАПУСК_ДОСКИ_НА_ПК.bat.', 3500);
    }
  } finally {
    if (btn) btn.disabled = false;
  }
};

WB.fetchServerConfig = async function() {
  const apiBase = WB.getApiBaseUrl();
  if (!/^https?:$/i.test(window.location.protocol) && !apiBase) return null;
  try {
    const resp = await fetch(`${apiBase}/api/config`, { cache: 'no-store' });
    if (!resp.ok) return null;
    const cfg = await resp.json();
    if (cfg && typeof cfg.supportsWs === 'boolean') {
      WB.collab.serverSupportsWs = cfg.supportsWs;
    }
    if (cfg && typeof cfg.publicBaseUrl === 'string' && cfg.publicBaseUrl && cfg.isPublicInternet) {
      WB.collab.serverPublicBaseUrl = cfg.publicBaseUrl;
      WB.collab.isPublicInternetUrl = true;
      WB.refreshShareModalLinkAndQR();
    }
    return cfg;
  } catch (_) {
    return null;
  }
};

WB.publishRoomToServer = async function(roomIdOverride = null, forceNew = false) {
  const apiBase = WB.getApiBaseUrl();
  if (!/^https?:$/i.test(window.location.protocol) && !apiBase) return null;
  if (typeof WB.syncCurrentPage === 'function') WB.syncCurrentPage();
  const payload = {
    roomId: forceNew ? '' : (WB.sanitizeRoomId(roomIdOverride) || WB.collab.roomId || WB.getOrCreatePersistentRoomId(false)),
    boardTitle: WB.boardTitle || 'Новый урок',
    state: WB.state || { strokes: [], widgets: [] },
    pages: Array.isArray(WB.pages) ? WB.pages : [],
    currentPageIndex: typeof WB.currentPageIndex === 'number' ? WB.currentPageIndex : 0,
    permissions: WB.studentPermissions || { deleteStrokes: false, deleteObjects: false, editMaterials: true },
    accessOpen: WB.boardAccessOpen !== false
  };
  try {
    const resp = await fetch(`${apiBase}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data && data.ok && data.roomId) {
      WB.collab.isRoomPublished = true;
      if (data.publicBaseUrl) {
        WB.collab.serverPublicBaseUrl = data.publicBaseUrl;
        WB.collab.isPublicInternetUrl = !!data.isPublicInternet;
      }
      WB.refreshShareModalLinkAndQR();
      return data;
    }
  } catch (_) {}
  return null;
};

WB.syncRoomAccessOnServer = async function(isOpen) {
  const apiBase = WB.getApiBaseUrl();
  if (!/^https?:$/i.test(window.location.protocol) && !apiBase) return;
  const rId = WB.collab.roomId || WB.getOrCreatePersistentRoomId(false);
  if (!rId) return;
  try {
    await fetch(`${apiBase}/api/rooms/${encodeURIComponent(rId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessOpen: !!isOpen,
        boardTitle: WB.boardTitle || 'Новый урок',
        state: WB.state || { strokes: [], widgets: [] },
        pages: Array.isArray(WB.pages) ? WB.pages : [],
        currentPageIndex: typeof WB.currentPageIndex === 'number' ? WB.currentPageIndex : 0,
        permissions: WB.studentPermissions || { deleteStrokes: false, deleteObjects: false, editMaterials: true }
      })
    });
  } catch (_) {}
};

WB.showRoomClosedOverlay = function(message, title) {
  const joinModal = document.getElementById('studentJoinNameModal');
  if (joinModal) joinModal.style.display = 'none';
  const overlay = document.getElementById('roomClosedOverlay');
  if (!overlay) return;
  const titleEl = document.getElementById('roomClosedTitle');
  if (titleEl && title) titleEl.textContent = title;
  const desc = document.getElementById('roomClosedDesc');
  if (desc && message) desc.textContent = message;
  overlay.style.display = 'flex';
};

WB.openStudentJoinNameModal = function(roomId) {
  if (WB.userRole !== 'student') return false;
  const overlay = document.getElementById('roomClosedOverlay');
  if (overlay && overlay.style.display === 'flex') return false;
  const rId = WB.sanitizeRoomId(roomId) || WB.collab.roomId || 'default';
  try {
    if (sessionStorage.getItem('wb_join_name_confirmed_' + rId) === '1') {
      return false;
    }
  } catch (_) {}

  const modal = document.getElementById('studentJoinNameModal');
  if (!modal) return false;
  WB.collab.pendingJoinRoomId = rId;
  const input = document.getElementById('studentJoinNameInput');
  if (input) {
    let saved = '';
    try { saved = String(localStorage.getItem('wb_username') || '').trim(); } catch (_) {}
    const isDefaultPlaceholder = !saved || saved === 'Ученик' || saved === 'Преподаватель' || saved === 'Учитель';
    input.value = isDefaultPlaceholder ? '' : saved.slice(0, 40);
  }
  modal.style.display = 'flex';
  if (input) {
    setTimeout(() => {
      try {
        input.focus();
        input.select();
      } catch (_) {}
    }, 40);
  }
  return true;
};

WB.submitStudentJoinName = function(useDefault = false) {
  const modal = document.getElementById('studentJoinNameModal');
  const input = document.getElementById('studentJoinNameInput');
  const raw = useDefault ? '' : (input ? input.value : '');
  const cleaned = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const chosenName = cleaned || 'Ученик';

  WB.collab.myName = chosenName;
  try {
    if (cleaned) {
      localStorage.setItem('wb_username', chosenName);
    } else if (!localStorage.getItem('wb_username')) {
      localStorage.setItem('wb_username', 'Ученик');
    }
  } catch (_) {}

  const rId = WB.collab.pendingJoinRoomId || WB.collab.roomId || 'default';
  try { sessionStorage.setItem('wb_join_name_confirmed_' + rId, '1'); } catch (_) {}
  WB.collab.pendingJoinRoomId = null;

  if (modal) modal.style.display = 'none';

  WB.renderPeersAvatarBar({ force: true });

  if (WB.collab.roomId) {
    WB.broadcastData({
      type: 'peer_rename',
      targetId: WB.collab.myId,
      name: chosenName,
      byTeacher: false
    });
    const mySnap = WB.getMyViewportSnapshot();
    WB.broadcastData({
      type: 'ping_peer',
      name: chosenName,
      color: WB.collab.myColor,
      role: WB.userRole,
      cam: mySnap.cam,
      view: mySnap
    });
  }

  if (typeof WB.showToast === 'function') {
    WB.showToast(`Вы вошли на доску как «${chosenName}»`, 2800, 'success');
  }
};

WB.loadRoomFromServer = async function(roomId) {
  const apiBase = WB.getApiBaseUrl();
  if ((!(/^https?:$/i.test(window.location.protocol)) && !apiBase) || !roomId) return null;
  try {
    const roleQ = WB.userRole === 'student' ? '?role=student' : '';
    const resp = await fetch(`${apiBase}/api/rooms/${encodeURIComponent(roomId)}${roleQ}`, { cache: 'no-store' });
    if (resp.status === 403) {
      const errData = await resp.json().catch(() => ({}));
      WB.showRoomClosedOverlay(errData.message || 'Преподаватель временно закрыл доступ к этой доске.');
      return { closed: true };
    }
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data && data.ok && data.room) {
      const r = data.room;
      const hasContent =
        (Array.isArray(r.state?.strokes) && r.state.strokes.length > 0) ||
        (Array.isArray(r.state?.widgets) && r.state.widgets.length > 0) ||
        (Array.isArray(r.pages) && r.pages.length > 1) ||
        (r.boardTitle && r.boardTitle !== 'Новый урок');
      if (hasContent || WB.userRole === 'student') {
        WB.applyRemoteBoardPayload(r);
        WB.collab.hasReceivedInit = true;
      }
      WB.collab.isRoomPublished = true;
      return data;
    }
  } catch (_) {}
  return null;
};

WB.createFreshInviteRoom = async function() {
  const btn = document.getElementById('createFreshRoomBtn');
  if (btn) btn.disabled = true;
  try {
    const res = await WB.ensureTemporaryLink(true, true);
    if (res && res.ok && typeof WB.showToast === 'function') {
      WB.showToast('Создана новая временная ссылка', 2200);
    }
  } finally {
    if (btn) btn.disabled = false;
  }
};

WB.copyTextSafe = function(text, fallbackInputEl) {
  const val = String(text || '');
  if (!val) return Promise.resolve(false);

  const fallbackCopy = () => {
    try {
      if (fallbackInputEl && typeof fallbackInputEl.select === 'function') {
        fallbackInputEl.focus();
        fallbackInputEl.select();
        fallbackInputEl.setSelectionRange(0, val.length);
        const ok = document.execCommand('copy');
        if (ok) return true;
      }
      const ta = document.createElement('textarea');
      ta.value = val;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, val.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (_) {
      return false;
    }
  };

  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(val).then(() => true).catch(() => fallbackCopy());
  }
  return Promise.resolve(fallbackCopy());
};

WB.toggleShareModal = function(show) {
  if (show) {
    WB.openStudentInviteModal();
  } else {
    WB.closeStudentInviteModal();
  }
};

WB.getActivePeersCount = function() {
  const now = performance.now();
  let count = 1;
  for (const id in WB.collab.remotePeers) {
    const p = WB.collab.remotePeers[id];
    if (now - p.lastSeen < 30000) count++;
    else delete WB.collab.remotePeers[id];
  }
  return count;
};

WB.getParticipantInitials = function(name) {
  const clean = String(name || '').replace(/[^\p{L}\p{N}\s]+/gu, ' ').trim();
  if (!clean) return 'УЧ';
  const parts = clean.split(/\s+/).filter(Boolean);
  const letterParts = parts.filter(p => /^\p{L}/u.test(p));
  if (letterParts.length >= 2) return (letterParts[0][0] + letterParts[1][0]).toUpperCase();
  if (letterParts.length === 1 && letterParts[0].length >= 2) return letterParts[0].slice(0, 2).toUpperCase();
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
};

WB.kickPeer = function(peerId, event) {
  if (event) event.stopPropagation();
  if (WB.userRole === 'student') return;
  const peer = WB.collab.remotePeers && WB.collab.remotePeers[peerId];
  const peerName = (peer && peer.name) ? peer.name : 'Ученик';

  WB.collab.kickedPeerIds.add(peerId);
  if (WB.collab.remotePeers && WB.collab.remotePeers[peerId]) {
    delete WB.collab.remotePeers[peerId];
  }

  WB.broadcastData({
    type: 'peer_kicked',
    targetId: peerId,
    reason: 'Преподаватель удалил вас с доски.'
  });

  WB.renderPeersAvatarBar();
  if (typeof WB.showToast === 'function') {
    WB.showToast(`Участник «${peerName}» удалён с доски`, 2400);
  }
};

WB.toggleBlockPeer = function(peerId, event) {
  WB.kickPeer(peerId, event);
};

WB.escapePeerHtml = function(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

WB.startRenamePeer = function(targetId, event) {
  if (event) event.stopPropagation();
  const isSelf = targetId === 'self' || targetId === WB.collab.myId;
  if (!isSelf && WB.userRole === 'student') return;
  if (!isSelf && (!WB.collab.remotePeers || !WB.collab.remotePeers[targetId])) return;

  WB.collab.editingPeerId = isSelf ? 'self' : targetId;
  WB.renderPeersAvatarBar({ force: true });

  setTimeout(() => {
    const inp = document.getElementById('peerInlineRenameInput');
    if (inp) {
      inp.focus();
      inp.select();
    }
  }, 20);
};

WB.cancelRenamePeer = function(event) {
  if (event) event.stopPropagation();
  if (!WB.collab.editingPeerId) return;
  WB.collab.editingPeerId = null;
  WB.renderPeersAvatarBar({ force: true });
};

WB.commitRenamePeer = function(targetId, rawValue, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const isSelf = targetId === 'self' || targetId === WB.collab.myId;
  if (!isSelf && WB.userRole === 'student') {
    WB.collab.editingPeerId = null;
    WB.renderPeersAvatarBar({ force: true });
    return;
  }

  const cleanName = String(rawValue || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  WB.collab.editingPeerId = null;

  if (!cleanName) {
    WB.renderPeersAvatarBar({ force: true });
    return;
  }

  if (isSelf) {
    const prevName = WB.collab.myName;
    WB.collab.myName = cleanName;
    try { localStorage.setItem('wb_username', cleanName); } catch (_) {}
    if (WB.collab.roomId) {
      WB.broadcastData({
        type: 'peer_rename',
        targetId: WB.collab.myId,
        name: cleanName,
        byTeacher: WB.userRole !== 'student'
      });
      const mySnap = WB.getMyViewportSnapshot();
      WB.broadcastData({
        type: 'ping_peer',
        name: cleanName,
        color: WB.collab.myColor,
        role: WB.userRole,
        cam: mySnap.cam,
        view: mySnap
      });
    }
    WB.renderPeersAvatarBar({ force: true });
    if (prevName !== cleanName && typeof WB.showToast === 'function') {
      WB.showToast(`Имя изменено на «${cleanName}»`, 2400, 'success');
    }
    return;
  }

  const peer = WB.collab.remotePeers && WB.collab.remotePeers[targetId];
  if (peer) {
    const prevName = peer.name;
    peer.name = cleanName;
    delete peer.initials;
    peer.forcedName = cleanName;
    peer.forcedNameUntil = performance.now() + 3000;

    if (WB.collab.roomId) {
      WB.broadcastData({
        type: 'peer_rename',
        targetId: targetId,
        name: cleanName,
        byTeacher: true
      });
    }
    WB.renderPeersAvatarBar({ force: true });
    if (prevName !== cleanName && typeof WB.showToast === 'function') {
      WB.showToast(`Имя участника изменено на «${cleanName}»`, 2400, 'success');
    }
  } else {
    WB.renderPeersAvatarBar({ force: true });
  }
};

WB.renderPeersAvatarBar = function(opts = {}) {
  const bar = document.getElementById('peersAvatarBar');
  const listEl = document.getElementById('peersDropdownList');
  const jumpBtn = document.getElementById('jumpToPeerBtn');
  const summonBtn = document.getElementById('summonStudentsBtn');
  if (!bar) return;

  const isStudent = WB.userRole === 'student';
  const now = performance.now();
  const allPeers = [];
  for (const id in WB.collab.remotePeers) {
    if (WB.collab.kickedPeerIds && WB.collab.kickedPeerIds.has(id)) {
      delete WB.collab.remotePeers[id];
      continue;
    }
    const p = WB.collab.remotePeers[id];
    if (now - p.lastSeen < 30000) {
      allPeers.push({ id, ...p });
    } else {
      delete WB.collab.remotePeers[id];
    }
  }

  // Для ученика приоритетный участник — преподаватель
  const orderedPeers = isStudent
    ? allPeers.slice().sort((a, b) => ((a.role !== 'student' ? 0 : 1) - (b.role !== 'student' ? 0 : 1)))
    : allPeers;

  const myName = WB.collab.myName || (isStudent ? 'Ученик' : 'Преподаватель');
  const myInitials = WB.escapePeerHtml(WB.getParticipantInitials(myName));
  const myBg = isStudent ? '#06b6d4' : '#22c55e';
  const safeMyName = WB.escapePeerHtml(myName);

  let avatarsHtml = `
    <span class="peer-avatar-circle" style="background:${myBg};" title="${safeMyName} (вы)">${myInitials}</span>
  `;

  orderedPeers.slice(0, 3).forEach((p, idx) => {
    const bg = p.color || (idx % 2 === 0 ? '#06b6d4' : '#8b5cf6');
    const rawPeerName = p.name || (p.role === 'student' ? 'Ученик' : 'Преподаватель');
    const safeName = WB.escapePeerHtml(rawPeerName);
    const initStr = WB.escapePeerHtml(p.initials || WB.getParticipantInitials(rawPeerName));
    avatarsHtml += `<span class="peer-avatar-circle" style="background:${bg};" title="${safeName}">${initStr}</span>`;
  });
  if (orderedPeers.length > 3) {
    avatarsHtml += `<span class="peer-avatar-circle more">+${orderedPeers.length - 3}</span>`;
  }
  bar.innerHTML = avatarsHtml;

  const primaryPeer = orderedPeers[0];
  if (jumpBtn) {
    const label = primaryPeer
      ? `Переместиться к ${primaryPeer.name}`
      : (isStudent ? 'Переместиться к преподавателю' : 'Переместиться к участнику');
    jumpBtn.setAttribute('data-tooltip-left', label);
    jumpBtn.setAttribute('title', label);
  }
  if (summonBtn) {
    const label = primaryPeer ? `Притянуть ${primaryPeer.name}` : 'Притянуть учеников';
    summonBtn.setAttribute('data-tooltip-left', label);
    summonBtn.setAttribute('title', label);
  }

  // Не сбрасываем открытую форму редактирования имени при фоновом ping/обновлении
  if (WB.collab.editingPeerId && !opts.force) {
    return;
  }

  const editPencilSvg = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 20h9"/>
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
    </svg>
  `;
  const checkSaveSvg = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  `;

  if (listEl) {
    if (!isStudent && WB.peersDropdownView === 'permissions') {
      const perms = WB.studentPermissions || { deleteStrokes: false, deleteObjects: false, editMaterials: true };
      listEl.innerHTML = `
        <div class="lb-perm-view" onclick="event.stopPropagation()">
          <button type="button" class="lb-perm-back-row" onclick="WB.setPeersDropdownView('list', event)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
            <div class="lb-perm-hdr-text">
              <div class="lb-perm-title">Настройки редактирования</div>
              <div class="lb-perm-sub">Права учеников на этой доске</div>
            </div>
          </button>

          <label class="lb-perm-row">
            <input type="checkbox" ${perms.deleteStrokes ? 'checked' : ''} onchange="WB.toggleStudentPermission('deleteStrokes', this.checked, event)">
            <span class="lb-perm-slider"></span>
            <span class="lb-perm-label-col">
              <span class="lb-perm-row-title">Удалять мои штрихи</span>
              <span class="lb-perm-row-sub">Рисунки пером и маркером</span>
            </span>
          </label>

          <label class="lb-perm-row">
            <input type="checkbox" ${perms.deleteObjects ? 'checked' : ''} onchange="WB.toggleStudentPermission('deleteObjects', this.checked, event)">
            <span class="lb-perm-slider"></span>
            <span class="lb-perm-label-col">
              <span class="lb-perm-row-title">Удалять мои объекты</span>
              <span class="lb-perm-row-sub">Текст, фигуры, линии, формулы, изображения и другие материалы</span>
            </span>
          </label>

          <label class="lb-perm-row">
            <input type="checkbox" ${perms.editMaterials !== false ? 'checked' : ''} onchange="WB.toggleStudentPermission('editMaterials', this.checked, event)">
            <span class="lb-perm-slider"></span>
            <span class="lb-perm-label-col">
              <span class="lb-perm-row-title">Перемещать и изменять мои материалы</span>
              <span class="lb-perm-row-sub">Менять положение, размер, текст и оформление</span>
            </span>
          </label>

          <div class="lb-perm-footer-note">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <span>Заблокированные объекты всегда защищены.</span>
          </div>
        </div>
      `;
      return;
    }

    const myRoleLabel = isStudent ? 'Ученик' : 'Учитель';
    const isEditingSelf = WB.collab.editingPeerId === 'self';
    const selfInfoHtml = isEditingSelf
      ? `
        <form class="lb-peer-inline-form" onclick="event.stopPropagation()" onsubmit="WB.commitRenamePeer('self', this.querySelector('input').value, event)">
          <input
            type="text"
            id="peerInlineRenameInput"
            class="lb-peer-inline-input"
            value="${safeMyName}"
            maxlength="40"
            aria-label="Новое имя"
            onkeydown="event.stopPropagation(); if(event.key==='Escape'){WB.cancelRenamePeer(event);}"
          />
          <button type="submit" class="lb-peer-inline-save" title="Сохранить имя" aria-label="Сохранить имя">${checkSaveSvg}</button>
        </form>
        <div class="lb-peer-status">${myRoleLabel}</div>
      `
      : `
        <div class="lb-peer-name-line">
          <span class="lb-peer-name">${safeMyName}</span>
          <span class="lb-peer-you">(вы)</span>
        </div>
        <div class="lb-peer-status">${myRoleLabel}</div>
      `;

    const selfActionHtml = isEditingSelf
      ? ''
      : `
        <div class="lb-peer-actions">
          <button type="button" class="peer-act-btn act-edit" onclick="WB.startRenamePeer('self', event)" data-peer-tip="Изменить своё имя" aria-label="Изменить своё имя">
            ${editPencilSvg}
          </button>
        </div>
      `;

    const selfRowHtml = `
      <div class="lb-peer-card-row self-row">
        <span class="lb-peer-avatar" style="background:${myBg};">${myInitials}</span>
        <div class="lb-peer-info">
          ${selfInfoHtml}
        </div>
        ${selfActionHtml}
      </div>
    `;

    const peersRowsHtml = orderedPeers.map((p, idx) => {
      const bg = p.color || (idx % 2 === 0 ? '#06b6d4' : '#8b5cf6');
      const peerIsTeacher = p.role !== 'student';
      const rawName = p.name || (peerIsTeacher ? 'Преподаватель' : 'Ученик');
      const safeName = WB.escapePeerHtml(rawName);
      const safeId = WB.escapePeerHtml(p.id);
      const inDocHint = (p.view && p.view.pdfView && p.view.pdfView.widgetId)
        ? ` · документ (стр. ${(Number(p.view.pdfView.pageIdx) || 0) + 1})`
        : '';
      const statusText = (peerIsTeacher ? 'Преподаватель' : 'Ученик (активен)') + inDocHint;
      const initStr = WB.escapePeerHtml(p.initials || WB.getParticipantInitials(rawName));
      const isEditingPeer = !isStudent && WB.collab.editingPeerId === p.id;

      const teacherEditBtn = !isStudent ? `
            <button type="button" class="peer-act-btn act-edit" onclick="WB.startRenamePeer('${safeId}', event)" data-peer-tip="Переименовать ${safeName}" aria-label="Переименовать ${safeName}">
              ${editPencilSvg}
            </button>
      ` : '';

      const teacherStudentActionBtns = (!isStudent && !peerIsTeacher) ? `
            <button type="button" class="peer-act-btn act-summon" onclick="WB.summonPeerToMe('${safeId}')" data-peer-tip="Притянуть ${safeName}" aria-label="Притянуть ${safeName}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="8"/>
                <circle cx="12" cy="12" r="3"/>
                <line x1="12" y1="2" x2="12" y2="4"/>
                <line x1="12" y1="20" x2="12" y2="22"/>
                <line x1="2" y1="12" x2="4" y2="12"/>
                <line x1="20" y1="12" x2="22" y2="12"/>
              </svg>
            </button>
            <button type="button" class="peer-act-btn act-kick" onclick="WB.kickPeer('${safeId}', event)" data-peer-tip="Удалить ${safeName}" aria-label="Удалить ${safeName}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="8.5" cy="7" r="4"/>
                <line x1="18" y1="8" x2="23" y2="13"/>
                <line x1="23" y1="8" x2="18" y2="13"/>
              </svg>
            </button>
      ` : '';

      const peerInfoHtml = isEditingPeer
        ? `
          <form class="lb-peer-inline-form" onclick="event.stopPropagation()" onsubmit="WB.commitRenamePeer('${safeId}', this.querySelector('input').value, event)">
            <input
              type="text"
              id="peerInlineRenameInput"
              class="lb-peer-inline-input"
              value="${safeName}"
              maxlength="40"
              aria-label="Новое имя участника"
              onkeydown="event.stopPropagation(); if(event.key==='Escape'){WB.cancelRenamePeer(event);}"
            />
            <button type="submit" class="lb-peer-inline-save" title="Сохранить имя" aria-label="Сохранить имя">${checkSaveSvg}</button>
          </form>
          <div class="lb-peer-status status-active">${statusText}</div>
        `
        : `
          <div class="lb-peer-name-line">
            <span class="lb-peer-name">${safeName}</span>
          </div>
          <div class="lb-peer-status status-active">${statusText}</div>
        `;

      const peerActionsHtml = isEditingPeer ? '' : `
          <div class="lb-peer-actions">
            <button type="button" class="peer-act-btn act-jump" onclick="WB.jumpToPeer('${safeId}')" data-peer-tip="Переместиться к ${safeName}" aria-label="Переместиться к ${safeName}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m22 2-7 20-4-9-9-4Z"/>
                <path d="M22 2 11 13"/>
              </svg>
            </button>
            ${teacherEditBtn}
            ${teacherStudentActionBtns}
          </div>
      `;

      return `
        <div class="lb-peer-card-row student-row">
          <span class="lb-peer-avatar" style="background:${bg};">${initStr}</span>
          <div class="lb-peer-info">
            ${peerInfoHtml}
          </div>
          ${peerActionsHtml}
        </div>
      `;
    }).join('');

    const emptyPeersHtml = orderedPeers.length === 0
      ? '<div class="lb-peers-empty">Пока нет подключённых участников</div>'
      : '';

    const permsFooterBtn = !isStudent ? `
      <button type="button" class="lb-perm-open-btn" onclick="WB.setPeersDropdownView('permissions', event)">
        <span>Настройки редактирования</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    ` : '';

    listEl.innerHTML = selfRowHtml + peersRowsHtml + emptyPeersHtml + permsFooterBtn;
  }
};

WB.refreshShareModalLinkAndQR = function() {
  const rId = WB.collab.roomId || WB.getOrCreatePersistentRoomId(false);
  const studentUrl = WB.boardAccessOpen === false ? '' : WB.getStudentInviteUrl();
  const isLoading = !!WB.collab.tempLinkLoading;
  const errMsg = WB.collab.tempLinkError || '';

  const syncSub = document.getElementById('shareSyncTransportSub');
  if (syncSub) {
    if (WB.boardAccessOpen === false) {
      syncSub.textContent = 'Доступ закрыт — временная ссылка отключена';
    } else if (isLoading) {
      syncSub.textContent = 'Подготавливаем временную интернет-ссылку…';
    } else if (studentUrl) {
      syncSub.textContent = 'Временная ссылка работает, пока вы в доске';
    } else {
      syncSub.textContent = 'Временная ссылка работает, пока вы в доске';
    }
  }

  const loadingRow = document.getElementById('tempLinkLoadingRow');
  const publicBlock = document.getElementById('sharePublicLinkBlock');
  const qrCardWrap = document.getElementById('studentQrCardWrap');
  const statusNote = document.getElementById('shareRoomStatusNote');
  const retryWrap = document.getElementById('tempLinkRetryWrap');
  const hasWorkingLink = !!studentUrl && !isLoading;

  if (loadingRow) loadingRow.style.display = isLoading ? 'flex' : 'none';
  if (publicBlock) publicBlock.style.display = hasWorkingLink ? 'block' : 'none';
  if (qrCardWrap) qrCardWrap.style.display = hasWorkingLink ? 'flex' : 'none';
  if (retryWrap) retryWrap.style.display = (!isLoading && !hasWorkingLink && WB.boardAccessOpen !== false) ? 'flex' : 'none';

  const input = document.getElementById('studentInviteUrl');
  if (input && input.value !== studentUrl) {
    input.value = studentUrl;
  }

  const openLink = document.getElementById('openStudentPageLink');
  if (openLink) {
    if (studentUrl) {
      openLink.href = studentUrl;
      openLink.style.pointerEvents = 'auto';
      openLink.style.opacity = '1';
    } else {
      openLink.href = '#';
      openLink.style.pointerEvents = 'none';
      openLink.style.opacity = '0.5';
    }
  }

  if (statusNote) {
    if (isLoading || WB.boardAccessOpen === false) {
      statusNote.style.display = 'none';
    } else if (hasWorkingLink) {
      statusNote.style.display = 'block';
      statusNote.className = 'lb-share-status-note is-ok';
      statusNote.innerHTML = WB.collab.tempLinkIsTunnel
        ? '<span class="lb-live-dot" aria-hidden="true"></span><strong>Ссылка активна</strong>, пока вы находитесь в доске. Если у ученика появится окно туннеля — достаточно нажать «Enter Site».'
        : '<span class="lb-live-dot" aria-hidden="true"></span><strong>Ссылка активна</strong> — отключится автоматически, как только вы выйдете из доски.';
    } else if (errMsg) {
      statusNote.style.display = 'block';
      statusNote.className = 'lb-share-status-note is-warn';
      statusNote.textContent = errMsg;
    } else {
      statusNote.style.display = 'none';
    }
  }

  const qrContainer = document.getElementById('studentQrContainer');
  if (qrContainer && studentUrl && qrContainer.dataset.renderedUrl !== studentUrl) {
    WB.renderAutonomousQRCode(studentUrl, 'studentQrContainer');
    qrContainer.dataset.renderedUrl = studentUrl;
  }
};

WB.updateCollabUI = function() {
  if (typeof WB.applyRoleUI === 'function') WB.applyRoleUI();
  WB.refreshShareModalLinkAndQR();
  WB.renderPeersAvatarBar();
};

// --- СНИМОК ВИДИМОЙ ОБЛАСТИ (ДОСКА + PDF / DOCX / ФОТО) И ПЕРЕХОД / ПРИТЯГИВАНИЕ ---
WB.getMyViewportSnapshot = function() {
  const vpW = Math.max(320, window.innerWidth || 1280);
  const vpH = Math.max(320, window.innerHeight || 720);
  const camX = Number(WB.cam && WB.cam.x) || 0;
  const camY = Number(WB.cam && WB.cam.y) || 0;
  const camZ = Math.max(0.1, Number(WB.cam && WB.cam.z) || 1);
  const centerX = (vpW / 2 - camX) / camZ;
  const centerY = (vpH / 2 - camY) / camZ;

  let pdfView = null;
  if (WB.pdfEditor && WB.pdfEditor.isOpen && WB.pdfEditor.targetWidgetId) {
    const vp = document.getElementById('pdfCanvasViewport');
    const pageIdx = Number(WB.pdfEditor.currentPage) || 0;
    let scrollRatio = 0;
    let pageRelY = 0;
    if (vp) {
      const maxScroll = Math.max(1, vp.scrollHeight - vp.clientHeight);
      scrollRatio = Math.max(0, Math.min(1, vp.scrollTop / maxScroll));
      const wrap = vp.querySelector(`.pdf-page-wrap[data-page-idx="${pageIdx}"]`);
      if (wrap && wrap.offsetHeight > 0) {
        const vpCenterY = vp.scrollTop + vp.clientHeight / 2;
        pageRelY = Math.max(0, Math.min(1, (vpCenterY - wrap.offsetTop) / wrap.offsetHeight));
      }
    }
    pdfView = {
      widgetId: WB.pdfEditor.targetWidgetId,
      pageIdx,
      scrollRatio: Math.round(scrollRatio * 1000) / 1000,
      pageRelY: Math.round(pageRelY * 1000) / 1000,
      zoom: Math.round((Number(WB.pdfEditor.zoom) || 1) * 100) / 100,
      docType: WB.pdfEditor.isDocx ? 'docx' : (WB.pdfEditor.isPhoto ? 'photo' : 'pdf')
    };
  }

  return {
    pageIndex: typeof WB.currentPageIndex === 'number' ? WB.currentPageIndex : 0,
    cam: { x: Math.round(camX), y: Math.round(camY), z: Math.round(camZ * 1000) / 1000 },
    centerX: Math.round(centerX),
    centerY: Math.round(centerY),
    vpW,
    vpH,
    pdfView
  };
};

WB.broadcastPeerViewport = function(immediate = false) {
  if (WB.collab.mode !== 'online' || !WB.collab.roomId) return;
  const now = performance.now();
  if (!immediate && now - WB.collab.lastViewSentAt < 250) return;
  WB.collab.lastViewSentAt = now;
  const view = WB.getMyViewportSnapshot();
  WB.broadcastData({
    type: 'peer_view',
    view,
    cam: view.cam
  });
};

WB.applyRemoteViewportSnapshot = function(snap, toastText = '', opts = {}) {
  if (!snap || typeof snap !== 'object') return;
  if (!opts.skipSavePrev && typeof WB.savePrevCamera === 'function') {
    WB.savePrevCamera();
  }

  // 1. Сначала переходим на нужную страницу доски
  if (typeof snap.pageIndex === 'number' && Array.isArray(WB.pages) && snap.pageIndex >= 0 && snap.pageIndex < WB.pages.length) {
    if (snap.pageIndex !== WB.currentPageIndex && typeof WB.switchPage === 'function') {
      WB.switchPage(snap.pageIndex, { keepCam: true, silentSync: true });
    }
  }

  // 2. Если цель находится внутри PDF / DOCX / Фото — открываем этот же документ и прокручиваем на нужную страницу
  if (snap.pdfView && snap.pdfView.widgetId) {
    const targetWidgetId = snap.pdfView.widgetId;
    let foundWidget = (WB.state && Array.isArray(WB.state.widgets))
      ? WB.state.widgets.find(w => w.id === targetWidgetId)
      : null;

    if (!foundWidget && Array.isArray(WB.pages)) {
      for (let i = 0; i < WB.pages.length; i++) {
        const pw = (WB.pages[i].widgets || []).find(w => w.id === targetWidgetId);
        if (pw) {
          if (typeof WB.switchPage === 'function') {
            WB.switchPage(i, { keepCam: true, silentSync: true });
          }
          foundWidget = (WB.state.widgets || []).find(w => w.id === targetWidgetId) || pw;
          break;
        }
      }
    }

    if (foundWidget && typeof WB.openPdfEditorForWidget === 'function') {
      const targetPageIdx = Math.max(0, Number(snap.pdfView.pageIdx) || 0);
      const applyPdfScroll = () => {
        const vp = document.getElementById('pdfCanvasViewport');
        if (!vp) return;
        const wrap = vp.querySelector(`.pdf-page-wrap[data-page-idx="${targetPageIdx}"]`);
        if (wrap) {
          const relY = typeof snap.pdfView.pageRelY === 'number' ? snap.pdfView.pageRelY : 0.2;
          const targetTop = Math.max(0, wrap.offsetTop + wrap.offsetHeight * relY - vp.clientHeight / 2);
          vp.scrollTop = targetTop;
          WB.pdfEditor.currentPage = targetPageIdx;
          if (typeof WB.updatePdfPageIndicator === 'function') WB.updatePdfPageIndicator();
          if (typeof WB.highlightActivePdfThumb === 'function') WB.highlightActivePdfThumb();
        } else if (typeof snap.pdfView.scrollRatio === 'number') {
          const maxScroll = Math.max(0, vp.scrollHeight - vp.clientHeight);
          vp.scrollTop = Math.round(maxScroll * Math.max(0, Math.min(1, snap.pdfView.scrollRatio)));
        }
      };

      if (!WB.pdfEditor.isOpen || WB.pdfEditor.targetWidgetId !== targetWidgetId) {
        WB.openPdfEditorForWidget(targetWidgetId, {
          pageIdx: targetPageIdx,
          zoom: snap.pdfView.zoom,
          silentSync: true
        });
        setTimeout(applyPdfScroll, 120);
        setTimeout(applyPdfScroll, 380);
      } else {
        applyPdfScroll();
      }

      if (toastText && typeof WB.showToast === 'function') WB.showToast(toastText, 2800);
      WB.broadcastPeerViewport(true);
      return;
    }
  }

  // 3. Цель на обычном холсте — закрываем PDF-редактор (если открыт) и центрируем камеру с учётом размера экрана
  if (WB.pdfEditor && WB.pdfEditor.isOpen && typeof WB.closePdfEditor === 'function') {
    WB.closePdfEditor();
  }

  const myW = Math.max(320, window.innerWidth || 1280);
  const myH = Math.max(320, window.innerHeight || 720);
  if (typeof snap.centerX === 'number' && typeof snap.centerY === 'number') {
    const srcZ = Math.max(0.15, Math.min(5, Number(snap.cam && snap.cam.z) || 1));
    const srcW = Math.max(320, Number(snap.vpW) || myW);
    const scaleRatio = myW < srcW ? Math.max(0.42, myW / srcW) : 1;
    const targetZ = Math.max(0.15, Math.min(5, srcZ * scaleRatio));
    WB.cam = {
      x: Math.round(myW / 2 - snap.centerX * targetZ),
      y: Math.round(myH / 2 - snap.centerY * targetZ),
      z: Math.round(targetZ * 1000) / 1000
    };
  } else if (snap.cam) {
    WB.cam = {
      x: Number(snap.cam.x) || 0,
      y: Number(snap.cam.y) || 0,
      z: Number(snap.cam.z) || 1
    };
  }
  if (typeof WB.updateCameraUI === 'function') WB.updateCameraUI();
  if (toastText && typeof WB.showToast === 'function') WB.showToast(toastText, 2800);
  WB.broadcastPeerViewport(true);
};

// --- ПЕРЕМЕСТИТЬСЯ К УЧАСТНИКУ И ПРИТЯНУТЬ К СЕБЕ ---
WB.jumpToPeer = function(peerId = null) {
  const peers = Object.entries(WB.collab.remotePeers || {});
  if (peers.length === 0) {
    if (WB.pdfEditor && WB.pdfEditor.isOpen && typeof WB.closePdfEditor === 'function') {
      WB.closePdfEditor();
    }
    if (typeof WB.fitAllContent === 'function') {
      WB.fitAllContent(true);
    }
    return;
  }

  let entry = peerId ? peers.find(([id]) => id === peerId) : null;
  if (!entry) {
    if (WB.userRole === 'student') {
      entry = peers.find(([, p]) => p && p.role !== 'student') || peers[0];
    } else {
      entry = peers[0];
    }
  }
  const peer = entry?.[1];
  if (!peer) return;

  if (peer.view) {
    WB.applyRemoteViewportSnapshot(peer.view, `📍 Переход к ${peer.name || 'участнику'}`);
  } else {
    if (WB.pdfEditor && WB.pdfEditor.isOpen && typeof WB.closePdfEditor === 'function') {
      WB.closePdfEditor();
    }
    if (typeof WB.savePrevCamera === 'function') WB.savePrevCamera();
    if (peer.cam) {
      WB.cam = { x: Number(peer.cam.x) || 0, y: Number(peer.cam.y) || 0, z: Number(peer.cam.z) || 1 };
    } else {
      WB.cam.x = Math.round(window.innerWidth / 2 - (peer.x || 0) * WB.cam.z);
      WB.cam.y = Math.round(window.innerHeight / 2 - (peer.y || 0) * WB.cam.z);
    }
    if (typeof WB.updateCameraUI === 'function') WB.updateCameraUI();
  }
  WB.closeAllDropdowns();
};

WB.summonPeerToMe = function(peerId) {
  if (WB.userRole === 'student') return;
  if (WB.collab.mode === 'offline' || !WB.collab.roomId) WB.startLiveSession();
  if (typeof WB.syncPdfAnnotationsToWidget === 'function' && WB.pdfEditor && WB.pdfEditor.isOpen) {
    WB.syncPdfAnnotationsToWidget();
  }
  const view = WB.getMyViewportSnapshot();
  WB.broadcastData({
    type: 'summon_cam',
    targetId: peerId,
    view,
    cam: view.cam,
    teacherName: WB.collab.myName || 'Преподаватель'
  });
  WB.closeAllDropdowns();
  if (typeof WB.showToast === 'function') WB.showToast('📍 Ученик притянут к вашей области экрана', 2000);
};

WB.summonStudentsToMe = function() {
  if (WB.userRole === 'student') return;
  if (WB.collab.mode === 'offline' || !WB.collab.roomId) {
    WB.startLiveSession();
  }
  if (typeof WB.syncPdfAnnotationsToWidget === 'function' && WB.pdfEditor && WB.pdfEditor.isOpen) {
    WB.syncPdfAnnotationsToWidget();
  }
  const view = WB.getMyViewportSnapshot();
  WB.broadcastData({
    type: 'summon_cam',
    view,
    cam: view.cam,
    teacherName: WB.collab.myName || 'Преподаватель'
  });
  if (typeof WB.showToast === 'function') WB.showToast('📍 Все ученики притянуты к вашей области экрана', 2000);
};

// --- ОТКРЫТИЕ / ЗАКРЫТИЕ ОКНА «ПОДЕЛИТЬСЯ» ---
WB.openStudentInviteModal = function() {
  if (WB.userRole === 'student') return;
  WB.closeAllDropdowns();
  if (WB.boardAccessOpen !== false && (WB.collab.mode === 'offline' || !WB.collab.roomId)) {
    WB.startLiveSession(false);
  }

  const modal = document.getElementById('studentInviteModal');
  const toggleEl = document.getElementById('boardOpenToggle');
  const bodyWrap = document.getElementById('shareActiveLinkWrap');
  if (!modal) return;

  if (toggleEl) toggleEl.checked = WB.boardAccessOpen !== false;
  if (bodyWrap) {
    bodyWrap.style.opacity = WB.boardAccessOpen === false ? '0.45' : '1';
    bodyWrap.style.pointerEvents = WB.boardAccessOpen === false ? 'none' : 'auto';
  }

  WB.refreshShareModalLinkAndQR();
  WB.updateCollabUI();
  modal.style.display = 'flex';

  // Автоматически создаём или подтверждаем временную интернет-ссылку
  if (WB.boardAccessOpen !== false) {
    WB.ensureTemporaryLink(false, false);
  }
};

WB.closeStudentInviteModal = function() {
  const modal = document.getElementById('studentInviteModal');
  if (modal) modal.style.display = 'none';
};

WB.toggleBoardAccess = function(isOpen) {
  if (WB.userRole === 'student') return;
  WB.boardAccessOpen = !!isOpen;
  const bodyWrap = document.getElementById('shareActiveLinkWrap');
  if (bodyWrap) {
    bodyWrap.style.opacity = WB.boardAccessOpen ? '1' : '0.45';
    bodyWrap.style.pointerEvents = WB.boardAccessOpen ? 'auto' : 'none';
  }
  if (WB.boardAccessOpen) {
    if (WB.collab.mode === 'offline' || !WB.collab.roomId) {
      WB.startLiveSession(false);
    }
    WB.ensureTemporaryLink(false, true);
    WB.updateCollabUI();
  } else {
    WB.broadcastData({
      type: 'teacher_left',
      message: 'Преподаватель закрыл доступ к доске.'
    });
    WB.closeTemporaryLink(true);
    WB.stopLiveSession();
    WB.updateCollabUI();
  }
};

WB.copyStudentLink = function() {
  const input = document.getElementById('studentInviteUrl');
  const url = (input && input.value) ? input.value : WB.getStudentInviteUrl();
  if (input && !input.value) input.value = url;

  WB.copyTextSafe(url, input).then(() => {
    const lbl = document.getElementById('copyStudentLinkLabel');
    if (lbl) {
      lbl.textContent = '✅ Ссылка скопирована!';
      clearTimeout(lbl._timer);
      lbl._timer = setTimeout(() => { lbl.textContent = 'Копировать ссылку'; }, 1800);
    }
    if (typeof WB.showToast === 'function') {
      WB.showToast('✅ Ссылка для учеников скопирована в буфер обмена!');
    }
  });
};

// --- НАСТОЯЩИЙ СТАНДАРТНЫЙ ГЕНЕРАТОР QR-КОДА (ISO/IEC 18004, REED-SOLOMON ECC L) ---
const WB_QR_VERSIONS_L = [
  null,
  { total: 26, ecPerBlock: 7, blocks1: 1, data1: 19, blocks2: 0, data2: 0, align: [] },
  { total: 44, ecPerBlock: 10, blocks1: 1, data1: 34, blocks2: 0, data2: 0, align: [6, 18] },
  { total: 70, ecPerBlock: 15, blocks1: 1, data1: 55, blocks2: 0, data2: 0, align: [6, 22] },
  { total: 100, ecPerBlock: 20, blocks1: 1, data1: 80, blocks2: 0, data2: 0, align: [6, 26] },
  { total: 134, ecPerBlock: 26, blocks1: 1, data1: 108, blocks2: 0, data2: 0, align: [6, 30] },
  { total: 172, ecPerBlock: 18, blocks1: 2, data1: 68, blocks2: 0, data2: 0, align: [6, 34] },
  { total: 196, ecPerBlock: 20, blocks1: 2, data1: 78, blocks2: 0, data2: 0, align: [6, 22, 38] },
  { total: 242, ecPerBlock: 24, blocks1: 2, data1: 97, blocks2: 0, data2: 0, align: [6, 24, 42] },
  { total: 292, ecPerBlock: 30, blocks1: 2, data1: 116, blocks2: 0, data2: 0, align: [6, 26, 46] },
  { total: 346, ecPerBlock: 18, blocks1: 2, data1: 68, blocks2: 2, data2: 69, align: [6, 28, 50] }
];

WB.generateQRMatrix = function(text) {
  const bytes = Array.from(new TextEncoder().encode(String(text || '')));
  let ver = 1;
  while (ver <= 10) {
    const spec = WB_QR_VERSIONS_L[ver];
    const totalData = spec.blocks1 * spec.data1 + spec.blocks2 * spec.data2;
    const headerBits = ver <= 9 ? 12 : 20;
    if (bytes.length * 8 + headerBits <= totalData * 8) break;
    ver++;
  }
  if (ver > 10) ver = 10;
  const spec = WB_QR_VERSIONS_L[ver];
  const totalData = spec.blocks1 * spec.data1 + spec.blocks2 * spec.data2;

  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  pushBits(0b0100, 4);
  const clipped = bytes.slice(0, totalData - (ver <= 9 ? 2 : 3));
  pushBits(clipped.length, ver <= 9 ? 8 : 16);
  for (const b of clipped) pushBits(b, 8);

  const maxBits = totalData * 8;
  const term = Math.min(4, maxBits - bits.length);
  for (let i = 0; i < term; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataCw = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    dataCw.push(b);
  }
  let padIdx = 0;
  while (dataCw.length < totalData) {
    dataCw.push(padIdx % 2 === 0 ? 0xec : 0x11);
    padIdx++;
  }

  const gfExp = new Uint8Array(512);
  const gfLog = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    gfExp[i] = x;
    gfLog[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) gfExp[i] = gfExp[i - 255];
  const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : gfExp[gfLog[a] + gfLog[b]]);

  let gen = [1];
  for (let i = 0; i < spec.ecPerBlock; i++) {
    const next = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= gfMul(gen[j], gfExp[i]);
    }
    gen = next;
  }

  const computeEC = (block) => {
    const msg = [...block, ...new Array(spec.ecPerBlock).fill(0)];
    for (let i = 0; i < block.length; i++) {
      const coef = msg[i];
      if (coef !== 0) {
        for (let j = 0; j < gen.length; j++) {
          msg[i + j] ^= gfMul(gen[j], coef);
        }
      }
    }
    return msg.slice(block.length);
  };

  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (let b = 0; b < spec.blocks1; b++) {
    const blk = dataCw.slice(offset, offset + spec.data1);
    offset += spec.data1;
    dataBlocks.push(blk);
    ecBlocks.push(computeEC(blk));
  }
  for (let b = 0; b < spec.blocks2; b++) {
    const blk = dataCw.slice(offset, offset + spec.data2);
    offset += spec.data2;
    dataBlocks.push(blk);
    ecBlocks.push(computeEC(blk));
  }

  const finalCw = [];
  const maxDataLen = Math.max(spec.data1, spec.data2);
  for (let i = 0; i < maxDataLen; i++) {
    for (const blk of dataBlocks) {
      if (i < blk.length) finalCw.push(blk[i]);
    }
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const blk of ecBlocks) {
      if (i < blk.length) finalCw.push(blk[i]);
    }
  }

  const size = 17 + ver * 4;
  const mat = Array.from({ length: size }, () => Array(size).fill(false));
  const isFunc = Array.from({ length: size }, () => Array(size).fill(false));

  const setFunc = (r, c, val) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      mat[r][c] = val;
      isFunc[r][c] = true;
    }
  };

  const drawFinder = (r0, c0) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr;
        const c = c0 + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const onBorder = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) || (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6));
        const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunc(r, c, onBorder || inCore);
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    setFunc(6, i, i % 2 === 0);
    setFunc(i, 6, i % 2 === 0);
  }

  const align = spec.align;
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) continue;
      const cr = align[i];
      const cc = align[j];
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const val = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFunc(cr + dr, cc + dc, val);
        }
      }
    }
  }

  for (let i = 0; i <= 8; i++) {
    if (!isFunc[8][i]) setFunc(8, i, false);
    if (!isFunc[i][8]) setFunc(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    if (!isFunc[8][size - 1 - i]) setFunc(8, size - 1 - i, false);
    if (!isFunc[size - 1 - i][8]) setFunc(size - 1 - i, 8, false);
  }
  setFunc(size - 8, 8, true);

  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
    const vBits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((vBits >> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunc(a, b, bit);
      setFunc(b, a, bit);
    }
  }

  let bitIdx = 0;
  const totalBits = finalCw.length * 8;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const r = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (!isFunc[r][c]) {
          let bit = false;
          if (bitIdx < totalBits) {
            bit = ((finalCw[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1) === 1;
            bitIdx++;
          }
          if ((r + c) % 2 === 0) bit = !bit;
          mat[r][c] = bit;
        }
      }
    }
    upward = !upward;
  }

  const fmtData = (0b01 << 3) | 0;
  let fmtRem = fmtData;
  for (let i = 0; i < 10; i++) fmtRem = (fmtRem << 1) ^ ((fmtRem >> 9) * 0x537);
  const fmtBits = ((fmtData << 10) | fmtRem) ^ 0x5412;

  for (let i = 0; i <= 5; i++) mat[8][i] = ((fmtBits >> i) & 1) === 1;
  mat[8][7] = ((fmtBits >> 6) & 1) === 1;
  mat[8][8] = ((fmtBits >> 7) & 1) === 1;
  mat[7][8] = ((fmtBits >> 8) & 1) === 1;
  for (let i = 9; i < 15; i++) mat[14 - i][8] = ((fmtBits >> i) & 1) === 1;

  for (let i = 0; i < 8; i++) mat[8][size - 1 - i] = ((fmtBits >> i) & 1) === 1;
  for (let i = 8; i < 15; i++) mat[size - 15 + i][8] = ((fmtBits >> i) & 1) === 1;

  return mat;
};

WB.renderAutonomousQRCode = function(text, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const grid = WB.generateQRMatrix(text);
  const size = grid.length;
  const margin = 3;
  const cellSize = 4;
  const svgW = (size + margin * 2) * cellSize;
  let paths = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c]) {
        paths += `M${(c + margin) * cellSize},${(r + margin) * cellSize}h${cellSize}v${cellSize}h-${cellSize}z `;
      }
    }
  }

  container.innerHTML = `
    <svg viewBox="0 0 ${svgW} ${svgW}" width="152" height="152" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="QR-код ссылки на доску">
      <rect width="${svgW}" height="${svgW}" fill="#ffffff"/>
      <path d="${paths}" fill="#0f172a"/>
    </svg>
  `;
};

// --- ЗАПУСК И ПОДКЛЮЧЕНИЕ К КОМНАТЕ (СЕРВЕРНЫЙ WEBSOCKET + КРОСС-ДОМЕННЫЙ MQTT) ---
WB.startLiveSession = function(forceNewRoom = false) {
  const roomId = WB.getOrCreatePersistentRoomId(forceNewRoom);
  WB.connectToRoom(roomId);
};

WB.updateBrowserRoomUrl = function(roomId) {
  if (!/^https?:$/i.test(window.location.protocol)) return;
  try {
    const target = WB.userRole === 'student'
      ? `/shared/${encodeURIComponent(roomId)}`
      : `/room/${encodeURIComponent(roomId)}`;
    const current = window.location.pathname + window.location.search;
    if (current !== target) {
      window.history.replaceState(null, '', target);
    }
  } catch (_) {}
};

WB.connectServerWebSocket = function(roomId, attempt = 0) {
  if (WB.collab.wasKicked || WB.collab.serverSupportsWs === false) return;
  const wsBase = WB.getWsBaseUrl();
  if (!wsBase || !roomId) return;
  const isFileLocal = window.location.protocol === 'file:';
  if (isFileLocal && attempt > 1) return;
  if (attempt > 3) return;

  if (WB.collab.serverWs) {
    try {
      WB.collab.serverWs.onclose = null;
      WB.collab.serverWs.onerror = null;
      WB.collab.serverWs.close();
    } catch (_) {}
    WB.collab.serverWs = null;
  }
  if (WB.collab.serverWsReconnectTimer) {
    clearTimeout(WB.collab.serverWsReconnectTimer);
    WB.collab.serverWsReconnectTimer = null;
  }
  if (WB.collab.serverPingTimer) {
    clearInterval(WB.collab.serverPingTimer);
    WB.collab.serverPingTimer = null;
  }

  const roleParam = WB.userRole === 'student' ? '&role=student' : '';
  const wsUrl = `${wsBase}/ws?room=${encodeURIComponent(roomId)}${roleParam}`;

  let sws;
  try {
    sws = new WebSocket(wsUrl);
    WB.collab.serverWs = sws;
  } catch (_) {
    return;
  }

  sws.onopen = () => {
    WB.collab.mode = 'online';
    WB.collab.brokerName = 'Сервер доски (WebSocket)';
    WB.updateBrowserRoomUrl(roomId);
    WB.updateCollabUI();

    const snap = WB.getMyViewportSnapshot();
    try {
      sws.send(JSON.stringify({
        senderId: WB.collab.myId,
        type: 'hello',
        name: WB.collab.myName,
        color: WB.collab.myColor,
        role: WB.userRole,
        cam: snap.cam,
        view: snap
      }));
    } catch (_) {}

    WB.collab.serverPingTimer = setInterval(() => {
      if (sws.readyState === WebSocket.OPEN) {
        const curSnap = WB.getMyViewportSnapshot();
        try {
          sws.send(JSON.stringify({
            senderId: WB.collab.myId,
            type: 'ping_peer',
            name: WB.collab.myName,
            color: WB.collab.myColor,
            role: WB.userRole,
            cam: curSnap.cam,
            view: curSnap
          }));
        } catch (_) {}
      }
      WB.updateCollabUI();
    }, 5000);
  };

  sws.onmessage = (event) => {
    try {
      const msg = JSON.parse(String(event.data || ''));
      WB.handleIncomingData(msg, 'ws');
    } catch (_) {}
  };

  sws.onclose = (ev) => {
    if (WB.collab.serverPingTimer) {
      clearInterval(WB.collab.serverPingTimer);
      WB.collab.serverPingTimer = null;
    }
    if (WB.collab.wasKicked) return;
    if (ev && ev.code === 1008 && WB.userRole === 'student') {
      WB.showRoomClosedOverlay('Преподаватель закрыл доступ к этой доске.');
      return;
    }
    if (WB.collab.roomId === roomId && WB.collab.mode !== 'offline') {
      if (isFileLocal && attempt >= 1) return;
      const delay = Math.min(5000, 800 * Math.pow(1.6, attempt));
      WB.collab.serverWsReconnectTimer = setTimeout(() => {
        if (!WB.collab.wasKicked && WB.collab.roomId === roomId && WB.collab.mode !== 'offline') {
          WB.connectServerWebSocket(roomId, attempt + 1);
        }
      }, delay);
    }
  };
};

WB.connectToRoom = function(roomId, brokerIndex = 0) {
  if (WB.collab.wasKicked) return;
  const safeRoomId = WB.sanitizeRoomId(roomId) || WB.getOrCreatePersistentRoomId(true);
  WB.stopLiveSession(true);

  WB.collab.roomId = safeRoomId;
  try { localStorage.setItem('wb_my_room_id', safeRoomId); } catch (_) {}
  WB.collab.brokerIdx = brokerIndex;
  WB.collab.mode = 'connecting';
  WB.syncDiffBaselineFromCurrentState();
  WB.updateBrowserRoomUrl(safeRoomId);
  WB.updateCollabUI();

  // 1. Локальный канал между вкладками браузера
  try {
    WB.collab.bc = new BroadcastChannel('wb_channel_' + safeRoomId);
    WB.collab.bc.onmessage = (ev) => {
      try { WB.handleIncomingData(JSON.parse(ev.data), 'bc'); } catch (e) {}
    };
  } catch (e) {}

  setTimeout(() => {
    if (WB.collab.bc) {
      const snap = WB.getMyViewportSnapshot();
      try {
        WB.collab.bc.postMessage(JSON.stringify({
          senderId: WB.collab.myId,
          type: 'hello',
          name: WB.collab.myName,
          color: WB.collab.myColor,
          role: WB.userRole,
          cam: snap.cam,
          view: snap
        }));
      } catch (_) {}
    }
  }, 60);

  // 2. Прямой серверный WebSocket (/ws) + загрузка/публикация комнаты на сервере
  if (brokerIndex === 0) {
    WB.connectServerWebSocket(safeRoomId, 0);
  }

  if (!navigator.onLine) {
    WB.collab.mode = 'online';
    WB.collab.brokerName = 'Локальная сеть браузера';
    WB.updateCollabUI();
    return;
  }

  // 3. Кросс-доменный MQTT-мост (работает даже если учитель открыл dev-превью, а ученик — публичный Shared URL)
  const broker = WB.BROKERS[brokerIndex];
  const topic = 'whiteboard_pro_ru_v2/' + safeRoomId;
  let connected = false;
  let rxBuffer = new Uint8Array(0);

  let ws;
  try {
    ws = new WebSocket(broker.url, 'mqtt');
    ws.binaryType = 'arraybuffer';
    WB.collab.ws = ws;
  } catch (e) {
    return WB.tryNextBroker(safeRoomId, brokerIndex);
  }

  const connectTimeout = setTimeout(() => {
    if (!connected) {
      try { ws.close(); } catch (e) {}
      WB.tryNextBroker(safeRoomId, brokerIndex);
    }
  }, 4000);

  ws.onopen = () => {
    ws.send(buildConnectPacket('wb_' + WB.collab.myId + '_' + Math.floor(Math.random() * 1000)));
  };

  ws.onmessage = (event) => {
    const chunk = new Uint8Array(event.data);
    const merged = new Uint8Array(rxBuffer.length + chunk.length);
    merged.set(rxBuffer, 0);
    merged.set(chunk, rxBuffer.length);
    rxBuffer = merged;

    while (rxBuffer.length >= 2) {
      const type = rxBuffer[0] & 0xf0;
      const flags = rxBuffer[0] & 0x0f;
      const varLen = decodeVarInt(rxBuffer, 1);
      if (!varLen) break;
      const totalLen = 1 + varLen.bytesRead + varLen.value;
      if (rxBuffer.length < totalLen) break;

      const packet = rxBuffer.slice(0, totalLen);
      rxBuffer = rxBuffer.slice(totalLen);

      if (type === 0x20) {
        connected = true;
        clearTimeout(connectTimeout);
        WB.collab.mode = 'online';
        WB.collab.brokerName = WB.collab.serverWs && WB.collab.serverWs.readyState === WebSocket.OPEN
          ? 'Сервер доски + Интернет-мост'
          : broker.name;

        WB.updateBrowserRoomUrl(safeRoomId);
        WB.updateCollabUI();

        ws.send(buildSubscribePacket(topic));
        const sendHello = () => {
          const snap = WB.getMyViewportSnapshot();
          WB.broadcastData({
            type: 'hello',
            name: WB.collab.myName,
            color: WB.collab.myColor,
            role: WB.userRole,
            cam: snap.cam,
            view: snap
          });
        };
        setTimeout(sendHello, 150);

        if (WB.userRole === 'student' && !WB.collab.hasReceivedInit) {
          let retriesLeft = 3;
          if (WB.collab.helloRetryTimer) clearInterval(WB.collab.helloRetryTimer);
          WB.collab.helloRetryTimer = setInterval(() => {
            if (WB.collab.wasKicked || WB.collab.hasReceivedInit || retriesLeft <= 0 || WB.collab.mode === 'offline') {
              clearInterval(WB.collab.helloRetryTimer);
              WB.collab.helloRetryTimer = null;
              return;
            }
            retriesLeft--;
            sendHello();
          }, 1800);
        }

        WB.collab.pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(new Uint8Array([0xc0, 0x00]));
            const serverWsOpen = WB.collab.serverWs && WB.collab.serverWs.readyState === WebSocket.OPEN;
            if (!serverWsOpen || WB.collab.hasMqttPeer) {
              const curSnap = WB.getMyViewportSnapshot();
              WB.broadcastData({
                type: 'ping_peer',
                name: WB.collab.myName,
                color: WB.collab.myColor,
                role: WB.userRole,
                cam: curSnap.cam,
                view: curSnap
              });
            }
          }
          WB.updateCollabUI();
        }, 5000);

      } else if (type === 0x30) {
        let pos = 1 + varLen.bytesRead;
        const topicLen = (packet[pos] << 8) | packet[pos + 1];
        pos += 2 + topicLen;
        const qos = (flags >> 1) & 0x03;
        if (qos > 0) pos += 2;
        const payloadBytes = packet.slice(pos);
        try {
          const jsonStr = new TextDecoder().decode(payloadBytes);
          WB.handleIncomingData(JSON.parse(jsonStr), 'mqtt');
        } catch (e) {}
      }
    }
  };

  ws.onerror = () => {
    if (!connected && !WB.collab.wasKicked) {
      clearTimeout(connectTimeout);
      WB.tryNextBroker(safeRoomId, brokerIndex);
    }
  };

  ws.onclose = () => {
    if (connected && !WB.collab.wasKicked && WB.collab.mode === 'online') {
      WB.tryNextBroker(safeRoomId, 0);
    }
  };
};

WB.tryNextBroker = function(roomId, currentIndex) {
  if (WB.collab.mode === 'offline') return;
  const nextIndex = currentIndex + 1;
  if (nextIndex < WB.BROKERS.length) {
    WB.connectToRoom(roomId, nextIndex);
  } else {
    WB.collab.mode = 'online';
    WB.collab.brokerName = (WB.collab.serverWs && WB.collab.serverWs.readyState === WebSocket.OPEN)
      ? 'Сервер доски (WebSocket)'
      : 'Локальный канал браузера';
    WB.updateCollabUI();
  }
};

WB.stopLiveSession = function(silent = false) {
  if (WB.collab.pingTimer) clearInterval(WB.collab.pingTimer);
  WB.collab.pingTimer = null;
  if (WB.collab.serverPingTimer) clearInterval(WB.collab.serverPingTimer);
  WB.collab.serverPingTimer = null;
  if (WB.collab.serverWsReconnectTimer) clearTimeout(WB.collab.serverWsReconnectTimer);
  WB.collab.serverWsReconnectTimer = null;
  if (WB.collab.helloRetryTimer) clearInterval(WB.collab.helloRetryTimer);
  WB.collab.helloRetryTimer = null;
  if (WB.collab.studentWatchTimer) clearInterval(WB.collab.studentWatchTimer);
  WB.collab.studentWatchTimer = null;

  if (WB.collab.serverWs) {
    try {
      WB.collab.serverWs.onclose = null;
      WB.collab.serverWs.onerror = null;
      WB.collab.serverWs.close();
    } catch (_) {}
    WB.collab.serverWs = null;
  }

  if (WB.collab.ws) {
    try {
      WB.collab.ws.onclose = null;
      WB.collab.ws.onerror = null;
      WB.collab.ws.close();
    } catch (e) {}
    WB.collab.ws = null;
  }

  if (WB.collab.bc) {
    try { WB.collab.bc.close(); } catch (e) {}
    WB.collab.bc = null;
  }

  WB.collab.mode = 'offline';
  if (!silent) {
    WB.collab.remotePeers = {};
    if (/^https?:$/i.test(window.location.protocol)) {
      try {
        window.history.replaceState(null, '', '/');
      } catch (e) {}
    }
    WB.updateCollabUI();
  }
};

WB.broadcastData = function(payload, opts = {}) {
  if (!WB.collab.roomId || WB.collab.wasKicked) return;
  payload.senderId = WB.collab.myId;
  if (!payload.msgId) {
    payload.msgId = WB.collab.myId + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  }
  const jsonStr = JSON.stringify(payload);
  const serverWsOpen = !!(WB.collab.serverWs && WB.collab.serverWs.readyState === WebSocket.OPEN);

  if (serverWsOpen) {
    try { WB.collab.serverWs.send(jsonStr); } catch (_) {}
  }

  if (WB.collab.bc) {
    try { WB.collab.bc.postMessage(jsonStr); } catch (e) {}
  }

  // Отправляем через публичный MQTT только при необходимости (нет прямого /ws или подключён MQTT-клиент)
  // и никогда не шлём тяжёлые пакеты > 64 КБ, которые блокируют/рвут MQTT-сокет
  const forceMqtt = !!opts.forceMqtt || payload.type === 'hello' || payload.type === 'peer_kicked' || payload.type === 'teacher_left';
  if (WB.collab.ws && WB.collab.ws.readyState === WebSocket.OPEN && jsonStr.length < 64000) {
    if (!serverWsOpen || WB.collab.hasMqttPeer || forceMqtt) {
      const topic = 'whiteboard_pro_ru_v2/' + WB.collab.roomId;
      try {
        WB.collab.ws.send(buildPublishPacket(topic, jsonStr));
      } catch (e) {}
    }
  }
};

// --- БЫСТРЫЙ ДИФФИНГ, СТРИМИНГ ШТРИХОВ И СИНХРОНИЗАЦИЯ PDF/DOCX ---
WB.computeStrokeSyncSig = function(s) {
  if (!s) return '';
  const pts = Array.isArray(s.points) ? s.points : null;
  const pLen = pts ? pts.length : 0;
  const p0 = pLen > 0 ? `${Math.round(pts[0].x)},${Math.round(pts[0].y)}` : '';
  const pLast = pLen > 1 ? `${Math.round(pts[pLen - 1].x)},${Math.round(pts[pLen - 1].y)}` : '';
  return `${s.tool || ''}|${s.color || ''}|${s.size || 0}|${s.opacity || 1}|${s.lineStyle || ''}|${s.fillColor || ''}|${pLen}|${p0}|${pLast}|${Math.round(s.x1 || 0)},${Math.round(s.y1 || 0)},${Math.round(s.x2 || 0)},${Math.round(s.y2 || 0)}`;
};

WB.computeWidgetSyncSig = function(w) {
  if (!w) return '';
  const srcSig = typeof w.src === 'string' ? `${w.src.length}:${w.src.slice(-20)}` : '';
  const pagesSig = Array.isArray(w.pdfPages) ? w.pdfPages.map(p => (typeof p === 'string' ? p.length : 0)).join(',') : '';
  const docxSig = Array.isArray(w.docxPagesHtml) ? w.docxPagesHtml.map(h => (typeof h === 'string' ? h.length + ':' + h.slice(-16) : 0)).join(',') : '';
  let pdfStrSig = '';
  if (w.pdfStrokesByPage && typeof w.pdfStrokesByPage === 'object') {
    pdfStrSig = Object.keys(w.pdfStrokesByPage).sort().map(k => `${k}:${(w.pdfStrokesByPage[k] || []).length}`).join(',');
  }
  let pdfWidSig = '';
  if (w.pdfWidgetsByPage && typeof w.pdfWidgetsByPage === 'object') {
    pdfWidSig = Object.keys(w.pdfWidgetsByPage).sort().map(k => `${k}:${(w.pdfWidgetsByPage[k] || []).length}`).join(',');
  }
  return [
    w.type || '',
    Math.round(w.x || 0), Math.round(w.y || 0), Math.round(w.w || 0), Math.round(w.h || 0),
    w.color || '', w.bg || '', w.fontSize || '', w.currentPage || 0, w.locked ? 1 : 0,
    w.title || '', w.text || '', w.latex || '', w.formula || '',
    srcSig, pagesSig, docxSig, pdfStrSig, pdfWidSig
  ].join('|');
};

WB.syncDiffBaselineFromCurrentState = function() {
  const sMap = new Map();
  const wMap = new Map();
  const strokes = (WB.state && Array.isArray(WB.state.strokes)) ? WB.state.strokes : [];
  const widgets = (WB.state && Array.isArray(WB.state.widgets)) ? WB.state.widgets : [];
  for (let i = 0; i < strokes.length; i++) {
    const s = strokes[i];
    if (s && s.id) sMap.set(s.id, WB.computeStrokeSyncSig(s));
  }
  for (let i = 0; i < widgets.length; i++) {
    const w = widgets[i];
    if (w && w.id) wMap.set(w.id, WB.computeWidgetSyncSig(w));
  }
  WB.collab.lastSyncedBoard = {
    pageIndex: typeof WB.currentPageIndex === 'number' ? WB.currentPageIndex : 0,
    pageCount: Array.isArray(WB.pages) ? WB.pages.length : 1,
    strokes: sMap,
    widgets: wMap
  };
};

WB.streamBoardStrokeLive = function(stroke) {
  if (!stroke || !stroke.id || WB.collab.mode !== 'online' || !WB.collab.roomId || WB.collab.isApplyingRemote) return;
  const now = performance.now();
  const st = WB.collab.liveStream;
  if (st.id !== stroke.id) {
    st.id = stroke.id;
    st.sentPoints = 0;
    st.lastSentAt = 0;
  }
  if (now - st.lastSentAt < 32) return;
  st.lastSentAt = now;

  const pageIndex = typeof WB.currentPageIndex === 'number' ? WB.currentPageIndex : 0;
  if (Array.isArray(stroke.points)) {
    if (st.sentPoints === 0) {
      st.sentPoints = stroke.points.length;
      WB.broadcastData({
        type: 'stroke_live',
        pageIndex,
        strokeId: stroke.id,
        stroke: {
          ...stroke,
          points: stroke.points.slice()
        }
      });
    } else if (stroke.points.length > st.sentPoints) {
      const chunk = stroke.points.slice(st.sentPoints);
      st.sentPoints = stroke.points.length;
      WB.broadcastData({
        type: 'stroke_live',
        pageIndex,
        strokeId: stroke.id,
        pointsChunk: chunk
      });
    }
  } else {
    WB.broadcastData({
      type: 'stroke_live',
      pageIndex,
      strokeId: stroke.id,
      stroke
    });
  }
};

WB.broadcastPdfEvent = function(type, payload) {
  if (!WB.collab.roomId || WB.collab.mode !== 'online' || WB.collab.isApplyingRemote) return;
  WB.broadcastData({
    type,
    ...payload
  });
};

WB.broadcastPagesMeta = function() {
  if (!WB.collab.roomId || WB.collab.mode !== 'online' || WB.collab.isApplyingRemote) return;
  if (!Array.isArray(WB.pages)) return;
  WB.broadcastData({
    type: 'pages_meta',
    pagesMeta: WB.pages.map(p => ({ id: p.id, name: p.name })),
    currentPageIndex: WB.currentPageIndex,
    boardTitle: WB.boardTitle
  });
};

WB.broadcastBoardPageEvent = function(type, payload) {
  if (!WB.collab.roomId || WB.collab.mode !== 'online' || WB.collab.isApplyingRemote) return;
  WB.broadcastData({
    type,
    ...payload
  });
};

WB.pushRoomSnapshotToServer = async function(notifyPeersPull = false) {
  const apiBase = WB.getApiBaseUrl();
  if ((!(/^https?:$/i.test(window.location.protocol)) && !apiBase) || !WB.collab.roomId) return false;
  if (typeof WB.syncCurrentPage === 'function') WB.syncCurrentPage();
  try {
    const resp = await fetch(`${apiBase}/api/rooms/${encodeURIComponent(WB.collab.roomId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessOpen: WB.boardAccessOpen !== false,
        boardTitle: WB.boardTitle || 'Новый урок',
        state: WB.state || { strokes: [], widgets: [] },
        pages: Array.isArray(WB.pages) ? WB.pages : [],
        currentPageIndex: typeof WB.currentPageIndex === 'number' ? WB.currentPageIndex : 0,
        permissions: WB.studentPermissions || { deleteStrokes: false, deleteObjects: false, editMaterials: true }
      })
    });
    if (resp.ok && notifyPeersPull) {
      WB.collab.syncRev = (WB.collab.syncRev || 0) + 1;
      WB.broadcastData({
        type: 'room_sync_pull',
        roomId: WB.collab.roomId,
        rev: WB.collab.syncRev
      });
    }
    return resp.ok;
  } catch (_) {
    return false;
  }
};

WB.scheduleRoomServerPush = function(delayMs = 900) {
  if (WB.collab.pendingRoomPushTimer) clearTimeout(WB.collab.pendingRoomPushTimer);
  WB.collab.pendingRoomPushTimer = setTimeout(() => {
    WB.collab.pendingRoomPushTimer = null;
    WB.pushRoomSnapshotToServer(false);
  }, delayMs);
};

WB.applyRemoteBoardPayload = function(data) {
  WB.collab.isApplyingRemote = true;
  if (Array.isArray(data.pages) && data.pages.length > 0) {
    WB.pages = data.pages;
    if (typeof data.currentPageIndex === 'number' && data.currentPageIndex >= 0 && data.currentPageIndex < WB.pages.length) {
      WB.currentPageIndex = data.currentPageIndex;
    }
    const curPage = WB.pages[WB.currentPageIndex] || WB.pages[0];
    WB.state = {
      strokes: Array.isArray(curPage.strokes) ? curPage.strokes : [],
      widgets: Array.isArray(curPage.widgets) ? curPage.widgets : []
    };
  } else if (data.state) {
    WB.state = data.state;
    if (typeof WB.syncCurrentPage === 'function') WB.syncCurrentPage();
  }
  if (data.boardTitle) {
    WB.boardTitle = data.boardTitle;
    const titleInput = document.getElementById('boardTitleInput');
    if (titleInput && document.activeElement !== titleInput) titleInput.value = data.boardTitle;
  }
  if (data.permissions && typeof data.permissions === 'object') {
    WB.studentPermissions = { ...(WB.studentPermissions || {}), ...data.permissions };
  }
  WB.renderWidgetsDOM();
  WB.updateSelectionBounds();
  if (typeof WB.renderPagesDropdown === 'function') WB.renderPagesDropdown();
  if (WB.pdfEditor && WB.pdfEditor.isOpen && WB.pdfEditor.targetWidgetId && typeof WB.refreshOpenPdfEditorFromWidget === 'function') {
    const openId = WB.pdfEditor.targetWidgetId;
    let updatedW = (WB.state && Array.isArray(WB.state.widgets)) ? WB.state.widgets.find(w => w && w.id === openId) : null;
    if (!updatedW && Array.isArray(WB.pages)) {
      for (const p of WB.pages) {
        if (Array.isArray(p.widgets)) {
          const found = p.widgets.find(w => w && w.id === openId);
          if (found) { updatedW = found; break; }
        }
      }
    }
    if (updatedW) WB.refreshOpenPdfEditorFromWidget(updatedW);
  }
  WB.syncDiffBaselineFromCurrentState();
  if (typeof WB.scheduleSaveToStorage === 'function') WB.scheduleSaveToStorage(700);
  else WB.saveToStorage();
  WB.collab.isApplyingRemote = false;
};

WB.handleIncomingData = function(data, source = 'ws') {
  if (!data || !data.type || data.senderId === WB.collab.myId) return;
  if (source === 'mqtt') WB.collab.hasMqttPeer = true;
  if (WB.collab.wasKicked) return;
  if (data.senderId && WB.collab.kickedPeerIds && WB.collab.kickedPeerIds.has(data.senderId)) return;

  // Дедупликация при получении одного и того же события по серверному WS и MQTT/BroadcastChannel
  if (data.msgId) {
    if (WB.collab.seenMsgSet.has(data.msgId)) return;
    WB.collab.seenMsgSet.add(data.msgId);
    WB.collab.seenMsgIds.push(data.msgId);
    if (WB.collab.seenMsgIds.length > 320) {
      const old = WB.collab.seenMsgIds.shift();
      WB.collab.seenMsgSet.delete(old);
    }
  }

  if (data.type === 'peer_kicked') {
    if (data.targetId === WB.collab.myId) {
      WB.collab.wasKicked = true;
      WB.stopLiveSession(true);
      WB.showRoomClosedOverlay(
        data.reason || 'Преподаватель удалил вас с доски.',
        'Вы удалены с доски'
      );
      return;
    }
    if (data.targetId && WB.collab.remotePeers[data.targetId]) {
      delete WB.collab.remotePeers[data.targetId];
      WB.updateCollabUI();
    }
    return;
  }

  if (data.type === 'teacher_left' || (data.type === 'room_access_changed' && data.accessOpen === false)) {
    if (WB.userRole === 'student') {
      WB.stopLiveSession(true);
      WB.showRoomClosedOverlay(data.message || 'Преподаватель вышел из доски. Временная ссылка больше не активна.');
    }
    return;
  }

  if (data.type === 'peer_rename') {
    const cleanName = String(data.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!cleanName || !data.targetId) return;
    const senderPeer = WB.collab.remotePeers[data.senderId];
    const isFromTeacher = Boolean(data.byTeacher) && (!senderPeer || senderPeer.role !== 'student');

    if (data.targetId === WB.collab.myId) {
      if (!isFromTeacher) return;
      const changed = WB.collab.myName !== cleanName;
      WB.collab.myName = cleanName;
      try { localStorage.setItem('wb_username', cleanName); } catch (_) {}
      const joinModal = document.getElementById('studentJoinNameModal');
      if (joinModal && joinModal.style.display === 'flex') {
        const joinInput = document.getElementById('studentJoinNameInput');
        if (joinInput) joinInput.value = cleanName;
      }
      WB.renderPeersAvatarBar();
      if (changed && typeof WB.showToast === 'function') {
        WB.showToast(`Преподаватель изменил ваше имя на «${cleanName}»`, 3000, 'info');
      }
      return;
    }

    const canRenameTarget = (data.senderId === data.targetId) || isFromTeacher;
    if (canRenameTarget && WB.collab.remotePeers[data.targetId]) {
      const targetPeer = WB.collab.remotePeers[data.targetId];
      targetPeer.name = cleanName;
      delete targetPeer.initials;
      if (isFromTeacher) {
        targetPeer.forcedName = cleanName;
        targetPeer.forcedNameUntil = performance.now() + 3000;
      }
      WB.renderPeersAvatarBar();
    }
    return;
  }

  if (data.type === 'peer_left') {
    if (data.senderId && WB.collab.remotePeers[data.senderId]) {
      delete WB.collab.remotePeers[data.senderId];
      WB.updateCollabUI();
    }
    return;
  }

  // --- РЕАЛТАЙМ-СОБЫТИЯ ВНУТРИ PDF / DOCX / ФОТО ---
  if (data.type.startsWith('pdf_')) {
    if (typeof WB.handleRemotePdfEvent === 'function') {
      WB.handleRemotePdfEvent(data);
    }
    if (data.type !== 'pdf_stroke_live' && data.type !== 'pdf_laser') {
      WB.syncDiffBaselineFromCurrentState();
    }
    return;
  }

  // --- МГНОВЕННЫЙ СТРИМИНГ ШТРИХОВ НА ГЛАВНОЙ ДОСКЕ ---
  if (data.type === 'stroke_live') {
    const pIdx = typeof data.pageIndex === 'number' ? data.pageIndex : WB.currentPageIndex;
    const isCur = pIdx === WB.currentPageIndex;
    const targetStrokes = isCur
      ? WB.state.strokes
      : (WB.pages && WB.pages[pIdx] ? WB.pages[pIdx].strokes : null);
    if (!Array.isArray(targetStrokes)) return;

    if (data.pointsChunk && data.strokeId) {
      const existing = targetStrokes.find(s => s && s.id === data.strokeId);
      if (existing && Array.isArray(existing.points)) {
        for (let i = 0; i < data.pointsChunk.length; i++) {
          existing.points.push(data.pointsChunk[i]);
        }
      }
    } else if (data.stroke && data.stroke.id) {
      const idx = targetStrokes.findIndex(s => s && s.id === data.stroke.id);
      if (idx >= 0) targetStrokes[idx] = data.stroke;
      else targetStrokes.push(data.stroke);
    }
    return;
  }

  // --- ЛЁГКАЯ ДЕЛЬТА-СИНХРОНИЗАЦИЯ СТРАНИЦЫ ДОСКИ ---
  if (data.type === 'board_delta') {
    WB.collab.hasReceivedInit = true;
    if (WB.collab.helloRetryTimer) {
      clearInterval(WB.collab.helloRetryTimer);
      WB.collab.helloRetryTimer = null;
    }
    WB.collab.isApplyingRemote = true;
    try {
      const pIdx = typeof data.pageIndex === 'number' ? data.pageIndex : WB.currentPageIndex;
      const isCur = pIdx === WB.currentPageIndex;
      let targetObj = isCur ? WB.state : (WB.pages && WB.pages[pIdx] ? WB.pages[pIdx] : null);
      if (!targetObj && Array.isArray(WB.pages) && pIdx >= 0) {
        while (WB.pages.length <= pIdx) {
          WB.pages.push({ id: 'page_' + (WB.pages.length + 1), name: `Страница ${WB.pages.length + 1}`, strokes: [], widgets: [], cam: { x: 0, y: 0, z: 1 } });
        }
        targetObj = WB.pages[pIdx];
      }
      if (targetObj) {
        if (!Array.isArray(targetObj.strokes)) targetObj.strokes = [];
        if (!Array.isArray(targetObj.widgets)) targetObj.widgets = [];

        if (Array.isArray(data.removeStrokeIds) && data.removeStrokeIds.length > 0) {
          const rmSet = new Set(data.removeStrokeIds);
          targetObj.strokes = targetObj.strokes.filter(s => s && !rmSet.has(s.id));
        }
        if (Array.isArray(data.upsertStrokes) && data.upsertStrokes.length > 0) {
          for (let i = 0; i < data.upsertStrokes.length; i++) {
            const st = data.upsertStrokes[i];
            if (!st || !st.id) continue;
            const idx = targetObj.strokes.findIndex(item => item && item.id === st.id);
            if (idx >= 0) targetObj.strokes[idx] = st;
            else targetObj.strokes.push(st);
          }
        }

        let widgetsTouched = false;
        if (Array.isArray(data.removeWidgetIds) && data.removeWidgetIds.length > 0) {
          const rmW = new Set(data.removeWidgetIds);
          targetObj.widgets = targetObj.widgets.filter(w => w && !rmW.has(w.id));
          widgetsTouched = true;
        }
        if (Array.isArray(data.upsertWidgets) && data.upsertWidgets.length > 0) {
          for (let i = 0; i < data.upsertWidgets.length; i++) {
            const w = data.upsertWidgets[i];
            if (!w || !w.id) continue;
            const idx = targetObj.widgets.findIndex(item => item && item.id === w.id);
            if (idx >= 0) targetObj.widgets[idx] = w;
            else targetObj.widgets.push(w);
          }
          widgetsTouched = true;
        }

        if (isCur && WB.pages && WB.pages[pIdx]) {
          WB.pages[pIdx].strokes = targetObj.strokes;
          WB.pages[pIdx].widgets = targetObj.widgets;
        }

        if (data.boardTitle && data.boardTitle !== WB.boardTitle) {
          WB.boardTitle = data.boardTitle;
          const titleInput = document.getElementById('boardTitleInput');
          if (titleInput && document.activeElement !== titleInput) titleInput.value = data.boardTitle;
        }

        if (isCur && widgetsTouched) {
          WB.renderWidgetsDOM();
          WB.updateSelectionBounds();
        }
        if (widgetsTouched && WB.pdfEditor && WB.pdfEditor.isOpen && WB.pdfEditor.targetWidgetId && typeof WB.refreshOpenPdfEditorFromWidget === 'function') {
          const openW = (Array.isArray(data.upsertWidgets) ? data.upsertWidgets : []).find(w => w && w.id === WB.pdfEditor.targetWidgetId);
          if (openW) WB.refreshOpenPdfEditorFromWidget(openW);
        }
      }
      WB.syncDiffBaselineFromCurrentState();
      if (typeof WB.scheduleSaveToStorage === 'function') WB.scheduleSaveToStorage(700);
    } finally {
      WB.collab.isApplyingRemote = false;
    }
    return;
  }

  if (data.type === 'board_page_add' && data.page && data.page.id) {
    WB.collab.isApplyingRemote = true;
    try {
      if (!Array.isArray(WB.pages)) WB.pages = [];
      if (!WB.pages.some(p => p && p.id === data.page.id)) {
        WB.pages.push({
          id: data.page.id,
          name: data.page.name || `Страница ${WB.pages.length + 1}`,
          strokes: Array.isArray(data.page.strokes) ? data.page.strokes : [],
          widgets: Array.isArray(data.page.widgets) ? data.page.widgets : [],
          cam: data.page.cam || { x: 0, y: 0, z: 1 }
        });
        if (typeof WB.renderPagesDropdown === 'function') WB.renderPagesDropdown();
        WB.syncDiffBaselineFromCurrentState();
        if (typeof WB.scheduleSaveToStorage === 'function') WB.scheduleSaveToStorage(700);
      }
    } finally {
      WB.collab.isApplyingRemote = false;
    }
    return;
  }

  if (data.type === 'board_page_delete') {
    WB.collab.isApplyingRemote = true;
    try {
      if (Array.isArray(WB.pages) && WB.pages.length > 1) {
        let idx = -1;
        if (data.pageId) {
          idx = WB.pages.findIndex(p => p && p.id === data.pageId);
        }
        if (idx < 0 && typeof data.index === 'number' && data.index >= 0 && data.index < WB.pages.length) {
          idx = data.index;
        }
        if (idx >= 0) {
          const prevIdx = WB.currentPageIndex;
          WB.pages.splice(idx, 1);
          if (idx < prevIdx) {
            WB.currentPageIndex = Math.max(0, prevIdx - 1);
          } else if (idx === prevIdx) {
            WB.currentPageIndex = Math.max(0, Math.min(idx, WB.pages.length - 1));
            const target = WB.pages[WB.currentPageIndex];
            WB.state = {
              strokes: Array.isArray(target.strokes) ? target.strokes : [],
              widgets: Array.isArray(target.widgets) ? target.widgets : []
            };
            target.strokes = WB.state.strokes;
            target.widgets = WB.state.widgets;
            if (typeof WB.clearSelection === 'function') WB.clearSelection();
            if (typeof WB.renderWidgetsDOM === 'function') WB.renderWidgetsDOM();
          } else {
            WB.currentPageIndex = Math.max(0, Math.min(prevIdx, WB.pages.length - 1));
          }
          if (typeof WB.renderPagesDropdown === 'function') WB.renderPagesDropdown();
          WB.syncDiffBaselineFromCurrentState();
          if (typeof WB.scheduleSaveToStorage === 'function') WB.scheduleSaveToStorage(700);
        }
      }
    } finally {
      WB.collab.isApplyingRemote = false;
    }
    return;
  }

  if (data.type === 'pages_meta') {
    if (Array.isArray(data.pagesMeta) && Array.isArray(WB.pages)) {
      data.pagesMeta.forEach((m, i) => {
        if (WB.pages[i] && m && m.name) WB.pages[i].name = m.name;
      });
      if (typeof WB.renderPagesDropdown === 'function') WB.renderPagesDropdown();
    }
    if (data.boardTitle) {
      WB.boardTitle = data.boardTitle;
      const titleInput = document.getElementById('boardTitleInput');
      if (titleInput && document.activeElement !== titleInput) titleInput.value = data.boardTitle;
    }
    if (typeof WB.scheduleSaveToStorage === 'function') WB.scheduleSaveToStorage(700);
    return;
  }

  if (data.type === 'room_sync_pull' && data.roomId === WB.collab.roomId) {
    WB.loadRoomFromServer(data.roomId);
    return;
  }

  if (data.type === 'peer_view') {
    const prev = WB.collab.remotePeers[data.senderId];
    if (prev) {
      prev.view = data.view || prev.view || null;
      prev.cam = data.cam || prev.cam || null;
      prev.lastSeen = performance.now();
      const dd = document.getElementById('peersDropdown');
      if (dd && dd.classList.contains('open')) WB.renderPeersAvatarBar();
    }
    return;
  }

  if (data.type === 'hello') {
    WB.collab.remotePeers[data.senderId] = {
      name: data.name || (data.role === 'student' ? 'Ученик' : 'Участник'),
      color: data.color || '#2563eb',
      role: data.role || 'student',
      cam: data.cam || null,
      view: data.view || null,
      x: 0, y: 0,
      lastSeen: performance.now()
    };
    WB.updateCollabUI();

    const mySnap = WB.getMyViewportSnapshot();
    WB.broadcastData({
      type: 'ping_peer',
      name: WB.collab.myName,
      color: WB.collab.myColor,
      role: WB.userRole,
      cam: mySnap.cam,
      view: mySnap
    });

    const hasContent = (WB.state.strokes && WB.state.strokes.length > 0) ||
      (WB.state.widgets && WB.state.widgets.length > 0) ||
      (Array.isArray(WB.pages) && WB.pages.length > 1);
    if (WB.userRole !== 'student' || hasContent) {
      if (typeof WB.syncPdfAnnotationsToWidget === 'function' && WB.pdfEditor && WB.pdfEditor.isOpen) {
        WB.syncPdfAnnotationsToWidget();
      }
      if (typeof WB.syncCurrentPage === 'function') WB.syncCurrentPage();
      const initPayload = {
        type: 'init',
        targetId: data.senderId,
        state: WB.state,
        pages: WB.pages,
        currentPageIndex: WB.currentPageIndex,
        boardTitle: WB.boardTitle,
        permissions: WB.studentPermissions || null
      };
      const approxLen = JSON.stringify(initPayload).length;
      if (approxLen > 180000 && /^https?:$/i.test(window.location.protocol)) {
        // Тяжёлая доска с PDF/фото — надёжно сохраняем на сервере и просим ученика забрать через HTTP
        WB.pushRoomSnapshotToServer(false).then((ok) => {
          if (ok) {
            WB.broadcastData({
              type: 'room_sync_pull',
              targetId: data.senderId,
              roomId: WB.collab.roomId
            });
          } else {
            WB.broadcastData(initPayload);
          }
        });
      } else {
        WB.broadcastData(initPayload);
      }
    }
  } else if (data.type === 'ping_peer') {
    const prev = WB.collab.remotePeers[data.senderId] || { x: 0, y: 0 };
    const nowTs = performance.now();
    const keepForced = prev.forcedName && prev.forcedNameUntil && nowTs < prev.forcedNameUntil;
    const resolvedName = keepForced ? prev.forcedName : (data.name || 'Участник');
    WB.collab.remotePeers[data.senderId] = {
      ...prev,
      name: resolvedName,
      color: data.color || '#2563eb',
      role: data.role || 'student',
      cam: data.cam || prev.cam || null,
      view: data.view || prev.view || null,
      lastSeen: nowTs
    };
    WB.updateCollabUI();
  } else if (data.type === 'summon_cam' && (data.view || data.cam)) {
    if (data.targetId && data.targetId !== WB.collab.myId) return;
    const toastMsg = `${data.teacherName || 'Преподаватель'} переместил вас к своей области экрана`;
    if (data.view) {
      WB.applyRemoteViewportSnapshot(data.view, toastMsg);
    } else {
      if (WB.pdfEditor && WB.pdfEditor.isOpen && typeof WB.closePdfEditor === 'function') {
        WB.closePdfEditor();
      }
      if (typeof WB.savePrevCamera === 'function') WB.savePrevCamera();
      WB.cam = {
        x: Number(data.cam.x) || 0,
        y: Number(data.cam.y) || 0,
        z: Number(data.cam.z) || 1
      };
      WB.updateCameraUI();
      if (typeof WB.showToast === 'function') WB.showToast(toastMsg, 3200, 'info');
    }
  } else if (data.type === 'peer_block_status') {
    if (!data.targetId || data.targetId === WB.collab.myId) {
      WB.isStudentBlocked = !!data.blocked;
    }
  } else if (data.type === 'student_permissions' && data.permissions) {
    WB.studentPermissions = { ...(WB.studentPermissions || {}), ...data.permissions };
  } else if (data.type === 'init') {
    if (data.targetId && data.targetId !== WB.collab.myId) return;
    WB.collab.hasReceivedInit = true;
    if (WB.collab.helloRetryTimer) {
      clearInterval(WB.collab.helloRetryTimer);
      WB.collab.helloRetryTimer = null;
    }
    WB.applyRemoteBoardPayload(data);
  } else if (data.type === 'state') {
    WB.collab.hasReceivedInit = true;
    if (WB.collab.helloRetryTimer) {
      clearInterval(WB.collab.helloRetryTimer);
      WB.collab.helloRetryTimer = null;
    }
    WB.applyRemoteBoardPayload(data);
  } else if (data.type === 'cursor') {
    const prev = WB.collab.remotePeers[data.senderId] || {};
    const nowTs = performance.now();
    const keepForced = prev.forcedName && prev.forcedNameUntil && nowTs < prev.forcedNameUntil;
    WB.collab.remotePeers[data.senderId] = {
      ...prev,
      name: keepForced ? prev.forcedName : data.name,
      color: data.color,
      role: data.role,
      x: data.x,
      y: data.y,
      laser: data.laser,
      lastSeen: nowTs
    };
    if (data.laser) {
      WB.laserPoints.push({ x: data.x, y: data.y, time: performance.now() });
    }
  }
};

WB.checkUrlOnStartup = async function() {
  // 0. Автономный файл-приглашение ученика (.html), отправленный в Telegram / VK (работает в РФ без VPN и без хостинга)
  if (window.__WB_EMBEDDED_INVITE__ && window.__WB_EMBEDDED_INVITE__.roomId) {
    const inv = window.__WB_EMBEDDED_INVITE__;
    const invRoomId = WB.sanitizeRoomId(inv.roomId);
    if (invRoomId) {
      WB.userRole = 'student';
      WB.collab.myName = localStorage.getItem('wb_username') || 'Ученик';
      WB.applyRoleUI();
      WB.applyRemoteBoardPayload(inv);
      WB.collab.hasReceivedInit = true;
      WB.connectToRoom(invRoomId);
      const prompted = WB.openStudentJoinNameModal(invRoomId);
      if (!prompted && typeof WB.showToast === 'function') {
        WB.showToast('Вы открыли приглашение преподавателя — доска синхронизируется онлайн', 3600, 'info');
      }
      return;
    }
  }

  WB.fetchServerConfig();

  if (window.location.hash.startsWith('#snap=')) {
    try {
      const encoded = window.location.hash.replace('#snap=', '');
      const json = decodeURIComponent(escape(atob(encoded)));
      WB.state = JSON.parse(json);
      WB.renderWidgetsDOM();
      WB.saveHistory();
      if (/^https?:$/i.test(window.location.protocol)) {
        window.history.replaceState(null, '', window.location.pathname);
      }
    } catch (e) {}
  }

  const params = new URLSearchParams(window.location.search);
  const locInfo = WB.extractRoomInfoFromLocation();
  const roomParam = locInfo.roomId;
  const roleParam = params.get('role');

  if (locInfo.isSharedStudentLink || roleParam === 'student') {
    WB.userRole = 'student';
    WB.collab.myName = localStorage.getItem('wb_username') || 'Ученик';
    WB.applyRoleUI();
  } else {
    WB.applyRoleUI();
  }

  if (roomParam) {
    try { localStorage.setItem('wb_my_room_id', roomParam); } catch (_) {}
    const loaded = await WB.loadRoomFromServer(roomParam);
    if (loaded && loaded.closed) return;
    WB.connectToRoom(roomParam);
    if (WB.userRole === 'student') {
      const prompted = WB.openStudentJoinNameModal(roomParam);
      if (!prompted && typeof WB.showToast === 'function') {
        WB.showToast('Вы подключились к доске преподавателя', 3200, 'info');
      }
    }
    if (WB.userRole === 'student' && /^https?:$/i.test(window.location.protocol)) {
      let missCount = 0;
      if (WB.collab.studentWatchTimer) clearInterval(WB.collab.studentWatchTimer);
      WB.collab.studentWatchTimer = setInterval(async () => {
        if (WB.collab.wasKicked || WB.userRole !== 'student' || WB.collab.mode === 'offline') {
          clearInterval(WB.collab.studentWatchTimer);
          WB.collab.studentWatchTimer = null;
          return;
        }
        try {
          const r = await fetch(`/api/rooms/${encodeURIComponent(roomParam)}?role=student`, { cache: 'no-store' });
          if (r.status === 403) {
            const d = await r.json().catch(() => ({}));
            WB.stopLiveSession(true);
            WB.showRoomClosedOverlay(d.message || 'Преподаватель вышел из доски. Временная ссылка больше не активна.');
            return;
          }
          missCount = 0;
        } catch (_) {
          missCount++;
          if (missCount >= 2) {
            WB.stopLiveSession(true);
            WB.showRoomClosedOverlay('Преподаватель вышел из доски. Временная ссылка больше не активна.');
          }
        }
      }, 10000);
    }
  } else if (WB.boardAccessOpen !== false) {
    const savedRoom = WB.getOrCreatePersistentRoomId(false);
    WB.connectToRoom(savedRoom);
  }
};

window.addEventListener('DOMContentLoaded', () => {
  WB.applyRoleUI();
  WB.syncDiffBaselineFromCurrentState();

  const origSaveHistory = WB.saveHistory;
  WB.saveHistory = function() {
    origSaveHistory();
    if (!WB.collab.roomId || WB.collab.isApplyingRemote || WB.collab.wasKicked) return;
    if (typeof WB.syncCurrentPage === 'function') WB.syncCurrentPage();

    // Сбрасываем кэш живого стрима, чтобы следующий штрих пошёл с нуля
    WB.collab.liveStream.id = null;
    WB.collab.liveStream.sentPoints = 0;

    const base = WB.collab.lastSyncedBoard || { pageIndex: WB.currentPageIndex, pageCount: WB.pages.length, strokes: new Map(), widgets: new Map() };
    const curPageIdx = typeof WB.currentPageIndex === 'number' ? WB.currentPageIndex : 0;
    const curPageCount = Array.isArray(WB.pages) ? WB.pages.length : 1;

    // Если добавили/удалили страницу — отправляем полную синхронизацию (или HTTP pull для тяжёлых досок)
    if (curPageCount !== base.pageCount || curPageIdx !== base.pageIndex) {
      WB.syncDiffBaselineFromCurrentState();
      const fullPayload = {
        type: 'state',
        state: WB.state,
        pages: WB.pages,
        currentPageIndex: curPageIdx,
        boardTitle: WB.boardTitle
      };
      if (JSON.stringify(fullPayload).length > 220000 && /^https?:$/i.test(window.location.protocol)) {
        WB.pushRoomSnapshotToServer(true);
      } else {
        WB.broadcastData(fullPayload);
        if (WB.userRole !== 'student') WB.scheduleRoomServerPush(1200);
      }
      return;
    }

    // Иначе шлём микро-дельту ТОЛЬКО изменённых штрихов и виджетов на текущей странице!
    const upsertStrokes = [];
    const removeStrokeIds = [];
    const curStrokeIds = new Set();
    const curStrokes = (WB.state && Array.isArray(WB.state.strokes)) ? WB.state.strokes : [];
    for (let i = 0; i < curStrokes.length; i++) {
      const s = curStrokes[i];
      if (!s || !s.id) continue;
      curStrokeIds.add(s.id);
      const sig = WB.computeStrokeSyncSig(s);
      if (base.strokes.get(s.id) !== sig) {
        upsertStrokes.push(s);
      }
    }
    base.strokes.forEach((_, id) => {
      if (!curStrokeIds.has(id)) removeStrokeIds.push(id);
    });

    const upsertWidgets = [];
    const removeWidgetIds = [];
    const curWidgetIds = new Set();
    const curWidgets = (WB.state && Array.isArray(WB.state.widgets)) ? WB.state.widgets : [];
    for (let i = 0; i < curWidgets.length; i++) {
      const w = curWidgets[i];
      if (!w || !w.id) continue;
      curWidgetIds.add(w.id);
      const sig = WB.computeWidgetSyncSig(w);
      if (base.widgets.get(w.id) !== sig) {
        upsertWidgets.push(w);
      }
    }
    base.widgets.forEach((_, id) => {
      if (!curWidgetIds.has(id)) removeWidgetIds.push(id);
    });

    WB.syncDiffBaselineFromCurrentState();

    if (upsertStrokes.length === 0 && removeStrokeIds.length === 0 && upsertWidgets.length === 0 && removeWidgetIds.length === 0) {
      return;
    }

    const deltaPayload = {
      type: 'board_delta',
      pageIndex: curPageIdx,
      upsertStrokes,
      removeStrokeIds,
      upsertWidgets,
      removeWidgetIds,
      boardTitle: WB.boardTitle
    };

    const deltaLen = JSON.stringify(deltaPayload).length;
    if (deltaLen > 320000 && /^https?:$/i.test(window.location.protocol)) {
      // Очень крупный файл (PDF / фото высокого разрешения) — сохраняем на сервер и оповещаем участников забрать через HTTP
      WB.pushRoomSnapshotToServer(true);
    } else {
      WB.broadcastData(deltaPayload);
      if (WB.userRole !== 'student') WB.scheduleRoomServerPush(1400);
    }
  };

  const origDrawOverlay = WB.drawSelectionOverlay;
  WB.drawSelectionOverlay = function(ctx) {
    origDrawOverlay(ctx);

    if (WB.collab.mode !== 'online') return;
    const now = performance.now();

    for (const id in WB.collab.remotePeers) {
      const p = WB.collab.remotePeers[id];
      if (now - p.lastSeen > 12000 || (p.x === 0 && p.y === 0)) continue;

      ctx.save();
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6 / WB.cam.z, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = `bold ${Math.round(12 / WB.cam.z)}px Segoe UI, sans-serif`;
      const rolePrefix = p.role === 'student' ? '🎓 ' : '👨‍🏫 ';
      const displayName = rolePrefix + p.name;
      const textW = ctx.measureText(displayName).width;
      const padX = 6 / WB.cam.z;
      const bx = p.x + 10 / WB.cam.z;
      const by = p.y + 10 / WB.cam.z;

      ctx.fillStyle = p.color;
      ctx.fillRect(bx, by, textW + padX * 2, 18 / WB.cam.z);

      ctx.fillStyle = '#ffffff';
      ctx.fillText(displayName, bx + padX, by + 13 / WB.cam.z);
      ctx.restore();
    }
  };

  let lastCursorSent = 0;
  window.addEventListener('pointermove', (e) => {
    if (WB.collab.mode !== 'online') return;
    if (WB.pdfEditor && WB.pdfEditor.isOpen) return;
    const now = performance.now();
    if (now - lastCursorSent < 45) return;
    lastCursorSent = now;

    const wPos = WB.toWorld(e.clientX, e.clientY);
    WB.broadcastData({
      type: 'cursor',
      name: WB.collab.myName,
      color: WB.collab.myColor,
      role: WB.userRole,
      x: Math.round(wPos.x),
      y: Math.round(wPos.y),
      laser: WB.currentTool === 'laser' && e.buttons === 1
    });
  });

  // Обновляем текущую область просмотра при окончании панорамирования или зума
  window.addEventListener('pointerup', () => {
    if (WB.collab.mode === 'online') WB.broadcastPeerViewport(false);
  });
  let wheelViewTimer = null;
  window.addEventListener('wheel', () => {
    if (WB.collab.mode !== 'online') return;
    clearTimeout(wheelViewTimer);
    wheelViewTimer = setTimeout(() => WB.broadcastPeerViewport(false), 260);
  }, { passive: true });

  window.addEventListener('online', WB.updateCollabUI);
  window.addEventListener('offline', WB.updateCollabUI);

  // Закрываем временную ссылку, когда преподаватель покидает доску
  const handleTeacherExit = () => {
    if (WB.userRole !== 'student' && WB.collab.roomId) {
      WB.closeTemporaryLink(false);
    }
  };
  window.addEventListener('pagehide', handleTeacherExit);
  window.addEventListener('beforeunload', handleTeacherExit);

  WB.updateCollabUI();
  WB.checkUrlOnStartup();
});


