import 'dotenv/config';
import express from 'express';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  normalizePublicOrigin,
  isLocalOrBrowserOnlyUrl,
  isForeignCloudPreviewHost,
  sanitizeRoomId,
  buildDedicatedRoomUrl,
} from './src/utils/shareLink.ts';
import {
  type TempSessionState,
  TEACHER_HEARTBEAT_TTL_MS,
  TEACHER_RELOAD_GRACE_MS,
  isRoomLiveForStudent,
  shouldUseTemporaryTunnel,
} from './src/utils/tempSession.ts';
import {
  resolveSafeStaticRelPath,
  resolveConfinedFilePath,
  getMimeType,
  isCompressiblePath,
  clientAcceptsGzip,
  getCacheControlForAsset,
  buildWeakEtag,
  etagMatches,
  decideWsBackpressure,
} from './src/utils/httpStatic.ts';
import { tempTunnelManager } from './src/utils/tempTunnel.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
let activePort = PORT;
const IS_PROD = process.env.NODE_ENV === 'production';
const ROOMS_FILE = path.join(os.tmpdir(), 'whiteboard-pro-rooms.json');
const MAX_ROOMS = 100;

function openLocalBrowser(url: string): void {
  try {
    if (process.platform === 'win32') {
      execFile('cmd.exe', ['/c', 'start', '', url], { windowsHide: true }, () => {});
    } else if (process.platform === 'darwin') {
      execFile('open', [url], () => {});
    } else {
      execFile('xdg-open', [url], () => {});
    }
  } catch {
    // Non-fatal if OS browser launcher is unavailable
  }
}

interface RoomPermissions {
  deleteStrokes: boolean;
  deleteObjects: boolean;
  editMaterials: boolean;
}

interface RoomRecord {
  roomId: string;
  boardTitle: string;
  state: { strokes: unknown[]; widgets: unknown[] };
  pages: unknown[];
  currentPageIndex: number;
  permissions: RoomPermissions;
  accessOpen: boolean;
  createdAt: number;
  updatedAt: number;
}

interface ConnectedPeer {
  ws: WebSocket;
  roomId: string;
  senderId: string;
  name: string;
  color: string;
  role: string;
  cam: { x: number; y: number; z: number } | null;
  view: unknown;
  blocked: boolean;
  isAlive: boolean;
}

const rooms = new Map<string, RoomRecord>();
const roomSockets = new Map<string, Set<ConnectedPeer>>();
const tempSessions = new Map<string, TempSessionState>();
const pendingCloseTimers = new Map<string, ReturnType<typeof setTimeout>>();

const TEACHER_LEFT_MSG = 'Преподаватель вышел из доски. Временная ссылка больше не активна.';

function getOrCreateTempSession(roomId: string, accessOpen = true): TempSessionState {
  let s = tempSessions.get(roomId);
  if (!s) {
    s = {
      roomId,
      accessOpen,
      teacherSocketCount: 0,
      teacherLastSeenAt: Date.now(),
      closingSinceAt: null,
    };
    tempSessions.set(roomId, s);
  }
  return s;
}

function cancelPendingClose(roomId: string): void {
  const t = pendingCloseTimers.get(roomId);
  if (t) {
    clearTimeout(t);
    pendingCloseTimers.delete(roomId);
  }
}

function markTeacherActive(roomId: string, openAccess = true): TempSessionState {
  cancelPendingClose(roomId);
  const s = getOrCreateTempSession(roomId, openAccess);
  s.teacherLastSeenAt = Date.now();
  s.closingSinceAt = null;
  if (openAccess) s.accessOpen = true;
  return s;
}

function hasAnyActiveTeacher(now = Date.now()): boolean {
  for (const s of tempSessions.values()) {
    if (isRoomLiveForStudent(s, now)) return true;
  }
  return false;
}

function finalizeTeacherDeparture(roomId: string, message = TEACHER_LEFT_MSG): void {
  cancelPendingClose(roomId);
  const s = tempSessions.get(roomId);
  if (s) {
    s.accessOpen = false;
    s.closingSinceAt = null;
    s.teacherLastSeenAt = 0;
  }
  const rec = rooms.get(roomId);
  if (rec) {
    rec.accessOpen = false;
    scheduleSaveRooms();
  }
  broadcastToRoom(roomId, {
    type: 'teacher_left',
    senderId: 'server',
    message,
  });
  const set = roomSockets.get(roomId);
  if (set) {
    for (const peer of Array.from(set)) {
      if (peer.role === 'student') {
        try {
          peer.ws.close(1008, 'Teacher left');
        } catch {
          // ignore
        }
      }
    }
  }
  if (!hasAnyActiveTeacher()) {
    tempTunnelManager.closeTunnel();
  }
}

