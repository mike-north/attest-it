/**
 * Identity system types for attest-it v2.0.
 * @packageDocumentation
 */

/**
 * Private key reference - points to where the key is stored.
 * @public
 */
export type PrivateKeyRef =
  | { type: 'file'; path: string }
  | { type: 'keychain'; service: string; account: string; keychain?: string }
  | { type: '1password'; account?: string; vault: string; item: string; field?: string }

/**
 * A single identity configuration.
 * @public
 */
export interface Identity {
  /** Identity name (unique identifier) */
  name: string
  /** Email address associated with this identity */
  email?: string
  /** GitHub username associated with this identity */
  github?: string
  /** Base64 Ed25519 public key */
  publicKey: string
  /** Reference to where the private key is stored */
  privateKey: PrivateKeyRef
}

/**
 * The local config file structure at ~/.config/attest-it/config.yaml.
 * @public
 */
export interface LocalConfig {
  /** Name of the currently active identity */
  activeIdentity: string
  /** Map of identity names to identity configurations */
  identities: Record<string, Identity>
}
