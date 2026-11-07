#!/bin/bash
# 在测试机上跑：拉最新代码，并行跑多个随机种子，结果在 tools/fuzz/out/，汇总在 tools/fuzz/out/summary.txt
# 用法：bash tools/fuzz/run.sh [每个进程步数=100000] [进程数=4]
cd "$(dirname "$0")/../.."
STEPS=${1:-100000}; N=${2:-4}; OUT=tools/fuzz/out; mkdir -p $OUT
for i in $(seq 1 $N); do
  MODE=$([ $((i % 2)) = 1 ] && echo test || echo boost)
  SEED=$((RANDOM * 32768 + RANDOM))
  nohup node tools/fuzz/fuzz.mjs --seed $SEED --steps $STEPS --mode $MODE --out $OUT > $OUT/run-$MODE-$SEED.log 2>&1 &
done
wait
node tools/fuzz/report.mjs $OUT > $OUT/summary.txt
cat $OUT/summary.txt
