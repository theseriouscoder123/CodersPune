/** Retired in the redesign (handoff §7): each step's explanation lives in the page description and the sidebar's
 *  Getting started. Kept as a no-op so existing call sites compile while screens move their text. */
export function CoachBar(props: { id: string; step?: string; children: React.ReactNode }) {
  void props;
  return null;
}
