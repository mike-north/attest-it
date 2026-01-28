/**
 * Merge policy and operational configurations into a unified AttestItConfig.
 *
 * This module handles the combination of security-critical policy configuration
 * (loaded from the default branch) with operational configuration (can be loaded
 * from PR branches) to create the complete configuration used for attestation
 * verification.
 *
 * @packageDocumentation
 */

import type {
  AttestItConfig,
  GateConfig,
  KeyProviderSettings,
  SuiteConfig,
  TeamMember,
} from '../types.js'
import type { OperationalConfig } from './operational-schema.js'
import type { PolicyConfig } from './policy-schema.js'

/**
 * Converts a Zod-inferred suite config to the AttestItConfig suite type.
 * Filters out undefined values to match exactOptionalPropertyTypes requirements.
 */
function toSuiteConfig(suiteName: string, suite: OperationalConfig['suites'][string]): SuiteConfig {
  // Gate is required. If suite uses legacy packages definition, use suite name as gate reference
  const result: SuiteConfig = {
    gate: suite.gate ?? suiteName,
  }

  if (suite.description !== undefined) result.description = suite.description
  if (suite.command !== undefined) result.command = suite.command
  if (suite.timeout !== undefined) result.timeout = suite.timeout
  if (suite.interactive !== undefined) result.interactive = suite.interactive
  if (suite.invalidates !== undefined) result.invalidates = suite.invalidates
  if (suite.depends_on !== undefined) result.depends_on = suite.depends_on

  return result
}

/**
 * Converts a Zod-inferred team member to the AttestItConfig team member type.
 * Filters out undefined values to match exactOptionalPropertyTypes requirements.
 */
function toTeamMember(member: NonNullable<PolicyConfig['team']>[string]): TeamMember {
  const result: TeamMember = {
    name: member.name,
    publicKey: member.publicKey,
  }

  if (member.email !== undefined) result.email = member.email
  if (member.github !== undefined) result.github = member.github

  return result
}

/**
 * Converts a Zod-inferred gate config to the AttestItConfig gate type.
 * Filters out undefined values to match exactOptionalPropertyTypes requirements.
 */
function toGateConfig(gate: NonNullable<PolicyConfig['gates']>[string]): GateConfig {
  const fingerprint: GateConfig['fingerprint'] = {
    paths: gate.fingerprint.paths,
  }

  if (gate.fingerprint.exclude !== undefined) {
    fingerprint.exclude = gate.fingerprint.exclude
  }

  return {
    name: gate.name,
    description: gate.description,
    authorizedSigners: gate.authorizedSigners,
    fingerprint,
    maxAge: gate.maxAge,
  }
}

/**
 * Converts a Zod-inferred key provider to the AttestItConfig key provider type.
 * Filters out undefined values to match exactOptionalPropertyTypes requirements.
 */
function toKeyProvider(
  provider: NonNullable<OperationalConfig['settings']['keyProvider']>,
): KeyProviderSettings {
  const result: KeyProviderSettings = {
    type: provider.type,
  }

  if (provider.options !== undefined) {
    const options: NonNullable<KeyProviderSettings['options']> = {}
    let hasOptions = false

    if (provider.options.privateKeyPath !== undefined) {
      options.privateKeyPath = provider.options.privateKeyPath
      hasOptions = true
    }
    if (provider.options.account !== undefined) {
      options.account = provider.options.account
      hasOptions = true
    }
    if (provider.options.vault !== undefined) {
      options.vault = provider.options.vault
      hasOptions = true
    }
    if (provider.options.itemName !== undefined) {
      options.itemName = provider.options.itemName
      hasOptions = true
    }

    if (hasOptions) {
      result.options = options
    }
  }

  return result
}

/**
 * Merges policy and operational configurations into a single AttestItConfig.
 *
 * The merge strategy prioritizes security-critical fields from the policy
 * configuration while combining operational fields from both sources:
 *
 * - **Policy settings** (maxAgeDays, publicKeyPath, attestationsPath, sealsPath) are used as-is
 * - **Operational settings** (defaultCommand, keyProvider) are added from operational config
 * - **Team and gates** come exclusively from policy config
 * - **Suites and groups** come exclusively from operational config
 *
 * @param policy - The policy configuration containing security-critical settings
 * @param operational - The operational configuration containing suites and execution settings
 * @returns A complete AttestItConfig ready for use in attestation operations
 *
 * @example
 * ```typescript
 * const policy = parsePolicyContent(policyYaml, 'yaml')
 * const operational = parseOperationalContent(operationalYaml, 'yaml')
 * const config = mergeConfigs(policy, operational)
 * ```
 *
 * @public
 */
export function mergeConfigs(policy: PolicyConfig, operational: OperationalConfig): AttestItConfig {
  const settings: AttestItConfig['settings'] = {
    // Security settings from policy (these are trust-critical)
    maxAgeDays: policy.settings.maxAgeDays,
    publicKeyPath: policy.settings.publicKeyPath,
    attestationsPath: policy.settings.attestationsPath,
    sealsPath: policy.settings.sealsPath,
  }

  // Add operational settings only if defined
  if (operational.settings.defaultCommand !== undefined) {
    settings.defaultCommand = operational.settings.defaultCommand
  }
  if (operational.settings.keyProvider !== undefined) {
    settings.keyProvider = toKeyProvider(operational.settings.keyProvider)
  }

  // Convert suites
  const suites: Record<string, SuiteConfig> = {}
  for (const [name, suite] of Object.entries(operational.suites)) {
    // eslint-disable-next-line security/detect-object-injection
    suites[name] = toSuiteConfig(name, suite)
  }

  const config: AttestItConfig = {
    version: 1,
    settings,
    suites,
  }

  // Add team from policy if defined
  if (policy.team !== undefined) {
    const team: Record<string, TeamMember> = {}
    for (const [slug, member] of Object.entries(policy.team)) {
      // eslint-disable-next-line security/detect-object-injection
      team[slug] = toTeamMember(member)
    }
    config.team = team
  }

  // Add gates from policy if defined
  if (policy.gates !== undefined) {
    const gates: Record<string, GateConfig> = {}
    for (const [slug, gate] of Object.entries(policy.gates)) {
      // eslint-disable-next-line security/detect-object-injection
      gates[slug] = toGateConfig(gate)
    }
    config.gates = gates
  }

  // Add groups from operational config if defined
  if (operational.groups !== undefined) {
    config.groups = operational.groups
  }

  return config
}
