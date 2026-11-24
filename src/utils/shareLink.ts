export type ShareLinkStyle = 'auto' | 'path' | 'query';

export interface ResolvePublicBaseUrlOptions {
  /** Current browser location href (e.g. window.location.href or file:///...) */
  locationHref: string;
  /** Server-reported public URL (explicitly configured via PUBLIC_APP_URL or live non-local request host) */
  serverPublicUrl?: string | null;
  /** Optional user-configured custom public URL (saved in localStorage, e.g. CloudPub / Tuna / RF domain / GitHub Pages) */
  customPublicUrl?: string | null;
}

export interface ResolvedShareBase {
  baseUrl: string;
  isPublicInternet: boolean;
  isLocalBrowserPath: boolean;
  isForeignCloudPreview: boolean;
  needsPublicHost: boolean;
  linkStyle: 'path' | 'query';
  source: 'custom' | 'server' | 'origin' | 'fallback';
}

export interface ExtractedRoomInfo {
  roomId: string;
  isSharedStudentLink: boolean;
}

const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i;
const SAFE_ROOM_ID_RE = /^[a-z0-9][a-z0-9_-]{2,47}$/i;
const STATIC_HOST_RE =
  /(^|\.)(github\.io|gitlab\.io|netlify\.app|vercel\.app|pages\.dev|surge\.sh|yandexcloud\.net|hb\.vkcs\.cloud|selstorage\.ru)$/i;
const FOREIGN_CLOUD_PREVIEW_RE = /^ais-(dev|pre)-[a-z0-9-]+\.[a-z0-9-]+\.run\.app(?::\d+)?$/i;

/**
 * Returns true if the URL points to an ephemeral Google Cloud Run AI Studio preview host,
 * which may return 404 when undeployed or be inaccessible in Russia without VPN.
 */
export function isForeignCloudPreviewHost(rawUrl: string | null | undefined): boolean {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed);
    return FOREIGN_CLOUD_PREVIEW_RE.test(parsed.host);
  } catch {
    return false;
  }
}

/**
 * Normalizes a public web base URL (accepting full URLs or bare domains like `my-board.cloudpub.ru`
 * or `user.github.io/whiteboard/`). Preserves non-root subpaths for static hosting while stripping
 * `/index.html`, `/shared/...`, `/room/...`, queries, hashes, and trailing slashes.
 * Never rewrites `ais-dev-` into an undeployed `ais-pre-` 404 URL.
 */
export function normalizePublicBaseUrl(rawUrl: string | null | undefined): string {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return '';
  let candidate = trimmed;
  if (
    !/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) &&
    /^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(\/.*)?$/i.test(candidate)
  ) {
    candidate = 'https://' + candidate;
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return '';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return '';
  }

  let pathname = parsed.pathname || '';
  // Strip known app route suffixes and index.html
  pathname = pathname.replace(/\/(shared|room)\/[^/?#]*\/?$/i, '');
  pathname = pathname.replace(/\/index\.html?$/i, '');
  pathname = pathname.replace(/\/+$/, '');

  return `${parsed.protocol}//${parsed.host}${pathname}`;
}

/**
 * Backward-compatible alias returning the normalized public origin (or base URL with subpath).
 */
export function normalizePublicOrigin(rawUrl: string | null | undefined): string {
  return normalizePublicBaseUrl(rawUrl);
}

export function isLocalOrBrowserOnlyUrl(rawUrl: string | null | undefined): boolean {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return true;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return true;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return true;
  }
  return LOCAL_HOST_RE.test(parsed.hostname);
}

/**
 * Automatically selects the 404-free student link format for a given base URL:
 * - `'query'` (`?shared=<id>`) for static hosting providers (GitHub Pages, Yandex Cloud Object Storage, etc.)
 *   or subdirectory deployments where `/shared/<id>` would return 404.
 * - `'path'` (`/shared/<id>`, LearnBoard style) for Node/Express servers & RF tunnels (CloudPub, Tuna, VPS).
 */
