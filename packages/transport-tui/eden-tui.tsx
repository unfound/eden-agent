#!/usr/bin/env bun
/**
 * eden-tui — OpenTUI 聊天客户端
 *
 * 连接 Agent Core 的 WS 服务器，提供流式聊天界面。
 *
 * bun run eden-tui.tsx --port 12345
 */

import { createCliRenderer } from "@opentui/core"
import { createRoot, useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useState, useRef, useEffect } from "react"

// ==================== 类型 ====================

interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

interface TokenUsage {
  in: number
  out: number
  total: number
  cost?: number
}

// ==================== WS 连接 ====================

function getPort(): number {
  const idx = process.argv.indexOf("--port")
  if (idx >= 0 && idx + 1 < process.argv.length) {
    return parseInt(process.argv[idx + 1], 10)
  }
  return 18792 // fallback
}

// ==================== 工具 ====================

function trunc(s: string, max: number): string {
  const single = s.replace(/\n/g, " ")
  if (single.length <= max) return single
  return single.slice(0, max) + "\u2026"
}

// ==================== 主 App ====================

function App() {
  const port = getPort()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState("")
  const [thinking, setThinking] = useState(false)
  const [connected, setConnected] = useState(false)
  const [cumulative, setCumulative] = useState<TokenUsage>({ in: 0, out: 0, total: 0 })
  const wsRef = useRef<WebSocket | null>(null)
  const inputRef = useRef("")
  const { width: termWidth } = useTerminalDimensions()

  // 建立 WS 连接
  useEffect(() => {
    const ws = new WebSocket(`ws://localhost:${port}`)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      // 请求历史
      ws.send(JSON.stringify({ type: "get_history" }))
    }

    ws.onmessage = (event: MessageEvent) => {
      let msg: any
      try { msg = JSON.parse(event.data as string) } catch { return }

      switch (msg.type) {
        case "connected":
          setConnected(true)
          break

        case "history":
          if (Array.isArray(msg.messages)) {
            setMessages(msg.messages)
          }
          break

        case "token":
          setStreaming(msg.text)
          break

        case "done":
          setStreaming("")
          setThinking(false)
          // 刷新历史
          ws.send(JSON.stringify({ type: "get_history" }))
          // 更新用量
          if (msg.usage) {
            setCumulative((prev) => ({
              in: prev.in + (msg.usage.in ?? 0),
              out: prev.out + (msg.usage.out ?? 0),
              total: prev.total + (msg.usage.total ?? 0),
              cost: (prev.cost ?? 0) + (msg.usage.cost ?? 0),
            }))
          }
          break

        case "thinking":
          setThinking(msg.value)
          break

        case "error":
          setStreaming("")
          setThinking(false)
          setMessages((prev) => [...prev, { role: "assistant", content: `[错误] ${msg.message}` }])
          break
      }
    }

    ws.onclose = () => setConnected(false)
    ws.onerror = () => setConnected(false)

    return () => { ws.close() }
  }, [port])

  // 键盘输入
  useKeyboard((event) => {
    const k = event.key

    if (k.ctrl && k.name === "c") { process.exit(0) }

    if (k.name === "return" || k.name === "enter") {
      const text = inputRef.current.trim()
      if (!text || !wsRef.current) return
      if (text === "/exit" || text === "/quit") { process.exit(0) }

      setMessages((prev) => [...prev, { role: "user", content: text }])
      setInput("")
      inputRef.current = ""
      setThinking(true)
      setStreaming("")

      wsRef.current.send(JSON.stringify({ type: "chat", text }))
      return
    }

    if (k.name === "backspace") {
      inputRef.current = inputRef.current.slice(0, -1)
      setInput(inputRef.current)
      return
    }

    if (event.type === "char" && k.name && k.name.length === 1) {
      inputRef.current += k.name
      setInput(inputRef.current)
    }
  })

  const total = cumulative.in + cumulative.out
  const pct = Math.min(100, Math.round((total / 16384) * 100))

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor="#1a1b26">
      {/* 头部 */}
      <box height={1} paddingLeft={1} paddingRight={1} backgroundColor="#24283b">
        <text>
          <span fg="#7dcfff" bold>eden</span>
          <span fg="#565f89"> TUI</span>
          <span fg="#565f89">{" \u00B7 ws "}</span>
          <span fg={connected ? "#73daca" : "#f7768e"}>{connected ? "\u2713" : "\u2717"}</span>
          <span fg="#565f89">:{port}</span>
        </text>
      </box>

      {/* 副标题 */}
      <box height={1} paddingLeft={1}>
        <text dim>/exit 退出</text>
      </box>

      {/* 聊天区 */}
      <box flexGrow={1} paddingLeft={1} paddingRight={1}>
        <scrollbox flexGrow={1} stickyScroll stickyStart="bottom" viewportCulling>
          {messages.map((msg, i) => (
            <box key={i} flexDirection="column" marginTop={i > 0 ? 1 : 0}>
              <text>
                <span
                  fg={msg.role === "user" ? "#9ece6a" : "#7aa2f7"}
                  bold
                >{msg.role === "user" ? "\uD83E\uDDD1 你" : "\uD83E\uDD16 Eden"}</span>
              </text>
              <text>{msg.content}</text>
            </box>
          ))}

          {/* 流式输出 */}
          {streaming && (
            <box marginTop={1} flexDirection="column">
              <text>
                <span fg="#7aa2f7" bold>{"\uD83E\uDD16 Eden"}</span>
              </text>
              <text>{streaming}</text>
            </box>
          )}

          {thinking && !streaming && (
            <box marginTop={1} paddingLeft={2}>
              <text dim italic>{"\u258A"} 思考中...</text>
            </box>
          )}

          {!connected && messages.length === 0 && (
            <box marginTop={1}>
              <text dim>连接中...</text>
            </box>
          )}
        </scrollbox>
      </box>

      {/* 分隔线 */}
      <text fg="#3b4261">{"\u2500".repeat(termWidth ?? 80)}</text>

      {/* 输入栏 */}
      <box height={1} paddingLeft={1} paddingRight={1} backgroundColor="#1f2335">
        <text>
          <span fg="#9ece6a">{"\uD83E\uDDD1"}</span>
          <span> {input || ""}</span>
          <span fg="#7dcfff">{"\u258A"}</span>
        </text>
      </box>

      {/* 状态栏 */}
      <box height={1} paddingLeft={1} paddingRight={1} backgroundColor="#24283b">
        <text dim>
          {connected ? "已连接" : "未连接"}
          {cumulative.total > 0 && (
            <span> {"\u00B7"} in: <span fg="#e0af68">{cumulative.in}</span> {"\u00B7"} out: <span fg="#e0af68">{cumulative.out}</span></span>
          )}
        </text>
      </box>
    </box>
  )
}

// ==================== 启动 ====================

const renderer = await createCliRenderer({ exitOnCtrlC: false })
createRoot(renderer).render(<App />)
