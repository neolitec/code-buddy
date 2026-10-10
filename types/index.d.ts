// The values Code Buddy's hooks module keeps in $.state for the session.

/** The comment an agent claimed, and the project it belongs to. */
export type Binding = {
  root: string
  comment: string
  /** The run claim.mjs started (`r1`, `r2`…), which tags the agent's steps. */
  run?: string
  /** The folder of the claim.mjs the agent ran, when its command named it. */
  scripts?: string
}

/**
 * What the hooks read of the comments file: a narrowed view of lib/format.mjs's
 * CommentsFile, the format's reference, for which comments an agent may work on.
 */
export type CommentsFile = {
  version: number
  comments: { id: string; state: string }[]
}

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
