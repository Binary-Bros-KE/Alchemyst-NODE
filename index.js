const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const { startWebSocketServer } = require('./sockets/websocketState');
const dotenv = require('dotenv');
const http = require('http');

dotenv.config();

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors({ origin: '*' }));
app.use(bodyParser.json());


// MongoDB connection
const URL = process.env.MONGO_URL;
mongoose.connect(URL);
const db = mongoose.connection;
db.on('error', (error) => console.error(error));
db.once('open', () => console.log('✅ Connected to Database'));

// Routes
app.use('/user', require('./routes/user'));
app.use('/auth', require('./routes/auth'));
app.use('/mpesa', require('./routes/mpesa'));
app.use('/profiles', require('./routes/profiles'));
app.use('/analytics', require('./routes/analytics'));


// Example route
app.get('/', asyncHandler(async (req, res) => {
    res.json({ success: true, message: 'Welcome to Alchemyst', data: null });
}));

// Start WebSocket server
const { clients } = startWebSocketServer(server);


// Start the server
server.listen(process.env.PORT, () => {
    console.log(`🚀 Server running on port ${process.env.PORT}`);
});

if (process.env.NODE_ENV === 'production') {
  require('./cron/packageExpiration');
}


