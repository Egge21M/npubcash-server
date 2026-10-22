# Deploying upstream V3

Production at https://npub.cash runs code from `cashubtc/npubcash-server`'s
`v3` branch, with `fly.production.toml` from this fork's `prod` branch.
Application code does not need to be synced or merged into the fork.

The **Deploy upstream V3** workflow on the fork's default branch (`main`)
checks upstream four times daily, at 00:07, 06:07, 12:07, and 18:07 UTC.
Manual runs remain available at any time. GitHub schedules may be delayed. It selects
the current upstream `v3` commit only after its latest push-triggered **Build**
run succeeds, including the `test`, `build`, and `production-runtime` jobs.
Pending or failed CI leaves the existing production release running.

The workflow checks out that exact source commit and a pinned `prod` revision,
then runs this command from the source checkout:

```sh
cp ../deployment-config/fly.production.toml fly.production.toml
flyctl deploy --config fly.production.toml --remote-only --ha=false
```

The production config is copied into the temporary source checkout because Fly
resolves its relative Dockerfile path beside the configuration file. This does
not commit or push any files into upstream.

The app remains `npubcash-v3` in Amsterdam, using PostgreSQL and its existing
Fly runtime secrets. The upstream `fly.toml` targets a separate nightly SQLite
app and is not used. `--ha=false` avoids creating a spare Machine; it does not
scale down existing Machines. Keep the existing single-instance deployment.

## Configuration and credentials

- Keep automation on the fork's default branch. Schedules only run there.
- Edit `fly.production.toml` on `prod` to change production settings. A changed
  config deploys on the next poll, even when application code is unchanged.
- Keep the app-scoped `FLY_API_TOKEN` in the fork's repository secrets or its
  `production` environment. That environment must allow deployments from `main`.
- Database and application secrets stay on Fly. No Fly config, token, or
  notification workflow needs to be added upstream.
- The former push-to-`prod` deploy job is removed. Pushing application changes
  only to `prod` no longer releases them; merge application changes upstream.

After a successful Fly deploy, the workflow records the upstream commit and
configuration blob SHA in a GitHub deployment with task `deploy:upstream-v3`.
The next poll compares against the latest successful record and skips unchanged
releases. Failed deploys are retried on later polls. A failure to record a
successful deploy can cause a harmless redeploy on the next poll.
Selection, deployment, and recording are serialized to prevent overlapping
releases. Scheduled runs target the current upstream head; they may coalesce
several upstream pushes into one deployment.

## Manual runs and troubleshooting

In Actions, select **Deploy upstream V3**, then **Run workflow** on `main`.
Enable **force** to redeploy unchanged code/configuration, for example after a
manual rollback. Force never bypasses upstream CI. The run summary explains
which commit was selected or why deployment was skipped.

```sh
gh workflow run deploy-upstream.yml --repo Egge21M/npubcash-server --ref main
gh run list --repo Egge21M/npubcash-server --workflow deploy-upstream.yml
fly status --app npubcash-v3
```

To pause automatic releases (including during a manual rollback), disable this
workflow in Actions. Re-enable it when ready to follow upstream again. GitHub
automatically disables public-repository schedules after 60 days without
repository activity; monitor this and re-enable the workflow if needed.

Run the deployment selection tests locally with:

```sh
node --test .github/scripts/deploy-upstream.test.mjs
```
