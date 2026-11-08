import Link from "next/link";

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <Link href="/" className="inline-flex items-center gap-2.5" aria-label="Baton home">
      <span className={`grid place-items-center rounded-lg bg-navy ${small ? "h-7 w-7" : "h-9 w-9"}`}>
        <span className={`block -rotate-[30deg] rounded-full bg-amber ${small ? "h-1 w-4" : "h-1.5 w-5"}`} />
      </span>
      <span className={`font-bold tracking-tight text-navy ${small ? "text-base" : "text-xl"}`}>Baton</span>
    </Link>
  );
}
