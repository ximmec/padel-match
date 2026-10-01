"use client";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const forbidden = error.message?.startsWith("No tenés permiso");
  return (
    <div className="card narrow" style={{ margin: "24px auto" }}>
      <h2>{forbidden ? "Sin permiso" : "Algo salió mal"}</h2>
      <p>{forbidden ? error.message : "No pudimos cargar esta pantalla. Si el problema sigue, avisá al administrador."}</p>
      {error.digest && <p className="muted" style={{ fontSize: 12 }}>Código: {error.digest}</p>}
      <button className="btn" onClick={reset}>Reintentar</button>
    </div>
  );
}
