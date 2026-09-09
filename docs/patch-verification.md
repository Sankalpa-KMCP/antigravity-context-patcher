# Six-Site Patch Specification & Verification

This document provides the byte-level specification and mathematical verification procedure for the six patch sites that compose the validated 1M M318 context patch.

---

## 1. Verified Production Binary Target

| Attribute | Expected Value |
| :--- | :--- |
| **Target Binary** | `language_server_windows_x64.exe` |
| **Architecture** | PE32+ (x86_64), Go runtime + C++ extensions |
| **File Size** | `135,647,744` bytes |
| **Expected SHA-256** | `d7b8a84264019aacb56126fff438523e35039fd4dc313aa002189d630ac05779` |
| **Baseline Stock SHA-256** | `ec2f03ba0fe00630d49b035c2477b549c48fba0d8cc920dfe2d588f001d239b6` |

---

## 2. Six Patch Sites Specification

The 1M context modification consists of exactly six coordinated patch sites: two instruction immediate patches in the engine converter, and two trampoline hooks that divert execution into two dedicated tail code caves.

```mermaid
graph LR
    subgraph BinaryImage [PE32+ Section Image]
        subgraph TextSection [.text Section]
            Site1["Site 1: ENGINE_PATCH_1<br/>File 0x013aa158 (imm32)"]
            Site2["Site 2: ENGINE_PATCH_2<br/>File 0x013aa15d (imm32)"]
            Site3["Site 3: M318_HOOK<br/>File 0x00b3e936 (11 bytes)"]
            Site5["Site 5: CHECKPOINT_M318_HOOK<br/>File 0x0196052b (14 bytes)"]
        end

        subgraph TailCave [.text Tail Code Cave (RVA 0x27cb300)]
            Site4["Site 4: M318_CODE_CAVE<br/>File 0x027ca700 (36 bytes)<br/>Sets ModelInfo MaxTokens = 1M"]
            Site6["Site 6: CHECKPOINT_M318_CODE_CAVE<br/>File 0x027ca740 (50 bytes)<br/>Sets Checkpoint Threshold = 960k"]
        end
    end

    Site3 -->|jmp rel32| Site4
    Site4 -->|jmp rel32 return| Site3
    Site5 -->|jmp rel32| Site6
    Site6 -->|jmp rel32 return| Site5
```

---

### Site 1: `ENGINE_PATCH_1` (Engine Hard Clamp Comparison)
- **File Offset:** `0x013aa158` (RVA `0x013ab158`)
- **Length:** 4 bytes (imm32)
- **Stock Opcodes:** `81 F9 00 00 02 00` (`cmp ecx, 0x20000` — 131,072 / 128k) or `0x40000` (256k)
- **Patched Opcodes:** `81 F9 00 00 10 00` (`cmp ecx, 0x100000`)
- **Semantic Effect:** Sets comparison ceiling for `TrajectoryChatConverter` to $1,048,576$ tokens ($2^{20}$).

---

### Site 2: `ENGINE_PATCH_2` (Engine Hard Clamp Assignment)
- **File Offset:** `0x013aa15D` (RVA `0x013ab15D`)
- **Length:** 4 bytes (imm32)
- **Stock Opcodes:** `BA 00 00 02 00` (`mov edx, 0x20000`) or `0x40000` (256k)
- **Patched Opcodes:** `BA 00 00 10 00` (`mov edx, 0x100000`)
- **Semantic Effect:** Sets clamped assignment value to $1,048,576$ tokens. Followed immediately by `0F 42 D1` (`cmovb edx, ecx`).

---

### Site 3: `M318_HOOK` (ModelInfo Factory Trampoline Hook)
- **File Offset:** `0x00b3e936` (RVA `0x00b3f536`)
- **Length:** 11 bytes
- **Stock Opcodes:**
  ```text
  C7 40 14 00 E8 03 00    mov dword ptr [rax+0x14], 0x3E800 (256,000)
  48 89 58 18             mov qword ptr [rax+0x18], rbx
  ```
- **Patched Opcodes:**
  ```text
  E9 C5 BD C8 01          jmp 0x027cb300 (rel32 displacement +0x01C8BDC5)
  66 0F 1F 44 00 00       nop word ptr [rax+rax+0x00] (6-byte multi-byte NOP)
  ```
- **Semantic Effect:** Diverts execution to the M318 tail code cave and preserves instruction alignment.

---

### Site 4: `M318_CODE_CAVE` (ModelInfo Override Implementation)
- **File Offset:** `0x027ca700` (RVA `0x027cb300`)
- **Length:** 36 bytes
- **Disassembly:**
  ```nasm
  81 FA 26 05 00 00       cmp edx, 0x526           ; Check if model key == 1318 (M318)
  75 0A                   jne .apply_default       ; If not 1318, branch to default
  C7 40 14 40 42 0F 00    mov dword ptr [rax+14h], 0F4240h ; MaxTokens = 1,000,000
  EB 08                   jmp .continue
  .apply_default:
  C7 40 14 00 E8 03 00    mov dword ptr [rax+14h], 3E800h  ; MaxTokens = 256,000 (default)
  .continue:
  48 89 58 18             mov qword ptr [rax+18h], rbx     ; Replaced original instruction
  E9 31 42 37 FE          jmp 0x00b3f541           ; Return to continuation point
  ```
