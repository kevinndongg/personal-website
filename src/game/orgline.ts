/**
 * What the card prints beside the logo: the organisation, minus whatever the title already says. A title that is the
 * organisation (or the organisation with a parenthetical after it) leaves nothing to print; one that is its start
 * leaves the rest ("FIRST Tech Challenge, team 6417 (…)" under that title prints "Team 6417 (…)").
 */
export function orgLine(title: string, organization: string | undefined): string {
  const org = (organization ?? "").trim();
  const t = title.trim();
  if (!org) return "";
  if (t && org.toLowerCase().startsWith(t.toLowerCase())) {
    const rest = org.slice(t.length).trim();
    if (!rest || /^\([^)]*\)$/.test(rest)) return "";
    const more = rest.match(/^[,:;–—-]\s*(.+)$/);
    if (more) return more[1][0].toUpperCase() + more[1].slice(1);
  }
  return org;
}
