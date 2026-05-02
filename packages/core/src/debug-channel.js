/**
 * DebugChannel — Debug 数据发布基础设施
 * Debug Plugin 订阅通道，核心写入数据，两者解耦
 */
export class DebugChannel {
    listeners = new Set();
    requestIdCounter = 0;
    /**
     * 订阅 debug 事件
     */
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    /**
     * 发布一个 debug 事件（仅当有订阅者时才采集数据）
     */
    emit(type, requestId, data = {}) {
        if (this.listeners.size === 0)
            return; // 零开销：无订阅者则不采集
        const event = { type, requestId, timestamp: Date.now(), data };
        for (const listener of this.listeners) {
            try {
                listener(event);
            }
            catch {
                // ignore listener errors
            }
        }
    }
    /**
     * 生成新的请求 ID
     */
    newRequestId() {
        return `req_${++this.requestIdCounter}_${Date.now()}`;
    }
}
//# sourceMappingURL=debug-channel.js.map