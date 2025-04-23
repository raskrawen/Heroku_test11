// server.js
// RKW april 2025
// virker for flere klienter. Nu med tool support og styrketal-funktion

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const roleDescription = 'venlig dansk chatbot, der hjælper med at besvare spørgsmål om skolen og undervisningen. Du er en god ven og hjælper gerne med at finde information.';
const messages = {};

// Funktion der bruges af OpenAI tool til at beregne styrketallet
function beregnStyrketal(params) {
  const antalVindmoller = params.antalVindmoller;
  console.log('Antal vindmøller:', antalVindmoller);
  let styrketallet = 100 * Number(antalVindmoller) + 400;
  return { styrketallet : "Styrketallet er " + styrketallet };
}

// Tool-definition – fortæller OpenAI hvad den kan kalde
const tools = [
  {
    type: "function",
    function: {
      name: "beregnStyrketal",
      description: "Beregner styrketallet ud fra antallet af katte",
      parameters: {
        type: "object",
        properties: {
          antalKatte: {
            type: "integer",
            description: "Antallet af katte"
          }
        },
        required: ["antalKatte"]
      }
    }
  }
];

app.use(express.static('public'));

io.on('connection', (socket) => {
  console.log('A user connected');

  // Gem samtalehistorik per socket-id
  if (!messages[socket.id]) {
    messages[socket.id] = [{ role: 'system', content: roleDescription }];
  }

  socket.on('user message', async (msg) => {
    try {
      messages[socket.id].push({ role: 'user', content: msg });

      // Første kald til OpenAI – modellen må selv vælge tool (tool_choice: "auto")
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o',
          messages: messages[socket.id],
          tools: tools,
          tool_choice: "auto", // modellen vælger selv om den vil kalde et værktøj
          user: socket.id
        },
        {
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const choice = response.data.choices[0];
      console.log('Modelens valg:', choice.finish_reason);
      console.log('Modelens samlede svar:', choice);
      // Hvis modellen vælger at kalde et værktøj
      if (choice.finish_reason === 'tool_calls') {
        console.log("hhh");
        const toolCall = choice.message.tool_calls[0]; //her opstår fejlen
        console.log('Tool kaldt:', toolCall);
        const args = JSON.parse(toolCall.function.arguments);
        console.log('Tool kaldt med argumenter:', args);

        // Kald lokal funktion med værktøjets input
        const result = beregnStyrketal(args);
        console.log('Resultat fra tool:', result);

        // 💡 VIGTIGT: Genopbyg samtalehistorik korrekt til andet kald
        const newMessages = [...messages[socket.id]];

        // Tilføj assistentens "tool_call"-besked
        newMessages.push({
          role: 'assistant',
          tool_calls: [
            {
              id: toolCall.id,
              type: 'function',
              function: {
                name: toolCall.function.name,
                arguments: toolCall.function.arguments
              }
            }
          ]
        });

        // Tilføj tool'ets svar
        newMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: JSON.stringify(result)
        });

        // Andet kald – send tool-output som svar tilbage til modellen
        const followUp = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-4o',
            messages: newMessages
          },
          {
            headers: {
              Authorization: `Bearer ${OPENAI_API_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        );

        // Tjek at modellen faktisk har svaret
        if (
          followUp.data &&
          Array.isArray(followUp.data.choices) &&
          followUp.data.choices.length > 0 &&
          followUp.data.choices[0].message &&
          followUp.data.choices[0].message.content
        ) {
          const finalReply = followUp.data.choices[0].message.content;
          messages[socket.id].push({ role: 'assistant', content: finalReply });
          socket.emit('bot message', finalReply);
        } else {
          console.error('Tool-svar fra OpenAI mangler:', followUp.data);
          socket.emit('bot message', 'Beklager, jeg kunne ikke færdiggøre beregningen.');
        }

      } else {
        // Normalt assistentsvar – intet tool blev brugt
        const botReply = choice.message.content;
        messages[socket.id].push({ role: 'assistant', content: botReply });
        socket.emit('bot message', botReply);
      }

    } catch (error) {
      console.error('Fejl:', error);
      socket.emit('bot message', 'Der opstod en fejl under behandlingen.');
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
