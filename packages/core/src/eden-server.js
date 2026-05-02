/**
 * EdenServer — HTTP 服务端
 *
 * POST /api/chat           — 流式对话（SSE）
 * GET  /api/debug/logs     — 日志列表
 * GET  /api/debug/logs/:id — 单条日志详情
 *
 * 每次请求自动记录日志到 /home/sion/.eden/log/
 */
import { createServer } from 'http';
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
// ── Server ────────────────────────────────────────────
const LOG_DIR = '/home/sion/.eden/log';
export class EdenServer {
    httpServer;
    agent;
    port;
    constructor(options = {}) {
        this.port = options.port ?? 3000;
        // 确保日志目录存在
        mkdirSync(LOG_DIR, { recursive: true });
    }
    async start(agent) {
        this.agent = agent;
        return new Promise((resolve) => {
            this.httpServer = createServer((req, res) => this.route(req, res));
            this.httpServer.listen(this.port, () => {
                console.log(`[eden] http://localhost:${this.port}`);
                resolve();
            });
            this.httpServer.on('error', (err) => {
                console.error('[eden] error:', err.message);
            });
        });
    }
    stop() {
        this.httpServer?.close();
        console.log('[eden] stopped');
    }
    // ── 路由 ──────────────────────────────────────────
    route(req, res) {
        this.setCORS(res);
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        const url = req.url ?? '';
        const method = req.method ?? '';
        if (method === 'POST' && url === '/api/chat') {
            void this.handleChat(req, res);
            return;
        }
        if (method === 'GET' && url === '/api/debug/logs') {
            return this.handleListLogs(res);
        }
        const logMatch = url.match(/^\/api\/debug\/logs\/([^/]+)$/);
        if (method === 'GET' && logMatch) {
            return this.handleGetLog(res, logMatch[1]);
        }
        res.writeHead(404);
        res.end('Not Found');
    }
    // ── POST /api/chat ────────────────────────────────
    async handleChat(req, res) {
        const body = await this.readBody(req);
        const aiMessages = (body.messages ?? []);
        const lastUserMsg = [...aiMessages].reverse().find(m => m.role === 'user');
        if (!lastUserMsg) {
            this.json(res, { error: 'No user message' }, 400);
            return;
        }
        const text = this.extractText(lastUserMsg);
        console.log('[eden] chat request:', { content: lastUserMsg.content, parts: lastUserMsg.parts, extracted: text });
        if (!text) {
            this.json(res, { error: 'Empty message' }, 400);
            return;
        }
        // 转换消息历史
        const history = aiMessages
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => ({ role: m.role, content: this.extractText(m) }))
            .filter(m => m.content);
        // SSE headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        // 准备日志
        const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const log = {
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
        }
        catch (err) {
            log.rawResponse = { content: '', finishReason: 'error' };
            this.saveLog(log);
            res.write(`data: ${JSON.stringify({ type: 'error', errorText: err.message })}\n\n`);
            res.end();
        }
    }
    // ── 日志 API ──────────────────────────────────────
    handleListLogs(res) {
        try {
            const files = readdirSync(LOG_DIR)
                .filter(f => f.endsWith('.json'))
                .sort()
                .reverse(); // 最新的在前
            const logs = files.map(f => {
                try {
                    const data = JSON.parse(readFileSync(join(LOG_DIR, f), 'utf-8'));
                    return {
                        id: data.id,
                        timestamp: data.timestamp,
                        userMessage: data.userMessage,
                        model: data.rawResponse?.model,
                        tokenIn: data.tokenUsage.in,
                        tokenOut: data.tokenUsage.out,
                        toolCallCount: data.toolCalls.length,
                    };
                }
                catch {
                    return null;
                }
            }).filter(Boolean);
            this.json(res, logs);
        }
        catch {
            this.json(res, []);
        }
    }
    handleGetLog(res, logId) {
        const filePath = join(LOG_DIR, `${logId}.json`);
        if (!existsSync(filePath)) {
            this.json(res, { error: 'Not found' }, 404);
            return;
        }
        const data = JSON.parse(readFileSync(filePath, 'utf-8'));
        this.json(res, data);
    }
    // ── 日志持久化 ──────────────────────────────────────
    saveLog(log) {
        const filePath = join(LOG_DIR, `${log.id}.json`);
        writeFileSync(filePath, JSON.stringify(log, null, 2));
    }
    // ── 调试事件处理 ──────────────────────────────────
    applyDebugEvent(log, event) {
        const d = event.data;
        switch (event.type) {
            case 'request_start':
                log.systemPrompt = d.systemPrompt ?? '';
                log.injectedContext = d.injectedContext ?? [];
                log.rawRequest = d.rawRequest ?? [];
                break;
            case 'tool_called':
                log.toolCalls.push({
                    name: d.name ?? '',
                    args: JSON.stringify(d.args ?? {}),
                });
                break;
            case 'tool_result': {
                const tc = log.toolCalls[log.toolCalls.length - 1];
                if (tc) {
                    tc.result = String(d.result ?? '');
                    tc.latencyMs = d.latencyMs;
                }
                break;
            }
            case 'context_injected':
                log.injectedContext.push(...(d.injections ?? []));
                break;
        }
    }
    // ── 工具函数 ──────────────────────────────────────
    extractText(msg) {
        // 尝试 content 字段
        const c = msg.content;
        if (typeof c === 'string' && c.trim())
            return c.trim();
        if (Array.isArray(c)) {
            const t = c
                .map(p => p.text ?? '')
                .join('')
                .trim();
            if (t)
                return t;
        }
        // 尝试 parts 字段（AI SDK v6 格式）
        const parts = msg.parts;
        if (Array.isArray(parts)) {
            const t = parts
                .filter((p) => p.type === 'text')
                .map((p) => p.text ?? '')
                .join('')
                .trim();
            if (t)
                return t;
        }
        return '';
    }
    async readBody(req) {
        const buffers = [];
        for await (const chunk of req)
            buffers.push(chunk);
        return JSON.parse(Buffer.concat(buffers).toString());
    }
    json(res, data, status = 200) {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    }
    setCORS(res) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
}
//# sourceMappingURL=eden-server.js.map