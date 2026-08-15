import { notFound } from "next/navigation";
import { UiGalleryView } from "@/app/__dev/ui/gallery";
import { parseUiQuery } from "@/app/__dev/ui/fixtures";

export const dynamic = "force-dynamic";

export default async function UiGallery({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();

  let query;
  try {
    query = parseUiQuery(await searchParams);
  } catch {
    notFound();
  }

  return <UiGalleryView view={query.view} action={inertAction} />;
}

async function inertAction(formData: FormData): Promise<void> {
  "use server";
  void formData;
}
