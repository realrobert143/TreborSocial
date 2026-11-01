
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const session = require('express-session');

app.use(cors({
    origin: '*', // Allows connections from any origin (ideal for local network testing)
    credentials: true
}));


app.use(session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,      // Must be false for local IP testing over http://
        httpOnly: true,
        sameSite: 'lax'
    }
}));



// Database Pool Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

// Test connection and print active database details on startup
pool.query('SELECT current_database(), current_user, inet_server_addr(), inet_server_port();', (err, res) => {
    if (err) {
        console.error("❌ Database connection error:", err);
    } else {
        const dbInfo = res.rows[0];
        console.log("--------------------------------------------------");
        console.log(`✅ Connected to Database: "${dbInfo.current_database}"`);
        console.log(`👤 Connected as User:     "${dbInfo.current_user}"`);
        console.log(`🌐 Server Host/Port:      ${dbInfo.inet_server_addr || 'localhost'}:${dbInfo.inet_server_port || '5432'}`);
        console.log("--------------------------------------------------");
    }
});

async function initializeDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                profile_pic_url TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS posts (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                username VARCHAR(255),
                text_content TEXT,
                image_url TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                sender_id INT REFERENCES users(id) ON DELETE CASCADE,
                recipient_id INT REFERENCES users(id) ON DELETE CASCADE,
                message_text TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS post_likes (
                id SERIAL PRIMARY KEY,
                post_id INT REFERENCES posts(id) ON DELETE CASCADE,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(post_id, user_id)
            );

            CREATE TABLE IF NOT EXISTS post_comments (
                id SERIAL PRIMARY KEY,
                post_id INT REFERENCES posts(id) ON DELETE CASCADE,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                comment_text TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("All core tables verified in the correct database.");
    } catch (err) {
        console.error("Database initialization error:", err);
    }
}
initializeDatabase();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Local storage configuration for uploads (Images & Videos)
const storage = multer.diskStorage({
    destination: './public/uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

// File filter to allow images and common video formats
const fileFilter = (req, file, cb) => {
    const allowedTypes = [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
        'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo'
    ];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Only images and videos are allowed!'), false);
    }
};

const upload = multer({ 
    storage, 
    fileFilter,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit for videos
});

// --- 24-HOUR AUTO-DELETE BACKGROUND WORKER ---
// Runs every hour locally to wipe posts older than 24 hours
// setInterval(async () => {
//     try {
//         const res = await pool.query(
//             "DELETE FROM posts WHERE created_at < NOW() - INTERVAL '24 hours'"
//         );
//         console.log(`[Cleaner] Automatically purged ${res.rowCount} expired messages.`);
//     } catch (err) {
//         console.error('[Cleaner Error]', err);
//     }
// }, 60 * 60 * 1000); 


// 1. Define the middleware (adjust this based on how you track logged-in users, e.g., session or JWT)
function isAuthenticated(req, res, next) {
    const userIdHeader = req.headers['x-user-id'];
    
    if ((req.session && req.session.userId) || userIdHeader) {
        // Attach userId to request for downstream routes if needed
        req.userId = req.session?.userId || userIdHeader;
        return next();
    }
    return res.status(401).json({ error: 'Unauthorized' });
}

///Google compliance endpoints

// Privacy Policy Page
app.get('/privacy-policy', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Privacy Policy - TreborSocial</title>
            <style>
                body { font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; line-height: 1.6; color: #333; }
                h1 { color: #111; }
            </style>
        </head>
        <body>
            <h1>Privacy Policy</h1>
            <p>Last updated: November 2026</p>
            <p>TreborSocial ("we", "our", or "us") operates the TreborSocial web application and mobile client. This page informs you of our policies regarding the collection, use, and disclosure of personal data when you use our service.</p>
            
            <h2>Information Collection and Use</h2>
            <p>We collect basic profile information (such as username, name, profile picture) and user-generated content (posts, reels, stories) to provide and improve our social networking service.</p>
            
            <h2>Data Retention and Deletion</h2>
            <p>You can delete your account and all associated data at any time directly within the mobile application via your profile settings, or by visiting our <a href="/account-deletion">Account Deletion Request</a> page.</p>
            
            <h2>Contact Us</h2>
            <p>If you have any questions about this Privacy Policy, please contact us through our support channels.</p>
        </body>
        </html>
    `);
});

// Account Deletion Web Page & Instructions
app.get('/account-deletion', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Account Deletion - TreborSocial</title>
            <style>
                body { font-family: sans-serif; max-width: 600px; margin: 40px auto; padding: 0 20px; line-height: 1.6; color: #333; }
                .card { background: #f9f9f9; padding: 20px; border-radius: 8px; border: 1px solid #ddd; margin-top: 20px; }
            </style>
        </head>
        <body>
            <h1>Account & Data Deletion</h1>
            <p>At TreborSocial, we respect your privacy and give you full control over your data.</p>
            
            <div class="card">
                <h3>How to delete your account:</h3>
                <ol>
                    <li>Open the <strong>TreborSocial</strong> mobile application.</li>
                    <li>Navigate to your <strong>Profile Page</strong>.</li>
                    <li>Tap the <strong>Delete Account</strong> button.</li>
                    <li>Confirm your choice to permanently erase your account, posts, reels, stories, and data.</li>
                </ol>
                <p><em>All data is permanently deleted immediately upon confirmation using secure database cascades.</em></p>
            </div>
        </body>
        </html>
    `);
});


app.get('/terms-of-service', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Terms of Service & EULA - TreborSocial</title>
            <style>
                body { font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; line-height: 1.6; color: #333; }
                h1, h2 { color: #111; }
            </style>
        </head>
        <body>
            <h1>Terms of Service & End User License Agreement (EULA)</h1>
            <p>Last updated: November 2026</p>
            <p>Welcome to TreborSocial. By accessing or using our application, you agree to be bound by these Terms of Service.</p>
            
            <h2>1. User-Generated Content & Conduct</h2>
            <p>TreborSocial allows users to share posts, reels, and stories. You agree strictly not to upload, post, or transmit any content that is illegal, abusive, harassing, threatening, hateful, or sexually explicit.</p>
            
            <h2>2. Zero-Tolerance Policy for Objectionable Content</h2>
            <p>We maintain a strict zero-tolerance policy regarding objectionable content and abusive behavior. Any accounts found violating these rules or posting prohibited content will have their content removed immediately and their accounts permanently suspended.</p>
            
            <h2>3. Reporting and Blocking</h2>
            <p>Users have the ability to report inappropriate posts, reels, or stories and block abusive accounts directly through the app interface. All reported content is filtered or removed from the reporter's view instantly.</p>
        </body>
        </html>
    `);
});

app.get('/support', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Support & Contact - TreborSocial</title>
            <style>
                body { font-family: sans-serif; max-width: 600px; margin: 40px auto; padding: 0 20px; line-height: 1.6; color: #333; }
                .card { background: #f9f9f9; padding: 20px; border-radius: 8px; border: 1px solid #ddd; margin-top: 20px; }
            </style>
        </head>
        <body>
            <h1>Support & Contact Us</h1>
            <p>Need assistance with your account, want to report a critical bug, or need to appeal a moderation action? Reach out to our support team.</p>
            
            <div class="card">
                <h3>Contact Information</h3>
                <p>Email: <strong>rg.mandloi.14@gmail.com</strong></p>
                <p>Response Time: Within 24 to 48 hours.</p>
            </div>
        </body>
        </html>
    `);
});



// --- API ROUTES ---

app.delete('/api/account/delete', async (req, res) => {
    try {
        const userId = req.cookies.userId || req.query.userId || req.session?.userId;
        const { password } = req.body;

        if (!userId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        if (!password) {
            return res.status(400).json({ success: false, error: 'Password is required to confirm deletion.' });
        }

        // Fetch user password hash using the correct column name
        const userResult = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found.' });
        }

        const storedHash = userResult.rows[0].password_hash;

        // Verify password
        const match = await bcrypt.compare(password, storedHash);
        if (!match) {
            return res.status(401).json({ success: false, error: 'Incorrect password.' });
        }

        // Proceed with cascade deletion
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);

        res.clearCookie('userId');
        if (req.session) req.session.destroy();

        res.json({ success: true, message: "Account deleted successfully." });
    } catch (err) {
        console.error("Delete account error:", err);
        res.status(500).json({ success: false, error: "Server database failure." });
    }
});


