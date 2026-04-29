/**
 * @eden/plugin-debug-panel
 *
 * Debug 数据发布插件。
 * 订阅核心 DebugChannel，事件通过 WebSocket TCP 广播给 TUI。
 * 不加载此插件 → DebugChannel.emit() 无订阅者直接返回 → 零开销。
 */

import type { EdenPlugin, PluginContext, DebugEvent } from '@eden/core';
import { WebSocketServer, WebSocket } from 'ws';

const DEBUG_PORT = 18791;

interface DebugState {
  currentRequestId: string | null;
  systemPrompt: string;
  injectedContext: Array<{ source: string; content: string; tokens: number }>;
  tokenUsage: { in: number; out: number; total: number; cost?: number };
  toolCalls: Array<{ name: string; args: string; result?: string; latencyMs?: number }>;
  messages: Array<{ role: string; content: string }>;
  lastError?: string;
}

export class DebugPanelPlugin implements EdenPlugin {
  name = '@eden/plugin-debug-panel';
  version = '0.1.0';

  private ctx!: PluginContext;
  private wss!: WebSocketServer;
  private clients = new Set<WebSocket>();
  private state: DebugState = this.emptyState();
  private unsubscribe?: () => void;

  async init(ctx: PluginContext): Promise<void> {
    this.ctx = ctx;
    await this.startSocketServer();
  }

  private async startSocketServer(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.wss = new WebSocketServer({ port: DEBUG_PORT });
      this.wss.on('listening', () => resolve());
      this.wss.on('error', (err) => console.error('[debug-panel] socket error:', err.message));
      this.wss.on('connection', (ws) => {
        this.clients.add(ws);
        // 发送当前状态快照
        ws.send(JSON.stringify({ type: 'snapshot', state: this.state }));
        ws.on('close', () => { this.clients.delete(ws); });
        ws.on('error', () => { this.clients.delete(ws); });
      });
    });
  }

  getDebugPort(): number {
    return DEBUG_PORT;
  }

  async enable(): Promise<void> {
    const dc = this.ctx.debugChannel as { subscribe: (fn: (e: DebugEvent) => void) => () => void };
    this.unsubscribe = dc.subscribe((event: DebugEvent) => {
      this.handleDebugEvent(event);
    });
    console.log('[debug-panel] enabled — port:', DEBUG_PORT);
  }

  async disable(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  async destroy(): Promise<void> {
    this.disable();
    for (const client of Array.from(this.clients)) {
      client.close();
    }
    this.clients.clear();
    this.wss?.close();
  }

  private handleDebugEvent(event: DebugEvent): void {
    const data = event.data as Record<string, unknown>;
    switch (event.type) {
      case 'request_start':
        this.state.currentRequestId = event.requestId;
        this.state.systemPrompt = (data.systemPrompt as string) ?? '';
        this.state.injectedContext = (data.injectedContext as Array<{ source: string; content: string; tokens: number }>) ?? [];
        this.state.lastError = undefined;
        this.state.toolCalls = [];
        break;

      case 'request_end':
        this.state.tokenUsage = (data.usage as { in: number; out: number; total: number; cost?: number }) ?? { in: 0, out: 0, total: 0 };
        this.state.messages = (data.messages as Array<{ role: string; content: string }>) ?? [];
        break;

      case 'tool_called':
        this.state.toolCalls.push({
          name: (data.name as string) ?? '',
          args: JSON.stringify(data.args ?? {}),
        });
        break;

      case 'tool_result': {
        const tc = this.state.toolCalls[this.state.toolCalls.length - 1];
        if (tc) {
          tc.result = String(data.result ?? '');
          tc.latencyMs = data.latencyMs as number | undefined;
        }
        break;
      }

      case 'context_injected':
        this.state.injectedContext.push(
          ...((data.injections as Array<{ source: string; content: string; tokens: number }>) ?? [])
        );
        break;

      case 'error':
        this.state.lastError = (data.error as string) ?? 'unknown error';
        break;
    }

    this.broadcast({ type: 'event', event });
  }

  private broadcast(msg: object): void {
    const data = JSON.stringify(msg);
    for (const client of Array.from(this.clients)) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  private emptyState(): DebugState {
    return {
      currentRequestId: null,
      systemPrompt: '',
      injectedContext: [],
      tokenUsage: { in: 0, out: 0, total: 0 },
      toolCalls: [],
      messages: [],
    };
  }
}

// ==================== Plugin 入口 ====================

let pluginInstance: DebugPanelPlugin | null = null;

export function createPlugin(): EdenPlugin {
  if (!pluginInstance) {
    pluginInstance = new DebugPanelPlugin();
  }
  return pluginInstance;
}
