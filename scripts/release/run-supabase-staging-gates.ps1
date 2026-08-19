[CmdletBinding()]
param(
  [ValidateSet('Static', 'ApplyAndSmoke', 'RollbackSmoke')]
  [string]$Mode = 'Static',
  [ValidateSet('none', 'staging', 'disposable-staging')]
  [string]$Environment = 'none'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$sqlRoot = Join-Path $repoRoot 'data-brain\supabase'
$migrationRoot = Join-Path $sqlRoot 'migrations'
$noopMigration = Join-Path $migrationRoot '20260819072840_cold_campaign_scheduler.sql'
$noopMigrationDecisionId = 'FUNDAE-ADR-20260819-COLD-SCHEDULER-SUPERSEDED'
$noopMigrationExpectedSha256 = 'e5588fcaebd98e3d917cba8cfa2de557b908021b3171c5dea48d5b27f14e0f67'
$migrationFiles = @(
  '20260818083632_graph_outbox_foundation.sql',
  '20260819072840_cold_campaign_scheduler.sql',
  '20260819120000_dashboard_aggregates_rbac.sql',
  '20260819143000_inbound_reliability.sql',
  '20260819155300_cold_campaign_hmac_identity.sql',
  '20260819170000_cold_campaign_scheduler.sql',
  '20260819183000_operational_observability.sql',
  '20260819190000_journey_retention_control.sql',
  '20260819200000_cold_campaign_provisioning.sql',
  '20260819210000_release_safety_barriers.sql',
  '20260819220000_advisor_index_hardening.sql',
  '20260819230000_durable_operational_alert_delivery.sql',
  '20260819233000_transactional_graph_pilot_scope.sql',
  '20260819234000_campaign_terminal_suppression_hardening.sql',
  '20260819234100_campaign_contact_suppression_insert_gate.sql',
  '20260819234200_transactional_graph_pilot_authorization_fk_index.sql',
  '20260819234300_transactional_graph_pilot_alert_hardening.sql',
  '20260819234400_campaign_conditional_delivery_hardening.sql'
) | ForEach-Object { Join-Path $migrationRoot $_ }
$precheck = Join-Path $sqlRoot 'FUNDAE_RELEASE_PRECHECK_20260819.sql'
$postcheck = Join-Path $sqlRoot 'FUNDAE_RELEASE_POSTCHECK_20260819.sql'
$behaviorSmoke = Join-Path $sqlRoot 'FUNDAE_RELEASE_BEHAVIOR_SMOKE_20260819.sql'
$pilotSmoke = Join-Path $sqlRoot 'TRANSACTIONAL_GRAPH_PILOT_SMOKE_20260819.sql'
$suppressionSmoke = Join-Path $sqlRoot 'CAMPAIGN_SUPPRESSION_SMOKE_20260819.sql'
$forwardRollback = Join-Path $sqlRoot 'FUNDAE_RELEASE_FORWARD_ROLLBACK_20260819.sql'
$postRollback = Join-Path $sqlRoot 'FUNDAE_RELEASE_POST_ROLLBACK_20260819.sql'
$allFiles = @($precheck) + $migrationFiles + @($postcheck, $behaviorSmoke, $pilotSmoke, $suppressionSmoke, $forwardRollback, $postRollback)

function Get-LowerSha256([string]$Value) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
    return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
  } finally { $sha.Dispose() }
}

function Get-FileSha256([string]$Path) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    return ([System.BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
  } finally {
    $stream.Dispose()
    $sha.Dispose()
  }
}

function Assert-StaticInputs {
  foreach ($file in $allFiles) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "GATE_INPUT_MISSING: $file" }
    $item = Get-Item -LiteralPath $file
    $hash = Get-FileSha256 $file
    Write-Output "GATE_INPUT sha256=$hash bytes=$($item.Length) path=$file"
  }
  if ((Get-Item -LiteralPath $noopMigration).Length -eq 0) {
    throw "NOOP_MIGRATION_EMPTY: $noopMigration must contain the reviewed no-op decision."
  }
  $noopMigrationActualSha256 = Get-FileSha256 $noopMigration
  if ($noopMigrationActualSha256 -ne $noopMigrationExpectedSha256) {
    throw "NOOP_MIGRATION_INTEGRITY_MISMATCH: expected_sha256=$noopMigrationExpectedSha256 actual_sha256=$noopMigrationActualSha256 path=$noopMigration"
  }
  $noopMigrationContent = Get-Content -LiteralPath $noopMigration -Raw
  $decisionMarker = "-- EMPTY_MIGRATION_DECISION_ID: $noopMigrationDecisionId"
  if ([regex]::Matches($noopMigrationContent, "(?m)^$([regex]::Escape($decisionMarker))`r?$", [System.Text.RegularExpressions.RegexOptions]::CultureInvariant).Count -ne 1) {
    throw "NOOP_MIGRATION_DECISION_MISMATCH: expected_decision_id=$noopMigrationDecisionId path=$noopMigration"
  }
  if ($noopMigrationContent -notmatch '(?m)^-- SUPERSEDED_BY: 20260819170000_cold_campaign_scheduler\.sql\r?$') {
    throw "NOOP_MIGRATION_SUCCESSOR_MISMATCH: path=$noopMigration"
  }
  Write-Output "NOOP_MIGRATION_DECISION_VERIFIED id=$noopMigrationDecisionId sha256=$noopMigrationActualSha256 path=$noopMigration"
}

