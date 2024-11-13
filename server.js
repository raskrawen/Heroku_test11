// server.js
// gøres klar til multiple clients.
//virker for een klient. Test for flere 

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // Hent API-nøglen fra miljøvariabler

const roleDescription = process.env.CHATBOT_ROLE;
const messages = {};

app.use(express.static('public'));

io.on('connection', (socket) => {
  console.log('A user connected');

  if (!messages[socket.id]) {
    messages[socket.id] = [{ role: 'system', content: roleDescription }]
  }
  
  socket.on('user message', async (msg) => {
    try {
      messages[socket.id].push({ role: 'assistant', content: roleDescription });
      messages[socket.id].push({ role: 'user', content: msg });
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o-mini',
          messages: messages[socket.id],
          user: socket.id
        },
        {
          headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }
        }
      );

      const botReply = response.data.choices[0].message.content;
      messages[socket.id].push({ role: 'assistant', content: botReply });
      socket.emit('bot message', botReply);

    } catch (error) {
      console.error(error);
      socket.emit('bot message', 'Sorry, there was an error.');
    }
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
