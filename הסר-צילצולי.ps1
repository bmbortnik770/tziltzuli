Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'SilentlyContinue'

$root = if ($args[0] -and (Test-Path $args[0])) { $args[0] } else { Split-Path -Parent $MyInvocation.MyCommand.Path }

# ── Colors & Fonts ───────────────────────────────────────────────
$cBg    = [Drawing.Color]::FromArgb(255,247,247)
$cWhite = [Drawing.Color]::White
$cRed   = [Drawing.Color]::FromArgb(220,38,38)
$cRedLt = [Drawing.Color]::FromArgb(254,226,226)
$cRedDk = [Drawing.Color]::FromArgb(185,28,28)
$cGreen = [Drawing.Color]::FromArgb(22,163,74)
$cText  = [Drawing.Color]::FromArgb(15,23,42)
$cGray  = [Drawing.Color]::FromArgb(100,116,139)
$cGrayLt= [Drawing.Color]::FromArgb(203,213,225)
$cOrange= [Drawing.Color]::FromArgb(234,88,12)
$cSep   = [Drawing.Color]::FromArgb(226,232,240)

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
    $l.Size=[Drawing.Size]::new($w,$h); $l.Font=$fnt; $l.ForeColor=$clr
    $l.TextAlign=[Drawing.ContentAlignment]::$al
    $l.BackColor=[Drawing.Color]::Transparent
    return $l
}

# ── Form ─────────────────────────────────────────────────────────
$form = New-Object Windows.Forms.Form
$form.Text = 'הסרת צילצולי'
$form.ClientSize = [Drawing.Size]::new(560,550)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false
$form.BackColor = $cBg
$form.RightToLeft = 'Yes'
$form.Font = $fNorm

# ── Header ───────────────────────────────────────────────────────
$hdr = New-Object Windows.Forms.Panel
$hdr.Size=[Drawing.Size]::new(560,100); $hdr.Location=[Drawing.Point]::new(0,0)
$hdr.BackColor=$cRed; $form.Controls.Add($hdr)
$hdr.Controls.Add((Make-Label '🗑️' 14 10 64 78 (New-Object Drawing.Font('Segoe UI',28)) $cWhite 'MiddleCenter'))
$hdr.Controls.Add((Make-Label 'הסרת צילצולי' 10 10 468 44 $fTitle $cWhite 'MiddleRight'))
$hdr.Controls.Add((Make-Label 'הסרת מערכת הצלצולים מהמחשב' 10 54 468 36 $fNorm ([Drawing.Color]::FromArgb(254,202,202)) 'MiddleRight'))

$sepHdr = New-Object Windows.Forms.Panel
$sepHdr.Size=[Drawing.Size]::new(560,3); $sepHdr.Location=[Drawing.Point]::new(0,100)
$sepHdr.BackColor=$cRedDk; $form.Controls.Add($sepHdr)

# ── Page 1: Confirm ───────────────────────────────────────────────
$p1 = New-Object Windows.Forms.Panel
$p1.Size=[Drawing.Size]::new(520,372); $p1.Location=[Drawing.Point]::new(20,113)
$p1.BackColor=$cWhite; $p1.BorderStyle='FixedSingle'; $form.Controls.Add($p1)

$warnPanel = New-Object Windows.Forms.Panel
$warnPanel.Location=[Drawing.Point]::new(14,14); $warnPanel.Size=[Drawing.Size]::new(490,80)
$warnPanel.BackColor=$cRedLt; $warnPanel.BorderStyle='FixedSingle'; $p1.Controls.Add($warnPanel)
$warnPanel.Controls.Add((Make-Label "⚠️  פעולה זו תסיר את צילצולי מהמחשב.`nקיצורי הדרך יימחקו והשרת ייסגר." 10 10 468 58 $fNorm $cRed 'TopRight'))

$sepWarn = New-Object Windows.Forms.Panel
$sepWarn.Size=[Drawing.Size]::new(490,1); $sepWarn.Location=[Drawing.Point]::new(14,106)
$sepWarn.BackColor=$cSep; $p1.Controls.Add($sepWarn)

$p1.Controls.Add((Make-Label 'בחר מה להסיר:' 14 118 490 24 $fBold $cText 'MiddleRight'))

$chkData = New-Object Windows.Forms.CheckBox
$chkData.Location=[Drawing.Point]::new(14,150); $chkData.Size=[Drawing.Size]::new(490,28)
$chkData.Text='מחק גם את הנתונים  (לוחות שעות, הגדרות, קבצי שמע)'
$chkData.Font=$fNorm; $chkData.RightToLeft='Yes'; $chkData.CheckAlign='MiddleRight'
$chkData.ForeColor=$cText; $chkData.BackColor=[Drawing.Color]::Transparent
$p1.Controls.Add($chkData)

