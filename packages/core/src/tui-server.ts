/**
 * TuiServer — Agent ↔ TUI 双向 WebSocket 服务器 + HTTP streaming
 *
 * WS: 为 OpenTUI 客户端服务（已有）
 * HTTP: 为 Web UI (assistant-ui) 提供 AI SDK 兼容的 streaming endpoint
 *
 * HTTP API:
 *   POST /api/chat
 *     Body: { messages: AISDK_Message[], system?: string }
 *     Response: text/event-stream (AI SDK Data Stream Protocol v1)
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import type { Agent, Message, TokenUsage, ContextInjection } from './index.js';

export interface TuiServerOptions {
  /** HTTP 端口，默认 3000 */
  port?: number;
}

// AI SDK 消息格式
interface AISDKMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
}

export class TuiServer {
  private wss!: WebSocketServer;
  private httpServer!: ReturnType<typeof createServer>;
  private wsClients = new Set<WebSocket>();
  private agent!: Agent;
  private messages: Message[] = [];
  public port: number;

  constructor(options: TuiServerOptions = {}) {
    this.port = options.port ?? 3000;
  }

  async start(agent: Agent): Promise<void> {
    this.agent = agent;

    return new Promise<void>((resolve) => {
      // 创建 HTTP server
      this.httpServer = createServer((req, res) => {
        this.handleHTTP(req, res);
      });

      // 将 WS server 挂载到同一个 HTTP server
      this.wss = new WebSocketServer({ server: this.httpServer, path: '/ws' });

      this.httpServer.listen(this.port, () => {
        console.log(`[tui-server] HTTP+WS 启动在 http://localhost:${this.port}`);
        resolve();
      });

      this.httpServer.on('error', (err: Error) => {
        console.error('[tui-server] 错误:', err.message);
      });

      this.wss.on('connection', (ws: WebSocket) => {
        this.wsClients.add(ws);
        ws.send(JSON.stringify({ type: 'connected', port: this.port }));
        ws.send(JSON.stringify({ type: 'history', messages: this.messages }));

        ws.on('message', (raw: string) => {
          this.handleWSMessage(ws, raw.toString());
        });
        ws.on('close', () => this.wsClients.delete(ws));
        ws.on('error', () => this.wsClients.delete(ws));
      });
    });
  }

  stop(): void {
    for (const client of Array.from(this.wsClients)) {
      client.close();
    }
    this.wsClients.clear();
    this.wss?.close();
    this.httpServer?.close();
    console.log('[tui-server] 已停止');
  }

  // ==================== HTTP 处理 ====================

  private handleHTTP(req: IncomingMessage, res: ServerResponse): void {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url ?? '';

    if (req.method === 'POST' && url === '/api/chat') {
      this.handleChatAPI(req, res);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  }

  /**
   * POST /api/chat — AI SDK v6 streaming endpoint
   *
   * Response 格式 (AI SDK Data Stream Protocol v6):
   *   data: {"type":"start","messageId":"msg_id"}
   *   data: {"type":"text-start","id":"part_id"}
   *   data: {"type":"text-delta","id":"part_id","delta":"逐字增量"}
   *   data: {"type":"text-end","id":"part_id"}
   *   data: {"type":"finish-step"}
   *   data: {"type":"finish","finishReason":"stop"}
   */
  private async handleChatAPI(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // 读取 body
    const buffers: Buffer[] = [];
    for await (const chunk of req) {
      buffers.push(chunk as Buffer);
    }
    const body = JSON.parse(Buffer.concat(buffers).toString());

    // assistant-ui 发来的消息可能是数组格式（content 为数组）
    const aiMessages: AISDKMessage[] = body.messages ?? [];

    // 找最后一条 user 消息（支持 content 是数组或字符串）
    const lastUserMsg = [...aiMessages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'No user message found' }));
      return;
    }

    // assistant-ui 可能发 content 为数组（[{type:"text",text:"hello"}]），提取纯文本
    // AI SDK v6 消息格式：同时支持 content 和 parts 字段
    const content: unknown = lastUserMsg.content ?? (lastUserMsg as any).parts;
    const text = typeof content === 'string'
      ? content.trim()
      : (Array.isArray(content)
        ? (content as Array<Record<string, string>>).map((p) => p.text ?? '').join('').trim()
        : '');

    if (!text) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Empty message' }));
      return;
    }

    // 设置 SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // 记录消息
    this.messages.push({ role: 'user', content: text });

    try {
      const { stream, usage: usagePromise } = await this.agent.chatStream(
        this.messages, text
      );

      // AI SDK v6 协议: start → text-start → text-delta* → text-end → finish-step → finish
      const messageId = `msg_${Date.now()}`;
      const partId = `part_${Date.now()}`;

      res.write(`data: ${JSON.stringify({ type: 'start', messageId })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'text-start', id: partId })}\n\n`);

      let prevLen = 0;
      let fullText = '';
      for await (const content of stream) {
        const delta = content.slice(prevLen);
        prevLen = content.length;
        fullText = content;
        // text-delta 只发增量字符
        res.write(`data: ${JSON.stringify({ type: 'text-delta', id: partId, delta })}\n\n`);
      }

      res.write(`data: ${JSON.stringify({ type: 'text-end', id: partId })}\n\n`);

      const usage = await usagePromise;
      // 记录回复
      this.messages.push({ role: 'assistant', content: fullText });

      // 广播给 WS 客户端
      this.broadcastWS({ type: 'done', usage });
      this.broadcastWS({ type: 'history', messages: this.messages });

      // finish-step + finish
      res.write(`data: ${JSON.stringify({ type: 'finish-step' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'finish', finishReason: 'stop' })}\n\n`);
      res.end();
    } catch (err) {
      res.write(`data: ${JSON.stringify({
        type: 'error',
        errorText: (err as Error).message,
      })}\n\n`);
      res.end();
    }
  }

  // ==================== WS 处理（已有） ====================

  private async handleWSMessage(ws: WebSocket, raw: string): Promise<void> {
    let msg: { type: string; text?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: '无效的 JSON' }));
      return;
    }

    switch (msg.type) {
      case 'get_history':
        ws.send(JSON.stringify({ type: 'history', messages: this.messages }));
        break;

      case 'chat': {
        const text = (msg.text ?? '').trim();
        if (!text) {
          ws.send(JSON.stringify({ type: 'error', message: '消息不能为空' }));
          return;
        }
        this.messages.push({ role: 'user', content: text });
        this.broadcastWS({ type: 'history', messages: this.messages });
        this.broadcastWS({ type: 'thinking', value: true });

        try {
          const { stream, usage: usagePromise } = await this.agent.chatStream(
            this.messages, text
          );
          let fullText = '';
          for await (const content of stream) {
            fullText = content;
            this.broadcastWS({ type: 'token', text: fullText });
          }
          const usage = await usagePromise;
          this.messages.push({ role: 'assistant', content: fullText });
          this.broadcastWS({ type: 'done', usage });
          this.broadcastWS({ type: 'history', messages: this.messages });
          this.broadcastWS({ type: 'thinking', value: false });
        } catch (err) {
          this.broadcastWS({ type: 'error', message: (err as Error).message });
          this.broadcastWS({ type: 'thinking', value: false });
        }
        break;
      }

      default:
        ws.send(JSON.stringify({ type: 'error', message: `未知消息类型: ${msg.type}` }));
    }
  }

  private broadcastWS(msg: Record<string, unknown>): void {
    const data = JSON.stringify(msg);
    for (const client of Array.from(this.wsClients)) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }
}
