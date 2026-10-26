import Link from "next/link";
import { SOURCES, hhmm, type Recap } from "@/lib/coffee";
import { brewCoffee } from "@/app/(app)/home/coffee/actions";
import { BrewButton } from "@/components/BrewButton";

/** "Good morning" box at the top of the Inbox: choose the sources and brew, or reopen today's recap. Nothing is prepared without a click. */
export function CoffeeBox({ recap }: { recap: Recap | null }) {
  return (
    <section className="card coffee-box mb-5">
      <div className="cb">
        <div className="cf-head">
          <span className="cf-cup" aria-hidden>☕</span>
          <div className="flex-1 min-w-0">
            <b>Morning coffee</b>
            {recap ? <div className="mini">Today&apos;s recap was prepared at {hhmm(recap.at)}.{recap.synthesis ? " " + recap.synthesis : ""}</div>
              : <div className="mini">A recap of what changed since yesterday evening and what is due — prepared only when you ask.</div>}
          </div>
          {recap ? (
            <form action={brewCoffee} className="flex gap-2 shrink-0">
              <Link href="/home/coffee" className="btn primary">Open today&apos;s recap</Link>
              <BrewButton label="Brew again" primary={false} />
            </form>
          ) : null}
        </div>
        {!recap && (
          <form action={brewCoffee} className="cf-form">
            <div className="cf-sources">
              {SOURCES.map((x) => (
                <label key={x.id} className={"cf-src" + (x.ready ? "" : " off")} title={x.ready ? "" : "Waiting for IT: delegated Microsoft Graph rights not granted yet"}>
                  <input type="checkbox" name="src" value={x.id} defaultChecked={x.ready} disabled={!x.ready} /> {x.label}{!x.ready && <span className="mini"> · soon</span>}
                </label>
              ))}
            </div>
            <BrewButton label="☕ Start my morning coffee" />
          </form>
        )}
      </div>
    </section>
  );
}
