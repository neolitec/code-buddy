# Contributing to Code Buddy

Thanks for helping! This guide covers everything a pull request needs to be
merged. By taking part, you agree to follow the [code of conduct](CODE_OF_CONDUCT.md).

**Found a vulnerability?** Do not open an issue: follow the
[security policy](SECURITY.md).

## Before you start

- **Bugs**: open an issue with the bug report form first, unless the fix is
  obvious and small.
- **Features and larger changes**: open an issue with the feature request form
  and wait for a maintainer's go-ahead before writing code. Code Buddy stays
  small on purpose, and a change that has not been discussed may be declined
  however well it is written.
- One pull request does one thing. Refactors, formatting and dependency bumps
  go in their own pull requests.

## Set up

You need [Node.js](https://nodejs.org) 22 or later (the version CI uses is in
[`.nvmrc`](.nvmrc)), npm, and [Claude Code](https://claude.com/claude-code).

```sh
git clone https://github.com/<you>/code-buddy
cd code-buddy
npm ci
```

`npm ci` never runs install scripts: [`.npmrc`](.npmrc) sets
`ignore-scripts=true`. Keep it that way.

To try your changes in a real app, load the plugin from your clone; see
[Development](README.md#development) in the README.

## Layout

| Path                                  | What                                                                |
| ------------------------------------- | ------------------------------------------------------------------- |
| `.claude-plugin/`                     | Plugin and marketplace manifests                                    |
| `skills/code-buddy/SKILL.md`          | The skill Claude reads: modes, agent prompts, hooks                 |
| `skills/code-buddy/scripts/`          | Node.js scripts (ES modules, JSDoc types), run by the skill         |
| `skills/code-buddy/widget/src/`       | The browser widget (React, TypeScript)                              |
| `skills/code-buddy/widget/dist/`      | The built widget, committed so the plugin works without a build     |

## Checks

Run them all before you push; CI runs the same ones and a pull request cannot
be merged while one fails.

```sh
npm run check
```

It runs, in order:

| Script                 | Tool                                                                 |
| ---------------------- | -------------------------------------------------------------------- |
| `npm run format:check` | [Prettier](https://prettier.io); `npm run format` fixes it           |
| `npm run lint`         | [Oxlint](https://oxc.rs/docs/guide/usage/linter), type-aware         |
| `npm run typecheck`    | [TypeScript](https://www.typescriptlang.org) 7, strict, on the widget and the scripts |
| `npm run build`        | Type-checks and bundles the widget into `widget/dist/widget.js`      |

Rules that go with them:

- **Widget changes ship with their build.** When you change anything under
  `widget/` (sources, build config, dependencies), run `npm run build` and
  commit `widget/dist/widget.js` with the change. CI rebuilds it and fails if
  the committed file differs. Never edit `dist/` by hand.
- **Scripts are plain JavaScript with JSDoc types**, type-checked by TypeScript.
  Add types where the checker needs them rather than silencing it.
- **Lint exceptions are rare and explained.** Disable a rule for one line only,
  with the reason:
  `// oxlint-disable-next-line <rule> -- <why this line is right>`. Unused
  directives fail the lint.
- **`SKILL.md` is a prompt.** Every sentence costs tokens in every user's
  session and changes how Claude behaves: keep it short and precise, and test
  the modes you touch in a real session.

## Dependencies

Code Buddy has no runtime dependencies: the scripts use Node.js only, and the
widget bundles React. Adding one is a design decision; ask in an issue first.

- Versions are pinned exactly (`save-exact=true`); the lockfile is committed.
- Dependabot proposes updates weekly, a week after their release, grouped.
- CI rejects dependencies with known vulnerabilities or non-permissive licenses.

## Pull requests

- Branch from `main` and name the branch after its intent: `feature/…`,
  `fix/…`, `docs/…`, `chore/…`, `refactor/…`, `test/…`, `ci/…`.
- **The pull request title is the commit message**: pull requests are squashed
  on merge. It must follow
  `<type>: <summary>`, with `type` one of `feature`, `fix`, `docs`, `chore`,
  `refactor`, `perf`, `test`, `ci`, and a lowercase summary in the imperative
  (`fix: keep the panel above modal dialogs`). CI checks it.
- Fill in the pull request template: what changes, why, and how you tested it.
- Keep your branch up to date with `main`; a maintainer's review is required,
  and new commits after an approval need a new one.
- Code owners review changes to CI, the security policy and the manifests.

## Releases

Maintainers release; contributors only add their change under `## Unreleased`
in [`CHANGELOG.md`](CHANGELOG.md).

Users receive a change only when `version` in
[`.claude-plugin/plugin.json`](.claude-plugin/plugin.json) changes, so merging
to `main` alone ships nothing. To release:

1. Open a `chore: release x.y.z` pull request that sets `version`
   ([semver](https://semver.org): patch for fixes, minor for features, major
   for breaking changes to commands or `.code-buddy.json`), moves the
   `Unreleased` entries under a `## x.y.z - YYYY-MM-DD` heading, and commits
   the rebuilt `widget/dist/widget.js` (`npm run build`): the widget shows the
   version, so CI fails until it is rebuilt.
2. Once it is merged, run **Actions → Release → Run workflow** on `main`, with
   the version. Nothing is tagged or published otherwise: merging to `main`
   never releases.
3. The **Verify** job re-runs every CI check on that commit, then checks what a
   release needs: the version matches `plugin.json` and is greater than the
   last release, its tag is new, its changelog section is dated and filled
   with `Unreleased` empty, no dependency has a known vulnerability, and no
   code scanning alert is open.
4. The **Tag and publish** job waits for a maintainer's approval in the
   `release` environment, then tags the verified commit `vx.y.z` and publishes
   the GitHub release: the changelog section as notes, and the plugin archive
   with a signed provenance attestation. Releases are immutable: once
   published, neither the tag nor the files can change.

## Using Claude Code on this repository

Contributions made with Claude Code are welcome. [`CLAUDE.md`](CLAUDE.md) gives
it the project's rules. You remain responsible for every line you submit:
review it as if you had written it.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE), like the rest of the project.
