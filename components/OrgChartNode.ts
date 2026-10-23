"use client";
import { Node } from "@tiptap/core";
import { orgChartSvg, parseSnapshot } from "@/lib/orgchart";

/** Editor block: an organisation chart from NP management, stored as a snapshot in the chapter (frozen with the revision). */
export const OrgChartNode = Node.create({
  name: "orgChart",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      entity: { default: "", parseHTML: (el: HTMLElement) => el.getAttribute("data-sam-orgchart") ?? "", renderHTML: (a: Record<string, unknown>) => ({ "data-sam-orgchart": a.entity }) },
      snapshot: { default: "", parseHTML: (el: HTMLElement) => el.getAttribute("data-snapshot") ?? "", renderHTML: (a: Record<string, unknown>) => ({ "data-snapshot": a.snapshot }) },
    };
  },
  parseHTML() { return [{ tag: "div[data-sam-orgchart]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", HTMLAttributes]; },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("figure");
      dom.className = "orgchart editing";
      const snap = parseSnapshot(node.attrs.snapshot as string);
      dom.innerHTML = orgChartSvg(snap) + `<figcaption>Organisation chart · ${snap?.entity ?? ""} · from NP management${snap?.at ? `, ${snap.at}` : ""} — select it and press Delete to remove, or insert it again to update</figcaption>`;
      return { dom };
    };
  },
});
