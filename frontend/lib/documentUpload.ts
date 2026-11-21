import {
  createDocumentUpload,
  deleteDocumentVersion,
  type CreateDocumentResponseDto,
} from "./api";

/** Mirrors `awap.files.max-size-bytes` so the client fails fast instead of uploading 500 MB first. */
export const MAX_DOCUMENT_BYTES = 500 * 1024 * 1024;

/** Mirrors the server-side extension allow-list (lower case, no dot). */
export const DOCUMENT_EXTENSIONS = [
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "png",
  "jpg",
  "jpeg",
  "txt",
] as const;

export type UploadErrorCode = "FILE_TOO_LARGE" | "FILE_FORMAT_UNSUPPORTED" | "FILE_EMPTY";

/** A local validation failure that never reached the API. */
export class UploadValidationError extends Error {
  constructor(
    readonly code: UploadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "UploadValidationError";
  }
}

/** Raised when the operator cancels an upload. */
export class UploadCancelledError extends Error {
  /** False when the pending server-side version could not be removed after the abort. */
  readonly cleanupSucceeded: boolean;

  constructor(cleanupSucceeded: boolean) {
    super("Upload cancelled.");
    this.name = "UploadCancelledError";
    this.cleanupSucceeded = cleanupSucceeded;
  }
}

/** Upload progress as a clamped whole percentage. */
export function uploadPercent(loaded: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round((loaded / total) * 100)));
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * Validates size and format locally. This is deliberately identical to the server rule so a 413
 * (payload too large) or 415 (unsupported media type) is rendered before any byte is transferred.
 */
export function validateDocumentFile(file: { name: string; size: number }): void {
  if (file.size <= 0) {
    throw new UploadValidationError("FILE_EMPTY", "The file is empty.");
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    throw new UploadValidationError(
      "FILE_TOO_LARGE",
      "This file is larger than the 500 MB upload limit.",
    );
  }
  if (!DOCUMENT_EXTENSIONS.includes(extensionOf(file.name) as (typeof DOCUMENT_EXTENSIONS)[number])) {
    throw new UploadValidationError(
      "FILE_FORMAT_UNSUPPORTED",
      `This file format is not supported. Allowed formats: ${DOCUMENT_EXTENSIONS.join(", ").toUpperCase()}.`,
    );
  }
}

export type XhrFactory = () => XMLHttpRequest;

/**
 * PUTs the bytes into the quarantine bucket and reports progress. Aborting through `signal`
 * terminates the transfer and rejects with {@link UploadCancelledError}; the caller is responsible
 * for removing the pending version row.
 */
export function putDocumentBytes(
  uploadUrl: string,
  file: Blob,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
  xhrFactory: XhrFactory = () => new XMLHttpRequest(),
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadCancelledError(true));
      return;
    }
    const xhr = xhrFactory();
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      xhr.upload.onprogress = null;
      xhr.onload = null;
      xhr.onerror = null;
      xhr.onabort = null;
    };
    const onAbort = () => {
      cleanup();
      xhr.abort();
      reject(new UploadCancelledError(true));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    xhr.open("PUT", uploadUrl);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(uploadPercent(event.loaded, event.total));
      }
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
        return;
      }
      reject(new Error(`Upload failed with status ${xhr.status}.`));
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error("Upload failed."));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new UploadCancelledError(true));
    };
    xhr.send(file);
  });
}

export interface UploadDocumentDependencies {
  createUpload: typeof createDocumentUpload;
  putBytes: typeof putDocumentBytes;
  deleteVersion: typeof deleteDocumentVersion;
}

/**
 * Creates the quarantine slot, transfers the bytes and cleans up an interrupted upload.
 *
 * <p>An upload is two calls: the slot row is created before the PUT starts. Aborting or failing the
 * PUT therefore leaves a pending version behind, so every failure path calls the soft-delete endpoint.
 * A cleanup failure does not mask the original cancellation: it is reported on
 * {@link UploadCancelledError.cleanupSucceeded} so the UI can state honestly whether the slot was
 * removed.
 */
export async function uploadDocument(
  file: File,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
  dependencies: UploadDocumentDependencies = {
    createUpload: createDocumentUpload,
    putBytes: putDocumentBytes,
    deleteVersion: deleteDocumentVersion,
  },
): Promise<CreateDocumentResponseDto> {
  validateDocumentFile(file);
  const slot = await dependencies.createUpload(
    file.name,
    file.type || "application/octet-stream",
    file.size,
  );
  const cleanup = async (): Promise<boolean> => {
    try {
      await dependencies.deleteVersion(slot.version.id);
      return true;
    } catch {
      return false;
    }
  };
  if (signal?.aborted) {
    throw new UploadCancelledError(await cleanup());
  }
  try {
    await dependencies.putBytes(slot.uploadUrl, file, onProgress, signal);
    return slot;
  } catch (error) {
    if (error instanceof UploadCancelledError) {
      throw new UploadCancelledError(await cleanup());
    }
    await cleanup();
    throw error;
  }
}
