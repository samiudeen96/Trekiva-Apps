import { describe, expect, it } from "vitest";
import { COALESCE_MS, MAX_HISTORY, pushEdit, redoEdit, startHistory, undoEdit } from "./history";

describe("editor history", () => {
  it("undoes and redoes edits made apart", () => {
    let h = startHistory("a");
    h = pushEdit(h, "b", 1_000);
    h = pushEdit(h, "c", 1_000 + COALESCE_MS + 1);
    expect(h.present).toBe("c");
    h = undoEdit(h);
    expect(h.present).toBe("b");
    h = undoEdit(h);
    expect(h.present).toBe("a");
    expect(undoEdit(h)).toBe(h);
    h = redoEdit(redoEdit(h));
    expect(h.present).toBe("c");
    expect(redoEdit(h)).toBe(h);
  });

  it("treats a burst of typing as one step", () => {
    let h = startHistory("");
    h = pushEdit(h, "h", 5_000); // first edit always opens a step
    h = pushEdit(h, "he", 5_100);
    h = pushEdit(h, "hel", 5_200);
    h = pushEdit(h, "hell", 5_300);
    expect(h.past).toEqual([""]);
    expect(undoEdit(h).present).toBe("");
  });

  it("a new edit after an undo drops the redo branch, and never merges into the undone step", () => {
    let h = startHistory("a");
    h = pushEdit(h, "b", 1_000);
    h = pushEdit(h, "c", 3_000);
    h = undoEdit(h);
    h = pushEdit(h, "d", 3_050);
    expect(h.future).toEqual([]);
    expect(h.past).toEqual(["a", "b"]);
    expect(undoEdit(h).present).toBe("b");
  });

  it("ignores a no-op edit and keeps a bounded history", () => {
    const h = startHistory("a");
    expect(pushEdit(h, "a", 1)).toBe(h);
    let big = startHistory(0);
    for (let i = 1; i <= MAX_HISTORY + 20; i++) big = pushEdit(big, i, i * 10_000);
    expect(big.past).toHaveLength(MAX_HISTORY);
    expect(big.present).toBe(MAX_HISTORY + 20);
  });
});
