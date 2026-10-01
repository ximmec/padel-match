import Link from "next/link";

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="brand" aria-label="PADEL MATCH">
      <span className="ball" aria-hidden />
      PADEL <em>MATCH</em>
    </Link>
  );
}
