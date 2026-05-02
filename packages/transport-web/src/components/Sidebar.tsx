import { MessageSquareIcon, BugIcon } from "lucide-react"
import type { Page } from "src/store"

interface Props {
  current: Page
  onNavigate: (page: Page) => void
}

const items: { id: Page; label: string; icon: typeof MessageSquareIcon }[] = [
  { id: "chat", label: "聊天", icon: MessageSquareIcon },
  { id: "debug", label: "调试", icon: BugIcon },
]

export default function Sidebar({ current, onNavigate }: Props) {
  return (
    <nav className="flex h-full w-14 flex-col items-center gap-1 border-r bg-muted/30 py-3">
      {items.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onNavigate(id)}
          title={label}
          className={`
            flex size-10 items-center justify-center rounded-lg transition-colors
            ${current === id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }
          `}
        >
          <Icon className="size-5" />
        </button>
      ))}
    </nav>
  )
}
