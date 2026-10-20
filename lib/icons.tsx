// Line icons of the prototype rail (24×24, stroke).
const P: Record<string, string> = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  docs: '<path d="M4 4h10l6 6v10a1 1 0 0 1-1 1H4z"/><path d="M14 4v6h6"/>',
  comp: '<path d="M9 4h6v3H9z"/><path d="M6 6h12v14H6z"/><path d="M9 13l2 2 4-4"/>',
  safe: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  erp: '<path d="M12 3l10 18H2z"/><path d="M12 10v5"/><path d="M12 18h.01"/>',
  proj: '<path d="M3 7h6l2 2h10v11H3z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14c3 0 5.5 2 5.5 5"/>',
  dash: '<path d="M4 20h16"/><path d="M6 16V9"/><path d="M11 16V5"/><path d="M16 16v-6"/>',
  is: '<rect x="3" y="11" width="18" height="10" rx="1.5"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="12" cy="16" r="1.5"/>',
  comm: '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
  np: '<circle cx="12" cy="7.5" r="3.5"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/><path d="M16.5 14.5l1.8 1.8 3.2-3.4"/>',
  sign: '<path d="M4 20h16"/><path d="M14.5 4.5l5 5L9 20H4v-5z"/><path d="M12 7l5 5"/>',
  admin: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4.9a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.5a7 7 0 0 0-2 1.2l-2.4-.9-2 3.5 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.5 2.4-.9a7 7 0 0 0 2 1.2L10 21h4l.5-2.5a7 7 0 0 0 2-1.2l2.4.9 2-3.5-2-1.5c.1-.4.1-.8.1-1.2z"/>',
  more: '<path d="M9 6l6 6-6 6"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  coffee: '<path d="M4 8h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/><path d="M16 10h2a2 2 0 0 1 0 4h-2"/><path d="M7 3v2M10 3v2M13 3v2"/>',
};
export function Icon({ name, size = 20, className = "" }: { name: string; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: P[name] ?? P.docs }} />
  );
}