app.post('/api/user/block', async (req, res) => {
    // DEBUG: See what session and cookies look like
    console.log("SESSION OBJECT:", req.session);
    console.log("COOKIES OBJECT:", req.cookies);

    const blockerId = req.cookies.userId || req.session?.userId || req.session?.user?.id;
    const { blockedId } = req.body;

    console.log("Resolved blockerId:", blockerId, "| blockedId:", blockedId);

    if (!blockerId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!blockedId) {
        return res.status(400).json({ error: 'Target user ID missing' });
    }

    try {
        const query = `
            INSERT INTO blocks (blocker_id, blocked_id) 
            VALUES ($1, $2) 
            ON CONFLICT DO NOTHING;
        `;
        await pool.query(query, [blockerId, blockedId]);
        res.json({ success: true, message: 'User blocked successfully' });
    } catch (err) {
        console.error("Error blocking user:", err);
        res.status(500).json({ error: 'Server database failure' });
    }
});


app.post('/api/report', async (req, res) => {
    const userId = req.cookies.userId || req.session?.userId;
    
    let rawType = req.body.contentType || req.body.targetType;
    const contentId = req.body.contentId || req.body.targetId;
    const reason = req.body.reason;

    // Fallback: If frontend forgot data-type, check which table the ID exists in or default based on context
    if (!rawType && contentId) {
        // Quick check or default to 'reel' if called from reels view, 
        // but best practice is ensuring data-type="reel" is in your HTML.
        rawType = 'reel'; 
    }

    let normalizedType = (rawType || '').toLowerCase().trim();
    if (normalizedType === 'posts') normalizedType = 'post';
    if (normalizedType === 'reels') normalizedType = 'reel';
    if (normalizedType === 'stories') normalizedType = 'story';

    console.log("PARSED REPORT FIXED:", { userId, normalizedType, contentId, reason });

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!contentId || !['post', 'reel', 'story'].includes(normalizedType)) {
        return res.status(400).json({ error: 'Content details missing or invalid type' });
    }

    try {
        const query = `
            INSERT INTO reports (reporter_id, content_type, content_id, reason)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (reporter_id, content_type, content_id) DO NOTHING;
        `;
        await pool.query(query, [userId, normalizedType, contentId, reason || 'Inappropriate content']);
        
        res.json({ success: true, message: 'Report submitted successfully' });
    } catch (err) {
        console.error("Error submitting report:", err);
        res.status(500).json({ error: 'Server database failure' });
    }
});

// 1. Admin Endpoint: Create User
app.post('/api/admin/create-user', async (req, res) => {
    const { name, username, password, role } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ success: false, error: 'Username and password are required.' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        await pool.query(
            'INSERT INTO users (name, username, password_hash, role) VALUES ($1, $2, $3, $4)',
            [name, username.toLowerCase().trim(), hashedPassword, role || 'user']
        );
        
        res.json({ success: true, message: `User ${username} created successfully!` });
    } catch (err) {
        console.error("Admin user generation error:", err);
        
        // PostgreSQL unique violation error code
        if (err.code === '23505') {
            return res.status(400).json({ success: false, error: 'Username already exists.' });
        }

        res.status(500).json({ success: false, error: 'Database error while creating user.' });
    }
});


