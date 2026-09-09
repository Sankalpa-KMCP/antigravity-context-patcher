# Troubleshooting & Diagnostics Guide

This guide addresses common operational issues, diagnostics procedures, and recovery steps for the Antigravity Context Patcher and Token Monitor.

---

## 1. Status Bar Diagnostic States

The Antigravity Token Monitor status bar conveys both operational telemetry and system health:

| Status Bar Display | Cause | Resolution |
| :--- | :--- | :--- |
| `⚡ 222.3k+ / 960k \| pending` | Normal operation during generation | Wait for generation turn to complete. The `+` indicates turn progress. |
| `⚡ 217k / 960k \| 22.6%` | Normal operation after turn completion | None needed; telemetry is exact. |
| `⚡ 217k / 256k \| 84.8%` (Shows 256k denominator) | Extension host is running unpatched or cached extension code | Run **Developer: Restart Extension Host** from VS Code Command Palette. |
| `⚡ 142.1k+ \| model 256k \| awaiting current-session turn` | Language server process recycled; telemetry is from previous session | Submit a message in the conversation to record a turn under the new session. |
| `⚡ Token Monitor: disconnected` | Language server is not running or RPC is unreachable | Ensure Antigravity IDE is open with an active workspace. |
| `⚡ Token Monitor: select conversation` | Multiple conversation cascades are running concurrently | Open an editor tab belonging to the target workspace or click the status bar item to select. |
| `⚡ Token Monitor: error` | Parse or schema error | Inspect the Extension Host Output channel (`Token Monitor` log). |

---

## 2. Common Issues & Solutions

### Issue A: Status Bar Shows "256k" Instead of "960k" for M318
**Cause:**
VS Code / Antigravity IDE caches active extension JavaScript in memory across window focus changes. If the extension files were updated on disk while the editor was running, the running Extension Host process may still be executing the older cached code.

**Resolution:**
1. Open the Command Palette in Antigravity (`Ctrl + Shift + P`).
2. Run command: `Developer: Restart Extension Host`.
3. The extension host will reload in ~2 seconds, re-executing `clamp-inspector.js` and binding the 960k budget.
4. Verify by clicking the status bar item to inspect the diagnostic quick-pick modal.

---

### Issue B: Patch Verifier Reports `VERIFICATION FAILED: HASH MISMATCH`
**Symptoms:**
Running `npm run verify` returns:
```text
Production hash does not match expected 1M+960k checkpoint configuration
```

**Diagnostic Steps:**
1. Check if Antigravity recently auto-updated:
   ```powershell
   Get-Item "D:\Antigravity IDE\resources\app\extensions\antigravity\bin\language_server_windows_x64.exe" | Select-Object LastWriteTime, Length
   ```
2. If an IDE update replaced the binary, run `npm run scan` to confirm that the new binary's structural signatures match.
3. Re-generate the patched image via `node patcher/src/create-patched-image.js`.

---

### Issue C: RPC Connection Timeout or Disconnected State
**Symptoms:**
Status bar shows `⚡ Token Monitor: disconnected` despite Antigravity running.

**Diagnostic Steps:**
1. Check if the language server process is active:
   ```powershell
   Get-Process -Name "language_server_windows_x64"
   ```
2. Verify that the process listening port is detectable:
   - The monitor scans process command-line arguments and TCP listening sockets on `127.0.0.1`.
   - Ensure firewall software is not blocking loopback connections between localhost ports.
3. Check Extension Host logs:
   - Run `Developer: Open Logs Folder` -> `exthost.log` and search for `[AntigravityTokenMonitor]`.

---

### Issue D: Premature Checkpoint Eviction Occurs
**Symptoms:**
Conversation history truncates earlier turns before reaching 960k tokens.

**Diagnostic Steps:**
1. Run `npm run verify` to confirm that **all six patch sites** are active:
   - If Sites 1..4 are present but Sites 5..6 (Checkpoint hook & cave) are missing, the engine has a 1M ceiling but `CheckpointConfig` will evict at 256k.
2. Confirm the model in use is `Gemini 3.8 Flash (High)` (M318 / key `1318`). Non-M318 models intentionally retain default limits to guarantee zero collateral impact.
