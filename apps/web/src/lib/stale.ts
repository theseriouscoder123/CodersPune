/** One label for open work the rules flagged as overtaken, chosen from the rule that fired (relations.stale_reasons):
 *  a newer status line on the same item, a decision that parks it, or a decision that says it's in place. */
export function staleTag(reason: string | null | undefined): string {
  if (!reason) return "Probably done";
  if (reason.startsWith("A later update")) return "Updated later";
  if (reason.includes("parks this")) return "Parked";
  return "Probably done";
}
