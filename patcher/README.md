# Antigravity Context Patcher — Core Engine

This component provides structural discovery, PE32+ inspection, and binary patch generation for the Antigravity Language Server (`language_server_windows_x64.exe`).

## Purpose

Antigravity natively enforces a series of layered context limits across its local runtime pipeline:
1. **Engine Hard Clamp (`0x13aa158` / `0x13aa15D`):** Immediate operand in the TrajectoryChatConverter constraining context calculations to `524,288` (or `128,000` stock).
2. **ModelInfo Table (`0xb3e936`):** Fallback structure defining nominal context metadata (`ModelInfo.MaxTokens = 256,000`).
3. **Checkpoint Configuration (`0x196052b`):** Runtime limiter that truncates local context at `CheckpointConfig.MaxTokenLimit = 256,000`.

The patcher modifies these structures using control-flow redirects and code caves in executable padding, expanding local capacity to **1,000,000 tokens** (with a **960,000 token checkpoint threshold** and **1,048,576 engine clamp**) exclusively for Gemini 3.8 Flash (`MODEL_PLACEHOLDER_M318` / key `1318`).

## Architecture & Patch Sites

| Site ID | Symbolic Name | File Offset | RVA | Type | Behavior |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Site 1** | `ENGINE_PATCH_1` | `0x013aa158` | `0x013ab158` | IMM32 Edit | Immediate operand modified from `0x00080000` (`524k`) to `0x00100000` (`1,048,576`). |
| **Site 2** | `ENGINE_PATCH_2` | `0x013aa15D` | `0x013ab15D` | IMM32 Edit | Immediate operand modified from `0x00080000` (`524k`) to `0x00100000` (`1,048,576`). |
| **Site 3** | `M318_HOOK` | `0x00b3e936` | `0x00b3f536` | Trampoline | 5-byte relative JMP (`jmp 0x27cb300`) + 6-byte NOP redirecting model table instantiation. |
| **Site 4** | `M318_CODE_CAVE` | `0x027ca700` | `0x027cb300` | Code Cave | Compares model key against `0x526` (`1318`). If matching, writes `0x000F4240` (`1,000,000`) into `[rax+0x14]`. Jumps back. |
| **Site 5** | `CHECKPOINT_M318_HOOK` | `0x0196052b` | `0x0196112b` | Trampoline | 5-byte relative JMP (`jmp 0x27cb340`) + 9-byte NOP redirecting checkpoint calculation. |
| **Site 6** | `CHECKPOINT_M318_CODE_CAVE` | `0x027ca740` | `0x027cb340` | Code Cave | Compares plan model key at `[rsp+0xa4]` against `0x526` (`1318`). If matching, writes `0x000EA600` (`960,000`) to `[rax+0x14]`. Jumps back. |

## Verification

To run the automated patch verification suite:

```bash
node tests/test-checkpoint-staged.js
```
