// 实验三附加：组件库带着第二份运行时（peer 没装对、版本范围不重叠）时会怎样，Vite 的 dedupe 能不能救。
//   先跑过 run.mjs（复用 .apps/app-plain）
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const app = join(root, '.apps', 'app-plain');
const nested = join(app, 'node_modules/@hilt/ui/node_modules/@hilt/runtime');
rmSync(join(app, 'node_modules/@hilt/ui/node_modules'), { recursive: true, force: true });
mkdirSync(join(nested, '..'), { recursive: true });
cpSync(join(app, 'node_modules/@hilt/runtime'), nested, { recursive: true });
// 第二份运行时带自己的 alien-signals：模块级的 activeSub 也成了两份
const alien = join(app, 'node_modules/alien-signals');
if (existsSync(alien)) cpSync(alien, join(nested, 'node_modules/alien-signals'), { recursive: true });

const browser = await chromium.launch();
async function attempt(label, resolve, port) {
  rmSync(join(app, 'node_modules/.vite'), { recursive: true, force: true });
  const server = await createServer({
    root: app,
    logLevel: 'silent',
    resolve,
    server: { port, strictPort: true },
  });
  await server.listen();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://localhost:${port}/`);
  await page.waitForSelector('#plain', { timeout: 15000 }).catch(() => errors.push('没有渲染出来'));
  await page.evaluate(() => window.api?.setTitle('changed')).catch(() => {});
  await page.waitForTimeout(300);
  const title = await page.locator('#plain').getAttribute('title').catch(() => null);
  const internal = await page.locator('#plain').getAttribute('data-clicks').catch(() => null);
  await page.click('#plain').catch(() => {});
  await page.waitForTimeout(100);
  const afterClick = await page.locator('#plain').getAttribute('data-clicks').catch(() => null);
  console.log(
    `${label}: 使用方 signal 传进组件库后属性=${title}（期望 changed），库内部 signal 点击后 data-clicks ${internal}→${afterClick}，错误 ${JSON.stringify(errors)}`,
  );
  await page.close();
  await server.close();
}
await attempt('两份运行时', {}, 5320);
await attempt('resolve.dedupe', { dedupe: ['@hilt/runtime', 'alien-signals'] }, 5321);
await browser.close();
rmSync(join(app, 'node_modules/@hilt/ui/node_modules'), { recursive: true, force: true });
void writeFileSync;
