Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'SilentlyContinue'
$root = if ($args[0] -and (Test-Path $args[0])) { $args[0] } else { Split-Path -Parent $MyInvocation.MyCommand.Path }

# ── Colors & Fonts ───────────────────────────────────────────────
$cBg     = [Drawing.Color]::FromArgb(245,248,255)
$cWhite  = [Drawing.Color]::White
$cBlue   = [Drawing.Color]::FromArgb(37,99,235)
$cBlueLt = [Drawing.Color]::FromArgb(219,234,254)
$cBlueDk = [Drawing.Color]::FromArgb(29,78,216)
$cGreen  = [Drawing.Color]::FromArgb(22,163,74)
$cRed    = [Drawing.Color]::FromArgb(220,38,38)
$cText   = [Drawing.Color]::FromArgb(15,23,42)
$cGray   = [Drawing.Color]::FromArgb(100,116,139)
$cGrayLt = [Drawing.Color]::FromArgb(203,213,225)
$cInfoBg = [Drawing.Color]::FromArgb(241,245,255)
$cSep    = [Drawing.Color]::FromArgb(226,232,240)

$fTitle = New-Object Drawing.Font('Segoe UI',20,[Drawing.FontStyle]::Bold)
$fBig   = New-Object Drawing.Font('Segoe UI',13,[Drawing.FontStyle]::Bold)
$fNorm  = New-Object Drawing.Font('Segoe UI',10)
$fBold  = New-Object Drawing.Font('Segoe UI',10,[Drawing.FontStyle]::Bold)
$fSmall = New-Object Drawing.Font('Segoe UI',9)
$fBtn   = New-Object Drawing.Font('Segoe UI',11,[Drawing.FontStyle]::Bold)
$fStep  = New-Object Drawing.Font('Segoe UI',10)
$fDone  = New-Object Drawing.Font('Segoe UI',15,[Drawing.FontStyle]::Bold)

function Make-Label($txt,$x,$y,$w,$h,$fnt=$fNorm,$clr=$cText,$al='MiddleRight') {
    $l = New-Object Windows.Forms.Label
    $l.Text=$txt; $l.Location=[Drawing.Point]::new($x,$y)
    $l.Size=[Drawing.Size]::new($w,$h)
    $l.Font=$fnt; $l.ForeColor=$clr
    $l.TextAlign=[Drawing.ContentAlignment]::$al
    $l.BackColor=[Drawing.Color]::Transparent
    return $l
}

# ── Form ─────────────────────────────────────────────────────────
$form = New-Object Windows.Forms.Form
$form.Text = 'התקנת צילצולי'
$form.ClientSize = [Drawing.Size]::new(580,590)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false
$form.BackColor = $cBg
$form.RightToLeft = 'Yes'
$form.Font = $fNorm

# ── Header ───────────────────────────────────────────────────────
$hdr = New-Object Windows.Forms.Panel
$hdr.Size=[Drawing.Size]::new(580,102); $hdr.Location=[Drawing.Point]::new(0,0)
$hdr.BackColor=$cBlue; $hdr.RightToLeft='No'; $form.Controls.Add($hdr)
$hdr.Controls.Add((Make-Label '🔔' 10 12 64 78 (New-Object Drawing.Font('Segoe UI Emoji',32)) $cWhite 'MiddleCenter'))
$hdr.Controls.Add((Make-Label 'צילצולי' 10 8 556 46 $fTitle $cWhite 'MiddleRight'))
$hdr.Controls.Add((Make-Label 'מערכת צלצולים חכמה לבתי ספר' 10 54 556 36 $fNorm $cBlueLt 'MiddleRight'))

$sepHdr = New-Object Windows.Forms.Panel
$sepHdr.Size=[Drawing.Size]::new(580,3); $sepHdr.Location=[Drawing.Point]::new(0,102)
$sepHdr.BackColor=$cBlueDk; $form.Controls.Add($sepHdr)

# ── Page 1: Welcome ──────────────────────────────────────────────
$p1 = New-Object Windows.Forms.Panel
$p1.Size=[Drawing.Size]::new(540,406); $p1.Location=[Drawing.Point]::new(20,115)
$p1.BackColor=$cWhite; $p1.BorderStyle='FixedSingle'; $form.Controls.Add($p1)

