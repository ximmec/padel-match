"use client";
import { useState } from "react";

export function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <>
      <input {...props} type={show ? "text" : "password"} />
      <button type="button" className="eye" onClick={() => setShow((s) => !s)} aria-label={show ? "Ocultar clave" : "Ver clave"} title={show ? "Ocultar" : "Mostrar"}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
          {show && <path d="M3 3l18 18" />}
        </svg>
      </button>
    </>
  );
}
