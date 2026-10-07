$ErrorActionPreference = "Stop"

$Repo = Join-Path $HOME "pumplite"
$Mint = "EUKhN8eP97NjRHzxwRT5pdgLg7BX5KRTBhJYa2hMu9ma"

Write-Host ""
Write-Host "============================================"
Write-Host " PumpLite PLSOL blockhash-expiry hotfix"
Write-Host "============================================"
Write-Host ""

if (-not (Test-Path (Join-Path $Repo ".git"))) {
    throw "STOP - PumpLite repo not found at $Repo"
}

Set-Location $Repo

$dirty = git status --porcelain
if ($LASTEXITCODE -ne 0) {
    throw "STOP - git status failed"
}
if ($dirty) {
    Write-Host $dirty
    throw "STOP - repo has uncommitted changes. Commit/stash them first so this hotfix cannot overwrite your work."
}

git switch main
if ($LASTEXITCODE -ne 0) {
    throw "STOP - could not switch to main"
}

git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) {
    throw "STOP - could not fast-forward main"
}

$chunkPath = Join-Path $Repo "assets\chunks\solana-tiny-ZZM2EEWQ.js"
$appPath   = Join-Path $Repo "assets\app.js"
$indexPath = Join-Path $Repo "index.html"

foreach ($p in @($chunkPath, $appPath, $indexPath)) {
    if (-not (Test-Path $p)) {
        throw "STOP - required file missing: $p"
    }
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# ------------------------------------------------------------------
# 1) Fresh blockhash immediately before Phantom signing.
#
# The previous release fetched the blockhash before the pre-sign
# simulation. If enough time passed before/after Phantom approval,
# Solana could reject confirmation with:
#   "block height exceeded"
#
# This refreshes the blockhash AFTER the safety preview, rebuilds the
# immutable transaction snapshot against that exact fresh message, and
# then asks Phantom to sign it.
# ------------------------------------------------------------------

$chunk = [System.IO.File]::ReadAllText($chunkPath)

$oldSign = 'if(b.error||!b.result?.value||b.result.value.err!==null)throw Error("Pre-sign simulation failed: "+JSON.stringify(b.error||b.result?.value?.err||"missing response"));r("Review and approve the PumpLite transaction in Phantom.");let g=await T.signTransaction(c),P='

$newSign = 'if(b.error||!b.result?.value||b.result.value.err!==null)throw Error("Pre-sign simulation failed: "+JSON.stringify(b.error||b.result?.value?.err||"missing response"));o=await v.getLatestBlockhash("confirmed"),c.recentBlockhash=o.blockhash,u=oe.from(c.serialize({requireAllSignatures:!1,verifySignatures:!1})),h=ke(u),r("Review and approve the PumpLite transaction in Phantom.");let g=await T.signTransaction(c),P='

if ($chunk.Contains($oldSign)) {
    $chunk = $chunk.Replace($oldSign, $newSign)
    Write-Host "PASS - fresh pre-Phantom blockhash patch applied"
}
elseif ($chunk.Contains('c.recentBlockhash=o.blockhash')) {
    Write-Host "PASS - fresh pre-Phantom blockhash patch already present"
}
else {
    throw "STOP - expected Phantom signing code was not found. No unsafe blind edit was made."
}

# Give the RPC relay a few bounded resend opportunities for the SAME
# signed Solana transaction/signature. This cannot execute the same
# signature twice, and is much safer than maxRetries:0 for inclusion.
if ($chunk.Contains('maxRetries:0')) {
    $chunk = $chunk.Replace('maxRetries:0', 'maxRetries:5')
    Write-Host "PASS - broadcast retries changed from 0 to 5"
}
elseif ($chunk.Contains('maxRetries:5')) {
    Write-Host "PASS - bounded broadcast retries already present"
}
else {
    throw "STOP - expected maxRetries setting was not found"
}

[System.IO.File]::WriteAllText($chunkPath, $chunk, $utf8NoBom)

# ------------------------------------------------------------------
# 2) Cache-bust only the Solana adapter import, so Android/Phantom
# cannot keep serving the old chunk from cache.
# ------------------------------------------------------------------

$app = [System.IO.File]::ReadAllText($appPath)

$oldImport = './chunks/solana-tiny-ZZM2EEWQ.js'
$newImport = './chunks/solana-tiny-ZZM2EEWQ.js?v=blockhash-r2'

if ($app.Contains($newImport)) {
    Write-Host "PASS - Solana adapter cache-bust already present"
}
elseif ($app.Contains($oldImport)) {
    $app = $app.Replace($oldImport, $newImport)
    [System.IO.File]::WriteAllText($appPath, $app, $utf8NoBom)
    Write-Host "PASS - Solana adapter cache-bust applied"
}
else {
    throw "STOP - Solana adapter import was not found"
}

# Also refresh the top-level app module URL.
$index = [System.IO.File]::ReadAllText($indexPath)
if ($index.Contains('?boot=sealed-r2')) {
    Write-Host "PASS - app boot cache-bust already present"
}
elseif ($index.Contains('?boot=sealed-r1')) {
    $index = $index.Replace('?boot=sealed-r1', '?boot=sealed-r2')
    [System.IO.File]::WriteAllText($indexPath, $index, $utf8NoBom)
    Write-Host "PASS - app boot cache-bust applied"
}
else {
    throw "STOP - expected PumpLite boot tag was not found"
}

Write-Host ""
Write-Host "Checking JavaScript syntax..."

node --check $chunkPath
if ($LASTEXITCODE -ne 0) {
    throw "STOP - Solana adapter JavaScript syntax check failed"
}

node --check $appPath
if ($LASTEXITCODE -ne 0) {
    throw "STOP - app JavaScript syntax check failed"
}

Write-Host "PASS - JavaScript syntax checks"
Write-Host ""

git diff --check
if ($LASTEXITCODE -ne 0) {
    throw "STOP - git diff whitespace/error check failed"
}

$changed = git status --porcelain
if (-not $changed) {
    Write-Host "Nothing to commit - hotfix is already installed."
}
else {
    Write-Host "Files changed:"
    git status --short

    git add -- "assets/chunks/solana-tiny-ZZM2EEWQ.js" "assets/app.js" "index.html"
    if ($LASTEXITCODE -ne 0) {
        throw "STOP - git add failed"
    }

    git commit -m "Fix Solana transaction blockhash expiry"
    if ($LASTEXITCODE -ne 0) {
        throw "STOP - git commit failed"
    }

    git push origin main
    if ($LASTEXITCODE -ne 0) {
        throw "STOP - git push failed"
    }

    Write-Host ""
    Write-Host "PUSHED TO MAIN ✅"
}

Write-Host ""
Write-Host "============================================"
Write-Host " PLSOL HOTFIX COMPLETE ✅"
Write-Host "============================================"
Write-Host ""
Write-Host "What changed:"
Write-Host " - fresh Solana blockhash immediately before Phantom signing"
Write-Host " - transaction safety snapshot rebuilt for that exact fresh message"
Write-Host " - same signed transaction gets up to 5 bounded broadcast retries"
Write-Host " - browser cache-bust added so the new Solana chunk loads"
Write-Host ""
Write-Host "PLSOL mint:"
Write-Host $Mint
Write-Host ""
Write-Host "After GitHub Pages updates, open:"
Write-Host "https://frymastercheese.github.io/pumplite/?fix=blockhash-r2#solana/$Mint"
Write-Host ""
Write-Host "Do ONE 0.0001 SOL test only. Do not repeatedly retry if anything looks different."