export function detectPreferredLinkStyle(
  baseUrl: string | null | undefined,
  preferred: ShareLinkStyle = 'auto'
): 'path' | 'query' {
  if (preferred === 'path' || preferred === 'query') return preferred;
  const clean = normalizePublicBaseUrl(baseUrl);
  if (!clean) return 'path';
  try {
    const parsed = new URL(clean);
    const hasSubpath = parsed.pathname && parsed.pathname !== '/' && parsed.pathname.length > 1;
    if (hasSubpath || STATIC_HOST_RE.test(parsed.hostname)) {
      return 'query';
    }
  } catch {
    // ignore
  }
  return 'path';
}

/**
 * Resolves the best public internet base URL for invite links.
 * Never invents an undeployed `ais-pre-*.run.app` 404 URL when running locally on PC (`file:///` or `localhost`).
 */
export function resolvePublicShareBase(
  opts: ResolvePublicBaseUrlOptions,
  preferredStyle: ShareLinkStyle = 'auto'
): ResolvedShareBase {
  const customNorm = normalizePublicBaseUrl(opts.customPublicUrl);
  if (customNorm && !isLocalOrBrowserOnlyUrl(customNorm)) {
    return {
      baseUrl: customNorm,
      isPublicInternet: true,
      isLocalBrowserPath: false,
      isForeignCloudPreview: isForeignCloudPreviewHost(customNorm),
      needsPublicHost: false,
      linkStyle: detectPreferredLinkStyle(customNorm, preferredStyle),
      source: 'custom',
    };
  }

  const serverNorm = normalizePublicBaseUrl(opts.serverPublicUrl);
  if (serverNorm && !isLocalOrBrowserOnlyUrl(serverNorm) && !isForeignCloudPreviewHost(serverNorm)) {
    return {
      baseUrl: serverNorm,
      isPublicInternet: true,
      isLocalBrowserPath: false,
      isForeignCloudPreview: false,
      needsPublicHost: false,
      linkStyle: detectPreferredLinkStyle(serverNorm, preferredStyle),
      source: 'server',
    };
  }

  const locNorm = normalizePublicBaseUrl(opts.locationHref);
  if (locNorm && !isLocalOrBrowserOnlyUrl(locNorm)) {
    return {
      baseUrl: locNorm,
      isPublicInternet: true,
      isLocalBrowserPath: false,
      isForeignCloudPreview: isForeignCloudPreviewHost(locNorm),
      needsPublicHost: false,
      linkStyle: detectPreferredLinkStyle(locNorm, preferredStyle),
      source: 'origin',
    };
  }

  // Running locally on PC (file:/// or http://localhost:3000) without a public Russian host/tunnel configured yet
  return {
    baseUrl: '',
    isPublicInternet: false,
    isLocalBrowserPath: true,
    isForeignCloudPreview: false,
    needsPublicHost: true,
    linkStyle: preferredStyle === 'query' ? 'query' : 'path',
    source: 'fallback',
  };
}

export function sanitizeRoomId(raw: string | null | undefined): string {
  const clean = String(raw || '')
    .trim()
    .replace(/[^a-z0-9_-]/gi, '');
  if (SAFE_ROOM_ID_RE.test(clean)) return clean;
  return '';
}

/**
 * Extracts a room ID from either a raw room code (`wb-k9m2p1x4`) or a full shared URL.
 */
export function parseRoomCodeOrUrl(rawInput: string | null | undefined): string {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed) || trimmed.includes('/shared/') || trimmed.includes('/room/') || trimmed.includes('?')) {
    try {
      const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : 'https://placeholder.local/' + trimmed.replace(/^\/+/, ''));
      const info = extractRoomInfoFromLocation(parsed.pathname, parsed.search, parsed.hash);
      if (info.roomId) return info.roomId;
    } catch {
      // fall through to direct sanitize
    }
  }
  return sanitizeRoomId(trimmed);
}