$p1.Controls.Add((Make-Label 'ברוך הבא!' 10 20 518 36 $fBig $cText 'MiddleRight'))

$sepWelcome = New-Object Windows.Forms.Panel
$sepWelcome.Size=[Drawing.Size]::new(518,1); $sepWelcome.Location=[Drawing.Point]::new(10,66)
$sepWelcome.BackColor=$cSep; $p1.Controls.Add($sepWelcome)

$p1.Controls.Add((Make-Label 'שם בית הספר' 10 80 518 22 $fBold $cGray 'MiddleRight'))
$txtSchool = New-Object Windows.Forms.TextBox
$txtSchool.Location=[Drawing.Point]::new(10,106); $txtSchool.Size=[Drawing.Size]::new(518,32)
$txtSchool.Font=$fBold; $txtSchool.Text='בית הספר שלנו'; $txtSchool.RightToLeft='Yes'
$txtSchool.BackColor=[Drawing.Color]::FromArgb(249,250,251); $txtSchool.BorderStyle='FixedSingle'
$p1.Controls.Add($txtSchool)

$p1.Controls.Add((Make-Label 'שם המנהל / המנהלת' 10 152 518 22 $fBold $cGray 'MiddleRight'))
$txtPrincipal = New-Object Windows.Forms.TextBox
$txtPrincipal.Location=[Drawing.Point]::new(10,178); $txtPrincipal.Size=[Drawing.Size]::new(518,32)
$txtPrincipal.Font=$fBold; $txtPrincipal.Text='המנהל'; $txtPrincipal.RightToLeft='Yes'
$txtPrincipal.BackColor=[Drawing.Color]::FromArgb(249,250,251); $txtPrincipal.BorderStyle='FixedSingle'
$p1.Controls.Add($txtPrincipal)

$info = New-Object Windows.Forms.Panel
$info.Location=[Drawing.Point]::new(10,228); $info.Size=[Drawing.Size]::new(518,148)
$info.BackColor=$cInfoBg; $info.BorderStyle='FixedSingle'; $p1.Controls.Add($info)
$info.Controls.Add((Make-Label 'מה יותקן אוטומטית:' 10 10 496 24 $fBold $cBlue 'MiddleRight'))
$info.Controls.Add((Make-Label '• Node.js  —  סביבת ריצה של JavaScript' 10 38 496 22 $fSmall $cGray 'MiddleRight'))
$info.Controls.Add((Make-Label '• FFmpeg  —  נגינת קבצי שמע' 10 62 496 22 $fSmall $cGray 'MiddleRight'))
$info.Controls.Add((Make-Label '• ספריות תוכנה נדרשות' 10 86 496 22 $fSmall $cGray 'MiddleRight'))
$info.Controls.Add((Make-Label '⏱  ההתקנה אורכת כ-3 עד 5 דקות' 10 116 496 24 $fSmall ([Drawing.Color]::FromArgb(37,99,235)) 'MiddleRight'))

# ── Page 2: Progress ─────────────────────────────────────────────
$p2 = New-Object Windows.Forms.Panel
$p2.Size=[Drawing.Size]::new(540,406); $p2.Location=[Drawing.Point]::new(20,115)
$p2.BackColor=$cWhite; $p2.BorderStyle='FixedSingle'; $p2.Visible=$false; $form.Controls.Add($p2)

$pgBar = New-Object Windows.Forms.ProgressBar
$pgBar.Location=[Drawing.Point]::new(20,20); $pgBar.Size=[Drawing.Size]::new(498,18)
$pgBar.Minimum=0; $pgBar.Maximum=100; $pgBar.Style='Continuous'; $p2.Controls.Add($pgBar)

$stepNames = @(
    'בדיקת Node.js'
    'בדיקת FFmpeg'
    'התקנת ספריות שרת'
    'התקנת ספריות ממשק'
    'בניית ממשק הניהול'
    'יצירת קיצורי דרך'
)
$stepLbls = @()
for ($i=0;$i -lt $stepNames.Count;$i++) {
    $lbl = Make-Label "○   $($stepNames[$i])" 20 (52+$i*54) 498 42 $fStep $cGrayLt 'MiddleRight'
    $p2.Controls.Add($lbl); $stepLbls += $lbl
}
$lblLog = Make-Label '' 20 378 498 22 $fSmall $cGray 'MiddleRight'; $p2.Controls.Add($lblLog)