$chkFiles = New-Object Windows.Forms.CheckBox
$chkFiles.Location=[Drawing.Point]::new(14,184); $chkFiles.Size=[Drawing.Size]::new(490,28)
$chkFiles.Text='מחק את כל קבצי התוכנה  (הסרה מלאה)'
$chkFiles.Font=$fNorm; $chkFiles.RightToLeft='Yes'; $chkFiles.CheckAlign='MiddleRight'
$chkFiles.ForeColor=$cText; $chkFiles.BackColor=[Drawing.Color]::Transparent
$p1.Controls.Add($chkFiles)

$notePanel = New-Object Windows.Forms.Panel
$notePanel.Location=[Drawing.Point]::new(14,226); $notePanel.Size=[Drawing.Size]::new(490,86)
$notePanel.BackColor=([Drawing.Color]::FromArgb(241,245,255)); $notePanel.BorderStyle='FixedSingle'
$p1.Controls.Add($notePanel)
$notePanel.Controls.Add((Make-Label "ללא סימון — רק קיצורי הדרך יוסרו.`nניתן להתקין מחדש בעתיד ללא אובדן נתונים." 10 12 468 60 $fSmall $cGray 'TopRight'))

# ── Page 2: Progress ──────────────────────────────────────────────
$p2 = New-Object Windows.Forms.Panel
$p2.Size=[Drawing.Size]::new(520,372); $p2.Location=[Drawing.Point]::new(20,113)
$p2.BackColor=$cWhite; $p2.BorderStyle='FixedSingle'; $p2.Visible=$false; $form.Controls.Add($p2)

$pgBar = New-Object Windows.Forms.ProgressBar
$pgBar.Location=[Drawing.Point]::new(20,20); $pgBar.Size=[Drawing.Size]::new(478,18)
$pgBar.Minimum=0; $pgBar.Maximum=100; $pgBar.Style='Continuous'; $p2.Controls.Add($pgBar)

$uninstStepNames = @('עצירת השרת','הסרת קיצורי דרך','מחיקת נתונים','מחיקת קבצי התוכנה')
$uninstLbls = @()
for ($i=0;$i -lt $uninstStepNames.Count;$i++) {
    $lbl = Make-Label "○   $($uninstStepNames[$i])" 20 (54+$i*62) 478 48 $fStep $cGrayLt 'MiddleRight'
    $p2.Controls.Add($lbl); $uninstLbls += $lbl
}
$lblLog = Make-Label '' 20 318 478 30 $fSmall $cGray 'MiddleRight'; $p2.Controls.Add($lblLog)

# ── Page 3: Done ──────────────────────────────────────────────────
$p3 = New-Object Windows.Forms.Panel
$p3.Size=[Drawing.Size]::new(520,372); $p3.Location=[Drawing.Point]::new(20,113)
$p3.BackColor=$cWhite; $p3.BorderStyle='FixedSingle'; $p3.Visible=$false; $form.Controls.Add($p3)
$p3.Controls.Add((Make-Label '✅' 0 40 518 90 (New-Object Drawing.Font('Segoe UI',44)) $cGreen 'MiddleCenter'))
$p3.Controls.Add((Make-Label 'צילצולי הוסרה בהצלחה' 0 138 518 48 $fDone $cText 'MiddleCenter'))
$p3.Controls.Add((Make-Label 'תודה על השימוש.' 0 190 518 30 $fNorm $cGray 'MiddleCenter'))

# ── Separator above buttons ───────────────────────────────────────
$sepBtn = New-Object Windows.Forms.Panel
$sepBtn.Size=[Drawing.Size]::new(520,1); $sepBtn.Location=[Drawing.Point]::new(20,497)
$sepBtn.BackColor=$cSep; $form.Controls.Add($sepBtn)

# ── Buttons ───────────────────────────────────────────────────────
$btnRemove = New-Object Windows.Forms.Button
$btnRemove.Text='הסר עכשיו'; $btnRemove.Location=[Drawing.Point]::new(290,507)
$btnRemove.Size=[Drawing.Size]::new(210,36); $btnRemove.Font=$fBtn
$btnRemove.BackColor=$cRed; $btnRemove.ForeColor=$cWhite
$btnRemove.FlatStyle='Flat'; $btnRemove.FlatAppearance.BorderSize=0
$btnRemove.Cursor='Hand'; $form.Controls.Add($btnRemove)

$btnCancel = New-Object Windows.Forms.Button
$btnCancel.Text='ביטול'; $btnCancel.Location=[Drawing.Point]::new(60,507)
$btnCancel.Size=[Drawing.Size]::new(210,36); $btnCancel.Font=$fBtn
$btnCancel.BackColor=$cGrayLt; $btnCancel.ForeColor=$cGray
$btnCancel.FlatStyle='Flat'; $btnCancel.FlatAppearance.BorderSize=0
$btnCancel.Cursor='Hand'; $form.Controls.Add($btnCancel)

