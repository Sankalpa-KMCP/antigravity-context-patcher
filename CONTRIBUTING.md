# Contributing to Antigravity Context Patcher

Thank you for your interest in contributing! This project is an experimental engineering and reverse-engineering initiative dedicated to inspecting, validating, and extending context behavior in Google Antigravity IDE with strict provenance-first telemetry.

---

## Code of Conduct & Core Principles

When contributing to this repository, adhere strictly to the following engineering discipline:

1. **Evidence Before Action:**
   Every claim, patch offset, instruction layout, and token accounting rule must be backed by verifiable binary disassemblies, PE section analysis, or authoritative Connect-RPC protocol traces. Never make speculative assertions.
2. **Zero-Estimation Policy:**
   Never introduce heuristic calculations (`chars / 4`, byte division, extrapolated progress, or guessed numbers). Telemetry must reflect verified static configuration or authoritative runtime measurements. When data is missing, honestly report `UNAVAILABLE` or `PENDING`.
3. **Non-Collateral Isolation:**
   Binary modifications must prove negative scope: targeting a specific model (e.g. `MODEL_PLACEHOLDER_M318` / key `1318`) must leave all other model configurations (M316, M317, M319, M320) bit-for-bit unchanged.
4. **Safety First:**
   Never write code that mutates active production binaries while processes are executing, and never touch user conversation databases. All binary staging must remain isolated until safe apply-on-exit promotion.

---

## Development & Testing Workflow

### Prerequisites

- **Node.js:** `>= 18.0.0`
- **Git**
- **Windows x64 Environment** (required for language server binary verification and token monitor RPC interaction)

### Setup

```bash
# Clone the repository
git clone https://github.com/Sankalpa-KMCP/antigravity-context-patcher.git
cd antigravity-context-patcher

# Install dependencies (zero production runtime dependencies)
npm install
```

### Running Tests

All automated tests must pass with 100% success before submitting a pull request:

```bash
# Run both patcher verification and token monitor test suites
npm test

# Run patcher suite individually (includes negative-scope static emulation)
npm run test:patcher

# Run token monitor suite individually (offline clamp inspector, state machine, zero-heuristic audit)
npm run test:monitor

# Run read-only live patch verification on production binary
npm run verify
```

---

## Repository Conventions

- **Commits:** Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:
  - `feat: ...` for new features or capabilities
  - `fix: ...` for bug fixes
  - `docs: ...` for documentation updates
  - `test: ...` for test suites or verification fixtures
  - `refactor: ...` for code reorganization without behavior change
  - `chore: ...` for hygiene, package metadata, or tooling
- **Formatting:** Keep JavaScript clean, modern, and dependency-free (ES2022+ / CommonJS for extension compatibility).
- **Privacy & Security:** Do not commit:
  - Machine-specific absolute file paths
  - OAuth tokens, CSRF tokens, session cookies, or API keys
  - User conversation SQLite databases (`*.db`, `*.db-wal`, `*.db-shm`)
  - Intermediate PE binaries or core dumps

---

## Submitting a Pull Request

1. Fork the repository and create your feature branch: `git checkout -b feat/my-improvement`.
2. Ensure `npm test` passes completely.
3. Verify your changes against the zero-heuristic and fail-closed security standards.
4. Open a pull request against `main` using the repository's pull request template.
