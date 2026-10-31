# 最终计时：pwsh 18-plain/final-bench.ps1（在 experiments 下跑）。串行，一次一项；机器上别的负载记在文件头
$log = 'results/18-final.txt'
$load = (Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average
Set-Content -LiteralPath $log -Value "final $(Get-Date -Format 'yyyy-MM-dd HH:mm')  CPU load at start: $load%"
function Step([string]$label, [string[]]$command) {
  Add-Content -LiteralPath $log -Value "`n## $label  ($(Get-Date -Format 'HH:mm:ss'))"
  $out = & node @command 2>&1 | ForEach-Object { "$_" }
  Add-Content -LiteralPath $log -Value $out
  Add-Content -LiteralPath $log -Value "exit=$LASTEXITCODE"
}
Step 'rows' @('05-compare/rows/run.mjs', '--rounds=7', '--only=hilt-plain,hilt-plain-deep,hilt-runes,vue35-vdom,vue36-vapor')
Step 'vue-compare' @('18-plain/vue-compare/run.mjs', '--rounds=7')
Step 'bench' @('18-plain/bench.mjs')
Step 'dev' @('18-plain/dev.mjs', '300', '1000')
Step 'deep-default' @('--expose-gc', '18-plain/deep-default.mjs')
Add-Content -LiteralPath $log -Value "`ndone $(Get-Date -Format 'HH:mm:ss')"