function scheduleTeacherGraceClose(roomId: string): void {
  const s = tempSessions.get(roomId);
  if (!s || s.teacherSocketCount > 0) return;
  s.closingSinceAt = Date.now();
  cancelPendingClose(roomId);
  const timer = setTimeout(() => {
    pendingCloseTimers.delete(roomId);
    const current = tempSessions.get(roomId);
    if (!current) return;
    if (current.teacherSocketCount > 0) return;
    if (current.closingSinceAt !== null && Date.now() - current.closingSinceAt >= TEACHER_RELOAD_GRACE_MS - 100) {
      finalizeTeacherDeparture(roomId, TEACHER_LEFT_MSG);
    }
  }, TEACHER_RELOAD_GRACE_MS + 100);
  pendingCloseTimers.set(roomId, timer);
}

// Watchdog: expire stale rooms when teacher closed laptop/browser without sendBeacon
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [roomId, s] of tempSessions.entries()) {
    if (s.accessOpen && s.teacherSocketCount === 0 && !isRoomLiveForStudent(s, now, TEACHER_HEARTBEAT_TTL_MS)) {
      finalizeTeacherDeparture(roomId, TEACHER_LEFT_MSG);
      changed = true;
    }
  }
  if (changed && !hasAnyActiveTeacher(now)) {
    tempTunnelManager.closeTunnel();
  }
}, 10_000).unref();

process.on('uncaughtException', (err) => {
  console.error('[Whiteboard Pro] Uncaught exception (recovered):', err?.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Whiteboard Pro] Unhandled rejection (recovered):', reason);
});
process.on('SIGINT', () => {
  tempTunnelManager.closeTunnel();
  process.exit(0);
});
process.on('SIGTERM', () => {
  tempTunnelManager.closeTunnel();
  process.exit(0);
});

function loadRoomsFromDisk(): void {
  try {
    if (!fs.existsSync(ROOMS_FILE)) return;
    const raw = fs.readFileSync(ROOMS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item.roomId === 'string') {
          const id = sanitizeRoomId(item.roomId);
          if (id) rooms.set(id, { ...item, roomId: id });
        }
      }
    }
  } catch {
    // Ignore corrupt or missing temp store
  }
}

let saveDiskTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSaveRooms(): void {
  if (saveDiskTimer) clearTimeout(saveDiskTimer);
  saveDiskTimer = setTimeout(() => {
    try {
      // Prune oldest rooms if exceeding cap
      if (rooms.size > MAX_ROOMS) {
        const sorted = Array.from(rooms.values()).sort((a, b) => b.updatedAt - a.updatedAt);
        rooms.clear();
        for (const r of sorted.slice(0, MAX_ROOMS)) {
          rooms.set(r.roomId, r);
        }
      }
      fs.writeFileSync(ROOMS_FILE, JSON.stringify(Array.from(rooms.values())), 'utf8');
    } catch {
      // Non-fatal in ephemeral containers
    }
  }, 400);
}

loadRoomsFromDisk();

function generateRoomId(): string {
  return 'wb-' + crypto.randomBytes(4).toString('hex');
}

