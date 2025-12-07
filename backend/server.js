const express = require('express');
const cors = require('cors');
const path = require('path');
const { simpleParser } = require('mailparser');
const querystring = require('querystring');

const app = express();

// Disable default body parsers for webhook route
const noBodyParser = (req, res, next) => {
    if (req.url === '/api/webhook/email') {
        next();
    } else {
        // Use standard parsers for other routes
        express.json({ limit: '1mb' })(req, res, next);
    }
};

app.use(noBodyParser);
app.use(cors());
app.use(express.static(path.join(__dirname, '../frontend')));

// Simple in-memory storage
let emails = [];
let emailId = 1;

// Streaming parser for large Mailgun requests
const streamMailgunRequest = (req, res, next) => {
    if (req.url === '/api/webhook/email' && 
        req.method === 'POST' && 
        req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
        
        console.log('📧 Processing Mailgun webhook with streaming parser');
        
        let body = '';
        let size = 0;
        const MAX_SIZE = 5 * 1024 * 1024; // 5MB limit (Vercel's limit)
        
        req.on('data', chunk => {
            const chunkStr = chunk.toString();
            body += chunkStr;
            size += chunkStr.length;
            
            // If request is too large, stop processing and return success
            if (size > MAX_SIZE) {
                console.log(`⚠️ Request too large (${size} bytes), truncating`);
                // Truncate but continue to avoid breaking the stream
                if (body.length > 50000) {
                    body = body.substring(0, 50000);
                }
            }
        });
        
        req.on('end', () => {
            try {
                // Parse the form data
                const parsed = querystring.parse(body);
                
                // Extract only essential fields to save memory
                const essentialData = {
                    recipient: parsed.recipient,
                    sender: parsed.sender,
                    subject: parsed.subject,
                    'body-plain': parsed['body-plain']?.substring(0, 10000) || '', // Truncate to 10KB
                    'body-html': parsed['body-html']?.substring(0, 10000) || ''    // Truncate to 10KB
                };
                
                req.body = essentialData;
                console.log(`✅ Parsed Mailgun request: ${Object.keys(parsed).length} fields, ${size} bytes`);
                next();
            } catch (error) {
                console.error('Error parsing form data:', error);
                // Still return success to prevent Mailgun retries
                req.body = { recipient: 'error@shorttermemail.com', subject: 'Parse Error' };
                next();
            }
        });
        
        req.on('error', (err) => {
            console.error('Request stream error:', err);
            // Return success to prevent retries
            res.status(200).json({ success: true, message: 'Received' });
        });
    } else {
        next();
    }
};

// Apply streaming parser middleware
app.use(streamMailgunRequest);

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

app.post('/api/simulate-email', express.json({ limit: '1mb' }), (req, res) => {
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

// Webhook endpoint
app.post('/api/webhook/email', async (req, res) => {
    try {
        console.log('📧 Webhook processing');
        
        const data = req.body;
        let toEmail, fromEmail, subject, body, htmlBody;

        if (data && data.recipient) {
            console.log('✅ Processing Mailgun data');
            
            toEmail = data.recipient;
            fromEmail = data.sender;
            subject = data.subject || 'No Subject';
            body = data['body-plain'] || '';
            htmlBody = data['body-html'] || '';

            console.log(`📨 Mailgun: ${toEmail}, Subject: ${subject.substring(0, 50)}...`);
        } else {
            console.log('📭 No valid email data received');
            return res.json({ success: true, message: 'Received' });
        }

        // Store truncated email
        const newEmail = {
            id: emailId++,
            to_email: toEmail || 'unknown@shorttermemail.com',
            from_email: fromEmail || 'unknown@sender.com',
            subject: (subject || 'No Subject').substring(0, 200),
            body: (body || '').substring(0, 5000), // Max 5KB
            html_body: (htmlBody || '').substring(0, 5000), // Max 5KB
            timestamp: new Date().toISOString(),
            size: (body?.length || 0) + (htmlBody?.length || 0),
            truncated: true // Mark as truncated since we're storing limited data
        };

        emails.push(newEmail);
        console.log(`✅ Stored: ${toEmail} (ID: ${newEmail.id})`);

        res.json({ 
            success: true, 
            message: 'Email received',
            emailId: newEmail.id,
            truncated: true
        });
    } catch (error) {
        console.error('❌ Webhook error:', error);
        res.json({ success: true, message: 'Received' });
    }
});

// Test endpoints
app.get('/api/webhook/test', (req, res) => {
    res.json({ 
        message: 'Webhook working with large email support',
        note: 'Large emails are truncated to 5KB for storage'
    });
});

app.get('/api/stats', (req, res) => {
    res.json({
        total_emails: emails.length,
        unique_addresses: new Set(emails.map(e => e.to_email)).size
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK',
        large_email_support: 'Enabled (truncated storage)'
    });
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/ar', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index-ar.html'));
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

module.exports = app;