import Link from "next/link";

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="brand" aria-label="PADEL MATCH">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/mark.webp" alt="" width={38} height={38} />
      <span>PADEL<em>-MATCH</em></span>
      <span className="tld">.NET</span>
    </Link>
  );
}
