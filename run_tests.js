// Cross-platform task runner (no && chains, no POSIX tools). Usage: node run_tests.js <py|js|ui|all|build|serve>
const { spawnSync, spawn } = require('child_process');
const path = require('path');
const ROOT = __dirname;

// Python launcher: the first of these that can import numpy. (On Windows `python3` may be the Store stub.)
const LAUNCHERS = [['python'], ['py', '-3'], ['python3']];
function python() {
  for (const l of LAUNCHERS) {
    const r = spawnSync(l[0], [...l.slice(1), '-c', 'import numpy'], { stdio: 'ignore' });
    if (r.status === 0) return l;
  }
  console.error('No Python with numpy found. Tried: ' + LAUNCHERS.map(l => l.join(' ')).join(', ') + '. Install Python 3 with numpy and scipy.');
  process.exit(1);
}

function run(cmd, args) {
  console.log(`\n> ${[cmd, ...args].join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) { console.error(`\nFAILED: ${[cmd, ...args].join(' ')} (exit ${r.status ?? r.error?.message})`); process.exit(r.status || 1); }
}

const py = () => { const l = python(); return (...a) => run(l[0], [...l.slice(1), ...a]); };
const tasks = {
  build: () => py()('web/build.py'),
  py: () => py()('-m', 'pytest', 'tests', '-q'),
  js: () => { py()('tests/export_reference.py'); run(process.execPath, ['tests/cross_check.js']); },
  ui: () => { tasks.build(); run(process.execPath, ['tests/ui_sweep.js']); run(process.execPath, ['tests/ui_shots.js']); },
  rtl: () => { const p = py(); p('-m', 'pytest', 'tests/test_rtl.py', '-q'); p('tests/rtl_sim.py'); },
  all: () => { tasks.py(); tasks.js(); tasks.rtl(); tasks.ui(); console.log('\nall test suites passed'); },
  serve: () => {
    const l = python(), port = process.env.PORT || '8000';
    console.log(`Serving web/ at http://localhost:${port}/ (open it in VS Code's Simple Browser). Ctrl+C to stop.`);
    spawn(l[0], [...l.slice(1), '-m', 'http.server', port, '--directory', path.join(ROOT, 'web')], { stdio: 'inherit' }).on('exit', c => process.exit(c ?? 0));
  },
};

const name = process.argv[2];
if (!tasks[name]) { console.error('Usage: node run_tests.js <' + Object.keys(tasks).join('|') + '>'); process.exit(2); }
tasks[name]();
