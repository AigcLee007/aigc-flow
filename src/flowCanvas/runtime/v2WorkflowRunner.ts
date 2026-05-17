import { useFlowCanvasStore } from '../store/flowCanvasStore';
import type {
  FlowRuntimeAssetRef,
  FlowRuntimeNodeOutput,
} from '../types';
import {
  createWorkflowRun,
  getWorkflowRun,
  streamWorkflowRun,
  type GetWorkflowRunResponse,
  type V2NodeRunView,
  type V2WorkflowRunEventView,
  type V2WorkflowRunStatus,
  type WorkflowRunStreamHandle,
} from '../../services/v2WorkflowRunsApi';
import { getAssetDownloadUrl } from '../../services/v2AssetsApi';

const RUNNER_ENABLED = String(import.meta.env.VITE_USE_V2_WORKFLOW_RUNNER ?? 'true').toLowerCase() !== 'false';

let activeStreamHandle: WorkflowRunStreamHandle | null = null;
let activeRunToken = 0;

type AssetLike = {
  assetId: string;
  kind: string;
  mimeType: string;
  width?: number | null;
  height?: number | null;
};

function closeActiveStream(): void {
  activeStreamHandle?.close();
  activeStreamHandle = null;
}

function setRunError(message: string): void {
  useFlowCanvasStore.setState({
    isRunningBackendWorkflow: false,
    runError: message,
  });
}

function isAssetLike(value: unknown): value is AssetLike {
  return typeof value === 'object' && value !== null
    && typeof (value as AssetLike).assetId === 'string'
    && typeof (value as AssetLike).kind === 'string'
    && typeof (value as AssetLike).mimeType === 'string';
}

function mapNodeRunStatusToNodeStatus(status: V2WorkflowRunStatus): string {
  if (status === 'succeeded') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'canceled') return 'cancelled';
  return status;
}

function buildNodeOutput(outputJson: Record<string, unknown> | null, assetRefs: FlowRuntimeAssetRef[]): FlowRuntimeNodeOutput {
  const text = typeof outputJson?.text === 'string'
    ? outputJson.text
    : Array.isArray(outputJson?.results) && typeof outputJson.results[0] === 'string'
      ? String(outputJson.results[0])
      : null;

  const providerTask =
    outputJson?.providerTask && typeof outputJson.providerTask === 'object'
      ? (outputJson.providerTask as Record<string, unknown>)
      : null;

  return {
    assets: assetRefs,
    output: outputJson,
    providerTask,
    text,
  };
}

async function resolveAssetRefs(outputJson: Record<string, unknown> | null): Promise<FlowRuntimeAssetRef[]> {
  const assets = Array.isArray(outputJson?.assets) ? outputJson.assets : [];
  const result = await Promise.all(
    assets
      .filter(isAssetLike)
      .map(async (asset) => {
        const download = await getAssetDownloadUrl(asset.assetId);
        return {
          assetId: asset.assetId,
          downloadUrl: download.url,
          expiresAt: download.expiresAt,
          height: asset.height ?? null,
          kind: asset.kind,
          mimeType: asset.mimeType,
          width: asset.width ?? null,
        } satisfies FlowRuntimeAssetRef;
      }),
  );

  return result;
}

async function applyWorkflowRunSnapshot(snapshot: GetWorkflowRunResponse): Promise<void> {
  const nodeIdByNodeRunId: Record<string, string> = {};
  const nodeRunIdByNodeId: Record<string, string> = {};
  const nodeRunStatusByNodeId: Record<string, V2WorkflowRunStatus> = {};
  const nodeOutputByNodeId: Record<string, FlowRuntimeNodeOutput> = {};

  for (const nodeRun of snapshot.nodeRuns) {
    nodeIdByNodeRunId[nodeRun.id] = nodeRun.nodeId;
    nodeRunIdByNodeId[nodeRun.nodeId] = nodeRun.id;
    nodeRunStatusByNodeId[nodeRun.nodeId] = nodeRun.status;
    const assets = await resolveAssetRefs(nodeRun.outputJson);
    nodeOutputByNodeId[nodeRun.nodeId] = buildNodeOutput(nodeRun.outputJson, assets);
  }

  useFlowCanvasStore.setState((state) => ({
    currentRunId: snapshot.workflowRun.id,
    isRunningBackendWorkflow:
      snapshot.workflowRun.status !== 'succeeded'
      && snapshot.workflowRun.status !== 'failed'
      && snapshot.workflowRun.status !== 'canceled',
    nodeIdByNodeRunId,
    nodeOutputByNodeId,
    nodeRunIdByNodeId,
    nodeRunStatusByNodeId,
    runError:
      snapshot.workflowRun.errorJson && typeof snapshot.workflowRun.errorJson.message === 'string'
        ? snapshot.workflowRun.errorJson.message
        : state.runError,
    runStatus: snapshot.workflowRun.status,
  }));
}

function appendRunEvent(event: V2WorkflowRunEventView): void {
  useFlowCanvasStore.setState((state) => ({
    runEvents:
      state.runEvents.some((item) => item.sequence === event.sequence && item.id === event.id)
        ? state.runEvents
        : [...state.runEvents, event],
  }));
}

