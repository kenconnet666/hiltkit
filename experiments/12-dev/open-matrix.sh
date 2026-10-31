#!/bin/sh
# 任务二的实验矩阵（以及改用"库目录交给 fs.watch"后重跑的 HMR 配置）：串行。输出在 12-dev/.gen/
cd "$(dirname "$0")/.."
export HILT_PACKAGES=03-publish/packages-v0
ALL=base-chokidar,base,pool4,pool8,pool16,cache,pool8-cache,optimize,bundle,bundle-pool8,bundle-cache,direct
for cfg in "300 baseline" "1000 baseline" "1000 bucketed"; do
  set -- $cfg
  echo "### hmr native $cfg"
  HMR_WATCH=native node 12-dev/hmr.mjs $1 12 3 $2 > 12-dev/.gen/matrix-$1-$2-native-flat.log 2>&1
done
echo "### hmr gap native"
HMR_GAP=1500 HMR_WATCH=native node 12-dev/hmr.mjs 1000 10 2 baseline > 12-dev/.gen/matrix-1000-gap-native.log 2>&1
for n in 300 1000; do
  echo "### profile $n"
  OPEN_PROF=1 node 12-dev/open.mjs $n base-chokidar 1 > 12-dev/.gen/open-prof-$n.log 2>&1
  echo "### matrix $n"
  node 12-dev/open.mjs $n $ALL 3 > 12-dev/.gen/open-$n.log 2>&1
done
echo DONE
