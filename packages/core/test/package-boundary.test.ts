import { describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const coreSrc = fileURLToPath(new URL('../src', import.meta.url))

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full)
  }
  return out
}

/**
 * The regex the scan uses. Exported shape kept simple on purpose: it matches a
 * static import, a re-export, a dynamic `import()` and a `require()` naming the
 * `vscode` module or any subpath of it.
 */
export const VSCODE_IMPORT =
  /(?:from\s*|import\s*\(\s*|require\s*\(\s*)(['"])vscode(?:\/[^'"]*)?\1|^\s*import\s+(['"])vscode(?:\/[^'"]*)?\2/m

export function scanForVscodeImports(files: string[]): string[] {
  return files.filter((f) => VSCODE_IMPORT.test(readFileSync(f, 'utf8')))
}

describe('package boundary', () => {
  // @lat: [[architecture#Architecture#Package Boundary]]
  it('core never imports vscode', () => {
    const files = sourceFiles(coreSrc)
    expect(files.length).toBeGreaterThan(0)
    expect(scanForVscodeImports(files)).toEqual([])
  })

  it('the scan detects a deliberately added import', () => {
    // Proving the guard fails when it should, without committing a violation:
    // the scanner is run against a file written into the OS temp directory.
    const dir = mkdtempSync(join(tmpdir(), 'ldm-boundary-'))
    const offender = join(dir, 'offender.ts')
    writeFileSync(offender, `import * as vscode from 'vscode'\nexport const x = vscode\n`)
    expect(scanForVscodeImports([offender])).toEqual([offender])

    const subpath = join(dir, 'subpath.ts')
    writeFileSync(subpath, `export { window } from 'vscode/lib/api'\n`)
    expect(scanForVscodeImports([subpath])).toEqual([subpath])

    const innocent = join(dir, 'innocent.ts')
    writeFileSync(innocent, `// mentions vscode in a comment only\nexport const y = 1\n`)
    expect(scanForVscodeImports([innocent])).toEqual([])
  })
})
