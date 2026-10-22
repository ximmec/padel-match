"use client";
import { useState } from "react";

/** Interruptor con título y descripción. Controlado (checked/onChange) o libre (defaultChecked). */
export function Toggle({ name, title, desc, checked, defaultChecked, onChange }: {
  name: string; title: string; desc?: string; checked?: boolean; defaultChecked?: boolean; onChange?: (v: boolean) => void;
}) {
  const [own, setOwn] = useState(!!defaultChecked);
  const on = checked ?? own;
  return (
    <label className="toggle-item">
      <span className="switch">
        <input type="checkbox" name={name} checked={on} onChange={(e) => { setOwn(e.target.checked); onChange?.(e.target.checked); }} />
        <span />
      </span>
      <span><b>{title}</b>{desc && <small> ({desc})</small>}</span>
    </label>
  );
}
