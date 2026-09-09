// ls-client.js
// Independent Connect-RPC client for Antigravity Language Server.
// Discovers connection credentials once at activation and reuses cached session.
// Strictly READ-ONLY endpoints:
//   - GetAllCascadeTrajectories
//   - GetCascadeTrajectoryGeneratorMetadata
//   - GetCascadeTrajectorySteps
//   - GetUserStatus

const http = require('http');
const https = require('https');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

class LanguageServerClient {
  constructor() {
    this._cachedSession = null;
    this._isDiscovering = false;
    this._discoveryWaiters = [];
  }

  /**
   * Return currently cached session, or null if not yet connected.
   */
  getSession() {
    return this._cachedSession;
  }

  /**
   * Reset cached credentials forcing re-discovery on next RPC call.
   */
  invalidateSession() {
    this._cachedSession = null;
  }

  /**
   * Discover running Antigravity Language Server on Windows.
   * Caches PID, port, and CSRF token.
   */
  async discoverSession(forceRefresh = false) {
    if (!forceRefresh && this._cachedSession) {
      return this._cachedSession;
    }

    if (this._isDiscovering) {
      return new Promise((resolve, reject) => {
        this._discoveryWaiters.push({ resolve, reject });
      });
    }

    this._isDiscovering = true;
    try {
      const session = await this._performDiscovery();
      this._cachedSession = session;
      for (const w of this._discoveryWaiters) {
        w.resolve(session);
      }
      return session;
    } catch (err) {
      for (const w of this._discoveryWaiters) {
        w.reject(err);
      }
      throw err;
    } finally {
      this._isDiscovering = false;
      this._discoveryWaiters = [];
    }
  }

