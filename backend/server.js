const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Simple in-memory storage (Vercel has ephemeral storage)
let emails = [];
let emailId = 1;

// API Routes
app.get('/api/emails/:email', (req, res) => {
    try {
        const email = req.params.email;
        const userEmails = emails.filter(e => e.to_email === email);
        console.log(`Found ${userEmails.length} emails for ${email}`);
        res.json(userEmails);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/simulate-email', (req, res) => {
    try {
        const { toEmail, fromEmail, subject, body } = req.body;
        
        if (!toEmail) {
            return res.status(400).json({ error: 'toEmail is required' });
        }

        const newEmail = {
            id: emailId++,
            to_email: toEmail,
            from_email: fromEmail || 'test@shorttermemail.com',
            subject: subject || 'Test Email',
            body: body || 'This is a test email body.',
            timestamp: new Date().toISOString(),
            attachments: []
        };

        emails.push(newEmail);
        console.log(`Stored email for ${toEmail} (ID: ${newEmail.id})`);

        res.json({ 
            success: true, 
            message: 'Email stored successfully',
            emailId: newEmail.id 
        });
    } catch (error) {
        console.error('Error storing email:', error);
        res.status(500).json({ error: error.message });
    }
});

// Webhook endpoint for real email services (SendGrid, Mailgun, etc.)
app.post('/api/webhook/email', async (req, res) => {
    try {
        console.log('Email webhook received:', JSON.stringify(req.body, null, 2));
        
        let toEmail, fromEmail, subject, body, htmlBody;

        // SendGrid format
        if (req.body.to && req.body.from) {
            toEmail = req.body.to;
            fromEmail = req.body.from;
            subject = req.body.subject || 'No Subject';
            body = req.body.text || req.body.html || 'No content';
            htmlBody = req.body.html || '';
        }
        // Mailgun format
        else if (req.body.recipient && req.body.sender) {
            toEmail = req.body.recipient;
            fromEmail = req.body.sender;
            subject = req.body.subject || 'No Subject';
            body = req.body['body-plain'] || req.body['body-html'] || 'No content';
            htmlBody = req.body['body-html'] || '';
        }
        // CloudMailin format
        else if (req.body.envelope && req.body.headers) {
            toEmail = req.body.envelope.to;
            fromEmail = req.body.envelope.from;
            subject = req.body.headers.subject || 'No Subject';
            body = req.body.plain || req.body.html || 'No content';
            htmlBody = req.body.html || '';
        }
        // Generic format
        else {
            toEmail = req.body.to || req.body.toEmail || req.body.recipient;
            fromEmail = req.body.from || req.body.fromEmail || req.body.sender;
            subject = req.body.subject || 'No Subject';
            body = req.body.body || req.body.text || req.body.plain || req.body.html || 'No content';
            htmlBody = req.body.html || '';
        }

        if (!toEmail) {
            console.log('No recipient email found in webhook data');
            return res.status(400).json({ error: 'No recipient email found' });
        }

        // Store the email
        const newEmail = {
            id: emailId++,
            to_email: toEmail,
            from_email: fromEmail || 'unknown@sender.com',
            subject: subject,
            body: body,
            html_body: htmlBody,
            timestamp: new Date().toISOString(),
            attachments: []
        };

        emails.push(newEmail);
        console.log(`✅ Real email stored via webhook for ${toEmail} from ${fromEmail} (ID: ${newEmail.id})`);

        res.json({ 
            success: true, 
            message: 'Email received via webhook',
            emailId: newEmail.id 
        });
    } catch (error) {
        console.error('❌ Error processing email webhook:', error);
        res.status(500).json({ error: error.message });
    }
});

// Test webhook endpoint (for debugging)
app.get('/api/webhook/test', (req, res) => {
    res.json({ 
        message: 'Webhook endpoint is working!',
        instructions: 'Send POST requests to /api/webhook/email with email data',
        supported_services: ['SendGrid', 'Mailgun', 'CloudMailin', 'Generic']
    });
});

app.get('/api/stats', (req, res) => {
    res.json({
        total_emails: emails.length,
        unique_addresses: new Set(emails.map(e => e.to_email)).size,
        current_time: new Date().toISOString(),
        webhook_enabled: true
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        features: {
            email_simulation: true,
            webhook_reception: true,
            real_email_delivery: 'Configure MX records with email service'
        }
    });
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/ar', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index-ar.html'));
});

// Handle all other routes
app.get('*', (req, res) => {
    res.status(404).json({ 
        error: 'Route not found', 
        path: req.path,
        available_routes: [
            'GET  /',
            'GET  /ar',
            'GET  /health',
            'GET  /api/stats',
            'GET  /api/emails/:email',
            'GET  /api/webhook/test',
            'POST /api/simulate-email',
            'POST /api/webhook/email'
        ]
    });
});

// Export for Vercel
module.exports = app;