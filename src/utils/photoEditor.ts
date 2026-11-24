export interface PhotoCropBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function computeRotatedDimensions(
  width: number,
  height: number,
  deltaDeg: number
): { width: number; height: number } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const normalized = ((Math.round(deltaDeg) % 360) + 360) % 360;
  if (normalized === 90 || normalized === 270) {
    return { width: h, height: w };
  }
  return { width: w, height: h };
}

export function computePhotoCropRect(
  box: PhotoCropBox | null | undefined,
  imgWidth: number,
  imgHeight: number,
  minSize = 16
): PhotoCropBox | null {
  if (!box || !Number.isFinite(imgWidth) || !Number.isFinite(imgHeight)) return null;
  const maxW = Math.floor(imgWidth);
  const maxH = Math.floor(imgHeight);
  if (maxW < minSize || maxH < minSize) return null;

  const rawX = Math.min(box.x, box.x + box.w);
  const rawY = Math.min(box.y, box.y + box.h);
  const rawW = Math.abs(box.w);
  const rawH = Math.abs(box.h);

  const x = Math.max(0, Math.min(maxW - minSize, Math.round(rawX)));
  const y = Math.max(0, Math.min(maxH - minSize, Math.round(rawY)));
  const w = Math.max(minSize, Math.min(maxW - x, Math.round(rawW)));
  const h = Math.max(minSize, Math.min(maxH - y, Math.round(rawH)));

  if (rawW < minSize || rawH < minSize) return null;
  return { x, y, w, h };
}

export function resolvePhotoExportFormat(
  pageCount: number,
  requestedFormat?: 'png' | 'jpg' | 'pdf'
): 'png' | 'jpg' | 'pdf' {
  if (requestedFormat === 'png' || requestedFormat === 'jpg' || requestedFormat === 'pdf') {
    return requestedFormat;
  }
  return pageCount > 1 ? 'pdf' : 'png';
}
