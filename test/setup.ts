// A suite run inside pi exports both pi vars, and the host honours the dir
// override only with the marker, so a temp HOME would still write the real
// ~/.pi/agent — once deleting a real extension tree. Tests that need the pi
// path set them deliberately via cliEnv() in ./helpers/env.ts.
delete process.env.PI_CODING_AGENT;
delete process.env.PI_CODING_AGENT_DIR;
