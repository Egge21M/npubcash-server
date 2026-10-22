import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const upstream = 'cashubtc/npubcash-server';
const task = 'deploy:upstream-v3';
const requiredJobs = ['test', 'build', 'production-runtime'];

export async function planDeployment(api, repository, { force = false } = {}) {
  const source = await api(`/repos/${upstream}/commits/v3`);
  const sourceSha = source.sha;
  const config = await api(`/repos/${repository}/commits/prod`);
  const file = await api(`/repos/${repository}/contents/fly.production.toml?ref=${config.sha}`);
  const configSha = file.sha;
  const { workflow_runs: runs } = await api(
    `/repos/${upstream}/actions/workflows/build.yml/runs?branch=v3&event=push&head_sha=${sourceSha}&per_page=1`,
  );
  const run = runs[0];
  if (!run || run.head_sha !== sourceSha || run.status !== 'completed' || run.conclusion !== 'success') {
    return { deploy: false, reason: `Waiting for successful upstream Build CI on ${sourceSha}.` };
  }
  const jobs = [];
  for (let page = 1; ; page++) {
    const batch = await api(`/repos/${upstream}/actions/runs/${run.id}/jobs?filter=latest&per_page=100&page=${page}`);
    jobs.push(...batch.jobs);
    if (jobs.length >= batch.total_count || batch.jobs.length === 0) break;
  }
  if (!requiredJobs.every(name => jobs.some(job => job.name === name && job.status === 'completed' && job.conclusion === 'success'))) {
    return { deploy: false, reason: `Required upstream CI jobs have not all passed on ${sourceSha}.` };
  }

  if (!force) {
    // Compare against the latest successful deployment, not any historical match:
    // returning to an older revision/configuration must deploy again.
    let latestSuccess;
    for (let page = 1; !latestSuccess; page++) {
      const deployments = await api(`/repos/${repository}/deployments?environment=production&task=${task}&per_page=100&page=${page}`);
      for (const deployment of deployments) {
        const statuses = await api(`/repos/${repository}/deployments/${deployment.id}/statuses?per_page=1`);
        if (statuses[0]?.state === 'success') {
          latestSuccess = deployment;
          break;
        }
      }
      if (deployments.length < 100) break;
    }
    if (latestSuccess?.payload?.source_sha === sourceSha && latestSuccess?.payload?.config_sha === configSha) {
      return { deploy: false, reason: `Already deployed ${sourceSha} with this production configuration.` };
    }
  }
  return { deploy: true, source_sha: sourceSha, config_ref: config.sha, config_sha: configSha, reason: `Deploying upstream ${sourceSha}; CI: ${run.html_url}` };
}

export async function recordDeployment(api, repository, { ref, sourceSha, configSha, logUrl }) {
  const deployment = await api(`/repos/${repository}/deployments`, {
    ref, task, auto_merge: false, required_contexts: [], environment: 'production',
    production_environment: true,
    description: `Upstream v3 ${sourceSha}`,
    payload: { source_sha: sourceSha, config_sha: configSha },
  });
  await api(`/repos/${repository}/deployments/${deployment.id}/statuses`, {
    state: 'success', auto_inactive: false,
    environment_url: 'https://npub.cash', log_url: logUrl,
    description: `Deployed upstream v3 ${sourceSha}`,
  });
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  if (repository?.toLowerCase() !== 'egge21m/npubcash-server') throw new Error('This deployer only runs in the production fork.');
  const api = async (path, body) => {
    const response = await fetch(`https://api.github.com${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`GitHub API ${response.status}: ${path}`);
    return response.json();
  };
  if (process.argv[2] === 'plan') {
    const plan = await planDeployment(api, repository, { force: process.env.FORCE_DEPLOY === 'true' });
    console.log(plan.reason);
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(plan).filter(([key]) => key !== 'reason').map(([key, value]) => `${key}=${value}\n`).join(''));
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${plan.reason}\n`);
  } else if (process.argv[2] === 'record') {
    await recordDeployment(api, repository, {
      ref: process.env.GITHUB_SHA,
      sourceSha: process.env.SOURCE_SHA,
      configSha: process.env.CONFIG_SHA,
      logUrl: `${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    });
  } else {
    throw new Error('Expected plan or record.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
