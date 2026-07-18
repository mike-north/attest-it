/**
 * The embeddable attest-it API: a stable, versioned, path-keyed surface.
 *
 * This is the single home for the operations an embedder codes against —
 * {@link listGates}, {@link status}, {@link fingerprint}, {@link seal},
 * {@link verifyOne}, and {@link verifyAll} — together with the versioned result
 * types and failure taxonomy. See {@link API_SCHEMA_VERSION} for the schema
 * versioning and breaking-change policy.
 *
 * @packageDocumentation
 */

export { listGates, status, fingerprint, seal, verifyOne, verifyAll } from './operations.js'

export {
  API_SCHEMA_VERSION,
  type ApiSchemaVersion,
  type FailureClass,
  type ApiResultBase,
  type ApiFailure,
  type ApiOptions,
  type VerifyOptions,
  type GateDescriptor,
  type ListGatesResult,
  type FingerprintResultOk,
  type VerificationSuccess,
  type ArtifactVerification,
  type StatusResult,
  type VerifyAllResult,
  type SealResult,
  type SealParams,
  type VerifyAllParams,
} from './types.js'
