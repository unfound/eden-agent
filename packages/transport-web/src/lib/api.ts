/**
 * API 客户端
 */

const BASE = '/api'

export interface LogSummary {
  id: string
  timestamp: number
  userMessage: string
  model?: string
  tokenIn: number
  tokenOut: number
  toolCallCount: number
}

export interface LogDetail {
  id: string
  timestamp: number
  userMessage: string
  systemPrompt: string
  injectedContext: Array<{ source: string; content: string; tokens: number }>
  rawRequest: Array<Record<string, unknown>>
  rawResponse: { content: string; finishReason?: string; model?: string } | null
  tokenUsage: { in: number; out: number; total: number; cost?: number }
  toolCalls: Array<{ name: string; args: string; result?: string; latencyMs?: number }>
}

export async function fetchLogs(): Promise<LogSummary[]> {
  const res = await fetch(`${BASE}/debug/logs`)
  return res.json()
}

export async function fetchLogDetail(logId: string): Promise<LogDetail> {
  const res = await fetch(`${BASE}/debug/logs/${logId}`)
  return res.json()
}