# ── Page 3: Done ─────────────────────────────────────────────────
$p3 = New-Object Windows.Forms.Panel
$p3.Size=[Drawing.Size]::new(540,406); $p3.Location=[Drawing.Point]::new(20,115)
$p3.BackColor=$cWhite; $p3.BorderStyle='FixedSingle'; $p3.Visible=$false; $form.Controls.Add($p3)
$p3.Controls.Add((Make-Label '✅' 0 40 538 90 (New-Object Drawing.Font('Segoe UI',44)) $cGreen 'MiddleCenter'))
$p3.Controls.Add((Make-Label 'ההתקנה הושלמה בהצלחה!' 0 138 538 48 $fDone $cText 'MiddleCenter'))
$lblDoneSub = Make-Label '' 20 192 496 94 $fNorm $cGray 'MiddleCenter'; $p3.Controls.Add($lblDoneSub)

# ── Separator above buttons ───────────────────────────────────────
$sepBtn = New-Object Windows.Forms.Panel
$sepBtn.Size=[Drawing.Size]::new(540,1); $sepBtn.Location=[Drawing.Point]::new(20,533)
$sepBtn.BackColor=$cSep; $form.Controls.Add($sepBtn)

# ── Buttons ───────────────────────────────────────────────────────
$btnInstall = New-Object Windows.Forms.Button
$btnInstall.Text='התקן עכשיו  ▶'; $btnInstall.Location=[Drawing.Point]::new(155,542)
$btnInstall.Size=[Drawing.Size]::new(270,42); $btnInstall.Font=$fBtn
$btnInstall.BackColor=$cBlue; $btnInstall.ForeColor=$cWhite
$btnInstall.FlatStyle='Flat'; $btnInstall.FlatAppearance.BorderSize=0
$btnInstall.Cursor='Hand'; $form.Controls.Add($btnInstall)

$btnLaunch = New-Object Windows.Forms.Button
$btnLaunch.Text='🔔  הפעל צילצולי'; $btnLaunch.Location=[Drawing.Point]::new(155,542)
$btnLaunch.Size=[Drawing.Size]::new(270,42); $btnLaunch.Font=$fBtn
$btnLaunch.BackColor=$cGreen; $btnLaunch.ForeColor=$cWhite
$btnLaunch.FlatStyle='Flat'; $btnLaunch.FlatAppearance.BorderSize=0
$btnLaunch.Cursor='Hand'; $btnLaunch.Visible=$false; $form.Controls.Add($btnLaunch)

# ── Step helpers ─────────────────────────────────────────────────
function Set-StepState($i,$state) {
    $icons  = @{pending='○   ';running='⏳  ';done='✅  ';skip='⏭   ';error='❌  '}
    $colors = @{pending=$cGrayLt;running=$cBlue;done=$cGreen;skip=$cGray;error=$cRed}
    $stepLbls[$i].Text     = "$($icons[$state])$($stepNames[$i])"
    $stepLbls[$i].ForeColor= $colors[$state]
}

# ── Installation runner ──────────────────────────────────────────
$script:stepIdx = 0
$script:job     = $null

$timer = New-Object Windows.Forms.Timer
$timer.Interval = 600

