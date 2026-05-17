import { getAuthorizedV2Headers } from './accountIdentity';

const API_BASE_URL = '/api';

const cleanUrl = (url: string) => url.replace(/\/$/, '');

export type V2WorkflowRunStatus =
  | 'pending'
  | 'runnable'
  | 'running'
  | 'waiting_provider'
  | 'succeeded'
  | 'failed'
  | 'canceled';

export interface V2WorkflowRunView {
  canceledAt: string | null;
  createdAt: string;
  createdBy: string | null;
  errorJson: Record<string, unknown> | null;
  finishedAt: string | null;
  flowId: string;
  flowVersionId: string;
  id: string;
  idempotencyKey: string | null;
  inputJson: Record<string, unknown>;
  outputJson: Record<string, unknown> | null;
  startedAt: string | null;
  status: V2WorkflowRunStatus;
  tenantId: string;
  updatedAt: string;
}

export interface V2NodeRunView {
  attempt: number;
  costJson: Record<string, unknown>;
  createdAt: string;
  errorJson: Record<string, unknown> | null;
  finishedAt: string | null;
  id: string;
  inputJson: Record<string, unknown>;
  maxAttempts: number;
  nodeId: string;
  nodeType: string;
  outputJson: Record<string, unknown> | null;
  providerTaskId: string | null;
  startedAt: string | null;
  status: V2WorkflowRunStatus;
  tenantId: string;
  updatedAt: string;
  workflowRunId: string;
}

export interface V2WorkflowRunEventView {
  createdAt: string;
  eventType: string;
  id: string;
  nodeRunId: string | null;
  payload: Record<string, unknown>;
  sequence: number;
  tenantId: string;
  workflowRunId: string;
}

export interface CreateWorkflowRunResponse {
  runId: string;
  status: V2WorkflowRunStatus;
}

export interface GetWorkflowRunResponse {
  nodeRuns: V2NodeRunView[];
  workflowRun: V2WorkflowRunView;
}

export interface StreamWorkflowRunOptions {
  afterSequence?: number;
  lastEventId?: number | string;
  onClose?: () => void;
  onError?: (error: Error) => void;
  onEvent?: (event: V2WorkflowRunEventView) => void;
  signal?: AbortSignal;
}

export interface WorkflowRunStreamHandle {
  close: () => void;
}

type ErrorEnvelope = {
  error?: {
    code?: string;
    details?: unknown;
    message?: string;
    requestId?: string;
  };
};

type SseEnvelope = {
  data: string;
  event: string;
  id: string | null;
};

export class V2ApiError extends Error {
  code?: string;
  details?: unknown;
  requestId?: string;
  status?: number;

