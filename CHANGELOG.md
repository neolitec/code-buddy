# Changelog

Notable changes to Code Buddy. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Code Buddy has no
versioned releases yet: installs follow the latest commit of `main`.

## Unreleased

### Added

- Install as a Claude Code plugin, straight from GitHub:
  `claude plugin marketplace add neolitec/code-buddy`.
- `/code-buddy:code-buddy [dir]` and `init [dir]` target a folder of the
  repository, such as `web`.
- MIT license, contribution guide, code of conduct and security policy.

### Fixed

- Hooks failed with `MODULE_NOT_FOUND` when Code Buddy ran as a plugin.
- The floating panel squeezed the page; it now floats over it, and only the
  docked panel makes room.
- The widget's API client dropped request headers passed as a `Headers` object
  or an array.
