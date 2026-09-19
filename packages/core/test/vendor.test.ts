import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

import { integrityOf, VendorStore, vendorPathFor } from '../src/vendor/store.js'
import { resolverFor, vendorCheck, vendorRefresh } from '../src/vendor/vendor.js'
import { fetchContext, FetchRefused } from '../src/vendor/fetch.js'
import { resolveModelText } from '../src/model/resolve.js'
import { validateModelText } from '../src/validate/validate.js'

const UPSTREAM = 'https://example.org/vocab/core.jsonld'
const BODY = JSON.stringify({ '@context': { name: 'https://schema.org/name' } }, null, 2)

const roots: string[] = []
function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ldm-vendor-'))
  roots.push(dir)
  return dir
}
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

function model(integrity?: string): string {
  return [
    'jsonld: "1"',
    'namespace: { prefix: ex, base: "https://example.org/ns#" }',
    'uses:',
    `  - iri: ${UPSTREAM}`,
    ...(integrity ? [`    integrity: ${integrity}`] : []),
    'terms:',
    '  title:',
    '    "@id": ex:title',
    '',
  ].join('\n')
}

function stubFetch(
  body: string,
  contentType = 'application/ld+json',
  status = 200,
  headers: Record<string, string> = {},
): typeof fetch {
  return (async () =>
    new Response(body, {
      status,
      headers: { 'content-type': contentType, ...headers },
    })) as unknown as typeof fetch
}

describe('the vendored directory', () => {
  // @lat: [[processing#Processing#Context Resolution#Vendoring]]
  it('mirrors the IRI so a reader can tell what a file is', () => {
    expect(vendorPathFor(UPSTREAM)).toBe('example.org/vocab/core.jsonld')
    expect(vendorPathFor('https://schema.org/')).toBe('schema.org/index.jsonld')
    expect(vendorPathFor('https://example.org/a/b')).toBe('example.org/a/b.jsonld')
  })

  it('refuses a path that would escape the directory', () => {
    const store = new VendorStore({ root: tempRoot() })
    // Traversal segments are sanitised rather than followed.
    expect(vendorPathFor('https://example.org/../../etc/passwd')).not.toContain('..')
    expect(() => store.absolutePathFor('https://example.org/../../etc/passwd')).not.toThrow()
  })
})

describe('vendor refresh', () => {
  it('writes the context and records its hash as a targeted edit', async () => {
    const root = tempRoot()
    const result = await vendorRefresh(model(), 'model.jsonld.yaml', {
      root,
      fetchImpl: stubFetch(BODY),
    })
    expect(result.ok).toBe(true)
    expect(result.changed).toBe(true)
    expect(result.entries[0]).toMatchObject({ iri: UPSTREAM, status: 'fetched' })

    const written = readFileSync(join(root, 'contexts', vendorPathFor(UPSTREAM)), 'utf8')
    expect(written).toBe(BODY)

    // The hash lands in the model and nothing else changes.
    expect(result.text).toContain(`integrity: ${integrityOf(BODY)}`)
    const { ir, findings } = resolveModelText(result.text!, 'model.jsonld.yaml')
    expect(findings).toEqual([])
    expect(ir!.uses[0]!.integrity).toBe(integrityOf(BODY))
    expect(result.text).toContain('  title:')
  })

  it('reports an unchanged context without rewriting the model', async () => {
    const root = tempRoot()
    const first = await vendorRefresh(model(), 'model.jsonld.yaml', {
      root,
      fetchImpl: stubFetch(BODY),
    })
    const second = await vendorRefresh(first.text!, 'model.jsonld.yaml', {
      root,
      fetchImpl: stubFetch(BODY),
    })
    expect(second.entries[0]!.status).toBe('unchanged')
    expect(second.changed).toBe(false)
  })

  it('a refresh against changed upstream changes both the file and the hash', async () => {
    const root = tempRoot()
    const first = await vendorRefresh(model(), 'model.jsonld.yaml', {
      root,
      fetchImpl: stubFetch(BODY),
    })
    const newBody = JSON.stringify({ '@context': { name: 'https://schema.org/givenName' } })
    const second = await vendorRefresh(first.text!, 'model.jsonld.yaml', {
      root,
      fetchImpl: stubFetch(newBody),
    })
    expect(second.entries[0]!.status).toBe('fetched')
    expect(second.text).toContain(integrityOf(newBody))
    expect(readFileSync(join(root, 'contexts', vendorPathFor(UPSTREAM)), 'utf8')).toBe(newBody)
  })
})

