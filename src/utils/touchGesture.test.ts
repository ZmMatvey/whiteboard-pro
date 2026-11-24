import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computePinchCameraStep,
  shouldRejectPalmTouch,
  computeScrollViewportZoom,
} from './touchGesture';

test('computePinchCameraStep zooms smoothly and keeps world anchor under midpoint invariant', () => {
  const initialCam = { x: 100, y: 50, z: 1 };
  const prevMid = { x: 300, y: 200 };
  const prevDist = 100;

  // World point under midpoint before pinch:
  const worldBeforeX = (prevMid.x - initialCam.x) / initialCam.z;
  const worldBeforeY = (prevMid.y - initialCam.y) / initialCam.z;

  // Spread fingers from 100px apart to 200px apart centered at same midpoint
  const res = computePinchCameraStep(
    initialCam,
    prevMid,
    prevDist,
    { x: 200, y: 200 },
    { x: 400, y: 200 }
  );

  assert.equal(res.cam.z, 2);
  const worldAfterX = (res.mid.x - res.cam.x) / res.cam.z;
  const worldAfterY = (res.mid.y - res.cam.y) / res.cam.z;
  assert.ok(Math.abs(worldAfterX - worldBeforeX) < 1e-6);
  assert.ok(Math.abs(worldAfterY - worldBeforeY) < 1e-6);
});

test('computePinchCameraStep clamps zoom to [0.2, 4.0]', () => {
  const high = computePinchCameraStep(
    { x: 0, y: 0, z: 3.5 },
    { x: 200, y: 200 },
    100,
    { x: 0, y: 200 },
    { x: 400, y: 200 }
  );
  assert.equal(high.cam.z, 4);

  const low = computePinchCameraStep(
    { x: 0, y: 0, z: 0.3 },
    { x: 200, y: 200 },
    200,
    { x: 180, y: 200 },
    { x: 220, y: 200 }
  );
  assert.equal(low.cam.z, 0.2);
});

test('shouldRejectPalmTouch blocks touch during pen input and grace window, allows normal touch', () => {
  assert.equal(
    shouldRejectPalmTouch({ pointerType: 'pen', nowMs: 1000, lastPenActiveMs: 1000, isPenDown: true }),
    false
  );
  assert.equal(
    shouldRejectPalmTouch({ pointerType: 'touch', nowMs: 1000, lastPenActiveMs: 1000, isPenDown: true }),
    true
  );
  assert.equal(
    shouldRejectPalmTouch({ pointerType: 'touch', nowMs: 1400, lastPenActiveMs: 1000, isPenDown: false }),
    true
  );
  assert.equal(
    shouldRejectPalmTouch({ pointerType: 'touch', nowMs: 2500, lastPenActiveMs: 1000, isPenDown: false, contactWidth: 20, contactHeight: 20 }),
    false
  );
  assert.equal(
    shouldRejectPalmTouch({ pointerType: 'touch', nowMs: 2500, lastPenActiveMs: 1000, isPenDown: false, contactWidth: 68, contactHeight: 40 }),
    true
  );
});

test('computeScrollViewportZoom preserves focus coordinate inside scrolled viewport', () => {
  const next = computeScrollViewportZoom(100, 200, 150, 100, 1.0, 2.0);
  // Content point was (250, 300); at 2x it is (500, 600); minus focus (150, 100) => (350, 500)
  assert.deepEqual(next, { scrollLeft: 350, scrollTop: 500 });
});
