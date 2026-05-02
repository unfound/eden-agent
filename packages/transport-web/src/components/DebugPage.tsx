/**
 * DebugPage — 调试面板
 *
 * 左栏：会话记录（从日志读取）
 * 右栏：调试详情
 *
 * 功能：查看日志、删除日志、复制日志目录
 */

import { useEffect, useState } from "react"
import { fetchLogs, fetchLogDetail, fetchDebugConfig, deleteLog, type LogSummary, type LogDetail, type DebugConfig } from "@/lib/api"
import { TrashIcon, CopyIcon, CheckIcon, FolderOpenIcon } from "lucide-react"

export default function DebugPage() {
  const [logs, setLogs] = useState<LogSummary[]>([])
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null)
  const [detail, setDetail] = useState<LogDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [config, setConfig] = useState<DebugConfig | null>(null)
  const [copied, setCopied] = useState(false)

  // 加载配置 + 日志列表
  useEffect(() => {
    fetchDebugConfig().then(setConfig)
    fetchLogs().then(list => {
      setLogs(list)
      if (list.length > 0 && !selectedLogId) {
        setSelectedLogId(list[0].id)
      }
    })
  }, [])

  // 定时刷新日志列表
  useEffect(() => {
    const timer = setInterval(() => {
      fetchLogs().then(setLogs)
    }, 5000)
    return () => clearInterval(timer)
  }, [])

  // 选中日志 → 加载详情
  useEffect(() => {
    if (!selectedLogId) { setDetail(null); return }
    setLoading(true)
    fetchLogDetail(selectedLogId)
      .then(setDetail)
      .finally(() => setLoading(false))
  }, [selectedLogId])

  const selectedLog = logs.find(l => l.id === selectedLogId)

  // 复制日志目录
  const copyLogDir = () => {
    if (!config?.logDir) return
    navigator.clipboard.writeText(config.logDir)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // 删除日志
  const handleDelete = async (logId: string) => {
    await deleteLog(logId)
    setLogs(prev => prev.filter(l => l.id !== logId))
    if (selectedLogId === logId) {
      setSelectedLogId(null)
      setDetail(null)
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <h2 className="font-semibold text-lg">调试面板</h2>

        <select
          value={selectedLogId ?? ""}
          onChange={(e) => setSelectedLogId(e.target.value || null)}
          className="rounded-md border bg-background px-2 py-1 text-sm"
        >
          <option value="">选择日志...</option>
          {logs.map(l => (
            <option key={l.id} value={l.id}>
              {new Date(l.timestamp).toLocaleString()} — {l.userMessage.slice(0, 40)}
            </option>
          ))}
        </select>

        {selectedLog && (
          <span className="text-muted-foreground text-xs">
            {selectedLog.toolCallCount > 0 && `${selectedLog.toolCallCount} 工具`}
            {selectedLog.model && ` · ${selectedLog.model}`}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* 日志目录 */}
          {config && (
            <button
              onClick={copyLogDir}
              className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              title="点击复制日志目录路径"
            >
              <FolderOpenIcon className="size-3.5" />
              <span className="max-w-[200px] truncate font-mono">{config.logDir}</span>
              {copied ? <CheckIcon className="size-3.5 text-green-500" /> : <CopyIcon className="size-3.5" />}
            </button>
          )}

          {/* 删除当前日志 */}
          {selectedLogId && (
            <button
              onClick={() => handleDelete(selectedLogId)}
              className="flex items-center gap-1 rounded-md border border-destructive/30 px-2 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10"
            >
              <TrashIcon className="size-3.5" />
              删除
            </button>
          )}
        </div>
      </div>

      {/* ── Body: 左右布局 ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左栏：会话记录 */}
        <div className="flex flex-1 flex-col overflow-hidden border-r">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <h3 className="font-medium text-sm">会话记录</h3>
            {detail && (
              <span className="text-muted-foreground text-xs">
                {detail.rawRequest.length} 条消息
              </span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {!selectedLogId ? (
              <EmptyHint text="选择一条日志查看记录" />
            ) : loading ? (
              <EmptyHint text="加载中..." />
            ) : !detail ? (
              <EmptyHint text="暂无数据" />
            ) : (
              <div className="space-y-3">
                {detail.rawRequest.map((msg, i) => (
                  <MessageBlock key={`req-${i}`} msg={msg} />
                ))}
                {detail.rawResponse?.content && (
                  <MessageBlock key="res" msg={{ role: "assistant", content: detail.rawResponse.content }} />
                )}
              </div>
            )}
          </div>
        </div>

        {/* 右栏：调试详情 */}
        <div className="flex w-[420px] flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-3">
            {!detail ? (
              <EmptyHint text="选择一条日志查看详情" />
            ) : (
              <div className="space-y-3">
                <Section title="请求信息">
                  <Row label="Log ID" value={detail.id} mono />
                  <Row label="时间" value={new Date(detail.timestamp).toLocaleString()} />
                  <Row label="Model" value={detail.rawResponse?.model ?? "—"} />
                  <Row label="Finish" value={detail.rawResponse?.finishReason ?? "—"} />
                  <Row label="User Message" value={detail.userMessage} />
                </Section>

                <Section title="Token 用量">
                  <div className="grid grid-cols-3 gap-2">
                    <MetricCard label="输入" value={detail.tokenUsage.in} color="text-yellow-600 dark:text-yellow-400" />
                    <MetricCard label="输出" value={detail.tokenUsage.out} color="text-blue-600 dark:text-blue-400" />
                    <MetricCard label="总计" value={detail.tokenUsage.total} color="text-foreground" />
                  </div>
                </Section>

                <CollapsibleSection title={`System Prompt (${detail.systemPrompt.length}c)`} defaultOpen={false}>
                  {detail.systemPrompt ? (
                    <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-xs">
                      {detail.systemPrompt}
                    </pre>
                  ) : (
                    <span className="text-muted-foreground text-xs">无</span>
                  )}
                </CollapsibleSection>

                <CollapsibleSection title={`注入上下文 (${detail.injectedContext.length})`} defaultOpen={false}>
                  {detail.injectedContext.length === 0 ? (
                    <span className="text-muted-foreground text-xs">无</span>
                  ) : (
                    <div className="space-y-1.5">
                      {detail.injectedContext.map((inj, i) => (
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
                </CollapsibleSection>

                <CollapsibleSection title={`工具调用 (${detail.toolCalls.length})`} defaultOpen={true}>
                  {detail.toolCalls.length === 0 ? (
                    <span className="text-muted-foreground text-xs">无</span>
                  ) : (
                    <div className="space-y-1.5">
                      {detail.toolCalls.map((tc, i) => (
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
                </CollapsibleSection>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 消息块 ────────────────────────────────────────────

const ROLE_STYLES: Record<string, { badge: string; border: string }> = {
  system: { badge: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400", border: "border-l-purple-400" },
  user: { badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", border: "border-l-blue-400" },
  assistant: { badge: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", border: "border-l-green-400" },
  tool: { badge: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400", border: "border-l-orange-400" },
}

function MessageBlock({ msg }: { msg: Record<string, unknown> }) {
  const role = (msg.role as string) ?? "unknown"
  const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "")
  const toolCalls = msg.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }> | undefined
  const style = ROLE_STYLES[role] ?? ROLE_STYLES.user
  const [expanded, setExpanded] = useState(role === "system" ? false : true)

  const display = content.length > 300 && !expanded
    ? content.slice(0, 300) + "…"
    : content

  return (
    <div className={`rounded-md border-l-4 bg-muted/30 p-3 ${style.border}`}>
      <div className="mb-1.5 flex items-center justify-between">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${style.badge}`}>{role}</span>
        {content.length > 300 && (
          <button onClick={() => setExpanded(!expanded)} className="text-muted-foreground text-[10px] hover:text-foreground">
            {expanded ? "收起" : "展开"}
          </button>
        )}
      </div>
      <pre className="whitespace-pre-wrap break-all font-mono text-xs text-foreground/80 leading-relaxed">{display}</pre>
      {toolCalls && toolCalls.length > 0 && (
        <div className="mt-2 space-y-1 border-t pt-2">
          {toolCalls.map((tc) => (
            <div key={tc.id} className="text-xs">
              <span className="font-medium text-yellow-600 dark:text-yellow-400">▶ {tc.function.name}</span>
              <pre className="mt-0.5 whitespace-pre-wrap break-all font-mono text-muted-foreground text-[11px]">
                {tc.function.arguments.slice(0, 200)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────

function EmptyHint({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center text-muted-foreground text-sm">{text}</div>
}

function Section({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border p-3 ${className}`}>
      <h3 className="mb-2 font-medium text-sm text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

function CollapsibleSection({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="rounded-lg border">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-3 py-2 text-left">
        <h3 className="font-medium text-sm text-muted-foreground">{title}</h3>
        <span className="text-muted-foreground text-xs">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="border-t px-3 pb-3 pt-2">{children}</div>}
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

function MetricCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="rounded-md border p-2 text-center">
      <div className={`text-lg font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="text-muted-foreground text-xs">{label}</div>
    </div>
  )
}
