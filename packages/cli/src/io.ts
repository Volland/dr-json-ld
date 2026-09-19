/**
 * The seam the CLI is written against, so every verb is testable without a
 * subprocess and without touching the real filesystem root.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const EXIT_OK = 0
export const EXIT_FINDINGS = 1
export const EXIT_USAGE = 2

export interface Io {
  out(line: string): void
  err(line: string): void
  readFile(path: string): string
  writeFile(path: string, content: string): void
  exists(path: string): boolean
  cwd(): string
}

export const nodeIo: Io = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  readFile: (path) => readFileSync(path, 'utf8'),
  writeFile: (path, content) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  },
  exists: (path) => existsSync(path),
  cwd: () => process.cwd(),
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}
