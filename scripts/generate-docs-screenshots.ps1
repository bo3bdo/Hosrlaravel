# Generates sanitized documentation screenshots (no personal paths or usernames).
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path (Split-Path -Parent $PSScriptRoot) "docs\screenshots"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Convert-Hex([string]$hex) {
  $hex = $hex.TrimStart("#")
  return [System.Drawing.Color]::FromArgb(
    [Convert]::ToInt32($hex.Substring(0, 2), 16),
    [Convert]::ToInt32($hex.Substring(2, 2), 16),
    [Convert]::ToInt32($hex.Substring(4, 2), 16)
  )
}

$bg = Convert-Hex "0a0d10"
$sidebar = Convert-Hex "080b0e"
$surface = Convert-Hex "141a21"
$surfaceStrong = Convert-Hex "1c242d"
$line = Convert-Hex "2a3540"
$text = Convert-Hex "eef4f8"
$muted = Convert-Hex "8fa0b0"
$primary = Convert-Hex "4fc7b5"
$green = Convert-Hex "6dd89f"

function New-Font([string]$family, [float]$size, [bool]$bold = $false) {
  $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  return [System.Drawing.Font]::new($family, $size, $style)
}

function Save-Bitmap([System.Drawing.Bitmap]$bitmap, [string]$name) {
  $path = Join-Path $outDir $name
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
  Write-Host "Wrote $path"
}

function Draw-Sidebar([System.Drawing.Graphics]$g, [int]$height, [string[]]$items, [string]$active) {
  $g.FillRectangle((New-Object System.Drawing.SolidBrush $sidebar), 0, 0, 220, $height)
  $titleFont = New-Font "Segoe UI" 14 $true
  $itemFont = New-Font "Segoe UI" 10
  $g.DrawString("laraboxs", $titleFont, (New-Object System.Drawing.SolidBrush $text), 18, 22)
  $g.DrawString("Windows local dev", $itemFont, (New-Object System.Drawing.SolidBrush $muted), 18, 44)
  $y = 88
  foreach ($item in $items) {
    $brush = if ($item -eq $active) { New-Object System.Drawing.SolidBrush $surfaceStrong } else { $null }
    if ($brush) { $g.FillRectangle($brush, 10, $y - 4, 200, 28) }
    $color = if ($item -eq $active) { $primary } else { $muted }
    $g.DrawString($item, $itemFont, (New-Object System.Drawing.SolidBrush $color), 24, $y)
    $y += 34
  }
}

function Draw-Card([System.Drawing.Graphics]$g, [int]$x, [int]$y, [int]$w, [int]$h, [string]$title) {
  $g.FillRectangle((New-Object System.Drawing.SolidBrush $surface), $x, $y, $w, $h)
  $pen = New-Object System.Drawing.Pen $line
  $g.DrawRectangle($pen, $x, $y, $w - 1, $h - 1)
  $g.DrawString($title, (New-Font "Segoe UI" 11 $true), (New-Object System.Drawing.SolidBrush $text), ($x + 14), ($y + 12))
}

function New-AppShot([string]$name, [int]$width, [int]$height, [string[]]$nav, [string]$active, [scriptblock]$content) {
  $bmp = [System.Drawing.Bitmap]::new($width, $height)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  $g.FillRectangle((New-Object System.Drawing.SolidBrush $bg), 0, 0, $width, $height)
  Draw-Sidebar $g $height $nav $active
  & $content $g
  $g.Dispose()
  Save-Bitmap $bmp $name
}

$nav = @("Setup", "Sites", "Nginx", "PHP", "MySQL", "Redis", "Logs", "Settings")

New-AppShot "nginx-settings.png" 1160 760 $nav "Nginx" {
  param($g)
  $bodyFont = New-Font "Segoe UI" 10
  $labelFont = New-Font "Segoe UI" 9
  $g.DrawString("Nginx", (New-Font "Segoe UI" 20 $true), (New-Object System.Drawing.SolidBrush $text), 248, 28)
  $g.FillRectangle((New-Object System.Drawing.SolidBrush $green), 248, 62, 72, 22)
  $g.DrawString("Running", $labelFont, (New-Object System.Drawing.SolidBrush $bg), 258, 66)
  $g.DrawString("nginx 127.0.0.1:80", $bodyFont, (New-Object System.Drawing.SolidBrush $muted), 330, 66)
  Draw-Card $g 248 110 420 220 "Runtime"
  $paths = @(
    "Version: 1.31.1",
    "Binary: %USERPROFILE%\.config\laraboxs\services\nginx\nginx.exe",
    "Root: %USERPROFILE%\.config\laraboxs\services\nginx",
    "Log: %USERPROFILE%\.config\laraboxs\logs\nginx-error.log"
  )
  $y = 150
  foreach ($lineText in $paths) {
    $g.DrawString($lineText, $labelFont, (New-Object System.Drawing.SolidBrush $muted), 262, $y)
    $y += 22
  }
  Draw-Card $g 688 110 420 220 "Routing"
  $routes = @(
    "HTTP: 127.0.0.1:80",
    "HTTPS: 127.0.0.1:443",
    "Config: %USERPROFILE%\.config\laraboxs\services\nginx\conf\nginx.conf",
    "Sites: %USERPROFILE%\.config\laraboxs\services\nginx\conf\sites-enabled"
  )
  $y = 150
  foreach ($lineText in $routes) {
    $g.DrawString($lineText, $labelFont, (New-Object System.Drawing.SolidBrush $muted), 702, $y)
    $y += 22
  }
}

