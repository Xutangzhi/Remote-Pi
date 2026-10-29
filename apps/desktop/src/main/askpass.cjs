// OpenSSH invokes this helper without a terminal. Secrets go directly to SSH's
// stdout pipe and are never stored in application settings or logs.
const http = require('node:http');
const payload = JSON.stringify({ prompt: process.argv[2] || 'SSH authentication' });
const request = http.request({
  hostname: '127.0.0.1', port: Number(process.env.REMOTE_PI_ASKPASS_PORT),
  path: '/challenge', method: 'POST',
  headers: { authorization: `Bearer ${process.env.REMOTE_PI_ASKPASS_TOKEN}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
}, (response) => {
  let body = '';
  response.on('data', (chunk) => { body += chunk; });
  response.on('end', () => {
    try { process.stdout.write(String(JSON.parse(body).answer || '') + '\n'); }
    catch { process.exitCode = 1; }
  });
});
request.on('error', () => { process.exitCode = 1; });
request.end(payload);
