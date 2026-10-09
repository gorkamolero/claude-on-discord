# Distribution

Install from the Git repository:

```bash
git clone https://github.com/gorkamolero/claude-on-discord
cd claude-on-discord
bun install
bun run setup
bun start
```

The repository is private; cloning requires GitHub access.
The npm package with the same name is a separate historical distribution and is not the installation source for this checkout.

## Local package validation

```bash
bun run test
bun run typecheck
bun run dist:check
```

`dist:check` validates a local package archive and CLI help. It requires `private: true` in `package.json`, which prevents accidental npm publication.

Publishing or transferring a package requires an explicit decision about its name and publisher identity. A new GitHub repository does not change historical npm records. No package should be published or linked to another account during this cleanup.