  constructor(
    message: string,
    options?: {
      code?: string;
      details?: unknown;
      requestId?: string;
      status?: number;
    },
  ) {
    super(message);
    this.name = 'V2ApiError';
    this.code = options?.code;
    this.details = options?.details;
    this.requestId = options?.requestId;
    this.status = options?.status;
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & ErrorEnvelope;
  if (!response.ok) {
    throw new V2ApiError(
      payload.error?.message || `Request failed with status ${response.status}`,
      {
        code: payload.error?.code,
        details: payload.error?.details,
        requestId: payload.error?.requestId,
        status: response.status,
      },
    );
  }

  return payload as T;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function parseSseBuffer(
  incoming: string,
  state: { buffer: string },
  onEnvelope: (envelope: SseEnvelope) => void,
): void {
  state.buffer += incoming;

  while (true) {
    const separatorIndex = state.buffer.indexOf('\n\n');
    if (separatorIndex === -1) {
      return;
    }

    const rawEvent = state.buffer.slice(0, separatorIndex);
    state.buffer = state.buffer.slice(separatorIndex + 2);

    if (!rawEvent.trim() || rawEvent.startsWith(':')) {
      continue;
    }

    let event = 'message';
    let id: string | null = null;
    const dataLines: string[] = [];

    for (const line of rawEvent.split('\n')) {
      if (!line || line.startsWith(':')) {
        continue;
      }

      const separator = line.indexOf(':');
      const field = separator === -1 ? line : line.slice(0, separator);
      const value = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /, '');

      if (field === 'event') {
        event = value;
      } else if (field === 'id') {
        id = value;
      } else if (field === 'data') {
        dataLines.push(value);
      }
    }

    onEnvelope({
      data: dataLines.join('\n'),
      event,
      id,
    });
  }
}

function decodeWorkflowRunEvent(envelope: SseEnvelope): V2WorkflowRunEventView | null {
  if (!envelope.data.trim()) {
    return null;
  }

  const parsed = JSON.parse(envelope.data) as Record<string, unknown>;

  return {
    createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
    eventType: envelope.event || String(parsed.eventType || ''),
    id: String(parsed.id || envelope.id || ''),
    nodeRunId: parsed.nodeRunId ? String(parsed.nodeRunId) : null,
    payload:
      parsed.payload && typeof parsed.payload === 'object'
        ? (parsed.payload as Record<string, unknown>)
        : parsed,
    sequence:
      typeof parsed.sequence === 'number'
        ? parsed.sequence
        : Number.parseInt(String(envelope.id || '0'), 10) || 0,
    tenantId: typeof parsed.tenantId === 'string' ? parsed.tenantId : '',
    workflowRunId: typeof parsed.workflowRunId === 'string' ? parsed.workflowRunId : '',
  };
}

export async function createWorkflowRun(
  flowId: string,
  input?: {
    idempotencyKey?: string;
    input?: Record<string, unknown>;
  },
): Promise<CreateWorkflowRunResponse> {
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/v2/flows/${flowId}/runs`, {
    method: 'POST',
    headers: {
      ...(await getAuthorizedV2Headers()),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idempotencyKey: input?.idempotencyKey,
      input: input?.input || {},
    }),
  });

  return parseJsonResponse<CreateWorkflowRunResponse>(response);
}

export async function getWorkflowRun(runId: string): Promise<GetWorkflowRunResponse> {
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/v2/workflow-runs/${runId}`, {
    method: 'GET',
    headers: {
      ...(await getAuthorizedV2Headers()),
      'Content-Type': 'application/json',
    },
  });

  return parseJsonResponse<GetWorkflowRunResponse>(response);
}

export async function getWorkflowRunEvents(
  runId: string,
  afterSequence?: number,
): Promise<V2WorkflowRunEventView[]> {
  const params = new URLSearchParams();
  if (typeof afterSequence === 'number' && afterSequence >= 0) {
    params.set('afterSequence', String(afterSequence));
  }

  const response = await fetch(
    `${cleanUrl(API_BASE_URL)}/v2/workflow-runs/${runId}/events${params.toString() ? `?${params.toString()}` : ''}`,
    {
      method: 'GET',
      headers: {
        ...(await getAuthorizedV2Headers()),
        'Content-Type': 'application/json',
      },
    },
  );

  return parseJsonResponse<V2WorkflowRunEventView[]>(response);
}

export function streamWorkflowRun(
  runId: string,
  options: StreamWorkflowRunOptions = {},
): WorkflowRunStreamHandle {
  const controller = new AbortController();
  let closed = false;

  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    controller.abort();
    options.onClose?.();
  };

  if (options.signal) {
    if (options.signal.aborted) {
      close();
      return { close };
    }
    options.signal.addEventListener('abort', close, { once: true });
  }

  void (async () => {
    try {
      const params = new URLSearchParams();
      if (typeof options.afterSequence === 'number' && options.afterSequence >= 0) {
        params.set('afterSequence', String(options.afterSequence));
      }

      const headers: Record<string, string> = {
        ...(await getAuthorizedV2Headers()),
        Accept: 'text/event-stream',
      };

      if (options.afterSequence === undefined && options.lastEventId !== undefined) {
        headers['Last-Event-ID'] = String(options.lastEventId);
      }

      const response = await fetch(
        `${cleanUrl(API_BASE_URL)}/v2/workflow-runs/${runId}/stream${params.toString() ? `?${params.toString()}` : ''}`,
        {
          method: 'GET',
          headers,
          signal: controller.signal,
        },
      );

      if (!response.ok || !response.body) {
        await parseJsonResponse<never>(response);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parserState = { buffer: '' };

      while (!closed) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        parseSseBuffer(decoder.decode(value, { stream: true }), parserState, (envelope) => {
          const event = decodeWorkflowRunEvent(envelope);
          if (event) {
            options.onEvent?.(event);
          }
        });
      }

      if (!closed) {
        close();
      }
    } catch (error) {
      if (closed || isAbortError(error)) {
        return;
      }

      options.onError?.(
        error instanceof Error ? error : new Error('Workflow run stream failed'),
      );
      close();
    }
  })();

  return { close };
}
