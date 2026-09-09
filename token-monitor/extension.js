// extension.js
// Antigravity Token Monitor — Main Extension Entry Point
// Implements zero-estimation, low-overhead status-bar telemetry.

let vscode;
try {
  vscode = require('vscode');
} catch (_) {
  vscode = {
    commands: { registerCommand: () => ({ dispose: () => {} }) },
    window: {
      onDidChangeWindowState: () => ({ dispose: () => {} }),
      showQuickPick: async () => null,
      showInformationMessage: () => {},
      showErrorMessage: () => {}
    },
    workspace: {
      workspaceFolders: [],
      onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
      getConfiguration: () => ({ get: (key, def) => def })
    }
  };
}
const { inspectHardClamp, watchHardClamp, DEFAULT_EXE_PATH } = require('./clamp-inspector');
const { LanguageServerClient } = require('./ls-client');
const { ActiveCascadeResolver } = require('./active-cascade-resolver');
const { TelemetryTracker, PrecisionState } = require('./telemetry-tracker');
const { StatusBarManager } = require('./statusbar');

let client = null;
let resolver = null;
let tracker = null;
let statusBar = null;
let clampWatcher = null;
let pollingTimer = null;
let isPollingInProgress = false;
let isWindowFocused = true;

/**
 * Extension activation
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  client = new LanguageServerClient();
  resolver = new ActiveCascadeResolver();
  tracker = new TelemetryTracker();
  statusBar = new StatusBarManager();

  // 1. Initial Hard Clamp Read & Setup File Watcher
  const initialClamp = inspectHardClamp(DEFAULT_EXE_PATH);
  statusBar.setHardClampInfo(initialClamp);

  clampWatcher = watchHardClamp(DEFAULT_EXE_PATH, (newClamp) => {
    statusBar.setHardClampInfo(newClamp);
  });
  context.subscriptions.push(clampWatcher);
  context.subscriptions.push(statusBar);

  // 2. Register Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravityTokenMonitor.showDetails', () => {
      statusBar.showDetailsQuickPick(client.getSession());
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('antigravityTokenMonitor.refresh', async () => {
      await pollTelemetry(true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('antigravityTokenMonitor.selectConversation', async () => {
      await promptConversationSelection();
    })
  );

  // 3. Track Window Focus to throttle background polling
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((e) => {
      isWindowFocused = e.focused;
      scheduleNextPoll();
    })
  );

  // Section D: Track Workspace Folder Changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      pollTelemetry(false);
    })
  );

  // Section E: Initial Telemetry Poll
  pollTelemetry(false);
}

/**
 * Poll telemetry from language server RPC.
 * @param {boolean} forceDiscovery
 */
async function pollTelemetry(forceDiscovery = false) {
  if (isPollingInProgress) return;
  isPollingInProgress = true;

  try {
    if (forceDiscovery) {
      await client.discoverSession(true);
    }

    // 1. Fetch all trajectories
    let trajectories = [];
    try {
      trajectories = await client.getAllCascadeTrajectories();
    } catch (rpcErr) {
      tracker.setDisconnected(rpcErr.message);
      statusBar.update(tracker.getCurrentState());
      scheduleNextPoll();
      return;
    }

    // 2. Resolve active cascade
    const openWsUris = (vscode.workspace.workspaceFolders || []).map(f => f.uri.toString());
    const resolution = resolver.resolveActiveCascade(trajectories, openWsUris);

    if (resolution.status === 'AMBIGUOUS') {
      tracker.setAmbiguous(resolution.reason);
      statusBar.update(tracker.getCurrentState());
      scheduleNextPoll();
      return;
    }

    if (resolution.status === 'NONE' || !resolution.cascade) {
      const clampInfo = inspectHardClamp(DEFAULT_EXE_PATH);
      tracker.setWaiting(null, clampInfo);
      statusBar.update(tracker.getCurrentState());
      scheduleNextPoll();
      return;
    }

    const activeCascade = resolution.cascade;

    // 3. Fetch generator metadata for the active cascade
    let genMetadataResp = null;
    try {
      genMetadataResp = await client.getCascadeTrajectoryGeneratorMetadata(activeCascade.cascadeId);
    } catch (genErr) {
      // If generator metadata call fails, record error state
      tracker.setError(`Metadata fetch failed: ${genErr.message}`);
      statusBar.update(tracker.getCurrentState());
      scheduleNextPoll();
      return;
    }

    // Step D: Update Tracker with authoritative telemetry
    const clampInfo = inspectHardClamp(DEFAULT_EXE_PATH);
    const session = client.getSession();
    tracker.updateFromGeneratorMetadata(activeCascade, genMetadataResp, clampInfo, session?.startTime);
    statusBar.update(tracker.getCurrentState());

  } catch (err) {
    tracker.setError(err.message);
    statusBar.update(tracker.getCurrentState());
  } finally {
    isPollingInProgress = false;
    scheduleNextPoll();
  }
}

/**
 * Adaptive Polling Scheduler
 * 5s while RUNNING; 30s while IDLE; 60s when window unfocused & IDLE.
 */
function scheduleNextPoll() {
  if (pollingTimer) {
    clearTimeout(pollingTimer);
    pollingTimer = null;
  }

  const config = vscode.workspace.getConfiguration('antigravityTokenMonitor');
  const activeInterval = config.get('activePollingInterval', 5);
  const idleInterval = config.get('idlePollingInterval', 30);

  const state = tracker?.getCurrentState();
  const isRunning = state?.status === 'CASCADE_RUN_STATUS_RUNNING';

  let delaySeconds = idleInterval;
  if (isRunning) {
    delaySeconds = activeInterval;
  } else if (!isWindowFocused) {
    delaySeconds = Math.max(idleInterval * 2, 60);
  }

  pollingTimer = setTimeout(() => {
    pollTelemetry(false);
  }, delaySeconds * 1000);
}

/**
 * Interactive dialog to manually pick active conversation.
 */
async function promptConversationSelection() {
  try {
    const trajectories = await client.getAllCascadeTrajectories();
    if (trajectories.length === 0) {
      vscode.window.showInformationMessage('No Antigravity conversations found.');
      return;
    }

    const items = trajectories.map(t => ({
      label: t.summary || t.cascadeId,
      description: `[${t.status}] Steps: ${t.stepCount}`,
      detail: `ID: ${t.cascadeId} | Last Modified: ${t.lastModifiedTime}`,
      cascadeId: t.cascadeId
    }));

    items.unshift({
      label: '$(sync) Automatic Resolution',
      description: 'Reset to automatic active conversation detection',
      detail: '',
      cascadeId: null
    });

    const selected = await vscode.window.showQuickPick(items, {
      title: 'Select Active Conversation for Token Monitoring'
    });

    if (selected) {
      if (selected.cascadeId) {
        resolver.setUserOverride(selected.cascadeId);
      } else {
        resolver.clearUserOverride();
      }
      await pollTelemetry(false);
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to list conversations: ${err.message}`);
  }
}

function deactivate() {
  if (pollingTimer) {
    clearTimeout(pollingTimer);
    pollingTimer = null;
  }
  if (clampWatcher) {
    clampWatcher.dispose();
    clampWatcher = null;
  }
  if (statusBar) {
    statusBar.dispose();
    statusBar = null;
  }
}

module.exports = {
  activate,
  deactivate
};
