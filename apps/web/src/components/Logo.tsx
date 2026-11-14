import Link from "next/link";

/** The Baton mark: a monogram tile on --fg with the baton passed across it. */
export function BatonMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect width="32" height="32" rx="7" style={{ fill: "var(--fg)" }} />
      <rect x="7.5" y="13.9" width="17" height="4.2" rx="2.1" style={{ fill: "var(--bg)" }} transform="rotate(-30 16 16)" />
      <circle cx="23.2" cy="11.8" r="2" style={{ fill: "var(--accent)" }} />
    </svg>
  );
}

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <Link href="/" className="inline-flex items-center gap-2 rounded-md" aria-label="Baton home">
      <BatonMark size={small ? 20 : 24} />
      <span className={`font-semibold tracking-[-0.01em] text-fg ${small ? "text-[14px]" : "text-[16px]"}`}>Baton</span>
    </Link>
  );
}
