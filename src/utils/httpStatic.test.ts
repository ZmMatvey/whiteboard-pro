import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
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
  WS_TRANSIENT_BUFFER_LIMIT,
  WS_HARD_BUFFER_LIMIT,
} from './httpStatic';

test('resolveSafeStaticRelPath allows public assets and blocks server/config/traversal paths', () => {
  assert.equal(resolveSafeStaticRelPath('/css/main.css'), 'css/main.css');
  assert.equal(resolveSafeStaticRelPath('/js/app.js'), 'js/app.js');
  assert.equal(resolveSafeStaticRelPath('/favicon.ico'), 'favicon.ico');

  assert.equal(resolveSafeStaticRelPath('/server.ts'), null);
  assert.equal(resolveSafeStaticRelPath('/package.json'), null);
  assert.equal(resolveSafeStaticRelPath('/.env'), null);
  assert.equal(resolveSafeStaticRelPath('/whiteboard-win-server.ps1'), null);
  assert.equal(resolveSafeStaticRelPath('/css/../server.ts'), null);
  assert.equal(resolveSafeStaticRelPath('/css/%2e%2e/package.json'), null);
  assert.equal(resolveSafeStaticRelPath('/js/.secret.js'), null);
  assert.equal(resolveSafeStaticRelPath('/css\\main.css'), null);
});

test('resolveConfinedFilePath enforces trailing separator boundary', () => {
  const base = path.resolve('/tmp/wb-root');
  assert.equal(
    resolveConfinedFilePath(base, 'css/main.css'),
    path.join(base, 'css', 'main.css')
  );
  assert.equal(resolveConfinedFilePath(base, '../wb-root-other/a.js'), null);
});

test('MIME types, gzip detection, cache headers, and ETag matching work correctly', () => {
  assert.equal(getMimeType('app.js'), 'application/javascript; charset=utf-8');
  assert.equal(getMimeType('main.css'), 'text/css; charset=utf-8');
  assert.equal(getMimeType('logo.svg'), 'image/svg+xml');
  assert.equal(getMimeType('photo.png'), 'image/png');

  assert.equal(isCompressiblePath('main.css'), true);
  assert.equal(isCompressiblePath('app.js'), true);
  assert.equal(isCompressiblePath('photo.png'), false);

  assert.equal(clientAcceptsGzip('br, gzip, deflate'), true);
  assert.equal(clientAcceptsGzip('deflate'), false);
  assert.equal(clientAcceptsGzip(undefined), false);

  assert.equal(getCacheControlForAsset('index.html', false), 'no-cache');
  assert.equal(getCacheControlForAsset('css/main.css', true), 'public, max-age=31536000, immutable');
  assert.equal(getCacheControlForAsset('css/main.css', false), 'public, max-age=3600');

  const etag = buildWeakEtag(4096, 1700000000123);
  assert.equal(etagMatches(etag, etag), true);
  assert.equal(etagMatches(`"abc", ${etag}`, etag), true);
  assert.equal(etagMatches('"other"', etag), false);
});

test('decideWsBackpressure skips transient frames for slow clients and terminates stalled sockets', () => {
  assert.equal(decideWsBackpressure(0, 'cursor'), 'send');
  assert.equal(decideWsBackpressure(WS_TRANSIENT_BUFFER_LIMIT, 'cursor'), 'skip');
  assert.equal(decideWsBackpressure(WS_TRANSIENT_BUFFER_LIMIT, 'stroke_live'), 'skip');
  assert.equal(decideWsBackpressure(WS_TRANSIENT_BUFFER_LIMIT, 'state'), 'send');
  assert.equal(decideWsBackpressure(WS_HARD_BUFFER_LIMIT, 'state'), 'terminate');
});
