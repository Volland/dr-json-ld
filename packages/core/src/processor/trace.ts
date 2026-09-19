/**
 * Traced expansion.
 *
 * The trace is a by-product of the instrumentation the source map already
 * requires rather than a separate build: the same points emit both, so the two
 * cannot disagree about what happened.
 *
 * It is off by default — the trace is large, and only the editor and the CLI's
 * explain verb ask for it.
 *
 * @lat: [[processing#Processing#Trace]]
 */
import type { SourceIndex, Position } from '../source/index-file.js'
import type { JsonPointer } from '../source/pointer.js'
import type { ActiveContext, Instrumentation, TraceEvent } from './types.js'
import { expand, type ExpandOptions, type ExpandResult } from './expand.js'

export interface TraceEntry {
  /** Where in the ordered record this step falls. */
  step: number
  event: TraceEvent
  /** Resolved against the input document, when one was indexed. */
  loc?: Position
}

export interface TracedExpandResult extends ExpandResult {
  trace: TraceEntry[]
}

class Recorder implements Instrumentation {
  readonly entries: TraceEntry[] = []
  constructor(private readonly source?: SourceIndex) {}

  onEvent(event: TraceEvent): void {
    const loc = this.source?.positionOf(event.pointer)
    this.entries.push({
      step: this.entries.length,
      event,
      ...(loc !== undefined ? { loc } : {}),
    })
  }
}

export interface TracedExpandOptions extends Omit<ExpandOptions, 'instrumentation'> {
  /** The indexed input, so each entry carries a line and column. */
  source?: SourceIndex
}

/**
 * Expand with tracing on. The output is identical to an untraced run — the
 * recorder only observes.
 */
export function expandTraced(
  input: unknown,
  active: ActiveContext,
  options: TracedExpandOptions = {},
): TracedExpandResult {
  const { source, ...rest } = options
  const recorder = new Recorder(source)
  const result = expand(input, active, { ...rest, instrumentation: recorder })
  return { ...result, trace: recorder.entries }
}

/** Whether tracing is on by default. It is not, and a test asserts it. */
export const TRACING_IS_OPT_IN = true

/** One line per step, for `ldm explain --trace`. */
export function formatTrace(trace: readonly TraceEntry[]): string[] {
  return trace.map((entry) => {
    const where = entry.loc ? `${entry.loc.line}:${entry.loc.column}` : entry.event.pointer || '/'
    return `${String(entry.step).padStart(4)}  ${where.padEnd(10)}  ${describe(entry.event)}`
  })
}

function describe(event: TraceEvent): string {
  switch (event.kind) {
    case 'term-lookup':
      return event.found
        ? `term "${event.term}" is defined, and maps to ${event.iri ?? 'nothing'}`
        : `term "${event.term}" is not defined`
    case 'iri-resolution':
      return `"${event.input}" resolves to ${event.output}${
        event.vocab ? ' against @vocab' : ''
      }${event.relative ? ' — and is still relative' : ''}`
    case 'active-context-change':
      return `active context changes (${event.reason}): ${event.detail}`
    case 'value-coercion':
      return `value under "${event.term}" is coerced by ${event.coercion}`
    case 'key-dropped':
      return `key "${event.key}" is dropped (${describeDrop(event.reason)})`
    case 'blank-node-minted':
      return `a blank node ${event.id} is minted here`
  }
}

function describeDrop(reason: 'no-term' | 'keyword-like' | 'null-mapping'): string {
  switch (reason) {
    case 'no-term':
      return 'no term matched and no @vocab applies'
    case 'keyword-like':
      return 'it is shaped like a keyword but is not one'
    case 'null-mapping':
      return 'its term definition maps it to null'
  }
}

export type { JsonPointer }
