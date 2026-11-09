// AC11: execute the actual Terraform-embedded function against valid and bypass hosts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../cloudfront.tf', import.meta.url), 'utf8');
const code = source.match(/code\s*= <<-JAVASCRIPT\n([\s\S]*?)\n  JAVASCRIPT/)[1]
  .replace('${jsonencode(lower(var.creator_hostname))}', JSON.stringify('pensieve.doctorew.com'));
const context = vm.createContext({});
vm.runInContext(code, context);
for (const host of ['pensieve.doctorew.com', 'PENSIEVE.DOCTOREW.COM']) {
  const request = { headers: { host: { value: host }, authorization: { value: 'Bearer fixture' } }, method: 'POST', uri: '/memories' };
  assert.equal(context.handler({ request }), request, 'Valid host preserves request/auth');
}
for (const host of ['fixture.cloudfront.net', 'doctorew.com', 'pensieve.doctorew.com.evil.test', 'pensieve.doctorew.com:443', '', null, undefined]) {
  const request = { headers: host === undefined ? {} : { host: { value: host } } };
  const response = context.handler({ request });
  assert.equal(response.statusCode, 403);
  assert.equal(response.headers['cache-control'].value, 'no-store');
}
console.log('PASS: exact host accepted; alternate, missing, malformed hosts rejected without caching');
