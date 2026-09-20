#!/usr/bin/env node
/**
 * Renders the model schema's reference page from the schema document.
 *
 * `site/` has no generator and no build step — the deployed bytes are the
 * committed bytes — so this writes into the repository and continuous
 * integration re-runs it and fails on a diff. That is the same arrangement the
 * emitted `@context` uses, for the same reason: a page generated at deploy
 * time is a page nobody reviewed.
 *
 * Usage:
 *   node scripts/schema-reference.mjs           write the page
 *   node scripts/schema-reference.mjs --check   fail if the committed page differs
 *
 * It lives outside `site/` deliberately: everything under `site/` is deployed
 * verbatim, and a build script is not part of the published site.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SCHEMA = fileURLToPath(new URL('../site/schemas/model/1/model.schema.json', import.meta.url))
const PAGE = fileURLToPath(new URL('../site/schemas/model/1/index.html', import.meta.url))

const schema = JSON.parse(readFileSync(SCHEMA, 'utf8'))

const escape = (value) =>
  String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/** `code` spans, but only where the source text actually marked one. */
function markup(text) {
  return escape(text).replace(/`([^`]+)`/g, '<code>$1</code>')
}

/** What a subschema accepts, in one phrase a reader can scan. */
function describeType(node) {
  if (!node || typeof node !== 'object') return '—'
  if (node.$ref) return `<a href="#${refName(node.$ref)}">${escape(refName(node.$ref))}</a>`
  if (node.const !== undefined) return `<code>${escape(JSON.stringify(node.const))}</code>`
  if (node.enum) return node.enum.map((v) => `<code>${escape(JSON.stringify(v))}</code>`).join(', ')
  if (node.oneOf) return node.oneOf.map(describeType).join(' or ')
  if (node.anyOf) return node.anyOf.map(describeType).join(' or ')
  if (node.type === 'array') {
    return `sequence of ${node.items ? describeType(node.items) : 'anything'}`
  }
  if (node.type === 'object' && node.additionalProperties && node.additionalProperties !== true) {
    return `mapping to ${describeType(node.additionalProperties)}`
  }
  return escape(Array.isArray(node.type) ? node.type.join(' or ') : (node.type ?? 'anything'))
}

const refName = (ref) => ref.replace('#/$defs/', '')

/** The constraints worth printing beside a field, beyond its type. */
function constraints(node) {
  const out = []
  if (node.pattern) out.push(`matches <code>${escape(node.pattern)}</code>`)
  if (node.minLength !== undefined) out.push(`at least ${node.minLength} character(s)`)
  if (node.minItems !== undefined) out.push(`at least ${node.minItems} item(s)`)
  if (node.uniqueItems) out.push('no duplicates')
  if (node.default !== undefined) out.push(`defaults to <code>${escape(JSON.stringify(node.default))}</code>`)
  if (node.additionalProperties === false) out.push('no other keys')
  if (node.not?.pattern) out.push(`must not match <code>${escape(node.not.pattern)}</code>`)
  return out.join('; ') || '—'
}

function fieldRows(properties, required = []) {
  return Object.entries(properties ?? {})
    .map(([name, node]) => {
      const req = required.includes(name)
      return `      <tr>
        <td><code>${escape(name)}</code></td>
        <td>${describeType(node)}</td>
        <td>${req ? 'required' : 'optional'}</td>
        <td>${node.description ? markup(node.description) : '—'}${
          constraints(node) === '—' ? '' : `<br><span class="dim">${constraints(node)}</span>`
        }</td>
      </tr>`
    })
    .join('\n')
}

function table(caption, properties, required) {
  return `  <div class="table-wrap">
    <table>
      <caption>${escape(caption)}</caption>
      <thead><tr><th>Field</th><th>Accepts</th><th>Required</th><th>Meaning</th></tr></thead>
      <tbody>
${fieldRows(properties, required)}
      </tbody>
    </table>
  </div>`
}

/**
 * A named `$defs` entry carrying a `title` is a co-constraint — a rule about
 * how facets combine rather than a type. These are the entries the editor
 * prints when it refuses a term, so the page shows them in the editor's words.
 */
const coConstraints = Object.entries(schema.$defs ?? {}).filter(([, node]) => node.title)

const constraintList = coConstraints
  .map(
    ([name, node]) => `      <li>
        <strong>${escape(node.title)}</strong> <span class="dim">(<code>${escape(name)}</code>)</span><br>
        ${markup(node.description ?? '')}
      </li>`,
  )
  .join('\n')

/** Every `$defs` entry that is a plain type, documented so a $ref resolves. */
const defsTables = Object.entries(schema.$defs ?? {})
  .filter(([, node]) => !node.title && node.properties)
  .map(
    ([name, node]) =>
      `  <h3 id="${escape(name)}">${escape(name)}</h3>
