import { AssistantRuntimeProvider } from "@assistant-ui/react"
import { useChatRuntime, AssistantChatTransport } from "@assistant-ui/react-ai-sdk"
import { TooltipProvider } from "src/components/ui/tooltip"
import { Thread } from "src/components/assistant-ui/thread"
import Sidebar from "src/components/Sidebar"
import DebugPage from "src/components/DebugPage"
import { usePageStore } from "src/store"

export default function App() {
  const { current, navigate } = usePageStore()

  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({
      api: "/api/chat",
    }),
  })

  return (
    <TooltipProvider>
      <div className="flex h-dvh overflow-hidden">
        {/* 侧边导航 */}
        <Sidebar current={current} onNavigate={navigate} />

        {/* 内容区 — AssistantRuntimeProvider 始终挂载，用 hidden 切换显示 */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <AssistantRuntimeProvider runtime={runtime}>
            <div className={current === "chat" ? "flex flex-1 flex-col overflow-hidden" : "hidden"}>
              <Thread />
            </div>
          </AssistantRuntimeProvider>
          {current === "debug" && <DebugPage />}
        </div>
      </div>
    </TooltipProvider>
  )
}
