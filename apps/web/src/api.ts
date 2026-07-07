import {
  ApiError,
  type ChangesResponse,
  type CreateDocBody,
  type DrainTransport,
  type SearchResult,
  type ServerDoc,
  type SyncTransport,
  type UpdateDocBody,
  type UpdateDocResponse,
} from '@forge/core';

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

export const getDoc = (id: string): Promise<ServerDoc> => req(`/api/docs/${id}`);

export const search = (q: string): Promise<{ results: SearchResult[] }> =>
  req(`/api/search?q=${encodeURIComponent(q)}`);

export const transport: SyncTransport = {
  changes: (since: number): Promise<ChangesResponse> => req(`/api/changes?since=${since}`),
};

export const drainTransport: DrainTransport = {
  create: createDoc,
  update: updateDoc,
  get: getDoc,
  remove: async (id: string) => {
    try {
      await deleteDoc(id);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e;
    }
  },
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