function deriveNodeId(event: V2WorkflowRunEventView): string | null {
  if (typeof event.payload.nodeId === 'string' && event.payload.nodeId.trim()) {
    return event.payload.nodeId;
  }

  const state = useFlowCanvasStore.getState();
  if (event.nodeRunId && state.nodeIdByNodeRunId[event.nodeRunId]) {
    return state.nodeIdByNodeRunId[event.nodeRunId];
  }

  return null;
}

function applyRunEvent(event: V2WorkflowRunEventView): void {
  appendRunEvent(event);

  const nodeId = deriveNodeId(event);
  const payloadStatus = typeof event.payload.status === 'string'
    ? event.payload.status as V2WorkflowRunStatus
    : null;

  if (nodeId && payloadStatus) {
    useFlowCanvasStore.setState((state) => ({
      nodeRunStatusByNodeId: {
        ...state.nodeRunStatusByNodeId,
        [nodeId]: payloadStatus,
      },
    }));
  }

  if (event.eventType === 'node.run.failed') {
    const message = typeof event.payload.message === 'string' ? event.payload.message : '节点执行失败';
    useFlowCanvasStore.setState((state) => ({
      nodeOutputByNodeId: nodeId
        ? {
            ...state.nodeOutputByNodeId,
            [nodeId]: {
              ...state.nodeOutputByNodeId[nodeId],
              errorMessage: message,
            },
          }
        : state.nodeOutputByNodeId,
    }));
  }

  if (event.eventType === 'workflow.run.succeeded') {
    useFlowCanvasStore.setState({
      isRunningBackendWorkflow: false,
      runStatus: 'succeeded',
    });
  } else if (event.eventType === 'workflow.run.failed') {
    useFlowCanvasStore.setState({
      isRunningBackendWorkflow: false,
      runError: typeof event.payload.message === 'string' ? event.payload.message : '工作流执行失败',
      runStatus: 'failed',
    });
  } else if (event.eventType === 'workflow.run.canceled') {
    useFlowCanvasStore.setState({
      isRunningBackendWorkflow: false,
      runStatus: 'canceled',
    });
  }
}

async function finalizeRun(runId: string, runToken: number): Promise<void> {
  if (runToken !== activeRunToken) {
    return;
  }

  const snapshot = await getWorkflowRun(runId);
  if (runToken !== activeRunToken) {
    return;
  }

  await applyWorkflowRunSnapshot(snapshot);
}

function buildRunLaunchError(message: string): Error {
  return new Error(message);
}

export async function runBackendWorkflow(): Promise<void> {
  if (!RUNNER_ENABLED) {
    throw buildRunLaunchError('当前环境已关闭 v2 workflow runner');
  }

  const state = useFlowCanvasStore.getState();
  if (!state.backendFlowId) {
    throw buildRunLaunchError('当前画布未绑定 v2 flowId，无法使用后端运行。请先打开已绑定并已发布的流程。');
  }

  activeRunToken += 1;
  const currentRunToken = activeRunToken;
  closeActiveStream();

  useFlowCanvasStore.setState({
    currentRunId: null,
    isRunningBackendWorkflow: true,
    nodeOutputByNodeId: {},
    nodeRunIdByNodeId: {},
    nodeRunStatusByNodeId: {},
    nodeIdByNodeRunId: {},
    runError: null,
    runEvents: [],
    runStatus: 'pending',
  });

  try {
    const created = await createWorkflowRun(state.backendFlowId, {
      idempotencyKey: `flow-canvas:${state.backendFlowId}:${Date.now()}`,
      input: {},
    });

    if (currentRunToken !== activeRunToken) {
      return;
    }

    useFlowCanvasStore.setState({
      currentRunId: created.runId,
      runStatus: created.status,
    });

    const snapshot = await getWorkflowRun(created.runId);
    if (currentRunToken !== activeRunToken) {
      return;
    }
    await applyWorkflowRunSnapshot(snapshot);

    const lastSequence = useFlowCanvasStore.getState().runEvents.at(-1)?.sequence;
    activeStreamHandle = streamWorkflowRun(created.runId, {
      afterSequence: lastSequence,
      onClose: () => {
        if (currentRunToken !== activeRunToken) {
          return;
        }
        void finalizeRun(created.runId, currentRunToken);
      },
      onError: (error) => {
        if (currentRunToken !== activeRunToken) {
          return;
        }
        setRunError(error.message || '工作流事件流连接失败');
      },
      onEvent: (event) => {
        if (currentRunToken !== activeRunToken) {
          return;
        }
        applyRunEvent(event);
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '启动后端工作流失败';
    setRunError(message);
    throw error instanceof Error ? error : new Error(message);
  }
}

export function disposeBackendWorkflowRunStream(): void {
  activeRunToken += 1;
  closeActiveStream();
}

export function isBackendWorkflowRunnerEnabled(): boolean {
  return RUNNER_ENABLED;
}

export function getRuntimeNodeStatus(nodeId: string, fallbackStatus: string): string {
  const status = useFlowCanvasStore.getState().nodeRunStatusByNodeId[nodeId];
  return status ? mapNodeRunStatusToNodeStatus(status) : fallbackStatus;
}