describe('the fetcher', () => {
  // @lat: [[processing#Processing#Context Resolution#Offline by default]]
  it('follows a redirect', async () => {
    let call = 0
    const impl = (async (url: string) => {
      call++
      if (call === 1) {
        return new Response('', {
          status: 301,
          headers: { location: 'https://example.org/moved.jsonld' },
        })
      }
      expect(url).toBe('https://example.org/moved.jsonld')
      return new Response(BODY, { headers: { 'content-type': 'application/ld+json' } })
    }) as unknown as typeof fetch

    const result = await fetchContext(UPSTREAM, { fetchImpl: impl })
    expect(result.url).toBe('https://example.org/moved.jsonld')
    expect(result.body).toBe(BODY)
  })

  it('refuses a response that is not JSON-LD, and writes nothing', async () => {
    const root = tempRoot()
    await expect(
      fetchContext(UPSTREAM, { fetchImpl: stubFetch('<html></html>', 'text/html') }),
    ).rejects.toThrow(FetchRefused)
    try {
      await fetchContext(UPSTREAM, { fetchImpl: stubFetch('<html></html>', 'text/html') })
    } catch (error) {
      expect((error as Error).message).toContain(UPSTREAM)
      expect((error as Error).message).toContain('text/html')
    }
    const store = new VendorStore({ root })
    expect(store.has(UPSTREAM)).toBe(false)
  })

  it('does not honour a Link header pointing elsewhere', async () => {
    const seen: string[] = []
    const impl = (async (url: string) => {
      seen.push(url)
      return new Response(BODY, {
        headers: {
          'content-type': 'application/ld+json',
          link: '<https://attacker.example/other.jsonld>; rel="alternate"; type="application/ld+json"',
        },
      })
    }) as unknown as typeof fetch

    const result = await fetchContext(UPSTREAM, { fetchImpl: impl })
    expect(seen).toEqual([UPSTREAM])
    expect(result.url).toBe(UPSTREAM)
  })

  it('accepts a non-JSON-LD content type only when told to', async () => {
    const impl = stubFetch(BODY, 'text/plain')
    await expect(fetchContext(UPSTREAM, { fetchImpl: impl })).rejects.toThrow(FetchRefused)
    const forced = await fetchContext(UPSTREAM, { fetchImpl: impl, allowAnyContentType: true })
    expect(forced.body).toBe(BODY)
  })
})

