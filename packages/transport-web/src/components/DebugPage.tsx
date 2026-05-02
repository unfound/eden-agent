import { useEffect, useRef, useState } from "react"

// ── Types ────────────────────────────────────────────

interface DebugState {
  currentRequestId: string | null
  systemPrompt: string
  injectedContext: Array<{ source: string; content: string; tokens: number }>
  tokenUsage: { in: number; out: number; total: number; cost?: number }
  messages: Array<{ role: string; content: string }>
  rawRequest: Array<{ role: string; content: string }>
  rawResponse: { content: string; finishReason?: string; model?: string; id?: string } | null
  toolCalls: Array<{
    name: string
    args: string
    result?: string
    latencyMs?: number
  }>
  lastError?: string
}

// ── Component ────────────────────────────────────────

export default function DebugPage() {
  const [connected, setConnected] = useState(false)
  const [state, setState] = useState<DebugState | null>(null)
  const [events, setEvents] = useState<string[]>([])
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
    const host = "localhost:18888"
    const url = `${proto}//${host}`

    function connect() {
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        setConnected(true)
        addEvent("connected")
      }

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data)
          if (data.type === "snapshot") {
            setState(data.state)
            addEvent("snapshot received")
          } else if (data.type === "event") {
            // 实时更新状态
            addEvent(data.event.type)
          }
        } catch {}
      }

      ws.onclose = () => {
        setConnected(false)
        addEvent("disconnected")
        wsRef.current = null
        // 3s 后重连
        setTimeout(connect, 3000)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()
    return () => {
      wsRef.current?.close()
    }
  }, [])

  function addEvent(msg: string) {
    setEvents((prev) => [...prev.slice(-99), `${new Date().toLocaleTimeString()} ${msg}`])
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <h2 className="font-semibold text-lg">调试面板</h2>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
            connected
              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
          }`}
        >
          <span className={`size-1.5 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
          WS {connected ? "已连接" : "断开"}
        </span>
        <span className="text-muted-foreground text-xs">
          :18888
        </span>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* 主面板 */}
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
          {!state ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
              {connected ? "等待请求..." : "等待连接..."}
            </div>
          ) : (
            <>
              {/* Meta 行 */}
              <Section title="请求信息">
                <Row label="Request ID" value={state.currentRequestId ?? "—"} mono />
                <Row label="Model" value={state.rawResponse?.model ?? "—"} />
                <Row label="Finish Reason" value={state.rawResponse?.finishReason ?? "—"} />
              </Section>

              {/* Token 用量 */}
              <Section title="Token 用量">
                <div className="grid grid-cols-4 gap-2">
                  <MetricCard label="输入" value={state.tokenUsage.in} color="text-yellow-600 dark:text-yellow-400" />
                  <MetricCard label="输出" value={state.tokenUsage.out} color="text-blue-600 dark:text-blue-400" />
                  <MetricCard label="总计" value={state.tokenUsage.total} color="text-foreground" />
                  {state.tokenUsage.cost != null && (
                    <MetricCard label="费用" value={`$${state.tokenUsage.cost.toFixed(6)}`} color="text-green-600 dark:text-green-400" />
                  )}
                </div>
              </Section>

              {/* System Prompt */}
              <Section title={`System Prompt (${state.systemPrompt.length}c)`}>
                {state.systemPrompt ? (
                  <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-xs">
                    {state.systemPrompt}
                  </pre>
                ) : (
                  <span className="text-muted-foreground text-xs">无</span>
                )}
              </Section>

              {/* 注入上下文 */}
              <Section title={`注入上下文 (${state.injectedContext.length})`}>
                {state.injectedContext.length === 0 ? (
                  <span className="text-muted-foreground text-xs">无</span>
                ) : (
                  <div className="space-y-1.5">
                    {state.injectedContext.map((inj, i) => (
                      <div key={i} className="rounded-md border p-2 text-xs">
                        <span className="font-medium text-cyan-600 dark:text-cyan-400">[{inj.source}]</span>
                        <span className="ml-2 text-muted-foreground">{inj.tokens}t</span>
                        <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-muted-foreground">
                          {inj.content.slice(0, 120)}{inj.content.length > 120 ? "…" : ""}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* Tool Calls */}
              <Section title={`工具调用 (${state.toolCalls.length})`}>
                {state.toolCalls.length === 0 ? (
                  <span className="text-muted-foreground text-xs">无</span>
                ) : (
                  <div className="space-y-1.5">
                    {state.toolCalls.map((tc, i) => (
                      <div key={i} className="rounded-md border p-2">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-medium text-yellow-600 dark:text-yellow-400">▶ {tc.name}</span>
                          {tc.latencyMs != null && (
                            <span className="text-muted-foreground text-xs">{tc.latencyMs}ms</span>
                          )}
                        </div>
                        <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-muted-foreground text-xs">
                          {tc.args.slice(0, 200)}
                        </pre>
                        {tc.result && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-muted-foreground text-xs hover:text-foreground">结果</summary>
                            <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-xs">{tc.result}</pre>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* Error */}
              {state.lastError && (
                <Section title="错误" className="border-red-300 dark:border-red-800">
                  <pre className="whitespace-pre-wrap break-all rounded-md bg-red-50 p-3 font-mono text-red-700 text-xs dark:bg-red-950/50 dark:text-red-300">
                    {state.lastError}
                  </pre>
                </Section>
              )}
            </>
          )}
        </div>

        {/* 事件日志侧栏 */}
        <div className="hidden w-64 flex-shrink-0 border-l bg-muted/20 p-3 md:block">
          <h3 className="mb-2 font-medium text-xs text-muted-foreground">事件日志</h3>
          <div className="space-y-0.5 overflow-y-auto" style={{ maxHeight: "calc(100vh - 8rem)" }}>
            {[...events].reverse().map((e, i) => (
              <div key={i} className="font-mono text-[10px] text-muted-foreground leading-4">
                {e}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────

function Section({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border p-3 ${className}`}>
      <h3 className="mb-2 font-medium text-sm text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="flex-shrink-0 text-muted-foreground text-xs">{label}</span>
      <span className={`truncate ${mono ? "font-mono text-xs" : "text-sm"}`}>{value}</span>
    </div>
  )
}

function MetricCard({
  label,
  value,
  color,
}: {
  label: string
  value: string | number
  color: string
}) {
  return (
    <div className="rounded-md border p-2 text-center">
      <div className={`text-lg font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="text-muted-foreground text-xs">{label}</div>
    </div>
  )
}
