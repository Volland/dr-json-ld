/**
 * Host adapters: what a host requires of a static tree, declared rather than
 * performed.
 *
 * The tool does not upload. Uploading means credentials, retries and a
 * permissions model, and every host already has a mature tool for it. What this
 * owes is a tree those tools can copy verbatim, and a refusal when a name would
 * produce a path the target host silently mangles.
 *
 * @lat: [[emitters#Emitters#Capability Matrix]]
 */
import type { HostName } from '../project/project.js'

/** How a host makes an alias path serve the same bytes as a version path. */
export type AliasStrategy =
  /** Write the artifact again under the alias path. Works everywhere. */
  | 'copy'
  /** Write a JSON pointer file naming the version. Requires a client that follows it. */
  | 'pointer'

export interface PathViolation {
  host: HostName
  path: string
  constraint: string
  message: string
}

export interface HostAdapter {
  name: HostName
  /** One line for the publish report. */
  description: string
  aliasStrategy: AliasStrategy
  /** Side files this host needs, keyed by path relative to the tree root. */
  sideFiles(): Record<string, string>
  /** Why this path cannot be served, or `undefined` when it can. */
  checkPath(path: string): PathViolation | undefined
}

/** Characters no host in this set can serve, so every adapter rejects them. */
const UNIVERSALLY_UNSAFE = /[\s"'<>?#%\\]/

function universalViolation(host: HostName, path: string): PathViolation | undefined {
  const match = UNIVERSALLY_UNSAFE.exec(path)
  if (match) {
    return {
      host,
      path,
      constraint: 'path characters',
      message: `the path "${path}" contains ${JSON.stringify(
        match[0],
      )}, which is not safe in a URL path segment`,
    }
  }
  if (path.split('/').some((segment) => segment === '..' || segment === '.')) {
    return {
      host,
      path,
      constraint: 'path traversal',
      message: `the path "${path}" contains a traversal segment`,
    }
  }
  return undefined
}

/**
 * The plain file host: anything that serves bytes at a path. The lowest common
 * denominator, and the default.
 */
const plain: HostAdapter = {
  name: 'plain',
  description: 'Any static file server. No side files, no path restrictions beyond URL safety.',
  aliasStrategy: 'copy',
  sideFiles: () => ({}),
  checkPath: (path) => universalViolation('plain', path),
}

/**
 * GitHub Pages runs Jekyll unless told not to, and Jekyll silently drops any
 * path segment beginning with an underscore or a dot. `.nojekyll` turns that
 * off, which is why it is a required side file rather than a suggestion.
 */
const githubPages: HostAdapter = {
  name: 'github-pages',
  description:
    'GitHub Pages. Requires .nojekyll, because Jekyll silently drops paths beginning with _ or . .',
  aliasStrategy: 'copy',
  sideFiles: () => ({
    // Empty by convention; its presence is the whole signal.
    '.nojekyll': '',
  }),
  checkPath: (path) => {
    const universal = universalViolation('github-pages', path)
    if (universal) return { ...universal, host: 'github-pages' }
    const segment = path.split('/').find((s) => s.startsWith('_'))
    if (segment !== undefined) {
      return {
        host: 'github-pages',
        path,
        constraint: 'leading underscore',
        message: `the path "${path}" has a segment beginning with an underscore ("${segment}"). Jekyll drops those, and .nojekyll only helps when it is present at the tree root — rename the segment rather than relying on it.`,
      }
    }
    return undefined
  },
}

/**
 * S3 serves a key, not a path. A key ending in `/` is a different object from
 * one that does not, and most static-site configurations cannot serve a key with
 * no extension without an index document — so the tree never produces one.
 */
const s3: HostAdapter = {
  name: 's3',
  description:
    'An S3 bucket. Every object key must carry an extension, because a bucket cannot infer an index document for an arbitrary prefix.',
  aliasStrategy: 'copy',
  sideFiles: () => ({}),
  checkPath: (path) => {
    const universal = universalViolation('s3', path)
    if (universal) return { ...universal, host: 's3' }
    const last = path.split('/').pop() ?? ''
    if (!last.includes('.')) {
      return {
        host: 's3',
        path,
        constraint: 'missing extension',
        message: `the key "${path}" has no extension. A bucket cannot infer an index document for it, so it would return 404 rather than the artifact.`,
      }
    }
    if (path.startsWith('/')) {
      return {
        host: 's3',
        path,
        constraint: 'leading slash',
        message: `the key "${path}" begins with a slash, which makes an object whose name starts with an empty segment`,
      }
    }
    return undefined
  },
}

const ADAPTERS: Record<HostName, HostAdapter> = {
  plain,
  'github-pages': githubPages,
  s3,
}

export function adapterFor(host: HostName): HostAdapter {
  return ADAPTERS[host]
}

export function adaptersFor(hosts: readonly HostName[]): HostAdapter[] {
  return hosts.map(adapterFor)
}

/**
 * Every side file the named hosts need, with the host that asked for each — so
 * the publish report can say why a file is there.
 */
export function sideFilesFor(
  hosts: readonly HostName[],
): Array<{ path: string; content: string; hosts: HostName[] }> {
  const byPath = new Map<string, { content: string; hosts: HostName[] }>()
  for (const adapter of adaptersFor(hosts)) {
    for (const [path, content] of Object.entries(adapter.sideFiles())) {
      const existing = byPath.get(path)
      if (existing) existing.hosts.push(adapter.name)
      else byPath.set(path, { content, hosts: [adapter.name] })
    }
  }
  return [...byPath.entries()]
    .map(([path, value]) => ({ path, ...value }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

/** Every violation, across every named host. A tree must satisfy all of them. */
export function checkPaths(
  hosts: readonly HostName[],
  paths: readonly string[],
): PathViolation[] {
  const violations: PathViolation[] = []
  for (const adapter of adaptersFor(hosts)) {
    for (const path of paths) {
      const violation = adapter.checkPath(path)
      if (violation) violations.push(violation)
    }
  }
  return violations.sort(
    (a, b) => a.host.localeCompare(b.host) || a.path.localeCompare(b.path),
  )
}

export type { HostName }
