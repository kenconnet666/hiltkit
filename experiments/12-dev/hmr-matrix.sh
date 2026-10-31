#!/bin/sh
# 任务一的实验矩阵：串行跑，每个配置 3 轮 × 12 样本。输出在 12-dev/.gen/out/
cd "$(dirname "$0")/.."
export HILT_PACKAGES=03-publish/packages-v0
run() { echo "### $*"; env "$@" ; }
for cfg in \
  "300 baseline chokidar flat" \
  "1000 baseline chokidar flat" \
  "1000 bucketed chokidar flat" \
  "1000 baseline native flat" \
  "1000 baseline chokidar folders" \
  "300 baseline native flat" \
  "1000 bucketed native flat"; do
  set -- $cfg
  echo "### $cfg"
  HMR_WATCH=$3 HMR_LAYOUT=$4 node 12-dev/hmr.mjs $1 12 3 $2 > 12-dev/.gen/matrix-$1-$2-$3-$4.log 2>&1
done
# 复现 run.mjs 的写缓存行为：缓存文件写进 root 内
for n in 300 1000; do
  echo "### cache $n"
  HMR_CACHE=1 node 12-dev/hmr.mjs $n 12 3 baseline > 12-dev/.gen/matrix-$n-cache.log 2>&1
done
# 间隔 1.5 秒（接近真实保存节奏，没有上一次的目录重扫残留）
for w in chokidar native; do
  echo "### gap $w"
  HMR_GAP=1500 HMR_WATCH=$w node 12-dev/hmr.mjs 1000 10 2 baseline > 12-dev/.gen/matrix-1000-gap-$w.log 2>&1
done
echo DONE
