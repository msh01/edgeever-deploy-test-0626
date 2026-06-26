import type { MemoDetail, MemoSummary, Notebook, TiptapDoc } from "@edgeever/shared";

type ListNotebooksResponse = {
  notebooks: Notebook[];
};

type ListMemosResponse = {
  memos: MemoSummary[];
};

type MemoResponse = {
  memo: MemoDetail;
};

type NotebookResponse = {
  notebook: Notebook;
};

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message =
      body && typeof body === "object" && "error" in body
        ? (body as { error?: { message?: string } }).error?.message
        : response.statusText;

    throw new Error(message || "Request failed");
  }

  return response.json() as Promise<T>;
};

export const api = {
  listNotebooks: () => request<ListNotebooksResponse>("/api/v1/notebooks"),

  createNotebook: (payload: { name: string; parentId?: string | null }) =>
    request<NotebookResponse>("/api/v1/notebooks", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  listMemos: (params: { notebookId?: string | null; q?: string }) => {
    const search = new URLSearchParams();

    if (params.notebookId) {
      search.set("notebookId", params.notebookId);
    }

    if (params.q?.trim()) {
      search.set("q", params.q.trim());
    }

    return request<ListMemosResponse>(`/api/v1/memos?${search.toString()}`);
  },

  createMemo: (payload: { notebookId: string; title?: string; contentMarkdown?: string; tags?: string[] }) =>
    request<MemoResponse>("/api/v1/memos", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getMemo: (memoId: string) => request<MemoResponse>(`/api/v1/memos/${memoId}`),

  updateMemo: (
    memoId: string,
    payload: {
      expectedRevision?: number;
      notebookId?: string;
      title?: string;
      contentJson?: TiptapDoc;
      contentMarkdown?: string;
      tags?: string[];
    }
  ) =>
    request<MemoResponse>(`/api/v1/memos/${memoId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  deleteMemo: (memoId: string) =>
    request<{ ok: true }>(`/api/v1/memos/${memoId}`, {
      method: "DELETE",
    }),

  mergeMemos: (payload: { memoIds: string[]; notebookId?: string; title?: string }) =>
    request<MemoResponse>("/api/v1/memos/merge", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
