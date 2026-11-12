import assert from 'node:assert/strict';
import {test} from 'node:test';
import {deflateSync} from 'node:zlib';
import {dashboardWidgetHtml} from '../src/bot/dashboard-widget';
import {clientWidgetHtml} from '../src/bot/client-widget';

test('dashboard widget fits Telegram limits and cannot inject script through its initial screen',()=>{
  const html=dashboardWidgetHtml('card:</script><script>alert(1)</script>');
  assert.ok(Buffer.byteLength(html)<=32768);
  assert.ok(deflateSync(html,{level:9}).length<=4096);
  assert.ok(!html.includes('</script><script>alert(1)</script>'));
  assert.match(html,/TW\.copyText\(row\.copy\)/);
});

test('client details are escaped in legacy widget messages',()=>{
  const html=clientWidgetHtml({id:'11111111-1111-4111-8111-111111111111',name:'<img src=x>',company:'A&B',status:'LEAD',aiNextStep:'<script>bad()</script>'});
  assert.ok(!html.includes('<img src=x>'));
  assert.ok(!html.includes('<script>bad()</script>'));
  assert.match(html,/A&amp;B/);
});
