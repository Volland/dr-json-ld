#!/usr/bin/env node
/**
 * The `ldm` entry point. Thin on purpose: everything testable lives in
 * `index.ts`, which takes an injected {@link Io} so the CLI tests need no
 * subprocess.
 */
import { nodeIo, run } from './index.js'

run(process.argv.slice(2), nodeIo)
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    process.stderr.write(`ldm: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
