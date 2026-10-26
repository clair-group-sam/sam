import Link from "next/link";
import { SOURCES, hhmm, type Recap } from "@/lib/coffee";
import { brewCoffee } from "@/app/(app)/home/coffee/actions";
import { BrewButton } from "@/components/BrewButton";

/** Same sources as the last recap when brewing again. */
export function SameSources({ recap }: { recap: Recap }) {
  return <>{recap.sources.filter((x) => x !== "sam").map((x) => <input key={x} type="hidden" name="src" value={x} />)}<input type="hidden" name="src" value="sam" /></>;
}

/** "Good morning" box at the top of the Inbox: choose the sources and brew, or reopen today's recap. Nothing is prepared without a click. */
export function CoffeeBox({ recap, connected }: { recap: Recap | null; connected: boolean }) {
  return (
    <section className="card coffee-box mb-5">
      <div className="cb">
        <div className="cf-head">
          <span className="cf-cup" aria-hidden>☕</span>
          <div className="flex-1 min-w-0">
            <b>Morning coffee</b>
            {recap ? <div className="mini">Today&apos;s recap was prepared at {hhmm(recap.at)}.{recap.synthesis ? " " + recap.synthesis : ""}</div>
              : <div className="mini">Your agenda, unread mail and Teams since yesterday evening, and what is due in S.A.M. — prepared only when you ask, read-only, deleted tonight.</div>}
          </div>
          {recap ? (
            <form action={brewCoffee} className="flex gap-2 shrink-0">
              <SameSources recap={recap} />
              <Link href="/home/coffee" className="btn primary">Open today&apos;s recap</Link>
              <BrewButton label="Brew again" primary={false} />
            </form>
          ) : null}
        </div>
        {!recap && (
          <form action={brewCoffee} className="cf-form">
            <div className="cf-sources">
              {SOURCES.map((x) => {
                const ok = x.id === "sam" || connected;
                return (
                  <label key={x.id} className={"cf-src" + (ok ? "" : " off")} title={ok ? "" : "Sign out of S.A.M. and sign in again to connect your Microsoft account"}>
                    <input type="checkbox" name="src" value={x.id} defaultChecked={ok} disabled={x.id === "sam" || !ok} /> {x.label}
                  </label>
                );
              })}
            </div>
            <div className="flex flex-col items-end gap-1">
              <BrewButton label="☕ Start my morning coffee" />
              {!connected && <span className="mini">Outlook &amp; Teams: sign out of S.A.M. and sign in again once to connect them.</span>}
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
