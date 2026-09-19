/**
 * `@json-ld-modeler/core` — parsing, the IR, resolution, the JSON-LD processor,
 * validation and every emitter.
 *
 * This package never imports `vscode`.
 * @lat: [[architecture#Architecture#Package Boundary]]
 */
export const CORE_VERSION = '0.2.0'

// ---- findings --------------------------------------------------------------
export {
  atOrBelowLevel,
  compareFindings,
  hasErrors,
  IMPLEMENTED_LEVELS,
  isImplementedLevel,
  LEVEL_ORDER,
  maxSeverity,
  SEVERITY_ORDER,
  sortFindings,
  type Finding,
  type Level,
  type Severity,
} from './findings/finding.js'
export { FindingCollector } from './findings/collector.js'
export { isRegisteredRule, RULE_IDS, RULES, ruleDefinition, type RuleId } from './findings/rules.js'

// ---- source ----------------------------------------------------------------
export { indexJson, indexYaml, SourceIndex, type Position, type Range } from './source/index-file.js'
export {
  escapeToken,
  pointerChild,
  pointerGet,
  pointerLast,
  pointerParent,
  pointerResolves,
  pointerRoot,
  pointerTokens,
  unescapeToken,
  type JsonPointer,
} from './source/pointer.js'

// ---- model -----------------------------------------------------------------
export {
  CONTAINER_VALUES,
  derivedIdElements,
  findTerm,
  resolutionPrefixes,
  type ContainerValue,
  type ExampleExpectation,
  type InlineContext,
  type Ir,
  type IrExample,
  type IrNamespace,
  type IrTerm,
  type IrUses,
  type IrView,
  type ProcessingMode,
  type TermFacets,
} from './model/ir.js'
export {
  FACETS_ONLY_IN_1_1,
  MODEL_FORMAT_VERSION,
  resolveModel,
  resolveModelText,
  type ResolveResult,
} from './model/resolve.js'
export { canonicalJson, serializeIr, sortKeysDeep } from './model/serialize.js'
export { backfillElementIds, type BackfillResult } from './model/backfill-ids.js'
export { deriveElementId, isElementId, mintElementId } from './model/element-id.js'

// ---- edit ------------------------------------------------------------------
export { applySplices, blockExtent, indentAt, type Splice } from './edit/splice.js'

// ---- processor -------------------------------------------------------------
export { expandIri, processContext } from './processor/active-context.js'
export {
  activeContextForModel,
  bareExpanded,
  everyPointerResolves,
  expandDocument,
  pointersIn,
  resolvePointer,
  unresolvedPointers,
} from './processor/api.js'
export { expand, type ExpandOptions, type ExpandResult, type Observation } from './processor/expand.js'
export { buildInverseContext, compact, compactIri } from './processor/compact.js'
export { expandTraced, formatTrace, type TraceEntry, type TracedExpandResult } from './processor/trace.js'
export {
  cloneContext,
  emptyContext,
  JsonLdError,
  NO_INSTRUMENTATION,
  type ActiveContext,
  type Instrumentation,
  type TermDefinition,
  type TraceEvent,
} from './processor/types.js'
export { collectPointers, strip } from './processor/envelope.js'

// ---- validation ------------------------------------------------------------
export {
  LevelNotAvailable,
  validateModel,
  validateModelText,
  type ExampleOutcome,
  type ValidateOptions,
  type ValidationReport,
} from './validate/validate.js'

// ---- vendoring -------------------------------------------------------------
export {
  integrityOf,
  VENDOR_DIR,
  VendoredContextError,
  VendorStore,
  vendorPathFor,
  type VendorEntry,
} from './vendor/store.js'
export { fetchContext, FetchRefused, type FetchedContext } from './vendor/fetch.js'
export {
  resolverFor,
  vendorCheck,
  vendorRefresh,
  type VendorEntryResult,
  type VendorOptions,
  type VendorResult,
} from './vendor/vendor.js'

// ---- emitters --------------------------------------------------------------
export {
  CAPABILITIES,
  capabilitiesFor,
  capability,
  type Capability,
  type Downgrade,
  type TargetCapabilities,
  type TargetName,
} from './emit/capability.js'
export { emit, parseArtifact, stripComments, type EmitOptions, type EmitResult } from './emit/emit.js'
export { buildContextDocument, buildOwnLayer, buildTermDefinition } from './emit/context-document.js'

