import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  createWorkflowRun,
  streamWorkflowRun,
} from './v2WorkflowRunsApi';

vi.mock('./accountIdentity', () => ({
  getAuthorizedV2Headers: vi.fn(async () => ({
    Authorization: 'Bearer test-token',
  })),
}));

describe('v2WorkflowRunsApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('createWorkflowRun sends the expected v2 request', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          runId: 'run-123',
          status: 'pending',
        }),
        {
          status: 201,
          headers: {
            'content-type': 'application/json',
          },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await createWorkflowRun('flow-123', {
      idempotencyKey: 'key-1',
      input: {
        prompt: 'hello',
      },
    });

    expect(result).toEqual({
      runId: 'run-123',
      status: 'pending',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v2/flows/flow-123/runs',
      expect.objectContaining({
        body: JSON.stringify({
          idempotencyKey: 'key-1',
          input: {
            prompt: 'hello',
          },
        }),
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        }),
        method: 'POST',
      }),
    );
  });

  test('streamWorkflowRun parses SSE events and forwards Last-Event-ID', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'id: 7',
              'event: node.run.runnable',
              'data: {"createdAt":"2026-05-17T00:00:00.000Z","eventType":"node.run.runnable","id":"evt-7","nodeRunId":"node-run-1","payload":{"nodeId":"node-1","status":"runnable"},"sequence":7,"tenantId":"tenant-1","workflowRunId":"run-7"}',
              '',
              '',
            ].join('\n'),
          ),
        );
        controller.close();
      },
    });

    const fetchMock = vi.fn(async () =>
      new Response(body, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const received: Array<{ eventType: string; sequence: number }> = [];

    await new Promise<void>((resolve) => {
      streamWorkflowRun('run-7', {
        lastEventId: 6,
        onClose: resolve,
        onEvent: (event) => {
          received.push({
            eventType: event.eventType,
            sequence: event.sequence,
          });
        },
      });
    });

    expect(received).toEqual([
      {
        eventType: 'node.run.runnable',
        sequence: 7,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v2/workflow-runs/run-7/stream',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'text/event-stream',
          Authorization: 'Bearer test-token',
          'Last-Event-ID': '6',
        }),
        method: 'GET',
      }),
    );
  });
});
