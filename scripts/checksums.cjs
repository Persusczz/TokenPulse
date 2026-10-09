const { createHash } = require('node:crypto')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { productName, version } = require('../package.json')

const files = [`${productName} Setup ${version}.exe`, `${productName}-${version}-portable.exe`]
const lines = files.map((file) => createHash('sha256').update(readFileSync(join('dist', file))).digest('hex') + '  ' + file)
writeFileSync(join('dist', 'SHA256SUMS.txt'), lines.join('\n') + '\n')
console.log('Checksums updated: dist/SHA256SUMS.txt')
