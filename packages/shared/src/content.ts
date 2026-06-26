export type TiptapTextNode = {
  type: "text";
  text: string;
};

export type TiptapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Array<TiptapNode | TiptapTextNode>;
};

export type TiptapDoc = {
  type: "doc";
  content: TiptapNode[];
};

export const emptyDoc = (): TiptapDoc => ({
  type: "doc",
  content: [{ type: "paragraph" }],
});

export const markdownToDoc = (markdown: string): TiptapDoc => {
  const blocks = markdown
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length === 0) {
    return emptyDoc();
  }

  return {
    type: "doc",
    content: blocks.map((block) => {
      const heading = /^(#{1,3})\s+(.+)$/.exec(block);

      if (heading) {
        return {
          type: "heading",
          attrs: { level: heading[1].length },
          content: [{ type: "text", text: heading[2] }],
        };
      }

      return {
        type: "paragraph",
        content: [{ type: "text", text: block }],
      };
    }),
  };
};

export const docToText = (doc: unknown): string => {
  const pieces: string[] = [];

  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") {
      return;
    }

    const current = node as { text?: unknown; content?: unknown };

    if (typeof current.text === "string") {
      pieces.push(current.text);
    }

    if (Array.isArray(current.content)) {
      for (const child of current.content) {
        walk(child);
      }
    }
  };

  walk(doc);

  return pieces.join(" ").replace(/\s+/g, " ").trim();
};

export const docToMarkdown = (doc: unknown): string => {
  if (!doc || typeof doc !== "object") {
    return "";
  }

  const root = doc as { content?: unknown };

  if (!Array.isArray(root.content)) {
    return "";
  }

  return root.content
    .map((node) => {
      if (!node || typeof node !== "object") {
        return "";
      }

      const current = node as {
        type?: unknown;
        attrs?: { level?: unknown };
        content?: unknown;
      };
      const text = docToText({ content: current.content });

      if (!text) {
        return "";
      }

      if (current.type === "heading") {
        const level = typeof current.attrs?.level === "number" ? current.attrs.level : 1;
        return `${"#".repeat(Math.min(Math.max(level, 1), 6))} ${text}`;
      }

      return text;
    })
    .filter(Boolean)
    .join("\n\n");
};

export const createExcerpt = (text: string, maxLength = 30): string => {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
};

export const normalizeTags = (tags: unknown): string[] => {
  if (!Array.isArray(tags)) {
    return [];
  }

  return Array.from(
    new Set(
      tags
        .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
        .filter(Boolean)
        .map((tag) => tag.replace(/^#/, ""))
    )
  ).slice(0, 24);
};