$btnClose = New-Object Windows.Forms.Button
$btnClose.Text='סגור'; $btnClose.Location=[Drawing.Point]::new(175,507)
$btnClose.Size=[Drawing.Size]::new(210,36); $btnClose.Font=$fBtn
$btnClose.BackColor=$cGreen; $btnClose.ForeColor=$cWhite
$btnClose.FlatStyle='Flat'; $btnClose.FlatAppearance.BorderSize=0
$btnClose.Cursor='Hand'; $btnClose.Visible=$false; $form.Controls.Add($btnClose)

# ── Uninstall helpers ─────────────────────────────────────────────
function Set-UStep($i,$state) {
    $icons  = @{pending='○   ';running='⏳  ';done='✅  ';skip='⏭   ';error='❌  '}
    $colors = @{pending=$cGrayLt;running=$cOrange;done=$cGreen;skip=$cGray;error=$cRed}
    $uninstLbls[$i].Text     = "$($icons[$state])$($uninstStepNames[$i])"
    $uninstLbls[$i].ForeColor= $colors[$state]
}

function Run-Uninstall($delData, $delFiles) {
    $p1.Visible=$false; $p2.Visible=$true
    $btnRemove.Visible=$false; $btnCancel.Visible=$false
    for ($i=0;$i -lt $uninstStepNames.Count;$i++) { Set-UStep $i 'pending' }

    # Step 0: Stop server
    Set-UStep 0 'running'; $pgBar.Value=10; $lblLog.Text='עוצר שרת...'; [Windows.Forms.Application]::DoEvents()
    try {
        Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Milliseconds 800
    } catch {}
    Set-UStep 0 'done'; $pgBar.Value=25; [Windows.Forms.Application]::DoEvents()

    # Step 1: Remove shortcuts
    Set-UStep 1 'running'; $lblLog.Text='מסיר קיצורי דרך...'; [Windows.Forms.Application]::DoEvents()
    $desktop    = [Environment]::GetFolderPath('Desktop')
    $startMenu  = [IO.Path]::Combine([Environment]::GetFolderPath('StartMenu'),'תוכניות')
    $tbDir      = "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"
    $startupDir = [Environment]::GetFolderPath('Startup')

    @("$desktop\צילצולי.lnk","$startMenu\צילצולי.lnk","$tbDir\צילצולי.lnk","$startupDir\צילצולי.lnk") | ForEach-Object {
        Remove-Item $_ -Force -ErrorAction SilentlyContinue
    }
    try {
        $sh  = New-Object -ComObject Shell.Application
        $fld = $sh.Namespace($desktop)
        $itm = $fld.ParseName('צילצולי.lnk')
        if ($itm) {
            foreach ($v in $itm.Verbs()) {
                if ($v.Name -match 'unpin|הסר.*שורת') { $v.DoIt(); break }
            }
        }
    } catch {}
    Set-UStep 1 'done'; $pgBar.Value=50; [Windows.Forms.Application]::DoEvents()

    # Step 2: Delete data
    if ($delData) {
        Set-UStep 2 'running'; $lblLog.Text='מוחק נתונים...'; [Windows.Forms.Application]::DoEvents()
        $dbPath      = Join-Path $root 'school-bells-server\settings.db'
        $uploadsPath = Join-Path $root 'school-bells-server\uploads'
        Remove-Item $dbPath      -Force -ErrorAction SilentlyContinue
        Remove-Item $uploadsPath -Recurse -Force -ErrorAction SilentlyContinue
        Set-UStep 2 'done'
    } else {
        Set-UStep 2 'skip'
    }
    $pgBar.Value=70; [Windows.Forms.Application]::DoEvents()

    # Step 3: Delete app files
    if ($delFiles) {
        Set-UStep 3 'running'; $lblLog.Text='מכין מחיקת קבצים...'; [Windows.Forms.Application]::DoEvents()
        $bat = "$env:TEMP\tziltzuli_cleanup.bat"
        $rootEsc = $root -replace '"',''
        Set-Content $bat -Value "@echo off`r`ntimeout /t 3 /nobreak >nul`r`nrd /s /q `"$rootEsc`"`r`ndel `"%~f0`"" -Encoding ASCII
        Start-Process cmd -ArgumentList "/c `"$bat`"" -WindowStyle Hidden
        Set-UStep 3 'done'
    } else {
        Set-UStep 3 'skip'
    }
    $pgBar.Value=100; $lblLog.Text=''; [Windows.Forms.Application]::DoEvents()

    $p2.Visible=$false; $p3.Visible=$true
    $btnClose.Visible=$true
}

# ── Button handlers ──────────────────────────────────────────────
$btnCancel.Add_Click({ $form.Close() })
$btnClose.Add_Click({ $form.Close() })
$btnRemove.Add_Click({
    Run-Uninstall $chkData.Checked $chkFiles.Checked
})

[Windows.Forms.Application]::EnableVisualStyles()
[Windows.Forms.Application]::Run($form)
