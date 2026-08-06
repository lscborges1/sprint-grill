"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-8 py-20">
      <h1 className="text-3xl font-semibold tracking-tight">
        Algo quebrou nesta tela
      </h1>
      <p className="text-lg text-muted">
        O detalhe do erro está no terminal onde o app está rodando — os logs são
        estruturados e apontam o que falhou.
      </p>
      <button
        type="button"
        onClick={reset}
        className="self-start rounded-full border border-line px-5 py-2.5 text-base font-medium"
      >
        Tentar de novo
      </button>
    </main>
  );
}
