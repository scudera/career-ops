#!/usr/bin/env node
// Cross-platform launcher for the Go TUI dashboard.
// Picks .exe on Windows, plain binary elsewhere. Auto-builds if missing.

import { existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { platform } from 'os';

const BIN_NAME = platform() === 'win32' ? 'career-ops-dash.exe' : 'career-ops-dash';
const BIN_PATH = `./${BIN_NAME}`;

if (!existsSync(BIN_PATH)) {
  console.error(`[dash] ${BIN_PATH} not found — building…`);
  const build = spawnSync('npm', ['run', 'dash:build'], { stdio: 'inherit', shell: true });
  if (build.status !== 0) {
    console.error('[dash] build failed — install Go (https://go.dev/dl/) and retry');
    process.exit(build.status ?? 1);
  }
}

const result = spawnSync(BIN_PATH, process.argv.slice(2), { stdio: 'inherit' });
process.exit(result.status ?? 0);
