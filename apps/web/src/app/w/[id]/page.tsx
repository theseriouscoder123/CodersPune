import { redirect } from "next/navigation";

/** /w/<id> has no page of its own: open the first step. */
export default async function WorkspaceRoot({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/w/${id}/sources`);
}
