# Repo Health -> Take Action

A project-scoped GitHub Copilot canvas extension for read-only repository health
evidence and bounded, reviewable follow-up actions.

The extension is under `.github/extensions/repo-health/`. Start with
[installation and permissions](docs/installation.md), then follow the
[fixture rehearsal](docs/rehearsal.md). It is a local baseline, not a hosted
service or production claim. Fixture mode is safe and explicit; Live mode
requires an approved host/account/repository and a matching authenticated `gh`
context.

The baseline intentionally has no dependency-PR age filter. Creation timestamps
are included for the later exercise.
