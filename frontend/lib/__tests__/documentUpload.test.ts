import {
  putDocumentBytes,
  uploadDocument,
  uploadPercent,
  UploadCancelledError,
  UploadValidationError,
  validateDocumentFile,
} from "../documentUpload";
import type { CreateDocumentResponseDto } from "../api";

interface FakeUpload {
  onprogress: ((event: ProgressEvent) => void) | null;
}

class FakeXhr {
  upload: FakeUpload = { onprogress: null };
  status = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open = jest.fn();
  send = jest.fn();
  abort = jest.fn(() => this.onabort?.());
}

function slot(): CreateDocumentResponseDto {
  return {
    fileId: "file-1",
    uploadUrl: "https://storage.test/quarantine/file-1",
    version: {
      id: "version-1",
      fileId: "file-1",
      version: 1,
      size: 10,
      format: "pdf",
      status: "PENDING",
      createdAt: "2026-01-01T00:00:00Z",
      name: "report.pdf",
      scanStatus: "QUARANTINED",
      scanError: null,
      downloadable: false,
    },
  };
}

function file(name = "report.pdf", size = 10): File {
  return new File([new Uint8Array(size)], name, { type: "application/pdf" });
}

describe("uploadPercent", () => {
  it("clamps to whole percentages", () => {
    expect(uploadPercent(50, 100)).toBe(50);
    expect(uploadPercent(1, 3)).toBe(33);
    expect(uploadPercent(-1, 100)).toBe(0);
    expect(uploadPercent(200, 100)).toBe(100);
    expect(uploadPercent(1, 0)).toBe(0);
  });
});

describe("validateDocumentFile", () => {
  it("rejects an empty file", () => {
    expect(() => validateDocumentFile({ name: "a.pdf", size: 0 })).toThrow(UploadValidationError);
  });

  it("rejects a file above the 500 MB limit with a 413 message", () => {
    expect(() => validateDocumentFile({ name: "big.pdf", size: 500 * 1024 * 1024 + 1 })).toThrow(
      "larger than the 500 MB",
    );
  });

  it("rejects an unsupported extension with a 415 message", () => {
    expect(() => validateDocumentFile({ name: "malware.exe", size: 10 })).toThrow(
      "format is not supported",
    );
  });
});

describe("putDocumentBytes", () => {
  it("reports progress and resolves on a 2xx response", async () => {
    const xhr = new FakeXhr();
    const progress: number[] = [];
    const promise = putDocumentBytes(
      "https://storage.test/u",
      file(),
      (percent) => progress.push(percent),
      undefined,
      () => xhr as unknown as XMLHttpRequest,
    );
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent);
    xhr.status = 200;
    xhr.onload?.();

    await expect(promise).resolves.toBeUndefined();
    expect(progress).toEqual([50, 100]);
  });

  it("rejects a non-2xx response", async () => {
    const xhr = new FakeXhr();
    const promise = putDocumentBytes(
      "https://storage.test/u",
      file(),
      () => undefined,
      undefined,
      () => xhr as unknown as XMLHttpRequest,
    );
    xhr.status = 500;
    xhr.onload?.();
    await expect(promise).rejects.toThrow("status 500");
  });

  it("aborts the transfer when the signal fires", async () => {
    const xhr = new FakeXhr();
    const controller = new AbortController();
    const promise = putDocumentBytes(
      "https://storage.test/u",
      file(),
      () => undefined,
      controller.signal,
      () => xhr as unknown as XMLHttpRequest,
    );
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(UploadCancelledError);
    expect(xhr.abort).toHaveBeenCalled();
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      putDocumentBytes("https://storage.test/u", file(), () => undefined, controller.signal),
    ).rejects.toBeInstanceOf(UploadCancelledError);
  });
});

describe("uploadDocument", () => {
  it("cleans up the pending version when the transfer is cancelled", async () => {
    const controller = new AbortController();
    const createUpload = jest.fn(async () => slot());
    const deleteVersion = jest.fn(async () => slot().version);
    const promise = uploadDocument(file(), () => undefined, controller.signal, {
      createUpload,
      putBytes: (url, blob, onProgress, signal) =>
        // Simulates a transfer that only ends when the controller aborts.
        new Promise((resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new UploadCancelledError(true)), {
            once: true,
          });
          void resolve;
          void onProgress;
          void url;
          void blob;
        }),
      deleteVersion,
    });

    await Promise.resolve();
    controller.abort();

    const error = await promise.catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(UploadCancelledError);
    expect((error as UploadCancelledError).cleanupSucceeded).toBe(true);
    expect(deleteVersion).toHaveBeenCalledWith("version-1");
  });

  it("reports a failed cleanup instead of hiding it", async () => {
    const controller = new AbortController();
    const promise = uploadDocument(file(), () => undefined, controller.signal, {
      createUpload: jest.fn(async () => slot()),
      putBytes: (_url, _blob, _onProgress, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new UploadCancelledError(true)), {
            once: true,
          });
        }),
      deleteVersion: jest.fn(async () => {
        throw new Error("cleanup unavailable");
      }),
    });

    await Promise.resolve();
    controller.abort();

    const error = await promise.catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(UploadCancelledError);
    expect((error as UploadCancelledError).cleanupSucceeded).toBe(false);
  });

  it("cleans up and rethrows when the PUT itself fails", async () => {
    const deleteVersion = jest.fn(async () => slot().version);
    await expect(
      uploadDocument(file(), () => undefined, undefined, {
        createUpload: jest.fn(async () => slot()),
        putBytes: jest.fn(async () => {
          throw new Error("network down");
        }),
        deleteVersion,
      }),
    ).rejects.toThrow("network down");
    expect(deleteVersion).toHaveBeenCalledWith("version-1");
  });

  it("fails fast on 413/415 without creating a slot", async () => {
    const createUpload = jest.fn(async () => slot());
    await expect(
      uploadDocument(file("archive.zip", 10), () => undefined, undefined, {
        createUpload,
        putBytes: jest.fn(),
        deleteVersion: jest.fn(),
      }),
    ).rejects.toBeInstanceOf(UploadValidationError);
    expect(createUpload).not.toHaveBeenCalled();
  });
});
