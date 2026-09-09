// active-cascade-resolver.js
// Resolves the currently active conversation in Antigravity Agent panel.
// Uses a robust multi-tier waterfall over authoritative RPC telemetry.
// Never assumes "newest DB = active conversation".

/**
 * Normalize workspace URI for comparison.
 */
function normalizeUri(uri) {
  if (!uri) return '';
  let s = uri.replace(/^file:\/\/\//, '/').replace(/^file:\/\//, '');
  try { s = decodeURIComponent(s); } catch (_) {}
  if (process.platform === 'win32') {
    s = s.replace(/^\/([a-zA-Z]:)/, '$1');
  }
  s = s.replace(/[\\/]+$/, '').toLowerCase();
  return s;
}

class ActiveCascadeResolver {
  constructor() {
    this._trackedCascadeId = null;
    this._previousStepCounts = new Map();
    this._userOverriddenCascadeId = null;
  }

  /**
   * Set user manual override (e.g. from "Select Conversation" QuickPick).
   */
  setUserOverride(cascadeId) {
    this._userOverriddenCascadeId = cascadeId;
    if (cascadeId) {
      this._trackedCascadeId = cascadeId;
    }
  }

  /**
   * Clear user manual override.
   */
  clearUserOverride() {
    this._userOverriddenCascadeId = null;
  }

  /**
   * Resolve active conversation from the list of trajectories and open workspaces.
   * @param {Array<object>} trajectories List of all trajectories from GetAllCascadeTrajectories
   * @param {Array<string>} openWorkspaceUris List of active workspace folder URIs
   * @returns {{ status: 'RESOLVED'|'AMBIGUOUS'|'NONE', cascade: object|null, reason: string }}
   */
  resolveActiveCascade(trajectories, openWorkspaceUris = []) {
    if (!Array.isArray(trajectories) || trajectories.length === 0) {
      return { status: 'NONE', cascade: null, reason: 'No trajectories exist' };
    }

    const normWsUris = openWorkspaceUris.map(normalizeUri).filter(Boolean);
    const hasWorkspace = normWsUris.length > 0;

    // Filter trajectories that match the current workspace
    const workspaceTrajectories = trajectories.filter(t => {
      if (!hasWorkspace) {
        // When no workspace is open in IDE, match conversations with no workspace URIs
        return !t.workspaceUris || t.workspaceUris.length === 0;
      }
      return (t.workspaceUris || []).some(wUri => {
        const norm = normalizeUri(wUri);
        return normWsUris.some(oUri => norm === oUri || norm.startsWith(oUri) || oUri.startsWith(norm));
      });
    });

    const pool = (hasWorkspace && workspaceTrajectories.length > 0) ? workspaceTrajectories : trajectories;

    // ── Priority 0: Explicit User Override ──────────────────────────────────
    if (this._userOverriddenCascadeId) {
      const match = trajectories.find(t => t.cascadeId === this._userOverriddenCascadeId);
      if (match) {
        return { status: 'RESOLVED', cascade: match, reason: 'User manual selection' };
      }
      this._userOverriddenCascadeId = null; // Stale override, clear
    }

    // ── Priority 1: Actively RUNNING Cascade ────────────────────────────────
    const runningInWs = pool.filter(t => t.status === 'CASCADE_RUN_STATUS_RUNNING');
    if (runningInWs.length === 1) {
      this._updateTracking(runningInWs[0]);
      return { status: 'RESOLVED', cascade: runningInWs[0], reason: 'Actively running in workspace' };
    }
    if (runningInWs.length > 1) {
      // Multiple conversations running simultaneously in the same workspace
      // Check if one of them is the currently tracked cascade
      const trackedRunning = runningInWs.find(t => t.cascadeId === this._trackedCascadeId);
      if (trackedRunning) {
        return { status: 'RESOLVED', cascade: trackedRunning, reason: 'Tracked cascade actively running' };
      }
      return {
        status: 'AMBIGUOUS',
        cascade: null,
        reason: `${runningInWs.length} conversations actively running simultaneously`
      };
    }

    // Also check global running if workspace had none
    const runningGlobal = trajectories.filter(t => t.status === 'CASCADE_RUN_STATUS_RUNNING');
    if (runningGlobal.length === 1 && !hasWorkspace) {
      this._updateTracking(runningGlobal[0]);
      return { status: 'RESOLVED', cascade: runningGlobal[0], reason: 'Actively running globally' };
    }

    // ── Priority 2: Step Count Advancement ──────────────────────────────────
    const advanced = pool.filter(t => {
      const prev = this._previousStepCounts.get(t.cascadeId);
      return prev !== undefined && t.stepCount > prev;
    });

    if (advanced.length === 1) {
      this._updateTracking(advanced[0]);
      return { status: 'RESOLVED', cascade: advanced[0], reason: 'Step count advanced in workspace' };
    }

    // ── Priority 3: Sticky Tracked Cascade ──────────────────────────────────
    if (this._trackedCascadeId) {
      const currentTracked = pool.find(t => t.cascadeId === this._trackedCascadeId);
      if (currentTracked) {
        this._updateTracking(currentTracked);
        return { status: 'RESOLVED', cascade: currentTracked, reason: 'Sticky tracked active conversation' };
      }
    }

    // ── Priority 4: Most Recently Modified in Workspace ─────────────────────
    if (pool.length > 0) {
      // Trajectories are sorted descending by lastModifiedTime
      const candidate = pool[0];
      this._updateTracking(candidate);
      return { status: 'RESOLVED', cascade: candidate, reason: 'Most recently modified in workspace' };
    }

    return { status: 'NONE', cascade: null, reason: 'No matching cascade identified' };
  }

  _updateTracking(cascade) {
    if (cascade && cascade.cascadeId) {
      this._trackedCascadeId = cascade.cascadeId;
      this._previousStepCounts.set(cascade.cascadeId, cascade.stepCount);
    }
  }

  getTrackedCascadeId() {
    return this._trackedCascadeId;
  }
}

module.exports = {
  ActiveCascadeResolver,
  normalizeUri
};
