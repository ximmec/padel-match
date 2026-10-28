"use client";
import { useState } from "react";
import { useT } from "@/i18n/client";

export function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  const t = useT().auth;
  return (
    <>
      <input {...props} type={show ? "text" : "password"} />
      <button type="button" className="eye" onClick={() => setShow((s) => !s)} aria-label={show ? t.hide : t.show} title={show ? t.hide : t.show}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
          {show && <path d="M3 3l18 18" />}
        </svg>
      </button>
    </>
  );
}