function Start-Step($i) {
    Set-StepState $i 'running'
    $pgBar.Value = [int](($i / $stepNames.Count) * 88)
    $lblLog.Text = "מריץ: $($stepNames[$i])..."
    [Windows.Forms.Application]::DoEvents()

    switch ($i) {
        0 { # Node.js
            $script:job = Start-Job {
                param($r)
                if (Get-Command node -EA SilentlyContinue) { return 'exists' }
                if (Get-Command winget -EA SilentlyContinue) {
                    Start-Process winget -ArgumentList 'install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent' -Wait -WindowStyle Hidden
                } else {
                    $msi="$env:TEMP\node_setup.msi"
                    Invoke-WebRequest 'https://nodejs.org/dist/v22.12.0/node-v22.12.0-x64.msi' -OutFile $msi -UseBasicParsing
                    Start-Process msiexec -ArgumentList "/i `"$msi`" /quiet" -Wait
                    Remove-Item $msi -Force -EA SilentlyContinue
                }
                $env:PATH=[Environment]::GetEnvironmentVariable('PATH','Machine')+';'+[Environment]::GetEnvironmentVariable('PATH','User')
                if (-not (Get-Command node -EA SilentlyContinue)) { throw 'Node.js installation failed' }
            } -ArgumentList $root
        }
        1 { # FFmpeg
            $lblLog.Text = 'מנסה winget... (אם אין – יוריד ~150MB, עלול לקחת עד 10 דקות)'
            [Windows.Forms.Application]::DoEvents()
            $script:job = Start-Job {
                param($r)
                $env:PATH = [Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH','User')
                if (Get-Command ffplay -EA SilentlyContinue) { return 'exists' }

                # ── ניסיון 1: winget (מהיר, ~20MB) ──────────────────────────
                if (Get-Command winget -EA SilentlyContinue) {
                    Start-Process winget -ArgumentList 'install -e --id Gyan.FFmpeg --accept-package-agreements --accept-source-agreements --silent' -Wait -WindowStyle Hidden -EA SilentlyContinue
                    $env:PATH = [Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH','User')
                    if (Get-Command ffplay -EA SilentlyContinue) { return 'winget' }
                }

                # ── ניסיון 2: הורדה ישירה (~150MB) ──────────────────────────
                $dir = 'C:\ffmpeg'
                New-Item $dir        -ItemType Directory -Force | Out-Null
                New-Item "$dir\bin"  -ItemType Directory -Force | Out-Null
                $zip = "$env:TEMP\ffmpeg.zip"
                Invoke-WebRequest 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip' -OutFile $zip -UseBasicParsing -TimeoutSec 600
                Expand-Archive $zip -DestinationPath $dir -Force
                Remove-Item $zip -Force -EA SilentlyContinue
                $bin = Get-ChildItem $dir -Filter 'bin' -Recurse -Directory | Select-Object -First 1
                if ($bin) { Get-ChildItem $bin.FullName | Copy-Item -Destination "$dir\bin\" -Force -EA SilentlyContinue }
                [Environment]::SetEnvironmentVariable('PATH', [Environment]::GetEnvironmentVariable('PATH','Machine') + ";$dir\bin", 'Machine')
                $env:PATH = [Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH','User')
                if (-not (Get-Command ffplay -EA SilentlyContinue)) { throw 'ffplay לא נמצא לאחר ההתקנה' }
            } -ArgumentList $root
        }
        2 { # npm install server
            $script:job = Start-Job {
                param($r)
                $env:PATH=[Environment]::GetEnvironmentVariable('PATH','Machine')+';'+[Environment]::GetEnvironmentVariable('PATH','User')
                $srvDir = if (Test-Path "$r\_setup\school-bells-server") { "$r\_setup\school-bells-server" } else { "$r\school-bells-server" }
                Set-Location $srvDir
                $o = & npm install --prefer-offline 2>&1
                if ($LASTEXITCODE -ne 0) { throw ($o | Select-Object -Last 5 | Out-String) }
            } -ArgumentList $root
        }
        3 { # npm install UI
            $script:job = Start-Job {
                param($r)
                $env:PATH=[Environment]::GetEnvironmentVariable('PATH','Machine')+';'+[Environment]::GetEnvironmentVariable('PATH','User')
                $uiDir = if (Test-Path "$r\_setup\school-bells-ui") { "$r\_setup\school-bells-ui" } else { "$r\school-bells-ui" }
                Set-Location $uiDir
                $o = & npm install --prefer-offline 2>&1
                if ($LASTEXITCODE -ne 0) { throw ($o | Select-Object -Last 5 | Out-String) }
            } -ArgumentList $root
        }
        4 { # Build UI
            $script:job = Start-Job {
                param($r)
                $env:PATH=[Environment]::GetEnvironmentVariable('PATH','Machine')+';'+[Environment]::GetEnvironmentVariable('PATH','User')
                $uiDir = if (Test-Path "$r\_setup\school-bells-ui") { "$r\_setup\school-bells-ui" } else { "$r\school-bells-ui" }
                Set-Location $uiDir
                $o = & npm run build 2>&1
                if ($LASTEXITCODE -ne 0) { throw ($o | Select-Object -Last 5 | Out-String) }
            } -ArgumentList $root
        }
        5 { # Shortcuts + uninstaller + DB
            $sName = $script:schoolVal
            $pName = $script:principalVal
            $script:job = Start-Job {
                param($r,$sName,$pName)
                $env:PATH=[Environment]::GetEnvironmentVariable('PATH','Machine')+';'+[Environment]::GetEnvironmentVariable('PATH','User')
                $srvDir = if (Test-Path "$r\_setup\school-bells-server") { "$r\_setup\school-bells-server" } else { "$r\school-bells-server" }

                # Smart launcher VBS — uses detected server path
                # Launcher goes inside _setup so it's hidden — shortcuts point there
                $innerDir = if (Test-Path "$r\_setup") { "$r\_setup" } else { $r }
                $launcherVbs = Join-Path $innerDir 'הפעל-צילצולי.vbs'
                # Embed absolute server path — avoids relative path confusion when VBS is inside _setup\
                $srvAbs = $srvDir
                [System.IO.File]::WriteAllText($launcherVbs, ("Dim oShell, oHTTP, bRunning, i`r`n" +
                    "Set oShell = CreateObject(""WScript.Shell"")`r`n" +
                    "Set oHTTP  = CreateObject(""WinHttp.WinHttpRequest.5.1"")`r`n" +
                    "oHTTP.SetTimeouts 800,800,800,800`r`n" +
                    "bRunning = False`r`n" +
                    "On Error Resume Next`r`n" +
                    "oHTTP.Open ""GET"",""http://localhost:3000/api/status"",False`r`n" +
                    "oHTTP.Send`r`n" +
                    "If Err.Number = 0 And oHTTP.Status = 200 Then bRunning = True`r`n" +
                    "On Error GoTo 0`r`n" +
                    "If Not bRunning Then`r`n" +
                    "    oShell.Run ""taskkill /f /im node.exe >nul 2>&1"", 0, True`r`n" +
                    "    WScript.Sleep 800`r`n" +
                    "    oShell.Run ""cmd /c cd /d """"$srvAbs"""" && node server.js"", 0, False`r`n" +
                    "    For i = 1 To 30`r`n" +
                    "        WScript.Sleep 1000`r`n" +
                    "        On Error Resume Next`r`n" +
                    "        oHTTP.Open ""GET"",""http://localhost:3000/api/status"",False`r`n" +
                    "        oHTTP.Send`r`n" +
                    "        If Err.Number = 0 And oHTTP.Status = 200 Then bRunning = True`r`n" +
                    "        On Error GoTo 0`r`n" +
                    "        If bRunning Then Exit For`r`n" +
                    "    Next`r`n" +
                    "End If`r`n" +
                    "Dim chromePath`r`n" +
                    "chromePath = """"`r`n" +
                    "On Error Resume Next`r`n" +
                    "chromePath = oShell.RegRead(""HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe\"")`r`n" +
                    "On Error GoTo 0`r`n" +
                    "If chromePath <> """" Then`r`n" +
                    "    oShell.Run Chr(34) & chromePath & Chr(34) & "" --app=http://localhost:3000 --new-window"", 0, False`r`n" +
                    "Else`r`n" +
                    "    oShell.Run ""http://localhost:3000""`r`n" +
                    "End If`r`n"), (New-Object System.Text.UTF8Encoding $false))

                # Uninstaller VBS — auto-detect PS1 location (_setup\ or root)
                $uninstPs1Rel = if (Test-Path "$r\_setup\uninstaller.ps1") { '_setup\uninstaller.ps1' } else { 'הסר-צילצולי.ps1' }
                $uninstVbs = Join-Path $r 'הסרת צילצולי.vbs'
                [System.IO.File]::WriteAllText($uninstVbs, ("Set oFSO   = CreateObject(""Scripting.FileSystemObject"")`r`n" +
                    "Set oShell = CreateObject(""WScript.Shell"")`r`n" +
                    "sRoot = oFSO.GetParentFolderName(WScript.ScriptFullName)`r`n" +
                    "oShell.Run ""powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File """"`" & sRoot & ""\$uninstPs1Rel"""" """"`" & sRoot & """""", 0, False`r`n"), (New-Object System.Text.UTF8Encoding $false))

                # Desktop shortcut
                $WshShell = New-Object -ComObject WScript.Shell
                $lnkDesktop = [IO.Path]::Combine([Environment]::GetFolderPath('Desktop'),'צילצולי.lnk')
                $sc = $WshShell.CreateShortcut($lnkDesktop)
                $sc.TargetPath       = 'wscript.exe'
                $sc.Arguments        = "`"$launcherVbs`""
                $sc.WorkingDirectory = $r
                $sc.Description      = 'מערכת צלצולים חכמה לבית הספר'
                $sc.Save()

                # Taskbar pin - Method 1: InvokeVerb
                try {
                    $shell  = New-Object -ComObject Shell.Application
                    $folder = $shell.Namespace([IO.Path]::GetDirectoryName($lnkDesktop))
                    $item   = $folder.ParseName([IO.Path]::GetFileName($lnkDesktop))
                    foreach ($v in $item.Verbs()) {
                        if ($v.Name -match 'pin.*task|הצמד.*שורת') { $v.DoIt(); break }
                    }
                } catch {}

                # Taskbar pin - Method 2: copy to taskbar folder
                try {
                    $tbDir = "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"
                    if (-not (Test-Path $tbDir)) { New-Item $tbDir -ItemType Directory -Force | Out-Null }
                    Copy-Item $lnkDesktop (Join-Path $tbDir 'צילצולי.lnk') -Force
                } catch {}

                # Start menu shortcut
                try {
                    $smDir = [IO.Path]::Combine([Environment]::GetFolderPath('StartMenu'),'תוכניות')
                    if (-not (Test-Path $smDir)) { New-Item $smDir -ItemType Directory -Force | Out-Null }
                    Copy-Item $lnkDesktop (Join-Path $smDir 'צילצולי.lnk') -Force
                } catch {}

                # Startup shortcut — auto-start server on Windows login
                try {
                    $startupDir = [Environment]::GetFolderPath('Startup')
                    $scStartup = $WshShell.CreateShortcut((Join-Path $startupDir 'צילצולי.lnk'))
                    $scStartup.TargetPath       = 'wscript.exe'
                    $scStartup.Arguments        = "`"$launcherVbs`""
                    $scStartup.WorkingDirectory = $r
                    $scStartup.Description      = 'הפעלת שרת צילצולי עם אתחול Windows'
                    $scStartup.Save()
                } catch {}

                # Save school details to DB
                $es = $sName -replace "'","''"
                $ep = $pName -replace "'","''"
                $js = @"
const db=new(require('sqlite3').verbose().Database)('./settings.db');
db.serialize(()=>{
  db.run('CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT)');
  db.run("INSERT OR REPLACE INTO settings VALUES('school_name',?)",['$es']);
  db.run("INSERT OR REPLACE INTO settings VALUES('principal_name',?)",['$ep'],()=>{db.close();process.exit(0);});
});
"@
                Set-Location $srvDir
                # Write JS to temp file with UTF-8 (no BOM) to preserve Hebrew school name
                $tmpJs = "$env:TEMP\tziltzuli_init.js"
                [System.IO.File]::WriteAllText($tmpJs, $js, (New-Object System.Text.UTF8Encoding $false))
                & node $tmpJs 2>&1 | Out-Null
                Remove-Item $tmpJs -Force -EA SilentlyContinue

            } -ArgumentList $root,$sName,$pName
        }
    }
}

