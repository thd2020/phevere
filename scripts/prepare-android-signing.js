// Release runner only. Never print credential values or put them in command arguments.
const fs = require('node:fs');
const path = require('node:path');

function validateSigningInputs(env) {
  const required = ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD',
    'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD', 'ANDROID_SIGNING_CERT_SHA256'];
  for (const name of required) {
    if (!env[name]) throw new Error(`Missing signing input: ${name}`);
  }
  if (!/^[a-fA-F0-9]{64}$/.test(env.ANDROID_SIGNING_CERT_SHA256)) {
    throw new Error('ANDROID_SIGNING_CERT_SHA256 must be 64 hexadecimal characters');
  }
  const encoded = env.ANDROID_KEYSTORE_BASE64;
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || encoded.length > 48 * 1024 || bytes.toString('base64') !== encoded) {
    throw new Error('Invalid keystore base64 encoding or size');
  }
  return bytes;
}

function prepare(env) {
  const bytes = validateSigningInputs(env);
  if (!env.RUNNER_TEMP) throw new Error('RUNNER_TEMP is required');
  const destination = path.join(env.RUNNER_TEMP, 'phevere-release.jks');
  // Refuse to overwrite any previously provisioned material.
  fs.writeFileSync(destination, bytes, { mode: 0o600, flag: 'wx' });
}

module.exports = { validateSigningInputs };
if (require.main === module) {
  try { prepare(process.env); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
