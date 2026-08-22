# Conservative repository cleanup

## Goal

Remove unused database starter scaffolding and its package dependencies without changing the current application, deployment path, audio assets, or UI behavior.

## Remove

- `db/`
- `drizzle/`
- `drizzle.config.ts`
- `examples/d1/`
- The `db:generate` package script
- The `drizzle-orm` runtime dependency
- The `drizzle-kit` development dependency
- The untracked `tsconfig.tsbuildinfo` cache file

Add `*.tsbuildinfo` to `.gitignore` so TypeScript incremental caches do not reappear as untracked files.

## Keep

- `components/`: active shadcn UI and audio components
- `lib/`: active formatting, utility, audio decoding, caching, and analysis code
- `public/`: active audio, caption, and favicon assets
- `worker/`: Cloudflare/vinext worker entry referenced by `vite.config.ts`
- `tests/`: the project's rendered HTML and deterministic map checks
- `.openai/hosting.json`: imported by `vite.config.ts`
- Root build configuration, including `vite.config.ts`, `next.config.ts`, `tsconfig.json`, PostCSS, ESLint, and lockfile

Generated directories such as `dist/`, `.next/`, `.vinext/`, and `.wrangler/` remain ignored. They will not be deleted while the development server is running.

## Dependency update

Use npm to remove `drizzle-orm` and `drizzle-kit` so `package.json` and `package-lock.json` remain synchronized. Remove the obsolete `db:generate` script from `package.json`.

## Safety

The current app has no imports from the database scaffold. D1 is disabled in `.openai/hosting.json`, and the worker does not use a database binding at runtime. No application data or behavior is migrated.

Existing unrelated working-tree changes must remain untouched.

## Verification

Use the Node 22 installation required by `package.json`, then:

1. Run the build.
2. Run the rendered HTML test suite.
3. Run lint and distinguish pre-existing warnings/errors from cleanup regressions.
4. Confirm the running app responds and that Library and Sources still render.
5. Search for remaining Drizzle imports, D1 example references, and the removed package script.

