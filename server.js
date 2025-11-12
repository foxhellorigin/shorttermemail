const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Vercel-specific configuration
const isVercel = process.env.VERCEL === '1';

// Use different database path for Vercel
const dbPath = isVercel ? '/tmp/emails.db' : './emails.db';

// Email Service Class
class EmailService {
    constructor() {
        this.db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('Error opening database:', err.message);
            } else {
                console.log('Connected to SQLite database for email service.');
                this.initializeDatabase();
            }
        });
    }

    initializeDatabase() {
        this.db.serialize(() => {
            // Create emails table
            this.db.run(`CREATE TABLE IF NOT EXISTS emails (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                to_email TEXT NOT NULL,
                from_email TEXT NOT NULL,
                subject TEXT,
                body TEXT,
                html_body TEXT,
                attachments TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Create indexes for better performance
            this.db.run(`CREATE INDEX IF NOT EXISTS idx_to_email ON emails(to_email)`);
            this.db.run(`CREATE INDEX IF NOT EXISTS idx_timestamp ON emails(timestamp)`);
        });
    }

    // Store incoming email
    storeEmail(emailData) {
        return new Promise((resolve, reject) => {
            const { toEmail, fromEmail, subject, body, htmlBody, attachments } = emailData;
            
            this.db.run(
                `INSERT INTO emails (to_email, from_email, subject, body, html_body, attachments) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [toEmail, fromEmail, subject, body, htmlBody || '', JSON.stringify(attachments || [])],
                function(err) {
                    if (err) {
                        console.error('Error storing email:', err);
                        reject(err);
                    } else {
                        console.log(`Email stored for ${toEmail} (ID: ${this.lastID})`);
                        resolve(this.lastID);
                    }
                }
            );
        });
    }

    // Get emails for a specific address
    getEmailsForAddress(emailAddress, limit = 50) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM emails 
                 WHERE to_email = ? 
                 ORDER BY timestamp DESC 
                 LIMIT ?`,
                [emailAddress, limit],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        // Parse attachments back from JSON string
                        const emails = rows.map(row => ({
                            ...row,
                            attachments: row.attachments ? JSON.parse(row.attachments) : []
                        }));
                        resolve(emails);
                    }
                }
            );
        });
    }

    // Get single email by ID
    getEmailById(emailId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT * FROM emails WHERE id = ?`,
                [emailId],
                (err, row) => {
                    if (err) {
                        reject(err);
                    } else if (row) {
                        // Parse attachments back from JSON string
                        row.attachments = row.attachments ? JSON.parse(row.attachments) : [];
                        resolve(row);
                    } else {
                        resolve(null);
                    }
                }
            );
        });
    }

    // Delete email by ID
    deleteEmail(emailId) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `DELETE FROM emails WHERE id = ?`,
                [emailId],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(this.changes > 0);
                    }
                }
            );
        });
    }

    // Clean up old emails manually
    cleanupOldEmails(hours = 24) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `DELETE FROM emails WHERE timestamp < datetime('now', ?)`,
                [`-${hours} hours`],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        console.log(`Cleaned up ${this.changes} old emails`);
                        resolve(this.changes);
                    }
                }
            );
        });
    }

    // Get statistics
    getStats() {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT 
                    COUNT(*) as total_emails,
                    COUNT(DISTINCT to_email) as unique_addresses,
                    datetime('now') as current_time
                FROM emails
                WHERE timestamp > datetime('now', '-24 hours')
            `, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows[0]);
                }
            });
        });
    }

    // Close database connection
    close() {
        return new Promise((resolve, reject) => {
            this.db.close((err) => {
                if (err) {
                    reject(err);
                } else {
                    console.log('Database connection closed.');
                    resolve();
                }
            });
        });
    }
}

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;
const emailService = new EmailService();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ... rest of your existing server code (API routes, etc.) continues here
// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;
const emailService = new EmailService();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// API Routes
app.get('/api/emails/:email', async (req, res) => {
    try {
        const email = req.params.email;
        console.log(`Fetching emails for: ${email}`);
        
        const emails = await emailService.getEmailsForAddress(email);
        console.log(`Found ${emails.length} emails for ${email}`);
        
        res.json(emails);
    } catch (error) {
        console.error('Error fetching emails:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/email/:id', async (req, res) => {
    try {
        const emailId = parseInt(req.params.id);
        const email = await emailService.getEmailById(emailId);
        
        if (email) {
            res.json(email);
        } else {
            res.status(404).json({ error: 'Email not found' });
        }
    } catch (error) {
        console.error('Error fetching email:', error);
        res.status(500).json({ error: error.message });
    }
});

// SIMULATE EMAIL ENDPOINT - THIS IS THE ONE WE NEED
app.post('/api/simulate-email', async (req, res) => {
    try {
        const { toEmail, fromEmail, subject, body } = req.body;
        console.log('Received simulate-email request:', req.body);
        
        if (!toEmail) {
            return res.status(400).json({ error: 'toEmail is required' });
        }

        const emailId = await emailService.storeEmail({
            toEmail,
            fromEmail: fromEmail || 'test@sender.com',
            subject: subject || 'Test Email',
            body: body || 'This is a test email body.',
            htmlBody: '',
            attachments: []
        });

        res.json({ 
            success: true, 
            message: 'Email stored successfully',
            emailId: emailId 
        });
    } catch (error) {
        console.error('Error storing simulated email:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete email by ID
app.delete('/api/email/:id', async (req, res) => {
    try {
        const emailId = parseInt(req.params.id);
        const deleted = await emailService.deleteEmail(emailId);
        
        if (deleted) {
            res.json({ message: 'Email deleted successfully' });
        } else {
            res.status(404).json({ error: 'Email not found' });
        }
    } catch (error) {
        console.error('Error deleting email:', error);
        res.status(500).json({ error: error.message });
    }
});

// Stats endpoint
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await emailService.getStats();
        res.json(stats);
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: error.message });
    }
});

// Cleanup endpoint
app.post('/api/cleanup', async (req, res) => {
    try {
        const hours = req.body.hours || 24;
        const deletedCount = await emailService.cleanupOldEmails(hours);
        res.json({ 
            message: `Cleaned up ${deletedCount} emails older than ${hours} hours` 
        });
    } catch (error) {
        console.error('Error cleaning up emails:', error);
        res.status(500).json({ error: error.message });
    }
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/ar', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index-ar.html'));
});

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        const stats = await emailService.getStats();
        res.json({ 
            status: 'OK', 
            timestamp: new Date().toISOString(),
            stats: stats
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'ERROR', 
            error: error.message 
        });
    }
});

// List all routes (for debugging)
app.get('/api/routes', (req, res) => {
    const routes = [
        'GET  /',
        'GET  /ar',
        'GET  /health',
        'GET  /api/stats',
        'GET  /api/emails/:email',
        'GET  /api/email/:id',
        'POST /api/simulate-email',
        'POST /api/cleanup',
        'DELETE /api/email/:id'
    ];
    res.json({ routes });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 HTTP Server running on port ${PORT}`);
    console.log(`📍 English version: http://localhost:${PORT}`);
    console.log(`📍 Arabic version: http://localhost:${PORT}/ar`);
    console.log(`🔍 Health check: http://localhost:${PORT}/health`);
    console.log(`📊 Stats: http://localhost:${PORT}/api/stats`);
    console.log(`🛣️  All routes: http://localhost:${PORT}/api/routes`);
    console.log(`📧 Test endpoint: POST http://localhost:${PORT}/api/simulate-email`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    try {
        await emailService.close();
        console.log('Email service closed successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
    }
});

module.exports = app;