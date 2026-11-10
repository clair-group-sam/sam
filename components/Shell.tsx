"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icons";
import { ENT, ENT_COLOR, entMode, singleEntity, type EntMode, RAIL_BOTTOM, RAIL_DAILY, modLabel, roleModules, subLabel, subsFor, isBuilt, type Module, type RoleKey } from "@/lib/nav";
import type { Session } from "@/lib/session";

type Props = { session: Session; children: React.ReactNode };

// Entity switch animation (09/11): ~0.4 s, all three moves in the direction of travel. The switch still reloads the page (FB-048);
// the reload waits for both the request and the animation, whichever ends last.
const ENT_ANIM_MS = 420;
const ENT_ARRIVE = `try{var d=sessionStorage.getItem("sam_entdir");if(d){sessionStorage.removeItem("sam_entdir");if(!matchMedia("(prefers-reduced-motion: reduce)").matches){var s=document.createElement("style");s.textContent="main{animation:entarrive-"+(d==="l"?"l":"r")+" 300ms cubic-bezier(.2,.8,.3,1) both}";document.head.appendChild(s);setTimeout(function(){s.remove()},700)}}}catch(e){}`;

// Menu pill (09/11): the highlight of the current menu / sub-menu item slides up or down to the new one, frosted on the way,
// like the entity switch. Last positions live outside React because the sub-menu is re-mounted on every render.
const PILL_LAST = new Map<string, { y: number; h: number; x: number; w: number }>();
function useSlidePill(key: string, dep: string, sel: string) {
  const box = useRef<HTMLDivElement | null>(null);
  const pill = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    const b = box.current, p = pill.current; if (!b || !p) return;
    let timer = 0;
    const measure = () => {
      const on = b.querySelector<HTMLElement>(sel); if (!on) return null;
      const br = b.getBoundingClientRect(), r = on.getBoundingClientRect();
      return { y: r.top - br.top + b.scrollTop, h: r.height, x: r.left - br.left, w: r.width };
    };
    const set = (r: { y: number; h: number; x: number; w: number }) => { p.style.transform = `translate(${r.x}px,${r.y}px)`; p.style.width = r.w + "px"; p.style.height = r.h + "px"; };
    const place = (animate: boolean) => {
      const r = measure();
      if (!r) { b.classList.remove("pilled"); PILL_LAST.delete(key); return; }
      const prev = PILL_LAST.get(key);
      // a resize that leaves the item where it is must not cut a slide in progress
      if (!animate && prev && prev.y === r.y && prev.h === r.h && prev.x === r.x && prev.w === r.w && b.classList.contains("pilled")) return;
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (animate && prev && !still && (prev.y !== r.y || prev.h !== r.h)) {
        p.style.transition = "none"; set(prev); void p.offsetWidth; p.style.transition = "";
        p.classList.add("moving"); b.classList.add("sliding"); set(r);
        window.clearTimeout(timer); timer = window.setTimeout(() => { p.classList.remove("moving"); b.classList.remove("sliding"); }, 300);
      } else { p.style.transition = "none"; set(r); void p.offsetWidth; p.style.transition = ""; }
      b.classList.add("pilled");
      PILL_LAST.set(key, r);
    };
    place(true);
    const ro = new ResizeObserver(() => place(false)); ro.observe(b);
    return () => { ro.disconnect(); window.clearTimeout(timer); };
  }, [key, dep]);
  return { box, pill };
}

