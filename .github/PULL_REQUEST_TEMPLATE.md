<!-- Keep pull requests focused and as small as practical. -->

## Summary

<!-- What does this change, and why? Link the related issue, e.g. Closes #123. -->

## Type of change

- [ ] Bug fix
- [ ] New feature / program decoder
- [ ] Refactor / chore
- [ ] Documentation
- [ ] Breaking change

## Checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes (tests/fixtures added or updated for the change)
- [ ] `pnpm build` succeeds
- [ ] README / `--help` updated if behavior changed
- [ ] New decoders include a real transaction fixture and never throw (`{ decoded: false }` on failure)
