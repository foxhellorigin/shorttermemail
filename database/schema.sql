-- Email storage table
CREATE TABLE IF NOT EXISTS emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    to_email TEXT NOT NULL,
    from_email TEXT NOT NULL,
    subject TEXT,
    body TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster email retrieval
CREATE INDEX IF NOT EXISTS idx_to_email ON emails(to_email);
CREATE INDEX IF NOT EXISTS idx_timestamp ON emails(timestamp);

-- Cleanup old emails (older than 24 hours)
CREATE TRIGGER IF NOT EXISTS cleanup_old_emails
AFTER INSERT ON emails
BEGIN
    DELETE FROM emails WHERE timestamp < datetime('now', '-24 hours');
END;