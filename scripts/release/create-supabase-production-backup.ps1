$ErrorActionPreference = "Stop"

$expectedProjectRef = "vftwranrgvbtqfiwtqjz"
$expectedHost = "aws-0-eu-west-1.pooler.supabase.com"
$clipboard = [string](Get-Clipboard -Raw)
$connectionMatch = [regex]::Match(
  $clipboard,
  '(?i)(?:postgres|postgresql)://(?<user>[^:\s]+):\[YOUR-PASSWORD\]@(?<host>[^:/\s]+):(?<port>\d+)/(?<database>[^?\s`"'']+)'
)

if (-not $connectionMatch.Success) {
  throw "No se encontró en el portapapeles una URI de Session pooler con [YOUR-PASSWORD]."
}

$databaseUser = $connectionMatch.Groups["user"].Value
$databaseHost = $connectionMatch.Groups["host"].Value
$databasePort = $connectionMatch.Groups["port"].Value
$databaseName = $connectionMatch.Groups["database"].Value

if ($databaseHost -ne $expectedHost -or $databaseUser -ne "postgres.$expectedProjectRef" -or $databaseName -ne "postgres") {
  throw "La URI copiada no corresponde al proyecto de producción esperado."
}

$securePassword = Read-Host "Escribe la contraseña de la base de datos (no se mostrará)" -AsSecureString
$credential = [System.Management.Automation.PSCredential]::new("postgres", $securePassword)
$plainPassword = $credential.GetNetworkCredential().Password

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$backupDirectory = Join-Path $repoRoot "data-private\supabase-backups"
$backupFileName = "fundae-production-pre-migration-{0}.dump" -f (Get-Date -Format "yyyyMMdd-HHmmss")
$backupPath = Join-Path $backupDirectory $backupFileName

New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null

try {
  $env:PGPASSWORD = $plainPassword
  $env:PGSSLMODE = "require"

  & docker run --rm `
    --env PGPASSWORD `
    --env PGSSLMODE `
    --mount "type=bind,source=$backupDirectory,target=/backup" `
    postgres:17 `
    pg_dump `
    --host=$databaseHost `
    --port=$databasePort `
    --username=$databaseUser `
    --dbname=$databaseName `
    --format=custom `
    --no-owner `
    --no-privileges `
    --file="/backup/$backupFileName"

  if ($LASTEXITCODE -ne 0) {
    throw "pg_dump terminó con código $LASTEXITCODE."
  }

  if (-not (Test-Path -LiteralPath $backupPath) -or (Get-Item -LiteralPath $backupPath).Length -le 0) {
    throw "La copia no se creó correctamente."
  }

  & docker run --rm `
    --mount "type=bind,source=$backupDirectory,target=/backup,readonly" `
    postgres:17 `
    pg_restore --list "/backup/$backupFileName" | Out-Null

  if ($LASTEXITCODE -ne 0) {
    throw "La copia existe, pero no superó la verificación de lectura."
  }

  $backupStream = [System.IO.File]::OpenRead($backupPath)
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      $backupHash = ([System.BitConverter]::ToString($sha256.ComputeHash($backupStream))).Replace("-", "").ToLowerInvariant()
    }
    finally {
      $sha256.Dispose()
    }
  }
  finally {
    $backupStream.Dispose()
  }
  Write-Host ""
  Write-Host "COPIA VERIFICADA" -ForegroundColor Green
  Write-Host "Archivo: $backupPath"
  Write-Host "SHA-256: $backupHash"
}
finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue
  Remove-Variable plainPassword, securePassword, credential -ErrorAction SilentlyContinue
}

Read-Host "Pulsa Enter para cerrar"
