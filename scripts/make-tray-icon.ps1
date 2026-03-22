# Builds resources/tray-icon.png — search-glyph on gradient (readable at taskbar & tray sizes).
$dir = Join-Path $PSScriptRoot '..\resources'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Add-Type -AssemblyName System.Drawing
$size = 256
$bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

$pathBg = New-Object System.Drawing.Drawing2D.GraphicsPath
$pathBg.AddEllipse(6, 6, $size - 12, $size - 12)
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
  [System.Drawing.Rectangle]::new(0, 0, $size, $size),
  [System.Drawing.Color]::FromArgb(255, 76, 29, 149),
  [System.Drawing.Color]::FromArgb(255, 139, 92, 246),
  [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal
)
$g.FillPath($grad, $pathBg)
$grad.Dispose()
$pathBg.Dispose()

# Soft highlight (stops “flat slab” look)
$hl = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(55, 255, 255, 255))
$g.FillEllipse($hl, 38, 32, 118, 88)
$hl.Dispose()

# Lens ring
$penRing = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(252, 255, 255, 255), 20)
$penRing.Alignment = [System.Drawing.Drawing2D.PenAlignment]::Center
$g.DrawEllipse($penRing, 58, 60, 100, 100)
$penRing.Dispose()

# Handle
$penHandle = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(252, 255, 255, 255), 22)
$penHandle.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$penHandle.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLine($penHandle, 142, 142, 214, 214)
$penHandle.Dispose()

$g.Dispose()
$out = Join-Path $dir 'tray-icon.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "Wrote $out (${size}x${size})"
