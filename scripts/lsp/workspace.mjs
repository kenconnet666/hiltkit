/**
 * TypeScript 7 语言服务器（`tsc --lsp --stdio`）的客户端。
 *
 * 服务器按文件所在的 tsconfig.json 建立项目，结果与 `pnpm typecheck` 一致（同一个 tsc、同样的配置）。
 * 磁盘上的改动由服务器自己监听（客户端不声明文件监听时它用内置的监听）；每次请求前按磁盘内容打开文件、
 * 请求完关闭，不留过期的编辑器状态。
 */
import { spawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const LANGUAGE_IDS = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'typescriptreact',
};
/** 每个类型工程一个文件：打开它就会加载这个工程 */
const PROJECT_ANCHORS = [
  'packages/core/src/index.ts',
  'packages/ui/src/index.ts',
  'apps/docs/src/main.tsx',
];
const SEVERITIES = [undefined, 'error', 'warning', 'message', 'suggestion'];
// LSP 的 CompletionItemKind 从 1 开始
const COMPLETION_KINDS = [
  undefined,
  'text',
  'method',
  'function',
  'constructor',
  'field',
  'variable',
  'class',
  'interface',
  'module',
  'property',
  'unit',
  'value',
  'enum',
  'keyword',
  'snippet',
  'color',
  'file',
  'reference',
  'folder',
  'enumMember',
  'constant',
  'struct',
  'event',
  'operator',
  'typeParameter',
];

/** 语言服务器的 JSON-RPC 连接：按 Content-Length 分帧；服务器发来的请求（读配置、注册能力）一律回空 */
class LanguageServer {
  #process;
  #buffer = Buffer.alloc(0);
  #pending = new Map();
  #nextId = 0;

  constructor(root) {
    const tsc = join(root, 'node_modules/typescript/bin/tsc');
    this.#process = spawn(process.execPath, [tsc, '--lsp', '--stdio'], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    this.#process.stdout.on('data', (chunk) => this.#receive(chunk));
    this.#process.on('exit', (code) => {
      for (const { reject } of this.#pending.values())
        reject(new Error(`TypeScript 语言服务器退出了（${code}）`));
      this.#pending.clear();
    });
    process.on('exit', () => this.#process.kill());
  }

  request(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.#nextId;
      this.#pending.set(id, { resolve, reject, method });
      this.#send({ id, method, params });
    });
  }

  notify(method, params) {
    this.#send({ method, params });
  }

  #send(message) {
    const body = JSON.stringify({ jsonrpc: '2.0', ...message });
    this.#process.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }

  #receive(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    for (;;) {
      const headerEnd = this.#buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const length = Number(/Content-Length: (\d+)/i.exec(this.#buffer.subarray(0, headerEnd))[1]);
      const start = headerEnd + 4;
      if (this.#buffer.length < start + length) return;
      const message = JSON.parse(this.#buffer.subarray(start, start + length).toString('utf8'));
      this.#buffer = this.#buffer.subarray(start + length);
      this.#dispatch(message);
    }
  }

  #dispatch(message) {
    if (message.method && message.id != null) {
      // workspace/configuration 要按请求的条数回答；其余（注册能力、进度）回 null 即可
      const items = message.params?.items;
      this.#send({ id: message.id, result: Array.isArray(items) ? items.map(() => null) : null });
      return;
    }
    const pending = message.id != null && this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    if (message.error) pending.reject(new Error(`${pending.method}：${message.error.message}`));
    else pending.resolve(message.result);
  }
}

export class TypeScriptWorkspace {
  #server;

  constructor(root) {
    this.root = realpathSync.native(resolve(root));
  }

