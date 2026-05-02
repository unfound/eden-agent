/**
 * EdenServer — HTTP 服务端
 *
 * POST /api/chat           — 流式对话（SSE）
 * GET  /api/debug/logs     — 日志列表
 * GET  /api/debug/logs/:id — 单条日志详情
 *
 * 每次请求自动记录日志到 /home/sion/.eden/log/
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { mkdirSync, writeFileSync, readdirSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import type { Agent, Message } from './index.js';

export interface EdenServerOptions {
  port?: number;
}

// ── 日志模型 ──────────────────────────────────────────

interface RequestLog {
  id: string;
  timestamp: number;
  userMessage: string;
  systemPrompt: string;
  injectedContext: Array<{ source: string; content: string; tokens: number }>;
  rawRequest: Array<Record<string, unknown>>;
  rawResponse: { content: string; finishReason?: string; model?: string } | null;
  tokenUsage: { in: number; out: number; total: number; cost?: number };
  toolCalls: Array<{ name: string; args: string; result?: string; latencyMs?: number }>;
}

interface AISDKMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | Array<Record<string, unknown>>;
}

// ── Server ────────────────────────────────────────────

const LOG_DIR = '/home/sion/.eden/log';

export class EdenServer {
  private httpServer!: ReturnType<typeof createServer>;
  private agent!: Agent;
  public port: number;

  constructor(options: EdenServerOptions = {}) {
    this.port = options.port ?? 3000;
    // 确保日志目录存在
    mkdirSync(LOG_DIR, { recursive: true });
  }

  async start(agent: Agent): Promise<void> {
    this.agent = agent;

    return new Promise<void>((resolve) => {
      this.httpServer = createServer((req, res) => this.route(req, res));
      this.httpServer.listen(this.port, () => {
        console.log(`[eden] http://localhost:${this.port}`);
        resolve();
      });
      this.httpServer.on('error', (err: Error) => {
        console.error('[eden] error:', err.message);
      });
    });
  }

  stop(): void {
    this.httpServer?.close();
    console.log('[eden] stopped');
  }

  // ── 路由 ──────────────────────────────────────────

  private route(req: IncomingMessage, res: ServerResponse): void {
    this.setCORS(res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = req.url ?? '';
    const method = req.method ?? '';

    if (method === 'POST' && url === '/api/chat') {
      void this.handleChat(req, res);
      return;
    }
    if (method === 'GET' && url === '/api/debug/logs') {
      return this.handleListLogs(res);
    }
    if (method === 'GET' && url === '/api/debug/config') {
      return this.handleGetConfig(res);
    }
    const logMatch = url.match(/^\/api\/debug\/logs\/([^/]+)$/);
    if (method === 'GET' && logMatch) {
      return this.handleGetLog(res, logMatch[1]);
    }
    if (method === 'DELETE' && logMatch) {
      return this.handleDeleteLog(res, logMatch[1]);
    }

    res.writeHead(404);
    res.end('Not Found');
  }

  // ── POST /api/chat ────────────────────────────────

  private async handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    const aiMessages = (body.messages ?? []) as AISDKMessage[];

    const lastUserMsg = [...aiMessages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) { this.json(res, { error: 'No user message' }, 400); return; }

    const text = this.extractText(lastUserMsg);
    console.log('[eden] chat request:', { content: lastUserMsg.content, parts: (lastUserMsg as any).parts, extracted: text });
    if (!text) { this.json(res, { error: 'Empty message' }, 400); return; }

    // 转换消息历史（排除最后一条 user message，因为 agent 会单独追加）
    const history: Message[] = aiMessages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role as Message['role'], content: this.extractText(m) }))
      .filter(m => m.content);

    // 移除最后一条 user message（避免和 userMessage 参数重复）
    if (history.length > 0 && history[history.length - 1].role === 'user') {
      history.pop();
    }

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // 准备日志
    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const log: RequestLog = {
      id: logId,
      timestamp: Date.now(),
      userMessage: text,
      systemPrompt: '',
      injectedContext: [],
      rawRequest: [],
      rawResponse: null,
      tokenUsage: { in: 0, out: 0, total: 0 },
      toolCalls: [],
    };

    try {
      // 订阅调试事件
      const unsub = this.agent.debugChannel.subscribe((event) => {
        this.applyDebugEvent(log, event);
      });

      const { stream, usage: usagePromise } = await this.agent.chatStream(history, text);
      const partId = `part_${Date.now()}`;

      res.write(`data: ${JSON.stringify({ type: 'start', messageId: logId })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'text-start', id: partId })}\n\n`);

      let prevLen = 0;
      let fullText = '';
      for await (const chunk of stream) {
        const delta = chunk.slice(prevLen);
        prevLen = chunk.length;
        fullText = chunk;
        res.write(`data: ${JSON.stringify({ type: 'text-delta', id: partId, delta })}\n\n`);
      }

      res.write(`data: ${JSON.stringify({ type: 'text-end', id: partId })}\n\n`);

      const usage = await usagePromise;
      log.tokenUsage = usage;
      log.rawResponse = { content: fullText, finishReason: 'stop' };
      unsub();

      // 保存日志
      this.saveLog(log);

      res.write(`data: ${JSON.stringify({ type: 'finish-step' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'finish', finishReason: 'stop' })}\n\n`);
      res.end();
    } catch (err) {
      log.rawResponse = { content: '', finishReason: 'error' };
      this.saveLog(log);

      res.write(`data: ${JSON.stringify({ type: 'error', errorText: (err as Error).message })}\n\n`);
      res.end();
    }
  }

  // ── 日志 API ──────────────────────────────────────

  private handleListLogs(res: ServerResponse) {
    try {
      const files = readdirSync(LOG_DIR)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse(); // 最新的在前

      const logs = files.map(f => {
        try {
          const data = JSON.parse(readFileSync(join(LOG_DIR, f), 'utf-8')) as RequestLog;
          return {
            id: data.id,
            timestamp: data.timestamp,
            userMessage: data.userMessage,
            model: data.rawResponse?.model,
            tokenIn: data.tokenUsage.in,
            tokenOut: data.tokenUsage.out,
            toolCallCount: data.toolCalls.length,
          };
        } catch {
          return null;
        }
      }).filter(Boolean);

      this.json(res, logs);
    } catch {
      this.json(res, []);
    }
  }

  private handleGetLog(res: ServerResponse, logId: string) {
    const filePath = join(LOG_DIR, `${logId}.json`);
    if (!existsSync(filePath)) {
      this.json(res, { error: 'Not found' }, 404);
      return;
    }
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    this.json(res, data);
  }

  private handleGetConfig(res: ServerResponse) {
    this.json(res, { logDir: LOG_DIR });
  }

  private handleDeleteLog(res: ServerResponse, logId: string) {
    const filePath = join(LOG_DIR, `${logId}.json`);
    if (!existsSync(filePath)) {
      this.json(res, { error: 'Not found' }, 404);
      return;
    }
    try {
      unlinkSync(filePath);
      this.json(res, { ok: true });
    } catch (err) {
      this.json(res, { error: (err as Error).message }, 500);
    }
  }

  // ── 日志持久化 ──────────────────────────────────────

  private saveLog(log: RequestLog) {
    const filePath = join(LOG_DIR, `${log.id}.json`);
    writeFileSync(filePath, JSON.stringify(log, null, 2));
  }

  // ── 调试事件处理 ──────────────────────────────────

  private applyDebugEvent(log: RequestLog, event: { type: string; requestId: string; data: Record<string, unknown> }) {
    const d = event.data;
    switch (event.type) {
      case 'request_start':
        log.systemPrompt = (d.systemPrompt as string) ?? '';
        log.injectedContext = (d.injectedContext as RequestLog['injectedContext']) ?? [];
        log.rawRequest = (d.rawRequest as RequestLog['rawRequest']) ?? [];
        break;
      case 'tool_called':
        log.toolCalls.push({
          name: (d.name as string) ?? '',
          args: JSON.stringify(d.args ?? {}),
        });
        break;
      case 'tool_result': {
        const tc = log.toolCalls[log.toolCalls.length - 1];
        if (tc) {
          tc.result = String(d.result ?? '');
          tc.latencyMs = d.latencyMs as number | undefined;
        }
        break;
      }
      case 'context_injected':
        log.injectedContext.push(
          ...((d.injections as RequestLog['injectedContext']) ?? [])
        );
        break;
    }
  }

  // ── 工具函数 ──────────────────────────────────────

  private extractText(msg: AISDKMessage): string {
    // 尝试 content 字段
    const c: unknown = msg.content;
    if (typeof c === 'string' && c.trim()) return c.trim();
    if (Array.isArray(c)) {
      const t = (c as Array<Record<string, unknown>>)
        .map(p => (p.text as string) ?? '')
        .join('')
        .trim();
      if (t) return t;
    }
    // 尝试 parts 字段（AI SDK v6 格式）
    const parts = (msg as any).parts;
    if (Array.isArray(parts)) {
      const t = parts
        .filter((p: any) => p.type === 'text')
        .map((p: any) => p.text ?? '')
        .join('')
        .trim();
      if (t) return t;
    }
    return '';
  }

  private async readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    const buffers: Buffer[] = [];
    for await (const chunk of req) buffers.push(chunk as Buffer);
    return JSON.parse(Buffer.concat(buffers).toString());
  }

  private json(res: ServerResponse, data: unknown, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private setCORS(res: ServerResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}
