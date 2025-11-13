const express = require('express');
const app = express();

app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'Server is working!' });
});

app.get('/api/test', (req, res) => {
    res.json({ message: 'API is working!' });
});

app.get('*', (req, res) => {
    res.json({ 
        error: 'Route not found', 
        path: req.path,
        try: '/health or /api/test'
    });
});

module.exports = app;
