# Installation, permissions, and troubleshooting

## Install

This baseline is a project-scoped Copilot canvas extension at
`.github/extensions/repo-health/extension.mjs`. Use a Copilot app/runtime build
that supports extension canvases and the `@github/copilot-sdk/extension`
resolver. The extension requires Node.js facilities supplied by the host and a
`gh` executable on `PATH`; it does not install a second SDK or start a separate
service.

Open the canvas with an explicit mode:

- Live: provide a list of approved repository identities with `host`, `account`,
  `owner`, and `repo`. The live client accepts only hosts listed in
  `REPO_HEALTH_APPROVED_HOSTS` at extension startup. That variable is a
  comma-separated hostname allow-list; `github.com` is the default.
- Fixture: choose one of the bundled fixture IDs. Fixture mode uses local data
  only and never calls `gh`.

The authoring environment used for this baseline did not expose the canvas
scaffold, extension-reload, discovery, or canvas-RPC controls. The implementation
follows the installed SDK canvas contract, but registration, iframe rendering,
and action routing still need verification in a Copilot app/runtime that
supports extension canvases.

The configured account must match the identity returned by `GET /user` through
the current `gh` authentication context. A mismatch fails explicitly; the
extension never runs `gh auth switch`. Authenticate through the normal GitHub
CLI process before selecting Live mode. Do not copy tokens or credential output
into extension settings, source, task briefs, or logs.

## Read-only API surface

The client uses GitHub REST API version `2022-11-28`, sends
`X-GitHub-Api-Version`, and invokes `gh api` with an argument array. It uses
only fixed `GET` routes: authenticated user, repository metadata/default-branch
commit, contents, CODEOWNERS errors, license recognition, open pull requests,
pull-request files/reviews, check runs and combined commit status, Dependabot
alerts, and code-scanning alerts. It does not enumerate organizations, request
write/administrative permissions, inspect secret-scanning data, fetch pull
request heads, or execute repository code.

The read areas to review for these routes are:

| Route family | Minimum permission area to verify on the selected host |
|---|---|
| Authenticated user and repository metadata | Account read; repository Metadata |
| Default-branch commit and contents | Contents |
| CODEOWNERS errors and license recognition | Contents |
| Open pull requests, changed files, and reviews | Pull requests |
| Check runs and combined commit status | Checks and Commit statuses |
| Dependency alerts | Dependabot alerts |
| Code-scanning alerts | Code scanning alerts |

Minimum endpoint permissions depend on token type, host version, and enabled
repository features. Review the current host documentation and token permission
UI before use. The expected read areas are repository metadata/contents, pull
requests, checks/commit statuses, Dependabot alerts, and code-scanning alerts.
Do not grant write, organization-administration, or secret-scanning permissions
for this baseline. A `403` is a policy/access result; a `404` is unavailable or
ambiguous, not proof of absence. Security collections may be disabled or
inaccessible even when repository metadata is readable.

For GitHub Enterprise Server, confirm the pinned API version and endpoint
support for that host release before adding its hostname to the allow-list.
Never use an unreviewed host as an arbitrary API proxy.

## Policy configuration

`.github/repo-health-policy.json` is a reviewable, client-neutral template.
Its `schemaVersion` is `1`. Populate only values approved for the selected
repository:

| Field | Meaning |
|---|---|
| `name`, `version`, `reference` | Human-readable policy identity and authoritative reference. |
| `requiredStandards` | Exact repository-relative standard-file paths. |
| `license.required`, `license.approvedFileNames`, `license.templateReference`, `license.expectedSpdxIds`, `license.exceptions` | Optional presence, candidate filenames, template reference, and SPDX expectations. A license exception must state `condition` (`missing`, `unrecognized`, or `spdx-mismatch`), a `reason`, and `reviewDate`; mismatch exceptions also list applicable `spdxIds`. No legal conclusion is inferred. |
| `confirmedCodeowners` | Explicit `{ "pattern": "...", "owners": "..." }` expectations. These are comparison hints, not proof of current access or enforcement. |
| `reviewerGuidance` | Generic confirmation guidance where ownership cannot be verified. |
| `dependabotAuthors` | Host-specific bot identities treated as Dependabot PR authors. |
| `enabledChecks` | Supported collection names: `repository-standards`, `codeowners-errors`, `github-license-recognition`, `dependabot-prs`, `dependency-alerts`, and `code-scanning-alerts`. An explicitly empty list disables optional collection calls. |
| `repositoryExceptions` | Exceptions with a reason and `YYYY-MM-DD` review date. |
| `repositoryOverrides` | Exact `{ "host": "...", "owner": "...", "repo": "...", "reason": "...", "reviewDate": "YYYY-MM-DD", "policy": { ... } }` overrides. Override policy fields use the same schema; multiple matches are rejected. |

Empty fields do not establish an organizational policy. An absent/empty policy
leaves compliance not evaluated. CODEOWNERS coverage, legal terms, branch
protection, and safe merge are never inferred from file presence alone.

## Local state and retention

Minimal findings, user selections, and editable task briefs are stored as JSON
under `.copilot/repo-health/` in the session workspace. The directory is
gitignored. State is keyed by host, authenticated account, stable numeric
repository ID (or the configured slug before a live ID is available), and
Live/Fixture mode. Updates use a serialized per-key queue, revision checks, a
private temporary file, and atomic replacement. No raw file contents beyond
the short-lived CODEOWNERS/license evaluation, credentials, or full API payloads
are persisted intentionally.

To clear saved state, stop the extension and remove only the named
`.copilot/repo-health/` directory in that workspace. Keep only the snapshots
needed for the review; no automatic age-based cleanup is included in this
baseline.

## Troubleshooting

- **Canvas not listed:** confirm the filename is `extension.mjs`, the directory
  is an immediate child of `.github/extensions/`, and the target app runtime
  supports extension canvas declarations. Reopen/reload through the supported
  runtime UI. This repository does not include a separate reload command.
- **Authentication mismatch:** check `gh auth status --hostname <host>` and
  compare its active account with the selected account. The extension will not
  switch accounts or reveal token data.
- **403 or 404:** check the relevant read permission, repository access, host
  feature availability, and SSO policy. The UI preserves unavailable/unknown
  rather than showing zero findings.
- **Rate limited:** the response includes a retry hint when available. Refresh
  manually after the indicated time; no hidden retry loop is used.
- **Partial collection:** inspect the loaded count and limitations. Pagination
  is bounded to five pages per collection; incomplete data cannot support a
  confident no-match claim.
- **Policy error:** validate JSON syntax, the schema version, exact repo-relative
  paths, and exception reason/review dates.

## Limitations

This is a local, read-only baseline, not a hosted service or production claim.
It is restricted to the currently selected repository and the authenticated
account's accessible evidence. A failed security endpoint does not mean zero
alerts. A 404 does not prove a file or feature is absent. PR checks/reviews are
loaded on selection and do not guarantee merge safety. Existing PR lookup is
bounded and explicitly incomplete when it cannot inspect all candidates.
Progress tracking never marks findings resolved. The baseline intentionally
does not implement a “Waiting over N days” filter or any aging threshold/action;
creation timestamps are included for the later exercise.
