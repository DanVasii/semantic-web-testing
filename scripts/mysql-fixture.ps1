param(
  [Parameter(Position = 0)]
  [ValidateSet("start", "stop", "status", "reset")]
  [string]$Action = "start"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RuntimeDirectory = Join-Path $ProjectRoot "runtime\mysql-fixture"
$ApiPidFile = Join-Path $RuntimeDirectory "api.pid"
$WebPidFile = Join-Path $RuntimeDirectory "web.pid"
$ApiHealthUrl = "http://127.0.0.1:4174/api/health"
$WebUrl = "http://127.0.0.1:4173/"

function Resolve-NodeExecutable {
  $NodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($null -ne $NodeCommand) {
    return $NodeCommand.Source
  }

  throw "Node.js nu a fost găsit în PATH. Instalează Node.js și redeschide terminalul."
}

function Get-OwnedProcess {
  param([string]$PidFile)

  if (!(Test-Path -LiteralPath $PidFile)) {
    return $null
  }

  $SavedPid = (Get-Content -LiteralPath $PidFile -Raw).Trim()
  if ($SavedPid -notmatch "^\d+$") {
    return $null
  }

  return Get-Process -Id ([int]$SavedPid) -ErrorAction SilentlyContinue
}

function Test-HttpEndpoint {
  param([string]$Url)

  try {
    $Response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return $Response.StatusCode -ge 200 -and $Response.StatusCode -lt 400
  } catch {
    return $false
  }
}

function Wait-HttpEndpoint {
  param(
    [string]$Url,
    [int]$Attempts = 30
  )

  for ($Attempt = 1; $Attempt -le $Attempts; $Attempt += 1) {
    if (Test-HttpEndpoint -Url $Url) {
      return
    }
    Start-Sleep -Milliseconds 300
  }

  throw "Serviciul nu a devenit disponibil la $Url."
}

function Start-HiddenNodeProcess {
  param([string[]]$Arguments)

  $StartInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $StartInfo.FileName = $NodeExecutable
  $StartInfo.WorkingDirectory = $ProjectRoot
  $StartInfo.UseShellExecute = $false
  $StartInfo.CreateNoWindow = $true
  $StartInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  $StartInfo.Arguments = (
    $Arguments |
      ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }
  ) -join " "

  $Process = [System.Diagnostics.Process]::new()
  $Process.StartInfo = $StartInfo
  if (!$Process.Start()) {
    throw "Procesul Node.js nu a putut fi pornit."
  }
  return $Process
}

function Stop-OwnedProcess {
  param(
    [string]$Name,
    [string]$PidFile
  )

  $Process = Get-OwnedProcess -PidFile $PidFile
  if ($null -ne $Process) {
    Stop-Process -Id $Process.Id
    $Process.WaitForExit(5000)
    Write-Host "$Name oprit (PID $($Process.Id))."
  }
  if (Test-Path -LiteralPath $PidFile) {
    Remove-Item -LiteralPath $PidFile -Force
  }
}

$NodeExecutable = Resolve-NodeExecutable

switch ($Action) {
  "start" {
    New-Item -ItemType Directory -Path $RuntimeDirectory -Force | Out-Null

    & $NodeExecutable (Join-Path $ProjectRoot "scripts\setup-mysql-fixture.mjs")
    if ($LASTEXITCODE -ne 0) {
      throw "Inițializarea bazei de date a eșuat."
    }

    if (Test-HttpEndpoint -Url $ApiHealthUrl) {
      Write-Host "API-ul MySQL este deja disponibil; îl reutilizez."
    } else {
      $ApiProcess = Start-HiddenNodeProcess -Arguments @(
        (Join-Path $ProjectRoot "scripts\mysql-fixture-server.mjs")
      )
      Set-Content -LiteralPath $ApiPidFile -Value $ApiProcess.Id
    }

    if (Test-HttpEndpoint -Url $WebUrl) {
      Write-Host "Fixture-ul web este deja disponibil; îl reutilizez."
    } else {
      $WebProcess = Start-HiddenNodeProcess -Arguments @(
        (Join-Path $ProjectRoot "node_modules\vite\bin\vite.js"),
        "fixtures/web",
        "--host",
        "127.0.0.1",
        "--port",
        "4173",
        "--strictPort"
      )
      Set-Content -LiteralPath $WebPidFile -Value $WebProcess.Id
    }

    try {
      Wait-HttpEndpoint -Url $ApiHealthUrl
      Wait-HttpEndpoint -Url $WebUrl
    } catch {
      Stop-OwnedProcess -Name "Web fixture" -PidFile $WebPidFile
      Stop-OwnedProcess -Name "MySQL fixture API" -PidFile $ApiPidFile
      throw
    }

    Write-Host "Fixture MySQL pornit."
    Write-Host "Web: $WebUrl"
    Write-Host "API: $ApiHealthUrl"
    Write-Host "Bază de date: semantic_fixture pe 127.0.0.1:3306 (root, parolă goală)"
  }

  "stop" {
    Stop-OwnedProcess -Name "Web fixture" -PidFile $WebPidFile
    Stop-OwnedProcess -Name "MySQL fixture API" -PidFile $ApiPidFile
  }

  "status" {
    $ApiRunning = Test-HttpEndpoint -Url $ApiHealthUrl
    $WebRunning = Test-HttpEndpoint -Url $WebUrl
    Write-Host "API MySQL: $(if ($ApiRunning) { 'online' } else { 'offline' })"
    Write-Host "Web fixture: $(if ($WebRunning) { 'online' } else { 'offline' })"
  }

  "reset" {
    if (!(Test-HttpEndpoint -Url $ApiHealthUrl)) {
      throw "API-ul fixture nu este pornit."
    }
    Invoke-RestMethod -Uri "http://127.0.0.1:4174/api/reset" -Method Post | Out-Null
    Write-Host "Datele introduse prin fixture au fost șterse; sloturile seed au fost păstrate."
  }
}