$timer.Add_Tick({
    if (-not $script:job) { return }
    if ($script:job.State -notin 'Completed','Failed') { return }

    $failed = ($script:job.State -eq 'Failed')
    $errMsg = ''
    if ($failed) { $errMsg = "$($script:job.ChildJobs[0].Error | Select-Object -First 1)" }
    try { Receive-Job $script:job -EA SilentlyContinue | Out-Null } catch {}
    Remove-Job $script:job -Force -EA SilentlyContinue
    $script:job = $null

    if ($failed -and $script:stepIdx -ne 1) {
        Set-StepState $script:stepIdx 'error'
        $lblLog.Text = "שגיאה: $errMsg"
        $timer.Stop()
        return
    }

    if ($failed) {
        # FFmpeg נכשל — מציגים שגיאה אבל ממשיכים (לא עוצרים)
        Set-StepState $script:stepIdx 'error'
        $lblLog.Text = "⚠️ FFmpeg לא הותקן – צלצולים לא יפעלו! לאחר ההתקנה הפעל: winget install Gyan.FFmpeg"
    } else {
        Set-StepState $script:stepIdx 'done'
        $lblLog.Text = ''
    }
    $script:stepIdx++

    if ($script:stepIdx -lt $stepNames.Count) {
        Start-Step $script:stepIdx
    } else {
        $timer.Stop()
        $pgBar.Value = 100
        $p2.Visible  = $false
        $p3.Visible  = $true
        $lblDoneSub.Text = "ההתקנה הושלמה! הדפדפן ייפתח בעוד שניות..."
        $btnInstall.Visible = $false
        [Windows.Forms.Application]::DoEvents()

        # Start node directly (no VBS intermediary — works reliably from any context)
        $srvPath = if (Test-Path "$root\_setup\school-bells-server") { "$root\_setup\school-bells-server" } else { "$root\school-bells-server" }
        # Refresh PATH to find node even if just installed
        $env:PATH = [Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH','User')
        $nodeExe = Get-Command node -EA SilentlyContinue
        $nodeSource = if ($nodeExe) { $nodeExe.Source } else { 'node' }
        Start-Process $nodeSource -ArgumentList 'server.js' -WorkingDirectory $srvPath -WindowStyle Hidden

        # Poll until server responds, then open Chrome
        $script:pollCount = 0
        $script:closeTimer = New-Object Windows.Forms.Timer
        $script:closeTimer.Interval = 1000
        $script:closeTimer.Add_Tick({
            $script:pollCount++
            $ready = $false
            try {
                $null = Invoke-WebRequest 'http://localhost:3000/api/status' -UseBasicParsing -TimeoutSec 1
                $ready = $true
            } catch {}

            if ($ready -or $script:pollCount -ge 30) {
                $script:closeTimer.Stop()
                if ($ready) {
                    $cp = ''
                    try { $cp = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe' -EA SilentlyContinue).'(Default)' } catch {}
                    if ($cp -and (Test-Path $cp)) {
                        Start-Process $cp -ArgumentList '--app=http://localhost:3000 --new-window'
                    } else {
                        Start-Process 'http://localhost:3000'
                    }
                }
                $form.Close()
            } else {
                $lblDoneSub.Text = "מפעיל שרת... ($script:pollCount/30)"
            }
        })
        $script:closeTimer.Start()
    }
})

$btnInstall.Add_Click({
    $script:schoolVal    = if ($txtSchool.Text.Trim()) { $txtSchool.Text.Trim() } else { 'בית הספר שלנו' }
    $script:principalVal = if ($txtPrincipal.Text.Trim()) { $txtPrincipal.Text.Trim() } else { 'המנהל' }
    $p1.Visible=$false; $p2.Visible=$true; $btnInstall.Enabled=$false
    for ($i=0;$i -lt $stepNames.Count;$i++) { Set-StepState $i 'pending' }
    $script:stepIdx=0; Start-Step 0; $timer.Start()
})

$btnLaunch.Add_Click({
    $vbs = if (Test-Path "$root\_setup\הפעל-צילצולי.vbs") { "$root\_setup\הפעל-צילצולי.vbs" } else { "$root\הפעל-צילצולי.vbs" }
    if (Test-Path $vbs) { Start-Process wscript.exe -ArgumentList "`"$vbs`"" }
    $form.Close()
})

[Windows.Forms.Application]::EnableVisualStyles()
[Windows.Forms.Application]::Run($form)
