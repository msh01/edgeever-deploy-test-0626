import {
  createExcerpt,
  docToMarkdown,
  docToText,
  emptyDoc,
  markdownToDoc,
  MemoCreateSchema,
  MemoUpdateSchema,
  MergeMemosSchema,
  normalizeTags,
  NotebookCreateSchema,
  NotebookUpdateSchema,
  type MemoDetail,
  type MemoSummary,
  type Notebook,
  type TiptapDoc,
} from "@edgeever/shared";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";

type Bindings = {
  DB: D1Database;
  RESOURCES: R2Bucket;
};

type NotebookRow = {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string | null;
  icon: string | null;
  color: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type MemoSummaryRow = {
  id: string;
  notebook_id: string;
  title: string | null;
  excerpt: string;
  tags_json: string;
  is_pinned: number;
  is_archived: number;
  created_at: string;
  updated_at: string;
  revision: number;
};

type MemoDetailRow = MemoSummaryRow & {
  content_json: string;
  content_markdown: string;
  content_text: string;
  source_memo_ids: string;
  merge_source_count: number;
  merged_into_memo_id: string | null;
  content_hash: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use(
  "/api/*",
  cors({
    origin: ["http://127.0.0.1:5173", "http://localhost:5173"],
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  })
);

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    name: "edgeever",
    runtime: "cloudflare-workers",
  })
);

app.get("/api/v1/notebooks", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, parent_id, name, slug, icon, color, sort_order, created_at, updated_at
     FROM notebooks
     WHERE is_deleted = 0
     ORDER BY parent_id IS NOT NULL, sort_order ASC, name ASC`
  ).all<NotebookRow>();

  return c.json({ notebooks: rows.results.map(mapNotebook) });
});

app.post("/api/v1/notebooks", zValidator("json", NotebookCreateSchema), async (c) => {
  const input = c.req.valid("json");
  const id = createId("nb");
  const now = isoNow();

  await c.env.DB.prepare(
    `INSERT INTO notebooks (id, parent_id, name, slug, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, input.parentId ?? null, input.name, slugify(input.name), Date.now(), now, now)
    .run();

  const notebook = await getNotebook(c.env.DB, id);
  await audit(c.env.DB, "user", null, "notebook.create", "notebook", id, { name: input.name });

  return c.json({ notebook }, 201);
});

app.patch("/api/v1/notebooks/:id", zValidator("json", NotebookUpdateSchema), async (c) => {
  const id = c.req.param("id");
  const input = c.req.valid("json");
  const current = await getNotebook(c.env.DB, id);

  if (!current) {
    return notFound(c, "Notebook not found");
  }

  const nextName = input.name ?? current.name;
  const nextParentId = input.parentId === undefined ? current.parentId : input.parentId;
  const nextSortOrder = input.sortOrder ?? current.sortOrder;
  const now = isoNow();

  await c.env.DB.prepare(
    `UPDATE notebooks
     SET name = ?, slug = ?, parent_id = ?, sort_order = ?, updated_at = ?
     WHERE id = ? AND is_deleted = 0`
  )
    .bind(nextName, slugify(nextName), nextParentId ?? null, nextSortOrder, now, id)
    .run();

  await audit(c.env.DB, "user", null, "notebook.update", "notebook", id, input);
  return c.json({ notebook: await getNotebook(c.env.DB, id) });
});

app.delete("/api/v1/notebooks/:id", async (c) => {
  const id = c.req.param("id");
  const now = isoNow();

  await c.env.DB.prepare(
    `UPDATE notebooks
     SET is_deleted = 1, deleted_at = ?, updated_at = ?
     WHERE id = ? AND id <> 'nb_inbox'`
  )
    .bind(now, now, id)
    .run();

  await audit(c.env.DB, "user", null, "notebook.delete", "notebook", id, {});
  return c.json({ ok: true });
});

