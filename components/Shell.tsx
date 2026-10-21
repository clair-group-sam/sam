"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/lib/icons";
import { ENT, RAIL_BOTTOM, RAIL_DAILY, modLabel, roleModules, subLabel, subsFor, type Module, type RoleKey } from "@/lib/nav";
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
  const [railHover, setRailHover] = useState(false);
  const [subHover, setSubHover] = useState(false);
  useEffect(() => { try { setCompact(localStorage.getItem("sam_compact") === "1"); } catch {} }, []);
  const toggleCompact = () => setCompact((v) => { const n = !v; try { localStorage.setItem("sam_compact", n ? "1" : "0"); } catch {} return n; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { const t = e.target as HTMLElement; if (e.key === "[" && !["INPUT", "TEXTAREA"].includes(t?.tagName) && !t?.isContentEditable) toggleCompact(); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);
  const subs = subsFor(role, mod).filter((s) => !s.hidden || s.id === sub);
  const curMod = mods.find((m) => m.id === mod);
  const curSub = subs.find((s) => s.id === sub);

  return (
    <div className={"flex h-screen overflow-hidden" + (compact ? " compact" : "")}>
      <nav className={"rail" + (compact ? (railHover ? " mini hover" : " mini") : "")} onMouseEnter={() => setRailHover(true)} onMouseLeave={() => setRailHover(false)}>
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
          {bottom.map((m) => <RailLink key={m.id} m={m} role={role} on={mod === m.id} />)}
          <button type="button" className="rl collapse" onClick={toggleCompact} title={compact ? "Expand the menus  [" : "Collapse the menus  ["}>
            <Icon name="more" size={14} className={"chev" + (compact ? " rot0" : " rot180")} /><span>{compact ? "Expand" : "Collapse"}</span>
          </button>
        </div>
      </nav>

      {subs.length > 0 && compact && (
        <div className="substrip" onMouseEnter={() => setSubHover(true)} onMouseLeave={() => setSubHover(false)} onClick={() => setSubHover((v) => !v)} title={curMod ? modLabel(role, curMod) : mod}>
          <span className="vtext">{curMod ? modLabel(role, curMod) : mod}</span>
        </div>
      )}
      {subs.length > 0 && (
        <aside className={"sub" + (compact ? (subHover ? " overlay show" : " overlay") : "")} onMouseEnter={() => compact && setSubHover(true)} onMouseLeave={() => setSubHover(false)}>
          <div className="h">{curMod ? modLabel(role, curMod) : mod}</div>
          {subs.map((s) => (
            <Link key={s.id} href={`/${mod}/${s.id}`} className={"sl" + (sub === s.id ? " on" : "") + (s.gear ? " gear" : "")}>
              {subLabel(role, mod, s)}
            </Link>
          ))}
        </aside>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar session={session} crumb={[curMod ? modLabel(role, curMod) : mod, curSub ? subLabel(role, mod, curSub) : sub]} />
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
  const chips = session.group ? ["ALL", ...session.entities] : session.entities;
  async function pick(ent: string) {
    await fetch("/api/ent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ent }) });
    router.refresh();
  }
  return (
    <header className="topbar">
      <div className="crumb"><b>{crumb[0]}</b>{crumb[1] && <> · <span>{crumb[1]}</span></>}</div>
      {chips.length > 1 && (
        <div className="chips">
          {chips.map((e) => (
            <button key={e} type="button" className={"ent " + e + (session.entity === e ? " on" : "")} onClick={() => pick(e)}
              title={e === "ALL" ? "All entities in your scope" : `${ENT[e]?.name} · ${ENT[e]?.qual} · ${ENT[e]?.auth}`}>
              {e === "ALL" ? "All" : e}
            </button>
          ))}
        </div>
      )}
      {chips.length === 1 && <span className={"ent " + chips[0] + " on"}>{chips[0]}</span>}
      <div className="flex-1" />
      <div className="searchbox"><Icon name="search" size={14} /><span>Search</span><kbd>Ctrl K</kbd></div>
      {session.role !== "user" && <button type="button" className="btn primary" onClick={() => router.push("/home/todo")}><Icon name="plus" size={14} /> Create</button>}
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
