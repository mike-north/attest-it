# Schema Version 1

**IMPORTANT: Breaking changes require creating a new version directory!**

## Rules for Modifying These Schemas

### ✅ Allowed Changes (Non-Breaking)

- **Adding** new optional properties
- **Adding** new enum values (if consumers handle unknown values gracefully)
- **Relaxing** validation constraints (e.g., making a required field optional)
- **Improving** descriptions and documentation
- **Fixing** bugs in existing validation rules

### ❌ Breaking Changes (Require v2)

If you need to make any of these changes, create a new `schemas/v2/` directory:

- **Removing** properties
- **Renaming** properties
- **Changing** property types
- **Adding** new required properties
- **Tightening** validation constraints
- **Changing** the structure of nested objects
- **Modifying** enum values in ways that invalidate existing configs

## Why This Matters

Users' YAML files reference these schemas via URL:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/mike-north/attest-it/main/schemas/v1/project-config.schema.json
```

Breaking changes would cause:

1. **Red squiggles** in users' editors on valid configs
2. **Validation failures** in CI/CD pipelines
3. **Confusion** about whether their config is correct
4. **Breaking existing workflows** without warning

## Creating a New Version

1. Copy `schemas/v1/` to `schemas/v2/`
2. Update `$id` fields to use `/v2/` path
3. Make your breaking changes in v2
4. Update code to generate new configs with v2 schema reference
5. Keep v1 schemas unchanged for backward compatibility
6. Document migration path in release notes

## Questions?

Open an issue if you're unsure whether a change is breaking.