New-AppShot "site-entry-settings.png" 1160 760 $nav "Sites" {
  param($g)
  $bodyFont = New-Font "Segoe UI" 10
  $labelFont = New-Font "Segoe UI" 9
  $g.DrawString("example", (New-Font "Segoe UI" 20 $true), (New-Object System.Drawing.SolidBrush $text), 248, 28)
  Draw-Card $g 248 90 860 280 "Site Entry"
  $rows = @(
    "Domain: example.test",
    "URL: https://example.test",
    "Framework: Laravel",
    "PHP: 8.5",
    "Base directory: C:\dev\www",
    "Project path: C:\dev\www\example",
    "Document root: C:\dev\www\example\public"
  )
  $y = 130
  foreach ($lineText in $rows) {
    $g.DrawString($lineText, $bodyFont, (New-Object System.Drawing.SolidBrush $muted), 262, $y)
    $y += 26
  }
}

New-AppShot "php-settings.png" 1160 760 $nav "PHP" {
  param($g)
  $bodyFont = New-Font "Segoe UI" 10
  $labelFont = New-Font "Segoe UI" 9
  $g.DrawString("PHP", (New-Font "Segoe UI" 20 $true), (New-Object System.Drawing.SolidBrush $text), 248, 28)
  $g.FillRectangle((New-Object System.Drawing.SolidBrush $green), 248, 62, 72, 22)
  $g.DrawString("Running", $labelFont, (New-Object System.Drawing.SolidBrush $bg), 258, 66)
  Draw-Card $g 248 110 420 200 "Global Version"
  $g.DrawString("Selected: PHP 8.5", $bodyFont, (New-Object System.Drawing.SolidBrush $muted), 262, 150)
  $g.DrawString("Endpoint: 127.0.0.1:9085", $bodyFont, (New-Object System.Drawing.SolidBrush $muted), 262, 178)
  Draw-Card $g 688 110 420 200 "Per-Site Version"
  $g.DrawString("Site: example.test", $bodyFont, (New-Object System.Drawing.SolidBrush $muted), 702, 150)
  $g.DrawString("Isolated PHP: 8.4", $bodyFont, (New-Object System.Drawing.SolidBrush $muted), 702, 178)
}

New-AppShot "first-run-install.png" 1160 760 $nav "Setup" {
  param($g)
  $bodyFont = New-Font "Segoe UI" 10
  $g.DrawString("First Run", (New-Font "Segoe UI" 20 $true), (New-Object System.Drawing.SolidBrush $text), 248, 28)
  $cards = @(
    @{ Title = "PHP 8.5"; Status = "Installed"; X = 248; Y = 100 },
    @{ Title = "MySQL 9.7"; Status = "Install"; X = 500; Y = 100 },
    @{ Title = "Nginx"; Status = "Install"; X = 752; Y = 100 },
    @{ Title = "Redis 8.8"; Status = "Install"; X = 248; Y = 280 },
    @{ Title = "Node.js 22"; Status = "Installed"; X = 500; Y = 280 },
    @{ Title = "Composer"; Status = "Install"; X = 752; Y = 280 }
  )
  foreach ($card in $cards) {
    Draw-Card $g $card.X $card.Y 220 150 $card.Title
    $g.DrawString($card.Status, $bodyFont, (New-Object System.Drawing.SolidBrush $muted), ($card.X + 14), ($card.Y + 110))
  }
}

$preview = [System.Drawing.Bitmap]::new(900, 520)
$pg = [System.Drawing.Graphics]::FromImage($preview)
$pg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$pg.FillRectangle([System.Drawing.Brushes]::White, 0, 0, 900, 520)
$pg.DrawString("example.test", (New-Font "Segoe UI" 28 $true), [System.Drawing.Brushes]::Black, 36, 32)
$pg.DrawString("Local Laravel site preview", (New-Font "Segoe UI" 12), (New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(90, 90, 90))), 36, 78)
$pg.Dispose()
Save-Bitmap $preview "site-preview.png"

Write-Host "Documentation screenshots generated."
