// test/run-all-tests.js
// Offline verification runner for Antigravity Token Monitor.
// Runs all offline test suites: Clamp, RPC, State Machine, Formatting, and Integrity Audit.

const { runClampTests } = require('./test-clamp');
const { runRpcTests } = require('./test-rpc');
const { runStateMachineTests } = require('./test-state-machine');
const { runFormattingTests } = require('./test-formatting');
const { runIntegrityAudit } = require('./test-integrity-audit');

async function main() {
  console.log('====================================================');
  console.log('ANTIGRAVITY TOKEN MONITOR — OFFLINE VERIFICATION SUITE');
  console.log('====================================================\n');

  try {
    // 1. Clamp parser test (512k, 900k, 128k)
    runClampTests();

    // 2. Real read-only RPC parser test
    await runRpcTests();

    // 3. State machine & failure handling test
    runStateMachineTests();

    // 4. Formatting test
    runFormattingTests();

    // 5. Token estimation & source integrity audit
    runIntegrityAudit();

    console.log('====================================================');
    console.log('ALL VERIFICATION SUITES PASSED SUCCESSFULLY (100%)');
    console.log('====================================================');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ VERIFICATION SUITE FAILED:', err);
    process.exit(1);
  }
}

main();
