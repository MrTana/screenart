import fs from 'fs';
const t = fs.readFileSync('src/template.html','utf8');
const core = fs.readFileSync('src/core.js','utf8');
const ui = fs.readFileSync('src/ui.js','utf8');
const out = t.replace('/*__CORE__*/', () => core).replace('/*__UI__*/', () => ui);
fs.writeFileSync('index.html', out);
console.log('ok', out.length, 'bytes');
