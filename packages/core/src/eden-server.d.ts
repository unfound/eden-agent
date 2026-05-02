/**
 * EdenServer — HTTP 服务端
 *
 * POST /api/chat           — 流式对话（SSE）
 * GET  /api/debug/logs     — 日志列表
 * GET  /api/debug/logs/:id — 单条日志详情
 *
 * 每次请求自动记录日志到 /home/sion/.eden/log/
 */
import type { Agent } from './index.js';
export interface EdenServerOptions {
    port?: number;
}
export declare class EdenServer {
    private httpServer;
    private agent;
    port: number;
    constructor(options?: EdenServerOptions);
    start(agent: Agent): Promise<void>;
    stop(): void;
    private route;
    private handleChat;
    private handleListLogs;
    private handleGetLog;
    private saveLog;
    private applyDebugEvent;
    private extractText;
    private readBody;
    private json;
    private setCORS;
}
//# sourceMappingURL=eden-server.d.ts.map