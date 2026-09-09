# apply-checkpoint-on-exit.ps1
# Safe Guarded Apply-On-Exit Helper for Antigravity Context Patcher (Phase 1M-F Checkpoint Apply).
# Waits for Antigravity language_server processes to terminate, then atomically replaces production binary.

param(
    [string]$TargetPath = "D:\Antigravity IDE\resources\app\extensions\antigravity\bin\language_server_windows_x64.exe",
    [string]$StagedPatchedPath = "D:\Antigravity-Context-Patcher\staging\language_server_1m_checkpoint_test.exe",
    [string]$BackupsDir = "D:\Antigravity-Context-Patcher\backups",
    [string]$StatusFile = "D:\Antigravity-Context-Patcher\production-checkpoint-apply-status.json",
    [string]$LogFile = "D:\Antigravity-Context-Patcher\production-checkpoint-apply.log",
    [string]$ExpectedOrigHash = "ec2f03ba0fe00630d49b035c2477b549c48fba0d8cc920dfe2d588f001d239b6",
    [string]$ExpectedPatchedHash = "d7b8a84264019aacb56126fff438523e35039fd4dc313aa002189d630ac05779",
    [int]$TimeoutSeconds = 600
)

function Log {
    param([string]$Message)
    $ts = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    $line = "[$ts] $Message"
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
    Write-Output $line
}

function Write-Status {
    param(
        [string]$OriginalHash,
        [string]$PatchedHash,
        [string]$BackupPath,
        [string]$Result,
        [bool]$RollbackPerformed,
        $ErrorMsg
    )
    $status = [ordered]@{
        timestamp = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        originalHash = $OriginalHash
        patchedHash = $PatchedHash
        backupPath = $BackupPath
        result = $Result
        rollbackPerformed = $RollbackPerformed
        error = $ErrorMsg
    }
    $json = $status | ConvertTo-Json -Depth 5
    Set-Content -Path $StatusFile -Value $json -Encoding UTF8
    Log "Status recorded: result=$Result, rollback=$RollbackPerformed, error=$ErrorMsg"
}

