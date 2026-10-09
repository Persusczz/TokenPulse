const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')

// Electron 44 downloads its binary lazily; electron-vite reads path.txt before that happens.
try {
  execFileSync(process.execPath, [require.resolve('electron/install.js')], { stdio: 'inherit' })
  const executable = require('electron')
  if (!existsSync(executable)) throw new Error('Electron executable is missing after installation')
  console.log('Electron runtime ready.')
} catch (error) {
  console.error('Cannot prepare Electron:', error.message)
  console.error('Check your network, or set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ and retry.')
  process.exit(1)
}