app.get("/api/v1/memos", async (c) => {
  const notebookId = c.req.query("notebookId");
  const q = c.req.query("q")?.trim();
  const limit = clampNumber(Number(c.req.query("limit") ?? 80), 1, 100);

  if (q) {
    const ftsQuery = toFtsQuery(q);

    if (ftsQuery) {
      const rows = await c.env.DB.prepare(
        `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
                m.is_archived, m.created_at, m.updated_at, c.revision
         FROM memos_fts f
         INNER JOIN memos m ON m.id = f.memo_id
         INNER JOIN memo_contents c ON c.memo_id = m.id
         WHERE memos_fts MATCH ?
           AND m.is_deleted = 0
           AND (? IS NULL OR m.notebook_id = ?)
         ORDER BY m.is_pinned DESC, m.updated_at DESC
         LIMIT ?`
      )
        .bind(ftsQuery, notebookId ?? null, notebookId ?? null, limit)
        .all<MemoSummaryRow>();

      return c.json({ memos: rows.results.map(mapMemoSummary) });
    }
  }

  const rows = await c.env.DB.prepare(
    `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
            m.is_archived, m.created_at, m.updated_at, c.revision
     FROM memos m
     INNER JOIN memo_contents c ON c.memo_id = m.id
     WHERE m.is_deleted = 0
       AND (? IS NULL OR m.notebook_id = ?)
     ORDER BY m.is_pinned DESC, m.updated_at DESC
     LIMIT ?`
  )
    .bind(notebookId ?? null, notebookId ?? null, limit)
    .all<MemoSummaryRow>();

  return c.json({ memos: rows.results.map(mapMemoSummary) });
});

app.post("/api/v1/memos", zValidator("json", MemoCreateSchema), async (c) => {
  const input = c.req.valid("json");
  const tags = normalizeTags(input.tags);
  const contentMarkdown = input.contentMarkdown ?? "";
  const contentJson = markdownToDoc(contentMarkdown);
  const contentText = docToText(contentJson);
  const title = input.title || deriveTitle(contentText);
  const excerpt = createExcerpt(contentText || title || "");
  const contentHash = await sha256(contentMarkdown + JSON.stringify(contentJson));
  const id = createId("memo");
  const now = isoNow();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO memos (
        id, notebook_id, title, excerpt, tags_json, created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'user', 'user', ?, ?)`
    ).bind(id, input.notebookId, title, excerpt, JSON.stringify(tags), now, now),
    c.env.DB.prepare(
      `INSERT INTO memo_contents (
        memo_id, content_json, content_markdown, content_text, content_hash, revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
    ).bind(id, JSON.stringify(contentJson), contentMarkdown, contentText, contentHash, now, now),
    c.env.DB.prepare(
      `INSERT INTO memos_fts (memo_id, title, content_text, tags)
       VALUES (?, ?, ?, ?)`
    ).bind(id, title, contentText, tags.join(" ")),
    auditStatement(c.env.DB, "user", null, "memo.create", "memo", id, { notebookId: input.notebookId }),
  ]);

  return c.json({ memo: await getMemoDetail(c.env.DB, id) }, 201);
});

app.get("/api/v1/memos/:id", async (c) => {
  const memo = await getMemoDetail(c.env.DB, c.req.param("id"));

  if (!memo) {
    return notFound(c, "Memo not found");
  }

  return c.json({ memo });
});

app.patch("/api/v1/memos/:id", zValidator("json", MemoUpdateSchema), async (c) => {
  const id = c.req.param("id");
  const input = c.req.valid("json");
  const current = await getMemoDetailRow(c.env.DB, id);

  if (!current) {
    return notFound(c, "Memo not found");
  }

  if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
    return c.json(
      {
        error: {
          code: "revision_conflict",
          message: "Memo was updated elsewhere. Reload before saving.",
          details: {
            expectedRevision: input.expectedRevision,
            currentRevision: current.revision,
          },
        },
      },
      409
    );
  }

  const currentContentJson = JSON.parse(current.content_json) as TiptapDoc;
  const contentJson = input.contentJson
    ? (input.contentJson as TiptapDoc)
    : input.contentMarkdown !== undefined
      ? markdownToDoc(input.contentMarkdown)
      : currentContentJson;
  const contentMarkdown =
    input.contentMarkdown !== undefined ? input.contentMarkdown : docToMarkdown(contentJson);
  const contentText = docToText(contentJson);
  const title = input.title ?? current.title ?? deriveTitle(contentText);
  const tags = input.tags === undefined ? parseJsonArray(current.tags_json) : normalizeTags(input.tags);
  const excerpt = createExcerpt(contentText || title || "");
  const notebookId = input.notebookId ?? current.notebook_id;
  const nextRevision = current.revision + 1;
  const contentHash = await sha256(contentMarkdown + JSON.stringify(contentJson));
  const now = isoNow();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO memo_revisions (
        id, memo_id, revision, title, content_json, content_markdown, content_hash, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'user', ?)`
    ).bind(
      createId("rev"),
      id,
      current.revision,
      current.title,
      current.content_json,
      current.content_markdown,
      current.content_hash,
      now
    ),
    c.env.DB.prepare(
      `UPDATE memos
       SET notebook_id = ?, title = ?, excerpt = ?, tags_json = ?, updated_by = 'user', updated_at = ?
       WHERE id = ? AND is_deleted = 0`
    ).bind(notebookId, title, excerpt, JSON.stringify(tags), now, id),
    c.env.DB.prepare(
      `UPDATE memo_contents
       SET content_json = ?, content_markdown = ?, content_text = ?, content_hash = ?,
           revision = ?, updated_at = ?
       WHERE memo_id = ?`
    ).bind(JSON.stringify(contentJson), contentMarkdown, contentText, contentHash, nextRevision, now, id),
    c.env.DB.prepare(`DELETE FROM memos_fts WHERE memo_id = ?`).bind(id),
    c.env.DB.prepare(
      `INSERT INTO memos_fts (memo_id, title, content_text, tags)
       VALUES (?, ?, ?, ?)`
    ).bind(id, title, contentText, tags.join(" ")),
    auditStatement(c.env.DB, "user", null, "memo.update", "memo", id, { revision: nextRevision }),
  ]);

  return c.json({ memo: await getMemoDetail(c.env.DB, id) });
});

app.delete("/api/v1/memos/:id", async (c) => {
  const id = c.req.param("id");
  const now = isoNow();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE memos
       SET is_deleted = 1, deleted_at = ?, updated_at = ?
       WHERE id = ? AND is_deleted = 0`
    ).bind(now, now, id),
    auditStatement(c.env.DB, "user", null, "memo.delete", "memo", id, {}),
  ]);

  return c.json({ ok: true });
});

