/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENAI_API_KEY?: string
  readonly VITE_OPENAI_BASE_URL?: string
  readonly VITE_OPENAI_MODEL?: string
  readonly VITE_OPENAI_PLANNER_MODEL?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "@babel/standalone" {
  export function transform(
    source: string,
    options?: Record<string, unknown>,
  ): { code?: string | null }
}
