export type WorkerLogFields = Record<string, unknown>;

export type WorkerLogger = {
  error: (fields: WorkerLogFields, message: string) => void;
  info: (fields: WorkerLogFields, message: string) => void;
};

function writeLog(level: "error" | "info", fields: WorkerLogFields, message: string): void {
  const entry = {
    level,
    message,
    service: "aigc-flow-v2-worker",
    timestamp: new Date().toISOString(),
    ...fields,
  };

  const serialized = JSON.stringify(entry);
  if (level === "error") {
    console.error(serialized);
    return;
  }

  console.log(serialized);
}

export function createConsoleWorkerLogger(): WorkerLogger {
  return {
    error(fields, message) {
      writeLog("error", fields, message);
    },
    info(fields, message) {
      writeLog("info", fields, message);
    },
  };
}
