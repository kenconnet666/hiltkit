# 全量回归：pwsh 18-plain/regress.ps1（在 experiments 下跑）。每条命令一行汇总，详情写进 results/18-regress.txt
$log = 'results/18-regress.txt'
Set-Content -LiteralPath $log -Value "regress $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
function Step([string]$label, [string[]]$command) {
  $start = Get-Date
  $out = & node @command 2>&1 | ForEach-Object { "$_" }
  $code = $LASTEXITCODE
  $seconds = [math]::Round(((Get-Date) - $start).TotalSeconds)
  $failures = @($out | Where-Object { $_ -match '^\s*FAIL' })
  $tail = ($out | Where-Object { $_ -match '通过|passed|汇总|error TS' } | Select-Object -Last 2) -join ' / '
  $line = "$(if ($code -eq 0 -and -not $failures.Count) { 'ok  ' } else { 'FAIL' }) $label  exit=$code  $($seconds)s  $tail"
  Write-Output $line
  Add-Content -LiteralPath $log -Value $line
  if ($failures.Count) { Add-Content -LiteralPath $log -Value ($failures | Select-Object -First 20 | ForEach-Object { "    $_" }) }
}
$tsc = '13-ts/node_modules/typescript/bin/tsc'
Step 'types 18-plain' @($tsc, '-p', '18-plain/tsconfig.json')
Step 'types port' @($tsc, '-p', '18-plain/port/tsconfig.json')
foreach ($name in 'chromium', 'firefox', 'webkit') {
  $env:HILT_BROWSER = $name
  Step "run $name" @('18-plain/run.mjs')
  Step "verify $name" @('18-plain/verify.mjs')
  Step "lib $name" @('18-plain/lib/run.mjs')
  Step "port $name" @('18-plain/port/run.mjs')
}
$env:HILT_BROWSER = $null
Step 'fuzz' @('18-plain/fuzz/run.mjs', '--no-shrink')
Step 'fuzz mixed' @('18-plain/fuzz/run.mjs', '--no-shrink', '--mixed', '--only=kernel')
Step 'leak' @('--expose-gc', '18-plain/leak.mjs')
Step 'devtools' @('18-plain/devtools/test.mjs')
Step 'runes run-all' @('run-all.mjs')
