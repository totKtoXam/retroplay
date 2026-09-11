# Retro3D Automated Deployment Script (PowerShell)
# Usage: .\scripts\deploy.ps1 [-Message "commit message"] [-SkipCommit]

param(
    [string]$Message = "",
    [switch]$SkipCommit = $false,
    [string]$RemoteHost = "192.168.56.70",
    [int]$RemotePort = 2222,
    [string]$RemoteUser = "user",
    [string]$RemoteDir = "/home/user/projects/retro3d",
    [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "🚀 Retro3D Automated Deployment" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# 1. Run local checks
Write-Host "`n[1/6] Running local test suite..." -ForegroundColor Yellow
npm test
if ($LASTEXITCODE -ne 0) {
    Write-Error "Local tests failed! Deployment aborted."
    exit 1
}

Write-Host "`n[2/6] Checking TypeScript type correctness..." -ForegroundColor Yellow
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) {
    Write-Error "TypeScript compilation failed! Deployment aborted."
    exit 1
}

# 2. Stage and commit if needed
if (-not $SkipCommit) {
    $status = git status --porcelain
    if ($status) {
        Write-Host "`n[3/6] Changes detected. Staging and committing..." -ForegroundColor Yellow
        git add .
        if ([string]::IsNullOrWhiteSpace($Message)) {
            $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
            $Message = "feat: automated deployment updates ($timestamp)"
        }
        git commit -m "$Message"
    } else {
        Write-Host "`n[3/6] Working directory clean, nothing to commit." -ForegroundColor Green
    }
}

# 3. Push to remote origin
Write-Host "`n[4/6] Pushing to origin/$Branch..." -ForegroundColor Yellow
git push origin $Branch
if ($LASTEXITCODE -ne 0) {
    Write-Error "Git push failed! Deployment aborted."
    exit 1
}

# 4. Deploy to Remote Server via SSH
Write-Host "`n[5/6] Deploying to $RemoteUser@$RemoteHost`:$RemotePort..." -ForegroundColor Yellow

# Migrations, tests, production build and restart live in scripts/server-deploy.sh,
# which is run from the freshly pulled revision.
$remoteCommand = @"
set -e
echo "==> Updating repository in $RemoteDir..."
cd "$RemoteDir"
PREV_HEAD=`$(git rev-parse HEAD)
git fetch origin
git checkout "$Branch"
git pull --ff-only origin "$Branch"
bash scripts/server-deploy.sh "`$PREV_HEAD"
"@

$remoteCommand = $remoteCommand.Replace("`r", "")
ssh -p $RemotePort "$RemoteUser@$RemoteHost" "$remoteCommand"
if ($LASTEXITCODE -ne 0) {
    Write-Error "Remote deployment failed!"
    exit 1
}

# 5. Final health check from local machine
Write-Host "`n[6/6] Checking remote HTTP endpoint from local machine..." -ForegroundColor Yellow
$lastError = $null
for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $response = Invoke-WebRequest -Uri "http://${RemoteHost}:3001/" -UseBasicParsing -TimeoutSec 20
        $sw.Stop()
        if ($response.StatusCode -eq 200) {
            Write-Host "`n✅ DEPLOYMENT SUCCESSFUL!" -ForegroundColor Green
            Write-Host "   Target:  http://${RemoteHost}:3001/" -ForegroundColor Green
            Write-Host "   Latency: $($sw.ElapsedMilliseconds) ms" -ForegroundColor Green
            $lastError = $null
            break
        }
        $lastError = "HTTP status code $($response.StatusCode)"
    } catch {
        $lastError = "$_"
    }
    Start-Sleep -Seconds 3
}
if ($lastError) {
    Write-Warning "Could not get HTTP 200 from http://${RemoteHost}:3001/ after 3 attempts: $lastError"
}
