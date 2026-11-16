// S.A.M. Reader · opens each portal in a tab of the person's own session, reads it (GET requests only, nothing is clicked,
// saved or sent on the portal), closes the tab and hands the lines to the S.A.M. page that asked. No credentials: a portal that
// shows its sign-in page is reported as "sign in", never filled.
importScripts("readers.js");
const PORTALS = {
  tmcad: { label: "TMCAD (Transport Malta)", url: "https://tmcad.totalaoc.com/Registry/ApplicationForms.aspx?RegistrySubsystemId=ae125e83-db96-470f-a65e-03fa3339d90d&menusrc=menu", reader: readTmcad },
};
const loaded = (tabId) => new Promise((res) => { const t = setTimeout(() => { chrome.tabs.onUpdated.removeListener(l); res(); }, 30000);
  const l = (id, info) => { if (id === tabId && info.status === "complete") { clearTimeout(t); chrome.tabs.onUpdated.removeListener(l); res(); } }; chrome.tabs.onUpdated.addListener(l); });
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "sam-read") return;
  let alive = true; port.onDisconnect.addListener(() => { alive = false; });
  const say = (m) => { if (alive) try { port.postMessage(m); } catch { /* page gone */ } };
  port.onMessage.addListener(async (req) => {
    const results = [];
    for (const key of req.portals || []) {
      const P = PORTALS[key]; if (!P) { results.push({ portal: key, error: "Unknown portal" }); continue; }
      say({ progress: `Opening ${P.label}…` });
      let tab;
      try {
        tab = await chrome.tabs.create({ url: P.url, active: false }); await loaded(tab.id);
        say({ progress: `Reading ${P.label}…` });
        const [inj] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: P.reader });
        results.push({ portal: key, label: P.label, ...(inj?.result ?? { error: "Nothing read" }) });
      } catch (e) { results.push({ portal: key, label: P.label, error: String(e && e.message || e) }); }
      finally { if (tab) try { await chrome.tabs.remove(tab.id); } catch { /* already closed */ } }
    }
    say({ done: true, results }); try { port.disconnect(); } catch { /* */ }
  });
});
