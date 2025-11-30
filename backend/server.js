const express = require('express');
const cors = require('cors');
const path = require('path');
const { simpleParser } = require('mailparser');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.text({ type: '*/*' })); // Handle raw text/MIME
app.use(express.urlencoded({ extended: true })); // Handle form-urlencoded (Mailgun)
app.use(express.static(path.join(__dirname, '../frontend')));

// Simple in-memory storage
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

// Webhook endpoint for email services
app.post('/api/webhook/email', async (req, res) => {
    try {
        console.log('📧 Webhook received');
        console.log('Content-Type:', req.get('Content-Type'));
        console.log('Request body keys:', Object.keys(req.body));
        
        let toEmail, fromEmail, subject, body, htmlBody;

        // Mailgun format (form-urlencoded)
        if (req.body.recipient) {
            console.log('✅ Processing Mailgun format');
            
            toEmail = req.body.recipient;
            fromEmail = req.body.sender;
            subject = req.body.subject || 'No Subject';
            body = req.body['body-plain'] || req.body['stripped-text'] || 'No content';
            htmlBody = req.body['body-html'] || req.body['stripped-html'] || '';

            console.log(`📨 Mailgun: To=${toEmail}, From=${fromEmail}, Subject=${subject}`);
        }
        // Raw MIME format (SendGrid)
        else if (typeof req.body === 'string' && req.body.includes('From:') && req.body.includes('To:')) {
            console.log('Processing raw MIME message');
            
            try {
                const parsed = await simpleParser(req.body);
                toEmail = parsed.to?.text || '';
                fromEmail = parsed.from?.text || '';
                subject = parsed.subject || 'No Subject';
                body = parsed.text || parsed.html || 'No content';
                htmlBody = parsed.html || '';
            } catch (parseError) {
                console.error('Error parsing MIME:', parseError);
            }
        }
        // JSON format (manual testing)
        else if (req.body.to && req.body.from) {
            console.log('Processing JSON format email');
            toEmail = req.body.to;
            fromEmail = req.body.from;
            subject = req.body.subject || 'No Subject';
            body = req.body.text || req.body.html || 'No content';
            htmlBody = req.body.html || '';
        }
        else {
            console.log('❌ Unknown format');
            console.log('Body type:', typeof req.body);
            console.log('Body content:', req.body);
            return res.json({ success: true, message: 'Received but format not recognized' });
        }

        if (!toEmail) {
            console.log('No recipient email found');
            return res.json({ success: true, message: 'No recipient found' });
        }

        // Extract just the email address
        const extractEmail = (emailString) => {
            if (!emailString) return '';
            const match = emailString.match(/<([^>]+)>/);
            return match ? match[1] : emailString;
        };

        toEmail = extractEmail(toEmail);
        fromEmail = extractEmail(fromEmail);

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
        console.log(`✅ Email stored: ${toEmail} from ${fromEmail} (ID: ${newEmail.id})`);

        res.json({ 
            success: true, 
            message: 'Email received via webhook',
            emailId: newEmail.id 
        });
    } catch (error) {
        console.error('❌ Error processing webhook:', error);
        res.json({ success: true, error: error.message });
    }
});

// Test webhook endpoint
app.get('/api/webhook/test', (req, res) => {
    res.json({ 
        message: 'Webhook endpoint is working!',
        supported_formats: ['Mailgun form-urlencoded', 'JSON', 'SendGrid MIME'],
        test_commands: {
            mailgun: 'curl -X POST https://shorttermemail.com/api/webhook/email -H "Content-Type: application/x-www-form-urlencoded" -d "recipient=test@shorttermemail.com&sender=test@gmail.com&subject=Test&body-plain=Hello"',
            json: 'curl -X POST https://shorttermemail.com/api/webhook/email -H "Content-Type: application/json" -d \'{"to":"test@shorttermemail.com","from":"test@gmail.com","subject":"Test","text":"Hello"}\''
        }
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
        environment: process.env.NODE_ENV || 'development'
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
        path: req.path
    });
});

// Export for Vercel
module.exports = app;