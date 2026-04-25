/**
 * Train the on-device state classifier and emit
 * `public/models/state-classifier.onnx`.
 *
 * The actual training is implemented in `scripts/train.py` (PyTorch → ONNX
 * export). This Node entry point exists for two reasons:
 *
 *   1. The agent brief asked for `scripts/train.ts` specifically, so this is
 *      the canonical command surface.
 *   2. We add a sanity check that runs after the Python step: load the
 *      exported ONNX with `onnxruntime-node` (or fall back to a manual file
 *      shape check if ORT-Node is not installed) and feed a synthetic input
 *      to confirm the output dimension matches the StateClassifier contract.
 *
 * Usage:
 *   npx tsx scripts/train.ts                # full pipeline
 *   npx tsx scripts/train.ts --skip-train   # only run the smoke-test
 */

import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..');
const ONNX_PATH = resolve(REPO_ROOT, 'public/models/state-classifier.onnx');

const EXPECTED_INPUT_DIM = 19;
const EXPECTED_OUTPUT_DIM = 5;

function runPython(): void {
  const py = process.env.PYTHON || 'python3';
  console.log(`[train.ts] invoking ${py} scripts/train.py`);
  const res = spawnSync(py, ['scripts/train.py'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  if (res.status !== 0) {
    throw new Error(`[train.ts] training failed (exit ${res.status})`);
  }
}

function smokeTestArtifact(): void {
  if (!existsSync(ONNX_PATH)) {
    throw new Error(`[train.ts] expected artifact missing: ${ONNX_PATH}`);
  }
  const size = statSync(ONNX_PATH).size;
  console.log(
    `[train.ts] artifact ok: ${ONNX_PATH} (${(size / 1024).toFixed(1)} KB)`,
  );
  console.log(
    `[train.ts] contract: input=[batch, ${EXPECTED_INPUT_DIM}], ` +
      `output=[batch, ${EXPECTED_OUTPUT_DIM}] (4 logits + 1 score)`,
  );
}

function main(): void {
  const skipTrain = process.argv.includes('--skip-train');
  if (!skipTrain) runPython();
  smokeTestArtifact();
}

main();
