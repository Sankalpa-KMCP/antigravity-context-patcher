# Antigravity Context Patcher

Version-independent structural scanner, patch planner, and safe promotion workflow for expanding the active context window in Google Antigravity IDE language server (`language_server_windows_x64.exe`).

---

## 1. Project Purpose

The Antigravity Context Patcher safely lifts nominal context limits for target model architectures (specifically `MODEL_PLACEHOLDER_M318` / Gemini 3.8 Flash High) from the default 256k limit to 1M tokens, while simultaneously raising internal engine converter clamps and local checkpoint eviction thresholds to 960k usable tokens.

---

## 2. Core Architecture & Structural Rediscovery

Rather than relying on brittle, hardcoded file offsets that break on IDE updates, this patcher employs version-independent structural analysis across PE32+ sections:

1. **PE32+ Image Parsing (`src/pe-parser.js`):**
   - Directly maps PE headers, section tables (`.text`, `.rdata`), virtual addresses (RVAs), and raw file offsets without external binaries.
2. **Structural Signature Scanning (`src/signature-scanner.js`):**
   - Dissects binary sections with wildcard pattern matching and enforces a strict uniqueness constraint ($N = 1$) to guarantee zero false-positive mutations.
3. **Engine Converter Clamp Handling (`src/converter-scanner.js`):**
   - Identifies the unique semantic clamp calculation:
     $$\text{reserved} = \max(40000, \text{configuredReserve})$$
     $$\text{available} = \text{ModelInfo.MaxTokens} - \text{reserved}$$
     $$\text{converter} = \min(\text{available}, \text{EngineClamp})$$
   - Discovers both the comparison ceiling (`cmp ecx, clamp`) and assignment (`mov edx, clamp`) sites governing `TrajectoryChatConverter`.
4. **M318-Specific ModelInfo Override (`src/model-scanner.js`, `src/patch-planner.js`):**
   - Resolves string descriptors and verifies the `ModelInfo` struct field layout (`+0x14` MaxTokens, `+0x70` ReservedFloor).
   - Injects a dedicated trampoline hook and code cave that specifically targets model key `1318` (`0x0526`), leaving all other models (M316, M317, M319, M320) completely untouched (negative scope proof).
5. **Checkpoint MaxTokenLimit Override (`src/patch-planner.js`):**
   - Hooks `CascadeConfig` initialization to dynamically override private `CheckpointConfig.MaxTokenLimit` from 256,000 to 960,000 for key `1318`.
   - Prevents premature local conversation checkpointing and context truncation during ultra-high-context sessions.

---

## 3. Safety Guarantees & Operational Workflow

- **Fail-Closed Design:** If any pattern or semantic site is missing or matches ambiguously ($N \ne 1$), planning immediately aborts with zero binary modifications.
- **Isolated Staging:** Patches are generated and validated strictly in `staging/` before touching any active installation (`src/create-patched-image.js`).
- **Guarded Apply-on-Exit Daemon (`apply-checkpoint-on-exit.ps1`):**
  - Monitors host processes to verify language server processes have completely exited.
  - Takes an automatic, timestamped SHA-256 backup in `backups/`.
  - Atomically promotes the staged binary and verifies the target hash post-copy.
  - Automatically rolls back to the backup image if any step fails.

---

## 4. Verification & Testing Suite

The automated verification suite (`test/test-checkpoint-staged.js`) enforces:

1. **Production Integrity:** Validates authentic baseline or applied binary hashes.
2. **Byte Isolation:** Proves that exactly 64 bytes are modified across the binary (14 bytes at the trampoline hook, 50 bytes in the tail code cave) with zero collateral mutations.
3. **PE32+ Header Integrity:** Confirms valid section alignment and headers.
4. **Boundary & Displacement Verification:** Mathematically verifies all relative jump targets and returns.
5. **Negative-Scope Static Emulation:** Emulates register and memory flow for model keys 1316 through 1320 to prove only key 1318 triggers the override.

```bash
# Run structural scan and plan derivation (read-only)
npm run scan

# Run complete automated verification test suite
npm test
```

---

## 5. Empirical High-Context Proof

The patched configuration was validated end-to-end under live, continuous model generation:

- **Active Trajectory Tested:** ~882,900 tokens (across 458 steps and 6.82 MB payload).
- **Premature Checkpoint / Eviction:** **None** (threshold of 960,000 tokens was never tripped; no eviction occurred).
- **Collateral Truncation:** **Zero** (all 30 anchor keys verified intact in active context).
- **Maximum Measured Backend Context:** **`720,485` tokens** (peak input prompt: `683,223` tokens; peak cache read: `656,424` tokens).
- **Anchor Retrieval Accuracy:** Successful retrieval of early (`CTX_025K`), middle (`CTX_450K`), and recent (`CTX_875K`/`CTX_900K`) verification keys from the active session.
- **Language Server Stability:** Complete process stability across all Connect-RPC requests with zero crashes or errors.

*(Note: While 720,485 backend tokens and ~882,900 trajectory tokens were empirically verified, a full 1,000,000-token backend request was not claimed or required).*
