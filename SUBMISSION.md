# ForkTrace submission checklist

## Required links

- [ ] Public YouTube demo video, under 3 minutes: `YOUTUBE_URL_HERE`
- [ ] Public GitHub repository: `GITHUB_REPOSITORY_URL_HERE`
- [ ] Codex `/feedback` Session ID: `CODEX_FEEDBACK_SESSION_ID_HERE`
  - In the Codex session used for the milestone work, run `/feedback`, submit the feedback form, and copy the returned Session ID here.
- [ ] Deployed read-only demo: `DEPLOYED_DEMO_URL_HERE`
- [ ] Local testable build instructions verified from a fresh clone

## Technical acceptance

- [x] Observable evidence only; no hidden-reasoning claim
- [x] Original JSONL logs immutable
- [x] Fork lineage present on every fork event
- [x] Memoized no-op replay executes zero tool bodies
- [x] Changed call records `DIVERGED` before live execution
- [x] Structural original failure verified 10/10
- [x] Full E2E path passed three consecutive times
- [x] Formatting, lint, type-checking, tests, and production build green
- [x] Vercel experience explicitly says replay is precomputed
- [x] Local-only live fork limitation documented

## Submission assets

- [ ] YouTube visibility is public
- [ ] Repository visibility is public
- [ ] README links and commands checked
- [ ] Devpost description pasted from `DEVPOST.md`
- [ ] Demo reset run immediately before recording
- [ ] Deployed URL tested in an incognito window

## Distinction from ActionLens

- [x] Confirmed substantially different submission: **ActionLens** is end-user document intelligence; **ForkTrace** is developer infrastructure for recording, forking, replaying, and comparing agent executions.

## Deployment honesty

The hosted Vercel walkthrough is read-only and uses a bundled original trace plus a bundled precomputed fork. It does not perform or simulate live replay. Live record/fork/replay requires the local Vite middleware and writable `traces/runs` storage.
