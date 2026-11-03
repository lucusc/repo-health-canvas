# Baseline rehearsal

## Fixture walkthrough

Open `repo-health` in explicit Fixture mode and try the bundled scenarios:

1. **Missing CODEOWNERS and custom license** — confirms ordered CODEOWNERS
   lookup, a present custom license, unavailable GitHub recognition, and
   policy-not-evaluated behavior.
2. **Missing license file** — distinguishes a fixture-confirmed absent file
   from an unrecognized/custom license and an unavailable live endpoint.
3. **Existing standard-file pull request** — select the standards finding and
   inspect the related existing pull request before preparing more work.
4. **Security-access failure** — shows denied/unavailable alert collections
   without converting them into zero or healthy results.
5. **Multi-page results and timestamps** — demonstrates partial collection and
   timestamps immediately before, at, and after a 21-day reference point. The
   baseline does not filter these records by age.

Try a UI selection followed by `get_selected_task`, edit and prepare a task,
copy its handoff, update work tracking, and reload/reopen to inspect persistence.
The handoff is not sent automatically. Fixture data and generated handoffs are
labeled and remain isolated from Live state.

The interface opens on **At a Glance**: four category cards, not a long report.
Choose a card to see only that area's findings, then choose a row to inspect
evidence and existing remediation. **Dashboard** and the category breadcrumb
return to the previous level without clearing the saved selection. Raw payloads
remain collapsed under **Technical Evidence**. Expand **Prepare an Action Brief**
when ready to edit the suggested investigation scope; **Save Action Brief**
persists it without dispatching anything. **Track Work Progress** stays separate
from the source assessment. Unsaved edits prompt before leaving the finding.

Cards distinguish attention, review, unknown, restricted, partial, and stale
evidence. A partial nonzero count has a `+`; an empty partial collection has no
conclusive total. There is no repository health score. **Scope & Collection
Details** opens scan metadata, coverage, policy and limitations on demand.
The compact **Sample data** widget appears only in Fixture mode; expand it to
choose a scenario. **Data source** contains the Live/Fixture switch, while
approved repository selection is available in Live mode when multiple targets
are configured. Live mode has no sample widget or scenario controls.

## Live rehearsal

Only select a repository and account that were explicitly approved for the
demonstration. Confirm the allow-listed host and active `gh` account. Start
with `get_health`, use **Refresh**, select a finding to inspect its evidence,
then prepare a brief without performing a GitHub write. Verify access failures
and partial results are visible. Do not create PRs, post comments, merge, or
dismiss alerts as part of this baseline rehearsal.

## Expected boundaries

- One repository and one data mode are active per canvas.
- Refresh is read-only; prepared actions are saved briefs, not model dispatch.
- Collection limits, missing permissions, partial pages, and stale prior
  snapshots stay visible.
- No “Waiting over N days” filter exists yet; PR creation times are evidence
  only.