app.post("/api/v1/memos/merge", zValidator("json", MergeMemosSchema), async (c) => {
  const input = c.req.valid("json");
  const uniqueMemoIds = Array.from(new Set(input.memoIds));
  const placeholders = uniqueMemoIds.map(() => "?").join(", ");
  const rows = await c.env.DB.prepare(
    `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
            m.is_archived, m.created_at, m.updated_at, c.revision,
            c.content_json, c.content_markdown, c.content_text, c.content_hash,
            m.source_memo_ids, m.merge_source_count, m.merged_into_memo_id
     FROM memos m
     INNER JOIN memo_contents c ON c.memo_id = m.id
     WHERE m.is_deleted = 0 AND m.id IN (${placeholders})`
  )
    .bind(...uniqueMemoIds)
    .all<MemoDetailRow>();

  if (rows.results.length !== uniqueMemoIds.length) {
    return c.json(
      {
        error: {
          code: "missing_memos",
          message: "One or more memos cannot be merged.",
        },
      },
      400
    );
  }

  const ordered = uniqueMemoIds
    .map((memoId) => rows.results.find((row) => row.id === memoId))
    .filter((row): row is MemoDetailRow => Boolean(row));
  const notebookId = input.notebookId ?? ordered[0].notebook_id;
  const title = input.title || `合并笔记 ${new Date().toLocaleDateString("zh-CN")}`;
  const mergedMarkdown = ordered.map((memo) => memo.content_markdown).join("\n\n---\n\n");
  const contentJson = markdownToDoc(mergedMarkdown);
  const contentText = docToText(contentJson);
  const tags = Array.from(new Set(ordered.flatMap((memo) => parseJsonArray(memo.tags_json))));
  const excerpt = createExcerpt(contentText || title);
  const contentHash = await sha256(mergedMarkdown + JSON.stringify(contentJson));
  const newMemoId = createId("memo");
  const now = isoNow();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO memos (
        id, notebook_id, title, excerpt, tags_json, source_memo_ids, merge_source_count,
        created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'user', 'user', ?, ?)`
    ).bind(
      newMemoId,
      notebookId,
      title,
      excerpt,
      JSON.stringify(tags),
      JSON.stringify(uniqueMemoIds),
      uniqueMemoIds.length,
      now,
      now
    ),
    c.env.DB.prepare(
      `INSERT INTO memo_contents (
        memo_id, content_json, content_markdown, content_text, content_hash, revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
    ).bind(newMemoId, JSON.stringify(contentJson), mergedMarkdown, contentText, contentHash, now, now),
    c.env.DB.prepare(
      `INSERT INTO memos_fts (memo_id, title, content_text, tags)
       VALUES (?, ?, ?, ?)`
    ).bind(newMemoId, title, contentText, tags.join(" ")),
    c.env.DB.prepare(
      `UPDATE memos
       SET is_deleted = 1, deleted_at = ?, merged_into_memo_id = ?, merged_at = ?, updated_at = ?
       WHERE id IN (${placeholders})`
    ).bind(now, newMemoId, now, now, ...uniqueMemoIds),
    c.env.DB.prepare(
      `UPDATE resources
       SET original_memo_id = COALESCE(original_memo_id, memo_id),
           memo_id = ?,
           updated_at = ?
       WHERE memo_id IN (${placeholders})`
    ).bind(newMemoId, now, ...uniqueMemoIds),
    auditStatement(c.env.DB, "user", null, "memo.merge", "memo", newMemoId, {
      sourceMemoIds: uniqueMemoIds,
    }),
  ]);

  return c.json({ memo: await getMemoDetail(c.env.DB, newMemoId) }, 201);
});

