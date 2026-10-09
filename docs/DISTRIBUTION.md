# Distribution

The new public npm package is `@gorkamolero/claude-on-discord`.
The unscoped historical package is a separate distribution.

## Install

```bash
npx @gorkamolero/claude-on-discord@latest setup
npx @gorkamolero/claude-on-discord@latest start
```

The npm installer copies the bundled runtime into `~/.claude-on-discord` and installs its dependencies with Bun. It does not require access to the private GitHub repository. Runtime configuration and data remain in that directory.

To update the runtime:

```bash
npx @gorkamolero/claude-on-discord@latest install
```

Git checkout installation remains available to repository collaborators.

## Release

```bash
bun test
bun run typecheck
bun run dist:check
npm publish --access public
```

The publication hook requires the authenticated npm publisher to be `gorkamolero` and the scoped package name to match. It refuses other accounts.
