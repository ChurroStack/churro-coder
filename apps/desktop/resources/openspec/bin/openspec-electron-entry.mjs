// Electron-as-Node entry point for the openspec CLI.
//
// Commander.js auto-detects process.versions.electron and, without
// process.defaultApp set, applies argv.slice(1) instead of argv.slice(2),
// which makes it treat the script path itself as a CLI subcommand.
// Setting process.defaultApp = true before the import restores the
// expected Node-style argv slicing (slice(2)).
process.defaultApp = true;
const url = new URL('../pkg/bin/openspec.js', import.meta.url);
await import(url.href);
