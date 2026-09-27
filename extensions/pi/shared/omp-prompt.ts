// extensions/pi/shared/omp-prompt.ts — repo-only import shim.
//
// The canonical OMP prompt helpers are extensions/shared/omp-prompt.ts, which
// exists so the OMP ports can share them without the Pi ports carrying a copy
// of an OMP-specific contract. This file exists only so an OMP module under
// extensions/pi/ could reach them at the installed depth.
//
// Not shipped, and no OMP module lives under extensions/pi/ — see
// test/cli/pi-wiring.test.ts.
export * from '../../shared/omp-prompt.ts';
