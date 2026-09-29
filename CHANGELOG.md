# Changelog

Notable changes to Code Buddy. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org). Users receive a change when it is
released to the `stable` branch.

## Unreleased

## 0.1.0 - 2026-09-29

First release.

### Added

- Install as a Claude Code plugin, straight from GitHub:
  `claude plugin marketplace add neolitec/code-buddy#stable`. The `stable`
  branch holds the released versions, with the built widget; `main` is where
  development happens.
- `/code-buddy:code-buddy [dir]` and `init [dir]` target a folder of the
  repository, such as `web`.
- A mascot drifts at the bottom of the panel, in its own strip so it never
  covers the comments. It keeps still under `prefers-reduced-motion`, and is
  hidden when the window is under 560 px tall.
- The panel's bottom-right corner shows the plugin's version and links to the
  project on GitHub.
- MIT license, contribution guide, code of conduct and security policy.

### Changed

- The widget's blues come from the mascot's body, keeping readable contrast.

### Fixed

- Hooks failed with `MODULE_NOT_FOUND` when Code Buddy ran as a plugin.
- The floating panel squeezed the page; it now floats over it, and only the
  docked panel makes room.
- Leaving a new comment or a thread on a page without comments showed an
  empty panel; it now returns to the open comments.
- The widget's API client dropped request headers passed as a `Headers` object
  or an array.
- The widget bundled React without its license notice: the notices now stay in
  `widget.js`, and `dist/THIRD_PARTY_LICENSES.txt` carries the full license of
  every bundled package.
