"use client";

import { useParams } from "next/navigation";

import { WorkspaceShell } from "./WorkspaceShell";

export function WorkspaceShellFromParams({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  return <WorkspaceShell workspaceId={id}>{children}</WorkspaceShell>;
}
