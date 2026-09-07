// Thin fetch client over the xpenses API envelope.
// { ok:true, data } | { ok:false, error:{ code, message } }

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "NETWORK";

export class ApiError extends Error {
  code: ApiErrorCode;
  status: number;
  constructor(code: ApiErrorCode, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

type SuccessEnvelope<T> = { ok: true; data: T; meta?: Record<string, unknown> };
type Envelope<T> = SuccessEnvelope<T> | { ok: false; error: { code: ApiErrorCode; message: string } };

async function requestEnvelope<T>(path: string, init?: RequestInit): Promise<SuccessEnvelope<T>> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new ApiError("NETWORK", "Can't reach the server. Check your connection.", 0);
  }

  let body: Envelope<T> | null = null;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    // fall through to status-based error
  }

  if (body && body.ok) return body;
  if (body && !body.ok) throw new ApiError(body.error.code, body.error.message, res.status);
  throw new ApiError("SERVER_ERROR", `Unexpected response (${res.status}).`, res.status);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const envelope = await requestEnvelope<T>(path, init);
  if (init?.method && envelope.meta?.syncStatus === "skipped") {
    throw new ApiError("CONFLICT", "A newer server change was kept.", 409);
  }
  return envelope.data;
}

async function getPage<T>(path: string): Promise<{ data: T; nextCursor: string | null }> {
  const envelope = await requestEnvelope<T>(path);
  const nextCursor = envelope.meta?.nextCursor;
  if (nextCursor != null && (typeof nextCursor !== "string" || nextCursor.trim() === "")) {
    throw new ApiError("SERVER_ERROR", "Invalid pagination cursor from server.", 200);
  }
  return { data: envelope.data, nextCursor: nextCursor ?? null };
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  getPage,
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "DELETE", body: body ? JSON.stringify(body) : undefined }),
};
