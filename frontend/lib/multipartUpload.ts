import {
  abortMultipartUpload,
  acknowledgeMultipartPart,
  completeMultipartUpload,
  fetchMultipartUploadStatus,
  initiateMultipartUpload,
  presignMultipartPart,
  type MultipartCompletedDto,
  type MultipartInitiatedDto,
} from "./api";
import { putDocumentBytes, UploadCancelledError } from "./documentUpload";

/** Files at or above this size use the resumable protocol; smaller ones keep the single PUT. */
export const MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024;

/** Client fallback plan; the server always answers with the authoritative plan. */
export const DEFAULT_PART_SIZE_BYTES = 8 * 1024 * 1024;

/** Per-part attempts before the upload fails with a clear message. */
export const PART_MAX_ATTEMPTS = 3;

const BASE_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 8_000;
const RESUME_PREFIX = "awap.upload.";

/** One planned part: its number and the exact byte range it covers. */
export interface PartPlan {
  partNumber: number;
  start: number;
  end: number;
  size: number;
}

/**
 * Splits a file into parts that cover it exactly once: every byte belongs to one part, the last one
 * carries the remainder, and an empty file yields no parts at all.
 */
export function planParts(totalSize: number, partSize: number): PartPlan[] {
  if (!Number.isFinite(totalSize) || totalSize <= 0) {
    return [];
  }
  const size = Math.max(1, Math.floor(partSize));
  const parts: PartPlan[] = [];
  for (let start = 0, partNumber = 1; start < totalSize; start += size, partNumber += 1) {
    const end = Math.min(start + size, totalSize);
    parts.push({ partNumber, start, end, size: end - start });
  }
  return parts;
}

/**
 * Exponential backoff with jitter: attempt 1 waits ~500 ms, then doubles up to 8 s. Jitter keeps two
 * tabs from retrying in lockstep after a gateway stall.
 */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * 2 ** Math.max(0, attempt - 1));
  const jitter = base * 0.4 * random();
  return Math.round(base + jitter);
}

/** Hex SHA-256 of the file, computed before any byte leaves the browser. */
export async function sha256Hex(
  blob: Blob,
  subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle,
): Promise<string> {
  if (!subtle) {
    throw new Error("This browser cannot verify the upload checksum.");
  }
  const digest = await subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Stable resume key: the same file re-selected in the same session continues the upload. */
export function resumeKey(file: { name: string; size: number; lastModified?: number }): string {
  return `${RESUME_PREFIX}${file.name}:${file.size}:${file.lastModified ?? 0}`;
}

/** Minimal persistence port so the uploader works in the browser and in tests. */
export interface ResumeStore {
  read(key: string): string | null;
  write(key: string, value: string): void;
  clear(key: string): void;
}

export function localStorageResumeStore(): ResumeStore {
  return {
    read: (key) => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    write: (key, value) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // A full or blocked storage must not break the upload; resume simply stays unavailable.
      }
    },
    clear: (key) => {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Ignored for the same reason.
      }
    },
  };
}

/** Server view of an in-progress upload. */
export interface MultipartServerStatus {
  status: string;
  acknowledgedParts: number[];
  partSize: number;
  partCount: number;
}

/** Everything the uploader needs from the API, injected so the loop is testable. */
export interface MultipartApi {
  initiate(
    name: string,
    contentType: string,
    size: number,
    sha256: string,
  ): Promise<MultipartInitiatedDto>;
  status(uploadId: string): Promise<MultipartServerStatus>;
  partUrl(uploadId: string, partNumber: number): Promise<string>;
  acknowledge(uploadId: string, partNumber: number): Promise<void>;
  complete(uploadId: string, sha256: string): Promise<MultipartCompletedDto>;
  abort(uploadId: string): Promise<void>;
  putPart(url: string, blob: Blob, signal?: AbortSignal): Promise<void>;
}

/** Real API wiring for {@link MultipartApi}. */
export function createMultipartApi(): MultipartApi {
  return {
    initiate: initiateMultipartUpload,
    status: fetchMultipartUploadStatus,
    partUrl: async (uploadId, partNumber) => (await presignMultipartPart(uploadId, partNumber)).url,
    acknowledge: async (uploadId, partNumber) => {
      await acknowledgeMultipartPart(uploadId, partNumber);
    },
    complete: completeMultipartUpload,
    abort: abortMultipartUpload,
    putPart: (url, blob, signal) => putDocumentBytes(url, blob, () => {}, signal),
  };
}

export interface UploadOptions {
  /** Called with the percentage of acknowledged bytes. */
  onProgress?: (percent: number) => void;
  /** Aborting pauses the upload; the uploadId stays so a resume can continue it. */
  signal?: AbortSignal;
  store?: ResumeStore;
  /** Injected sleep so tests run instantly. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Injected hash so tests do not depend on a WebCrypto implementation. */
  hash?: (file: File) => Promise<string>;
}