export default function Shell({ session, children }: Props) {
  const path = usePathname();
  const [, mod = "home", sub = ""] = path.split("/");
  const role: RoleKey = session.role;
  const mods = roleModules(role);
  const daily = mods.filter((m) => RAIL_DAILY.includes(m.id) && !m.erp);
  const rare = mods.filter((m) => !RAIL_DAILY.includes(m.id) && !RAIL_BOTTOM.includes(m.id) && !m.erp);
  const erp = mods.find((m) => m.erp);
  const bottom = mods.filter((m) => RAIL_BOTTOM.includes(m.id));
  const inRare = rare.some((m) => m.id === mod);
  const [more, setMore] = useState(inRare);
  useEffect(() => { if (inRare) setMore(true); }, [inRare]);
  // every form shows it is working once sent (its submit button dims, cursor "progress") until the page answers
  useEffect(() => {
    const on = (e: Event) => { const f = e.target as HTMLFormElement; if (f?.tagName !== "FORM" || f.method === "get") return; f.setAttribute("aria-busy", "true");
      const t0 = Date.now(); const done = () => { f.removeAttribute("aria-busy"); mo.disconnect(); };
      const mo = new MutationObserver(() => { if (Date.now() - t0 > 400) done(); }); // the page re-rendered with the answer
      mo.observe(document.body, { childList: true, subtree: true, characterData: true }); window.setTimeout(done, 20000); };
    document.addEventListener("submit", on, true);
    return () => document.removeEventListener("submit", on, true);
  }, []);
  useEffect(() => { document.querySelectorAll('form[aria-busy="true"]').forEach((f) => f.removeAttribute("aria-busy")); }, [path]);
  // compact mode: rail = icons only, sub-menu hidden; both expand on hover as overlays. Remembered per browser.
  const [compact, setCompact] = useState(false);
  // hover with a short opening delay (no accidental flashes) and a longer closing delay (smooth exit)
  const rail = useDelayedHover(120, 450);
  const subH = useDelayedHover(80, 450);
  // FB-027 · on an iPad / narrow window with no saved choice, start compact (icons only) so the page keeps its width
  // Under 1100 px (iPad) the menus always collapse, whatever was saved: the page needs the width more than the labels do.
  useEffect(() => {
    const apply = () => { try { const v = localStorage.getItem("sam_compact"); setCompact(window.innerWidth < 1100 || (v === null ? window.innerWidth < 1200 : v === "1")); } catch {} };
    apply(); window.addEventListener("resize", apply); return () => window.removeEventListener("resize", apply);
  }, []);
  const toggleCompact = () => setCompact((v) => { const n = !v; try { localStorage.setItem("sam_compact", n ? "1" : "0"); } catch {} return n; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "[" && !["INPUT", "TEXTAREA"].includes(t?.tagName) && !t?.isContentEditable) toggleCompact();
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);
  const subs = subsFor(role, mod).filter((s) => !s.hidden || s.id === sub);
  const curMod = mods.find((m) => m.id === mod);
  const curSub = subs.find((s) => s.id === sub);
  const railPill = useSlidePill("rail", mod + "|" + more, ".rl.on"), bottomPill = useSlidePill("railb", mod, ".rl.on");
  // 09/11 · Group only where it means something (lib/nav.ts entMode): on a one-entity page a group user works in their home entity
  const eMode = entMode(path);
  const entAuto = session.entityPref === "ALL" && eMode === "single";
  const ent = entAuto ? singleEntity(session.person?.home_entity, session.entities) : session.entityPref;

  const SubMenu = ({ cls, onEnter }: { cls: string; onEnter?: () => void }) => {
    const sp = useSlidePill("sub:" + mod, sub, ".sl.on");
    return (
    <aside className={cls + " menupills"} onMouseEnter={onEnter} ref={sp.box}>
      <span className="spill" ref={sp.pill} aria-hidden />
      <div className="h">{curMod ? modLabel(role, curMod) : mod}</div>
      {subs.map((s) => (
        <Link key={s.id} href={`/${mod}/${s.id}`} className={"sl" + (sub === s.id ? " on" : "") + (s.gear ? " gear" : "") + (isBuilt(mod, s.id) ? "" : " soon")} title={isBuilt(mod, s.id) ? undefined : "Not built yet, exists in the prototype"}>
          {subLabel(role, mod, s)}{!isBuilt(mod, s.id) && <small className="soon-tag">soon</small>}
        </Link>
      ))}
    </aside>
    );
  };

  return (
    <div className={"flex h-screen overflow-hidden" + (compact ? " compact" : "")} data-ent={ent}>
      <div className={"sidewrap" + (compact ? " compact-w" : "")} style={compact ? { width: subs.length > 0 ? 88 : 62 } : undefined}
        onMouseLeave={() => { rail.leave(); subH.leave(); }}>
      <nav className={"rail" + (compact ? (rail.on ? " mini hover" : " mini") : "")} onMouseEnter={() => { if (compact) { rail.enter(); subH.leave(); } }}>
        <Link href={session.home} className="brand" aria-label="S.A.M. — Safety · Assurance · Management">
          <img src="/logos/sam.svg" alt="" width={64} height={58} />
          {/* the three words in a column: their initials spell S·A·M */}
          <span className="acro" aria-hidden="true"><span><b>S</b>afety</span><span><b>A</b>ssurance</span><span><b>M</b>anagement</span></span>
        </Link>
        <div className="flex-1 overflow-y-auto menupills" ref={railPill.box}>
          <span className="mpill" ref={railPill.pill} aria-hidden />
          {daily.map((m) => <RailLink key={m.id} m={m} role={role} on={mod === m.id} />)}
          {erp && <RailLink m={erp} role={role} on={mod === "erp"} />}
          {rare.length > 0 && (
            <div className={"morebox" + (more ? " open" : "")}>
              <button type="button" className="rl more" onClick={() => setMore((v) => !v)} aria-expanded={more}>
                <Icon name="more" size={14} className={"chev" + (more ? " rot" : "")} /><span>More</span>
              </button>
              {more && rare.map((m) => <RailLink key={m.id} m={m} role={role} on={mod === m.id} small />)}
            </div>
          )}
        </div>
        <div className="railbottom menupills" ref={bottomPill.box}>
          <span className="mpill" ref={bottomPill.pill} aria-hidden />
          <button type="button" className={"rl lockrow" + (compact ? "" : " locked")} onClick={toggleCompact} aria-pressed={!compact}
            title={compact ? "Menus collapse automatically, click to lock them open  [" : "Menus locked open, click to let them collapse automatically  ["}>
            <LockIcon locked={!compact} /><span>Lock menus</span><i className={"tgl" + (compact ? "" : " on")} aria-hidden />
          </button>
          {bottom.map((m) => <RailLink key={m.id} m={m} role={role} on={mod === m.id} />)}
        </div>
      </nav>

      {subs.length > 0 && compact && (
        <div className="subwrap">
          <div className="substrip" onMouseEnter={subH.enter} onClick={subH.toggle} title={curMod ? modLabel(role, curMod) : mod}>
            <span className="vtext">{curMod ? modLabel(role, curMod) : mod}</span>
          </div>
          <SubMenu cls={"sub overlay" + (subH.on ? " show" : "")} onEnter={subH.enter} />
        </div>
      )}
      {subs.length > 0 && !compact && <SubMenu cls="sub" />}
      </div>

      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar session={session} ent={ent} mode={eMode} crumb={[curMod ? modLabel(role, curMod) : mod, curSub ? subLabel(role, mod, curSub) : sub]} />
        {ent === "ALL" && eMode === "group" && <div className="groupband"><b>Group view</b>: lists show every entity in your scope ({session.entities.join(", ")}). Pick an entity at the top to work on its documents, projects and files.</div>}
        {entAuto && <div className="groupband"><b>{ENT[ent]?.name ?? ent} ({ent})</b>: this page works one entity at a time, so the group view gives way to your home entity here. Pick another entity at the top if needed; the overviews and lists stay in group view.</div>}
        {/* entity switch, after the reload: the new page slides in from the side the click went to. Runs while the HTML is parsed,
            before <main> paints, so the page never shows, vanishes and comes back. A <style> in <head>, not an attribute, so hydration sees nothing. */}
        <script dangerouslySetInnerHTML={{ __html: ENT_ARRIVE }} />
        <main className="flex-1 overflow-y-auto px-8 py-7">{children}</main>
      </div>
    </div>
  );
}

