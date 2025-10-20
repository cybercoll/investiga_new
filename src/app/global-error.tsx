"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body style={{ padding: 16, fontFamily: "system-ui, sans-serif" }}>
        <h2>Algo deu errado</h2>
        <p>Tente novamente ou recarregue a página.</p>
        <pre
          style={{
            background: "#f5f5f5",
            padding: 12,
            borderRadius: 6,
            whiteSpace: "pre-wrap",
            overflowX: "auto",
          }}
        >
          {error?.message}
        </pre>
        <button onClick={() => reset()}>Tentar novamente</button>
      </body>
    </html>
  );
}