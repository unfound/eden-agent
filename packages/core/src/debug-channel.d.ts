/**
 * DebugChannel — Debug 数据发布基础设施
 * Debug Plugin 订阅通道，核心写入数据，两者解耦
 */
import type { DebugEvent, DebugEventType } from './types.js';
type DebugListener = (event: DebugEvent) => void;
export declare class DebugChannel {
    private listeners;
    private requestIdCounter;
    /**
     * 订阅 debug 事件
     */
    subscribe(listener: DebugListener): () => void;
    /**
     * 发布一个 debug 事件（仅当有订阅者时才采集数据）
     */
    emit(type: DebugEventType, requestId: string, data?: Record<string, unknown>): void;
    /**
     * 生成新的请求 ID
     */
    newRequestId(): string;
}
export {};
//# sourceMappingURL=debug-channel.d.ts.map