import Link from "next/link";

/** The baton mark: an amber baton passed across an ink tile. */
export function BatonMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect width="32" height="32" rx="8" style={{ fill: "var(--logo-tile)" }} />
      <rect x="7" y="14" width="18" height="4.5" rx="2.25" fill="#d9961b" transform="rotate(-30 16 16)" />
      <circle cx="9.6" cy="20.6" r="1.4" fill="#f7f4ee" opacity="0.9" />
    </svg>
  );
}

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <Link href="/" className="group inline-flex items-center gap-2.5" aria-label="Baton home">
      <span className="transition-transform duration-300 group-hover:-rotate-6">
        <BatonMark size={small ? 26 : 32} />
      </span>
      <span className={`font-display font-semibold tracking-tight text-ink ${small ? "text-[17px]" : "text-[21px]"}`}>Baton</span>
    </Link>
  );
}
