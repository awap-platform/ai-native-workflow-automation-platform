import { UploadCancelledError } from "../documentUpload";
import {
  cancelResumable,
  planParts,
  resumeKey,
  retryDelayMs,
  sha256Hex,
  uploadResumable,
  type MultipartApi,
  type ResumeStore,
} from "../multipartUpload";

function fakeFile(bytes: number, name = "big.pdf", lastModified = 1): File {
  const data = new Uint8Array(bytes);
  return {
    name,
    size: bytes,
    type: "application/pdf",
    lastModified,
    arrayBuffer: async () => data.buffer,
    slice: (start: number, end: number) =>
      ({ size: end - start } as Blob),
  } as unknown as File;
}

function memoryStore(initial: Record<string, string> = {}): ResumeStore & {
  values: Record<string, string>;
} {
  const values = { ...initial };
  return {
    values,
    read: (key) => values[key] ?? null,
    write: (key, value) => {
      values[key] = value;
    },
    clear: (key) => {
      delete values[key];
    },
  };
}

const subtle = {
  digest: async () => new Uint8Array(32).buffer,
} as unknown as SubtleCrypto;

const CHECKSUM = "0".repeat(64);
const hash = async () => CHECKSUM;

function api(overrides: Partial<MultipartApi> = {}): MultipartApi & {
  calls: string[];
} {
  const calls: string[] = [];
  const base: MultipartApi = {
    initiate: async (name, contentType, size, sha256) => {
      calls.push(`initiate:${name}:${contentType}:${size}:${sha256.length}`);
      return {
        uploadId: "upload-1",
        fileId: "file-1",
        partSize: 8,
        partCount: 2,
        expiresAt: "2026-12-01T00:00:00Z",
        parts: [
          { uploadId: "upload-1", partNumber: 1, url: "https://minio/1", expiresInSeconds: 300 },
          { uploadId: "upload-1", partNumber: 2, url: "https://minio/2", expiresInSeconds: 300 },
        ],
      };
    },
    status: async () => {
      calls.push("status");
      return { status: "IN_PROGRESS", acknowledgedParts: [], partSize: 8, partCount: 2 };
    },
    partUrl: async (_uploadId, partNumber) => {
      calls.push(`partUrl:${partNumber}`);
      return `https://minio/fresh-${partNumber}`;
    },
    acknowledge: async (_uploadId, partNumber) => {
      calls.push(`ack:${partNumber}`);
    },
    complete: async (_uploadId, sha256) => {
      calls.push(`complete:${sha256.length}`);
      return {
        fileId: "file-1",
        name: "big.pdf",
        status: "QUARANTINED",
        expiresAt: "2026-12-01T00:00:00Z",
        scanned: false,
        versionId: "version-1",
        version: 1,
      };
    },
    abort: async () => {
      calls.push("abort");
    },
    putPart: async (url) => {
      calls.push(`put:${url}`);
    },
  };
  return { ...base, ...overrides, calls };
}

describe("planParts", () => {
  it("covers the file exactly once with the remainder in the last part", () => {
    const parts = planParts(20, 8);

    expect(parts).toEqual([
      { partNumber: 1, start: 0, end: 8, size: 8 },
      { partNumber: 2, start: 8, end: 16, size: 8 },
      { partNumber: 3, start: 16, end: 20, size: 4 },
    ]);
    expect(parts.reduce((sum, part) => sum + part.size, 0)).toBe(20);
  });

  it("keeps consecutive parts contiguous", () => {
    const parts = planParts(100, 30);
    const gaps = parts.slice(1).map((part, index) => part.start - (parts[index]?.end ?? -1));
    expect(gaps).toEqual([0, 0, 0]);
  });

  it("returns no parts for an empty or invalid size", () => {
    expect(planParts(0, 8)).toEqual([]);
    expect(planParts(Number.NaN, 8)).toEqual([]);
  });

  it("never plans a zero-length part for a degenerate part size", () => {
    expect(planParts(3, 0)).toHaveLength(3);
  });
});

describe("retryDelayMs", () => {
  it("backs off exponentially", () => {
    expect(retryDelayMs(1, () => 0)).toBe(500);
    expect(retryDelayMs(2, () => 0)).toBe(1000);
    expect(retryDelayMs(3, () => 0)).toBe(2000);
  });

  it("caps the delay and stays jittered", () => {
    expect(retryDelayMs(10, () => 0)).toBe(8000);
    expect(retryDelayMs(3, () => 1)).toBe(2800);
  });
});

describe("sha256Hex", () => {
  it("returns a hex digest", async () => {
    const blob = { arrayBuffer: async () => new Uint8Array([1, 2]).buffer } as unknown as Blob;
    expect(await sha256Hex(blob, subtle)).toBe(CHECKSUM);
  });

  it("fails clearly when the browser cannot hash", async () => {
    const blob = { arrayBuffer: async () => new ArrayBuffer(2) } as unknown as Blob;
    await expect(sha256Hex(blob, undefined)).rejects.toThrow(/checksum/);
  });
});