function RailLink({ m, role, on, small }: { m: Module; role: RoleKey; on: boolean; small?: boolean }) {
  return (
    <Link href={`/${m.id}`} className={"rl" + (on ? " on" : "") + (m.erp ? " erp" : "") + (small ? " sm" : "")} title={modLabel(role, m)}>
      <Icon name={m.icon} size={small ? 16 : 18} /><span>{modLabel(role, m)}</span>
    </Link>
  );
}

function TopBar({ session, ent, mode, crumb }: { session: Session; ent: string; mode: EntMode; crumb: [string, string] }) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  // UX-03 §7: one "+ Create" for the office — what exists opens, what is not built yet is listed greyed with its step
  const [create, setCreate] = useState(false);
  const canCreateFile = session.role !== "user";
  const CREATE: { label: string; href?: string; hint: string }[] = [
    { label: "Project", href: canCreateFile ? "/proj/boards/new" : undefined, hint: "aircraft addition, NP change, new approval… blank or from a template" },
    { label: "CAA application", href: canCreateFile ? "/proj/auth/new" : undefined, hint: "application, notification, report to the authority" },
    { label: "Manual or internal document", href: "/docs/new", hint: "a new manual in the library" },
    { label: "Finding", href: session.role === "cmm" ? "/comp/find/new" : undefined, hint: session.role === "cmm" ? "authority or internal audit finding, answered by a nominated person" : "raised by the Compliance department" },
    { label: "Safety report", href: "/safe/new", hint: "occurrence, hazard, anything that could affect safety" },
    { label: "Safety action", href: canCreateFile ? "/safe/actions/new" : undefined, hint: "corrective or preventive action, with an owner and a due date" },
    { label: "Management of change", href: canCreateFile ? "/safe/moc/new" : undefined, hint: "a change with its risk assessment" },
    { label: "Communication", href: canCreateFile ? "/comm/new" : undefined, hint: "message to the staff, acknowledged one by one" },
  ];
  // the working entity: one at a time, always shown in full at the top-left; group view only for group functions
  const [entOpen, setEntOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  // DA v3 (06/11): the search is a button until used, so the bar holds at 1440 px; Ctrl / ⌘ K opens it
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => { if (searchOpen) { searchRef.current?.focus(); searchRef.current?.select(); } }, [searchOpen]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // FB-028 · Ctrl / ⌘ K focuses the search (full text of the published manuals) instead of doing nothing
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearchOpen(true); searchRef.current?.focus(); searchRef.current?.select(); }
      // FB-021 · Escape closes the open menus
      if (e.key === "Escape") { setCreate(false); setMenu(false); setEntOpen(false); setSearchOpen(false); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);
  const choices = session.entities;
  const cur = ent;
  // the buttons: Group only where the page can show every entity; none of them on a page that does not depend on the entity
  const list = [...choices, ...(session.group && mode !== "single" ? ["ALL"] : [])];
  const idle = mode === "none";
  const curName = cur === "ALL" ? "Group view" : ENT[cur]?.name ?? cur;
  const curSub = cur === "ALL" ? `lists across every entity, ${choices.join(", ")}` : `${ENT[cur]?.qual ?? ""}, ${ENT[cur]?.auth ?? ""}`;
  // the switch in motion: the white pill slides (frosted on the way), the new colour sweeps the bar, the page leaves sideways
  const switchRef = useRef<HTMLElement | null>(null);
  const [going, setGoing] = useState<null | { ent: string; dir: "l" | "r"; x0: number; w0: number; x1: number; w1: number }>(null);
  async function pick(ent: string) {
    if (going) return;
    setEntOpen(false);
    const order = list;
    const dir = order.indexOf(ent) >= order.indexOf(cur) ? "r" : "l";
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const btns = switchRef.current ? [...switchRef.current.querySelectorAll<HTMLButtonElement>("button")] : [];
    const from = btns[order.indexOf(cur)], to = btns[order.indexOf(ent)];
    if (!still && from && to) {
      setGoing({ ent, dir, x0: from.offsetLeft, w0: from.offsetWidth, x1: to.offsetLeft, w1: to.offsetWidth });
      const main = document.querySelector("main"); if (main) main.dataset.entleave = dir;
      try { sessionStorage.setItem("sam_entdir", dir); } catch {}
    }
    const wait = new Promise((r) => setTimeout(r, still ? 0 : ENT_ANIM_MS));
    await Promise.all([fetch("/api/ent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ent }) }), wait]);
    // FB-048 · a full reload: router.refresh() only re-renders the current route, and pages prefetched or cached under the
    // previous entity were served later (the entity "flipped" after a server action). Nothing of the old entity may survive.
    window.location.reload();
  }
  return (
    <header className={"topbar ent-" + cur} style={{ ["--entc" as string]: ENT_COLOR[cur] ?? "var(--navy-ink)" } as React.CSSProperties}>
      {going && <span className={"entwipe " + going.dir} aria-hidden style={{ ["--entc" as string]: ENT_COLOR[going.ent] ?? "var(--navy-ink)" } as React.CSSProperties} />}
      <div className="entid" title={curSub}>
        {!(choices.length > 1 || session.group) && <span className="entcode">{cur}</span>}
        {going ? (
          <span key="to" className={"enttext entin-" + going.dir}><b>{going.ent === "ALL" ? "Group view" : ENT[going.ent]?.name ?? going.ent}</b>
            <small>{going.ent === "ALL" ? `lists across every entity, ${choices.join(", ")}` : `${ENT[going.ent]?.qual ?? ""}, ${ENT[going.ent]?.auth ?? ""}`}</small></span>
        ) : (
          <span key="cur" className="enttext"><b>{curName}</b><small>{curSub}</small></span>
        )}
      </div>
      {(choices.length > 1 || session.group) && (
        <nav ref={switchRef} className={"entswitch" + (going ? " moving" : "") + (idle ? " idle" : "")} aria-label="Entity you work in" aria-busy={going ? true : undefined}
          title={idle ? "This page does not depend on the entity" : undefined}>
          {going && <span className="entpill" aria-hidden style={{ ["--x0" as string]: going.x0 + "px", ["--w0" as string]: going.w0 + "px", ["--x1" as string]: going.x1 + "px", ["--w1" as string]: going.w1 + "px" } as React.CSSProperties} />}
          {list.map((e) => {
            const on = going ? going.ent === e : cur === e;
            return <button key={e} type="button" className={on ? "on" : ""} aria-pressed={on}
              style={going && on ? { ["--entc" as string]: ENT_COLOR[e] ?? "var(--navy-ink)" } as React.CSSProperties : undefined}
              disabled={idle} title={idle ? "This page does not depend on the entity" : e === "ALL" ? "Group view: overviews and lists across every entity" : `${ENT[e]?.name ?? e}, ${ENT[e]?.qual ?? ""}, ${ENT[e]?.auth ?? ""}`}
              onClick={() => cur !== e && pick(e)}>{e === "ALL" ? "Group" : e}</button>;
          })}
        </nav>
      )}
      <div className="topsearch">
      {searchOpen ? (
        <form className="searchbox" action="/docs/lib" method="get" role="search" title="Search the published manuals (title, chapter or text)" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null) && !searchRef.current?.value) setSearchOpen(false); }}>
          <Icon name="search" size={14} /><input ref={searchRef} name="q" placeholder="Search manuals" aria-label="Search the manuals" /><kbd>Ctrl K</kbd>
        </form>
      ) : (
        <button type="button" className="searchbtn" onClick={() => setSearchOpen(true)} title="Search the published manuals (title, chapter or text)"><Icon name="search" size={14} /> Search <kbd>Ctrl K</kbd></button>
      )}
      </div>
      {session.role !== "user" && (
        <div className="relative">
          <button type="button" className="btn primary" onClick={() => setCreate((v) => !v)} aria-expanded={create}><Icon name="plus" size={14} /> Create</button>
          {create && (
            <div className="menu" style={{ width: 300 }} onMouseLeave={() => setCreate(false)}>
              {CREATE.map((c) => c.href ? (
                <button key={c.label} type="button" className="mi" onClick={() => { setCreate(false); router.push(c.href!); }}><b>{c.label}</b><small style={{ display: "block", color: "var(--slate6)", fontSize: 11.5 }}>{c.hint}</small></button>
              ) : (
                <div key={c.label} className="mi muted" style={{ fontStyle: "italic" }}>{c.label}<small style={{ display: "block", fontSize: 11 }}>{c.hint}</small></div>
              ))}
            </div>
          )}
        </div>
      )}
      <Link href="/erp/activate" className="btn erp">ERP</Link>
      <div className="relative">
        <button type="button" className="user" onClick={() => setMenu((v) => !v)}>
          <span className="avatar" title={`${session.name}, ${session.person?.job_title ?? roleTitle(session)}`}>{session.initials}</span>
          <span className="sr-only">{session.name}</span>
        </button>
        {menu && (
          <div className="menu" onMouseLeave={() => setMenu(false)}>
            <div className="mi" style={{ cursor: "default" }}><b>{session.name}</b><small style={{ display: "block", color: "var(--slate6)" }}>{session.person?.job_title ?? roleTitle(session)}</small></div>
            <div className="mi muted">{session.email}</div>
            <div className="mi muted">Scope: {session.group ? "Group function" : session.entities.join(", ") || "none"}. Roles: {session.roles.join(", ") || "none"}</div>
            <Link href="/api/me" className="mi" target="_blank">My access rights</Link>
            <form action="/auth/signout" method="post"><button type="submit" className="mi">Sign out</button></form>
          </div>
        )}
      </div>
    </header>
  );
}
function roleTitle(s: Session): string {
  return s.role === "cmm" ? "CMM / SM" : s.role === "am" ? "Accountable Manager" : s.role === "np" ? "Nominated person" : (s.entities[0] ? ENT[s.entities[0]]?.name ?? "" : "");
}

function useDelayedHover(openMs: number, closeMs: number) {
  const [on, setOn] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => { if (t.current) { clearTimeout(t.current); t.current = null; } };
  useEffect(() => clear, []);
  return {
    on,
    enter: () => { clear(); if (!on) t.current = setTimeout(() => setOn(true), openMs); },
    leave: () => { clear(); t.current = setTimeout(() => setOn(false), closeMs); },
    toggle: () => { clear(); setOn((v) => !v); },
  };
}

function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="8" y="11" width="12" height="9" rx="2" />
      {locked ? <path d="M10.5 11V8a3.5 3.5 0 0 1 7 0v3" /> : <path d="M10.5 11V8a3.5 3.5 0 0 1 6.6-1.6" />}
      {!locked && <path d="M5.5 13.5l-2.5 2 2.5 2M3 15.5h3.5" />}
    </svg>
  );
}
