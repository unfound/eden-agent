/**
 * ThreadListSidebar — 会话列表侧边栏
 *
 * 通过 HTTP API 管理会话，不再依赖 assistant-ui 的 InMemoryThreadList。
 */

import { useState, useEffect, useCallback } from "react"
import { PlusIcon, TrashIcon, MessageSquareIcon } from "lucide-react"
import { cn } from "src/lib/utils"
import { fetchThreads, createThread, deleteThread, type ThreadSummary } from "src/lib/api"

interface Props {
  activeThreadId: string | null
  onSelectThread: (id: string) => void
  onCreateThread: (id: string) => void
  onDeleteThread: () => void
}

export default function ThreadListSidebar({ activeThreadId, onSelectThread, onCreateThread, onDeleteThread }: Props) {
  const [threads, setThreads] = useState<ThreadSummary[]>([])

  const loadThreads = useCallback(async () => {
    try {
      const list = await fetchThreads()
      // 按最后活跃时间倒序
      list.sort((a, b) => b.lastActive - a.lastActive)
      setThreads(list)
    } catch {
      // 静默失败
    }
  }, [])

  useEffect(() => { loadThreads() }, [loadThreads])

  // 暴露刷新方法给父组件
  useEffect(() => {
    ;(window as any).__refreshThreadList = loadThreads
    return () => { delete (window as any).__refreshThreadList }
  }, [loadThreads])

  const handleNew = async () => {
    try {
      const t = await createThread()
      await loadThreads()
      onCreateThread(t.id)
    } catch {}
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm("确定删除这个会话？")) return
    try {
      await deleteThread(id)
      await loadThreads()
      onDeleteThread()
    } catch {}
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* 新建按钮 */}
      <button
        onClick={handleNew}
        className="m-2 flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <PlusIcon className="size-4" />
        新建会话
      </button>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto px-2">
        {threads.length === 0 && (
          <div className="px-3 py-2 text-xs text-muted-foreground">暂无会话</div>
        )}
        {threads.map((t) => (
          <button
            key={t.id}
            onClick={() => onSelectThread(t.id)}
            className={cn(
              "group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
              "hover:bg-accent hover:text-accent-foreground",
              activeThreadId === t.id
                ? "bg-accent text-accent-foreground"
                : "text-foreground"
            )}
          >
            <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate">{t.title}</span>
            {t.requestCount > 0 && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {t.requestCount}
              </span>
            )}
            <span
              onClick={(e) => handleDelete(t.id, e)}
              className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            >
              <TrashIcon className="size-3.5" />
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
