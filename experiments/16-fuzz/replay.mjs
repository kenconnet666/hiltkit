// node 16-fuzz/replay.mjs 16-fuzz/failures/hydrate-123.json [--source]
// 重放一个保存下来的（最小化）用例：打印失败类别和消息；水合方向加 --source 打印生成的 TSX 源码。
import { readFile } from 'node:fs/promises';

const [file, ...flags] = process.argv.slice(2);
const saved = JSON.parse(await readFile(file, 'utf8'));
const name = file.split(/[\/]/).pop().split('-')[0];
const { direction } = await import(`./${name}.mjs`);
await direction.setup?.();
if (flags.includes('--source') && name === 'hydrate') {
  const { printModule } = await import('./hydrate-gen.mjs');
  console.log(printModule(saved.case));
}
const kind = await direction.recheck(saved.case);
console.log(`重放：${kind ?? '通过'}（保存时：${saved.kind}）`);
if (name === 'hydrate' && flags.includes('--detail')) {
  const result = await direction.detail(saved.case);
  console.log(result);
}
await direction.teardown?.();
