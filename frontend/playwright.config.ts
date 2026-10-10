import { defineConfig, devices } from "@playwright/test";

const BACKEND_PORT = 8100;
const FRONTEND_PORT = 3100;
const E2E_DIR = "/tmp/ara-e2e";

// Deterministic offline mode: hash embeddings + mock LLM + SQLite. No network, no paid APIs.
const backendEnv = {
  APP_ENV: "development",
  DATABASE_URL: `sqlite+aiosqlite:///${E2E_DIR}/e2e.db`,
  STORAGE_LOCAL_DIR: `${E2E_DIR}/uploads`,
  EMBEDDING_PROVIDER: "hash",
  LLM_PROVIDER: "mock",
  JOB_RUNNER: "embedded",
  RATE_LIMIT_ENABLED: "false",
  RETRIEVAL_SCORE_THRESHOLD: "0.1",
  SECRET_KEY: "e2e-secret-key-e2e-secret-key-e2e-secret",
  CORS_ORIGINS: `http://localhost:${FRONTEND_PORT}`,
};

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${FRONTEND_PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "bash tests/e2e/start-backend.sh",
      env: backendEnv,
      url: `http://localhost:${BACKEND_PORT}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npm run build && npx next start -p ${FRONTEND_PORT}`,
      env: { BACKEND_URL: `http://localhost:${BACKEND_PORT}` },
      url: `http://localhost:${FRONTEND_PORT}/login`,
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
