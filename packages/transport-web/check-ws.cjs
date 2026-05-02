const { WebSocket } = require('ws');
const ws = new WebSocket('ws://localhost:18888');
let gotData = false;
ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'snapshot') {
      console.log('SNAPSHOT_RECEIVED');
      console.log('requestId:', msg.state.currentRequestId);
      console.log('systemPrompt:', (msg.state.systemPrompt || '').slice(0, 100));
      console.log('contextCount:', msg.state.injectedContext?.length || 0);
      console.log('toolCalls:', msg.state.toolCalls?.length || 0);
      console.log('tokenUsage:', JSON.stringify(msg.state.tokenUsage));
      gotData = true;
    }
  } catch(e) {}
});
ws.on('open', () => console.log('WS_CONNECTED'));
ws.on('error', (e) => console.log('WS_ERROR:', e.message));
setTimeout(() => {
  if (!gotData) console.log('NO_DATA');
  ws.close();
  process.exit(0);
}, 3000);
