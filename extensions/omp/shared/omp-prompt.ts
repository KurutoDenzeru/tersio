// Repo-only shim: omp-prompt.ts lives beside the extension dirs here and under
// shared/ once installed, so this keeps the `../shared/omp-prompt.ts` specifier
// identical in both. Not shipped — the installer copies the canonical file.
export * from '../omp-prompt.ts';
