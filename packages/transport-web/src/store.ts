import { create } from "zustand"

export type Page = "chat" | "debug"

interface PageStore {
  current: Page
  navigate: (page: Page) => void
}

export const usePageStore = create<PageStore>((set) => ({
  current: "chat",
  navigate: (page) => set({ current: page }),
}))
