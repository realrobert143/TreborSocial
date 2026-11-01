-- Create Users Table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'user', -- 'user' or 'admin'
    profile_pic_url TEXT DEFAULT 'https://placeholder.com'
);

-- Create Messages Table
CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    sender_id INT REFERENCES users(id) ON DELETE CASCADE,
    receiver_id INT REFERENCES users(id) ON DELETE CASCADE,
    message_type VARCHAR(10) NOT NULL, -- 'text' or 'image'
    content TEXT NOT NULL,             -- Plain text or file path/URL
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for performance when querying active chats and pruning
CREATE INDEX idx_messages_created_at ON messages(created_at);
