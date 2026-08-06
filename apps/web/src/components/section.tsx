/** Bloco de conteúdo com o título ligado por `aria-labelledby`. */
export function Section({
  id,
  heading,
  children,
}: {
  id: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-5" aria-labelledby={`${id}-heading`}>
      <h2
        id={`${id}-heading`}
        className="text-xs font-medium uppercase tracking-[0.18em] text-muted"
      >
        {heading}
      </h2>
      {children}
    </section>
  );
}