  /** 第一次用到时启动语言服务器并完成初始化 */
  #connect() {
    this.#server ??= (async () => {
      const server = new LanguageServer(this.root);
      const rootUri = pathToFileURL(this.root).href;
      await server.request('initialize', {
        processId: process.pid,
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: 'hiltkit' }],
        capabilities: {
          textDocument: {
            hover: { contentFormat: ['markdown', 'plaintext'] },
            completion: { completionItem: { documentationFormat: ['markdown', 'plaintext'] } },
            diagnostic: {},
          },
          workspace: { configuration: true },
        },
      });
      server.notify('initialized', {});
      return server;
    })();
    return this.#server;
  }

  /** 按磁盘内容打开文件、发请求、关闭 */
  async #withDocument(file, run) {
    const server = await this.#connect();
    const uri = pathToFileURL(file).href;
    const text = readFileSync(file, 'utf8');
    server.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: LANGUAGE_IDS[extname(file)], version: 1, text },
    });
    try {
      return await run(server, { uri }, text);
    } finally {
      server.notify('textDocument/didClose', { textDocument: { uri } });
    }
  }

  // ───────────────────────── 文件与位置 ─────────────────────────

  /** 把调用方给的路径解析为工作区内的绝对路径；越界或扩展名不支持时报错 */
  resolveFile(filePath) {
    const absolute = realpathSync.native(resolve(this.root, filePath));
    const fromRoot = relative(this.root, absolute);
    if (isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith('..' + sep)) {
      throw new Error('文件不在工作区内：' + filePath);
    }
    if (!SUPPORTED_EXTENSIONS.has(extname(absolute))) {
      throw new Error('只支持 .ts / .tsx / .mts / .cts 文件：' + filePath);
    }
    return absolute;
  }

  /** 工作区内的文件显示为相对路径，其余显示绝对路径 */
  display(file) {
    const fromRoot = relative(this.root, file);
    return isAbsolute(fromRoot) || fromRoot.startsWith('..')
      ? file.replaceAll('\\', '/')
      : fromRoot.replaceAll('\\', '/');
  }

  #location({ uri, range }) {
    return { filePath: this.display(fileURLToPath(uri)), range: toRange(range) };
  }

  /** 对外 1 起始的行列 → LSP 的 0 起始位置；超出文件范围时报错 */
  async #at(filePath, line, column, run) {
    const file = this.resolveFile(filePath);
    return this.#withDocument(file, (server, textDocument, text) => {
      const lines = text.split('\n');
      if (line > lines.length) throw new Error(`第 ${line} 行超出文件范围`);
      if (column - 1 > lines[line - 1].replace(/\r$/, '').length)
        throw new Error(`第 ${line} 行第 ${column} 列超出范围`);
      const position = { line: line - 1, character: column - 1 };
      return run(server, { textDocument, position }, file);
    });
  }

  // ───────────────────────── 语言功能 ─────────────────────────

  async diagnostics(filePath) {
    const file = this.resolveFile(filePath);
    const report = await this.#withDocument(file, (server, textDocument) =>
      server.request('textDocument/diagnostic', { textDocument }),
    );
    const diagnostics = (report?.items ?? []).map((item) => ({
      code: 'TS' + item.code,
      severity: SEVERITIES[item.severity ?? 1],
      message: item.message,
      range: toRange(item.range),
    }));
    return {
      filePath: this.display(file),
      typescript: typescriptVersion(this.root),
      errors: diagnostics.filter((item) => item.severity === 'error').length,
      diagnostics,
    };
  }

  hover(filePath, line, column) {
    return this.#at(filePath, line, column, async (server, params, file) => {
      const hover = await server.request('textDocument/hover', params);
      return {
        filePath: this.display(file),
        contents: hover ? markupText(hover.contents) : null,
        range: hover?.range && toRange(hover.range),
      };
    });
  }

  definitions(filePath, line, column, limit) {
    return this.#at(filePath, line, column, async (server, params) => {
      const result = await server.request('textDocument/definition', params);
      // Location、Location[] 或 LocationLink[]
      const items = [result ?? []]
        .flat()
        .map((item) =>
          item.targetUri ? { uri: item.targetUri, range: item.targetSelectionRange } : item,
        );
      return {
        total: items.length,
        items: items.slice(0, limit).map((item) => this.#location(item)),
      };
    });
  }

  references(filePath, line, column, limit) {
    return this.#at(filePath, line, column, async (server, params, file) => {
      const anchors = PROJECT_ANCHORS.map((path) => join(this.root, path)).filter(
        (path) => path !== file,
      );
      const open = (path) => ({
        textDocument: {
          uri: pathToFileURL(path).href,
          languageId: LANGUAGE_IDS[extname(path)],
          version: 1,
          text: readFileSync(path, 'utf8'),
        },
      });
      // 服务器只在已加载的工程里找。各包是独立工程，都打开一个文件，才能跨包找到使用处
      for (const path of anchors) server.notify('textDocument/didOpen', open(path));
      try {
        const items =
          (await server.request('textDocument/references', {
            ...params,
            context: { includeDeclaration: true },
          })) ?? [];
        return {
          total: items.length,
          items: items.slice(0, limit).map((item) => this.#location(item)),
        };
      } finally {
        for (const path of anchors) {
          server.notify('textDocument/didClose', { textDocument: open(path).textDocument });
        }
      }
    });
  }

  completions(filePath, line, column, prefix, limit, detailLimit) {
    return this.#at(filePath, line, column, async (server, params) => {
      const result = await server.request('textDocument/completion', params);
      const all = Array.isArray(result) ? result : (result?.items ?? []);
      const entries = all.filter((item) => item.label.startsWith(prefix));
      const selected = entries.slice(0, limit);
      // 按需取签名与文档：逐项查询较慢，默认不取
      const details = await Promise.all(
        selected
          .slice(0, detailLimit)
          .map((item) => server.request('completionItem/resolve', item)),
      );
      return {
        total: entries.length,
        isIncomplete: result?.isIncomplete ?? false,
        items: selected.map((item, index) => ({
          name: item.label,
          kind: COMPLETION_KINDS[item.kind],
          insertText: item.insertText,
          source: item.labelDetails?.description,
          detail: details[index]?.detail,
          documentation: details[index]?.documentation && markupText(details[index].documentation),
        })),
      };
    });
  }
}

/** LSP 的 0 起始范围 → 对外的 1 起始行列 */
function toRange(range) {
  if (!range) return undefined;
  const toPoint = ({ line, character }) => ({ line: line + 1, column: character + 1 });
  return { start: toPoint(range.start), end: toPoint(range.end) };
}

/** MarkupContent、MarkedString 或它们的数组 → 文字 */
function markupText(contents) {
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) return contents.map(markupText).join('\n\n');
  return contents.value;
}

function typescriptVersion(root) {
  return JSON.parse(readFileSync(join(root, 'node_modules/typescript/package.json'), 'utf8'))
    .version;
}
