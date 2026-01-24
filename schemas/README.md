# attest-it JSON Schemas

This directory contains JSON schemas for attest-it configuration files. These schemas enable editor support (autocomplete, validation, hover documentation) when editing YAML configuration files.

## Schema Versioning

Schemas are versioned in subdirectories (e.g., `v1/`) to ensure backward compatibility:

- **Breaking changes** to schemas will be released in new version directories
- **Old configs** referencing previous schema versions will continue to work
- **New features** added to schemas are backward-compatible within a version

## Available Schemas

### v1 (Current)

| Schema                          | Purpose                        | Used By                           |
| ------------------------------- | ------------------------------ | --------------------------------- |
| `v1/project-config.schema.json` | Complete project configuration | `.attest-it/config.yaml`          |
| `v1/identity.schema.json`       | Local identity management      | `~/.config/attest-it/config.yaml` |
| `v1/policy.schema.json`         | Security policy (team, gates)  | Split config deployments          |
| `v1/config.schema.json`         | Operational config (suites)    | Split config deployments          |
| `v1/attestations.schema.json`   | Attestations file format       | `.attest-it/attestations.json`    |

## Editor Setup

### VS Code

The YAML Language Server extension automatically reads the `# yaml-language-server: $schema=...` directive at the top of YAML files. No additional configuration needed.

### JetBrains IDEs

Add the schema mapping in Settings → Languages & Frameworks → Schemas and DTDs → JSON Schema Mappings.

## Schema URLs

Schemas are served from GitHub raw content:

```
https://raw.githubusercontent.com/mike-north/attest-it/main/schemas/v1/<schema-name>.schema.json
```

## Legacy Schemas (Root Level)

The root-level `config.schema.json`, `policy.schema.json`, and `attestations.schema.json` are kept for backward compatibility but should not be used in new configurations. They may be removed in a future major version.