  async _performDiscovery() {
    // 1. Find language server processes
    const psCmd = `Get-CimInstance Win32_Process -Filter "name like '%language_server%'" | Select-Object ProcessId, CommandLine, CreationDate | ConvertTo-Json -Compress`;
    let procs = [];
    try {
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', psCmd], { timeout: 8000 });
      if (stdout && stdout.trim()) {
        const parsed = JSON.parse(stdout.trim());
        procs = Array.isArray(parsed) ? parsed : [parsed];
      }
    } catch (psErr) {
      // Fallback to wmic if PowerShell failed
      try {
        const { stdout } = await execFileAsync('wmic', ['process', 'where', "name like '%language_server%'", 'get', 'ProcessId,CommandLine,CreationDate', '/format:csv'], { timeout: 8000 });
        const lines = stdout.split(/\r?\n/).filter(l => l.trim());
        for (const line of lines) {
          const parts = line.split(',');
          if (parts.length >= 4 && parts[1] && parts[3]) {
            procs.push({ CommandLine: parts[1], ProcessId: parseInt(parts[3].trim(), 10), CreationDate: parts[2] });
          } else if (parts.length >= 3 && parts[1] && parts[2]) {
            procs.push({ CommandLine: parts[1], ProcessId: parseInt(parts[2].trim(), 10) });
          }
        }
      } catch (wmicErr) {
        throw new Error(`Process discovery failed: ${psErr.message}`);
      }
    }

    if (procs.length === 0) {
      throw new Error('No running Antigravity Language Server process detected');
    }

    // Filter to primary language_server_windows_x64 process with csrf token
    let targetProc = null;
    let csrfToken = null;

    for (const proc of procs) {
      const cmd = proc.CommandLine || '';
      const match = cmd.match(/--csrf_token\s+([A-Za-z0-9_-]+)/i);
      if (match) {
        targetProc = proc;
        csrfToken = match[1];
        break;
      }
    }

    if (!targetProc || !csrfToken) {
      throw new Error('Language Server found but missing --csrf_token argument');
    }

    const pid = targetProc.ProcessId;

    // Parse process creation date if available
    let startTime = null;
    if (targetProc.CreationDate) {
      const dateStr = String(targetProc.CreationDate);
      const matchDate = dateStr.match(/\/Date\((\d+)\)\//);
      if (matchDate) {
        startTime = new Date(parseInt(matchDate[1], 10)).toISOString();
      } else {
        try {
          const d = new Date(dateStr);
          if (!isNaN(d.getTime())) {
            startTime = d.toISOString();
          }
        } catch (_) {}
      }
    }

    // 2. Discover listening TCP port for this PID using netstat
    const { stdout: netstatOut } = await execFileAsync('netstat', ['-ano'], { timeout: 8000 });
    const portRegex = new RegExp(`TCP\\s+(?:127\\.0\\.0\\.1|\\[::1\\]):(\\d+)\\s+.*?LISTENING\\s+${pid}\\b`, 'i');
    const netMatch = netstatOut.match(portRegex);

    if (!netMatch) {
      throw new Error(`Could not identify listening TCP port for Language Server PID ${pid}`);
    }

    const port = parseInt(netMatch[1], 10);

    const session = {
      pid,
      port,
      csrfToken,
      startTime,
      useTls: true, // Antigravity Language Server on Windows enables TLS with self-signed certificate
      discoveredAt: new Date().toISOString()
    };

    return session;
  }

  /**
   * Generic Connect-RPC caller targeting exa.language_server_pb.LanguageServerService.
   */
  async rpcCall(endpoint, body = {}, timeoutMs = 10000, signal = null) {
    const session = await this.discoverSession();

    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        return reject(new Error('RPC request was aborted'));
      }

      const postData = JSON.stringify(body);
      const reqOptions = {
        hostname: '127.0.0.1',
        port: session.port,
        path: `/exa.language_server_pb.LanguageServerService/${endpoint}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1',
          'x-codeium-csrf-token': session.csrfToken,
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: timeoutMs,
        rejectUnauthorized: false
      };

      const transport = session.useTls ? https : http;
      const req = transport.request(reqOptions, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            if (res.statusCode === 401 || res.statusCode === 403) {
              this.invalidateSession();
            }
            return reject(new Error(`RPC ${endpoint} returned HTTP ${res.statusCode}: ${responseData.substring(0, 200)}`));
          }

          try {
            const parsed = JSON.parse(responseData);
            resolve(parsed);
          } catch (jsonErr) {
            reject(new Error(`Failed to parse RPC response from ${endpoint}: ${jsonErr.message}`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`RPC timeout (${timeoutMs}ms) for ${endpoint}`));
      });

      req.on('error', (err) => {
        this.invalidateSession(); // Process may have died or changed ports
        reject(err);
      });

      if (signal) {
        const onAbort = () => {
          req.destroy();
          reject(new Error('RPC request aborted'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        req.on('close', () => {
          signal.removeEventListener('abort', onAbort);
        });
      }

      req.write(postData);
      req.end();
    });
  }

  // ── Specific Read-Only Telemetry Queries ──────────────────────────────────

  /**
   * Fetch all cascade trajectories.
   */
  async getAllCascadeTrajectories(signal = null) {
    const resp = await this.rpcCall('GetAllCascadeTrajectories', {
      metadata: { ideName: 'antigravity', extensionName: 'antigravity' }
    }, 10000, signal);

    const summaries = resp.trajectorySummaries || {};
    const list = [];

    for (const [cascadeId, data] of Object.entries(summaries)) {
      const workspaces = (data.workspaces || []).map(w => w.workspaceFolderAbsoluteUri).filter(Boolean);
      list.push({
        cascadeId,
        trajectoryId: data.trajectoryId || '',
        summary: data.summary || cascadeId,
        stepCount: data.stepCount || 0,
        status: data.status || 'unknown',
        lastModifiedTime: data.lastModifiedTime || '',
        createdTime: data.createdTime || '',
        workspaceUris: workspaces
      });
    }

    // Sort by lastModifiedTime descending
    list.sort((a, b) => (b.lastModifiedTime || '').localeCompare(a.lastModifiedTime || ''));
    return list;
  }

  /**
   * Fetch trajectory generator metadata containing context_window_metadata and model usage.
   */
  async getCascadeTrajectoryGeneratorMetadata(cascadeId, signal = null) {
    return this.rpcCall('GetCascadeTrajectoryGeneratorMetadata', {
      cascadeId,
      metadata: { ideName: 'antigravity', extensionName: 'antigravity' }
    }, 15000, signal);
  }

  /**
   * Fetch trajectory steps for detailed checkpoint and step count auditing.
   */
  async getCascadeTrajectorySteps(cascadeId, startIndex = 0, endIndex = 50, signal = null) {
    return this.rpcCall('GetCascadeTrajectorySteps', {
      cascadeId,
      startIndex,
      endIndex
    }, 15000, signal);
  }

  /**
   * Fetch user status including model configs and quota data.
   */
  async getUserStatus(signal = null) {
    return this.rpcCall('GetUserStatus', {
      metadata: { ideName: 'antigravity', extensionName: 'antigravity' }
    }, 10000, signal);
  }
}

module.exports = {
  LanguageServerClient
};