function Assert-AuthorizedStaging {
  if ($Environment -eq 'none') { throw 'STAGING_ENVIRONMENT_REQUIRED' }
  if ($env:FUNDAE_SUPABASE_GATE_ACK -ne 'I_AUTHORIZE_STAGING_SQL_GATES') { throw 'STAGING_AUTHORIZATION_ACK_REQUIRED' }
  if ([string]::IsNullOrWhiteSpace($env:PGHOST)) { throw 'PGHOST_REQUIRED' }
  if ([string]::IsNullOrWhiteSpace($env:FUNDAE_STAGING_PGHOST_SHA256) -or
      $env:FUNDAE_STAGING_PGHOST_SHA256 -notmatch '^[a-f0-9]{64}$') { throw 'FUNDAE_STAGING_PGHOST_SHA256_REQUIRED' }
  if ((Get-LowerSha256 $env:PGHOST.ToLowerInvariant()) -ne $env:FUNDAE_STAGING_PGHOST_SHA256) { throw 'STAGING_HOST_FINGERPRINT_MISMATCH' }
  if ($env:PGSSLMODE -notin @('require', 'verify-ca', 'verify-full')) { throw 'PGSSLMODE_MUST_REQUIRE_TLS' }
  if ([string]::IsNullOrWhiteSpace($env:PGDATABASE) -or [string]::IsNullOrWhiteSpace($env:PGUSER)) { throw 'PGDATABASE_AND_PGUSER_REQUIRED' }
  $null = Get-Command 'psql.exe' -ErrorAction Stop
}

function Invoke-GateSql([string]$File, [string[]]$Variables = @()) {
  $hash = Get-FileSha256 $File
  Write-Output "GATE_START sha256=$hash path=$File"
  $arguments = @('-X', '--set=ON_ERROR_STOP=1', '--set=VERBOSITY=verbose')
  foreach ($variable in $Variables) { $arguments += "--set=$variable" }
  $arguments += "--file=$File"
  & psql.exe @arguments
  if ($LASTEXITCODE -ne 0) { throw "PSQL_GATE_FAILED exit_code=$LASTEXITCODE sha256=$hash path=$File" }
  Write-Output "GATE_PASS sha256=$hash path=$File"
}

Assert-StaticInputs
if ($Mode -eq 'Static') { Write-Output 'FUNDAE_SUPABASE_GATE_PACK_STATIC_OK'; exit 0 }
Assert-AuthorizedStaging
$env:PGOPTIONS = '-c lock_timeout=10000 -c statement_timeout=600000 -c idle_in_transaction_session_timeout=600000'

if ($Mode -eq 'ApplyAndSmoke') {
  if ($Environment -ne 'staging') { throw 'APPLY_AND_SMOKE_REQUIRES_STAGING' }
  Invoke-GateSql $precheck
  foreach ($migration in $migrationFiles) { Invoke-GateSql $migration }
  Invoke-GateSql $postcheck
  Invoke-GateSql $behaviorSmoke
  Invoke-GateSql $pilotSmoke
  Invoke-GateSql $suppressionSmoke
  Write-Output 'FUNDAE_SUPABASE_STAGING_APPLY_AND_SMOKE_OK'
  exit 0
}

if ($Environment -ne 'disposable-staging') { throw 'ROLLBACK_SMOKE_REQUIRES_DISPOSABLE_STAGING' }
if ($env:FUNDAE_SQL_OPERATOR_HASH -notmatch '^[a-f0-9]{64}$' -or $env:FUNDAE_SQL_OPERATOR_HASH -eq ('0' * 64)) { throw 'FUNDAE_SQL_OPERATOR_HASH_REQUIRED' }
Invoke-GateSql $forwardRollback @("operator_hash=$($env:FUNDAE_SQL_OPERATOR_HASH)")
Invoke-GateSql $postRollback
Write-Output 'FUNDAE_SUPABASE_DISPOSABLE_ROLLBACK_SMOKE_OK'
