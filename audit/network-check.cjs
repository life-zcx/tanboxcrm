const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

async function probe(hostname, resource, port = 3050) {
  const start = performance.now();
  return new Promise(resolve => {
    let finished = false;
    const done = data => {
      if (finished) return;
      finished = true;
      resolve({ hostname, resource, port, ms: Math.round(performance.now() - start), ...data });
    };
    const req = http.get({ hostname, port, path: resource, agent: false }, res => {
      let bytes = 0;
      res.on('data', b => { bytes += b.length; });
      res.on('end', () => done({ status: res.statusCode, bytes, contentType: res.headers['content-type'] }));
      res.on('error', e => done({ error: e.message }));
    });
    req.setTimeout(4000, () => { done({ timeout: true }); req.destroy(); });
    req.on('error', e => done({ error: e.message }));
  });
}
async function main() {
  const html = execFileSync('docker', ['exec', 'tanbox_crm_frontend', 'cat', '/usr/share/nginx/html/index.html'], { encoding: 'utf8' });
  const asset = html.match(/src="(\/assets\/[^\"]+\.js)"/)[1];
  const results = [];
  for (let run = 1; run <= 3; run++) {
    const round = await Promise.all(['127.0.0.1', '::1'].flatMap(hostname =>
      ['/', asset, '/api/health'].map(resource => probe(hostname, resource))
    ));
    results.push(...round.map(r => ({ run, ...r })));
  }
  results.push(...await Promise.all(['127.0.0.1', '::1'].map(hostname => probe(hostname, '/api/health', 5055))));
  fs.writeFileSync(path.join(__dirname, 'network-results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
