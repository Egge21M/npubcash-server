import assert from 'node:assert/strict';
import test from 'node:test';
import { planDeployment, recordDeployment } from './deploy-upstream.mjs';

const repository = 'Egge21M/npubcash-server';
const sourceSha = 'a'.repeat(40);
const configSha = 'b'.repeat(40);
const configRef = 'c'.repeat(40);

function fixture({ run = {}, jobs, deployments = [], statuses = {} } = {}) {
  const requests = [];
  return {
    requests,
    api: async path => {
      requests.push(path);
      if (path.endsWith('/commits/v3')) return { sha: sourceSha };
      if (path.endsWith('/commits/prod')) return { sha: configRef };
      if (path.includes('/contents/')) {
        assert.ok(path.endsWith(`?ref=${configRef}`));
        return { sha: configSha };
      }
      if (path.includes('/workflows/build.yml/runs')) {
        assert.ok(path.includes(`branch=v3&event=push&head_sha=${sourceSha}`));
        return { workflow_runs: run === null ? [] : [{ id: 10, head_sha: sourceSha, status: 'completed', conclusion: 'success', html_url: 'https://github.com/ci', ...run }] };
      }
      if (path.includes('/jobs?')) {
        const result = jobs ?? ['test', 'build', 'production-runtime'].map(name => ({ name, status: 'completed', conclusion: 'success' }));
        return { jobs: result, total_count: result.length };
      }
      if (path.includes('/statuses?')) return statuses[path.match(/deployments\/(\d+)/)[1]] ?? [{ state: 'success' }];
      if (path.includes('/deployments?')) return deployments;
      throw new Error(`Unexpected API request: ${path}`);
    },
  };
}

test('deploys exact tested source and a pinned configuration when no release exists', async () => {
  const { api } = fixture();
  const plan = await planDeployment(api, repository);
  assert.equal(plan.deploy, true);
  assert.equal(plan.source_sha, sourceSha);
  assert.equal(plan.config_ref, configRef);
  assert.equal(plan.config_sha, configSha);
});

for (const run of [null, { status: 'in_progress' }, { conclusion: 'failure' }, { conclusion: 'cancelled' }, { head_sha: 'wrong-sha' }]) {
  test(`does not deploy unverified CI: ${JSON.stringify(run)}`, async () => {
    const { api } = fixture({ run });
    assert.equal((await planDeployment(api, repository, { force: true })).deploy, false);
  });
}

test('a green workflow cannot bypass missing or skipped runtime checks', async () => {
  for (const conclusion of ['skipped', 'failure']) {
    const { api } = fixture({ jobs: ['test', 'build', 'production-runtime'].map(name => ({ name, status: 'completed', conclusion: name === 'production-runtime' ? conclusion : 'success' })) });
    assert.equal((await planDeployment(api, repository)).deploy, false);
  }
  assert.equal((await planDeployment(fixture({ jobs: [] }).api, repository)).deploy, false);
});

test('unchanged source and config are skipped, with an explicit force override', async () => {
  const { api } = fixture({ deployments: [{ id: 1, payload: { source_sha: sourceSha, config_sha: configSha } }] });
  assert.equal((await planDeployment(api, repository)).deploy, false);
  assert.equal((await planDeployment(api, repository, { force: true })).deploy, true);
});

test('configuration-only changes and new source commits deploy', async () => {
  for (const payload of [{ source_sha: sourceSha, config_sha: 'old' }, { source_sha: 'old', config_sha: configSha }]) {
    assert.equal((await planDeployment(fixture({ deployments: [{ id: 1, payload }] }).api, repository)).deploy, true);
  }
});

test('a previous failure is retried and never recorded as already deployed', async () => {
  const { api } = fixture({ deployments: [{ id: 2, payload: { source_sha: sourceSha, config_sha: configSha } }], statuses: { 2: [{ state: 'failure' }] } });
  assert.equal((await planDeployment(api, repository)).deploy, true);
});

test('an older matching release does not suppress returning from a newer different release', async () => {
  const { api } = fixture({ deployments: [
    { id: 2, payload: { source_sha: 'different', config_sha: configSha } },
    { id: 1, payload: { source_sha: sourceSha, config_sha: configSha } },
  ] });
  assert.equal((await planDeployment(api, repository)).deploy, true);
});

test('API failures fail closed', async () => {
  await assert.rejects(planDeployment(async () => { throw new Error('API unavailable'); }, repository), /API unavailable/);
});

test('records source provenance against a valid fork ref only after deployment', async () => {
  const calls = [];
  await recordDeployment(async (path, body) => { calls.push({ path, body }); return { id: 42 }; }, repository, {
    ref: 'fork-commit', sourceSha, configSha, logUrl: 'https://github.com/run',
  });
  assert.equal(calls[0].body.ref, 'fork-commit');
  assert.equal(calls[0].body.auto_merge, false);
  assert.deepEqual(calls[0].body.required_contexts, []);
  assert.deepEqual(calls[0].body.payload, { source_sha: sourceSha, config_sha: configSha });
  assert.equal(calls[1].path, `/repos/${repository}/deployments/42/statuses`);
  assert.equal(calls[1].body.state, 'success');
});
