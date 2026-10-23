const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../.github/workflows/android-candidate.yml'), 'utf8');
const workflow = yaml.load(source);
assert.deepEqual(workflow.permissions, { contents: 'read' });
assert.deepEqual(Object.keys(workflow.jobs), ['android-candidate']);
const job = workflow.jobs['android-candidate'];
for (const [repository, ref, expected] of [
  ['thd2020/phevere', 'refs/heads/codex/notebook-csv-android-20261023', true],
  ['thd2020/phevere', 'refs/heads/main', false],
  ['other/fork', 'refs/heads/codex/notebook-csv-android-20261023', false],
]) assert.equal(vm.runInNewContext(job.if, { github: { repository, ref } }), expected);
assert.doesNotMatch(source, /contents: write|gh release|action-gh-release|--licenses|yes\s*\|/);
const uploads = job.steps.filter((step) => step.uses?.startsWith('actions/upload-artifact@'));
assert.equal(uploads.length, 1);
assert.equal(uploads[0].with.path, 'android-candidate/');
for (const step of job.steps) {
  if (JSON.stringify(step.env || {}).includes('secrets.')) {
    assert.ok(['Prepare signing', 'Build signed APK'].includes(step.name));
  }
}
assert.equal(job.steps.find((step) => step.name === 'Remove temporary key').if, "always() && steps.signing.outcome == 'success'");
console.log('Android candidate workflow passed: trusted branch only, read-only repository permission, isolated artifact path, no release publication or license acceptance.');
