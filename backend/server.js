const express = require('express');
const cors = require('cors');
const path = require('path');
const { simpleParser } = require('mailparser');
const querystring = require('querystring');

const app = express();

// Middleware - IMPORTANT: Order matters!
app.use(cors());
// Parse JSON bodies
app.use(express.json());
// Parse text bodies (for MIME)
app.use(express.text({ type: '*/*' }));
// Parse URL-encoded bodies (for Mailgun)
app.use(express.urlencoded({ extended: true }));
// Serve static files
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
        
        let toEmail, fromEmail, subject, body, htmlBody;

        const contentType = req.get('Content-Type') || '';

        // Handle application/x-www-form-urlencoded (Mailgun)
        if (contentType.includes('application/x-www-form-urlencoded')) {
            console.log('✅ Processing form-urlencoded data');
            
            let formData;
            if (typeof req.body === 'string') {
                // Manual parsing if middleware didn't work
                formData = querystring.parse(req.body);
                console.log('Manually parsed form data:', formData);
            } else {
                formData = req.body;
                console.log('Middleware parsed form data:', formData);
            }

            if (formData.recipient) {
                console.log('✅ SUCCESS: Processing Mailgun format');
                
                toEmail = formData.recipient;
                fromEmail = formData.sender;
                subject = formData.subject || 'No Subject';
                body = formData['body-plain'] || formData['stripped-text'] || 'No content';
                htmlBody = formData['body-html'] || formData['stripped-html'] || '';

                console.log(`📨 Mailgun: To=${toEmail}, From=${fromEmail}, Subject=${subject}`);
            }
        }
        // Handle JSON format
        else if (contentType.includes('application/json')) {
            console.log('Processing JSON format');
            if (req.body.to && req.body.from) {
                toEmail = req.body.to;
                fromEmail = req.body.from;
                subject = req.body.subject || 'No Subject';
                body = req.body.text || req.body.html || 'No content';
                htmlBody = req.body.html || '';
            }
        }
        // Handle raw MIME format (SendGrid)
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
        else {
            console.log('❌ Unknown format');
            console.log('Content-Type:', contentType);
            console.log('Body type:', typeof req.body);
            console.log('Body sample:', typeof req.body === 'string' ? req.body.substring(0, 100) : req.body);
            return res.json({ success: true, message: 'Received but format not recognized' });
        }

        if (!toEmail) {
            console.log('No recipient email found');
            return res.json({ success: true, message: 'No recipient found' });
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

// Debug endpoint
app.post('/api/debug/webhook', express.urlencoded({ extended: true }), (req, res) => {
    console.log('DEBUG - Content-Type:', req.get('Content-Type'));
    console.log('DEBUG - Body type:', typeof req.body);
    console.log('DEBUG - Body:', req.body);
    console.log('DEBUG - Body keys:', Object.keys(req.body));
    
    let parsedBody;
    if (typeof req.body === 'string') {
        parsedBody = querystring.parse(req.body);
        console.log('DEBUG - Manually parsed:', parsedBody);
    } else {
        parsedBody = req.body;
    }
    
    res.json({
        contentType: req.get('Content-Type'),
        bodyType: typeof req.body,
        body: req.body,
        bodyKeys: Object.keys(req.body),
        parsedBody: parsedBody,
        hasRecipient: !!parsedBody.recipient
    });
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
        current_time: new Date().toISOString()
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
    res.status(404).json({ error: 'Route not found' });
});

// Export for Vercel
module.exports = app;