function resolveRequestPublicOrigin(req: express.Request): {
  publicBaseUrl: string;
  isPublicInternet: boolean;
  isAiStudioPreview: boolean;
} {
  // Explicit user-configured public domain/tunnel takes precedence (e.g. PUBLIC_APP_URL=https://my-board.cloudpub.ru)
  const explicitEnvUrl = process.env.PUBLIC_APP_URL || '';
  const explicitNorm = normalizePublicOrigin(explicitEnvUrl);

  const protoHeader = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const hostHeader = String(req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`).split(',')[0].trim();
  const reqRaw = `${protoHeader}://${hostHeader}`;
  const reqNorm = normalizePublicOrigin(reqRaw);

  const isAiStudioPreview = isForeignCloudPreviewHost(reqRaw);

  if (explicitNorm && !isLocalOrBrowserOnlyUrl(explicitNorm)) {
    return {
      publicBaseUrl: explicitNorm,
      isPublicInternet: true,
      isAiStudioPreview: isForeignCloudPreviewHost(explicitNorm),
    };
  }
  if (reqNorm && !isLocalOrBrowserOnlyUrl(reqNorm)) {
    return { publicBaseUrl: reqNorm, isPublicInternet: true, isAiStudioPreview };
  }
  return {
    publicBaseUrl: reqNorm || `http://localhost:${PORT}`,
    isPublicInternet: false,
    isAiStudioPreview: false,
  };
}

function escapeInlineScript(code: string): string {
  return code.replace(/<\/script/gi, '<\\/script');
}

function buildStandaloneStudentInviteHtml(record: RoomRecord): string {
  const rootDir = IS_PROD && fs.existsSync(path.join(__dirname, 'dist', 'index.html'))
    ? path.join(__dirname, 'dist')
    : __dirname;

  const htmlPath = path.join(rootDir, 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');

  // Remove external render-blocking Google Fonts links so the file opens instantaneously in RF without VPN
  html = html.replace(/<link[^>]+fonts\.googleapis\.com[^>]*>\s*/gi, '');
  html = html.replace(/<link[^>]+fonts\.gstatic\.com[^>]*>\s*/gi, '');

  // Inline local stylesheets
  html = html.replace(
    /<link\s+rel="stylesheet"\s+href="(?:\.?\/)?(css\/[^"?#]+)(?:\?[^"]*)?"\s*\/?>/gi,
    (_match, relPath: string) => {
      const fullPath = path.join(rootDir, relPath);
      const fallbackPath = path.join(__dirname, relPath);
      const target = fs.existsSync(fullPath) ? fullPath : fallbackPath;
      if (!fs.existsSync(target)) return '';
      const css = fs.readFileSync(target, 'utf8');
      return `<style data-inlined="${relPath}">\n${css}\n</style>`;
    }
  );

  // Build embedded student payload so the student enters the teacher's exact room immediately without VPN or hosting
  const invitePayload = {
    roomId: record.roomId,
    role: 'student',
    boardTitle: record.boardTitle || 'Новый урок',
    state: record.state || { strokes: [], widgets: [] },
    pages: Array.isArray(record.pages) ? record.pages : [],
    currentPageIndex: typeof record.currentPageIndex === 'number' ? record.currentPageIndex : 0,
    permissions: record.permissions || { deleteStrokes: false, deleteObjects: false, editMaterials: true },
    generatedAt: Date.now(),
  };
  const safeJson = JSON.stringify(invitePayload).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  const bootstrapTag = `<script>window.__WB_EMBEDDED_INVITE__ = ${safeJson};</script>\n`;

  let bootstrapInjected = false;
  // Inline all local JS core modules
  html = html.replace(
    /<script\s+src="(?:\.?\/)?(js\/[^"?#]+)(?:\?[^"]*)?"\s*><\/script>/gi,
    (_match, relPath: string) => {
      const fullPath = path.join(rootDir, relPath);
      const fallbackPath = path.join(__dirname, relPath);
      const target = fs.existsSync(fullPath) ? fullPath : fallbackPath;
      if (!fs.existsSync(target)) return '';
      const js = escapeInlineScript(fs.readFileSync(target, 'utf8'));
      const prefix = bootstrapInjected ? '' : ((bootstrapInjected = true), bootstrapTag);
      return `${prefix}<script data-inlined="${relPath}">\n${js}\n</script>`;
    }
  );

  return html;
}

function getOrCreateRoomRecord(roomId: string, patch?: Partial<RoomRecord>): RoomRecord {
  const now = Date.now();
  const existing = rooms.get(roomId);
  if (existing) {
    if (patch) {
      if (typeof patch.boardTitle === 'string') existing.boardTitle = patch.boardTitle.slice(0, 120);
      if (patch.state && typeof patch.state === 'object') existing.state = patch.state;
      if (Array.isArray(patch.pages)) existing.pages = patch.pages;
      if (typeof patch.currentPageIndex === 'number') existing.currentPageIndex = patch.currentPageIndex;
      if (patch.permissions && typeof patch.permissions === 'object') {
        existing.permissions = { ...existing.permissions, ...patch.permissions };
      }
      if (typeof patch.accessOpen === 'boolean') existing.accessOpen = patch.accessOpen;
      existing.updatedAt = now;
      scheduleSaveRooms();
    }
    return existing;
  }

  const record: RoomRecord = {
    roomId,
    boardTitle: typeof patch?.boardTitle === 'string' ? patch.boardTitle.slice(0, 120) : 'Новый урок',
    state: patch?.state && typeof patch.state === 'object' ? patch.state : { strokes: [], widgets: [] },
    pages: Array.isArray(patch?.pages) ? patch.pages : [],
    currentPageIndex: typeof patch?.currentPageIndex === 'number' ? patch.currentPageIndex : 0,
    permissions: {
      deleteStrokes: false,
      deleteObjects: false,
      editMaterials: true,
      ...(patch?.permissions || {}),
    },
    accessOpen: typeof patch?.accessOpen === 'boolean' ? patch.accessOpen : true,
    createdAt: now,
    updatedAt: now,
  };
  rooms.set(roomId, record);
  scheduleSaveRooms();
  return record;
}

function safeSendWs(peer: ConnectedPeer, serialized: string, messageType = ''): void {
  if (peer.ws.readyState !== WebSocket.OPEN) return;
  const action = decideWsBackpressure(peer.ws.bufferedAmount, messageType);
  if (action === 'terminate') {
    try {
      peer.ws.terminate();
    } catch {
      // ignore
    }
    return;
  }
  if (action === 'skip') return;
  try {
    peer.ws.send(serialized, (err) => {
      if (err) {
        try {
          peer.ws.terminate();
        } catch {
          // ignore
        }
      }
    });
  } catch {
    try {
      peer.ws.terminate();
    } catch {
      // ignore
    }
  }
}

function broadcastToRoom(roomId: string, payload: Record<string, unknown>, excludePeer?: ConnectedPeer): void {
  const set = roomSockets.get(roomId);
  if (!set || set.size === 0) return;
  const serialized = JSON.stringify(payload);
  const msgType = typeof payload.type === 'string' ? payload.type : '';
  for (const peer of Array.from(set)) {
    if (peer === excludePeer) continue;
    safeSendWs(peer, serialized, msgType);
  }
}

async function startServer(): Promise<void> {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '25mb' }));
  app.use(express.text({ type: 'text/plain', limit: '64kb' }));

  // Allow cross-origin requests from locally installed PC builds (file:/// or localhost) to publish & sync rooms
  app.use('/api', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // --- API: Public server configuration ---
  app.get('/api/config', (req, res) => {
    const info = resolveRequestPublicOrigin(req);
    const tunnel = tempTunnelManager.getStatus();
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ...info,
      supportsWs: true,
      tempTunnelActive: tunnel.active,
      tempTunnelUrl: tunnel.url,
    });
  });

  // --- API: Create / get temporary public HTTPS link (alive only while teacher is in the board) ---
  app.post('/api/temp-link', async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const forceNew = Boolean(body.forceNew);
    const requestedId = forceNew ? '' : sanitizeRoomId(body.roomId);
    const roomId = requestedId || generateRoomId();

    const record = getOrCreateRoomRecord(roomId, {
      boardTitle: body.boardTitle,
      state: body.state,
      pages: body.pages,
      currentPageIndex: body.currentPageIndex,
      permissions: body.permissions,
      accessOpen: true,
    });
    markTeacherActive(roomId, true);

    const reqInfo = resolveRequestPublicOrigin(req);
    const explicitUrl = normalizePublicOrigin(process.env.PUBLIC_APP_URL || '');
    const needsTunnel = shouldUseTemporaryTunnel(
      reqInfo.publicBaseUrl,
      explicitUrl,
      isLocalOrBrowserOnlyUrl,
      isForeignCloudPreviewHost
    );

    let baseUrl = reqInfo.publicBaseUrl;
    let provider = 'direct';
    let isTunnel = false;

    if (needsTunnel) {
      try {
        const tunnelInfo = await tempTunnelManager.ensureTunnel(activePort, false);
        baseUrl = tunnelInfo.url;
        provider = tunnelInfo.provider;
        isTunnel = true;
      } catch (err) {
        res.status(503).json({
          ok: false,
          error: 'tunnel_unavailable',
          message: 'Не удалось создать временную ссылку. Проверьте подключение к интернету и повторите попытку.',
          detail: err instanceof Error ? err.message : 'unknown',
        });
        return;
      }
    }

    const inviteUrl = buildDedicatedRoomUrl(baseUrl, record.roomId, 'student');
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      roomId: record.roomId,
      url: inviteUrl,
      baseUrl,
      provider,
      isTunnel,
      accessOpen: true,
      expiresWhenTeacherLeaves: true,
    });
  });

  // --- API: Keep temporary link alive while teacher remains on the board ---
  app.post('/api/temp-link/heartbeat', async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const roomId = sanitizeRoomId(body.roomId);
    if (!roomId) {
      res.status(400).json({ ok: false, error: 'invalid_room_id' });
      return;
    }
    const existing = tempSessions.get(roomId);
    if (existing && !existing.accessOpen) {
      res.json({ ok: true, active: false });
      return;
    }
    markTeacherActive(roomId, true);

    const reqInfo = resolveRequestPublicOrigin(req);
    const explicitUrl = normalizePublicOrigin(process.env.PUBLIC_APP_URL || '');
    const needsTunnel = shouldUseTemporaryTunnel(
      reqInfo.publicBaseUrl,
      explicitUrl,
      isLocalOrBrowserOnlyUrl,
      isForeignCloudPreviewHost
    );

    let baseUrl = reqInfo.publicBaseUrl;
    if (needsTunnel) {
      const status = tempTunnelManager.getStatus();
      if (status.active && status.url) {
        baseUrl = status.url;
      } else {
        try {
          const fresh = await tempTunnelManager.ensureTunnel(activePort, false);
          baseUrl = fresh.url;
        } catch {
          // Keep session alive, client will retry on next heartbeat
          baseUrl = '';
        }
      }
    }

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      active: true,
      roomId,
      url: baseUrl ? buildDedicatedRoomUrl(baseUrl, roomId, 'student') : '',
    });
  });

  // --- API: Close temporary link immediately (toggle off) or after brief reload grace (tab close) ---
  app.post('/api/temp-link/close', (req, res) => {
    let body: Record<string, unknown> = {};
    if (typeof req.body === 'string') {
      try {
        body = JSON.parse(req.body);
      } catch {
        body = {};
      }
    } else if (req.body && typeof req.body === 'object') {
      body = req.body as Record<string, unknown>;
    }
    const roomId = sanitizeRoomId(typeof body.roomId === 'string' ? body.roomId : '');
    const immediate = Boolean(body.immediate);
    if (roomId) {
      if (immediate) {
        finalizeTeacherDeparture(roomId, 'Преподаватель закрыл доступ к доске.');
      } else {
        scheduleTeacherGraceClose(roomId);
      }
    }
    res.status(200).json({ ok: true });
  });

  // --- API: Create / publish a dedicated room page ---
  app.post('/api/rooms', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const requestedId = sanitizeRoomId(body.roomId);
    const roomId = requestedId || generateRoomId();

    const record = getOrCreateRoomRecord(roomId, {
      boardTitle: body.boardTitle,
      state: body.state,
      pages: body.pages,
      currentPageIndex: body.currentPageIndex,
      permissions: body.permissions,
      accessOpen: typeof body.accessOpen === 'boolean' ? body.accessOpen : true,
    });

    const { publicBaseUrl, isPublicInternet, isAiStudioPreview } = resolveRequestPublicOrigin(req);
    const inviteUrl = buildDedicatedRoomUrl(publicBaseUrl, roomId, 'student');
    const teacherUrl = buildDedicatedRoomUrl(publicBaseUrl, roomId, 'teacher');

    res.json({
      ok: true,
      roomId: record.roomId,
      roomPath: `/shared/${encodeURIComponent(record.roomId)}`,
      inviteUrl,
      teacherUrl,
      publicBaseUrl,
      isPublicInternet,
      isAiStudioPreview,
      accessOpen: record.accessOpen,
      updatedAt: record.updatedAt,
    });
  });

  // --- API: Load dedicated room snapshot ---
  app.get('/api/rooms/:roomId', (req, res) => {
    const roomId = sanitizeRoomId(req.params.roomId);
    if (!roomId) {
      res.status(400).json({ ok: false, error: 'invalid_room_id' });
      return;
    }

    const record = rooms.get(roomId);
    if (!record) {
      res.status(404).json({ ok: false, error: 'not_found' });
      return;
    }

    const role = String(req.query.role || '');
    if (role === 'student') {
      const session = tempSessions.get(roomId);
      if (!record.accessOpen) {
        res.status(403).json({
          ok: false,
          error: 'room_closed',
          message: 'Преподаватель закрыл доступ к доске.',
        });
        return;
      }
      if (session && !isRoomLiveForStudent(session, Date.now())) {
        res.status(403).json({
          ok: false,
          error: 'teacher_offline',
          message: TEACHER_LEFT_MSG,
        });
        return;
      }
    }

    const peersCount = roomSockets.get(roomId)?.size || 0;
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      room: record,
      peersCount,
    });
  });

  // --- API: Update room state / access / permissions ---
  app.put('/api/rooms/:roomId', (req, res) => {
    const roomId = sanitizeRoomId(req.params.roomId);
    if (!roomId) {
      res.status(400).json({ ok: false, error: 'invalid_room_id' });
      return;
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const prevAccess = rooms.get(roomId)?.accessOpen;
    const record = getOrCreateRoomRecord(roomId, {
      boardTitle: body.boardTitle,
      state: body.state,
      pages: body.pages,
      currentPageIndex: body.currentPageIndex,
      permissions: body.permissions,
      accessOpen: typeof body.accessOpen === 'boolean' ? body.accessOpen : undefined,
    });

    if (typeof body.accessOpen === 'boolean' && prevAccess !== body.accessOpen) {
      broadcastToRoom(roomId, {
        type: 'room_access_changed',
        senderId: 'server',
        accessOpen: record.accessOpen,
      });
    }

    res.json({
      ok: true,
      roomId: record.roomId,
      accessOpen: record.accessOpen,
      updatedAt: record.updatedAt,
    });
  });

  // --- API: Generate autonomous single-file HTML invite for students (works in Russia without VPN or hosting) ---
  app.post('/api/student-invite', (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const roomId = sanitizeRoomId(body.roomId) || generateRoomId();
      const record = getOrCreateRoomRecord(roomId, {
        boardTitle: body.boardTitle,
        state: body.state,
        pages: body.pages,
        currentPageIndex: body.currentPageIndex,
        permissions: body.permissions,
        accessOpen: true,
      });
      const html = buildStandaloneStudentInviteHtml(record);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="whiteboard-student-${roomId}.html"`);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).send(html);
    } catch {
      res.status(500).json({ ok: false, error: 'invite_build_failed' });
    }
  });

  app.get('/api/student-invite/:roomId', (req, res) => {
    try {
      const roomId = sanitizeRoomId(req.params.roomId);
      if (!roomId) {
        res.status(400).json({ ok: false, error: 'invalid_room_id' });
        return;
      }
      const record = getOrCreateRoomRecord(roomId);
      const html = buildStandaloneStudentInviteHtml(record);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="whiteboard-student-${roomId}.html"`);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).send(html);
    } catch {
      res.status(500).json({ ok: false, error: 'invite_build_failed' });
    }
  });

  const server = http.createServer(app);

  // --- WebSocket real-time collaboration server on /ws ---
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 25 * 1024 * 1024,
  });

  wss.on('error', (err) => {
    console.error('[Whiteboard Pro] WebSocketServer error:', err.message);
  });

  // Periodic WS Ping/Pong heartbeat to evict dead/sleeping tablet sockets cleanly
  const WS_PING_INTERVAL_MS = 25_000;
  setInterval(() => {
    for (const peers of roomSockets.values()) {
      for (const peer of Array.from(peers)) {
        if (peer.ws.readyState !== WebSocket.OPEN) continue;
        if (!peer.isAlive) {
          try {
            peer.ws.terminate();
          } catch {
            // ignore
          }
          continue;
        }
        peer.isAlive = false;
        try {
          peer.ws.ping();
        } catch {
          try {
            peer.ws.terminate();
          } catch {
            // ignore
          }
        }
      }
    }
  }, WS_PING_INTERVAL_MS).unref();

  server.on('upgrade', (request, socket, head) => {
    socket.on('error', () => {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
    });
    let pathname = '';
    try {
      const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      pathname = url.pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws, request) => {
    ws.on('error', (err) => {
      console.warn('[Whiteboard Pro] Client WS error:', err.message);
      try {
        ws.terminate();
      } catch {
        // ignore
      }
    });

    let roomId = '';
    let role = 'teacher';
    try {
      const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      roomId = sanitizeRoomId(url.searchParams.get('room'));
      role = url.searchParams.get('role') === 'student' ? 'student' : 'teacher';
    } catch {
      roomId = '';
    }

    if (!roomId) {
      ws.close(1008, 'Missing room id');
      return;
    }

    const existingRoom = rooms.get(roomId);
    const existingSession = tempSessions.get(roomId);
    if (role === 'student') {
      if (existingRoom && !existingRoom.accessOpen) {
        try {
          ws.send(JSON.stringify({ type: 'teacher_left', senderId: 'server', message: 'Преподаватель закрыл доступ к доске.' }));
        } catch {
          // ignore
        }
        ws.close(1008, 'Room closed');
        return;
      }
      if (existingSession && !isRoomLiveForStudent(existingSession, Date.now())) {
        try {
          ws.send(JSON.stringify({ type: 'teacher_left', senderId: 'server', message: TEACHER_LEFT_MSG }));
        } catch {
          // ignore
        }
        ws.close(1008, 'Teacher offline');
        return;
      }
    }

    const peer: ConnectedPeer = {
      ws,
      roomId,
      senderId: 'srv_' + crypto.randomBytes(4).toString('hex'),
      name: role === 'student' ? 'Ученик' : 'Преподаватель',
      color: '#2563eb',
      role,
      cam: null,
      view: null,
      blocked: false,
      isAlive: true,
    };

    ws.on('pong', () => {
      peer.isAlive = true;
    });

    if (!roomSockets.has(roomId)) roomSockets.set(roomId, new Set());
    roomSockets.get(roomId)!.add(peer);

    if (role === 'teacher') {
      const s = markTeacherActive(roomId, existingRoom ? existingRoom.accessOpen : true);
      s.teacherSocketCount += 1;
    }

    ws.on('message', (rawBuf) => {
      peer.isAlive = true;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(rawBuf.toString('utf8'));
      } catch {
        return;
      }
      if (!data || typeof data.type !== 'string') return;

      if (typeof data.senderId === 'string' && data.senderId) {
        peer.senderId = data.senderId;
      }

      if (data.type === 'hello' || data.type === 'ping_peer') {
        if (typeof data.name === 'string') peer.name = data.name;
        if (typeof data.color === 'string') peer.color = data.color;
        if (typeof data.role === 'string') peer.role = data.role;
        if (data.cam && typeof data.cam === 'object') {
          peer.cam = data.cam as { x: number; y: number; z: number };
        }
        if (data.view && typeof data.view === 'object') {
          peer.view = data.view;
        }

        if (data.type === 'hello') {
          // Send authoritative room state if already stored on server
          const record = rooms.get(roomId);
          const hasStoredContent =
            record &&
            ((Array.isArray(record.state?.strokes) && record.state.strokes.length > 0) ||
              (Array.isArray(record.state?.widgets) && record.state.widgets.length > 0) ||
              (Array.isArray(record.pages) && record.pages.length > 1) ||
              (record.boardTitle && record.boardTitle !== 'Новый урок'));
          if (hasStoredContent && record) {
            try {
              ws.send(
                JSON.stringify({
                  type: 'init',
                  senderId: 'server',
                  targetId: peer.senderId,
                  state: record.state,
                  pages: record.pages,
                  currentPageIndex: record.currentPageIndex,
                  boardTitle: record.boardTitle,
                  permissions: record.permissions,
                })
              );
            } catch {
              // ignore
            }
          }

          // Inform joining peer about existing peers in this room
          const peersInRoom = roomSockets.get(roomId);
          if (peersInRoom) {
            for (const other of peersInRoom) {
              if (other === peer) continue;
              try {
                ws.send(
                  JSON.stringify({
                    type: 'ping_peer',
                    senderId: other.senderId,
                    name: other.name,
                    color: other.color,
                    role: other.role,
                    cam: other.cam,
                    view: other.view,
                    blocked: other.blocked,
                  })
                );
              } catch {
                // ignore
              }
            }
          }
        }

        broadcastToRoom(roomId, data, peer);
        return;
      }

      if (data.type === 'peer_view') {
        if (data.view && typeof data.view === 'object') peer.view = data.view;
        if (data.cam && typeof data.cam === 'object') {
          peer.cam = data.cam as { x: number; y: number; z: number };
        }
        broadcastToRoom(roomId, data, peer);
        return;
      }

      if (data.type === 'peer_rename' && typeof data.targetId === 'string' && typeof data.name === 'string') {
        const cleanName = data.name.replace(/\s+/g, ' ').trim().slice(0, 40);
        if (!cleanName) return;
        const isSelf = data.targetId === peer.senderId;
        const isTeacher = peer.role !== 'student';
        if (!isSelf && !isTeacher) return;

        const peersInRoom = roomSockets.get(roomId);
        if (peersInRoom) {
          for (const p of peersInRoom) {
            if (p.senderId === data.targetId) {
              p.name = cleanName;
            }
          }
        }
        broadcastToRoom(
          roomId,
          {
            ...data,
            name: cleanName,
            byTeacher: isTeacher,
          },
          peer
        );
        return;
      }

      if (data.type === 'peer_kicked' && typeof data.targetId === 'string') {
        broadcastToRoom(roomId, data, peer);
        const peersInRoom = roomSockets.get(roomId);
        if (peersInRoom) {
          for (const p of Array.from(peersInRoom)) {
            if (p.senderId === data.targetId) {
              setTimeout(() => {
                try {
                  p.ws.close(1008, 'Kicked by teacher');
                } catch {
                  // ignore
                }
              }, 80);
            }
          }
        }
        return;
      }

      if (data.type === 'state') {
        if (peer.blocked) return;
        getOrCreateRoomRecord(roomId, {
          state: data.state as { strokes: unknown[]; widgets: unknown[] },
          pages: Array.isArray(data.pages) ? data.pages : undefined,
          currentPageIndex: typeof data.currentPageIndex === 'number' ? data.currentPageIndex : undefined,
          boardTitle: typeof data.boardTitle === 'string' ? data.boardTitle : undefined,
        });
        broadcastToRoom(roomId, data, peer);
        return;
      }

      if (data.type === 'student_permissions' && data.permissions && typeof data.permissions === 'object') {
        getOrCreateRoomRecord(roomId, {
          permissions: data.permissions as RoomPermissions,
        });
        broadcastToRoom(roomId, data, peer);
        return;
      }

      if (data.type === 'peer_block_status' && typeof data.targetId === 'string') {
        const peersInRoom = roomSockets.get(roomId);
        if (peersInRoom) {
          for (const p of peersInRoom) {
            if (p.senderId === data.targetId) {
              p.blocked = Boolean(data.blocked);
            }
          }
        }
        broadcastToRoom(roomId, data, peer);
        return;
      }

      // Forward init, cursor, stroke_live, board_delta, pdf_*, summon_cam, etc.
      broadcastToRoom(roomId, data, peer);
    });

    ws.on('close', () => {
      const set = roomSockets.get(roomId);
      if (set) {
        set.delete(peer);
        if (set.size === 0) {
          roomSockets.delete(roomId);
        } else {
          broadcastToRoom(roomId, {
            type: 'peer_left',
            senderId: peer.senderId,
          });
        }
      }
      if (peer.role === 'teacher') {
        const s = tempSessions.get(roomId);
        if (s) {
          s.teacherSocketCount = Math.max(0, s.teacherSocketCount - 1);
          if (s.teacherSocketCount === 0 && s.accessOpen) {
            scheduleTeacherGraceClose(roomId);
          }
        }
      }
    });
  });

  const injectHttpBaseTag = (html: string): string => {
    if (/<base\s/i.test(html)) return html;
    return html.replace(/<head([^>]*)>/i, '<head$1>\n  <base href="/">');
  };

  // --- Direct static serving with gzip compression, ETag & Cache-Control (NO Vite / HMR client) ---
  interface CachedAsset {
    mtimeMs: number;
    size: number;
    etag: string;
    mime: string;
    raw: Buffer;
    gzip: Buffer | null;
  }
  const assetCache = new Map<string, CachedAsset>();
  const MAX_ASSET_CACHE = 96;

  const getCachedFile = (filePath: string, transform?: (buf: Buffer) => Buffer): CachedAsset | null => {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
      if (!stat.isFile()) return null;
    } catch {
      return null;
    }

    const cacheKey = `${filePath}:${transform ? 't' : 'r'}`;
    const cached = assetCache.get(cacheKey);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached;
    }

    let raw: Buffer = fs.readFileSync(filePath);
    if (transform) raw = transform(raw);

    const mime = getMimeType(filePath);
    const etag = buildWeakEtag(raw.length, stat.mtimeMs);
    const gzip = isCompressiblePath(filePath) && raw.length >= 256
      ? zlib.gzipSync(raw, { level: 6 })
      : null;

    const entry: CachedAsset = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      etag,
      mime,
      raw,
      gzip,
    };

    if (assetCache.size >= MAX_ASSET_CACHE) {
      const firstKey = assetCache.keys().next().value;
      if (firstKey) assetCache.delete(firstKey);
    }
    assetCache.set(cacheKey, entry);
    return entry;
  };

  const sendCachedAsset = (
    req: express.Request,
    res: express.Response,
    asset: CachedAsset,
    cacheControl: string
  ): void => {
    res.setHeader('Content-Type', asset.mime);
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('ETag', asset.etag);
    if (asset.gzip) {
      res.setHeader('Vary', 'Accept-Encoding');
    }

    if (etagMatches(req.headers['if-none-match'], asset.etag)) {
      res.status(304).end();
      return;
    }

    if (asset.gzip && clientAcceptsGzip(req.headers['accept-encoding'])) {
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Length', String(asset.gzip.length));
      res.status(200).end(asset.gzip);
      return;
    }

    res.setHeader('Content-Length', String(asset.raw.length));
    res.status(200).end(asset.raw);
  };

  const staticRoots: string[] = [];
  const distDir = path.resolve(__dirname, 'dist');
  if (IS_PROD && fs.existsSync(path.join(distDir, 'index.html'))) {
    staticRoots.push(distDir);
  }
  staticRoots.push(__dirname);

  // Serve index.html directly (no Vite HMR client injection) for `/`, `/shared/:roomId`, and `/room/:roomId`
  app.get(['/', '/shared/:roomId', '/room/:roomId'], (req, res) => {
    const htmlPath = IS_PROD && fs.existsSync(path.join(distDir, 'index.html'))
      ? path.join(distDir, 'index.html')
      : path.join(__dirname, 'index.html');

    const asset = getCachedFile(htmlPath, (buf) =>
      Buffer.from(injectHttpBaseTag(buf.toString('utf8')), 'utf8')
    );
    if (!asset) {
      res.status(404).type('text/plain').send('index.html not found');
      return;
    }
    sendCachedAsset(req, res, asset, 'no-cache');
  });

  // Serve whitelisted public static files (css/*, js/*, assets/*, favicon, etc.) with gzip & cache headers
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    const safeRel = resolveSafeStaticRelPath(req.path);
    if (!safeRel) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    let resolvedPath: string | null = null;
    for (const root of staticRoots) {
      const candidate = resolveConfinedFilePath(root, safeRel);
      if (candidate && fs.existsSync(candidate)) {
        resolvedPath = candidate;
        break;
      }
    }
    if (!resolvedPath) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const asset = getCachedFile(resolvedPath);
    if (!asset) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const hasVersion = typeof req.query.v === 'string' && req.query.v.length > 0;
    const cacheControl = getCacheControlForAsset(safeRel, hasVersion);
    sendCachedAsset(req, res, asset, cacheControl);
  });

  // Fallback Express error handler so malformed requests never crash the process
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[Whiteboard Pro] HTTP error:', err?.message || err);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  const shouldAutoOpen = process.env.WB_OPEN_BROWSER === '1';

  const listenWithFallback = (candidatePort: number): void => {
    const onError = async (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && shouldAutoOpen) {
        // Check if Whiteboard Pro is already running on this port
        try {
          const r = await fetch(`http://127.0.0.1:${candidatePort}/api/config`);
          if (r.ok) {
            const existingUrl = `http://localhost:${candidatePort}`;
            console.log(`Whiteboard Pro уже запущен на ${existingUrl}`);
            openLocalBrowser(existingUrl);
            process.exit(0);
          }
        } catch {
          // Different app uses this port -> try next port
        }
        if (candidatePort < PORT + 10) {
          server.removeListener('error', onError);
          listenWithFallback(candidatePort + 1);
          return;
        }
      }
      console.error(`Не удалось запустить сервер на порту ${candidatePort}:`, err.message);
      process.exit(1);
    };

    server.once('error', onError);
    server.listen(candidatePort, '0.0.0.0', () => {
      server.removeListener('error', onError);
      activePort = candidatePort;
      const localUrl = `http://localhost:${candidatePort}`;
      console.log(`Whiteboard Pro server listening on http://0.0.0.0:${candidatePort}`);
      if (shouldAutoOpen) {
        console.log(`Открываем браузер: ${localUrl}`);
        openLocalBrowser(localUrl);
      }
    });
  };

  listenWithFallback(PORT);
}

startServer().catch((err) => {
  console.error('Failed to start Whiteboard Pro server:', err);
  process.exit(1);
});