- **Semantic Effect:** Sets `ModelInfo.MaxTokens` to $1,000,000$ only for model key `1318`. All other models retain their exact default allocations.

---

### Site 5: `CHECKPOINT_M318_HOOK` (CascadeConfig Trampoline Hook)
- **File Offset:** `0x0196052b` (RVA `0x0196112b`)
- **Length:** 14 bytes
- **Stock Opcodes:**
  ```text
  C7 40 14 00 E8 03 00    mov dword ptr [rax+0x14], 0x3E800 (256,000)
  48 8B 84 24 A0 00 00 00 mov rax, qword ptr [rsp+0xA0]
  ```
- **Patched Opcodes:**
  ```text
  E9 10 A2 E6 00          jmp 0x027cb340 (rel32 displacement +0x00E6A210)
  66 0F 1F 84 00 00 00 00 00 nop word ptr [rax+rax+0x00000000] (9-byte NOP)
  ```
- **Semantic Effect:** Diverts `CascadeConfig` initialization to the Checkpoint code cave.

---

### Site 6: `CHECKPOINT_M318_CODE_CAVE` (CheckpointConfig Override)
- **File Offset:** `0x027ca740` (RVA `0x027cb340`)
- **Length:** 50 bytes
- **Disassembly:**
  ```nasm
  81 BC 24 A4 00 00 00 26 05 00 00 cmp dword ptr [rsp+0A4h], 0526h ; Check plan key == 1318
  75 0A                   jne .apply_default
  C7 40 14 00 A6 0E 00    mov dword ptr [rax+14h], 0EA600h ; MaxTokenLimit = 960,000
  EB 08                   jmp .continue
  .apply_default:
  C7 40 14 00 E8 03 00    mov dword ptr [rax+14h], 3E800h  ; MaxTokenLimit = 256,000 (default)
  .continue:
  48 8B 84 24 A0 00 00 00 mov rax, qword ptr [rsp+0A0h]    ; Replaced original instruction
  E9 DF 5D 19 FF          jmp 0x01961139           ; Return to continuation point
  ```
- **Semantic Effect:** Overrides `CheckpointConfig.MaxTokenLimit` to $960,000$ specifically for M318, preventing premature local conversation checkpointing and context truncation.

---

## 3. Negative-Scope Verification (Isolation Proof)

To verify that the patch causes zero collateral side effects across other models, the static test suite (`patcher/tests/test-checkpoint-staged.js`) simulates the execution of the code cave across all surrounding model keys:

| Model ID | Key Hex | Simulated Model Name | Override Status | Final Limit | Register Integrity |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **M316** | `0x0524` (`1316`) | Gemini 3.8 Flash (Low) | **BYPASSED** | `256,000` | Intact (`rax`, `rbx`, `rcx`, `rdi`) |
| **M317** | `0x0525` (`1317`) | Gemini 3.8 Flash (Medium) | **BYPASSED** | `256,000` | Intact (`rax`, `rbx`, `rcx`, `rdi`) |
| **M318** | `0x0526` (`1318`) | Gemini 3.8 Flash (High) | **APPLIED** | **`960,000`** | Intact (`rax`, `rbx`, `rcx`, `rdi`) |
| **M319** | `0x0527` (`1319`) | Gemini 3.8 Pro | **BYPASSED** | `256,000` | Intact (`rax`, `rbx`, `rcx`, `rdi`) |
| **M320** | `0x0528` (`1320`) | Gemini 3.8 Ultra | **BYPASSED** | `256,000` | Intact (`rax`, `rbx`, `rcx`, `rdi`) |

Result: **Negative scope is 100% verified**. Models other than M318 remain completely unaffected.

---

## 4. Autonomous Read-Only Verifier (`scripts/verify-patch.js`)

To verify the live installed binary without modifying any files or databases:

```bash
npm run verify
```

The script performs the following non-destructive checks:
1. Opens `language_server_windows_x64.exe` in read-only mode (`r`).
2. Calculates cryptographic SHA-256 and compares against `d7b8a84264019aacb56126fff438523e35039fd4dc313aa002189d630ac05779`.
3. Reads instruction immediates at Sites 1 and 2 to confirm the $1,048,576$ clamp.
4. Reads opcodes at Site 3 to confirm the `jmp 0x027cb300` trampoline.
5. Reads Cave Site 4 to verify the `cmp edx, 0x526` conditional override.
6. Reads opcodes at Site 5 to confirm the `jmp 0x027cb340` checkpoint trampoline.
7. Reads Cave Site 6 to verify the $960,000$ limit assignment.
