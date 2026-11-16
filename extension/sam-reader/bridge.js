// S.A.M. Reader · bridge between the S.A.M. page and the extension. The page asks with window.postMessage; nothing else is exposed.
document.documentElement.dataset.samReader = chrome.runtime.getManifest().version;
window.addEventListener("message", (ev) => {
  if (ev.source !== window || ev.origin !== location.origin) return;
  const m = ev.data;
  if (!m || m.type !== "SAM_READ_PORTALS" || !m.id) return;
  const port = chrome.runtime.connect({ name: "sam-read" });
  port.onMessage.addListener((msg) => window.postMessage({ type: "SAM_READER", id: m.id, ...msg }, location.origin));
  port.onDisconnect.addListener(() => window.postMessage({ type: "SAM_READER", id: m.id, done: true, disconnected: true }, location.origin));
  port.postMessage({ portals: Array.isArray(m.portals) ? m.portals : ["tmcad"] });
});
