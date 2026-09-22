/**
 * Hands a reference file chosen in "Import project" over to the project's
 * Import page (a File cannot be put in the URL). Kept in memory only.
 */
let pending: { projectId: string; file: File } | null = null;

export function setPendingImport(projectId: string, file: File) {
  pending = { projectId, file };
}

export function takePendingImport(projectId: string): File | null {
  if (!pending || pending.projectId !== projectId) return null;
  const f = pending.file;
  pending = null;
  return f;
}
