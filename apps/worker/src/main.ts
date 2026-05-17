const DEFAULT_WORKER_NAME = "aigc-flow-v2-worker";

function main() {
  const workerName = process.env.WORKER_NAME || DEFAULT_WORKER_NAME;
  console.log(`[v2-worker] ${workerName} ready`);
  if (process.env.WORKER_ONESHOT === "true") {
    return;
  }
  process.stdin.resume();
}

main();
