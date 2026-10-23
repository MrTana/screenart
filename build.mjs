import fs from 'fs';
const t = fs.readFileSync('src/template.html','utf8');
const core = fs.readFileSync('src/core.js','utf8');
const ui = fs.readFileSync('src/ui.js','utf8');
const qr = fs.readFileSync('src/vendor/qrcode.min.js','utf8');
const out = t.replace('/*__QR__*/', () => qr).replace('/*__CORE__*/', () => core).replace('/*__UI__*/', () => ui);
import crypto from 'crypto';
const ver = crypto.createHash('sha1').update(out).digest('hex').slice(0, 10);
// Fecha de la versión en hora de París (CEST en verano, CET en invierno)
const now = new Date();
const paris = now.toLocaleString('sv-SE', { timeZone: 'Europe/Paris', hour12: false }).slice(0, 16);
const zone = (new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', timeZoneName: 'short' }).formatToParts(now).find(x => x.type === 'timeZoneName') || {}).value || '';
const tz = zone === 'GMT+2' ? 'CEST' : zone === 'GMT+1' ? 'CET' : zone;
fs.writeFileSync('index.html', out.replace('__BUILD__', ver + ' · ' + paris + ' ' + tz));
fs.writeFileSync('sw.js', fs.readFileSync('src/sw.js', 'utf8').replace('__VERSION__', ver));
console.log('ok', out.length, 'bytes · sw', ver);
