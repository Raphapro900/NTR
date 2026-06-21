const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static('public'));

// Para servir el index.html correctamente
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Salas activas
const rooms = {};

io.on('connection', (socket) => {
    console.log('🔌 Usuario conectado:', socket.id);

    // Crear sala
    socket.on('createRoom', () => {
        const code = String(Math.floor(10000 + Math.random() * 90000));
        rooms[code] = {
            admin: socket.id,
            players: [socket.id],
            hearts: {
                [socket.id]: [true, true, true]
            },
            names: {
                [socket.id]: 'ADMIN'
            }
        };
        socket.join(code);
        socket.emit('roomCreated', { code, isAdmin: true });
        console.log(`✅ Sala creada: ${code} por ${socket.id}`);
    });

    // Unirse a sala
    socket.on('joinRoom', ({ code }) => {
        if (!rooms[code]) {
            socket.emit('error', '❌ Sala no encontrada');
            return;
        }
        if (rooms[code].players.length >= 2) {
            socket.emit('error', '❌ Sala llena (máximo 2 jugadores)');
            return;
        }
        
        rooms[code].players.push(socket.id);
        rooms[code].hearts[socket.id] = [true, true, true];
        rooms[code].names[socket.id] = 'JUGADOR';
        socket.join(code);
        socket.emit('joined', { code, isAdmin: false });
        
        // Notificar al admin
        const adminId = rooms[code].admin;
        io.to(adminId).emit('playerJoined', {
            playerId: socket.id,
            hearts: rooms[code].hearts[socket.id],
            name: 'JUGADOR'
        });
        
        // Enviar estado actual al nuevo jugador
        socket.emit('syncState', {
            rivalId: adminId,
            rivalHearts: rooms[code].hearts[adminId],
            rivalName: 'ADMIN'
        });
        
        console.log(`🔑 ${socket.id} se unió a ${code}`);
    });

    // Perder corazón
    socket.on('loseHeart', ({ code, index }) => {
        if (!rooms[code]) return;
        if (!rooms[code].hearts[socket.id]) return;
        
        rooms[code].hearts[socket.id][index] = false;
        const remaining = rooms[code].hearts[socket.id].filter(h => h === true).length;
        
        // Notificar a todos en la sala
        io.to(code).emit('heartLost', {
            playerId: socket.id,
            hearts: rooms[code].hearts[socket.id],
            remaining
        });
        
        // Si el jugador perdió todos, notificar
        if (remaining === 0) {
            io.to(code).emit('playerLost', { playerId: socket.id });
        }
    });

    // Chat
    socket.on('chatMessage', ({ code, message }) => {
        if (!rooms[code]) return;
        const name = rooms[code].names[socket.id] || 'Desconocido';
        io.to(code).emit('chatMessage', { message, name, id: socket.id });
    });

    // Expulsar jugador (solo admin)
    socket.on('kickPlayer', ({ code, playerId }) => {
        if (!rooms[code]) return;
        if (rooms[code].admin !== socket.id) return;
        if (playerId === socket.id) return;
        
        io.to(playerId).emit('kicked');
        io.to(code).emit('playerKicked', { playerId });
        
        // Remover jugador
        rooms[code].players = rooms[code].players.filter(id => id !== playerId);
        delete rooms[code].hearts[playerId];
        delete rooms[code].names[playerId];
        socket.to(playerId).disconnectSockets();
    });

    // Cerrar sala (admin)
    socket.on('closeRoom', ({ code }) => {
        if (!rooms[code]) return;
        if (rooms[code].admin !== socket.id) return;
        
        io.to(code).emit('roomClosed');
        delete rooms[code];
        console.log(`🔒 Sala ${code} cerrada`);
    });

    // Desconexión
    socket.on('disconnect', () => {
        console.log('🔌 Usuario desconectado:', socket.id);
        for (let code in rooms) {
            if (rooms[code].players.includes(socket.id)) {
                rooms[code].players = rooms[code].players.filter(id => id !== socket.id);
                delete rooms[code].hearts[socket.id];
                delete rooms[code].names[socket.id];
                
                if (rooms[code].admin === socket.id) {
                    // Si el admin se va, cerrar la sala
                    io.to(code).emit('roomClosed');
                    delete rooms[code];
                    console.log(`🔒 Sala ${code} cerrada (admin desconectado)`);
                } else {
                    io.to(code).emit('playerLeft', { playerId: socket.id });
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📱 Comparte el link con tus amigos`);
});