# Antigravity Token Monitor (v0.1.0)

Lightweight, dependency-free VS Code / Antigravity IDE extension providing provenance-first token telemetry, live backend usage metrics, and patch-aware context limit inspection directly in the status bar.

---

## 1. Zero-Estimation Integrity Guarantee

This extension strictly enforces a **Zero-Estimation Policy**:
- **NO `chars / 4` heuristics**
- **NO byte-to-token division**
- **NO extrapolated progress**
- **NO guessed or fabricated "live" numbers**

Every value rendered originates from either:
1. Authoritative instruction immediates read directly from the binary executable (`language_server_windows_x64.exe`), or
2. Authoritative Connect-RPC protocol payloads received from the language server.

If a metric is in-progress, the monitor honestly displays its state as `PENDING` (`⚡ 222.3k+ / 960k | pending`) rather than guessing numbers.

---

## 2. Provenance Taxonomy

Telemetry metrics are grouped into four unambiguous provenance classes:

```text
Class                          Example Value       Source / Authority
-----------------------------------------------------------------------------------------
LIVE OBSERVED                  217,025 tokens      contextWindowMetadata.estimatedTokensUsed
LIVE OBSERVED (Backend Prompt) 62,365 tokens       UsageMetadata (inputTokens + cacheReadTokens)
VERIFIED STATIC CONFIGURATION  1,048,576 tokens    Binary Hard Clamp (0x013aa158 imm32)
VERIFIED STATIC CONFIGURATION  1,000,000 tokens    M318 Runtime Limit (Tail Code Cave)
VERIFIED STATIC CONFIGURATION  960,000 tokens      Checkpoint Threshold (Tail Code Cave)
DERIVED                        960,000 tokens      min((1M - 40k), 960k, 1.048M)
UNAVAILABLE                    -                   Explicitly labeled when omitted
```

---

## 3. Dual-Tier Limit Architecture: Engine Clamp vs. Model Context

Antigravity enforces limits across multiple independent subsystems:

1. **Nominal Model Metadata (`256,000`):**
   Visible over RPC as `contextWindowMetadata.maxContextTokens`. In the patched M318 path, this metadata remains visible but is non-binding.
2. **Patched M318 Runtime Limit (`1,000,000`):**
   Allocated by the patched `ModelInfo` constructor for model key `1318`.
3. **Engine Hard Clamp (`1,048,576`):**
   Enforced by `TrajectoryChatConverter` instruction immediates at `0x013aa158` and `0x013aa15d`.
4. **Checkpoint Eviction Threshold (`960,000`):**
   Enforced by `CheckpointConfig.MaxTokenLimit` to govern local conversation compaction.
5. **Effective Usable Local Budget:**
   $$\text{Effective Budget} = \min\big((1,000,000 - 40,000), 960,000, 1,048,576\big) = 960,000 \text{ tokens}$$

The monitor displays `960k` as the true effective denominator for verified patched M318 sessions.

---

## 4. Status Bar Format & State Machine

| State | Format Example | Meaning |
| :--- | :--- | :--- |
| **`EXACT`** | `⚡ 217k / 960k \| 22.6%` | Last turn completed; exact percentage displayed |
| **`PENDING`** | `⚡ 222.3k+ / 960k \| pending` | Generation turn active; `+` indicates ongoing turn |
| **`STALE_SESSION`** | `⚡ 142.1k+ \| model 256k \| awaiting turn` | LS restarted; awaiting turn under current session |
| **`WAITING`** | `⚡ model 256k \| waiting for turn` | Conversation initialized before first generation |
| **`DISCONNECTED`**| `⚡ Token Monitor: disconnected` | Language server process not found |
| **`AMBIGUOUS`** | `⚡ Token Monitor: select conversation` | Multiple cascades running across workspaces |

---

## 5. Performance & Overhead

- **Zero Continuous Process Scans:** Discovers Language Server PID, port, CSRF token, and process creation time once at startup and caches them. Re-discovery only occurs if connection drops.
- **Zero Binary Polling:** Binary instruction immediates are inspected once at startup; subsequent updates are monitored using native filesystem event notifications (`fs.watch`).
- **Adaptive Telemetry Polling:**
  - `5s` interval while a conversation is running (`CASCADE_RUN_STATUS_RUNNING`)
  - `30s` interval while idle (`CASCADE_RUN_STATUS_IDLE`)
  - `60s` interval when editor window is unfocused
- **Expected CPU Impact:** $< 0.05\%$ idle.
