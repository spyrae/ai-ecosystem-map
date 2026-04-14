# Naming Direction — 2026-04-12

## Decision

Keep the canonical product name as `AI Ecosystem Map`, keep `AEM` as the short mark, and adopt `Harness control plane for agent tooling` as the primary positioning line.

Do not execute an immediate rename to `Harness OS`.

## Why

- `Harness` is already a strong existing software brand, so `Harness OS` is not a clean naming surface.
- `Agent Control Plane` is descriptive, but already crowded and not distinctive enough as a product name.
- `AI Ecosystem Map` still fits the product history and the repository/package identity, while `AEM` is already present in the app, docs, headers, and install surface.
- The product has evolved beyond a visual map, so the missing piece was positioning, not necessarily a hard rename.

## Positioning

Use this product story consistently:

`AI Ecosystem Map (AEM) is the harness control plane for local, project-scoped, remote, and runtime agent tooling.`

Short version:

`Harness control plane for agent tooling.`

## Naming Criteria

- Clear enough for developers seeing it for the first time
- Distinct enough to avoid direct brand confusion
- Broad enough to cover local, remote, project, runtime, bundles, policies, and diagnostics
- Stable enough to avoid unnecessary package/repo/app migration right now

## Rejected Options

### Harness OS

- Strong product energy
- Too close to an existing `Harness` brand family
- Would force repo/package/app rename before the product actually needs it

### Agent Control Plane

- Accurate descriptor
- Better as a category than as the primary name
- Too generic to be a durable brand

### Harness Hub

- Cleaner than `Harness OS`
- Still inherits the `Harness` naming collision risk
- Less precise than `control plane`

## Migration Scope If Rename Is Revisited Later

- npm package name
- GitHub repository name
- desktop app product name and bundle-facing strings
- web title and header copy
- README and docs
- manifest metadata (`source.app`)
- release assets and Homebrew formula

## Follow-up

- Keep `AI Ecosystem Map` as the official name for now
- Use `AEM` in compact UI surfaces
- Use `Harness control plane` as the positioning line in docs and product UI
