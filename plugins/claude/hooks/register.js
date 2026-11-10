// Tersio's combo strip inside Claude Code. It reads the same settings.json the CLI, the dashboard and
// every extension already share, so the strip and the terminal agree.
//
// A mod may import only its own files and "claude-code", and the loader reads this file statically:
// `$` has to appear as `$.namespace.method(...)` at the call site, never passed to a helper. So each
// hook does its own read and hands the text to a pure function below.

const SEP = ' | '

/** The settings file the CLI, the dashboard, and every extension already share. */
function settingsPath(home) {
  return home + '/.tersio/settings.json'
}

/** A boolean is the rtk shape; everything else is already a mode word. */
function modeWord(value) {
  if (value === true) return 'ON'
  if (value === false) return 'OFF'
  return String(value || 'off').toUpperCase()
}

/** One line: the combo, then each mode. Empty when nothing is on, so the band costs no rows. */
function comboLine(settings) {
  const caveman = modeWord(settings.cavemanDefault)
  const rtk = modeWord(settings.rtkDefault)
  const headroom = modeWord(settings.headroomDefault)
  const ponytail = modeWord(settings.ponytailDefault)
  const pstack = modeWord(settings.pstackDefault)
  const allOff =
    caveman === 'OFF' && rtk === 'OFF' && headroom === 'OFF' && ponytail === 'OFF' && pstack === 'OFF'
  if (allOff) return ''
  const level = String(settings.comboDefault || 'off')
  const label = level === 'off' || level === 'custom' ? level.toUpperCase() : level.toUpperCase()
  return [
    '🧩 ' + label,
    '🪨 caveman:' + caveman,
    '🗜️ rtk:' + rtk,
    '🍃 headroom:' + headroom,
    '🧠 ponytail:' + ponytail,
    '🥔 pstack:' + pstack,
  ].join(SEP)
}

/** Parses the text a hook read, or reports why it could not. A half-written file must not end a session. */
function parseSettings(text) {
  try {
    return { settings: JSON.parse(text), error: null }
  } catch (err) {
    return { settings: {}, error: String(err) }
  }
}

/** The last read, so a redraw does not re-parse the same text. */
let cached = { settings: {}, error: null }

export function register(on) {
  on('session.start', async ($, e, next) => {
    try {
      const home = await $.env.get('HOME')
      const path = settingsPath(home)
      // A machine that never ran the installer has no file; the strip stays off rather than erroring.
      cached = (await $.fs.exists(path)) ? parseSettings(String(await $.fs.read(path))) : { settings: {}, error: null }
    } catch (err) {
      cached = { settings: {}, error: String(err) }
    }
    // Both, and each does one job. $.command.register makes a plain /tersio answer; the
    // commands/tersio.md file is what puts the entry in the slash menu, which a registered name
    // never does. Registered last: a taken name throws and would skip the rest of this hook.
    try {
      await $.command.register({ name: 'tersio', description: "Show Tersio's active modes" })
    } catch {
      /* a built-in already owns the name */
    }
    return next(e)
  })

  // Two matchers for one command: the plugin is named tersio and the command is tersio, so the file
  // entry resolves as tersio:tersio while an unqualified /tersio also reaches it.
  on('command.run', { command: 'tersio' }, async () => {
    if (cached.error) return { text: 'Tersio: could not read settings — ' + cached.error }
    const line = comboLine(cached.settings || {})
    return { text: line || '🧩 OFF — no Tersio modes are on' }
  })

  on('command.run', { command: 'tersio:tersio' }, async () => {
    if (cached.error) return { text: 'Tersio: could not read settings — ' + cached.error }
    const line = comboLine(cached.settings || {})
    return { text: line || '🧩 OFF — no Tersio modes are on' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const line = comboLine(cached.settings || {})
    // Nothing on, or not read yet: draw nothing and let the band stay empty.
    if (!line) return next(e)
    const { Text } = $.ui.resolve(e)
    return Text({ children: [line], dimColor: true })
  })
}