// 2. Auth Endpoint: Login
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const userRes = await pool.query('SELECT * FROM users WHERE username = $1', [username.toLowerCase().trim()]);
        
        // If no user is found in the database
        if (userRes.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

        // FIX: Extract the first user object from the array row index
        const user = userRes.rows[0]; 
        
        // Compare the submitted password with the hashed password in the database
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(401).json({ error: 'Invalid credentials' });

        // Set secure HTTP-only cookie tracking values
        res.cookie('userId', user.id, { httpOnly: true });
        
        // Return success alongside the valid numerical database user ID
        res.json({ success: true, userId: user.id, role: user.role });
    } catch (err) {
        console.error("Login Error details:", err);
        res.status(500).json({ error: 'Server error' });
    }
});


// 4. File Upload Endpoint (For Chat Images & Profile Pictures)
app.post('/api/uploads', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    
    // Returns the relative URL path of the locally stored image
    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({ success: true, url: fileUrl });
});

// 3. User Search Endpoint
app.get('/api/users/search', async (req, res) => {
    try {
        const searchQuery = req.query.q || req.query.handle || '';
        const currentUserId = req.cookies.userId || 0;

        if (!searchQuery.trim()) {
            return res.json([]);
        }

        const query = `
            SELECT u.id, u.username, u.name, u.profile_pic_url, u.bio, u.created_at,
                   f.status as friendship_status,
                   f.action_user_id
            FROM users u
            LEFT JOIN friendships f ON (
                (f.user_id_1 = $2 AND f.user_id_2 = u.id) OR 
                (f.user_id_2 = $2 AND f.user_id_1 = u.id)
            )
            WHERE (u.username ILIKE $1 OR u.name ILIKE $1) 
              AND u.id != $2 
            LIMIT 10
        `;
        const values = [`%${searchQuery}%`, currentUserId];
        const result = await pool.query(query, values);

        res.json(result.rows);
    } catch (err) {
        console.error('Search API Error details:', err);
        res.status(500).json({ error: 'Server error during search' });
    }
});

