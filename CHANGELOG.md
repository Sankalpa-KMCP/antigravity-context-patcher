# Changelog

All notable changes to the Antigravity Context Patcher and Antigravity Token Monitor are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0]

### Added
- **1M M318 Runtime Configuration:** PE32+ trampoline hook and tail code cave targeting `MODEL_PLACEHOLDER_M318` (model key `1318`), expanding runtime `ModelInfo.MaxTokens` from 256,000 to 1,000,000 tokens while maintaining reserve floor constraints.
- **960k Checkpoint Configuration:** Secondary trampoline hook and code cave targeting `CascadeConfig` initialization, lifting private `CheckpointConfig.MaxTokenLimit` from 256,000 to 960,000 tokens for M318 to prevent premature local conversation checkpointing and context truncation.
- **1,048,576 Engine Hard Clamp:** Instruction immediate patches at `0x013aa158` (`cmp ecx, clamp`) and `0x013aa15d` (`mov edx, clamp`) raising internal `TrajectoryChatConverter` ceiling to $2^{20}$ (1,048,576 tokens).
- **Provenance-First Token Monitor:** VS Code / Antigravity IDE status bar extension with zero-heuristic data integrity guarantee, categorizing all telemetry into authoritative provenance classes: `LIVE OBSERVED`, `VERIFIED STATIC CONFIGURATION`, `DERIVED`, and `UNAVAILABLE`.
- **Live Backend UsageMetadata Tracking:** Real-time extraction of Gemini backend prompt usage (`inputTokens` uncached prompt, `cacheReadTokens` cached prompt, `outputTokens`) with strict same-record pairing to prevent cross-record borrowing.
- **Read-Only 6-Site Patch Verification:** Autonomous verification tooling (`scripts/verify-patch.js`) confirming production executable SHA-256 (`d7b8a842...`) and verifying all 6 patch sites and displacements with zero binary writes.
- **Stale-Data Protection:** Automatic detection of Language Server process recycles, tracking process start times and suppressing percentage calculations across session boundaries (`STALE_SESSION` state).
- **Negative-Scope Static Emulation:** Automated test suite verifying that models M316, M317, M319, and M320 retain default 256k limits with zero register or memory leakage.
