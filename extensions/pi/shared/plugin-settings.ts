// Repo-only shim: the canonical module sits two levels up here and one level up
// in the installed tree, so this keeps the `../shared/<name>.ts` specifier
// identical in both. Not shipped — the installer copies the canonical file.
export * from '../../shared/plugin-settings.ts';