//Pending Request API
app.get('/api/friendships/pending', async (req, res) => {
    const currentUserId = req.cookies.userId || req.query.userId;
    if (!currentUserId) return res.status(401).json({ error: 'Unauthorized' });
    
    try {
        const query = `
            SELECT f.*, u.id as user_id, u.username, u.name, u.profile_pic_url
            FROM friendships f
            JOIN users u ON (
                CASE 
                    WHEN f.user_id_1 = $1 THEN f.user_id_2 = u.id
                    ELSE f.user_id_1 = u.id
                END
            )
            WHERE (f.user_id_1 = $1 OR f.user_id_2 = $1)
              AND f.status = 'pending'
              AND f.action_user_id != $1
        `;
        const result = await pool.query(query, [currentUserId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching pending requests:', err);
        res.status(500).json({ error: 'Server error' });
    }
});
// --- API ROUTES ---

app.get('/api/users/me', async (req, res) => {
    const userId = req.cookies.userId || req.query.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const result = await pool.query(
            'SELECT id, username, name, profile_pic_url, bio, created_at FROM users WHERE id::text = $1 OR username = $1', 
            [userId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'User profile mismatch.' });
        
        // Return the first object directly instead of an array
        res.json(result.rows[0]);
    } catch (err) {
        console.error("Dashboard validation verify error:", err);
        res.status(500).json({ error: 'Server database failure' });
    }
});

// 3. Update profile picture persistent database entry
app.post('/api/users/update-avatar', async (req, res) => {
    const { userId, url } = req.body;
    if (!userId || !url) return res.status(400).json({ error: 'Missing parameters' });
    try {
        // FIXED: Cleaned up backslashes before \$1 and \$2 variables
        await pool.query('UPDATE users SET profile_pic_url = \$1 WHERE id = \$2', [url, userId]);
        res.json({ success: true, message: 'Profile updated in database!' });
    } catch (err) {
        console.error("Avatar DB update error:", err);
        res.status(500).json({ error: 'Database update failed' });
    }
});

// GET: Fetch all users except the current user (for the chats list)
app.get('/api/users/:currentUserId', async (req, res) => {
    const { currentUserId } = req.params;
    try {
        const query = `
            SELECT id, username, profile_pic, created_at 
            FROM users 
            WHERE id != $1 
            ORDER BY username ASC;
        `;
        const result = await db.query(query, [currentUserId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching chat users:', err);
        res.status(500).json({ error: 'Failed to fetch users list' });
    }
});

app.get('/api/chats/active', async (req, res) => {
    const userId = req.cookies.userId || req.query.userId;
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    try {
        const query = `
            SELECT u.id, u.username, u.name, u.profile_pic_url, 
                m.content AS last_message, 
                m.message_type,
                m.created_at AS last_message_time,
                m.sender_id
            FROM users u
            JOIN friendships f ON (
                (f.user_id_1 = $1 AND f.user_id_2 = u.id) OR 
                (f.user_id_2 = $1 AND f.user_id_1 = u.id)
            )
            LEFT JOIN LATERAL (
                SELECT content, message_type, created_at, sender_id
                FROM messages 
                WHERE (sender_id = $1 AND receiver_id = u.id) OR (sender_id = u.id AND receiver_id = $1)
                ORDER BY created_at DESC 
                LIMIT 1
            ) m ON true
            WHERE f.status = 'accepted' 
              AND u.id != $1
              AND NOT EXISTS (
                  SELECT 1 FROM blocks b 
                  WHERE (b.blocker_id = $1 AND b.blocked_id = u.id)
                     OR (b.blocker_id = u.id AND b.blocked_id = $1)
              )
            ORDER BY m.created_at DESC NULLS LAST;
        `;
        const result = await pool.query(query, [userId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching active chats:', err);
        res.status(500).json({ error: 'Failed to fetch active chats' });
    }
});

// 2. Fetch persistent message history between two users
app.get('/api/messages/history', async (req, res) => {
    const { userId, partnerId } = req.query;
    try {
        const query = `
            SELECT * FROM messages 
            WHERE (sender_id = $1 AND receiver_id = $2) 
               OR (sender_id = $2 AND receiver_id = $1)
            ORDER BY created_at ASC;
        `;
        const result = await pool.query(query, [userId, partnerId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching message history:', err);
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});


app.get('/api/messages/:recipientId', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'] || req.session?.userId;
        const recipientId = req.params.recipientId;

        const query = `
            SELECT id, sender_id, recipient_id, content, message_type, media_url, created_at 
            FROM messages 
            WHERE (sender_id = $1 AND recipient_id = $2) 
               OR (sender_id = $2 AND recipient_id = $1)
            ORDER BY created_at ASC
        `;
        const result = await pool.query(query, [userId, recipientId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching chat history:', err);
        res.status(500).json({ error: err.message });
    }
});

// 3. Save a message to PostgreSQL (persistent, no 24hr deletion)
app.post('/api/messages', async (req, res) => {
    const { sender_id, receiver_id, content, message_type = 'text' } = req.body;
    try {
        const query = `
            INSERT INTO messages (sender_id, receiver_id, content, message_type, created_at)
            VALUES ($1, $2, $3, $4, NOW())
            RETURNING *;
        `;
        const result = await pool.query(query, [sender_id, receiver_id, content, message_type]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error saving message:', err);
        res.status(500).json({ error: 'Failed to save message' });
    }
});



// GET /api/posts
app.get('/api/posts', async (req, res) => {
    try {
        const userId = req.cookies.userId || req.session?.userId;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const query = `
            SELECT 
                p.*, 
                u.username, 
                u.name, 
                u.profile_pic_url AS profile_pic,
                (SELECT COUNT(*)::int FROM post_comments WHERE post_id = p.id) AS comment_count
            FROM posts p
            JOIN users u ON p.user_id = u.id
            WHERE (
                p.user_id = $1 
                OR EXISTS (
                    SELECT 1 
                    FROM friendships f 
                    WHERE f.status = 'accepted' 
                        AND (
                            (f.user_id_1 = $1 AND f.user_id_2 = p.user_id) 
                            OR (f.user_id_2 = $1 AND f.user_id_1 = p.user_id)
                        )
                )
            )
            AND NOT EXISTS (
                SELECT 1 FROM blocks b 
                WHERE (b.blocker_id = $1 AND b.blocked_id = p.user_id)
                   OR (b.blocker_id = p.user_id AND b.blocked_id = $1)
            )
            AND NOT EXISTS (
                SELECT 1 FROM reports rep 
                WHERE rep.reporter_id = $1 
                AND rep.content_type = 'post' 
                AND rep.content_id = p.id
            )
            ORDER BY p.created_at DESC;
        `;

        const result = await pool.query(query, [userId]);
        res.json(result.rows);
    } catch (err) {
        console.error("Error fetching posts:", err);
        res.status(500).json({ error: "Server database failure." });
    }
});
// POST /api/posts - Create post
app.post('/api/posts', async (req, res) => {
    try {
        const { userId, text, image_url } = req.body;

        if (!userId || userId === 'null' || userId === 'undefined') {
            return res.status(400).json({ error: 'Valid user ID is required to post.' });
        }

        if (!text && !image_url) {
            return res.status(400).json({ error: 'Post must contain text or media.' });
        }

        // 1. Fetch author's username from database to satisfy legacy constraints
        const userRes = await pool.query('SELECT username FROM users WHERE id = $1', [userId]);
        const authorUsername = userRes.rows[0]?.username || 'User';

        // 2. Insert post with both user_id and username fallback
        const insertQuery = `
            INSERT INTO posts (user_id, username, text_content, image_url, created_at)
            VALUES ($1, $2, $3, $4, NOW())
            RETURNING id;
        `;
        const newPost = await pool.query(insertQuery, [userId, authorUsername, text || '', image_url || null]);
        const newPostId = newPost.rows[0].id;

        // 3. Fetch full post with joined live user DP
        const fetchQuery = `
            SELECT 
                p.id,
                p.user_id,
                p.text_content,
                p.image_url,
                p.created_at,
                u.username,
                u.profile_pic_url AS profile_pic
            FROM posts p
            JOIN users u ON p.user_id = u.id
            WHERE p.id = $1;
        `;
        const fullPost = await pool.query(fetchQuery, [newPostId]);
        const postData = fullPost.rows[0];

        // 4. Socket.io live broadcast
        if (typeof io !== 'undefined') {
            io.emit('newPost', postData);
        }

        res.status(201).json({ success: true, post: postData });
    } catch (err) {
        console.error("Error creating post:", err);
        res.status(500).json({ error: "Failed to create post." });
    }
});


// DELETE /api/posts/:id - Delete a post and its dependencies
app.delete('/api/posts/:id', async (req, res) => {
    try {
        const postId = req.params.id;

        // Ensure tables exist just in case
        await pool.query(`
            CREATE TABLE IF NOT EXISTS post_likes (
                id SERIAL PRIMARY KEY,
                post_id INT REFERENCES posts(id) ON DELETE CASCADE,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE(post_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS post_comments (
                id SERIAL PRIMARY KEY,
                post_id INT REFERENCES posts(id) ON DELETE CASCADE,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                comment_text TEXT NOT NULL
            );
        `);

        // Safely delete dependencies
        await pool.query('DELETE FROM post_likes WHERE post_id = $1', [postId]);
        await pool.query('DELETE FROM post_comments WHERE post_id = $1', [postId]);

        // Delete the post
        const deleteRes = await pool.query('DELETE FROM posts WHERE id = $1 RETURNING id', [postId]);

        if (deleteRes.rowCount === 0) {
            return res.status(404).json({ error: "Post not found." });
        }

        if (typeof io !== 'undefined') {
            io.emit('postDeleted', { postId });
        }

        res.json({ success: true, message: "Post deleted successfully." });
    } catch (err) {
        console.error("Error deleting post:", err);
        res.status(500).json({ error: "Failed to delete post." });
    }
});
// Get all Group Channels
app.get('/api/groups', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM groups ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


app.get('/api/posts/preview', async (req, res) => {
    const currentUserId = req.cookies.userId || req.query.userId;
    if (!currentUserId) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const query = `
            SELECT 
                p.id, 
                p.text_content, 
                p.image_url, 
                p.created_at, 
                u.username, 
                u.name, 
                u.profile_pic_url,
                (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id) AS likes_count
            FROM posts p
            JOIN users u ON p.user_id = u.id
            ORDER BY p.created_at DESC
            LIMIT 4
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching feed previews:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get full message archive for a single group channel
app.get('/api/groups/:id/messages', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT username, text_content AS text, created_at AS time FROM group_messages WHERE group_id = \$1 ORDER BY created_at ASC',
            [req.params.id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update Profile (Bio and/or Profile Picture)
app.put('/api/users/profile', async (req, res) => {
    const { username, profile_pic_url, bio } = req.body;
    
    if (!username) {
        return res.status(400).json({ error: 'Username is required' });
    }

    try {
        const result = await pool.query(
            `UPDATE users 
             SET profile_pic_url = COALESCE($1, profile_pic_url), 
                 bio = COALESCE($2, bio) 
             WHERE LOWER(username) = LOWER($3) 
             RETURNING id, username, profile_pic_url,name, bio, created_at`,
            [profile_pic_url, bio, username]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        console.error("Update Profile Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/posts/:id/like
app.post('/api/posts/:id/like', async (req, res) => {
    try {
        const postId = req.params.id;
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ error: "User ID is required." });
        }

        // Check existing like
        const existingLike = await pool.query(
            'SELECT * FROM post_likes WHERE post_id = $1 AND user_id = $2',
            [postId, userId]
        );

        let liked = false;
        if (existingLike.rows.length > 0) {
            await pool.query('DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2', [postId, userId]);
        } else {
            await pool.query('INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2)', [postId, userId]);
            liked = true;
        }

        // 1. Fetch updated total like count
        const likeCountRes = await pool.query(
            'SELECT COUNT(*)::int AS like_count FROM post_likes WHERE post_id = $1',
            [postId]
        );
        const likeCount = likeCountRes.rows[0].like_count;

        // 2. Fetch updated total comment count
        const commentCountRes = await pool.query(
            'SELECT COUNT(*)::int AS comment_count FROM post_comments WHERE post_id = $1',
            [postId]
        );
        const commentCount = commentCountRes.rows[0].comment_count;

        const responseData = { 
            postId, 
            likeCount, 
            like_count: likeCount, 
            commentCount, 
            comment_count: commentCount, 
            liked 
        };

        if (typeof io !== 'undefined') {
            io.emit('postLiked', responseData);
        }

        res.json({ success: true, ...responseData });
    } catch (err) {
        console.error("Error toggling like:", err);
        res.status(500).json({ error: "Failed to update like." });
    }
});


// POST /api/posts/:id/comments - Add a new comment
app.post('/api/posts/:id/comments', async (req, res) => {
    try {
        const postId = req.params.id;
        // Accept commentText, text, OR content from the frontend body
        const { userId, commentText, text, content } = req.body;
        const finalCommentText = commentText || text || content;

        console.log("COMMENT REQUEST BODY:", req.body);

        if (!userId || userId === 'null' || !finalCommentText || !finalCommentText.trim()) {
            return res.status(400).json({ error: "User ID and comment text are required." });
        }

        // 1. Insert the comment
        const insertQuery = `
            INSERT INTO post_comments (post_id, user_id, comment_text, created_at)
            VALUES ($1, $2, $3, NOW())
            RETURNING id;
        `;
        const newComment = await pool.query(insertQuery, [postId, userId, finalCommentText.trim()]);
        const commentId = newComment.rows[0].id;

        // 2. Fetch back joined comment with author details
        const fetchQuery = `
            SELECT 
                c.id,
                c.post_id,
                c.comment_text,
                c.created_at,
                u.id AS user_id,
                u.username,
                COALESCE(u.profile_pic_url, '') AS profile_pic
            FROM post_comments c
            JOIN users u ON c.user_id = u.id
            WHERE c.id = $1;
        `;
        const fullComment = await pool.query(fetchQuery, [commentId]);
        const commentData = fullComment.rows[0];

        // 3. Broadcast real-time event
        if (typeof io !== 'undefined') {
            io.emit('newComment', commentData);
        }

        res.status(201).json({ success: true, comment: commentData });
    } catch (err) {
        console.error("Error adding comment:", err);
        res.status(500).json({ error: "Failed to add comment." });
    }
});

app.get('/api/posts/:id/comments', async (req, res) => {
    // FIX: Extract 'id' from req.params, not req.query
    const postId = req.params.id; 
    
    try {
        const query = `
            SELECT 
                c.id,
                c.post_id,
                c.comment_text,
                c.created_at,
                u.id AS user_id,
                u.username,
                COALESCE(u.profile_pic_url, '') AS profile_pic
            FROM post_comments c
            JOIN users u ON c.user_id = u.id
            WHERE c.post_id = $1;
        `;
        const result = await pool.query(query, [postId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching comment history:', err);
        res.status(500).json({ error: 'Failed to fetch comment history' });
    }
});


// Send or respond to a friend request
app.post('/api/friendships', async (req, res) => {
    try {
        const currentUserId = req.cookies.userId || req.body.userId; // The user performing the action
        const { targetUserId, action } = req.body; // action: 'send', 'accept', 'remove'

        if (!currentUserId || !targetUserId) {
            return res.status(400).json({ error: 'Missing user context' });
        }

        // Sort IDs to maintain a unique pair structure regardless of who initiated
        const user1 = Math.min(currentUserId, targetUserId);
        const user2 = Math.max(currentUserId, targetUserId);

        if (action === 'send') {
            const result = await pool.query(
                `INSERT INTO friendships (user_id_1, user_id_2, status, action_user_id, updated_at)
                 VALUES ($1, $2, 'pending', $3, CURRENT_TIMESTAMP)
                 ON CONFLICT DO NOTHING 
                 RETURNING *`,
                [user1, user2, currentUserId]
            );
            return res.json({ success: true, message: 'Friend request sent', friendship: result.rows[0] });
        } 
        
        if (action === 'accept') {
            const result = await pool.query(
                `UPDATE friendships 
                 SET status = 'accepted', action_user_id = $3, updated_at = CURRENT_TIMESTAMP 
                 WHERE user_id_1 = $1 AND user_id_2 = $2 
                 RETURNING *`,
                [user1, user2, currentUserId]
            );
            return res.json({ success: true, message: 'Friend request accepted', friendship: result.rows[0] });
        }

        if (action === 'remove') {
            await pool.query(
                `DELETE FROM friendships WHERE user_id_1 = $1 AND user_id_2 = $2`,
                [user1, user2]
            );
            return res.json({ success: true, message: 'Friendship removed' });
        }

        res.status(400).json({ error: 'Invalid action' });
    } catch (err) {
        console.error('Friendship action error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});


// Get pending friend requests
app.get('/api/friend-requests', isAuthenticated, async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await pool.query(`
            SELECT fr.id, u.id AS sender_id, u.username, u.name, u.profile_pic_url, fr.created_at
            FROM friend_requests fr
            JOIN users u ON fr.sender_id = u.id
            WHERE fr.receiver_id = $1 AND fr.status = 'pending'
            ORDER BY fr.created_at DESC
        `, [userId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching friend requests:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Accept or Reject friend request
app.post('/api/friend-requests/:id/:action', isAuthenticated, async (req, res) => {
    try {
        const { id, action } = req.params;
        const userId = req.user.id;

        if (!['accept', 'reject'].includes(action)) {
            return res.status(400).json({ error: 'Invalid action' });
        }

        const newStatus = action === 'accept' ? 'accepted' : 'rejected';

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const updateRes = await client.query(`
                UPDATE friend_requests 
                SET status = $1 
                WHERE id = $2 AND receiver_id = $3 AND status = 'pending'
                RETURNING sender_id, receiver_id
            `, [newStatus, id, userId]);

            if (updateRes.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Request not found or unauthorized' });
            }

            if (action === 'accept') {
                const { sender_id, receiver_id } = updateRes.rows[0];
                // Insert symmetric friendship record
                await client.query(`
                    INSERT INTO friendships (user_id, friend_id) VALUES ($1, $2), ($2, $1)
                    ON CONFLICT DO NOTHING
                `, [sender_id, receiver_id]);
            }

            await client.query('COMMIT');
            res.json({ success: true });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Error handling friend action:', err);
        res.status(500).json({ error: 'Server error' });
    }
});


app.delete('/api/messages/:id', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'] || req.session?.userId;
        const messageId = req.params.id;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Fetch the message to get media path
        const findQuery = `SELECT * FROM messages WHERE id = $1 AND (sender_id = $2 OR receiver_id = $2)`;
        const findResult = await pool.query(findQuery, [messageId, userId]);

        if (findResult.rows.length === 0) {
            return res.status(404).json({ error: 'Message not found or unauthorized' });
        }

        const message = findResult.rows[0];

        // Delete physical file if it exists
        if (message.media_url) {
            const filePath = path.join(__dirname, message.media_url);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        // Delete record from database
        await pool.query(`DELETE FROM messages WHERE id = $1`, [messageId]);

        res.json({ success: true, deleted: true });
    } catch (err) {
        console.error('Error deleting message:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/messages/send-snap-batch', async (req, res) => {
    try {
        const senderId = req.headers['x-user-id'] || req.session?.userId;
        const { recipientIds, mediaUrl, mediaType = 'image' } = req.body;

        if (!senderId || !recipientIds || !mediaUrl || !Array.isArray(recipientIds) || recipientIds.length === 0) {
            return res.status(400).json({ error: 'Missing required fields or invalid recipient list' });
        }

        const insertedMessages = [];

        for (const recipientId of recipientIds) {
            const query = `
                INSERT INTO messages (sender_id, receiver_id, message_type, media_url, media_type, is_read)
                VALUES ($1, $2, 'snap', $3, $4, false)
                RETURNING *
            `;
            const result = await pool.query(query, [senderId, recipientId, mediaUrl, mediaType]);
            insertedMessages.push(result.rows[0]);
        }

        res.json({ success: true, messages: insertedMessages });
    } catch (err) {
        console.error('Error saving batch snap messages:', err);
        res.status(500).json({ error: err.message });
    }
});


app.get('/api/friends/list', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'] || req.session?.userId;
        
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const query = `
            SELECT DISTINCT u.id, u.username, u.profile_pic_url
            FROM users u
            JOIN friendships f ON (u.id = f.user_id_1 OR u.id = f.user_id_2)
            WHERE (f.user_id_1 = $1 OR f.user_id_2 = $1) 
              AND u.id != $1
              AND f.status = 'accepted'
        `;
        
        const result = await pool.query(query, [userId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error in /api/friends/list:', err.message);
        res.status(500).json({ error: err.message });
    }
});


//24 hrs Stories API endpoints   /////
// POST: Create a new story     ///////
app.post('/api/stories', async (req, res) => {
    try {
        const { user_id, media_url, media_type } = req.body;
        
        const result = await pool.query(
            `INSERT INTO stories (user_id, media_url, media_type) 
             VALUES ($1, $2, $3) RETURNING *`,
            [user_id, media_url, media_type || 'image']
        );
        
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error posting story:', err);
        res.status(500).json({ error: 'Failed to post story' });
    }
});

// GET: Fetch active stories from the last 24 hours with user details
app.get('/api/stories', async (req, res) => {
    const userId = req.cookies.userId || req.session?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const query = `
            SELECT 
                u.id AS user_id,
                u.username,
                u.name,
                u.profile_pic_url,
                json_agg(
                    json_build_object(
                        'id', s.id,
                        'media_url', s.media_url,
                        'media_type', s.media_type,
                        'created_at', s.created_at
                    ) ORDER BY s.created_at ASC
                ) AS stories
            FROM users u
            JOIN stories s ON u.id = s.user_id
            WHERE s.created_at >= NOW() - INTERVAL '24 hours'
              AND NOT EXISTS (
                  SELECT 1 FROM blocks b 
                  WHERE (b.blocker_id = $1 AND b.blocked_id = u.id)
                     OR (b.blocker_id = u.id AND b.blocked_id = $1)
              )
              AND NOT EXISTS (
                  SELECT 1 FROM reports rep 
                  WHERE rep.reporter_id = $1 
                    AND rep.content_type = 'story' 
                    AND rep.content_id = s.id
              )
            GROUP BY u.id, u.username, u.name, u.profile_pic_url
            ORDER BY MIN(s.created_at) ASC;
        `;
        
        const result = await pool.query(query, [userId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching stories:', err);
        res.status(500).json({ error: 'Failed to fetch stories' });
    }
});

// 2. Use it on your delete route
app.delete('/api/stories/:id', isAuthenticated, async (req, res) => {
    try {
        const storyId = req.params.id;
        const userId = req.user.id; 

        const result = await pool.query(
            'DELETE FROM stories WHERE id = $1 AND user_id = $2 RETURNING *',
            [storyId, userId]
        );

        if (result.rowCount === 0) {
            return res.status(403).json({ error: 'Unauthorized or story not found' });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting story:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

/////---------Reels APIs
// Fetch all reels with user info and like counts
app.get('/api/reels', async (req, res) => {
    try {
        const userId = req.cookies.userId || req.session?.userId;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const query = `
            SELECT 
                r.*, 
                u.username, 
                u.name, 
                u.profile_pic_url AS profile_pic
            FROM reels r
            JOIN users u ON r.user_id = u.id
            WHERE (
                r.user_id = $1 
                OR EXISTS (
                    SELECT 1 
                    FROM friendships f 
                    WHERE f.status = 'accepted' 
                        AND (
                            (f.user_id_1 = $1 AND f.user_id_2 = r.user_id) 
                            OR (f.user_id_2 = $1 AND f.user_id_1 = r.user_id)
                        )
                )
            )
            AND NOT EXISTS (
                SELECT 1 FROM blocks b 
                WHERE (b.blocker_id = $1 AND b.blocked_id = r.user_id)
                   OR (b.blocker_id = r.user_id AND b.blocked_id = $1)
            )
            AND NOT EXISTS (
                SELECT 1 FROM reports rep 
                WHERE rep.reporter_id = $1 
                  AND rep.content_type = 'reel' 
                  AND rep.content_id = r.id
            )
            ORDER BY r.created_at DESC;
        `;

        const result = await pool.query(query, [userId]);
        res.json(result.rows);
    } catch (err) {
        console.error("Error fetching reels:", err);
        res.status(500).json({ error: "Server database failure." });
    }
});

// Like / Unlike a reel
app.post('/api/reels/:id/like', async (req, res) => {
    const currentUserId = req.cookies.userId || req.query.userId;
    if (!currentUserId) return res.status(401).json({ error: 'Unauthorized' });
    const reelId = req.params.id;

    try {
        const check = await pool.query(
            `SELECT * FROM reel_likes WHERE reel_id = $1 AND user_id = $2`,
            [reelId, currentUserId]
        );

        if (check.rows.length > 0) {
            await pool.query(`DELETE FROM reel_likes WHERE reel_id = $1 AND user_id = $2`, [reelId, currentUserId]);
            res.json({ liked: false });
        } else {
            await pool.query(`INSERT INTO reel_likes (reel_id, user_id) VALUES ($1, $2)`, [reelId, currentUserId]);
            res.json({ liked: true });
        }
    } catch (err) {
        console.error('Error toggling reel like:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/reels', async (req, res) => {
    const currentUserId = req.cookies.userId || req.query.userId;
    if (!currentUserId) return res.status(401).json({ error: 'Unauthorized' });

    const { video_url, caption } = req.body;
    if (!video_url) return res.status(400).json({ error: 'Video URL is required' });

    try {
        const query = `
            INSERT INTO reels (user_id, video_url, caption)
            VALUES ($1, $2, $3)
            RETURNING *
        `;
        const result = await pool.query(query, [currentUserId, video_url, caption]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating reel:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/reels/preview', async (req, res) => {
    const currentUserId = req.cookies.userId || req.query.userId;
    if (!currentUserId) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const query = `
            SELECT 
                r.id, 
                r.video_url, 
                r.caption, 
                r.created_at, 
                u.username, 
                u.name, 
                u.profile_pic_url,
                (SELECT COUNT(*) FROM reel_likes rl WHERE rl.reel_id = r.id) AS likes_count
            FROM reels r
            JOIN users u ON r.user_id = u.id
            WHERE NOT EXISTS (
                SELECT 1 FROM blocks b 
                WHERE (b.blocker_id = $1 AND b.blocked_id = r.user_id)
                   OR (b.blocker_id = r.user_id AND b.blocked_id = $1)
            )
            AND NOT EXISTS (
                SELECT 1 FROM reports rep 
                WHERE rep.reporter_id = $1 
                  AND rep.content_type = 'reel' 
                  AND rep.content_id = r.id
            )
            ORDER BY likes_count DESC, r.created_at DESC
            LIMIT 4
        `;
        const result = await pool.query(query, [currentUserId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching reels preview:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// --- REAL-TIME CHAT WITH SOCKET.IO ---
const onlineUsers = new Set();
const lastSeenTimes = new Map();

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // 1. Track user online status & join personal room
    socket.on('user_connected', (userId) => {
        if (!userId) return;
        socket.userId = userId.toString();
        socket.join(`user_${socket.userId}`);
        
        onlineUsers.add(socket.userId);
        
        // Broadcast online status
        io.emit('update_user_status', { userId: socket.userId, status: 'online' });
        
        // Send initial sync
        socket.emit('initial_status_sync', {
            onlineUsers: Array.from(onlineUsers),
            lastSeenTimes: Object.fromEntries(lastSeenTimes)
        });
    });

    socket.on('join_room', ({ userId }) => {
        if (!userId) return;
        socket.userId = userId.toString();
        socket.join(`user_${socket.userId}`);
    });

    // 2. Handle incoming chat messages
    socket.on('send_message', async (data) => {
        try {
            const senderId = data.sender_id || data.senderId;
            const receiverId = data.receiver_id || data.receiverId;
            const messageType = (data.message_type || data.type || 'text').toString().trim();
            const content = data.content;

            if (!senderId || !receiverId || !content) {
                console.error("Missing required message fields:", data);
                return;
            }

            // Save message to database with guaranteed message_type
            const res = await pool.query(
                'INSERT INTO messages (sender_id, receiver_id, message_type, content, is_read) VALUES ($1, $2, $3, $4, FALSE) RETURNING *',
                [senderId, receiverId, messageType, content]
            );
            
            const savedMsg = res.rows[0];
            
            // 2. Fetch the sender's name from your users table
            const userRes = await pool.query('SELECT name FROM users WHERE id = $1', [senderId]);
            const senderName = userRes.rows[0] ? userRes.rows[0].name : 'User';

            const messagePayload = {
                    ...savedMsg,
                    sender_name: senderName,
                    message: savedMsg.content // just mapping content to message if your frontend expects .message
                };

            // 4. Emit to receiver
            io.to(`user_${receiverId}`).emit('new_message', messagePayload);
        } catch (err) {
            console.error("Error saving message to database:", err);
        }
    });

    // 3. Mark messages as read
    socket.on('mark_messages_read', async ({ senderId, receiverId }) => {
        try {
            await pool.query(
                'UPDATE messages SET is_read = TRUE WHERE sender_id = $1 AND receiver_id = $2 AND is_read = FALSE',
                [senderId, receiverId]
            );
            io.to(`user_${senderId}`).emit('messages_read', { readerId: receiverId });
        } catch (err) {
            console.error("Error marking messages read:", err);
        }
    });

    socket.on('delete_message', async ({ messageId }) => {
        try {
            // Ensure the user deleting it is actually the sender (using socket.userId stored during auth)
            const userId = socket.userId; 

            const query = `DELETE FROM messages WHERE id = $1 AND sender_id = $2 RETURNING id, receiver_id, sender_id`;
            const result = await pool.query(query, [messageId, userId]);

            if (result.rowCount > 0) {
                const msg = result.rows[0];
                
                // Emit to both the sender and the receiver so it vanishes live
                io.to(msg.receiver_id).emit('message_deleted', { messageId: msg.id });
                io.to(msg.sender_id).emit('message_deleted', { messageId: msg.id });
            }
        } catch (err) {
            console.error("Database message deletion error:", err);
        }
    });

    // 4. Update status listener
    socket.on('update_user_status', ({ userId, status }) => {
        const statusDot = document.querySelector(`.status-dot-${userId}`);
        if (statusDot) {
            statusDot.style.backgroundColor = status === 'online' ? '#10b981' : '#9ca3af';
        }

        if (activeChatPartnerId == userId) {
            const chatTargetStatus = document.getElementById('chatTargetStatus');
            if (chatTargetStatus) {
                chatTargetStatus.innerText = status === 'online' ? 'Online' : 'Offline';
                chatTargetStatus.style.color = status === 'online' ? '#10b981' : '#9ca3af';
            }
        }
    });

    // 5. Group messaging events
    socket.on('joinGroup', (groupId) => {
        socket.join(`group_${groupId}`);
    });

    socket.on('groupMessage', async ({ groupId, username, text }) => {
        try {
            const query = 'INSERT INTO group_messages (group_id, username, text_content) VALUES ($1, $2, $3) RETURNING *';
            await pool.query(query, [groupId, username, text]);
            
            const msgPayload = { username, text, time: new Date() };
            io.to(`group_${groupId}`).emit('messageReceived', msgPayload);
        } catch (err) {
            console.error('Socket DB save error:', err.message);
        }
    });

    // 6. Handle disconnection
    socket.on('disconnect', () => {
        if (socket.userId) {
            onlineUsers.delete(socket.userId);
            const now = new Date();
            lastSeenTimes.set(socket.userId, now);
            
            io.emit('update_user_status', { userId: socket.userId, status: 'offline', lastSeen: now });
        }
        console.log('A user disconnected:', socket.id);
    });
});


const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    // Explicitly declaring 'text/html' stops ORB from rejecting your index page
    res.setHeader('Content-Type', 'text/html'); 
    res.send('<h1>Your Web App is fully connected!</h1>');
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT} for all network devices.`);
});