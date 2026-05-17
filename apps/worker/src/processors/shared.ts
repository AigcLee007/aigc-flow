export type ProcessorResult = {
  jobId: string | null;
  queueName: string;
  status: "no-op" | "ok";
  tenantId: string;
  traceId: string | null;
};
