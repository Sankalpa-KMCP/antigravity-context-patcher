# Antigravity Context Patcher — Phase 1M-A Scanner

Version-independent structural scanner and 1M patch planner for Google Antigravity IDE language server (`language_server_windows_x64.exe`).

---

## Non-Negotiable Safety & Read-Only Guarantees

- **Zero Binary Writes:** In this phase, this tool operates strictly read-only.
- **Zero Process Interruptions:** Does not kill, restart, or reload the IDE or language server.
- **Zero Configuration Mutation:** Leaves all user settings, workspace settings, and extension files unchanged.
- **Fail-Closed Safety:** If any pattern or semantic site is not found or matches ambiguously (> 1 site), the planner immediately terminates without proposing changes.

---

## Architecture & Structural Rediscovery

Unlike naive offset-based scripts, this scanner does not rely on hardcoded instruction addresses:

1. **PE Parsing (`src/pe-parser.js`):**
   - Dissects 64-bit PE (PE32+) headers to map `.text` and `.rdata` virtual addresses and raw file pointers.
2. **Structural Converter Discovery (`src/converter-scanner.js`):**
   - Locates the unique semantic calculation:
     $$\text{reserved} = \max(40000, \text{configuredReserve})$$
     $$\text{available} = \text{ModelInfo.MaxTokens} - \text{reserved}$$
     $$\text{converter} = \min(\text{available}, \text{EngineClamp})$$
   - Matches the instruction block across `.text` using wildcard pattern scanning and enforces a strict uniqueness constraint ($N = 1$).
3. **Model & ModelInfo Struct Discovery (`src/model-scanner.js`):**
   - Resolves `MODEL_PLACEHOLDER_M318` across string tables and protobuf descriptors.
   - Verifies the `ModelInfo` struct field layout (`+0x14` MaxTokens, `+0x70` Reserved floor) and its downstream consumption in converter builder routines.
4. **Target Planning (`src/patch-planner.js`):**
   - Designs a 1M token configuration:
     - `EngineClamp` = `1,048,576` tokens (`0x00100000`)
     - `ModelInfo.MaxTokens` = `1,000,000` tokens (`0x000F4240`)
     - `ReserveFloor` = `40,000` tokens
     - `Expected Usable Budget` = $1,000,000 - 40,000 = \mathbf{960,000}\text{ tokens}$
     - `Effective Converter Limit` = $\min(960000, 1048576) = \mathbf{960,000}\text{ tokens}$
5. **Update Resilience Classification (`src/verifier.js`):**
   - Categorizes binaries into `KNOWN_COMPATIBLE`, `STRUCTURALLY_COMPATIBLE`, `UNKNOWN_BUILD`, `AMBIGUOUS`, or `UNSAFE`.
   - Inspects `local.antigravity-token-monitor` compatibility.

---

## Usage

```bash
# Run scan against active production binary
npm run scan

# Run automated test suite
npm test
```
