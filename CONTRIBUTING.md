# Contributing to attest-it

## Development Setup

```bash
# Clone the repo
git clone https://github.com/attest-it/attest-it
cd attest-it

# Install dependencies
pnpm install

# Build all packages
pnpm run build

# Run tests
pnpm run test
```

## Making Changes

1. Create a branch: `git checkout -b my-feature`
2. Make your changes
3. Run tests: `pnpm run test`
4. Add a changeset: `pnpm changeset`
5. Commit and push
6. Open a pull request

## Adding a Changeset

When you make changes that should be released:

```bash
pnpm changeset
```

Select the packages affected and describe your changes. Changesets are used to:

- Track which packages need version bumps
- Generate changelogs automatically
- Coordinate releases across multiple packages

### Changeset Types

- **Major**: Breaking changes (e.g., removing APIs, changing behavior)
- **Minor**: New features (e.g., adding APIs, new functionality)
- **Patch**: Bug fixes, docs, refactors

## Release Process

Releases are automated via GitHub Actions:

1. When changesets are merged to main, a "Version Packages" PR is created
2. This PR updates package versions and changelogs
3. Merging the Version Packages PR publishes to npm

The GitHub Action uses the `NPM_TOKEN` secret to publish packages.

## Testing Locally

Run all tests:

```bash
pnpm run test
```

Run tests in watch mode for a specific package:

```bash
cd packages/core
pnpm run test:watch
```

Test the GitHub Action locally with act:

```bash
pnpm run test:action
```

## Code Quality

Before submitting a PR, ensure:

- All tests pass: `pnpm run test`
- Code is linted: `pnpm run lint`
- Types are correct: `pnpm run typecheck`
- Code is formatted: `pnpm run format`

## Project Structure

```
attest-it-workspace/
├── packages/
│   ├── core/           # Core attestation verification logic
│   ├── cli/            # Command-line interface
│   └── github-action/  # GitHub Action wrapper
├── .changeset/         # Changeset configuration and changesets
└── .github/
    └── workflows/      # CI and release workflows
```
