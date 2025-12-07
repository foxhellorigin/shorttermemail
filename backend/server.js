const express = require('express');
const cors = require('cors');
const path = require('path');
const { simpleParser } = require('mailparser');
const querystring = require('querystring');

const app = express();

// Custom body parsing middleware that handles large requests
const customBodyParser = (req, res, next) => {
    const contentType = req.get('Content-Type') || '';
    
    // Only parse large bodies for Mailgun webhook
    if (req.url === '/api/webhook/email' && contentType.includes('application/x-www-form-urlencoded')) {
        console.log('📧 Processing Mailgun webhook with custom parser');
        
        let body = '';
        let size = 0;
        const MAX_SIZE = 50 * 1024 * 1024; // 50MB limit for Mailgun
        
        req.on('data', chunk => {
            body += chunk.toString();
            size += chunk.length;
            
            if (size > MAX_SIZE) {
                console.log('⚠️ Request too large, sending 200 to stop retries');
                // Return success to prevent Mailgun retries
                res.status(200).json({ 
                    success: true, 
                    message: 'Email received (large email handled)' 
                });
                req.destroy(); // Stop receiving data
                return;
            }
        });
        
        req.on('end', () => {
            try {
                req.body = querystring.parse(body);
                console.log(`✅ Parsed Mailgun request: ${size} bytes`);
                next();
            } catch (error) {
                console.error('Error parsing form data:', error);
                res.status(200).json({ success: true, message: 'Email received' });
            }
        });
        
        req.on('error', (err) => {
            console.error('Request error:', err);
            res.status(200).json({ success: true, message: 'Email received' });
        });
    } 
    // For all other routes, use standard Express parsers with limits
    else {
        // Skip body parsing for webhook to use our custom parser
        if (req.url === '/api/webhook/email') {
            next();
        } else {
            // Use standard parsers for other routes
            express.json({ limit: '1mb' })(req, res, next);
        }
    }
};

// Apply custom middleware BEFORE other middleware
app.use(customBodyParser);

// Then add other standard middleware
app.use(cors());
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

// Webhook endpoint for email services
app.post('/api/webhook/email', async (req, res) => {
    try {
        console.log('📧 Webhook processing started');
        
        let toEmail, fromEmail, subject, body, htmlBody;

        // Mailgun format (form-urlencoded)
        if (req.body && req.body.recipient) {
            console.log('✅ Processing Mailgun format');
            
            toEmail = req.body.recipient;
            fromEmail = req.body.sender;
            subject = req.body.subject || 'No Subject';
            
            // Handle large emails - store only essential parts
            const fullBody = req.body['body-plain'] || req.body['stripped-text'] || '';
            const fullHtml = req.body['body-html'] || req.body['stripped-html'] || '';
            
            // For large emails, truncate but still store
            const MAX_CONTENT = 10000; // 10KB max storage
            if (fullBody.length > MAX_CONTENT) {
                body = fullBody.substring(0, MAX_CONTENT) + '\n\n...[Email truncated - too large]';
                console.log(`⚠️ Truncated large email body from ${fullBody.length} to ${MAX_CONTENT} chars`);
            } else {
                body = fullBody;
            }
            
            if (fullHtml.length > MAX_CONTENT) {
                htmlBody = fullHtml.substring(0, MAX_CONTENT) + '<p>...[Email truncated - too large]</p>';
            } else {
                htmlBody = fullHtml;
            }

            console.log(`📨 Mailgun: To=${toEmail}, From=${fromEmail}, Subject=${subject}, Body size=${body.length}`);
        }
        // JSON format (manual testing)
        else if (req.body && req.body.to && req.body.from) {
            console.log('Processing JSON format email');
            toEmail = req.body.to;
            fromEmail = req.body.from;
            subject = req.body.subject || 'No Subject';
            body = req.body.text || req.body.html || 'No content';
            htmlBody = req.body.html || '';
        }
        // Raw MIME format (SendGrid) - handle with size limits
        else if (typeof req.body === 'string' && req.body.includes('From:') && req.body.includes('To:')) {
            console.log('Processing raw MIME message');
            try {
                // Limit MIME parsing to first 50KB
                const mimeContent = req.body.length > 50000 ? req.body.substring(0, 50000) + '...[TRUNCATED]' : req.body;
                const parsed = await simpleParser(mimeContent);
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
            console.log('❓ Unknown format, but returning success to prevent retries');
            return res.json({ success: true, message: 'Email received (unknown format)' });
        }

        if (!toEmail) {
            console.log('No recipient email found');
            return res.json({ success: true, message: 'Email received (no recipient)' });
        }

        // Store the email (truncated if needed)
        const newEmail = {
            id: emailId++,
            to_email: toEmail,
            from_email: fromEmail || 'unknown@sender.com',
            subject: subject.substring(0, 200), // Limit subject length
            body: body.substring(0, 20000), // Limit body to 20KB
            html_body: htmlBody.substring(0, 20000), // Limit HTML to 20KB
            timestamp: new Date().toISOString(),
            attachments: [],
            size: body.length + htmlBody.length,
            truncated: (body.length >= 10000 || htmlBody.length >= 10000) ? true : false
        };

        emails.push(newEmail);
        console.log(`✅ Email stored: ${toEmail} (ID: ${newEmail.id}, Size: ${newEmail.size} chars)`);

        res.json({ 
            success: true, 
            message: 'Email received via webhook',
            emailId: newEmail.id 
        });
    } catch (error) {
        console.error('❌ Error in webhook processing:', error);
        // Always return 200 to prevent Mailgun retries
        res.json({ success: true, error: error.message });
    }
});

// Test webhook endpoint
app.get('/api/webhook/test', (req, res) => {
    res.json({ 
        message: 'Webhook endpoint is working!',
        note: 'Large email support enabled (up to 50MB)',
        storage_limit: 'Emails truncated to 20KB for display',
        test_command: 'curl -X POST https://shorttermemail.com/api/webhook/email -H "Content-Type: application/x-www-form-urlencoded" -d "recipient=test@shorttermemail.com&sender=test@gmail.com&subject=Test&body-plain=Hello"'
    });
});

app.get('/api/stats', (req, res) => {
    res.json({
        total_emails: emails.length,
        unique_addresses: new Set(emails.map(e => e.to_email)).size,
        current_time: new Date().toISOString(),
        max_stored_size: '20KB per email',
        large_email_support: true
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        large_email_support: 'Enabled (50MB limit)'
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