import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRotatedDimensions,
  computePhotoCropRect,
  resolvePhotoExportFormat,
} from './photoEditor';

test('computeRotatedDimensions swaps width and height for +/-90 degrees and keeps them for 180', () => {
  assert.deepEqual(computeRotatedDimensions(1200, 800, 90), { width: 800, height: 1200 });
  assert.deepEqual(computeRotatedDimensions(1200, 800, -90), { width: 800, height: 1200 });
  assert.deepEqual(computeRotatedDimensions(1200, 800, 180), { width: 1200, height: 800 });
  assert.deepEqual(computeRotatedDimensions(1200, 800, 0), { width: 1200, height: 800 });
});

test('computePhotoCropRect clamps selection safely within bounds and rejects tiny selections', () => {
  assert.equal(computePhotoCropRect({ x: 10, y: 10, w: 5, h: 5 }, 800, 600), null);
  assert.deepEqual(
    computePhotoCropRect({ x: -20, y: 50, w: 900, h: 400 }, 800, 600),
    { x: 0, y: 50, w: 800, h: 400 }
  );
  assert.deepEqual(
    computePhotoCropRect({ x: 300, y: 200, w: -100, h: -80 }, 800, 600),
    { x: 200, y: 120, w: 100, h: 80 }
  );
});

test('resolvePhotoExportFormat chooses PNG for single-page photo, PDF for multi-page, and honors explicit choice', () => {
  assert.equal(resolvePhotoExportFormat(1), 'png');
  assert.equal(resolvePhotoExportFormat(3), 'pdf');
  assert.equal(resolvePhotoExportFormat(3, 'png'), 'png');
  assert.equal(resolvePhotoExportFormat(1, 'jpg'), 'jpg');
});
