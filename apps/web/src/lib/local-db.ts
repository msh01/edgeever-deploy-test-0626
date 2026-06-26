import type { TiptapDoc } from "@edgeever/shared";
import Dexie, { type Table } from "dexie";

export type LocalDraft = {
  memoId: string;
  title: string;
  contentJson: TiptapDoc;
  tagsText: string;
  updatedAt: string;
};

class EdgeEverLocalDb extends Dexie {
  drafts!: Table<LocalDraft, string>;

  constructor() {
    super("edgeever-local");
    this.version(1).stores({
      drafts: "memoId, updatedAt",
    });
  }
}

export const localDb = new EdgeEverLocalDb();
