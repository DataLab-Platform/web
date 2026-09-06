import type { ProcessingPreviewResult, RuntimeApi } from "./runtime";

export interface ProcessingPreviewRequest {
  featureId: string;
  sourceId: string;
  params: Record<string, unknown>;
  reuseResult?: boolean;
}

export type ProcessingPreviewState =
  | { status: "idle" | "computing" }
  | {
      status: "result";
      result: ProcessingPreviewResult;
      current: boolean;
    }
  | { status: "error"; error: string };

interface QueuedRequest extends ProcessingPreviewRequest {
  id: number;
  epoch: number;
  revision: number;
  previewToken: string | null;
}

let nextPreviewToken = 1;

function createPreviewToken(): string {
  return `preview-${Date.now().toString(36)}-${nextPreviewToken++}`;
}

function cloneParams(values: Record<string, unknown>): Record<string, unknown> {
  if (typeof structuredClone === "function") return structuredClone(values);
  return JSON.parse(JSON.stringify(values)) as Record<string, unknown>;
}

interface CoordinatedRequest {
  owner: ProcessingPreviewController;
  run: () => Promise<void>;
  drop: () => void;
}

class ProcessingPreviewCoordinator {
  private active: CoordinatedRequest | null = null;
  private pending: CoordinatedRequest | null = null;

  submit(request: CoordinatedRequest): void {
    const replaced = this.pending;
    this.pending = request;
    replaced?.drop();
    this.pump();
  }

  cancelPending(owner: ProcessingPreviewController): void {
    if (this.pending?.owner === owner) this.pending = null;
  }

  private pump(): void {
    if (this.active || !this.pending) return;
    const request = this.pending;
    this.pending = null;
    this.active = request;
    void request
      .run()
      .catch(() => undefined)
      .finally(() => {
        if (this.active === request) this.active = null;
        this.pump();
      });
  }
}

const coordinators = new WeakMap<object, ProcessingPreviewCoordinator>();

function coordinatorFor(runtime: RuntimeApi): ProcessingPreviewCoordinator {
  const key = runtime as object;
  let coordinator = coordinators.get(key);
  if (!coordinator) {
    coordinator = new ProcessingPreviewCoordinator();
    coordinators.set(key, coordinator);
  }
  return coordinator;
}

export class ProcessingPreviewController {
  private enabled = false;
  private targetSourceId: string | null = null;
  private nextId = 1;
  private epoch = 0;
  private revision = 0;
  private currentResult: Pick<
    QueuedRequest,
    "previewToken" | "epoch" | "revision"
  > | null = null;
  private readonly coordinator: ProcessingPreviewCoordinator;

  constructor(
    private readonly onState: (state: ProcessingPreviewState) => void,
    private readonly runtime: Pick<
      RuntimeApi,
      "previewFeature" | "releasePreviewResult"
    >,
  ) {
    this.coordinator = coordinatorFor(runtime as RuntimeApi);
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.invalidateSession();
      this.onState({ status: "idle" });
    }
  }

  markDirty(): void {
    this.releaseCurrentResult();
    this.revision += 1;
    this.coordinator.cancelPending(this);
  }

  invalidate(): void {
    this.releaseCurrentResult();
    this.epoch += 1;
    this.revision += 1;
    this.coordinator.cancelPending(this);
  }

  invalidateSource(): void {
    this.invalidate();
  }

  request(request: ProcessingPreviewRequest): void {
    if (!this.enabled) return;
    this.releaseCurrentResult();
    if (this.targetSourceId !== request.sourceId) {
      this.epoch += 1;
      this.targetSourceId = request.sourceId;
    }
    this.revision += 1;
    const queued: QueuedRequest = {
      ...request,
      params: cloneParams(request.params),
      id: this.nextId++,
      epoch: this.epoch,
      revision: this.revision,
      previewToken: request.reuseResult === false ? null : createPreviewToken(),
    };
    this.onState({ status: "computing" });
    this.coordinator.submit({
      owner: this,
      run: () => this.run(queued),
      drop: () => this.handleDropped(queued),
    });
  }

  close(): void {
    this.enabled = false;
    this.invalidateSession();
  }

  private async run(request: QueuedRequest): Promise<void> {
    try {
      const result = await this.runtime.previewFeature(
        request.featureId,
        request.sourceId,
        request.params,
        request.previewToken,
      );
      const sameEpoch = this.enabled && request.epoch === this.epoch;
      if (!sameEpoch) {
        this.releaseToken(request.previewToken);
        return;
      }
      const current = request.revision === this.revision;
      if (current && request.previewToken !== null) {
        this.currentResult = request;
      } else {
        this.releaseToken(request.previewToken);
      }
      this.onState({
        status: "result",
        result,
        current,
      });
    } catch (error) {
      this.releaseToken(request.previewToken);
      const current =
        this.enabled &&
        request.epoch === this.epoch &&
        request.revision === this.revision;
      if (current) {
        this.onState({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private handleDropped(request: QueuedRequest): void {
    const current =
      this.enabled &&
      request.epoch === this.epoch &&
      request.revision === this.revision;
    if (current) this.onState({ status: "idle" });
  }

  private invalidateSession(): void {
    this.releaseCurrentResult();
    this.epoch += 1;
    this.revision += 1;
    this.targetSourceId = null;
    this.coordinator.cancelPending(this);
  }

  takeCurrentResult(): string | null {
    const candidate = this.currentResult;
    this.currentResult = null;
    if (
      !this.enabled ||
      candidate === null ||
      candidate.epoch !== this.epoch ||
      candidate.revision !== this.revision
    ) {
      this.releaseToken(candidate?.previewToken ?? null);
      return null;
    }
    return candidate.previewToken;
  }

  private releaseCurrentResult(): void {
    const token = this.currentResult?.previewToken ?? null;
    this.currentResult = null;
    this.releaseToken(token);
  }

  private releaseToken(token: string | null): void {
    if (token === null) return;
    void this.runtime.releasePreviewResult(token).catch(() => undefined);
  }
}
