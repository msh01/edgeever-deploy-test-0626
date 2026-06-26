import type { Notebook } from "@edgeever/shared";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export type NotebookNode = Notebook & {
  children: NotebookNode[];
};

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const buildNotebookTree = (notebooks: Notebook[]): NotebookNode[] => {
  const nodes = new Map<string, NotebookNode>();

  for (const notebook of notebooks) {
    nodes.set(notebook.id, { ...notebook, children: [] });
  }

  const roots: NotebookNode[] = [];

  for (const node of nodes.values()) {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId)?.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (items: NotebookNode[]) => {
    items.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    items.forEach((item) => sortNodes(item.children));
  };

  sortNodes(roots);
  return roots;
};

export const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export const parseTagsText = (value: string) =>
  value
    .split(/[,，\s]+/)
    .map((tag) => tag.trim().replace(/^#/, ""))
    .filter(Boolean);
