const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const html = read('template.html')
  .replace('/*__STYLE__*/', read('style.css'))
  .replace('/*__ENGINE__*/', read('engine.js'))
  .replace('/*__APP__*/', read('app.js'));
for (const folder of ['dist', 'docs']) {
  fs.mkdirSync(path.join(__dirname, folder), { recursive: true });
  fs.writeFileSync(path.join(__dirname, folder, 'index.html'), html);
}
fs.writeFileSync(path.join(__dirname, 'docs', '.nojekyll'), '');
console.log(JSON.stringify({ output: 'docs/index.html', bytes: Buffer.byteLength(html) }));