// ---- import ----------------------------------------------------------------
export { importContext, type ImportOptions, type ImportResult, type NotRecovered } from './import/import.js'

// ---- projects --------------------------------------------------------------
export {
  describeUnknownModel,
  findAllProjectFiles,
  findProjectFile,
  KNOWN_HOSTS,
  loadProject,
  loadProjectFrom,
  modelAtPath,
  modelNamed,
  parseProject,
  PROJECT_FILE,
  PROJECT_FORMAT_VERSION,
  type HostName,
  type LoadProjectResult,
  type Project,
  type ProjectModel,
} from './project/project.js'
export {
  baseProblem,
  baseUrlProblem,
  hasPlaceholderNamespace,
  MODEL_SCAFFOLD,
  modelScaffold,
  nameProblem,
  PLACEHOLDER_BASE,
  PLACEHOLDER_PREFIX,
  prefixProblem,
  projectScaffold,
  registerModel,
  ScaffoldError,
  SCAFFOLD_NAME_PATTERN,
  type ModelScaffoldOptions,
  type ProjectScaffoldOptions,
  type RegisterModelResult,
  type ScaffoldedModel,
} from './project/scaffold.js'
export {
  checkProject,
  crossProjectFindings,
  modelForFinding,
  type CheckProjectOptions,
  type ProjectModelReport,
  type ProjectReport,
} from './project/check.js'

// ---- versions --------------------------------------------------------------
export {
  canonicalBody,
  identityOf,
  idFromIntegrity,
  isVersionId,
  MANIFEST_FILE,
  MANIFEST_FORMAT_VERSION,
  manifestSelfHashMatches,
  parseManifest,
  renderManifest,
  sealManifest,
  VERSION_ID_LENGTH,
  versionIdOf,
  type Manifest,
  type ManifestBody,
  type ManifestEntry,
  type VersionInput,
  type VersionLineage,
} from './version/manifest.js'
export {
  derivedIdBlockers,
  normalizePath,
  VersionError,
  VersionStore,
  type CreateVersionInput,
  type CreateVersionResult,
  type VerifyProblem,
  type VerifyResult,
  type VersionFile,
} from './version/store.js'
export {
  ARTIFACT_DIR,
  artifactFileFor,
  cloneVersion,
  createVersionFromModel,
  LOCKFILE,
  MODEL_FILE,
  VERSIONED_TARGETS,
  type CreateFromModelOptions,
  type CreateFromModelResult,
} from './version/create.js'
export {
  ALIAS_FILE,
  AliasError,
  AliasStore,
  assertAliasName,
  emptyAliases,
  type AliasDocument,
} from './version/alias.js'

// ---- comparison ------------------------------------------------------------
export {
  atOrAbove,
  CHANGE_CLASSES,
  CLASS_ORDER,
  compareVersions,
  CompareRefused,
  isChangeClass,
  type ChangeClass,
  type CompareResult,
  type Difference,
} from './diff/classify.js'
export { isCanonical, lockfileOf, LockfileError, parseLockfile } from './diff/lockfile.js'

// ---- publishing ------------------------------------------------------------
export {
  adapterFor,
  adaptersFor,
  checkPaths,
  sideFilesFor,
  type AliasStrategy,
  type HostAdapter,
  type PathViolation,
} from './publish/host.js'
export {
  aliasPathFor,
  INDEX_FORMAT_VERSION,
  publish,
  PublishError,
  PUBLISHED_INDEX,
  verifyTree,
  versionPathFor,
  type PublishedAliasEntry,
  type PublishedIndex,
  type PublishedVersionEntry,
  type PublishOptions,
  type PublishResult,
  type TreeProblem,
} from './publish/tree.js'
export {
  asSelfReference,
  chainResolvers,
  selfPublishedResolver,
  SelfPublishedError,
  type SelfReference,
} from './publish/self-resolver.js'

// ---- search ----------------------------------------------------------------
export {
  buildIndex,
  describeNoMatch,
  formatResult,
  search,
  type IndexEntry,
  type MatchField,
  type SearchIndex,
  type SearchReport,
  type SearchResult,
  type SearchSource,
  type SkippedSource,
} from './search/index.js'

// ---- emit additions --------------------------------------------------------
export { retargetVersionHeader, versionHeaderLine } from './emit/emit.js'
