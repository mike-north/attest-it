# Sample embedder

A runnable demonstration of the `@attest-it/core` [embeddable API](../../docs/embedding.md).

It scaffolds a throwaway attest-it project in a temp directory, then drives the
embeddable surface exactly as an embedder would — **list → seal → verify** —
printing each structured result as JSON. It runs with zero terminal interaction
(the identity is backed by a filesystem key whose unlock is a no-op).

## Run it

From the repository root, after building the workspace:

```sh
pnpm build
pnpm --filter @attest-it/example-embedder start
```

or directly:

```sh
pnpm exec tsx examples/embedder/embedder.ts
```

The CI-run counterpart of this flow (self-contained, asserting each step) lives
at `packages/core/test/integration/embedder.test.ts`.
