import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Client } from 'pg';

const TEST_JWT_SECRETS = {
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
};

export default async function globalSetup(): Promise<void> {
  // Before .env: loadEnvFile does not override a variable that is already set,
  // so LOG_LEVEL from .env is ignored and only the shell can turn logs on
  process.env.LOG_LEVEL ??= 'silent';
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }

  const adminUrl = new URL(
    process.env.DATABASE_URL ??
      'postgresql://booking:booking@localhost:5432/booking',
  );
  const testDatabase = `${adminUrl.pathname.slice(1)}_test`;
  const testUrl = new URL(adminUrl);
  testUrl.pathname = `/${testDatabase}`;

  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${testDatabase}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${testDatabase}"`);
  } finally {
    await admin.end();
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
    stdio: 'pipe',
  });

  process.env.DATABASE_URL = testUrl.toString();
  process.env.NODE_ENV = 'test';
  for (const [name, value] of Object.entries(TEST_JWT_SECRETS)) {
    process.env[name] ??= value;
  }
}
