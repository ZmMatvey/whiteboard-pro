import path from 'path';

export const ALLOWED_STATIC_PREFIXES = ['css/', 'js/', 'assets/', 'fonts/', 'icons/', 'images/'] as const;
export const ALLOWED_ROOT_FILES = new Set([
  'favicon.ico',
  'favicon.svg',
  'manifest.json',
  'manifest.webmanifest',
  'robots.txt',
]);

const COMPRESSIBLE_EXTENSIONS = new Set([
  '.html',
  '.htm',
  '.css',
  '.js',
  '.mjs',
  '.json',
  '.svg',
  '.txt',
  '.xml',
  '.webmanifest',
]);

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

export function isCompressiblePath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return COMPRESSIBLE_EXTENSIONS.has(ext);
}

export function clientAcceptsGzip(acceptEncodingHeader: string | string[] | undefined): boolean {
  if (!acceptEncodingHeader) return false;
  const value = Array.isArray(acceptEncodingHeader)
    ? acceptEncodingHeader.join(',')
    : acceptEncodingHeader;
  return /\bgzip\b/i.test(value);
}

export function getCacheControlForAsset(relPath: string, hasVersionQuery: boolean): string {
  const ext = path.extname(relPath).toLowerCase();
  if (ext === '.html' || ext === '.htm') {
    return 'no-cache';
  }
  if (hasVersionQuery) {
    return 'public, max-age=31536000, immutable';
  }
  return 'public, max-age=3600';
}

export function buildWeakEtag(sizeBytes: number, mtimeMs: number): string {
  const mtimeHex = Math.floor(mtimeMs).toString(16);
  const sizeHex = sizeBytes.toString(16);
  return `W/"${sizeHex}-${mtimeHex}"`;
}

export function etagMatches(ifNoneMatchHeader: string | string[] | undefined, currentEtag: string): boolean {
  if (!ifNoneMatchHeader || !currentEtag) return false;
  const raw = Array.isArray(ifNoneMatchHeader) ? ifNoneMatchHeader.join(',') : ifNoneMatchHeader;
  if (raw.trim() === '*') return true;
  const normCurrent = currentEtag.replace(/^W\//i, '').trim();
  return raw.split(',').some((part) => part.trim().replace(/^W\//i, '') === normCurrent);
}

/**
 * Safely resolves a URL pathname to an allowed public static file inside baseDir.
 * Blocks path traversal and prevents serving server code, configs, or hidden files.
 */
export function resolveSafeStaticRelPath(urlPathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPathname || '');
  } catch {
    return null;
  }
  const trimmed = decoded.replace(/^\/+/, '');
  if (!trimmed || trimmed.includes('\0') || trimmed.includes('\\')) return null;

  const segments = trimmed.split('/');
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..' || seg.startsWith('.')) {
      return null;
    }
  }

  const normalized = segments.join('/');
  if (ALLOWED_ROOT_FILES.has(normalized)) {
    return normalized;
  }
  for (const prefix of ALLOWED_STATIC_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      return normalized;
    }
  }
  return null;
}

export function resolveConfinedFilePath(baseDir: string, relPath: string): string | null {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, relPath);
  if (!resolvedTarget.startsWith(resolvedBase + path.sep)) {
    return null;
  }
  return resolvedTarget;
}

export type BackpressureAction = 'send' | 'skip' | 'terminate';

const TRANSIENT_WS_TYPES = new Set(['cursor', 'stroke_live', 'peer_view', 'pdf_laser', 'pdf_stroke_live']);

export const WS_TRANSIENT_BUFFER_LIMIT = 512 * 1024; // 512 KB
export const WS_HARD_BUFFER_LIMIT = 8 * 1024 * 1024; // 8 MB

export function decideWsBackpressure(
  bufferedAmount: number,
  messageType: string
): BackpressureAction {
  if (bufferedAmount >= WS_HARD_BUFFER_LIMIT) {
    return 'terminate';
  }
  if (bufferedAmount >= WS_TRANSIENT_BUFFER_LIMIT && TRANSIENT_WS_TYPES.has(messageType)) {
    return 'skip';
  }
  return 'send';
}
