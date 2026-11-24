export interface TempSessionState {
  roomId: string;
  accessOpen: boolean;
  teacherSocketCount: number;
  teacherLastSeenAt: number;
  closingSinceAt: number | null;
}

export const TEACHER_HEARTBEAT_TTL_MS = 30_000;
export const TEACHER_RELOAD_GRACE_MS = 5_000;
export const TUNNEL_MAX_AGE_MS = 50 * 60 * 1000; // Rotate Pinggy 60m tunnel proactively at 50m

/**
 * Determines whether a temporary room link is currently active for students.
 * A link stays alive ONLY while the teacher is actively present in the board.
 */
export function isRoomLiveForStudent(
  session: TempSessionState | null | undefined,
  now: number,
  heartbeatTtlMs = TEACHER_HEARTBEAT_TTL_MS,
  reloadGraceMs = TEACHER_RELOAD_GRACE_MS
): boolean {
  if (!session || !session.accessOpen) return false;
  if (session.teacherSocketCount > 0) return true;
  if (session.closingSinceAt !== null) {
    return now - session.closingSinceAt <= reloadGraceMs;
  }
  if (session.teacherLastSeenAt <= 0) return false;
  return now - session.teacherLastSeenAt <= heartbeatTtlMs;
}

/**
 * Checks whether an active session has expired due to teacher inactivity or tab close.
 */
export function isSessionExpired(
  session: TempSessionState | null | undefined,
  now: number,
  heartbeatTtlMs = TEACHER_HEARTBEAT_TTL_MS,
  reloadGraceMs = TEACHER_RELOAD_GRACE_MS
): boolean {
  if (!session) return true;
  return !isRoomLiveForStudent(session, now, heartbeatTtlMs, reloadGraceMs);
}

/**
 * Returns true if the server should auto-open a temporary public HTTPS tunnel
 * for the given request origin (true for localhost/LAN and foreign AI Studio preview hosts).
 */
export function shouldUseTemporaryTunnel(
  requestBaseUrl: string,
  explicitPublicUrl: string,
  isLocalFn: (url: string) => boolean,
  isForeignPreviewFn: (url: string) => boolean
): boolean {
  if (explicitPublicUrl && !isLocalFn(explicitPublicUrl) && !isForeignPreviewFn(explicitPublicUrl)) {
    return false;
  }
  if (!requestBaseUrl) return true;
  if (isLocalFn(requestBaseUrl)) return true;
  if (isForeignPreviewFn(requestBaseUrl)) return true;
  return false;
}

/**
 * Extracts a clean public HTTPS tunnel URL from raw SSH tunnel output (Pinggy / localhost.run).
 * Filters out dashboard/marketing links and strips ANSI terminal sequences.
 */
export function extractTunnelHttpsUrl(rawOutput: string): string {
  if (!rawOutput) return '';
  const cleaned = String(rawOutput).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
  const matches = cleaned.match(
    /https:\/\/[a-z0-9][a-z0-9-]*\.[a-z0-9.-]*(?:pinggy-free\.link|pinggy\.link|pinggy\.net|lhr\.life)/gi
  );
  if (!matches || matches.length === 0) return '';

  const filtered = matches.filter((u) => !/dashboard\.pinggy/i.test(u));
  if (filtered.length === 0) return '';

  const preferred = filtered.find((u) => /pinggy-free\.link|pinggy\.link|lhr\.life/i.test(u));
  return (preferred || filtered[0]).replace(/\/+$/, '');
}

/**
 * Returns true when an existing tunnel is close enough to its 60-minute limit
 * that a fresh tunnel should be opened proactively.
 */
export function shouldRotateTunnel(startedAt: number, now: number, maxAgeMs = TUNNEL_MAX_AGE_MS): boolean {
  if (!startedAt || startedAt <= 0) return true;
  return now - startedAt >= maxAgeMs;
}
