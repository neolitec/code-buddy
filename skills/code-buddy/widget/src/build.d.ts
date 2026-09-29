// Provided by build.mjs.

declare module '*.webp' {
  /** A data URL: the build inlines images. */
  const src: string
  export default src
}

/** The plugin's version, read from .claude-plugin/plugin.json at build time. */
declare const CODE_BUDDY_VERSION: string
