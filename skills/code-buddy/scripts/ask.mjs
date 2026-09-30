#!/usr/bin/env node
// ask.mjs <id> --project <dir> "<question>"   (or the question on stdin)
// Puts Claude's question in the thread and leaves the comment waiting on the
// reader, whose answer comes back to the manager as a FOLLOWUP.
import { reply } from './lib/reply.mjs'

await reply('ask.mjs', { question: true })
