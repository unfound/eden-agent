import { AssistantRuntimeProvider, ThreadListPrimitive, ThreadListItemPrimitive, AuiIf } from "@assistant-ui/react"
import { useChatRuntime, AssistantChatTransport } from "@assistant-ui/react-ai-sdk"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"
import { Thread } from "@/components/assistant-ui/thread"
import Sidebar from "@/components/Sidebar"
import DebugPage from "@/components/DebugPage"
import { usePageStore } from "@/store"
import { useAuiState } from "@assistant-ui/react"
import { PlusIcon, MessageSquareIcon, TrashIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/** 会话标题：单行省略 + hover 显示完整文本 */
const ThreadTitleTooltip = () => {
  const title = useAuiState((s) => s.threadListItem.title) ?? "新会话";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="truncate text-sm">{title}</span>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {title}
      </TooltipContent>
    </Tooltip>
  );
};

export default function App() {
  const { current, navigate } = usePageStore()

  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({ api: "/api/chat" }),
  })

  return (
    <TooltipProvider>
      <div className="flex h-dvh overflow-hidden">
        <Sidebar current={current} onNavigate={navigate} />

        <div className="flex flex-1 flex-col overflow-hidden">
          {/* 聊天区 — 始终挂载 */}
          <div className={current === "chat" ? "flex flex-1 overflow-hidden" : "hidden"}>
            <AssistantRuntimeProvider runtime={runtime}>
              <div className="flex flex-1 overflow-hidden">
                {/* 会话列表侧栏 */}
                <div className="w-56 shrink-0 border-r bg-muted/20">
                  <ThreadListPrimitive.Root className="flex h-full flex-col">
                    <ThreadListPrimitive.New asChild>
                      <button className="m-2 flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">
                        <PlusIcon className="size-4" />
                        新建会话
                      </button>
                    </ThreadListPrimitive.New>

                    <div className="flex-1 overflow-y-auto px-2">
                      <ThreadListPrimitive.Items>
                        {({ threadListItem }) => (
                          <ThreadListItemPrimitive.Root
                            key={threadListItem.id}
                            className={cn(
                              "group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors cursor-pointer",
                              "hover:bg-accent hover:text-accent-foreground",
                              "data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
                            )}
                          >
                            <ThreadListItemPrimitive.Trigger className="flex flex-1 items-center gap-2 overflow-hidden">
                              <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" />
                              <ThreadTitleTooltip />
                            </ThreadListItemPrimitive.Trigger>
                            <ThreadListItemPrimitive.Delete asChild>
                              <button
                                className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <TrashIcon className="size-3.5" />
                              </button>
                            </ThreadListItemPrimitive.Delete>
                          </ThreadListItemPrimitive.Root>
                        )}
                      </ThreadListPrimitive.Items>
                    </div>
                  </ThreadListPrimitive.Root>
                </div>

                {/* 聊天主区 */}
                <div className="flex flex-1 flex-col overflow-hidden">
                  <Thread />
                </div>
              </div>
            </AssistantRuntimeProvider>
          </div>

          {/* 调试页 */}
          {current === "debug" && <DebugPage />}
        </div>
      </div>
    </TooltipProvider>
  )
}