function Get-Hash {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-TargetProcessCount {
    param([string]$Path)
    $normalizedTarget = [System.IO.Path]::GetFullPath($Path).ToLowerInvariant()
    $count = 0
    $procs = @(Get-Process -Name "language_server_windows_x64" -ErrorAction SilentlyContinue)
    foreach ($p in $procs) {
        try {
            $pPath = $p.Path
            if ($pPath -and ([System.IO.Path]::GetFullPath($pPath).ToLowerInvariant() -eq $normalizedTarget)) {
                $count++
                continue
            }
        } catch {}
        try {
            $wmi = Get-CimInstance Win32_Process -Filter "ProcessId = $($p.Id)" -ErrorAction SilentlyContinue
            if ($wmi.ExecutablePath -and ([System.IO.Path]::GetFullPath($wmi.ExecutablePath).ToLowerInvariant() -eq $normalizedTarget)) {
                $count++
            }
        } catch {}
    }
    return $count
}

# --- Initialization ---
Log "=========================================================="
Log "APPLY-CHECKPOINT-ON-EXIT HELPER ARMED"
Log "Target: $TargetPath"
Log "Staged Patched: $StagedPatchedPath"
Log "Timeout: $TimeoutSeconds seconds"
Log "Expected Source Hash: $ExpectedOrigHash"
Log "Expected Target Hash: $ExpectedPatchedHash"
Log "=========================================================="

# Ensure initial status file exists indicating ARMED state
Write-Status -OriginalHash $ExpectedOrigHash -PatchedHash $ExpectedPatchedHash -BackupPath $null -Result "ARMED_WAITING_FOR_EXIT" -RollbackPerformed $false -ErrorMsg $null

# Ensure backups directory exists
if (-not (Test-Path $BackupsDir)) {
    New-Item -ItemType Directory -Path $BackupsDir -Force | Out-Null
}

# Verify staged patched binary before waiting
$stagedHash = Get-Hash $StagedPatchedPath
if ($stagedHash -ne $ExpectedPatchedHash) {
    Log "ERROR: Staged patched binary hash mismatch! Expected $ExpectedPatchedHash, got $stagedHash"
    Write-Status -OriginalHash $ExpectedOrigHash -PatchedHash $stagedHash -BackupPath $null -Result "ABORT_STAGED_HASH_MISMATCH" -RollbackPerformed $false -ErrorMsg "Staged binary hash did not match expected patched hash."
    exit 1
}

# --- Wait Loop ---
$startTime = [DateTime]::UtcNow
$pollIntervalSec = 2

while ($true) {
    $runningCount = Get-TargetProcessCount -Path $TargetPath
    if ($runningCount -eq 0) {
        Log "Detected ZERO running language server processes for target. Proceeding to safe apply."
        break
    }
    
    $elapsedSec = ([DateTime]::UtcNow - $startTime).TotalSeconds
    if ($elapsedSec -ge $TimeoutSeconds) {
        Log "TIMEOUT reached ($TimeoutSeconds s). Target processes still running ($runningCount). ZERO modification performed."
        Write-Status -OriginalHash $ExpectedOrigHash -PatchedHash $null -BackupPath $null -Result "TIMEOUT_NO_MODIFICATION" -RollbackPerformed $false -ErrorMsg "Timed out after $TimeoutSeconds seconds waiting for language_server processes to exit."
        exit 2
    }
    
    Start-Sleep -Seconds $pollIntervalSec
}

# Allow 1 second buffer for file handles to be completely released by OS
Start-Sleep -Seconds 1

# Re-check process count once more to prevent race condition
$doubleCheckCount = Get-TargetProcessCount -Path $TargetPath
if ($doubleCheckCount -ne 0) {
    Log "ABORT: Process restarted during grace period ($doubleCheckCount running). Zero modification."
    Write-Status -OriginalHash $ExpectedOrigHash -PatchedHash $null -BackupPath $null -Result "ABORT_PROCESS_ACTIVE" -RollbackPerformed $false -ErrorMsg "Target process became active during pre-apply grace period."
    exit 1
}

# --- Step 3: Immediate Pre-check of Production SHA-256 ---
$currentProdHash = Get-Hash $TargetPath
if ($currentProdHash -ne $ExpectedOrigHash) {
    Log "ABORT: Production SHA-256 changed before replacement! Expected $ExpectedOrigHash, got $currentProdHash"
    Write-Status -OriginalHash $currentProdHash -PatchedHash $null -BackupPath $null -Result "ABORT_PRECHECK_HASH_MISMATCH" -RollbackPerformed $false -ErrorMsg "Production hash changed before replacement. Expected $ExpectedOrigHash, got $currentProdHash"
    exit 1
}
Log "Production pre-check hash confirmed: $currentProdHash"

# --- Step 4: Create Timestamped Backup ---
$tsFormatted = [DateTime]::UtcNow.ToString("yyyyMMdd_HHmmss")
$backupPath = Join-Path $BackupsDir "language_server_windows_x64_$tsFormatted.exe"
Log "Creating backup at: $backupPath"
Copy-Item -Path $TargetPath -Destination $backupPath -Force

$backupHash = Get-Hash $backupPath
if ($backupHash -ne $ExpectedOrigHash) {
    Log "ABORT: Backup creation failed or hash mismatch! Expected $ExpectedOrigHash, got $backupHash"
    Write-Status -OriginalHash $currentProdHash -PatchedHash $null -BackupPath $backupPath -Result "ABORT_BACKUP_VERIFICATION_FAILED" -RollbackPerformed $false -ErrorMsg "Backup verification failed."
    exit 1
}
Log "Backup verified successfully: $backupHash"

# --- Step 5: Copy Verified Patched Image beside Production as .new ---
$tempNewPath = "$TargetPath.new"
Log "Staging temporary .new file: $tempNewPath"
Copy-Item -Path $StagedPatchedPath -Destination $tempNewPath -Force

# --- Step 6: Verify .new Hash ---
$tempNewHash = Get-Hash $tempNewPath
if ($tempNewHash -ne $ExpectedPatchedHash) {
    Log "ABORT: Temporary .new file hash mismatch! Expected $ExpectedPatchedHash, got $tempNewHash"
    Remove-Item -Path $tempNewPath -Force -ErrorAction SilentlyContinue
    Write-Status -OriginalHash $currentProdHash -PatchedHash $null -BackupPath $backupPath -Result "ABORT_NEW_FILE_HASH_MISMATCH" -RollbackPerformed $false -ErrorMsg "Temporary .new file hash did not match expected patched hash."
    exit 1
}
Log "Temporary .new file verified: $tempNewHash"

# --- Step 7: Atomically Replace Production ---
$tempOldPath = "$TargetPath.old"
$replaceSucceeded = $false

try {
    Log "Executing atomic file replacement via [System.IO.File]::Replace..."
    [System.IO.File]::Replace($tempNewPath, $TargetPath, $tempOldPath)
    $replaceSucceeded = $true
    Log "Atomic replacement call completed."
} catch {
    Log "Atomic replacement call encountered exception: $_"
    # Fallback to Move-Item if Replace API had permission issue with backup parameter
    try {
        Log "Attempting Move-Item fallback replacement..."
        Move-Item -Path $tempNewPath -Destination $TargetPath -Force -ErrorAction Stop
        $replaceSucceeded = $true
        Log "Move-Item fallback replacement succeeded."
    } catch {
        Log "Move-Item fallback also failed: $_"
        $replaceSucceeded = $false
    }
}

# Clean up .new file if still present
if (Test-Path $tempNewPath) {
    Remove-Item -Path $tempNewPath -Force -ErrorAction SilentlyContinue
}

# --- Step 8: Verify Final Production SHA-256 ---
$finalProdHash = Get-Hash $TargetPath
Log "Final production binary hash: $finalProdHash"

if ($finalProdHash -eq $ExpectedPatchedHash) {
    Log "VERIFICATION SUCCESS: Production binary now matches expected 1M checkpoint patched hash!"
    # Clean up .old temporary file if created by Replace
    if (Test-Path $tempOldPath) {
        Remove-Item -Path $tempOldPath -Force -ErrorAction SilentlyContinue
    }
    Write-Status -OriginalHash $currentProdHash -PatchedHash $finalProdHash -BackupPath $backupPath -Result "SUCCESS" -RollbackPerformed $false -ErrorMsg $null
    Log "=== CHECKPOINT PATCH APPLIED AND VERIFIED SUCCESSFULLY ==="
    exit 0
} else {
    # --- Step 9: Immediate Rollback to Verified Backup ---
    Log "ERROR: Verification failed! Final hash $finalProdHash does not match expected $ExpectedPatchedHash. INITIATING IMMEDIATE ROLLBACK."
    try {
        Copy-Item -Path $backupPath -Destination $TargetPath -Force
        $rollbackHash = Get-Hash $TargetPath
        Log "Rollback restored binary hash: $rollbackHash"
        if ($rollbackHash -eq $ExpectedOrigHash) {
            Log "Rollback successful. Original binary restored."
            Write-Status -OriginalHash $rollbackHash -PatchedHash $finalProdHash -BackupPath $backupPath -Result "REPLACEMENT_VERIFICATION_FAILED_ROLLED_BACK" -RollbackPerformed $true -ErrorMsg "Patched binary failed verification; restored from backup successfully."
        } else {
            Log "CRITICAL: Rollback restoration hash mismatch! Found $rollbackHash"
            Write-Status -OriginalHash $rollbackHash -PatchedHash $finalProdHash -BackupPath $backupPath -Result "CRITICAL_ROLLBACK_MISMATCH" -RollbackPerformed $true -ErrorMsg "Rollback hash mismatch. Manual intervention required."
        }
    } catch {
        Log "CRITICAL: Rollback failed with error: $_"
        Write-Status -OriginalHash $finalProdHash -PatchedHash $finalProdHash -BackupPath $backupPath -Result "CRITICAL_ROLLBACK_FAILED" -RollbackPerformed $false -ErrorMsg "Rollback copy failed: $_"
    }
    
    # Clean up any leftover temporary files
    if (Test-Path $tempOldPath) {
        Remove-Item -Path $tempOldPath -Force -ErrorAction SilentlyContinue
    }
    exit 1
}
