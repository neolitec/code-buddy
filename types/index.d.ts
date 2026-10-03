// The values Code Buddy's hooks module keeps in $.state for the session.

/** The comment an agent claimed, and the project it belongs to. */
export type Binding = { root: string; comment: string }

/** A file lock: the comment whose agent holds it, and since when. */
export type Lock = { owner: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    'code-buddy': {
      /** By agent id (`main` for the main loop). */
      bindings: Record<string, Binding>
      /** By `<project root>\n<path relative to it, or @build>`. */
      locks: Record<string, Lock>
    }
  }
}
