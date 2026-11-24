export interface Point2D {
  x: number;
  y: number;
}

export interface CameraState {
  x: number;
  y: number;
  z: number;
}

export interface PinchStepResult {
  cam: CameraState;
  mid: Point2D;
  dist: number;
}

/**
 * Computes the next camera transform for a two-finger pinch + pan gesture
 * while preserving the world point under the pinch midpoint.
 */
export function computePinchCameraStep(
  cam: CameraState,
  prevMid: Point2D,
  prevDist: number,
  p0: Point2D,
  p1: Point2D,
  minZoom = 0.2,
  maxZoom = 4.0
): PinchStepResult {
  const mid: Point2D = {
    x: (p0.x + p1.x) / 2,
    y: (p0.y + p1.y) / 2,
  };
  const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);

  let nextX = cam.x + (mid.x - prevMid.x);
  let nextY = cam.y + (mid.y - prevMid.y);
  let nextZ = cam.z;

  if (prevDist > 12 && dist > 12) {
    const scaleFactor = dist / prevDist;
    const clampedZ = Math.min(maxZoom, Math.max(minZoom, Number((cam.z * scaleFactor).toFixed(4))));
    const ratio = clampedZ / cam.z;
    nextX = mid.x - (mid.x - nextX) * ratio;
    nextY = mid.y - (mid.y - nextY) * ratio;
    nextZ = clampedZ;
  }

  return {
    cam: { x: nextX, y: nextY, z: nextZ },
    mid,
    dist,
  };
}

export interface PalmRejectionInput {
  pointerType: string;
  nowMs: number;
  lastPenActiveMs: number;
  isPenDown: boolean;
  contactWidth?: number;
  contactHeight?: number;
  penGraceMs?: number;
}

/**
 * Rejects accidental palm touches while a stylus/Apple Pencil is down or was just used,
 * or when a large palm contact area touches while stylus mode was recently active.
 */
export function shouldRejectPalmTouch(input: PalmRejectionInput): boolean {
  if (input.pointerType !== 'touch') return false;
  if (input.isPenDown) return true;

  const grace = input.penGraceMs ?? 650;
  if (input.lastPenActiveMs > 0 && input.nowMs - input.lastPenActiveMs < grace) {
    return true;
  }

  // Broad palm contact rejection (typical fingertip is 10-36px; palm exceeds 52px)
  const w = Number(input.contactWidth) || 0;
  const h = Number(input.contactHeight) || 0;
  if (input.lastPenActiveMs > 0 && input.nowMs - input.lastPenActiveMs < 4000 && Math.max(w, h) >= 52) {
    return true;
  }

  return false;
}

/**
 * Computes scroll offsets for zooming a scrollable viewport (such as the PDF editor)
 * anchored around a viewport-local focus point (focusX, focusY).
 */
export function computeScrollViewportZoom(
  scrollLeft: number,
  scrollTop: number,
  focusX: number,
  focusY: number,
  oldZoom: number,
  newZoom: number
): { scrollLeft: number; scrollTop: number } {
  if (oldZoom <= 0 || newZoom <= 0) {
    return { scrollLeft, scrollTop };
  }
  const ratio = newZoom / oldZoom;
  const contentX = scrollLeft + focusX;
  const contentY = scrollTop + focusY;
  return {
    scrollLeft: Math.max(0, Math.round(contentX * ratio - focusX)),
    scrollTop: Math.max(0, Math.round(contentY * ratio - focusY)),
  };
}
