const fs = require('fs');
const filePath = './src/screens/ChatListScreen.js';
let content = fs.readFileSync(filePath, 'utf8');

if (content.includes('conversationActivity')) {
  console.log('⚠️  Already patched — skipping.');
  process.exit(0);
}

function mustReplace(oldStr, newStr, label) {
  if (!content.includes(oldStr)) {
    console.error(`❌ Anchor not found for: ${label}`);
    process.exit(1);
  }
  content = content.replace(oldStr, newStr);
  console.log(`✅ ${label}`);
}

mustReplace(
  `    socket.on('presence', handlePresence);
    socket.on('message', refreshOnActivity);
    socket.on('read', refreshOnActivity);
    socket.on('delivered', refreshOnActivity);`,
  `    socket.on('presence', handlePresence);
    socket.on('message', refreshOnActivity);
    socket.on('read', refreshOnActivity);
    socket.on('delivered', refreshOnActivity);
    socket.on('conversationActivity', refreshOnActivity);`,
  'Added conversationActivity listener'
);

mustReplace(
  `      socket.off('presence', handlePresence);
      socket.off('message', refreshOnActivity);
      socket.off('read', refreshOnActivity);
      socket.off('delivered', refreshOnActivity);`,
  `      socket.off('presence', handlePresence);
      socket.off('message', refreshOnActivity);
      socket.off('read', refreshOnActivity);
      socket.off('delivered', refreshOnActivity);
      socket.off('conversationActivity', refreshOnActivity);`,
  'Added listener cleanup'
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('🎉 ChatListScreen patched');