describe("uploadResumable", () => {
  it("hashes, initiates, sends every part and completes", async () => {
    const store = memoryStore();
    const client = api();
    const progress: number[] = [];

    const outcome = await uploadResumable(fakeFile(10), client, {
      store,
      hash,
      onProgress: (percent) => progress.push(percent),
    });

    expect(outcome).toEqual({ uploadId: "upload-1", fileId: "file-1", resumed: false });
    expect(client.calls[0]).toBe(`initiate:big.pdf:application/pdf:10:64`);
    expect(client.calls).toContain("put:https://minio/1");
    expect(client.calls).toContain("put:https://minio/2");
    expect(client.calls).toContain("complete:64");
    expect(progress.at(-1)).toBe(100);
    expect(Object.keys(store.values)).toHaveLength(0);
  });

  it("retries a failing part with backoff instead of restarting the upload", async () => {
    const store = memoryStore();
    const sleeps: number[] = [];
    let attempts = 0;
    const client = api({
      putPart: async (url) => {
        if (url.endsWith("/1") && attempts < 2) {
          attempts += 1;
          throw new Error("network down");
        }
      },
    });

    await uploadResumable(fakeFile(10), client, {
      store,
      hash,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random: () => 0,
    });

    expect(attempts).toBe(2);
    expect(sleeps).toEqual([500, 1000]);
    expect(client.calls).toContain("complete:64");
  });

  it("gives up after three attempts with the last error", async () => {
    const client = api({
      putPart: async () => {
        throw new Error("still down");
      },
    });

    await expect(
      uploadResumable(fakeFile(10), client, { store: memoryStore(), hash, sleep: async () => {} }),
    ).rejects.toThrow("still down");
  });

  it("resumes from the acknowledged parts and asks for a fresh URL", async () => {
    const store = memoryStore({
      [resumeKey(fakeFile(10))]: JSON.stringify({ uploadId: "upload-1", sha256: CHECKSUM }),
    });
    const client = api({
      status: async () => ({
        status: "IN_PROGRESS",
        acknowledgedParts: [1],
        partSize: 8,
        partCount: 2,
      }),
    });

    const outcome = await uploadResumable(fakeFile(10), client, { store, hash });

    expect(outcome.resumed).toBe(true);
    expect(client.calls).not.toContain("initiate:big.pdf:application/pdf:10:64");
    expect(client.calls).toContain("put:https://minio/fresh-2");
    expect(client.calls).not.toContain("put:https://minio/1");
  });

  it("starts over when the stored upload expired", async () => {
    const store = memoryStore({
      [resumeKey(fakeFile(10))]: JSON.stringify({ uploadId: "upload-old", sha256: CHECKSUM }),
    });
    const client = api({
      status: async () => ({
        status: "ABORTED",
        acknowledgedParts: [],
        partSize: 8,
        partCount: 2,
      }),
    });

    const outcome = await uploadResumable(fakeFile(10), client, { store, hash });

    expect(outcome.resumed).toBe(false);
    expect(client.calls).toContain("initiate:big.pdf:application/pdf:10:64");
  });

  it("keeps the resume state when the upload is paused", async () => {
    const store = memoryStore();
    const controller = new AbortController();
    const client = api({
      putPart: async (url) => {
        if (url.endsWith("/1")) {
          controller.abort();
        }
      },
    });

    await expect(
      uploadResumable(fakeFile(10), client, { store, hash, signal: controller.signal }),
    ).rejects.toBeInstanceOf(UploadCancelledError);

    expect(Object.keys(store.values)).toHaveLength(1);
    expect(client.calls).not.toContain("complete:64");
  });

  it("ignores a stored upload whose checksum does not match the selected file", async () => {
    const store = memoryStore({
      [resumeKey(fakeFile(10))]: JSON.stringify({ uploadId: "upload-x", sha256: "f".repeat(64) }),
    });
    const client = api();

    const outcome = await uploadResumable(fakeFile(10), client, { store, hash });

    expect(outcome.resumed).toBe(false);
    expect(client.calls).not.toContain("status");
  });
});

describe("cancelResumable", () => {
  it("aborts the stored upload and clears the state", async () => {
    const file = fakeFile(10);
    const store = memoryStore({
      [resumeKey(file)]: JSON.stringify({ uploadId: "upload-1", sha256: CHECKSUM }),
    });
    const client = api();

    await cancelResumable(file, client, store);

    expect(client.calls).toContain("abort");
    expect(Object.keys(store.values)).toHaveLength(0);
  });

  it("does nothing when there is nothing to cancel", async () => {
    const client = api();

    await cancelResumable(fakeFile(10), client, memoryStore());

    expect(client.calls).not.toContain("abort");
  });
});
