# Servidor local mínimo para Transcriptor Local.
# Solo escucha en localhost: nada es accesible desde otros equipos.
param([int]$Port = 8765, [switch]$NoOpen)

$root = (Split-Path -Parent $MyInvocation.MyCommand.Path).TrimEnd('\') + '\'
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Transcriptor Local abierto en http://localhost:$Port/"
Write-Host "Cierra esta ventana para detenerlo."
if (-not $NoOpen) { Start-Process "http://localhost:$Port/" }

$mime = @{ '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript'; '.css' = 'text/css';
           '.json' = 'application/json'; '.wasm' = 'application/wasm'; '.png' = 'image/png'; '.svg' = 'image/svg+xml' }

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try {
        $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
        if ([string]::IsNullOrEmpty($path)) { $path = 'index.html' }
        $file = [IO.Path]::GetFullPath((Join-Path $root $path))
        if ($file.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
            $bytes = [IO.File]::ReadAllBytes($file)
            $ext = [IO.Path]::GetExtension($file).ToLower()
            if ($mime.ContainsKey($ext)) { $ctx.Response.ContentType = $mime[$ext] } else { $ctx.Response.ContentType = 'application/octet-stream' }
            $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $ctx.Response.StatusCode = 404
        }
    } catch {
        $ctx.Response.StatusCode = 500
    } finally {
        $ctx.Response.Close()
    }
}