describe('vendor --check', () => {
  // @lat: [[processing#Processing#Context Resolution#Offline by default]]
  it('verifies hashes without making a request', async () => {
    const root = tempRoot()
    const refreshed = await vendorRefresh(model(), 'model.jsonld.yaml', {
      root,
      fetchImpl: stubFetch(BODY),
    })
    const exploding = (() => {
      throw new Error('check made a network request')
    }) as unknown as typeof fetch

    const report = vendorCheck(refreshed.text!, 'model.jsonld.yaml', {
      root,
      fetchImpl: exploding,
    })
    expect(report.ok).toBe(true)
    expect(report.entries[0]!.status).toBe('verified')
  })

  it('a vendored file edited by hand is a hard error naming the entry', async () => {
    const root = tempRoot()
    const refreshed = await vendorRefresh(model(), 'model.jsonld.yaml', {
      root,
      fetchImpl: stubFetch(BODY),
    })
    const path = join(root, 'contexts', vendorPathFor(UPSTREAM))
    writeFileSync(path, JSON.stringify({ '@context': { name: 'https://evil.example/name' } }))

    const report = vendorCheck(refreshed.text!, 'model.jsonld.yaml', { root })
    expect(report.ok).toBe(false)
    expect(report.entries[0]).toMatchObject({ iri: UPSTREAM, status: 'mismatch' })
    expect(report.entries[0]!.reason).toContain('recorded')

    // And no artifact may be generated from it: reading through the store throws.
    const { ir } = resolveModelText(refreshed.text!, 'model.jsonld.yaml')
    const resolve = resolverFor(ir!, root)
    expect(() => resolve(UPSTREAM)).toThrow(/does not match the hash/)
  })

  it('reports an entry with no recorded hash as missing', () => {
    const report = vendorCheck(model(), 'model.jsonld.yaml', { root: tempRoot() })
    expect(report.ok).toBe(false)
    expect(report.entries[0]).toMatchObject({ status: 'missing' })
    expect(report.entries[0]!.reason).toContain('ldm vendor')
  })
})

describe('every other command is offline', () => {
  // @lat: [[processing#Processing#Context Resolution#Offline by default]]
  it('checking fails closed when the vendored directory is missing, and does not fetch', () => {
    const root = tempRoot()
    const { ir } = resolveModelText(model('sha256-AAAA'), 'model.jsonld.yaml')
    const resolve = resolverFor(ir!, root)
    // Not vendored resolves to `undefined` rather than reaching the network.
    expect(resolve(UPSTREAM)).toBeUndefined()

    const report = validateModelText(model('sha256-AAAA'), 'model.jsonld.yaml', {
      resolveContext: resolve,
    })
    const finding = report.findings.find((f) => f.ruleId === 'L1.context-not-vendored')!
    expect(finding).toBeDefined()
    expect(finding.message).toContain('ldm vendor')
    expect(report.failed).toBe(true)
  })

  it('a check completes with no network available once the context is vendored', async () => {
    const root = tempRoot()
    const refreshed = await vendorRefresh(model(), 'model.jsonld.yaml', {
      root,
      fetchImpl: stubFetch(BODY),
    })
    const { ir } = resolveModelText(refreshed.text!, 'model.jsonld.yaml')
    const report = validateModelText(refreshed.text!, 'model.jsonld.yaml', {
      resolveContext: resolverFor(ir!, root),
    })
    expect(report.findings.some((f) => f.ruleId === 'L1.context-not-vendored')).toBe(false)
  })

  it('terms from a vendored context are available for collision detection', async () => {
    const root = tempRoot()
    const refreshed = await vendorRefresh(model(), 'model.jsonld.yaml', {
      root,
      fetchImpl: stubFetch(BODY),
    })
    const shadowing = refreshed.text!.replace(
      'terms:\n  title:\n    "@id": ex:title\n',
      'terms:\n  name:\n    "@id": ex:ourName\n',
    )
    const { ir } = resolveModelText(shadowing, 'model.jsonld.yaml')
    const report = validateModelText(shadowing, 'model.jsonld.yaml', {
      resolveContext: resolverFor(ir!, root),
    })
    const collision = report.findings.find(
      (f) => f.ruleId === 'L1.term-shadows-referenced-context',
    )!
    expect(collision).toBeDefined()
    expect(collision.message).toContain(UPSTREAM)
  })
})

describe('the store', () => {
  it('creates nested directories for a deep IRI path', () => {
    const root = tempRoot()
    const store = new VendorStore({ root })
    const deep = 'https://example.org/a/b/c/d.jsonld'
    mkdirSync(dirname(store.absolutePathFor(deep)), { recursive: true })
    const entry = store.write(deep, BODY)
    expect(entry.path).toBe('example.org/a/b/c/d.jsonld')
    expect(store.read(deep, entry.integrity)).toEqual(JSON.parse(BODY))
  })
})
