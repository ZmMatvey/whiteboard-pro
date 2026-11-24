import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePublicBaseUrl,
  isLocalOrBrowserOnlyUrl,
  isForeignCloudPreviewHost,
  detectPreferredLinkStyle,
  resolvePublicShareBase,
  sanitizeRoomId,
  parseRoomCodeOrUrl,
  buildDedicatedRoomUrl,
  extractRoomInfoFromLocation,
} from './shareLink';

test('normalizePublicBaseUrl preserves static subpaths, accepts bare RF domains, and never invents 404 ais-pre', () => {
  assert.equal(normalizePublicBaseUrl('my-board.cloudpub.ru/'), 'https://my-board.cloudpub.ru');
  assert.equal(
    normalizePublicBaseUrl('https://teacher.github.io/whiteboard/index.html?shared=wb-123'),
    'https://teacher.github.io/whiteboard'
  );
  assert.equal(
    normalizePublicBaseUrl('https://demo.tuna.am/shared/wb-999'),
    'https://demo.tuna.am'
  );
  // Must NOT silently rewrite ais-dev into an undeployed ais-pre URL
  assert.equal(
    normalizePublicBaseUrl('https://ais-dev-demo-123.europe-west2.run.app/?room=wb-123'),
    'https://ais-dev-demo-123.europe-west2.run.app'
  );
  assert.equal(normalizePublicBaseUrl('file:///C:/Users/teacher/index.html'), '');
  assert.equal(normalizePublicBaseUrl('javascript:alert(1)'), '');
});

test('detectPreferredLinkStyle chooses 404-free ?shared= on static hosts/subpaths and /shared/ on RF tunnels/servers', () => {
  assert.equal(detectPreferredLinkStyle('https://demo.cloudpub.ru'), 'path');
  assert.equal(detectPreferredLinkStyle('https://my-board.tuna.am'), 'path');
  assert.equal(detectPreferredLinkStyle('https://teacher.github.io/whiteboard'), 'query');
  assert.equal(detectPreferredLinkStyle('https://teacher.github.io'), 'query');
  assert.equal(detectPreferredLinkStyle('https://storage.yandexcloud.net/my-bucket'), 'query');
  assert.equal(detectPreferredLinkStyle('https://school.ru/board'), 'query');
  assert.equal(detectPreferredLinkStyle('https://school.ru/board', 'path'), 'path');
});

test('resolvePublicShareBase never falls back to dead Google Cloud run.app URL when opened locally on PC', () => {
  const fromPcFile = resolvePublicShareBase({
    locationHref: 'file:///C:/Users/teacher/Whiteboard/index.html',
    serverPublicUrl: 'https://ais-pre-demo-123.europe-west2.run.app',
  });
  assert.equal(fromPcFile.baseUrl, '');
  assert.equal(fromPcFile.isPublicInternet, false);
  assert.equal(fromPcFile.needsPublicHost, true);

  const withRfTunnel = resolvePublicShareBase({
    locationHref: 'file:///C:/Users/teacher/Whiteboard/index.html',
    customPublicUrl: 'my-lesson.cloudpub.ru',
  });
  assert.equal(withRfTunnel.baseUrl, 'https://my-lesson.cloudpub.ru');
  assert.equal(withRfTunnel.isPublicInternet, true);
  assert.equal(withRfTunnel.needsPublicHost, false);
  assert.equal(withRfTunnel.linkStyle, 'path');
  assert.equal(withRfTunnel.source, 'custom');

  const withStaticHost = resolvePublicShareBase({
    locationHref: 'http://localhost:3000/',
    customPublicUrl: 'https://teacher.github.io/whiteboard/',
  });
  assert.equal(withStaticHost.baseUrl, 'https://teacher.github.io/whiteboard');
  assert.equal(withStaticHost.linkStyle, 'query');
  assert.equal(withStaticHost.isPublicInternet, true);

  assert.equal(isForeignCloudPreviewHost('https://ais-pre-abc.europe-west2.run.app'), true);
  assert.equal(isForeignCloudPreviewHost('https://my-board.cloudpub.ru'), false);
});

test('buildDedicatedRoomUrl creates LearnBoard /shared/:id for servers/tunnels and ?shared=:id for static hosts', () => {
  assert.equal(
    buildDedicatedRoomUrl('https://my-lesson.tuna.am', 'wb-k9m2p1x4', 'student'),
    'https://my-lesson.tuna.am/shared/wb-k9m2p1x4'
  );
  assert.equal(
    buildDedicatedRoomUrl('https://teacher.github.io/whiteboard/', 'wb-k9m2p1x4', 'student'),
    'https://teacher.github.io/whiteboard/?shared=wb-k9m2p1x4'
  );
  assert.equal(
    buildDedicatedRoomUrl('https://board.example.ru/', 'wb-k9m2p1x4', 'teacher'),
    'https://board.example.ru/room/wb-k9m2p1x4'
  );
  assert.equal(sanitizeRoomId('wb-abc_123'), 'wb-abc_123');
  assert.equal(sanitizeRoomId('x'), '');
  assert.equal(isLocalOrBrowserOnlyUrl('http://127.0.0.1:3000'), true);
  assert.equal(isLocalOrBrowserOnlyUrl('https://my-lesson.cloudpub.ru'), false);
});

test('extractRoomInfoFromLocation and parseRoomCodeOrUrl handle codes, /shared/, ?shared=, and #shared=', () => {
  assert.deepEqual(extractRoomInfoFromLocation('/shared/wb-k9m2p1x4', ''), {
    roomId: 'wb-k9m2p1x4',
    isSharedStudentLink: true,
  });
  assert.deepEqual(extractRoomInfoFromLocation('/whiteboard/', '?shared=wb-k9m2p1x4'), {
    roomId: 'wb-k9m2p1x4',
    isSharedStudentLink: true,
  });
  assert.deepEqual(extractRoomInfoFromLocation('/index.html', '', '#shared=wb-k9m2p1x4'), {
    roomId: 'wb-k9m2p1x4',
    isSharedStudentLink: true,
  });
  assert.equal(parseRoomCodeOrUrl('wb-k9m2p1x4'), 'wb-k9m2p1x4');
  assert.equal(parseRoomCodeOrUrl('https://my-lesson.tuna.am/shared/wb-k9m2p1x4'), 'wb-k9m2p1x4');
  assert.equal(parseRoomCodeOrUrl('https://teacher.github.io/wb/?shared=wb-k9m2p1x4'), 'wb-k9m2p1x4');
});