app.all("/mcp", (c) =>
  c.json({
    name: "EdgeEver MCP endpoint",
    status: "planned",
    message: "Remote MCP will be wired to the same memo and notebook services as the REST API.",
    restBasePath: "/api/v1",
  })
);

app.notFound((c) =>
  c.json(
    {
      error: {
        code: "not_found",
        message: "Route not found",
      },
    },
    404
  )
);

export default app;

const mapNotebook = (row: NotebookRow): Notebook => ({
  id: row.id,
  parentId: row.parent_id,
  name: row.name,
  slug: row.slug,
  icon: row.icon,
  color: row.color,
  sortOrder: row.sort_order,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapMemoSummary = (row: MemoSummaryRow): MemoSummary => ({
  id: row.id,
  notebookId: row.notebook_id,
  title: row.title,
  excerpt: row.excerpt,
  tags: parseJsonArray(row.tags_json),
  isPinned: Boolean(row.is_pinned),
  isArchived: Boolean(row.is_archived),
  revision: row.revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapMemoDetail = (row: MemoDetailRow): MemoDetail => ({
  ...mapMemoSummary(row),
  contentJson: parseDoc(row.content_json),
  contentMarkdown: row.content_markdown,
  contentText: row.content_text,
  sourceMemoIds: parseJsonArray(row.source_memo_ids),
  mergeSourceCount: row.merge_source_count,
  mergedIntoMemoId: row.merged_into_memo_id,
});

const getNotebook = async (db: D1Database, id: string): Promise<Notebook | null> => {
  const row = await db
    .prepare(
      `SELECT id, parent_id, name, slug, icon, color, sort_order, created_at, updated_at
       FROM notebooks
       WHERE id = ? AND is_deleted = 0`
    )
    .bind(id)
    .first<NotebookRow>();

  return row ? mapNotebook(row) : null;
};

const getMemoDetailRow = async (db: D1Database, id: string): Promise<MemoDetailRow | null> =>
  db
    .prepare(
      `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
              m.is_archived, m.created_at, m.updated_at, c.revision,
              c.content_json, c.content_markdown, c.content_text, c.content_hash,
              m.source_memo_ids, m.merge_source_count, m.merged_into_memo_id
       FROM memos m
       INNER JOIN memo_contents c ON c.memo_id = m.id
       WHERE m.id = ? AND m.is_deleted = 0`
    )
    .bind(id)
    .first<MemoDetailRow>();

const getMemoDetail = async (db: D1Database, id: string): Promise<MemoDetail | null> => {
  const row = await getMemoDetailRow(db, id);
  return row ? mapMemoDetail(row) : null;
};

const parseJsonArray = (json: string): string[] => {
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
};

const parseDoc = (json: string): TiptapDoc => {
  try {
    const value = JSON.parse(json);
    return value && typeof value === "object" ? (value as TiptapDoc) : emptyDoc();
  } catch {
    return emptyDoc();
  }
};

const audit = async (
  db: D1Database,
  actorType: "user" | "agent" | "system",
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  metadata: unknown
) => auditStatement(db, actorType, actorId, action, entityType, entityId, metadata).run();

const auditStatement = (
  db: D1Database,
  actorType: "user" | "agent" | "system",
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  metadata: unknown
) =>
  db
    .prepare(
      `INSERT INTO audit_events (
        id, actor_type, actor_id, action, entity_type, entity_id, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(createId("audit"), actorType, actorId, action, entityType, entityId, JSON.stringify(metadata ?? {}), isoNow());

const createId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;

const isoNow = () => new Date().toISOString();

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const deriveTitle = (text: string) => {
  const title = text.trim().split(/\s+/).slice(0, 10).join(" ");
  return title || "Untitled memo";
};

const clampNumber = (value: number, min: number, max: number) => {
  if (Number.isNaN(value)) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
};

const toFtsQuery = (value: string) => {
  const tokens = value.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  return tokens.slice(0, 8).join(" ");
};

const sha256 = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const notFound = (c: Context, message: string) =>
  c.json(
    {
      error: {
        code: "not_found",
        message,
      },
    },
    404
  );
