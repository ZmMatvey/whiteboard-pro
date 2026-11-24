import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isRoomLiveForStudent,
  isSessionExpired,
  shouldUseTemporaryTunnel,
  extractTunnelHttpsUrl,
  shouldRotateTunnel,
  TEACHER_HEARTBEAT_TTL_MS,
  TEACHER_RELOAD_GRACE_MS,
} from './tempSession.ts';
import { isLocalOrBrowserOnlyUrl, isForeignCloudPreviewHost } from './shareLink.ts';

describe('tempSession presence rules', () => {
  it('keeps room live while teacher has an open WebSocket connection', () => {
    const now = 100_000;
    const live = isRoomLiveForStudent(
      {
        roomId: 'wb-1234abcd',
        accessOpen: true,
        teacherSocketCount: 1,
        teacherLastSeenAt: 1_000,
        closingSinceAt: null,
      },
      now
    );
    assert.equal(live, true);
  });

  it('closes room immediately when teacher turns accessOpen off', () => {
    const now = 100_000;
    const live = isRoomLiveForStudent(
      {
        roomId: 'wb-1234abcd',
        accessOpen: false,
        teacherSocketCount: 1,
        teacherLastSeenAt: now,
        closingSinceAt: null,
      },
      now
    );
    assert.equal(live, false);
    assert.equal(
      isSessionExpired(
        {
          roomId: 'wb-1234abcd',
          accessOpen: false,
          teacherSocketCount: 1,
          teacherLastSeenAt: now,
          closingSinceAt: null,
        },
        now
      ),
      true
    );
  });

  it('allows brief reload grace after pagehide, then expires when teacher leaves', () => {
    const base = {
      roomId: 'wb-1234abcd',
      accessOpen: true,
      teacherSocketCount: 0,
      teacherLastSeenAt: 50_000,
      closingSinceAt: 50_000,
    };
    assert.equal(isRoomLiveForStudent(base, 50_000 + TEACHER_RELOAD_GRACE_MS - 100), true);
    assert.equal(isRoomLiveForStudent(base, 50_000 + TEACHER_RELOAD_GRACE_MS + 100), false);
  });

  it('expires room when teacher heartbeat times out without WebSocket', () => {
    const base = {
      roomId: 'wb-1234abcd',
      accessOpen: true,
      teacherSocketCount: 0,
      teacherLastSeenAt: 10_000,
      closingSinceAt: null,
    };
    assert.equal(isRoomLiveForStudent(base, 10_000 + TEACHER_HEARTBEAT_TTL_MS - 1000), true);
    assert.equal(isRoomLiveForStudent(base, 10_000 + TEACHER_HEARTBEAT_TTL_MS + 1000), false);
  });
});

describe('shouldUseTemporaryTunnel', () => {
  it('enables temporary tunnel for localhost and AI Studio preview hosts', () => {
    assert.equal(
      shouldUseTemporaryTunnel('http://localhost:3000', '', isLocalOrBrowserOnlyUrl, isForeignCloudPreviewHost),
      true
    );
    assert.equal(
      shouldUseTemporaryTunnel(
        'https://ais-dev-abc123.europe-west2.run.app',
        '',
        isLocalOrBrowserOnlyUrl,
        isForeignCloudPreviewHost
      ),
      true
    );
  });

  it('uses custom public domain directly when already hosted on a real domain', () => {
    assert.equal(
      shouldUseTemporaryTunnel('https://board.myschool.ru', '', isLocalOrBrowserOnlyUrl, isForeignCloudPreviewHost),
      false
    );
    assert.equal(
      shouldUseTemporaryTunnel(
        'http://localhost:3000',
        'https://board.myschool.ru',
        isLocalOrBrowserOnlyUrl,
        isForeignCloudPreviewHost
      ),
      false
    );
  });
});

describe('extractTunnelHttpsUrl', () => {
  it('extracts Pinggy HTTPS URL and ignores dashboard URL and ANSI codes', () => {
    const raw =
      '\x1b[32mYour tunnel will expire in 60 minutes. https://dashboard.pinggy.io\x1b[0m\n' +
      'https://qdjsi-34-34-246-80.run.pinggy-free.link\n' +
      'https://tzkec-34-34-246-80.free.pinggy.net\n';
    assert.equal(extractTunnelHttpsUrl(raw), 'https://qdjsi-34-34-246-80.run.pinggy-free.link');
  });

  it('returns empty string if only dashboard URL is present', () => {
    assert.equal(extractTunnelHttpsUrl('Visit https://dashboard.pinggy.io for Pro'), '');
  });

  it('detects tunnel rotation threshold', () => {
    assert.equal(shouldRotateTunnel(1000, 1000 + 49 * 60 * 1000), false);
    assert.equal(shouldRotateTunnel(1000, 1000 + 51 * 60 * 1000), true);
  });
});
