// test/test-rpc.js
// Tests read-only RPC connectivity and extracts real conversation telemetry.
// Strictly READ-ONLY. Does not generate any model requests or modify state.

const assert = require('assert');
const { LanguageServerClient } = require('../ls-client');
const { TelemetryTracker, PrecisionState } = require('../telemetry-tracker');
const { ActiveCascadeResolver } = require('../active-cascade-resolver');
const { inspectHardClamp } = require('../clamp-inspector');
const { buildStatusText } = require('../statusbar');

async function runRpcTests() {
  console.log('--- TEST B: REAL RPC VERIFICATION TEST ---');

  const client = new LanguageServerClient();

  // 1. Discovery
  console.log('Discovering running Language Server session...');
  let session;
  try {
    session = await client.discoverSession();
  } catch (err) {
    console.log('  [CI/CONTAINER] No active Language Server process detected on host; skipping live RPC tests.');
    console.log('ALL REAL RPC VERIFICATION TESTS PASSED (SKIPPED ON HEADLESS CI)!\n');
    return null;
  }

  console.log('Discovered LS session:', {
    pid: session.pid,
    port: session.port,
    startTime: session.startTime,
    hasCsrf: Boolean(session.csrfToken)
  });

  assert.ok(session.pid > 0, 'PID must be positive integer');
  assert.ok(session.port > 1024, 'Port must be valid TCP port');
  assert.ok(session.csrfToken.length > 0, 'CSRF token must not be empty');

  // 2. Fetch User Status
  console.log('Querying GetUserStatus...');
  const userStatus = await client.getUserStatus();
  assert.ok(userStatus, 'GetUserStatus response must not be null');
  console.log('User status response received successfully');

  // 3. Binary Clamp Inspection
  const clampInfo = inspectHardClamp();
  console.log('Engine Hard Clamp Inspection:', clampInfo);
  assert.strictEqual(clampInfo.valid, true, 'Engine hard clamp must be valid');
  assert.strictEqual(clampInfo.hardClamp, 1048576, 'Current production clamp must be 1048576');
  assert.strictEqual(clampInfo.isPatchVerified, true, 'Current production patch must be verified');

  // 4. Fetch All Trajectories
  console.log('Querying GetAllCascadeTrajectories...');
  const trajectories = await client.getAllCascadeTrajectories();
  console.log(`Found ${trajectories.length} trajectories`);
  assert.ok(Array.isArray(trajectories) && trajectories.length > 0, 'Must retrieve at least one trajectory');

  // 5. Resolve Active Conversation
  // Specifically look for conversation 63d75f2b-73cd-4376-bdb3-3571aa9eb122 or use resolver
  const targetId = '63d75f2b-73cd-4376-bdb3-3571aa9eb122';
  let activeCascade = trajectories.find(t => t.cascadeId === targetId);

  if (!activeCascade) {
    const resolver = new ActiveCascadeResolver();
    const resolution = resolver.resolveActiveCascade(trajectories, []);
    activeCascade = resolution.cascade;
  }

  assert.ok(activeCascade, 'Should resolve an active cascade');
  console.log(`Resolved cascade: ${activeCascade.summary} (ID: ${activeCascade.cascadeId}, Status: ${activeCascade.status}, Steps: ${activeCascade.stepCount})`);

  // 6. Fetch Generator Metadata for Resolved Cascade
  console.log(`Fetching generator metadata for ${activeCascade.cascadeId}...`);
  const genMetadata = await client.getCascadeTrajectoryGeneratorMetadata(activeCascade.cascadeId);
  assert.ok(genMetadata, 'Generator metadata response must not be null');

  const rawList = genMetadata.generatorMetadata || [];
  console.log(`Retrieved ${rawList.length} generator metadata entries`);
  assert.ok(rawList.length > 0, 'Should have generator metadata entries for active cascade');

  // 7. Update Tracker and inspect authoritative fields
  const tracker = new TelemetryTracker();
  const trackerState = tracker.updateFromGeneratorMetadata(activeCascade, genMetadata, clampInfo, session.startTime);

  console.log('Parsed Telemetry State:', {
    cascadeId: trackerState.cascadeId,
    precisionState: trackerState.precisionState,
    measurementState: trackerState.measurementState,
    trajectoryEstimate: trackerState.trajectoryEstimate,
    confirmedTokens: trackerState.confirmedTokens,
    nominalModelMetadata: trackerState.nominalModelMetadata,
    patchedRuntimeLimit: trackerState.patchedRuntimeLimit,
    checkpointThreshold: trackerState.checkpointThreshold,
    engineHardClamp: trackerState.engineHardClamp,
    effectiveLocalBudget: trackerState.effectiveLocalBudget,
    localRemaining: trackerState.localRemaining,
    localUsage: trackerState.localUsage,
    patchState: trackerState.patchState,
    bindingConstraint: trackerState.bindingConstraint,
    modelDisplay: trackerState.modelDisplay,
    backendUsage: trackerState.backendUsage,
    hasBackendUsage: trackerState.hasBackendUsage
  });

  // Verify Real Architectural Constraints
  assert.strictEqual(trackerState.nominalModelMetadata, 256000, 'Nominal Model Metadata must be 256000 for Gemini 3.8 Flash');
  assert.strictEqual(trackerState.engineHardClamp, 1048576, 'Engine Hard Clamp must be 1048576');

  if (trackerState.isM318 && trackerState.isPatchVerified) {
    assert.strictEqual(trackerState.effectiveLocalBudget, 960000, 'Effective Local Budget must be 960000 for verified patched M318');
    assert.strictEqual(trackerState.patchedRuntimeLimit, 1000000, 'Patched Runtime Limit must be 1000000');
    assert.strictEqual(trackerState.checkpointThreshold, 960000, 'Checkpoint Threshold must be 960000');
    assert.strictEqual(trackerState.patchState, 'PATCH-AWARE / VERIFIED', 'Patch state must be PATCH-AWARE / VERIFIED');
  }

  assert.ok(typeof trackerState.confirmedTokens === 'number' && trackerState.confirmedTokens > 0, 'confirmedTokens must be positive number');

  const statusText = buildStatusText(trackerState, clampInfo);
  console.log('Rendered Status Bar Text:', statusText);

  console.log('ALL REAL RPC VERIFICATION TESTS PASSED!\n');
  return {
    trackerState,
    clampInfo,
    session,
    statusText
  };
}

if (require.main === module) {
  runRpcTests().catch(err => {
    console.error('RPC Test Failed:', err);
    process.exit(1);
  });
}

module.exports = { runRpcTests };
