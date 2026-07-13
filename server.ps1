# Bboggl-Team 로컬 서버 — 이 창을 닫으면 서버가 꺼집니다.
# 개인용 버전(포트 5173)과 충돌하지 않도록 5174 포트를 사용합니다.
$root = $PSScriptRoot
$port = 5174
$url = "http://127.0.0.1:$port/"

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($url)

try {
  $listener.Start()
} catch {
  Write-Host "서버를 시작하지 못했어요. 이미 실행 중인 창이 있는지 확인해주세요."
  Write-Host "(다른 프로그램이 $port 포트를 쓰고 있을 수도 있어요)"
  Read-Host "종료하려면 Enter"
  exit
}

Write-Host "Bboggl-Team 서버가 실행 중입니다: $url"
Write-Host "이 창을 닫으면 서버가 종료됩니다."
Write-Host ""

$mime = @{
  ".html"="text/html; charset=utf-8"; ".css"="text/css"; ".js"="application/javascript";
  ".json"="application/json"; ".svg"="image/svg+xml"; ".png"="image/png"; ".ico"="image/x-icon"
}

while ($listener.IsListening) {
  $context = $listener.GetContext()
  $req = $context.Request
  $res = $context.Response
  $path = $req.Url.LocalPath
  if ($path -eq "/") { $path = "/index.html" }
  $filePath = Join-Path $root ($path.TrimStart('/'))

  if (Test-Path $filePath -PathType Leaf) {
    $ext = [System.IO.Path]::GetExtension($filePath)
    $contentType = $mime[$ext]
    if (-not $contentType) { $contentType = "application/octet-stream" }
    $bytes = [System.IO.File]::ReadAllBytes($filePath)
    $res.ContentType = $contentType
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
  } else {
    $res.StatusCode = 404
    $msg = [System.Text.Encoding]::UTF8.GetBytes("Not found: $path")
    $res.OutputStream.Write($msg, 0, $msg.Length)
  }
  $res.OutputStream.Close()
}
