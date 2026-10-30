/* Run: node scripts/test-android-release.js. No keystores or credentials are created. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const yaml = require('js-yaml');
const { validateSigningInputs } = require('./prepare-android-signing');

const fixture = {
  ANDROID_KEYSTORE_BASE64: Buffer.from('synthetic bytes, not a key').toString('base64'),
  ANDROID_KEYSTORE_PASSWORD: 'synthetic-only', ANDROID_KEY_ALIAS: 'synthetic',
  ANDROID_KEY_PASSWORD: 'synthetic-only', ANDROID_SIGNING_CERT_SHA256: 'a'.repeat(64),
};
assert.equal(validateSigningInputs(fixture).toString(), 'synthetic bytes, not a key');
let rejected = 0;
for (const name of Object.keys(fixture)) {
  for (const value of [undefined, '']) {
    assert.throws(() => validateSigningInputs({ ...fixture, [name]: value }), /Missing signing input/);
    rejected++;
  }
}
for (const value of ['bad!', 'Zg', 'Zg==\n', '====', Buffer.alloc(37000).toString('base64')]) {
  assert.throws(() => validateSigningInputs({ ...fixture, ANDROID_KEYSTORE_BASE64: value }), /Invalid keystore/);
  rejected++;
}
for (const value of ['a'.repeat(63), 'z'.repeat(64), 'aa:bb']) {
  assert.throws(() => validateSigningInputs({ ...fixture, ANDROID_SIGNING_CERT_SHA256: value }), /64 hexadecimal/);
  rejected++;
}

const root = path.join(__dirname, '..');
const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8'));
const jobs = Object.entries(workflow.jobs);
const expected = {
  all: jobs.map(([name]) => name),
  desktop: ['release', 'release-win-arm64', 'release-mac', 'release-linux'],
  phone: ['release-android', 'release-ios'],
  android: ['release-android'],
  'windows-x64': ['release'],
  'windows-arm64': ['release-win-arm64'],
  linux: ['release-linux'],
  invalid: [],
};
let selections = 0;
for (const ref_type of ['branch', 'tag']) for (const [targets, names] of Object.entries(expected)) {
  const github = { ref_type, event_name: 'workflow_dispatch', event: { inputs: { targets } } };
  const selected = jobs.filter(([, job]) => vm.runInNewContext(job.if, { github })).map(([name]) => name);
  assert.deepEqual(selected, names, `dispatch ${targets} from ${ref_type}`);
  selections++;
}
const tagged = { ref_type: 'tag', event_name: 'push', event: { inputs: {} } };
assert.ok(jobs.every(([, job]) => vm.runInNewContext(job.if, { github: tagged })));
const android = workflow.jobs['release-android'];
const names = android.steps.map((step) => step.name);
const before = (a, b) => assert.ok(names.indexOf(a) >= 0 && names.indexOf(a) < names.indexOf(b), `${a} must precede ${b}`);
before('Prepare release signing', 'Build Android APK');
before('Verify signing identity and preserve previous APK', 'Remove existing asset with the same name');
before('Retain Android rollback copy', 'Remove existing asset with the same name');
before('Upgrade the previous release in place on an emulator', 'Remove existing asset with the same name');
const build = android.steps.find((step) => step.name === 'Build Android APK');
assert.match(build.run, /assembleRelease/);
assert.doesNotMatch(build.run, /assembleDebug/);
assert.match(build.run, /outputs\/apk\/release\/app-release.apk/);
const cleanup = android.steps.find((step) => step.name === 'Remove temporary signing material');
assert.equal(cleanup.if, "always() && steps.signing.outcome == 'success'");
assert.deepEqual(workflow.permissions, { contents: 'read' });
assert.deepEqual(android.permissions, { contents: 'write', 'id-token': 'write', attestations: 'write' });
const gradle = fs.readFileSync(path.join(root, 'apps/mobile/android/app/build.gradle'), 'utf8');
assert.match(gradle, /signingConfig signingConfigs.release/);
assert.match(gradle, /name == 'preReleaseBuild' \|\| name == 'validateSigningRelease'/);
assert.match(gradle, /dependsOn validateReleaseCredentials/);
console.log(`Android release configuration passed: ${rejected} invalid signing-input cases, ${selections} dispatch selections, tag selection and static release guards. Gradle/native signing not executed.`);