export interface UploadOutcome {
  uploadId: string;
  fileId: string;
  resumed: boolean;
}

interface ResumeState {
  uploadId: string;
  sha256: string;
}

function readState(store: ResumeStore, key: string): ResumeState | null {
  const raw = store.read(key);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as ResumeState;
    return parsed.uploadId && parsed.sha256 ? parsed : null;
  } catch {
    return null;
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function putPartWithRetry(
  api: MultipartApi,
  uploadId: string,
  parts: MultipartInitiatedDto["parts"],
  partNumber: number,
  blob: Blob,
  options: UploadOptions,
  signal?: AbortSignal,
): Promise<void> {
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  let lastError: unknown;
  for (let attempt = 1; attempt <= PART_MAX_ATTEMPTS; attempt += 1) {
    const url =
      parts.find((entry) => entry.partNumber === partNumber)?.url ??
      (await api.partUrl(uploadId, partNumber));
    try {
      await api.putPart(url, blob, signal);
      await api.acknowledge(uploadId, partNumber);
      return;
    } catch (error) {
      if (signal?.aborted) {
        throw new UploadCancelledError(true);
      }
      lastError = error;
      if (attempt < PART_MAX_ATTEMPTS) {
        await sleep(retryDelayMs(attempt, random));
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("A part of the upload failed after three attempts.");
}

/**
 * Uploads a file in resumable parts.
 *
 * <p>Order of work: hash the bytes, reuse a stored uploadId when the server still has it, send only
 * the parts the server has not acknowledged, retry each part independently, then complete with the
 * checksum. Pausing aborts the in-flight request but keeps the resume state, so the next call
 * continues instead of starting over.
 */
export async function uploadResumable(
  file: File,
  api: MultipartApi,
  options: UploadOptions = {},
): Promise<UploadOutcome> {
  const store = options.store ?? localStorageResumeStore();
  const key = resumeKey(file);
  const checksum = await (options.hash ?? sha256Hex)(file);

  let uploadId: string | null = null;
  let partSize = DEFAULT_PART_SIZE_BYTES;
  let acknowledged: number[] = [];
  let resumed = false;

  const stored = readState(store, key);
  if (stored && stored.sha256 === checksum) {
    try {
      const status = await api.status(stored.uploadId);
      if (status.status === "IN_PROGRESS") {
        uploadId = stored.uploadId;
        partSize = status.partSize || DEFAULT_PART_SIZE_BYTES;
        acknowledged = status.acknowledgedParts;
        resumed = true;
      }
    } catch {
      // An expired or unknown upload falls through to a fresh initiate.
    }
  }

  let parts: MultipartInitiatedDto["parts"] = [];
  if (!uploadId) {
    const initiated = await api.initiate(
      file.name,
      file.type || "application/octet-stream",
      file.size,
      checksum,
    );
    uploadId = initiated.uploadId;
    partSize = initiated.partSize || DEFAULT_PART_SIZE_BYTES;
    parts = initiated.parts;
  }
  store.write(key, JSON.stringify({ uploadId, sha256: checksum }));

  const plan = planParts(file.size, partSize);
  const acked = new Set<number>(acknowledged);
  let acknowledgedBytes = plan
    .filter((part) => acked.has(part.partNumber))
    .reduce((sum, part) => sum + part.size, 0);
  options.onProgress?.(Math.round((acknowledgedBytes / Math.max(1, file.size)) * 100));

  for (const part of plan) {
    if (acked.has(part.partNumber)) {
      continue;
    }
    if (options.signal?.aborted) {
      throw new UploadCancelledError(true);
    }
    const blob = file.slice(part.start, part.end);
    await putPartWithRetry(api, uploadId, parts, part.partNumber, blob, options, options.signal);
    acked.add(part.partNumber);
    acknowledgedBytes += part.size;
    options.onProgress?.(
      Math.min(100, Math.round((acknowledgedBytes / Math.max(1, file.size)) * 100)),
    );
  }
  if (acked.size !== plan.length) {
    throw new Error("Some parts were not acknowledged; resume the upload to retry them.");
  }

  const completed = await api.complete(uploadId, checksum);
  store.clear(key);
  return { uploadId, fileId: completed.fileId, resumed };
}

/** Cancels an upload for good: aborts it server-side and drops the resume state. */
export async function cancelResumable(
  file: File,
  api: MultipartApi,
  store: ResumeStore = localStorageResumeStore(),
): Promise<void> {
  const key = resumeKey(file);
  const stored = readState(store, key);
  store.clear(key);
  if (stored) {
    await api.abort(stored.uploadId);
  }
}
