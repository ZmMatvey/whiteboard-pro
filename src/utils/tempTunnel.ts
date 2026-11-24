import net from 'net';
import { Client } from 'ssh2';
import { extractTunnelHttpsUrl, shouldRotateTunnel } from './tempSession.ts';

export interface ActiveTunnelInfo {
  url: string;
  provider: string;
  startedAt: number;
}

class TempTunnelManager {
  private client: Client | null = null;
  private activeInfo: ActiveTunnelInfo | null = null;
  private pendingPromise: Promise<ActiveTunnelInfo> | null = null;
  private activeSockets = new Set<net.Socket>();
  private closing = false;

  getStatus(): { active: boolean; url: string; provider: string; startedAt: number } {
    if (this.activeInfo && this.client) {
      return {
        active: true,
        url: this.activeInfo.url,
        provider: this.activeInfo.provider,
        startedAt: this.activeInfo.startedAt,
      };
    }
    return { active: false, url: '', provider: '', startedAt: 0 };
  }

  async ensureTunnel(localPort: number, forceFresh = false): Promise<ActiveTunnelInfo> {
    if (
      !forceFresh &&
      this.activeInfo &&
      this.client &&
      !shouldRotateTunnel(this.activeInfo.startedAt, Date.now())
    ) {
      return this.activeInfo;
    }

    if (forceFresh) {
      this.closeTunnel();
    }

    if (this.pendingPromise) {
      return this.pendingPromise;
    }

    this.pendingPromise = this.openPinggyTunnel(localPort).finally(() => {
      this.pendingPromise = null;
    });

    return this.pendingPromise;
  }

  closeTunnel(): void {
    this.closing = true;
    const c = this.client;
    this.client = null;
    this.activeInfo = null;
    for (const s of this.activeSockets) {
      try {
        s.destroy();
      } catch {
        // ignore
      }
    }
    this.activeSockets.clear();
    if (c) {
      try {
        c.end();
      } catch {
        // ignore
      }
    }
    this.closing = false;
  }

  private openPinggyTunnel(localPort: number): Promise<ActiveTunnelInfo> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let settled = false;
      let logs = '';

      const fail = (reason: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.client === conn) {
          this.client = null;
          this.activeInfo = null;
        }
        try {
          conn.end();
        } catch {
          // ignore
        }
        reject(new Error(reason));
      };

      const succeed = (url: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Replace any stale tunnel cleanly
        if (this.client && this.client !== conn) {
          try {
            this.client.end();
          } catch {
            // ignore
          }
        }
        this.client = conn;
        this.activeInfo = {
          url,
          provider: 'pinggy-443',
          startedAt: Date.now(),
        };
        resolve(this.activeInfo);
      };

      const timer = setTimeout(() => {
        fail('tunnel_timeout');
      }, 12_000);

      conn.on('ready', () => {
        conn.forwardIn('', 0, (fwdErr) => {
          if (fwdErr) {
            fail('tunnel_forward_failed:' + fwdErr.message);
            return;
          }
          conn.shell(false, (shErr, stream) => {
            if (shErr) {
              fail('tunnel_shell_failed:' + shErr.message);
              return;
            }
            stream.on('data', (chunk: Buffer) => {
              logs += chunk.toString('utf8');
              if (logs.length > 8192) logs = logs.slice(-4096);
              if (!settled) {
                const url = extractTunnelHttpsUrl(logs);
                if (url) {
                  succeed(url);
                }
              }
            });
            stream.on('close', () => {
              if (!settled) {
                fail('tunnel_stream_closed');
              } else if (this.client === conn) {
                this.client = null;
                this.activeInfo = null;
              }
            });
          });
        });
      });

      conn.on('tcp connection', (_info, accept) => {
        const upstream = accept();
        const local = net.connect(localPort, '127.0.0.1');
        this.activeSockets.add(local);

        const cleanup = () => {
          this.activeSockets.delete(local);
          try {
            upstream.destroy();
          } catch {
            // ignore
          }
          try {
            local.destroy();
          } catch {
            // ignore
          }
        };

        upstream.pipe(local).pipe(upstream);
        upstream.on('error', cleanup);
        local.on('error', cleanup);
        local.on('close', () => this.activeSockets.delete(local));
      });

      conn.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finishAuth) => {
        finishAuth(prompts.map(() => ''));
      });

      conn.on('error', (err) => {
        if (!settled) {
          fail('tunnel_ssh_error:' + err.message);
        } else if (!this.closing && this.client === conn) {
          this.client = null;
          this.activeInfo = null;
        }
      });

      conn.on('end', () => {
        if (!settled) {
          fail('tunnel_ended');
        } else if (this.client === conn) {
          this.client = null;
          this.activeInfo = null;
        }
      });

      conn.on('close', () => {
        if (!settled) {
          fail('tunnel_closed');
        } else if (this.client === conn) {
          this.client = null;
          this.activeInfo = null;
        }
      });

      conn.connect({
        host: 'a.pinggy.io',
        port: 443,
        username: 'wb',
        password: '',
        tryKeyboard: true,
        readyTimeout: 9_000,
        keepaliveInterval: 15_000,
        keepaliveCountMax: 3,
        hostVerifier: () => true,
      });
    });
  }
}

export const tempTunnelManager = new TempTunnelManager();
