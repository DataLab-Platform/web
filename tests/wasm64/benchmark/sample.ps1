param([Parameter(Mandatory)][string]$RendererIds, [Parameter(Mandatory)][string]$OutputFile)
$ErrorActionPreference = 'Stop'
$ids = $RendererIds.Split(',') | ForEach-Object { [int]$_ }
$memory = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
[ordered]@{available=[long]$memory.AvailableBytes; committed=[long]$memory.CommittedBytes; commitLimit=[long]$memory.CommitLimit} | ConvertTo-Json -Compress | Set-Content -Encoding ascii "$OutputFile.host"
'unixMs,rendererPid,workingSetBytes,peakWorkingSetBytes,privateBytes' | Set-Content -Encoding ascii $OutputFile
while ($true) {
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $rows = foreach ($id in $ids) {
        $p = Get-Process -Id $id -ErrorAction SilentlyContinue
        if ($p) { "$now,$id,$($p.WorkingSet64),$($p.PeakWorkingSet64),$($p.PrivateMemorySize64)" }
    }
    if (!$rows) { break }
    $rows | Add-Content -Encoding ascii $OutputFile
    Start-Sleep -Milliseconds 250
}
