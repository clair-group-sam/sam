"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icons";
import { ENT, ENT_COLOR, RAIL_BOTTOM, RAIL_DAILY, modLabel, roleModules, subLabel, subsFor, type Module, type RoleKey } from "@/lib/nav";
import type { Session } from "@/lib/session";

type Props = { session: Session; children: React.ReactNode };

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
  // compact mode: rail = icons only, sub-menu hidden; both expand on hover as overlays. Remembered per browser.
  const [compact, setCompact] = useState(false);
  // hover with a short opening delay (no accidental flashes) and a longer closing delay (smooth exit)
  const rail = useDelayedHover(120, 450);
  const subH = useDelayedHover(80, 450);
  useEffect(() => { try { setCompact(localStorage.getItem("sam_compact") === "1"); } catch {} }, []);
  const toggleCompact = () => setCompact((v) => { const n = !v; try { localStorage.setItem("sam_compact", n ? "1" : "0"); } catch {} return n; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { const t = e.target as HTMLElement; if (e.key === "[" && !["INPUT", "TEXTAREA"].includes(t?.tagName) && !t?.isContentEditable) toggleCompact(); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);
  const subs = subsFor(role, mod).filter((s) => !s.hidden || s.id === sub);
  const curMod = mods.find((m) => m.id === mod);
  const curSub = subs.find((s) => s.id === sub);

  const SubMenu = ({ cls, onEnter }: { cls: string; onEnter?: () => void }) => (
    <aside className={cls} onMouseEnter={onEnter}>
      <div className="h">{curMod ? modLabel(role, curMod) : mod}</div>
      {subs.map((s) => (
        <Link key={s.id} href={`/${mod}/${s.id}`} className={"sl" + (sub === s.id ? " on" : "") + (s.gear ? " gear" : "")}>
          {subLabel(role, mod, s)}
        </Link>
      ))}
    </aside>
  );

  return (
    <div className={"flex h-screen overflow-hidden" + (compact ? " compact" : "")}>
      <div className={"sidewrap" + (compact ? " compact-w" : "")} style={compact ? { width: subs.length > 0 ? 88 : 62 } : undefined}
        onMouseLeave={() => { rail.leave(); subH.leave(); }}>
      <nav className={"rail" + (compact ? (rail.on ? " mini hover" : " mini") : "")} onMouseEnter={() => { if (compact) { rail.enter(); subH.leave(); } }}>
        <Link href={session.home} className="brand">
          <img src="/logos/sam.svg" alt="" width={56} height={52} />
          <b>S.A.M.</b><span>Safety · Assurance · Management</span>
        </Link>
        <div className="flex-1 overflow-y-auto">
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
        <div className="railbottom">
          <button type="button" className={"rl lockrow" + (compact ? "" : " locked")} onClick={toggleCompact} aria-pressed={!compact}
            title={compact ? "Menus collapse automatically — click to lock them open  [" : "Menus locked open — click to let them collapse automatically  ["}>
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
        <TopBar session={session} crumb={[curMod ? modLabel(role, curMod) : mod, curSub ? subLabel(role, mod, curSub) : sub]} />
        {session.entity === "ALL" && <div className="groupband"><b>Group view</b> — lists show every entity in your scope ({session.entities.join(" · ")}). Pick an entity at the top-left to work on its documents, projects and files.</div>}
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

function TopBar({ session, crumb }: { session: Session; crumb: [string, string] }) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  // UX-03 §7: one "+ Create" for the office — what exists opens, what is not built yet is listed greyed with its step
  const [create, setCreate] = useState(false);
  const canCreateFile = session.role !== "user";
  const CREATE: { label: string; href?: string; hint: string }[] = [
    { label: "Project", href: canCreateFile ? "/proj/boards/new" : undefined, hint: "aircraft addition, NP change, new approval… blank or from a template" },
    { label: "Authority file", href: canCreateFile ? "/proj/auth/new" : undefined, hint: "application, notification, report to the authority" },
    { label: "Manual or internal document", href: "/docs/new", hint: "a new manual in the library" },
    { label: "To-do", href: "/home/todo", hint: "personal reminder" },
    { label: "Finding", hint: "Compliance — step 6" },
    { label: "Action", hint: "Compliance — step 6" },
    { label: "Safety report", hint: "Safety — step 5" },
    { label: "Communication", hint: "Communication module" },
  ];
  // the working entity: one at a time, always shown in full at the top-left; group view only for group functions
  const [entOpen, setEntOpen] = useState(false);
  const choices = session.entities;
  const cur = session.entity;
  const curName = cur === "ALL" ? "Group view" : ENT[cur]?.name ?? cur;
  const curSub = cur === "ALL" ? `all entities · ${choices.join(" · ")}` : `${cur} · ${ENT[cur]?.qual ?? ""} · ${ENT[cur]?.auth ?? ""}`;
  async function pick(ent: string) {
    setEntOpen(false);
    await fetch("/api/ent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ent }) });
    router.refresh();
  }
  return (
    <header className={"topbar ent-" + cur} style={{ borderBottomColor: ENT_COLOR[cur] ?? "var(--line)" }}>
      <div className="relative">
        <button type="button" className={"entblock " + cur} onClick={() => choices.length > 1 || session.group ? setEntOpen((v) => !v) : undefined} aria-expanded={entOpen} title={choices.length > 1 ? "Change the entity you work in" : undefined}>
          <i className="entdot" style={{ background: ENT_COLOR[cur] }} />
          <span className="enttext"><b>{curName}</b><small>{curSub}</small></span>
          {(choices.length > 1 || session.group) && <span className="caret">▾</span>}
        </button>
        {entOpen && (
          <div className="menu entmenu" onMouseLeave={() => setEntOpen(false)}>
            <div className="mi muted">Work in</div>
            {choices.map((e) => (
              <button key={e} type="button" className={"mi entmi" + (cur === e ? " on" : "")} onClick={() => pick(e)}>
                <i className="entdot" style={{ background: ENT_COLOR[e] }} /><span><b>{ENT[e]?.name ?? e}</b><small>{e} · {ENT[e]?.qual} · {ENT[e]?.auth}</small></span>
              </button>
            ))}
            {session.group && <button type="button" className={"mi entmi" + (cur === "ALL" ? " on" : "")} onClick={() => pick("ALL")}><i className="entdot" style={{ background: ENT_COLOR.ALL }} /><span><b>Group view</b><small>lists across every entity — dashboards, projects, authority files, library</small></span></button>}
          </div>
        )}
      </div>
      <div className="crumb"><b>{crumb[0]}</b>{crumb[1] && <> · <span>{crumb[1]}</span></>}</div>
      <div className="flex-1" />
      <div className="searchbox"><Icon name="search" size={14} /><span>Search</span><kbd>Ctrl K</kbd></div>
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
          <span className="avatar">{session.initials}</span>
          <span className="who"><b>{session.name}</b><small>{session.person?.job_title ?? roleTitle(session)}</small></span>
          <span className="caret">▾</span>
        </button>
        {menu && (
          <div className="menu" onMouseLeave={() => setMenu(false)}>
            <div className="mi muted">{session.email}</div>
            <div className="mi muted">Scope: {session.group ? "Group function" : session.entities.join(", ") || "none"} · roles: {session.roles.join(", ") || "none"}</div>
            <Link href="/api/me" className="mi" target="_blank">My access (JSON)</Link>
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
