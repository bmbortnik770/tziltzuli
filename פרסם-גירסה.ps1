Add-Type -AssemblyName System.Windows.Forms
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$gh   = "C:\Users\user\AppData\Local\gh-cli\bin\gh.exe"

# Read version from server.js
$verMatch = Select-String "CURRENT_VERSION\s*=\s*'([^']+)'" "$root\school-bells-server\server.js"
if (-not $verMatch) {
    [Windows.Forms.MessageBox]::Show("לא נמצאה גירסה ב-server.js", "שגיאה", 'OK', 'Error') | Out-Null
    exit 1
}
$ver = $verMatch.Matches[0].Groups[1].Value

$ans = [Windows.Forms.MessageBox]::Show(
    "פרסום גירסה $ver ל-GitHub`n`nזה יעלה:`n• tziltzuli-install.zip  (התקנה חדשה)`n• tziltzuli-update-v$ver.zip  (עדכון אוטומטי)`n• עדכון ל-version.json`n`nלהמשיך?",
    "פרסום גירסה $ver",
    [Windows.Forms.MessageBoxButtons]::YesNo,
    [Windows.Forms.MessageBoxIcon]::Question)
if ($ans -ne 'Yes') { exit }

$env:PATH = [Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH','User')

# ── 1. Build UI ──────────────────────────────────────────────────
Write-Host "בונה ממשק..."
Push-Location "$root\school-bells-ui"
npm run build 2>&1 | Out-Null
Pop-Location

# ── 2. Apply UTF-8 BOM to all PS1 files in ZIP ───────────────────
Write-Host "מוודא קידוד BOM..."
foreach ($f in @('מתקין-צילצולי.ps1','הסר-צילצולי.ps1','פרסם-גירסה.ps1')) {
    $fp = "$root\$f"
    if (Test-Path $fp) {
        $content = [System.IO.File]::ReadAllText($fp, [System.Text.Encoding]::UTF8)
        [System.IO.File]::WriteAllText($fp, $content, (New-Object System.Text.UTF8Encoding $true))
    }
}

# ── 3. Build installer ZIP ───────────────────────────────────────
Write-Host "בונה ZIP התקנה..."
$tmp = "$env:TEMP\tziltzuli-release-pkg"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item $tmp -ItemType Directory -Force | Out-Null

# Internal folder uses English name only — Hebrew in VBS paths breaks on non-Hebrew Windows locales
$inner = "$tmp\_setup"
New-Item $inner -ItemType Directory -Force | Out-Null

$srvDst = "$inner\school-bells-server"
New-Item $srvDst -ItemType Directory -Force | Out-Null
New-Item "$srvDst\uploads" -ItemType Directory -Force | Out-Null
foreach ($f in @('server.js','package.json','package-lock.json','announce.html')) {
    $p = "$root\school-bells-server\$f"; if (Test-Path $p) { Copy-Item $p $srvDst }
}
Copy-Item "$root\school-bells-server\public" "$srvDst\public" -Recurse -EA SilentlyContinue

$uiDst = "$inner\school-bells-ui"
Copy-Item "$root\school-bells-ui" $uiDst -Recurse
Remove-Item "$uiDst\node_modules" -Recurse -Force -EA SilentlyContinue
Remove-Item "$uiDst\dist"         -Recurse -Force -EA SilentlyContinue

# Copy PS1 files with English names so VBS paths stay ASCII-safe
Copy-Item "$root\מתקין-צילצולי.ps1" "$inner\installer.ps1"
Copy-Item "$root\הסר-צילצולי.ps1"   "$inner\uninstaller.ps1"

# Entry-point VBS — all paths are English only (Hebrew breaks on non-Hebrew Windows locales)
@'
Set oFSO   = CreateObject("Scripting.FileSystemObject")
Set oShell = CreateObject("WScript.Shell")
sRoot = oFSO.GetParentFolderName(WScript.ScriptFullName)
sPS1  = sRoot & "\_setup\installer.ps1"
If Not oFSO.FileExists(sPS1) Then
    MsgBox "Error: installer files not found in _setup folder.", 16, "Installation Error"
    WScript.Quit 1
End If
ret = oShell.Run("powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & sPS1 & """ """ & sRoot & """", 0, True)
If ret <> 0 Then
    MsgBox "Installer exited with error code " & ret & "." & vbCrLf & "Try right-click > Run as administrator.", 16, "Installation Error"
End If
'@ | Set-Content "$tmp\התקנת צילצולי.vbs" -Encoding ASCII

$installZip = "$env:TEMP\tziltzuli-install.zip"
if (Test-Path $installZip) { Remove-Item $installZip -Force }
Compress-Archive -Path "$tmp\*" -DestinationPath $installZip -Force
Remove-Item $tmp -Recurse -Force

# ── 4. Build update ZIP ──────────────────────────────────────────
Write-Host "בונה ZIP עדכון..."
$tmpU = "$env:TEMP\tziltzuli-update-build"
if (Test-Path $tmpU) { Remove-Item $tmpU -Recurse -Force }
New-Item $tmpU -ItemType Directory -Force | Out-Null
Copy-Item "$root\school-bells-server\server.js" $tmpU
Copy-Item "$root\school-bells-server\public"    "$tmpU\public" -Recurse -EA SilentlyContinue
$updateZip = "$env:TEMP\tziltzuli-update-v$ver.zip"
if (Test-Path $updateZip) { Remove-Item $updateZip -Force }
Compress-Archive -Path "$tmpU\*" -DestinationPath $updateZip -Force
Remove-Item $tmpU -Recurse -Force

# ── 5. Update version.json ───────────────────────────────────────
Write-Host "מעדכן version.json..."
$jsonPath = "$root\version.json"
@{
    version = $ver
    url     = "https://github.com/bmbortnik770/tziltzuli/releases/download/v$ver/tziltzuli-update-v$ver.zip"
    notes   = "גירסה $ver"
    date    = (Get-Date -Format 'yyyy-MM-dd')
} | ConvertTo-Json | Set-Content $jsonPath -Encoding UTF8

# ── 6. Push version.json to GitHub ──────────────────────────────
Write-Host "מעדכן GitHub..."
$tmpGit = "$env:TEMP\tziltzuli-git-push"
if (Test-Path $tmpGit) { Remove-Item $tmpGit -Recurse -Force }
New-Item $tmpGit -ItemType Directory -Force | Out-Null
Push-Location $tmpGit

$ea = $ErrorActionPreference
$ErrorActionPreference = 'SilentlyContinue'
git init -b main          | Out-Null
git config user.email "bmbortnik770@gmail.com" | Out-Null
git config user.name  "bmbortnik770"           | Out-Null
git remote add origin "https://github.com/bmbortnik770/tziltzuli.git" | Out-Null
git fetch origin main --depth=1               | Out-Null
git checkout -b main --track origin/main      | Out-Null
Copy-Item $jsonPath "$tmpGit\version.json" -Force
git add version.json                          | Out-Null
git commit -m "Release v$ver"                 | Out-Null
git push origin main                          | Out-Null
$ErrorActionPreference = $ea

Pop-Location
Remove-Item $tmpGit -Recurse -Force -EA SilentlyContinue

# ── 7. Create GitHub release ─────────────────────────────────────
Write-Host "מפרסם ל-GitHub Releases..."

# Delete existing release with same tag if exists
$ErrorActionPreference = 'SilentlyContinue'
& $gh release delete "v$ver" --repo bmbortnik770/tziltzuli --yes 2>$null | Out-Null
& $gh tag delete "v$ver" --repo bmbortnik770/tziltzuli 2>$null | Out-Null
$ErrorActionPreference = 'Continue'

$ghOut = & $gh release create "v$ver" $installZip $updateZip `
    --repo bmbortnik770/tziltzuli `
    --title "צילצולי v$ver" `
    --notes "גירסה $ver" 2>&1

Write-Host $ghOut

Remove-Item $installZip,$updateZip -Force -EA SilentlyContinue

if ($LASTEXITCODE -eq 0) {
    [Windows.Forms.MessageBox]::Show(
        "✅ גירסה $ver פורסמה בהצלחה!`n`nקישור הורדה ללקוחות:`nhttps://github.com/bmbortnik770/tziltzuli/releases/latest/download/tziltzuli-install.zip`n`nלקוחות קיימים יתעדכנו אוטומטית.",
        "פורסם!",
        [Windows.Forms.MessageBoxButtons]::OK,
        [Windows.Forms.MessageBoxIcon]::Information) | Out-Null
} else {
    [Windows.Forms.MessageBox]::Show(
        "⚠️ הפרסום הסתיים עם שגיאה בשלב GitHub Release.`n`nבדוק בחלון הקונסול את הפרטים.",
        "אזהרה",
        [Windows.Forms.MessageBoxButtons]::OK,
        [Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
}