${node.description ? `  <p>${markup(node.description)}</p>` : ''}
${table(name, node.properties, node.required ?? [])}`,
  )
  .join('\n\n')

const scalarRows = Object.entries(schema.$defs ?? {})
  .filter(([, node]) => !node.title && !node.properties)
  .map(
    ([name, node]) => `      <tr>
        <td id="${escape(name)}"><code>${escape(name)}</code></td>
        <td>${describeType(node)}</td>
        <td>${node.description ? markup(node.description) : '—'}${
          constraints(node) === '—' ? '' : `<br><span class="dim">${constraints(node)}</span>`
        }</td>
      </tr>`,
  )
  .join('\n')

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The model file, field by field — Dr. JSON-LD</title>
<meta name="description" content="Every field a .jsonld.yaml model may declare, its type, whether it is required, and the facet combinations the schema refuses. Generated from the schema itself.">
<link rel="icon" href="../../../assets/img/mark.svg">
<link rel="stylesheet" href="../../../assets/fonts.css">
<link rel="stylesheet" href="../../../assets/css/site.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>

<header class="masthead">
  <div class="masthead__inner">
    <a class="brand" href="../../../">
      <img src="../../../assets/img/mark.svg" alt="">
      <span>Dr. JSON-LD<small>apothecary for linked data</small></span>
    </a>
    <nav class="nav" aria-label="Primary">
      <a href="../../../">The tool</a>
      <a href="../../../book/">Handbook</a>
      <a href="../../../blog/">Notes</a>
      <a href="https://github.com/Volland/dr-json-ld">Source</a>
    </nav>
  </div>
</header>

<main id="main">

  <div class="wrap prose prose--wide">

  <p class="eyebrow">Schema reference · model format 1</p>
  <h1>The model file, <em>field by field</em></h1>

  <p class="standfirst">
    ${markup(schema.description ?? '')}
    This page is generated from the schema, so it cannot describe a field the schema
    does not have — or miss one it does.
  </p>

  <div class="callout callout--tool">
    <p>
      Point your editor at the schema and it will check the file as you type:
    </p>
    <pre><code># yaml-language-server: $schema=${escape(schema.$id)}</code></pre>
    <p>
      The schema is served at <a href="${escape(schema.$id)}"><code>${escape(schema.$id)}</code></a>.
      The <code>1</code> in that path is the model format version — the same <code>1</code>
      the file's own <code>jsonld:</code> key declares. It never changes meaning, so a model
      pinned to it keeps validating.
    </p>
  </div>

  <h2>The file</h2>

  <p>
    A model declares a namespace and the terms it defines. Everything else is optional.
    The file is <em>about</em> JSON-LD and is not itself JSON-LD, which is why it is named
    <code>.jsonld.yaml</code> and not <code>.jsonld</code>.
  </p>

${table('Top-level fields', schema.properties, schema.required ?? [])}

  <h2>What the schema refuses</h2>

  <p>
    A term may carry every JSON-LD 1.1 facet, and the schema refuses only combinations
    JSON-LD itself forbids. A combination the specification permits is accepted here even
    where it is a likely mistake — the schema's reach stops exactly where
    <code>ldm check</code> stops, so the editor never underlines a model the command
    accepts.
  </p>

  <ul>
${constraintList}
  </ul>

  <div class="callout callout--warn">
    <p>
      Two combinations are deliberately <strong>not</strong> refused. A term carrying both
      <code>@language</code> and a <code>@type</code> coercion is legal: JSON-LD reads
      <code>@language</code> only when <code>@type</code> is absent, so the language is
      ignored rather than rejected. And a model declaring <code>mode: "1.0"</code> may use a
      facet JSON-LD 1.1 introduced — that is a downgrade, reported as
      <code>L1.facet-not-in-mode</code> at warning severity, not an illegal model.
    </p>
    <p>
      Anything under a term's <code>raw</code> is outside these rules, because
      <code>raw</code> exists for constructs the model format has not named. It is not a way
      past <code>ldm check</code>: the facets are merged into the emitted definition and a
      JSON-LD processor still reads them.
    </p>
  </div>

  <h2>Definitions</h2>

${defsTables}

  <h3>Scalars</h3>

  <div class="table-wrap">
    <table>
      <caption>Named value types</caption>
      <thead><tr><th>Name</th><th>Accepts</th><th>Meaning</th></tr></thead>
      <tbody>
${scalarRows}
      </tbody>
    </table>
  </div>

  </div>

</main>

<footer class="footer">
  <div class="footer__inner">
    <div>
      <h2>Read</h2>
      <ul>
        <li><a href="../../../book/">The JSON-LD handbook</a></li>
        <li><a href="../../../blog/linked-data.html">What linked data is for</a></li>
        <li><a href="../../../blog/agents.html">Agents, humans, and expansion</a></li>
      </ul>
    </div>
    <div>
      <h2>Reference</h2>
      <ul>
        <li><a href="${escape(schema.$id)}">The model schema</a></li>
        <li><a href="https://www.w3.org/TR/json-ld11/">JSON-LD 1.1</a></li>
        <li><a href="https://github.com/Volland/dr-json-ld">Source on GitHub</a></li>
      </ul>
    </div>
    <p class="footer__note">
      This page is generated from the schema it documents. Editing it by hand is a change
      continuous integration will undo.
    </p>
  </div>
  <div class="footer__legal">
    <span>&copy; 2026 Wolodymyr Pawlyshyn</span>
    <a href="../../../impressum.html">Impressum</a>
    <a href="../../../datenschutz.html">Datenschutz</a>
    <a href="../../../agb.html">AGB</a>
  </div>
</footer>

</body>
</html>
`

if (process.argv.includes('--check')) {
  const committed = readFileSync(PAGE, 'utf8')
  if (committed !== page) {
    process.stderr.write(
      'site/schemas/model/1/index.html is stale. Run `node scripts/schema-reference.mjs`.\n',
    )
    process.exit(1)
  }
  process.stdout.write('the schema reference page matches the schema\n')
} else {
  writeFileSync(PAGE, page)
  process.stdout.write(`Wrote ${PAGE}\n`)
}
