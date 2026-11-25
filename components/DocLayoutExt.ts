import { Extension, Mark, Node, mergeAttributes } from "@tiptap/core";

/* DOC-15 in the editor · what the layout relies on survives an edit: the page marks (where each original page starts), centred and large
 * lines of a cover, lettered lists, numbered headings. Without these the editor would drop them at the first save of a chapter. */
const KEPT = /^(tc|fs[123]|nh|ol-(la|ua|lr|ur|d))$/;
export const KeepClass = Extension.create({
  name: "samKeepClass",
  addGlobalAttributes() {
    return [{ types: ["paragraph", "heading", "orderedList", "bulletList", "tableCell", "tableHeader"], attributes: { class: {
      default: null,
      parseHTML: (el: HTMLElement) => (el.getAttribute("class") ?? "").split(/\s+/).filter((x) => KEPT.test(x)).join(" ") || null,
      renderHTML: (a: { class?: string | null }) => (a.class ? { class: a.class } : {}),
    } } }];
  },
});
/** The mark where an original page starts: one block the writer can see, move past or delete, never type into. */
export const PageMark = Node.create({
  name: "pageMark", group: "block", atom: true, selectable: true, draggable: false,
  addAttributes() {
    const at = (name: string) => ({ default: "", parseHTML: (el: HTMLElement) => el.getAttribute(`data-${name}`) ?? "", renderHTML: (a: Record<string, string>) => ({ [`data-${name}`]: a[name] ?? "" }) });
    return { pg: at("pg"), date: at("date"), rev: at("rev") };
  },
  parseHTML() { return [{ tag: "div.pgmark" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes({ class: "pgmark" }, HTMLAttributes)]; },
});
/** The number of a numbered heading and the large words of a cover line. */
export const KeepSpan = Mark.create({
  name: "samSpan",
  addAttributes() { return { class: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("class"), renderHTML: (a: { class?: string | null }) => (a.class ? { class: a.class } : {}) } }; },
  parseHTML() { return [{ tag: "span", getAttrs: (el) => (/^(hn|fs[123])$/.test((el as HTMLElement).className) ? null : false) }]; },
  renderHTML({ HTMLAttributes }) { return ["span", HTMLAttributes, 0]; },
});
