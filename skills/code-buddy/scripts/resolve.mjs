#!/usr/bin/env node
// resolve.mjs <id> --project <dir> "<answer>"   (or the answer on stdin)
// Marks one comment resolved and adds the answer, with the run's steps, to its thread.
import { reply } from './lib/reply.mjs'

await reply('resolve.mjs', { question: false })
