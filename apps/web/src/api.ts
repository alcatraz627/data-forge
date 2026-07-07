import type {
  ChangesResponse,
  CreateDocBody,
  SearchResult,
  ServerDoc,
  SyncTransport,
  UpdateDocBody,
  UpdateDocResponse,
} from '@forge/core';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      // non-JSON error body; keep statusText
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export const createDoc = (body: CreateDocBody): Promise<ServerDoc> =>
  req('/api/docs', { method: 'POST', body: JSON.stringify(body) });

export const updateDoc = (id: string, body: UpdateDocBody): Promise<UpdateDocResponse> =>
  req(`/api/docs/${id}`, { method: 'PUT', body: JSON.stringify(body) });

export const deleteDoc = (id: string): Promise<{ ok: boolean }> =>
  req(`/api/docs/${id}`, { method: 'DELETE' });

export const search = (q: string): Promise<{ results: SearchResult[] }> =>
  req(`/api/search?q=${encodeURIComponent(q)}`);

export const transport: SyncTransport = {
  changes: (since: number): Promise<ChangesResponse> => req(`/api/changes?since=${since}`),
};

/** Server-sent change nudges. EventSource reconnects on its own; onState
 * reports connectivity so the header dot can be honest about sync state. */
export function subscribeEvents(onChange: () => void, onState: (ok: boolean) => void): () => void {
  const es = new EventSource('/api/events');
  es.addEventListener('change', onChange);
  es.onopen = () => onState(true);
  es.onerror = () => onState(false);
  return () => es.close();
}