/**
 * Builds a clean student or teacher room URL:
 * - `'path'` (server/tunnel): `https://my-board.cloudpub.ru/shared/wb-k9m2p1x4`
 * - `'query'` (static host): `https://user.github.io/whiteboard/?shared=wb-k9m2p1x4`
 */
export function buildDedicatedRoomUrl(
  baseUrl: string,
  roomId: string,
  role: 'student' | 'teacher' = 'student',
  style: ShareLinkStyle = 'auto'
): string {
  const cleanBase = normalizePublicBaseUrl(baseUrl);
  const safeRoom = sanitizeRoomId(roomId);
  if (!cleanBase || !safeRoom) return '';
  const resolvedStyle = detectPreferredLinkStyle(cleanBase, style);

  if (resolvedStyle === 'query') {
    return role === 'student'
      ? `${cleanBase}/?shared=${encodeURIComponent(safeRoom)}`
      : `${cleanBase}/?room=${encodeURIComponent(safeRoom)}`;
  }

  if (role === 'student') {
    return `${cleanBase}/shared/${encodeURIComponent(safeRoom)}`;
  }
  return `${cleanBase}/room/${encodeURIComponent(safeRoom)}`;
}

/**
 * Extracts room ID and student-link flag from:
 * - `/shared/<id>` (LearnBoard-style clean student invite link)
 * - `/room/<id>` (with optional `?role=student`)
 * - `?shared=<id>` or `?room=<id>`
 * - `#shared=<id>` or `#room=<id>`
 */
export function extractRoomInfoFromLocation(
  pathname: string,
  search: string,
  hash = ''
): ExtractedRoomInfo {
  const sharedPathMatch = String(pathname || '').match(/\/shared\/([^/?#]+)/i);
  if (sharedPathMatch && sharedPathMatch[1]) {
    try {
      const safe = sanitizeRoomId(decodeURIComponent(sharedPathMatch[1]));
      if (safe) return { roomId: safe, isSharedStudentLink: true };
    } catch {
      // ignore malformed URI sequence
    }
  }

  const roomPathMatch = String(pathname || '').match(/\/room\/([^/?#]+)/i);
  let roleIsStudent = false;
  try {
    const params = new URLSearchParams(search || '');
    roleIsStudent = params.get('role') === 'student';

    if (roomPathMatch && roomPathMatch[1]) {
      try {
        const safe = sanitizeRoomId(decodeURIComponent(roomPathMatch[1]));
        if (safe) return { roomId: safe, isSharedStudentLink: roleIsStudent };
      } catch {
        // ignore
      }
    }

    const fromSharedQuery = sanitizeRoomId(params.get('shared'));
    if (fromSharedQuery) return { roomId: fromSharedQuery, isSharedStudentLink: true };

    const fromRoomQuery = sanitizeRoomId(params.get('room'));
    if (fromRoomQuery) return { roomId: fromRoomQuery, isSharedStudentLink: roleIsStudent };
  } catch {
    // ignore
  }

  const cleanHash = String(hash || '').replace(/^#/, '');
  if (cleanHash) {
    const hashShared = cleanHash.match(/^shared=([^&]+)/i);
    if (hashShared && hashShared[1]) {
      try {
        const safe = sanitizeRoomId(decodeURIComponent(hashShared[1]));
        if (safe) return { roomId: safe, isSharedStudentLink: true };
      } catch {
        // ignore
      }
    }
    const hashRoom = cleanHash.match(/^room=([^&]+)/i);
    if (hashRoom && hashRoom[1]) {
      try {
        const safe = sanitizeRoomId(decodeURIComponent(hashRoom[1]));
        if (safe) return { roomId: safe, isSharedStudentLink: roleIsStudent };
      } catch {
        // ignore
      }
    }
  }

  return { roomId: '', isSharedStudentLink: false };
}

export function extractRoomIdFromLocation(pathname: string, search: string, hash = ''): string {
  return extractRoomInfoFromLocation(pathname, search, hash).roomId;
}
