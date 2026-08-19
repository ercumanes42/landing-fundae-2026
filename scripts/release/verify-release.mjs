import { spawnSync } from 'node:child_process';

const expectedNode = 'v22.18.0';
const expectedNpm = '11.11.0';
const npmCli = process.env.npm_execpath;
const npmCommand = npmCli ? process.execPath : process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'npm';

const staticDashboardCredentialStore = JSON.stringify({
  version: 1,
  kdf: { name: 'PBKDF2-SHA256', iterations: 600_000 },
  identities: [{
    username: 'ci-release-auditor',
    credentials: [{
      key_id: 'static-fixture',
      salt: 'AQEBAQEBAQEBAQEBAQEBAQ',
      digest: 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI',
    }],
  }],
});

const staticReadinessEnvironment = {
  SUPABASE_URL: 'https://ci-contract.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_ci_contract_2f48a65c79d34896b1',
  LEAD_HASH_SECRET: 'ci_contract_lead_hash_a1f4c9e8d3b76250',
  DATA_BRAIN_ADMIN_USER: 'ci-release-auditor',
  DATA_BRAIN_ADMIN_PASSWORD: 'ci_contract_admin_84f2d7c19a63',
  DATA_BRAIN_AUTH_CREDENTIALS: staticDashboardCredentialStore,
  DATA_BRAIN_AUTH_PEPPER: 'ci_contract_auth_pepper_4d8f27a19b63c50e',
  DATA_BRAIN_LEGACY_BASIC_ENABLED: 'false',
  DATA_BRAIN_AUTH_MAX_ATTEMPTS: '5',
  DATA_BRAIN_AUTH_WINDOW_SECONDS: '300',
  LANDING_ALLOWED_ORIGINS: 'https://landing-ci.invalid',
  CAMPAIGN_IMPORT_SECRET: 'ci_contract_campaign_7639a1f4d8b250ec',
  MAKE_WEBHOOK_SECRET: 'ci_contract_make_f82d61a739c40e5b',
  UNSUBSCRIBE_TOKEN_SECRET: 'ci_contract_unsubscribe_5d91f47a2c6380eb',
  UNSUBSCRIBE_PUBLIC_BASE_URL: 'https://data-ci.invalid',
  OUTBOUND_MASTER_ENABLED: 'false',
  LEGACY_MAKE_DELIVERY_ENABLED: 'false',
  LEGACY_DELIVERY_RETRY_ENABLED: 'false',
  MAILBOX_IDENTITY_HASH: 'a'.repeat(64),
  TRANSACTIONAL_OUTLOOK_ENABLED: 'false',
  COLD_CAMPAIGN_ENABLED: 'false',
  COLD_CAMPAIGN_PROVISIONING_ENABLED: 'false',
  HUBSPOT_SYNC_ENABLED: 'false',
  OPERATIONAL_OBSERVABILITY_ENABLED: 'false',
  TRANSACTIONAL_PILOT_MODE: 'true',
  TRANSACTIONAL_PILOT_ALLOWLIST_LEAD_IDS: 'b'.repeat(64),
  TRANSACTIONAL_LANDING_ORIGIN: 'https://landing-ci.invalid',
  TRANSACTIONAL_WEBINAR_TITLE: 'CI contract fixture',
  TRANSACTIONAL_WEBINAR_START_AT: '2030-01-15T09:00:00+01:00',
  TRANSACTIONAL_WEBINAR_DURATION_MINUTES: '45',
  TRANSACTIONAL_WEBINAR_TIMEZONE: 'Europe/Madrid',
  TRANSACTIONAL_WEBINAR_ACCESS_NOTE: 'No live access; validation fixture only',
  MAKE_WEBHOOK_URL: '',
};

function npmArgs(args) {
  if (npmCli) return [npmCli, ...args];
  if (process.platform === 'win32') return ['/d', '/s', '/c', ['npm.cmd', ...args].join(' ')];
  return args;
}

function execute(label, command, args, extraEnv = {}) {
  console.log(`\n[release] ${label}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function output(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout.trim();
}

const npmVersion = output(npmCommand, npmArgs(['--version']));
if (process.version !== expectedNode || npmVersion !== expectedNpm) {
  console.error(`[release] toolchain mismatch: expected Node ${expectedNode}/npm ${expectedNpm}; got ${process.version}/npm ${npmVersion}`);
  process.exit(1);
}

execute('reviewed GitHub Actions pins', process.execPath, ['scripts/release/verify-ci-pins.mjs']);
execute('release core manifest (local policy)', process.execPath, ['scripts/release/verify-manifest.mjs']);
execute('landing unit tests', npmCommand, npmArgs(['run', 'test:unit']));
execute('landing typecheck', npmCommand, npmArgs(['run', 'lint']));
execute('automation static tests', npmCommand, npmArgs(['run', 'test:automation']));
execute('landing E2E with a fresh preview server', npmCommand, npmArgs(['run', 'test:e2e']), {
  CI: '1',
  RELEASE_FRESH_SERVER: '1',
});
execute('Data Brain tests', npmCommand, npmArgs(['--prefix', 'data-brain', 'run', 'test']));
execute('Data Brain setup tests', npmCommand, npmArgs(['--prefix', 'data-brain', 'run', 'test:setup']));
execute('Data Brain typecheck', npmCommand, npmArgs(['--prefix', 'data-brain', 'run', 'lint']));
execute('Data Brain build', npmCommand, npmArgs(['--prefix', 'data-brain', 'run', 'build']));
execute(
  'Data Brain STATIC_FIXTURE verification (zero network; does not satisfy G2)',
  npmCommand,
  npmArgs(['--prefix', 'data-brain', 'run', 'db:verify']),
  staticReadinessEnvironment,
);

console.log('\n[release] all local, non-live/static gates passed');
console.log('[release] NETWORK_G2, CI execution, packaging and live release remain unverified.');
