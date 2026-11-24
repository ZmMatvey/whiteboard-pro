$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$StartPort = 3000
if ($env:PORT -and ($env:PORT -as [int])) {
    $StartPort = [int]$env:PORT
}

$csharpSource = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

public class WhiteboardWinServer
{
    private class RoomData
    {
        public string RoomId;
        public string RawJson;
        public bool AccessOpen;
        public long TeacherLastSeenMs;
        public long ClosingSinceMs;
    }

    private class CachedStaticEntry
    {
        public long LastWriteTicks;
        public long RawLength;
        public string ETag;
        public string Mime;
        public byte[] Raw;
        public byte[] Gzip;
    }

    private class WsPeer
    {
        public TcpClient Client;
        public NetworkStream Stream;
        public readonly object QueueLock = new object();
        public readonly Queue<byte[]> SendQueue = new Queue<byte[]>();
        public int QueuedBytes;
        public string RoomId;
        public string Role;
        public string SenderId;
        public volatile bool Closed;
        public long LastActivityMs;
        public long LastPingSentMs;
        public volatile bool AwaitingPong;
    }

    private readonly string _rootDir;
    private readonly string _rootDirWithSep;
    private readonly int _port;
    private TcpListener _listener;
    private bool _boundAllInterfaces;
    private readonly object _lockObj = new object();
    private readonly object _staticCacheLock = new object();
    private readonly Dictionary<string, RoomData> _rooms = new Dictionary<string, RoomData>(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, List<WsPeer>> _wsRooms = new Dictionary<string, List<WsPeer>>(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, CachedStaticEntry> _staticCache = new Dictionary<string, CachedStaticEntry>(StringComparer.OrdinalIgnoreCase);

    private volatile bool _running;
    private Process _sshProc;
    private string _tunnelUrl = "";
    private long _tunnelStartedMs = 0;

    private const long HeartbeatTtlMs = 30000;
    private const long ReloadGraceMs = 5000;
    private const long TunnelMaxAgeMs = 50L * 60L * 1000L;
    private const long WsPingIntervalMs = 25000;
    private const long WsDeadTimeoutMs = 65000;
    private const int WsTransientQueueLimitBytes = 512 * 1024;
    private const int WsHardQueueLimitBytes = 6 * 1024 * 1024;
    private const int WsHardQueueLimitFrames = 256;
    private const int MaxStaticCacheEntries = 64;

    private static readonly DateTime EpochUtc = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
    private static readonly string TeacherLeftMsg = "\u041f\u0440\u0435\u043f\u043e\u0434\u0430\u0432\u0430\u0442\u0435\u043b\u044c \u0432\u044b\u0448\u0435\u043b \u0438\u0437 \u0434\u043e\u0441\u043a\u0438. \u0412\u0440\u0435\u043c\u0435\u043d\u043d\u0430\u044f \u0441\u0441\u044b\u043b\u043a\u0430 \u0431\u043e\u043b\u044c\u0448\u0435 \u043d\u0435 \u0430\u043a\u0442\u0438\u0432\u043d\u0430.";
    private static readonly string ErrNoSshMsg = "\u0412 Windows \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d \u0432\u0441\u0442\u0440\u043e\u0435\u043d\u043d\u044b\u0439 OpenSSH (ssh.exe).";
    private static readonly string ErrTunnelMsg = "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0437\u0434\u0430\u0442\u044c \u0432\u0440\u0435\u043c\u0435\u043d\u043d\u0443\u044e \u0441\u0441\u044b\u043b\u043a\u0443. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435 \u043a \u0438\u043d\u0442\u0435\u0440\u043d\u0435\u0442\u0443.";

    private static readonly Regex SafeRoomRegex = new Regex("^[a-zA-Z0-9][a-zA-Z0-9_-]{2,47}$");
    private static readonly Regex AnsiRegex = new Regex("\x1B\\[[0-9;?]*[a-zA-Z]");
    private static readonly Regex TunnelUrlRegex = new Regex("https://[a-z0-9][a-z0-9-]*\\.[a-z0-9.-]*(?:pinggy-free\\.link|pinggy\\.link|pinggy\\.net)", RegexOptions.IgnoreCase);
    private static readonly Regex HeadTagRegex = new Regex("<head([^>]*)>", RegexOptions.IgnoreCase);

    public WhiteboardWinServer(string rootDir, int port)
    {
        _rootDir = Path.GetFullPath(rootDir).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        _rootDirWithSep = _rootDir + Path.DirectorySeparatorChar;
        _port = port;
        _listener = new TcpListener(IPAddress.Any, port);
        _boundAllInterfaces = true;
    }

    public int Port { get { return _port; } }
    public bool BoundAllInterfaces { get { return _boundAllInterfaces; } }

    public void Start()
    {
        try
        {
            _listener.Start();
            _boundAllInterfaces = true;
        }
        catch
        {
            _listener = new TcpListener(IPAddress.Loopback, _port);
            _listener.Start();
            _boundAllInterfaces = false;
        }
        _running = true;

        Thread watchdog = new Thread(WatchdogLoop);
        watchdog.IsBackground = true;
        watchdog.Start();

        Thread acceptThread = new Thread(AcceptLoop);
        acceptThread.IsBackground = true;
        acceptThread.Start();
    }

    public void Stop()
    {
        _running = false;
        try { _listener.Stop(); } catch { }
        List<WsPeer> allPeers = new List<WsPeer>();
        lock (_lockObj)
        {
            foreach (List<WsPeer> list in _wsRooms.Values)
            {
                allPeers.AddRange(list);
            }
            _wsRooms.Clear();
        }
        for (int i = 0; i < allPeers.Count; i++)
        {
            CloseWsPeer(allPeers[i]);
        }
        CloseTunnel();
    }

    private static long NowMs()
    {
        return (long)(DateTime.UtcNow - EpochUtc).TotalMilliseconds;
    }

    private static string SanitizeRoomId(string raw)
    {
        if (string.IsNullOrEmpty(raw)) return "";
        string clean = Regex.Replace(raw.Trim(), "[^a-zA-Z0-9_-]", "");
        return SafeRoomRegex.IsMatch(clean) ? clean : "";
    }

    private static string GenerateRoomId()
    {
        byte[] bytes = Guid.NewGuid().ToByteArray();
        StringBuilder sb = new StringBuilder("wb-");
        for (int i = 0; i < 4; i++) sb.Append(bytes[i].ToString("x2"));
        return sb.ToString();
    }

    private static string JsonEscape(string s)
    {
        if (s == null) return "";
        StringBuilder sb = new StringBuilder(s.Length + 8);
        for (int i = 0; i < s.Length; i++)
        {
            char c = s[i];
            if (c == '\\') sb.Append("\\\\");
            else if (c == '"') sb.Append("\\\"");
            else if (c == '\r') sb.Append("\\r");
            else if (c == '\n') sb.Append("\\n");
            else if (c == '\t') sb.Append("\\t");
            else sb.Append(c);
        }
        return sb.ToString();
    }

    private static string ExtractJsonString(string json, string field)
    {
        if (string.IsNullOrEmpty(json)) return "";
        Match m = Regex.Match(json, "\"" + Regex.Escape(field) + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
        if (!m.Success) return "";
        try { return Regex.Unescape(m.Groups[1].Value); }
        catch { return m.Groups[1].Value; }
    }

    private static bool ExtractJsonBool(string json, string field, bool defaultVal)
    {
        if (string.IsNullOrEmpty(json)) return defaultVal;
        Match m = Regex.Match(json, "\"" + Regex.Escape(field) + "\"\\s*:\\s*(true|false)", RegexOptions.IgnoreCase);
        if (!m.Success) return defaultVal;
        return string.Equals(m.Groups[1].Value, "true", StringComparison.OrdinalIgnoreCase);
    }

    private bool IsRoomLiveLocked(RoomData r, long now)
    {
        if (r == null || !r.AccessOpen) return false;
        if (r.ClosingSinceMs > 0)
        {
            return (now - r.ClosingSinceMs) <= ReloadGraceMs;
        }
        if (r.TeacherLastSeenMs <= 0) return false;
        return (now - r.TeacherLastSeenMs) <= HeartbeatTtlMs;
    }

    private bool HasAnyActiveTeacherLocked(long now)
    {
        foreach (RoomData r in _rooms.Values)
        {
            if (IsRoomLiveLocked(r, now)) return true;
        }
        return false;
    }

    private void WatchdogLoop()
    {
        byte[] pingFrame = BuildWsFrame(9, new byte[0]);
        while (_running)
        {
            Thread.Sleep(5000);
            bool shouldKillTunnel = false;
            List<WsPeer> allPeers = new List<WsPeer>();
            long now = NowMs();
            lock (_lockObj)
            {
                bool anyChanged = false;
                foreach (RoomData r in _rooms.Values)
                {
                    if (r.AccessOpen && !IsRoomLiveLocked(r, now))
                    {
                        r.AccessOpen = false;
                        r.ClosingSinceMs = 0;
                        r.TeacherLastSeenMs = 0;
                        anyChanged = true;
                    }
                }
                if ((anyChanged || !string.IsNullOrEmpty(_tunnelUrl)) && !HasAnyActiveTeacherLocked(now))
                {
                    if (!string.IsNullOrEmpty(_tunnelUrl))
                    {
                        shouldKillTunnel = true;
                    }
                }
                foreach (List<WsPeer> list in _wsRooms.Values)
                {
                    allPeers.AddRange(list);
                }
            }
            if (shouldKillTunnel)
            {
                CloseTunnel();
            }

            // Ping/Pong heartbeat & dead socket eviction for sleeping tablets
            for (int i = 0; i < allPeers.Count; i++)
            {
                WsPeer peer = allPeers[i];
                if (peer == null || peer.Closed) continue;
                long idleMs = now - Interlocked.Read(ref peer.LastActivityMs);
                if (idleMs > WsDeadTimeoutMs)
                {
                    CloseWsPeer(peer);
                    continue;
                }
                long sincePingMs = now - Interlocked.Read(ref peer.LastPingSentMs);
                if (idleMs >= WsPingIntervalMs && sincePingMs >= WsPingIntervalMs)
                {
                    peer.AwaitingPong = true;
                    Interlocked.Exchange(ref peer.LastPingSentMs, now);
                    EnqueueWsFrame(peer, pingFrame, true);
                }
            }
        }
    }

    private string FindExecutable(string name)
    {
        string winDir = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        string sys32 = Path.Combine(winDir, "System32", "OpenSSH", name);
        if (File.Exists(sys32)) return sys32;
        string sysNative = Path.Combine(winDir, "Sysnative", "OpenSSH", name);
        if (File.Exists(sysNative)) return sysNative;
        string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
        string[] dirs = pathEnv.Split(';');
        for (int i = 0; i < dirs.Length; i++)
        {
            string d = dirs[i].Trim();
            if (string.IsNullOrEmpty(d)) continue;
            string cand = Path.Combine(d, name);
            if (File.Exists(cand)) return cand;
        }
        return name;
    }

    private string EnsureTunnelKey()
    {
        string keyPath = Path.Combine(Path.GetTempPath(), "wb_pro_tunnel_ed25519");
        if (File.Exists(keyPath)) return keyPath;

        string keygen = FindExecutable("ssh-keygen.exe");
        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = keygen;
        psi.Arguments = "-t ed25519 -N \"\" -f \"" + keyPath + "\" -q";
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        using (Process p = Process.Start(psi))
        {
            if (p != null) p.WaitForExit(6000);
        }
        if (!File.Exists(keyPath))
        {
            psi.Arguments = "-t rsa -b 2048 -N \"\" -f \"" + keyPath + "\" -q";
            using (Process p2 = Process.Start(psi))
            {
                if (p2 != null) p2.WaitForExit(8000);
            }
        }
        return keyPath;
    }

    public void CloseTunnel()
    {
        Process procToKill = null;
        lock (_lockObj)
        {
            procToKill = _sshProc;
            _sshProc = null;
            _tunnelUrl = "";
            _tunnelStartedMs = 0;
        }
        if (procToKill != null)
        {
            try
            {
                if (!procToKill.HasExited) procToKill.Kill();
            }
            catch { }
            try { procToKill.Dispose(); } catch { }
        }
    }

    private string EnsureTunnel(out string errMsg)
    {
        errMsg = "";
        lock (_lockObj)
        {
            if (_sshProc != null && !_sshProc.HasExited && !string.IsNullOrEmpty(_tunnelUrl) && (NowMs() - _tunnelStartedMs) < TunnelMaxAgeMs)
            {
                return _tunnelUrl;
            }
        }

        CloseTunnel();

        string sshExe = FindExecutable("ssh.exe");
        if (sshExe.IndexOf('\\') >= 0 && !File.Exists(sshExe))
        {
            errMsg = ErrNoSshMsg;
            return "";
        }

        string keyPath;
        try
        {
            keyPath = EnsureTunnelKey();
        }
        catch (Exception ex)
        {
            errMsg = ErrTunnelMsg + " (" + ex.Message + ")";
            return "";
        }

        string[] hosts = new string[] { "a.pinggy.io", "free.pinggy.io" };
        for (int h = 0; h < hosts.Length; h++)
        {
            string url = TryOpenPinggy(sshExe, keyPath, hosts[h], out errMsg);
            if (!string.IsNullOrEmpty(url)) return url;
        }
        if (string.IsNullOrEmpty(errMsg))
        {
            errMsg = ErrTunnelMsg;
        }
        return "";
    }

    private string TryOpenPinggy(string sshExe, string keyPath, string host, out string errMsg)
    {
        errMsg = "";
        ManualResetEventSlim foundEv = new ManualResetEventSlim(false);
        string foundUrl = "";
        object bufLock = new object();

        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = sshExe;
        psi.Arguments = "-p 443 -i \"" + keyPath + "\" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o BatchMode=yes -o ServerAliveInterval=20 -o ConnectTimeout=8 -T -R 0:127.0.0.1:" + _port.ToString(CultureInfo.InvariantCulture) + " wb@" + host;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.RedirectStandardInput = true;

        Process p = new Process();
        p.StartInfo = psi;
        p.EnableRaisingEvents = true;

        DataReceivedEventHandler handler = delegate(object sender, DataReceivedEventArgs e)
        {
            if (string.IsNullOrEmpty(e.Data)) return;
            string line = AnsiRegex.Replace(e.Data, "");
            lock (bufLock)
            {
                if (string.IsNullOrEmpty(foundUrl))
                {
                    MatchCollection matches = TunnelUrlRegex.Matches(line);
                    for (int i = 0; i < matches.Count; i++)
                    {
                        string u = matches[i].Value.TrimEnd('/');
                        if (u.IndexOf("dashboard.pinggy", StringComparison.OrdinalIgnoreCase) >= 0) continue;
                        foundUrl = u;
                        try { foundEv.Set(); } catch { }
                        break;
                    }
                }
            }
        };

        p.OutputDataReceived += handler;
        p.ErrorDataReceived += handler;

        try
        {
            p.Start();
            try { p.StandardInput.Close(); } catch { }
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
        }
        catch (Exception ex)
        {
            errMsg = ErrNoSshMsg + " (" + ex.Message + ")";
            try { p.Dispose(); } catch { }
            foundEv.Dispose();
            return "";
        }

        bool ok = foundEv.Wait(10000);
        foundEv.Dispose();
        if (ok && !string.IsNullOrEmpty(foundUrl) && !p.HasExited)
        {
            lock (_lockObj)
            {
                _sshProc = p;
                _tunnelUrl = foundUrl;
                _tunnelStartedMs = NowMs();
            }
            return foundUrl;
        }

        try { if (!p.HasExited) p.Kill(); } catch { }
        try { p.Dispose(); } catch { }
        errMsg = ErrTunnelMsg;
        return "";
    }

    private void AcceptLoop()
    {
        while (_running)
        {
            TcpClient client = null;
            try
            {
                client = _listener.AcceptTcpClient();
            }
            catch
            {
                if (!_running) break;
                continue;
            }
            ThreadPool.QueueUserWorkItem(HandleClient, client);
        }
    }

    private void HandleClient(object state)
    {
        TcpClient client = (TcpClient)state;
        NetworkStream ns = null;
        bool handedOffToWs = false;
        try
        {
            client.ReceiveTimeout = 15000;
            client.SendTimeout = 15000;
            ns = client.GetStream();
            ProcessHttpRequest(client, ns, out handedOffToWs);
        }
        catch { }
        finally
        {
            if (!handedOffToWs)
            {
                if (ns != null) { try { ns.Dispose(); } catch { } }
                try { client.Close(); } catch { }
            }
        }
    }

    private void ProcessHttpRequest(TcpClient client, NetworkStream ns, out bool handedOffToWs)
    {
        handedOffToWs = false;
        MemoryStream headerMs = new MemoryStream();
        byte[] tmp = new byte[4096];
        int headerEnd = -1;
        while (headerMs.Length < 65536)
        {
            int n = ns.Read(tmp, 0, tmp.Length);
            if (n <= 0) return;
            headerMs.Write(tmp, 0, n);
            byte[] cur = headerMs.ToArray();
            headerEnd = FindHeaderEnd(cur);
            if (headerEnd >= 0) break;
        }
        if (headerEnd < 0) return;

        byte[] allInitial = headerMs.ToArray();
        string headerStr = Encoding.ASCII.GetString(allInitial, 0, headerEnd);
        string[] lines = headerStr.Split(new string[] { "\r\n" }, StringSplitOptions.None);
        if (lines.Length == 0) return;

        string[] reqParts = lines[0].Split(' ');
        if (reqParts.Length < 2) return;
        string method = reqParts[0].ToUpperInvariant();
        string rawTarget = reqParts[1];

        int contentLength = 0;
        string wsKey = "";
        string upgradeHdr = "";
        string acceptEncoding = "";
        string ifNoneMatch = "";
        for (int i = 1; i < lines.Length; i++)
        {
            int idx = lines[i].IndexOf(':');
            if (idx <= 0) continue;
            string k = lines[i].Substring(0, idx).Trim();
            string v = lines[i].Substring(idx + 1).Trim();
            if (string.Equals(k, "Content-Length", StringComparison.OrdinalIgnoreCase))
            {
                int parsedLen;
                if (int.TryParse(v, out parsedLen) && parsedLen > 0) contentLength = parsedLen;
            }
            else if (string.Equals(k, "Sec-WebSocket-Key", StringComparison.OrdinalIgnoreCase))
            {
                wsKey = v;
            }
            else if (string.Equals(k, "Upgrade", StringComparison.OrdinalIgnoreCase))
            {
                upgradeHdr = v;
            }
            else if (string.Equals(k, "Accept-Encoding", StringComparison.OrdinalIgnoreCase))
            {
                acceptEncoding = v;
            }
            else if (string.Equals(k, "If-None-Match", StringComparison.OrdinalIgnoreCase))
            {
                ifNoneMatch = v;
            }
        }
        bool acceptsGzip = acceptEncoding.IndexOf("gzip", StringComparison.OrdinalIgnoreCase) >= 0;

        string pathPart = rawTarget;
        string queryPart = "";
        int qIdx = rawTarget.IndexOf('?');
        if (qIdx >= 0)
        {
            pathPart = rawTarget.Substring(0, qIdx);
            queryPart = rawTarget.Substring(qIdx + 1);
        }

        if (method == "GET" && pathPart == "/ws" && !string.IsNullOrEmpty(wsKey) && upgradeHdr.IndexOf("websocket", StringComparison.OrdinalIgnoreCase) >= 0)
        {
            handedOffToWs = HandleWebSocketUpgrade(client, ns, queryPart, wsKey);
            return;
        }

        if (contentLength > 26 * 1024 * 1024)
        {
            SendJson(ns, 413, "{\"ok\":false,\"error\":\"payload_too_large\"}");
            return;
        }

        byte[] bodyBytes = new byte[contentLength];
        int bodyStart = headerEnd + 4;
        int alreadyHave = allInitial.Length - bodyStart;
        if (alreadyHave > 0)
        {
            int copyLen = Math.Min(alreadyHave, contentLength);
            Buffer.BlockCopy(allInitial, bodyStart, bodyBytes, 0, copyLen);
            int offset = copyLen;
            while (offset < contentLength)
            {
                int n = ns.Read(bodyBytes, offset, contentLength - offset);
                if (n <= 0) break;
                offset += n;
            }
        }
        else if (contentLength > 0)
        {
            int offset = 0;
            while (offset < contentLength)
            {
                int n = ns.Read(bodyBytes, offset, contentLength - offset);
                if (n <= 0) break;
                offset += n;
            }
        }

        string bodyText = contentLength > 0 ? Encoding.UTF8.GetString(bodyBytes) : "";

        if (method == "OPTIONS")
        {
            SendBytes(ns, 204, "text/plain", new byte[0], true);
            return;
        }

        if (method == "GET" && pathPart == "/api/config")
        {
            string tUrl;
            bool tAct;
            lock (_lockObj)
            {
                tAct = (_sshProc != null && !_sshProc.HasExited && !string.IsNullOrEmpty(_tunnelUrl));
                tUrl = tAct ? _tunnelUrl : "";
            }
            string json = "{\"publicBaseUrl\":\"http://127.0.0.1:" + _port + "\",\"isPublicInternet\":false,\"isAiStudioPreview\":false,\"supportsWs\":true,\"tempTunnelActive\":" + (tAct ? "true" : "false") + ",\"tempTunnelUrl\":\"" + JsonEscape(tUrl) + "\"}";
            SendJson(ns, 200, json);
            return;
        }

        if (method == "POST" && pathPart == "/api/temp-link")
        {
            bool forceNew = ExtractJsonBool(bodyText, "forceNew", false);
            string reqId = forceNew ? "" : SanitizeRoomId(ExtractJsonString(bodyText, "roomId"));
            string roomId = string.IsNullOrEmpty(reqId) ? GenerateRoomId() : reqId;

            lock (_lockObj)
            {
                RoomData r;
                if (!_rooms.TryGetValue(roomId, out r))
                {
                    r = new RoomData();
                    r.RoomId = roomId;
                    _rooms[roomId] = r;
                }
                r.RawJson = string.IsNullOrEmpty(bodyText) ? "{}" : bodyText;
                r.AccessOpen = true;
                r.ClosingSinceMs = 0;
                r.TeacherLastSeenMs = NowMs();
            }

            string errMsg;
            string tunnelBase = EnsureTunnel(out errMsg);
            if (string.IsNullOrEmpty(tunnelBase))
            {
                SendJson(ns, 503, "{\"ok\":false,\"error\":\"tunnel_unavailable\",\"message\":\"" + JsonEscape(errMsg) + "\"}");
                return;
            }

            string inviteUrl = tunnelBase + "/shared/" + Uri.EscapeDataString(roomId);
            string resp = "{\"ok\":true,\"roomId\":\"" + JsonEscape(roomId) + "\",\"url\":\"" + JsonEscape(inviteUrl) + "\",\"baseUrl\":\"" + JsonEscape(tunnelBase) + "\",\"provider\":\"pinggy-443\",\"isTunnel\":true,\"accessOpen\":true,\"expiresWhenTeacherLeaves\":true}";
            SendJson(ns, 200, resp);
            return;
        }

        if (method == "POST" && pathPart == "/api/temp-link/heartbeat")
        {
            string roomId = SanitizeRoomId(ExtractJsonString(bodyText, "roomId"));
            if (string.IsNullOrEmpty(roomId))
            {
                SendJson(ns, 400, "{\"ok\":false,\"error\":\"invalid_room_id\"}");
                return;
            }
            bool closed = false;
            lock (_lockObj)
            {
                RoomData r;
                if (_rooms.TryGetValue(roomId, out r) && !r.AccessOpen)
                {
                    closed = true;
                }
                else
                {
                    if (r == null)
                    {
                        r = new RoomData();
                        r.RoomId = roomId;
                        r.RawJson = "{}";
                        _rooms[roomId] = r;
                    }
                    r.AccessOpen = true;
                    r.ClosingSinceMs = 0;
                    r.TeacherLastSeenMs = NowMs();
                }
            }
            if (closed)
            {
                SendJson(ns, 200, "{\"ok\":true,\"active\":false}");
                return;
            }
            string errMsg;
            string tunnelBase = EnsureTunnel(out errMsg);
            string fullUrl = string.IsNullOrEmpty(tunnelBase) ? "" : (tunnelBase + "/shared/" + Uri.EscapeDataString(roomId));
            SendJson(ns, 200, "{\"ok\":true,\"active\":true,\"roomId\":\"" + JsonEscape(roomId) + "\",\"url\":\"" + JsonEscape(fullUrl) + "\"}");
            return;
        }

        if (method == "POST" && pathPart == "/api/temp-link/close")
        {
            string roomId = SanitizeRoomId(ExtractJsonString(bodyText, "roomId"));
            bool immediate = ExtractJsonBool(bodyText, "immediate", false);
            bool killTunnel = false;
            if (!string.IsNullOrEmpty(roomId))
            {
                lock (_lockObj)
                {
                    RoomData r;
                    if (_rooms.TryGetValue(roomId, out r))
                    {
                        if (immediate)
                        {
                            r.AccessOpen = false;
                            r.ClosingSinceMs = 0;
                            r.TeacherLastSeenMs = 0;
                            if (!HasAnyActiveTeacherLocked(NowMs())) killTunnel = true;
                        }
                        else
                        {
                            r.ClosingSinceMs = NowMs();
                        }
                    }
                }
            }
            if (immediate && !string.IsNullOrEmpty(roomId))
            {
                string leftJson = "{\"type\":\"teacher_left\",\"senderId\":\"server\",\"message\":\"" + JsonEscape(TeacherLeftMsg) + "\"}";
                BroadcastWsText(roomId, Encoding.UTF8.GetBytes(leftJson), null);
                DisconnectStudentsInRoom(roomId);
            }
            if (killTunnel) CloseTunnel();
            SendJson(ns, 200, "{\"ok\":true}");
            return;
        }

        if (method == "POST" && pathPart == "/api/rooms")
        {
            string reqId = SanitizeRoomId(ExtractJsonString(bodyText, "roomId"));
            string roomId = string.IsNullOrEmpty(reqId) ? GenerateRoomId() : reqId;
            lock (_lockObj)
            {
                RoomData r;
                if (!_rooms.TryGetValue(roomId, out r))
                {
                    r = new RoomData();
                    r.RoomId = roomId;
                    _rooms[roomId] = r;
                }
                r.RawJson = string.IsNullOrEmpty(bodyText) ? "{}" : bodyText;
                r.AccessOpen = ExtractJsonBool(bodyText, "accessOpen", true);
                r.TeacherLastSeenMs = NowMs();
                r.ClosingSinceMs = 0;
            }
            SendJson(ns, 200, "{\"ok\":true,\"roomId\":\"" + JsonEscape(roomId) + "\",\"accessOpen\":true}");
            return;
        }

        if (pathPart.StartsWith("/api/rooms/", StringComparison.OrdinalIgnoreCase))
        {
            string rawId = Uri.UnescapeDataString(pathPart.Substring("/api/rooms/".Length));
            string roomId = SanitizeRoomId(rawId);
            if (string.IsNullOrEmpty(roomId))
            {
                SendJson(ns, 400, "{\"ok\":false,\"error\":\"invalid_room_id\"}");
                return;
            }
            if (method == "PUT")
            {
                lock (_lockObj)
                {
                    RoomData r;
                    if (!_rooms.TryGetValue(roomId, out r))
                    {
                        r = new RoomData();
                        r.RoomId = roomId;
                        _rooms[roomId] = r;
                    }
                    r.RawJson = string.IsNullOrEmpty(bodyText) ? r.RawJson : bodyText;
                    r.AccessOpen = ExtractJsonBool(bodyText, "accessOpen", r.AccessOpen);
                    if (r.AccessOpen) r.TeacherLastSeenMs = NowMs();
                }
                SendJson(ns, 200, "{\"ok\":true,\"roomId\":\"" + JsonEscape(roomId) + "\"}");
                return;
            }
            if (method == "GET")
            {
                bool isStudent = queryPart.IndexOf("role=student", StringComparison.OrdinalIgnoreCase) >= 0;
                RoomData found = null;
                bool live = false;
                bool accessOpen = false;
                lock (_lockObj)
                {
                    if (_rooms.TryGetValue(roomId, out found))
                    {
                        accessOpen = found.AccessOpen;
                        live = IsRoomLiveLocked(found, NowMs());
                    }
                }
                if (found == null)
                {
                    SendJson(ns, 404, "{\"ok\":false,\"error\":\"not_found\"}");
                    return;
                }
                if (isStudent && (!accessOpen || !live))
                {
                    SendJson(ns, 403, "{\"ok\":false,\"error\":\"teacher_offline\",\"message\":\"" + JsonEscape(TeacherLeftMsg) + "\"}");
                    return;
                }
                string roomJson = string.IsNullOrEmpty(found.RawJson) ? "{}" : found.RawJson;
                SendJson(ns, 200, "{\"ok\":true,\"room\":" + roomJson + ",\"peersCount\":1}");
                return;
            }
        }

        if (method == "GET" && (pathPart == "/" || pathPart.StartsWith("/shared/", StringComparison.OrdinalIgnoreCase) || pathPart.StartsWith("/room/", StringComparison.OrdinalIgnoreCase)))
        {
            string indexPath = Path.Combine(_rootDir, "index.html");
            if (!File.Exists(indexPath))
            {
                SendJson(ns, 404, "{\"error\":\"index_missing\"}");
                return;
            }
            CachedStaticEntry entry = GetOrLoadStaticEntry(indexPath, true);
            if (entry == null)
            {
                SendJson(ns, 404, "{\"error\":\"index_missing\"}");
                return;
            }
            SendStaticEntry(ns, entry, acceptsGzip, ifNoneMatch, "no-cache");
            return;
        }

        if (method == "GET")
        {
            string relNorm = ResolveSafeStaticRel(pathPart);
            if (string.IsNullOrEmpty(relNorm))
            {
                SendJson(ns, 404, "{\"error\":\"not_found\"}");
                return;
            }
            string relOs = relNorm.Replace('/', Path.DirectorySeparatorChar);
            string full = Path.GetFullPath(Path.Combine(_rootDir, relOs));
            if (!full.StartsWith(_rootDirWithSep, StringComparison.OrdinalIgnoreCase) || !File.Exists(full))
            {
                SendJson(ns, 404, "{\"error\":\"not_found\"}");
                return;
            }
            CachedStaticEntry entry = GetOrLoadStaticEntry(full, false);
            if (entry == null)
            {
                SendJson(ns, 404, "{\"error\":\"not_found\"}");
                return;
            }
            bool hasVersion = !string.IsNullOrEmpty(ExtractQueryParam(queryPart, "v"));
            string cacheControl = hasVersion ? "public, max-age=31536000, immutable" : "public, max-age=3600";
            SendStaticEntry(ns, entry, acceptsGzip, ifNoneMatch, cacheControl);
            return;
        }

        SendJson(ns, 404, "{\"error\":\"not_found\"}");
    }

    private static string ResolveSafeStaticRel(string rawPath)
    {
        if (string.IsNullOrEmpty(rawPath)) return "";
        string decoded;
        try { decoded = Uri.UnescapeDataString(rawPath); }
        catch { return ""; }
        string trimmed = decoded.TrimStart('/');
        if (string.IsNullOrEmpty(trimmed) || trimmed.IndexOf('\\') >= 0 || trimmed.IndexOf('\0') >= 0) return "";
        string[] segs = trimmed.Split('/');
        for (int i = 0; i < segs.Length; i++)
        {
            string s = segs[i];
            if (string.IsNullOrEmpty(s) || s == "." || s == ".." || s.StartsWith(".")) return "";
        }
        string norm = string.Join("/", segs);
        if (string.Equals(norm, "favicon.ico", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(norm, "favicon.svg", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(norm, "manifest.json", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(norm, "robots.txt", StringComparison.OrdinalIgnoreCase))
        {
            return norm;
        }
        if (norm.StartsWith("css/", StringComparison.OrdinalIgnoreCase) ||
            norm.StartsWith("js/", StringComparison.OrdinalIgnoreCase) ||
            norm.StartsWith("assets/", StringComparison.OrdinalIgnoreCase) ||
            norm.StartsWith("fonts/", StringComparison.OrdinalIgnoreCase) ||
            norm.StartsWith("icons/", StringComparison.OrdinalIgnoreCase) ||
            norm.StartsWith("images/", StringComparison.OrdinalIgnoreCase))
        {
            return norm;
        }
        return "";
    }

    private static bool IsCompressibleExt(string filePath)
    {
        string ext = Path.GetExtension(filePath).ToLowerInvariant();
        return ext == ".html" || ext == ".htm" || ext == ".css" || ext == ".js" || ext == ".mjs" || ext == ".json" || ext == ".svg" || ext == ".txt";
    }

    private static byte[] GzipBytes(byte[] raw)
    {
        using (MemoryStream ms = new MemoryStream())
        {
            using (GZipStream gz = new GZipStream(ms, CompressionMode.Compress, true))
            {
                gz.Write(raw, 0, raw.Length);
            }
            return ms.ToArray();
        }
    }

    private CachedStaticEntry GetOrLoadStaticEntry(string fullPath, bool injectBaseTag)
    {
        FileInfo fi;
        try
        {
            fi = new FileInfo(fullPath);
            if (!fi.Exists) return null;
        }
        catch
        {
            return null;
        }

        string key = fullPath + (injectBaseTag ? ":base" : ":raw");
        long ticks = fi.LastWriteTimeUtc.Ticks;
        long len = fi.Length;

        lock (_staticCacheLock)
        {
            CachedStaticEntry existing;
            if (_staticCache.TryGetValue(key, out existing) && existing.LastWriteTicks == ticks && existing.RawLength == len)
            {
                return existing;
            }
        }

        byte[] raw;
        if (injectBaseTag)
        {
            string html = File.ReadAllText(fullPath, Encoding.UTF8);
            if (html.IndexOf("<base ", StringComparison.OrdinalIgnoreCase) < 0)
            {
                html = HeadTagRegex.Replace(html, "<head$1>\n  <base href=\"/\">", 1);
            }
            raw = Encoding.UTF8.GetBytes(html);
        }
        else
        {
            raw = File.ReadAllBytes(fullPath);
        }

        byte[] gz = (IsCompressibleExt(fullPath) && raw.Length >= 256) ? GzipBytes(raw) : null;
        CachedStaticEntry entry = new CachedStaticEntry();
        entry.LastWriteTicks = ticks;
        entry.RawLength = len;
        entry.ETag = "W/\"" + raw.Length.ToString("x") + "-" + ticks.ToString("x") + "\"";
        entry.Mime = GetMimeType(fullPath);
        entry.Raw = raw;
        entry.Gzip = gz;

        lock (_staticCacheLock)
        {
            if (_staticCache.Count >= MaxStaticCacheEntries)
            {
                _staticCache.Clear();
            }
            _staticCache[key] = entry;
        }
        return entry;
    }

    private static bool EtagMatches(string ifNoneMatch, string currentEtag)
    {
        if (string.IsNullOrEmpty(ifNoneMatch) || string.IsNullOrEmpty(currentEtag)) return false;
        string trimmed = ifNoneMatch.Trim();
        if (trimmed == "*") return true;
        string normCur = currentEtag.StartsWith("W/", StringComparison.OrdinalIgnoreCase) ? currentEtag.Substring(2) : currentEtag;
        string[] parts = trimmed.Split(',');
        for (int i = 0; i < parts.Length; i++)
        {
            string p = parts[i].Trim();
            if (p.StartsWith("W/", StringComparison.OrdinalIgnoreCase)) p = p.Substring(2);
            if (string.Equals(p, normCur, StringComparison.Ordinal)) return true;
        }
        return false;
    }

    private static void SendStaticEntry(NetworkStream ns, CachedStaticEntry entry, bool acceptsGzip, string ifNoneMatch, string cacheControl)
    {
        if (EtagMatches(ifNoneMatch, entry.ETag))
        {
            StringBuilder sb304 = new StringBuilder();
            sb304.Append("HTTP/1.1 304 Not Modified\r\n");
            sb304.Append("ETag: ").Append(entry.ETag).Append("\r\n");
            sb304.Append("Cache-Control: ").Append(cacheControl).Append("\r\n");
            if (entry.Gzip != null) sb304.Append("Vary: Accept-Encoding\r\n");
            sb304.Append("Connection: close\r\n\r\n");
            byte[] hdr304 = Encoding.ASCII.GetBytes(sb304.ToString());
            ns.Write(hdr304, 0, hdr304.Length);
            ns.Flush();
            return;
        }

        bool useGzip = acceptsGzip && entry.Gzip != null;
        byte[] payload = useGzip ? entry.Gzip : entry.Raw;
        StringBuilder sb = new StringBuilder();
        sb.Append("HTTP/1.1 200 OK\r\n");
        sb.Append("Content-Type: ").Append(entry.Mime).Append("\r\n");
        sb.Append("Content-Length: ").Append(payload.Length).Append("\r\n");
        sb.Append("Cache-Control: ").Append(cacheControl).Append("\r\n");
        sb.Append("ETag: ").Append(entry.ETag).Append("\r\n");
        if (entry.Gzip != null) sb.Append("Vary: Accept-Encoding\r\n");
        if (useGzip) sb.Append("Content-Encoding: gzip\r\n");
        sb.Append("Connection: close\r\n\r\n");
        byte[] hdr = Encoding.ASCII.GetBytes(sb.ToString());
        ns.Write(hdr, 0, hdr.Length);
        if (payload.Length > 0) ns.Write(payload, 0, payload.Length);
        ns.Flush();
    }

    private static int FindHeaderEnd(byte[] buf)
    {
        for (int i = 0; i <= buf.Length - 4; i++)
        {
            if (buf[i] == 13 && buf[i + 1] == 10 && buf[i + 2] == 13 && buf[i + 3] == 10)
            {
                return i;
            }
        }
        return -1;
    }

    private static string GetMimeType(string filePath)
    {
        string ext = Path.GetExtension(filePath).ToLowerInvariant();
        if (ext == ".html" || ext == ".htm") return "text/html; charset=utf-8";
        if (ext == ".css") return "text/css; charset=utf-8";
        if (ext == ".js" || ext == ".mjs") return "application/javascript; charset=utf-8";
        if (ext == ".json") return "application/json; charset=utf-8";
        if (ext == ".svg") return "image/svg+xml";
        if (ext == ".png") return "image/png";
        if (ext == ".jpg" || ext == ".jpeg") return "image/jpeg";
        if (ext == ".webp") return "image/webp";
        if (ext == ".ico") return "image/x-icon";
        if (ext == ".woff2") return "font/woff2";
        return "application/octet-stream";
    }

    private static void SendJson(NetworkStream ns, int code, string json)
    {
        SendBytes(ns, code, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json), true);
    }

    private static void SendBytes(NetworkStream ns, int code, string contentType, byte[] body, bool cors)
    {
        string reason = code == 200 ? "OK" : code == 204 ? "No Content" : code == 304 ? "Not Modified" : code == 400 ? "Bad Request" : code == 403 ? "Forbidden" : code == 404 ? "Not Found" : code == 413 ? "Payload Too Large" : "Service Unavailable";
        StringBuilder sb = new StringBuilder();
        sb.Append("HTTP/1.1 ").Append(code).Append(' ').Append(reason).Append("\r\n");
        sb.Append("Content-Type: ").Append(contentType).Append("\r\n");
        sb.Append("Content-Length: ").Append(body.Length).Append("\r\n");
        sb.Append("Cache-Control: no-store\r\n");
        sb.Append("Connection: close\r\n");
        if (cors)
        {
            sb.Append("Access-Control-Allow-Origin: *\r\n");
            sb.Append("Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS\r\n");
            sb.Append("Access-Control-Allow-Headers: Content-Type\r\n");
        }
        sb.Append("\r\n");
        byte[] hdr = Encoding.ASCII.GetBytes(sb.ToString());
        ns.Write(hdr, 0, hdr.Length);
        if (body.Length > 0) ns.Write(body, 0, body.Length);
        ns.Flush();
    }

    private static string ExtractQueryParam(string query, string key)
    {
        if (string.IsNullOrEmpty(query)) return "";
        string[] parts = query.Split('&');
        for (int i = 0; i < parts.Length; i++)
        {
            string part = parts[i];
            int eq = part.IndexOf('=');
            string k = eq >= 0 ? part.Substring(0, eq) : part;
            if (string.Equals(k, key, StringComparison.OrdinalIgnoreCase))
            {
                string val = eq >= 0 ? part.Substring(eq + 1) : "";
                try { return Uri.UnescapeDataString(val.Replace('+', ' ')); }
                catch { return val; }
            }
        }
        return "";
    }

    private bool HandleWebSocketUpgrade(TcpClient client, NetworkStream ns, string queryPart, string wsKey)
    {
        string roomId = SanitizeRoomId(ExtractQueryParam(queryPart, "room"));
        string role = string.Equals(ExtractQueryParam(queryPart, "role"), "student", StringComparison.OrdinalIgnoreCase) ? "student" : "teacher";
        if (string.IsNullOrEmpty(roomId))
        {
            SendJson(ns, 400, "{\"ok\":false,\"error\":\"invalid_room_id\"}");
            return false;
        }

        if (role == "student")
        {
            bool closed = false;
            lock (_lockObj)
            {
                RoomData rd;
                if (_rooms.TryGetValue(roomId, out rd) && (!rd.AccessOpen || !IsRoomLiveLocked(rd, NowMs())))
                {
                    closed = true;
                }
            }
            if (closed)
            {
                SendJson(ns, 403, "{\"ok\":false,\"error\":\"room_closed\"}");
                return false;
            }
        }

        string acceptKey;
        using (SHA1 sha1 = SHA1.Create())
        {
            byte[] hash = sha1.ComputeHash(Encoding.ASCII.GetBytes(wsKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"));
            acceptKey = Convert.ToBase64String(hash);
        }

        StringBuilder sb = new StringBuilder();
        sb.Append("HTTP/1.1 101 Switching Protocols\r\n");
        sb.Append("Upgrade: websocket\r\n");
        sb.Append("Connection: Upgrade\r\n");
        sb.Append("Sec-WebSocket-Accept: ").Append(acceptKey).Append("\r\n\r\n");
        byte[] respBytes = Encoding.ASCII.GetBytes(sb.ToString());
        ns.Write(respBytes, 0, respBytes.Length);
        ns.Flush();

        client.NoDelay = true;
        client.ReceiveTimeout = 35000;
        client.SendTimeout = 5000;

        long now = NowMs();
        WsPeer peer = new WsPeer();
        peer.Client = client;
        peer.Stream = ns;
        peer.RoomId = roomId;
        peer.Role = role;
        peer.SenderId = "";
        peer.Closed = false;
        peer.LastActivityMs = now;
        peer.LastPingSentMs = now;
        peer.AwaitingPong = false;

        lock (_lockObj)
        {
            List<WsPeer> list;
            if (!_wsRooms.TryGetValue(roomId, out list))
            {
                list = new List<WsPeer>();
                _wsRooms[roomId] = list;
            }
            list.Add(peer);
            if (role == "teacher")
            {
                RoomData rd;
                if (_rooms.TryGetValue(roomId, out rd))
                {
                    rd.TeacherLastSeenMs = now;
                    rd.ClosingSinceMs = 0;
                }
            }
        }

        // Dedicated background threads per WebSocket peer so ThreadPool is never starved
        // and slow/sleeping tablets never block broadcast to other participants
        Thread writerThread = new Thread(WsWriteLoop);
        writerThread.IsBackground = true;
        writerThread.Start(peer);

        Thread readerThread = new Thread(WsReadLoop);
        readerThread.IsBackground = true;
        readerThread.Start(peer);

        return true;
    }

    private void WsWriteLoop(object state)
    {
        WsPeer peer = (WsPeer)state;
        try
        {
            while (_running && !peer.Closed)
            {
                byte[] frame = null;
                lock (peer.QueueLock)
                {
                    while (peer.SendQueue.Count == 0 && !peer.Closed && _running)
                    {
                        Monitor.Wait(peer.QueueLock, 5000);
                    }
                    if (peer.Closed || !_running) break;
                    if (peer.SendQueue.Count > 0)
                    {
                        frame = peer.SendQueue.Dequeue();
                        peer.QueuedBytes -= frame.Length;
                        if (peer.QueuedBytes < 0) peer.QueuedBytes = 0;
                    }
                }
                if (frame != null)
                {
                    peer.Stream.Write(frame, 0, frame.Length);
                }
            }
        }
        catch
        {
            CloseWsPeer(peer);
        }
    }

    private void WsReadLoop(object state)
    {
        WsPeer peer = (WsPeer)state;
        NetworkStream ns = peer.Stream;
        string roomId = peer.RoomId;
        try
        {
            MemoryStream fragMs = null;
            int fragOpcode = 0;
            while (_running && !peer.Closed)
            {
                int b0;
                try
                {
                    b0 = ns.ReadByte();
                }
                catch (IOException ioEx)
                {
                    SocketException sockEx = ioEx.InnerException as SocketException;
                    if (sockEx != null && sockEx.SocketErrorCode == SocketError.TimedOut)
                    {
                        if ((NowMs() - Interlocked.Read(ref peer.LastActivityMs)) > WsDeadTimeoutMs)
                        {
                            break;
                        }
                        continue;
                    }
                    break;
                }
                if (b0 < 0) break;
                int b1 = ns.ReadByte();
                if (b1 < 0) break;

                bool fin = (b0 & 0x80) != 0;
                int opcode = b0 & 0x0F;
                bool masked = (b1 & 0x80) != 0;
                long payloadLen = b1 & 0x7F;

                if (payloadLen == 126)
                {
                    byte[] ext = ReadExactBytes(ns, 2);
                    if (ext == null) break;
                    payloadLen = ((long)ext[0] << 8) | (long)ext[1];
                }
                else if (payloadLen == 127)
                {
                    byte[] ext = ReadExactBytes(ns, 8);
                    if (ext == null) break;
                    payloadLen = 0;
                    for (int i = 0; i < 8; i++)
                    {
                        payloadLen = (payloadLen << 8) | (long)ext[i];
                    }
                }

                if (payloadLen < 0 || payloadLen > 16L * 1024L * 1024L) break;

                byte[] maskKey = null;
                if (masked)
                {
                    maskKey = ReadExactBytes(ns, 4);
                    if (maskKey == null) break;
                }

                byte[] payload = payloadLen > 0 ? ReadExactBytes(ns, (int)payloadLen) : new byte[0];
                if (payload == null) break;

                if (masked && maskKey != null)
                {
                    for (int i = 0; i < payload.Length; i++)
                    {
                        payload[i] = (byte)(payload[i] ^ maskKey[i & 3]);
                    }
                }

                Interlocked.Exchange(ref peer.LastActivityMs, NowMs());
                peer.AwaitingPong = false;

                if (opcode == 8)
                {
                    EnqueueWsFrame(peer, BuildWsFrame(8, new byte[0]), false);
                    break;
                }
                if (opcode == 9)
                {
                    EnqueueWsFrame(peer, BuildWsFrame(10, payload), true);
                    continue;
                }
                if (opcode == 10)
                {
                    continue;
                }

                if (opcode == 1 || opcode == 2)
                {
                    if (fin)
                    {
                        if (opcode == 1) HandleWsTextMessage(peer, payload);
                    }
                    else
                    {
                        fragOpcode = opcode;
                        fragMs = new MemoryStream();
                        fragMs.Write(payload, 0, payload.Length);
                    }
                }
                else if (opcode == 0 && fragMs != null)
                {
                    fragMs.Write(payload, 0, payload.Length);
                    if (fragMs.Length > 16L * 1024L * 1024L) break;
                    if (fin)
                    {
                        byte[] combined = fragMs.ToArray();
                        fragMs.Dispose();
                        fragMs = null;
                        if (fragOpcode == 1) HandleWsTextMessage(peer, combined);
                    }
                }
            }
            if (fragMs != null) fragMs.Dispose();
        }
        catch { }
        finally
        {
            CloseWsPeer(peer);
            lock (_lockObj)
            {
                List<WsPeer> list;
                if (_wsRooms.TryGetValue(roomId, out list))
                {
                    list.Remove(peer);
                    if (list.Count == 0) _wsRooms.Remove(roomId);
                }
            }
            if (!string.IsNullOrEmpty(peer.SenderId))
            {
                string leftMsg = "{\"type\":\"peer_left\",\"senderId\":\"" + JsonEscape(peer.SenderId) + "\"}";
                BroadcastWsText(roomId, Encoding.UTF8.GetBytes(leftMsg), peer);
            }
            try { ns.Dispose(); } catch { }
            try { peer.Client.Close(); } catch { }
        }
    }

    private static bool IsTransientMsgType(string msgType)
    {
        return msgType == "cursor" || msgType == "stroke_live" || msgType == "peer_view" || msgType == "pdf_laser" || msgType == "pdf_stroke_live";
    }

    private void HandleWsTextMessage(WsPeer peer, byte[] utf8Payload)
    {
        if (utf8Payload == null || utf8Payload.Length == 0) return;
        string text = Encoding.UTF8.GetString(utf8Payload);
        string senderId = ExtractJsonString(text, "senderId");
        if (!string.IsNullOrEmpty(senderId))
        {
            peer.SenderId = senderId;
        }
        if (peer.Role == "teacher")
        {
            lock (_lockObj)
            {
                RoomData rd;
                if (_rooms.TryGetValue(peer.RoomId, out rd) && rd.AccessOpen)
                {
                    rd.TeacherLastSeenMs = NowMs();
                    rd.ClosingSinceMs = 0;
                }
            }
        }

        string msgType = ExtractJsonString(text, "type");
        BroadcastWsText(peer.RoomId, utf8Payload, peer, IsTransientMsgType(msgType));

        if (msgType == "peer_kicked")
        {
            string targetId = ExtractJsonString(text, "targetId");
            if (!string.IsNullOrEmpty(targetId))
            {
                DisconnectPeerBySenderId(peer.RoomId, targetId);
            }
        }
    }

    private static byte[] ReadExactBytes(NetworkStream ns, int count)
    {
        byte[] buf = new byte[count];
        int offset = 0;
        while (offset < count)
        {
            int n = ns.Read(buf, offset, count - offset);
            if (n <= 0) return null;
            offset += n;
        }
        return buf;
    }

    private static byte[] BuildWsFrame(int opcode, byte[] payload)
    {
        int len = payload != null ? payload.Length : 0;
        int hdrLen = len <= 125 ? 2 : (len <= 65535 ? 4 : 10);
        byte[] frame = new byte[hdrLen + len];
        frame[0] = (byte)(0x80 | (opcode & 0x0F));
        if (len <= 125)
        {
            frame[1] = (byte)len;
        }
        else if (len <= 65535)
        {
            frame[1] = 126;
            frame[2] = (byte)((len >> 8) & 0xFF);
            frame[3] = (byte)(len & 0xFF);
        }
        else
        {
            frame[1] = 127;
            long l64 = (long)len;
            for (int i = 0; i < 8; i++)
            {
                frame[2 + i] = (byte)((l64 >> (56 - i * 8)) & 0xFF);
            }
        }
        if (len > 0)
        {
            Buffer.BlockCopy(payload, 0, frame, hdrLen, len);
        }
        return frame;
    }

    private static void EnqueueWsFrame(WsPeer peer, byte[] frame, bool isTransient)
    {
        if (peer == null || peer.Closed || frame == null) return;
        bool shouldClose = false;
        lock (peer.QueueLock)
        {
            if (peer.Closed) return;
            if (isTransient && peer.QueuedBytes >= WsTransientQueueLimitBytes)
            {
                return;
            }
            if (peer.QueuedBytes + frame.Length > WsHardQueueLimitBytes || peer.SendQueue.Count >= WsHardQueueLimitFrames)
            {
                shouldClose = true;
            }
            else
            {
                peer.SendQueue.Enqueue(frame);
                peer.QueuedBytes += frame.Length;
                Monitor.Pulse(peer.QueueLock);
            }
        }
        if (shouldClose)
        {
            CloseWsPeer(peer);
        }
    }

    private void BroadcastWsText(string roomId, byte[] utf8Payload, WsPeer exclude)
    {
        BroadcastWsText(roomId, utf8Payload, exclude, false);
    }

    private void BroadcastWsText(string roomId, byte[] utf8Payload, WsPeer exclude, bool isTransient)
    {
        List<WsPeer> snapshot = null;
        lock (_lockObj)
        {
            List<WsPeer> list;
            if (_wsRooms.TryGetValue(roomId, out list) && list.Count > 0)
            {
                snapshot = new List<WsPeer>(list);
            }
        }
        if (snapshot == null) return;
        byte[] frame = BuildWsFrame(1, utf8Payload);
        for (int i = 0; i < snapshot.Count; i++)
        {
            WsPeer p = snapshot[i];
            if (p == exclude || p.Closed) continue;
            EnqueueWsFrame(p, frame, isTransient);
        }
    }

    private void DisconnectPeerBySenderId(string roomId, string targetSenderId)
    {
        List<WsPeer> toClose = new List<WsPeer>();
        lock (_lockObj)
        {
            List<WsPeer> list;
            if (_wsRooms.TryGetValue(roomId, out list))
            {
                for (int i = 0; i < list.Count; i++)
                {
                    if (list[i].SenderId == targetSenderId) toClose.Add(list[i]);
                }
            }
        }
        for (int i = 0; i < toClose.Count; i++)
        {
            CloseWsPeer(toClose[i]);
        }
    }

    private void DisconnectStudentsInRoom(string roomId)
    {
        List<WsPeer> toClose = new List<WsPeer>();
        lock (_lockObj)
        {
            List<WsPeer> list;
            if (_wsRooms.TryGetValue(roomId, out list))
            {
                for (int i = 0; i < list.Count; i++)
                {
                    if (list[i].Role == "student") toClose.Add(list[i]);
                }
            }
        }
        for (int i = 0; i < toClose.Count; i++)
        {
            CloseWsPeer(toClose[i]);
        }
    }

    private static void CloseWsPeer(WsPeer peer)
    {
        if (peer == null) return;
        peer.Closed = true;
        lock (peer.QueueLock)
        {
            peer.SendQueue.Clear();
            peer.QueuedBytes = 0;
            Monitor.PulseAll(peer.QueueLock);
        }
        try { peer.Client.Close(); } catch { }
    }
}
'@

Add-Type -TypeDefinition $csharpSource -Language CSharp

$alreadyRunning = $false
try {
    $check = Invoke-WebRequest -Uri "http://127.0.0.1:$StartPort/api/config" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    if ($check.StatusCode -eq 200) {
        $alreadyRunning = $true
    }
} catch { }

if ($alreadyRunning) {
    $url = "http://127.0.0.1:$StartPort"
    Write-Host "Whiteboard Pro is already running at $url - opening browser..." -ForegroundColor Green
    Start-Process $url
    exit 0
}

$server = $null
$boundPort = $StartPort
for ($p = $StartPort; $p -le ($StartPort + 10); $p++) {
    try {
        $srv = New-Object WhiteboardWinServer($RootDir, $p)
        $srv.Start()
        $server = $srv
        $boundPort = $p
        break
    } catch {
        continue
    }
}

if (-not $server) {
    Write-Host "[!] Could not bind any free port ($StartPort..$($StartPort + 10))." -ForegroundColor Red
    exit 1
}

$localUrl = "http://127.0.0.1:$boundPort"
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Whiteboard Pro 6.0 is running (no Node.js required)" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Local: $localUrl"
if ($server.BoundAllInterfaces) {
    try {
        $lanIps = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
            Where-Object { $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and -not [System.Net.IPAddress]::IsLoopback($_) } |
            Select-Object -ExpandProperty IPAddressToString -Unique
        foreach ($ip in $lanIps) {
            Write-Host "  Wi-Fi / LAN: http://${ip}:$boundPort" -ForegroundColor Gray
        }
    } catch { }
}
Write-Host "  Open Share inside the board to get a temporary student link."
Write-Host "  Keep this window open during the lesson."
Write-Host ""

Start-Process $localUrl

try {
    while ($true) {
        Start-Sleep -Seconds 1
    }
} finally {
    if ($server) {
        $server.Stop()
    }
}
