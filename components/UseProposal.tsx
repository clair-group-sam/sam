"use client";
/* 10/11 · S.A.M.'s proposed root cause: shown after « Save and get S.A.M.'s remarks », copied into the field only if the author clicks. */
export function UseProposal({ text, field = "root_cause" }: { text: string; field?: string }) {
  const use = (mode: "replace" | "append") => {
    const el = document.querySelector<HTMLTextAreaElement>(`textarea[name="${field}"]`); if (!el) return;
    el.value = mode === "append" && el.value.trim() ? `${el.value.trim()}\n\n${text}` : text; el.focus(); el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  return <span className="flex gap-2"><button type="button" className="btn sm" onClick={() => use("replace")}>Use this proposal</button><button type="button" className="btn sm" onClick={() => use("append")}>Add it to my text</button></span>;
}
