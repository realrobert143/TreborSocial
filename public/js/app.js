// --- 1. SOCKET & USER INITIALIZATION ---
const socket = typeof io !== 'undefined' ? io() : null;

const storedUser = JSON.parse(localStorage.getItem('currentUser') || '{}');

// Extract the numeric ID and handle correctly
const currentUserId = storedUser.id; // This will be 1 (a number!)
const currentUserHandle = storedUser.username; // This will be handle

// --- DECLARE ALL UI ELEMENTS ONCE GLOBALLY ---
const searchBtn = document.getElementById('searchBtn');
const searchHandleInput = document.getElementById('searchHandle');
const sendBtn = document.getElementById('sendMessageBtn');
const messageInput = document.getElementById('messageInput');
const chatImageUpload = document.getElementById('chatImageUpload');
const profileUpload = document.getElementById('profileUpload');

if (socket && currentUserId) {
    socket.emit('user_connected', currentUserId);

    // Receive the list of users who are ALREADY online when you log in
    socket.on('current_online_users', (onlineUserIds) => {
        onlineUserIds.forEach(id => {
            updateUserStatusUI(id, 'online');
        });
    });

    // Listen for real-time status changes as users connect/disconnect later
    socket.on('update_user_status', ({ userId, status }) => {
        updateUserStatusUI(userId, status);
    });

    // Receive initial state when page loads
    socket.on('initial_status_sync', ({ onlineUsers, lastSeenTimes }) => {
        window.appLastSeenMap = lastSeenTimes || {};
        onlineUsers.forEach(id => updateUserStatusUI(id, 'online'));
    });

    socket.on('update_user_status', ({ userId, status, lastSeen }) => {
        if (lastSeen) {
            window.appLastSeenMap[userId] = lastSeen;
        }
        updateUserStatusUI(userId, status, lastSeen);

        // 2. Update active chat room header if viewing this specific user
        if (typeof activeChatPartnerId !== 'undefined' && String(activeChatPartnerId) === String(userId)) {
            const chatTargetStatus = document.getElementById('chatTargetStatus');
            if (chatTargetStatus) {
                chatTargetStatus.innerText = status === 'online' ? 'Online' : 'Offline';
                chatTargetStatus.style.color = status === 'online' ? '#10b981' : '#9ca3af';
            }
        }
    });

    socket.on('new_message', (data) => {
        // data expected: { sender_id, sender_name, message, ... }
        const isChatCurrentlyOpen = (typeof activeChatPartnerId !== 'undefined' && String(activeChatPartnerId) === String(data.sender_id));
        
        if (!isChatCurrentlyOpen) {
            // Show floating notification on bottom right
            if (String(activeChatPartnerId) !== String(data.sender_id)) {
            showToast(data.sender_name || 'New Message', data.content || data.message || 'Sent an attachment');
        }
            
            // Update badge count
            totalUnreadCount += 1;
            updateUnreadBadge(totalUnreadCount);
        } else {
            // Append message directly to active chat window
            renderSingleMessage(data);
        }
    });
    socket.on('message_deleted', (data) => {
        const msgElement = document.getElementById(`msg-${data.messageId}`);
        if (msgElement) {
            // Optional smooth fade-out effect before removal
            msgElement.style.transition = 'opacity 0.3s ease';
            msgElement.style.opacity = '0';
            setTimeout(() => msgElement.remove(), 300);
        }
    });
}


// Reusable dynamic avatar link parser using safe Dicebear fallback initials
function getAvatarUrl(url, username) {
    if (url && url.trim() !== "") return url;
    return `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(username || 'User')}`;
}
// --- 1. GLOBAL LOGOUT ROUTINE ---
function handleLogoutAction() {
    localStorage.clear();
    document.cookie = "userId=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    window.location.href = '/index.html';
}

// --- 2. ADMIN PORTAL USER PROVISIONING ---
const adminForm = document.getElementById('adminCreateForm');
if (adminForm) {
    adminForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('newUsername').value;
        const password = document.getElementById('newPassword').value;
        const role = document.getElementById('newRole').value;
        const statusMsg = document.getElementById('adminStatusMsg');

        statusMsg.style.color = "orange";
        statusMsg.innerText = "Provisioning account credentials...";

        try {
            const res = await fetch('/api/admin/create-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, role })
            });
            
            const data = await res.json();
            
            if(data.success) {
                statusMsg.style.color = "green";
                statusMsg.innerText = data.message;
                adminForm.reset();
            } else {
                statusMsg.style.color = "red";
                statusMsg.innerText = data.error || "Failed to create account.";
            }
        } catch (err) {
            console.error("Admin user creation failed:", err);
            statusMsg.style.color = "red";
            statusMsg.innerText = "Network transmission failed.";
        }
    });
}

// --- 3. SECURE AUTH GUARD (Runs on Chat Dashboard) ---
if (window.location.pathname.includes('chat.html')) {
    if (!currentUserId || currentUserId === "undefined" || currentUserId === "null") {
        handleLogoutAction();
    } else {
        fetch(`/api/users/me?userId=${currentUserId}`)
            .then(res => {
                if(!res.ok) throw new Error("Unauthorized session");
                return res.json();
            })
            .then(users => {
                const user = Array.isArray(users) ? users[0] : users; 
                if(!user) return handleLogoutAction();
                
                // Session is valid! We don't need to touch header elements here anymore 
                // because the Profile tab handles its own data via loadProfileData()!
            })
            .catch((err) => {
                console.error("Auth protection loop triggered:", err);
                handleLogoutAction();
            });
    }

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogoutAction);
    }
}
// --- 4. SIGN-IN ROUTINE (Runs on Login Page) ---
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('loginUsername').value;
        const password = document.getElementById('loginPassword').value;
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (data.success && data.userId) {
                localStorage.setItem('userId', data.userId);
                
                // Fetch and store full user profile data in localStorage for easy access
                try {
                    const userRes = await fetch(`/api/users/me?userId=${data.userId}`);
                    if (userRes.ok) {
                        const userData = await userRes.json();
                        const user = Array.isArray(userData) ? userData[0] : userData;
                        localStorage.setItem('currentUser', JSON.stringify(user));
                    }
                } catch (profileErr) {
                    console.error("Could not cache user profile:", profileErr);
                }

                window.location.href = '/chat.html';
            } else {
                alert(data.error || 'Authentication failure.');
            }
        } catch (err) {
            console.error("Login request failed:", err);
        }
    });
}
// --- COMMUNITY FEED FEATURE LOGIC ---
const submitPostBtn = document.getElementById('submitPostBtn');
const postTextInput = document.getElementById('postTextInput');
const postImageInput = document.getElementById('postImageInput');
const postsStreamContainer = document.getElementById('postsStreamContainer');
const postImageFileName = document.getElementById('postImageFileName');

let selectedPostImageFile = null;

if (postImageInput) {
    postImageInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            selectedPostImageFile = e.target.files[0];
            if(postImageFileName) postImageFileName.innerText = selectedPostImageFile.name;
        }
    });
}

function formatTimeAgo(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    
    const days = Math.floor(hours / 24);
    if (days === 1) return 'Yesterday';
    if (days === 2) return '2 days ago';
    
    // Older than 2 days: return clean short date (e.g., "Oct 24")
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}


// Render Post Card Function 
function renderPostCard(post) {
    if (!postsStreamContainer) return;

    const card = document.createElement('div');
    card.style.background = '#ffffff';
    card.style.borderRadius = '8px';
    card.style.padding = '0'; // Zero padding so media goes edge-to-edge
    card.style.marginBottom = '4px';
    card.style.border = '1px solid #dbdbdb';
    card.style.overflow = 'hidden';

    const timeString = formatTimeAgo(post.created_at);
    const likesCount = post.like_count || 0;
    const comments = post.comments || [];
    const avatarUrl = getAvatarUrl(post.profile_pic, post.username);

    // Check if the current logged-in user owns this post (to show delete button)
    const cachedUser = JSON.parse(localStorage.getItem('currentUser')) || {};
    const isOwner = Number(post.user_id) === Number(currentUserId || cachedUser.id);

    // Determine whether the uploaded file is a video or image based on its extension
    let mediaHtml = '';
    if (post.image_url) {
        const fileExt = post.image_url.split('.').pop().toLowerCase();
        const isVideo = ['mp4', 'mov', 'webm', 'avi'].includes(fileExt);

        if (isVideo) {
            mediaHtml = `
                <div style="width: 100%; background: #000; margin-bottom: 6px;">
                    <video controls class="post-video" preload="metadata" style="width: 100%; height: auto; max-height: 400px; display: block;">
                        <source src="${post.image_url}#t=0.002" type="video/${fileExt === 'mov' ? 'quicktime' : fileExt}">
                        Your browser does not support the video tag.
                    </video>
                </div>
            `;
        } else {
            mediaHtml = `
                <div style="width: 100%; background: #fafafa; margin-bottom: 6px;">
                    <img src="${post.image_url}" style="width: 100%; height: auto; max-height: 350px; object-fit: contain; display: block; margin: 0 auto; cursor: pointer;" onclick="openMediaModal('${post.image_url}')">
                </div>
            `;
        }
    }

    card.innerHTML = `
        <!-- Header Section with Padding -->
        <div style="display: flex; align-items: center; padding: 8px 10px 4px 10px; gap: 8px;">
            <img src="${avatarUrl}" style="width: 34px; height: 34px; border-radius: 50%; object-fit: cover; border: 1px solid var(--border-color);">
            <div style="font-weight: 700; font-size: 14px; color: var(--text-primary);">${post.name || 'Anonymous'}</div>
            <div style="margin-left: auto; font-size: 12px; color: var(--text-secondary); display: flex; align-items: center; gap: 8px; font-weight: 500;">
                <span>${timeString}</span>
                
                <!-- Three-dots Menu Container -->
                <div class="post-menu-container" style="position: relative;">
                    <button class="post-menu-btn" data-id="${post.id}" style="background: none; border: none; cursor: pointer; font-size: 16px; padding: 2px 4px; color: var(--text-secondary);" title="More options">⋮</button>
                    <div class="post-dropdown-menu" id="menu-${post.id}" style="display: none; position: absolute; right: 0; top: 20px; background: #ffffff; border: 1px solid #dbdbdb; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 100; min-width: 140px; overflow: hidden;">
                        ${isOwner ? `
                            <button class="dropdown-item delete-post-btn" data-id="${post.id}" data-type="post" style="display: block; width: 100%; padding: 10px 14px; background: none; border: none; text-align: left; color: #ed4956; font-weight: 500; cursor: pointer; font-size: 13px;">Delete Post</button>
                        ` : `
                            <button class="dropdown-item report-post-btn" data-id="${post.id}" style="display: block; width: 100%; padding: 10px 14px; background: none; border: none; text-align: left; color: #262626; cursor: pointer; font-size: 13px; border-bottom: 1px solid #efefef;">Report Post</button>
                            <button class="dropdown-item block-user-btn" data-userid="${post.user_id}" style="display: block; width: 100%; padding: 10px 14px; background: none; border: none; text-align: left; color: #ed4956; cursor: pointer; font-size: 13px;">Block User</button>
                        `}
                    </div>
                </div>
            </div>
        </div>

        <!-- Text Caption with Padding -->
        ${post.text_content ? `<div style="padding: 0 10px 6px 10px;"><p style="font-size: 14px; color: var(--text-primary); word-break: break-word; line-height: 1.4; margin: 0;">${escapeHtml(post.text_content)}</p></div>` : ''}
        
        <!-- Edge-to-Edge Media (Size Unchanged) -->
        ${mediaHtml}
        
        <!-- Post Actions with Padding -->
        <div style="padding: 0 10px 6px 10px;">
            <div style="display: flex; align-items: center; gap: 16px; border-top: 1px solid var(--border-color); padding-top: 6px; font-size: 13px; color: var(--text-secondary);">
                <button class="like-btn" data-id="${post.id}" style="background:none; border:none; cursor:pointer; display:flex; align-items: center; gap:6px; color: inherit; font-weight: 600; font-size: 13px;">
                    ❤️ <span class="like-count">${likesCount}</span>
                </button>
                <button class="comment-toggle-btn" style="background:none; border:none; cursor:pointer; display:flex; align-items: center; gap:6px; color: inherit; font-weight: 600; font-size: 13px;">
                    💬 <span class="comment-count">${comments.length}</span>
                </button>
            </div>
        </div>

        <!-- Comments Section with Padding -->
        <div class="comments-section" style="display: none; padding: 0 10px 8px 10px; border-top: 1px dashed var(--border-color);">
            <div class="comments-list" style="max-height: 120px; overflow-y: auto; margin-top: 6px; margin-bottom: 6px; font-size: 12px;">
                ${comments.length === 0 ? '<p style="color: var(--text-secondary); font-size: 12px; text-align: center; margin: 2px 0;">No comments yet.</p>' : 
                comments.map(c => `<div style="margin-bottom: 4px; background: var(--bg-secondary); padding: 4px 6px; border-radius: 4px;"><strong style="color: var(--text-primary);">${c.name}:</strong> ${c.comment_text}</div>`).join('')}
            </div>
            <div style="display: flex; gap: 4px;">
                <input type="text" class="comment-input" placeholder="Write a comment..." style="flex: 1; padding: 6px 8px; font-size: 12px; border: 1px solid var(--border-color); border-radius: 4px; outline: none; background: var(--input-bg); color: var(--text-primary);">
                <button class="submit-comment-btn" data-id="${post.id}" style="background: var(--accent); color: white; border: none; padding: 6px 12px; font-size: 12px; border-radius: 4px; cursor: pointer; font-weight: 600;">Post</button>
            </div>
        </div>
    `;

    // --- EVENT LISTENERS FOR CARD INTERACTIONS ---

    const deleteBtn = card.querySelector('.delete-post-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
            if (!confirm("Are you sure you want to delete this post?")) return;
            try {
                const res = await fetch(`/api/posts/${post.id}`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: currentUserId || cachedUser.id })
                });
                const data = await res.json();
                if (data.success) {
                    card.remove();
                } else {
                    alert(data.error || 'Failed to delete post');
                }
            } catch (err) {
                console.error("Delete post error:", err);
            }
        });
    }

    const likeBtn = card.querySelector('.like-btn');
    const likeCountSpan = card.querySelector('.like-count');
    likeBtn.addEventListener('click', async () => {
        try {
            const res = await fetch(`/api/posts/${post.id}/like`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: currentUserId || cachedUser.id })
            });
            const data = await res.json();
            if (data.success) {
                likeCountSpan.innerText = data.like_count;
            }
        } catch (err) {
            console.error("Like error:", err);
        }
    });

    const commentToggleBtn = card.querySelector('.comment-toggle-btn');
    const commentsSection = card.querySelector('.comments-section');
    commentToggleBtn.addEventListener('click', () => {
        commentsSection.style.display = commentsSection.style.display === 'none' ? 'block' : 'none';
    });

    const submitCommentBtn = card.querySelector('.submit-comment-btn');
    const commentInput = card.querySelector('.comment-input');
    const commentsList = card.querySelector('.comments-list');
    const commentCountSpan = card.querySelector('.comment-count');

    submitCommentBtn.addEventListener('click', async () => {
        const content = commentInput.value.trim();
        if (!content) return;

        try {
            const res = await fetch(`/api/posts/${post.id}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: currentUserId || cachedUser.id, commentText: content })
            });
            const data = await res.json();
            if (data.success) {
                if (commentsList.innerHTML.includes('No comments yet.')) {
                    commentsList.innerHTML = '';
                }
                
                const newC = data.comment;
                const textToShow = newC.comment_text || newC.content;
                commentsList.innerHTML += `<div style="margin-bottom: 4px; background: #fafafa; padding: 4px 6px; border-radius: 4px;"><strong style="color: #262626;">@${newC.username || 'You'}:</strong> ${escapeHtml(textToShow)}</div>`;
                
                if (data.comment_count !== undefined) {
                    commentCountSpan.innerText = data.comment_count;
                }

                commentInput.value = '';
            }
        } catch (err) {
            console.error("Comment submission error:", err);
        }
    });

    postsStreamContainer.appendChild(card);
}




// Fetch and render all posts on load
async function loadFeedPosts() {
    if (!postsStreamContainer) return;
    try {
        const res = await fetch('/api/posts');
        if (res.ok) {
            const posts = await res.json();
            postsStreamContainer.innerHTML = '';
            if (posts.length === 0) {
                postsStreamContainer.innerHTML = `<p style="color:#868e96; text-align:center; margin-top:30px; font-size:14px;">No posts yet. Be the first to share something!</p>`;
                return;
            }
            posts.forEach(post => renderPostCard(post));
        }
    } catch (err) {
        console.error("Failed to load feed posts:", err);
    }
}

// Helper to prevent HTML injection in post text
function escapeHtml(str) {
    if (!str) return ''; // Safely return an empty string if input is null/undefined
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
if (submitPostBtn) {
    submitPostBtn.addEventListener('click', async () => {
        const text = postTextInput.value.trim();
        if (!text && !selectedPostImageFile) return;

        submitPostBtn.innerText = "Posting...";
        submitPostBtn.disabled = true;

        try {
            const cachedUser = JSON.parse(localStorage.getItem('currentUser')) || {};
            const activeUserId = currentUserId || cachedUser.id;

            if (!activeUserId) {
                alert("Session user ID not found. Please log in again.");
                return;
            }

            const postFormData = new FormData();
            postFormData.append('userId', activeUserId);
            postFormData.append('text', text);
            if (selectedPostImageFile) {
                postFormData.append('image', selectedPostImageFile);
            }

            const res = await fetch('/api/posts', {
                method: 'POST',
                body: postFormData // Note: Do NOT set Content-Type header when sending FormData!
            });

            const data = await res.json();

            if (res.ok && data.success) {
                postTextInput.value = '';
                selectedPostImageFile = null;
                if (postImageFileName) postImageFileName.innerText = '';
                if (postImageInput) postImageInput.value = '';
                
                // Refresh feed stream
                loadFeedPosts();
            } else {
                alert(data.error || 'Failed to create post.');
            }
        } catch (err) {
            console.error("Post creation error:", err);
        } finally {
            submitPostBtn.innerText = "Post";
            submitPostBtn.disabled = false;
        }
    });
}
// 1. Toggle Like Function
async function toggleLikePost(postId) {
    const cachedUser = JSON.parse(localStorage.getItem('currentUser')) || {};
    const activeUserId = currentUserId || cachedUser.id;

    if (!activeUserId) return alert("Please log in to like posts.");

    try {
        const res = await fetch(`/api/posts/${postId}/like`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: activeUserId })
        });
        const data = await res.json();

        if (res.ok) {
            const count = data.likeCount !== undefined ? data.likeCount : data.like_count;
            
            // Update DOM element count
            const likeCountSpan = document.querySelector(`#like-count-${postId}`);
            if (likeCountSpan) {
                likeCountSpan.innerText = `${count} ${count === 1 ? 'Like' : 'Likes'}`;
            }

            const likeBtn = document.querySelector(`#like-btn-${postId}`);
            if (likeBtn) {
                likeBtn.classList.toggle('liked', data.liked);
            }
        }
    } catch (err) {
        console.error("Error liking post:", err);
    }
}

// 2. Submit Comment Function
async function submitComment(postId, inputElement) {
    const commentText = inputElement.value.trim();
    if (!commentText) return;

    const cachedUser = JSON.parse(localStorage.getItem('currentUser')) || {};
    const activeUserId = currentUserId || cachedUser.id;

    if (!activeUserId) return alert("Please log in to comment.");

    try {
        const res = await fetch(`/api/posts/${postId}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: activeUserId,
                commentText: commentText
            })
        });

        const data = await res.json();

        if (res.ok && data.success) {
            inputElement.value = '';
            // Append comment to thread or reload comments
            appendCommentToDOM(postId, data.comment);
        } else {
            alert(data.error || "Failed to post comment.");
        }
    } catch (err) {
        console.error("Error submitting comment:", err);
    }
}

// Listen for live broadcasted posts via Socket.io
if (socket) {
    socket.on('newPost', (newPost) => {
        renderPostCard(newPost);
    });
}

// --- LOAD PROFILE DATA FOR PROFILE TAB ---
// --- LOAD PROFILE DATA FOR PROFILE TAB ---
async function loadProfileData() {
    console.log("Current User ID / Handle being sent:", currentUserId);

    if (!currentUserId || currentUserId === "undefined" || currentUserId === "null") {
        const usernameEl = document.getElementById('profile-username');
        if (usernameEl) usernameEl.innerText = 'Guest User';
        return;
    }

    try {
        const res = await fetch(`/api/users/me?userId=${currentUserId}`);
        console.log("Response status:", res.status);
        
        if (!res.ok) throw new Error(`Failed to fetch profile data: ${res.status}`);
        const users = await res.json();
        const user = Array.isArray(users) ? users[0] : users;

        if (user) {
            // Populate Username
            const usernameEl = document.getElementById('profile-username');
            if (usernameEl) {
                usernameEl.innerText = `@${user.username}`;
            }

            // Populate Name (if you have this element)
            const nameEl = document.getElementById('profile-name');
            if (nameEl && user.name) {
                nameEl.innerText = user.name;
            }

            // Populate Profile Picture
            const picEl = document.getElementById('profile-pic');
            if (picEl) {
                picEl.src = getAvatarUrl(user.profile_pic_url, user.username);
            }

            // Populate Bio
            const bioEl = document.getElementById('profile-bio');
            if (bioEl) {
                bioEl.innerText = user.bio || 'Tap "Edit Bio / Details" to add something about yourself!';
            }

            // Populate Join Date
            const joinedEl = document.getElementById('profile-joined');
            if (joinedEl && user.created_at) {
                const joinDate = new Date(user.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
                joinedEl.innerText = `Joined ${joinDate}`;
            }
        }
    } catch (err) {
        console.error("Error loading profile data:", err);
    }
}

// Event Listeners for Profile Actions
document.addEventListener('DOMContentLoaded', () => {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));

    // Edit Bio Button
    const updateBioBtn = document.getElementById('update-bio-btn');
    if (updateBioBtn) {
        updateBioBtn.addEventListener('click', async () => {
            const currentBioElem = document.getElementById('profile-bio');
            const currentBio = currentBioElem.innerText.includes('Tap') ? '' : currentBioElem.innerText;
            
            const newBio = await showCustomPrompt("Enter your new bio:", currentBio);
            if (newBio === null) return; // Cancelled

            try {
                const response = await fetch('/api/users/profile', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: currentUser.username,
                        bio: newBio
                    })
                });
                const data = await response.json();
                if (data.success) {
                    currentBioElem.innerText = data.user.bio || 'No bio added yet.';
                } else {
                    alert('Failed to update bio: ' + data.error);
                }
            } catch (err) {
                console.error("Bio update network error:", err);
            }
        });
    }

    // Profile Tab Avatar File Upload Handler
const profileImageInput = document.getElementById('profileImageInput');
if (profileImageInput) {
    profileImageInput.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        const cachedUser = JSON.parse(localStorage.getItem('currentUser')) || {};
        if (!cachedUser.id && !currentUserId) return;
        const targetUserId = currentUserId || cachedUser.id;

        const formData = new FormData();
        formData.append('file', files[0]);

        try {
            // 1. Upload image file to server
            const res = await fetch('/api/uploads', { method: 'POST', body: formData });
            const data = await res.json();

            if (data.success) {
                // 2. Save new avatar URL to database
                const dbRes = await fetch('/api/users/update-avatar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: targetUserId, url: data.url })
                });
                const dbData = await dbRes.json();
                
                if (dbData.success) {
                    // 3. Update UI instantly
                    const profilePicImg = document.getElementById('profile-pic');
                    if (profilePicImg) {
                        profilePicImg.src = data.url;
                    }
                    
                    // Update cached user object
                    cachedUser.profile_pic_url = data.url;
                    localStorage.setItem('currentUser', JSON.stringify(cachedUser));

                    alert("Profile picture updated successfully!");
                } else {
                    alert("Failed to save avatar to database.");
                }
            }
        } catch (err) {
            console.error("Avatar upload error:", err);
            alert("Network error while uploading picture.");
        }
    });
}

    // Logout Button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('currentUser');
            window.location.reload(); // Returns user to login/auth screen
        });
    }

    try {
        const storedUser = localStorage.getItem('currentUser');
        if (storedUser) {
            const user = JSON.parse(storedUser);
            const ADMIN_USER_ID = 2; 
            if (user && user.id == ADMIN_USER_ID) {
                const adminBtn = document.getElementById('adminCreateUserBtn');
                if (adminBtn) {
                    adminBtn.style.display = 'block';
                }
            }
        }
    } catch (e) {
        console.error("Error checking admin status:", e);
    }

});



// Toggle Post Creator Box visibility
const togglePostBtn = document.getElementById('togglePostCreatorBtn');
const postCreatorBox = document.getElementById('postCreatorBox');



// --- Navigation Tab Switching ---
function switchAppTab(targetScreenId, btnElement) {
    ['homeScreen', 'dashboardScreen', 'feedScreen', 'profileScreen'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.remove('active');
        }
    });

    const target = document.getElementById(targetScreenId);
    if (target) {
        target.classList.add('active');

        // If switching to Profile, load user data
        if (targetScreenId === 'homeScreen' && typeof loadHomeTabData === 'function') {
            loadHomeTabData();
        }

        // If switching to Profile, load user data
        if (targetScreenId === 'dashboardScreen' && typeof loadActiveChatsList === 'function') {
            loadActiveChatsList();
        }

        // If switching to FeedScreen, load posts
        if (targetScreenId === 'feedScreen' && typeof loadFeedPosts === 'function') {
            loadFeedPosts();
        }
        
        // If switching to Profile, load user data
        if (targetScreenId === 'profileScreen' && typeof loadProfileData === 'function') {
            loadProfileData();
        }
    }

    // Update bottom nav active styling
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
        btn.classList.remove('text-indigo-600');
        btn.classList.add('text-gray-400');
    });
    if (btnElement) {
        btnElement.classList.remove('text-gray-400');
        btnElement.classList.add('text-indigo-600');
    }
}

// --- Bottom Navbar Visibility Observer ---
document.addEventListener('DOMContentLoaded', () => {
    const chatRoomScreenEl = document.getElementById('chatRoomScreen');
    const bottomNavEl = document.getElementById('bottomNav');
    
    if (chatRoomScreenEl && bottomNavEl) {
        const observer = new MutationObserver(() => {
            if (chatRoomScreenEl.classList.contains('active')) {
                bottomNavEl.style.display = 'none';
            } else {
                bottomNavEl.style.display = 'flex';
            }
        });
        observer.observe(chatRoomScreenEl, { attributes: true, attributeFilter: ['class'] });
    }
});

// --- 5. WEBSOCKET REAL-TIME CHAT AND MESSAGING ---
// 1. Global Socket setup (Runs anywhere socket is available)
if (socket && currentUserId) {
    socket.emit('join_room', { userId: currentUserId });
    loadActiveChatsList();
}

// 3. Send Message Feature (Runs independently whenever you are in a chat room)
if (sendBtn && messageInput) {
    sendBtn.replaceWith(sendBtn.cloneNode(true));
    const newSendBtn = document.getElementById('sendMessageBtn');

    newSendBtn.addEventListener('click', () => {
        const messageText = messageInput.value.trim();
        if (!messageText) return;
        if (!activeChatPartnerId) {
            alert("Please select a chat first!");
            return;
        }

        const sentMsgObj = {
            sender_id: currentUserId,
            receiver_id: activeChatPartnerId,
            message_type: 'text',
            content: messageText,
            created_at: new Date(),
            is_read: false
        };

        renderSingleMessage(sentMsgObj);
        socket.emit('send_message', sentMsgObj);
        messageInput.value = '';
    });
}

// 4. Chat Image Upload (Independent check)
if (chatImageUpload) {
    chatImageUpload.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (!files || files.length === 0 || !activeChatPartnerId) return;

        const formData = new FormData();
        formData.append('file', files[0]);

        try {
            const res = await fetch('/api/uploads', { method: 'POST', body: formData });
            const data = await res.json();

            if (data.success) {
                socket.emit('send_message', {
                    senderId: currentUserId,
                    receiverId: activeChatPartnerId,
                    type: 'image',
                    content: data.url
                });
            }
        } catch (err) {
            console.error("Chat image process error:", err);
        }
    });
}

// 5. Profile Upload (Independent check)
if (profileUpload) {
    profileUpload.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        const formData = new FormData();
        formData.append('file', files[0]);

        try {
            const res = await fetch('/api/uploads', { method: 'POST', body: formData });
            const data = await res.json();

            if (data.success) {
                const dbRes = await fetch('/api/users/update-avatar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: currentUserId, url: data.url })
                });
                const dbData = await dbRes.json();
                
                if(dbData.success) {
                    document.getElementById('myAvatar').src = data.url;
                    alert("Profile picture saved permanently!");
                    loadActiveChatsList();
                }
            }
        } catch (err) {
            console.error("Avatar replacement breakdown:", err);
        }
    });

}

//Image and video compress function need to use it somewhere 
function compressImageFile(file, maxWidth = 800, quality = 0.7) {
    return new Promise((resolve) => {
        if (!file || !file.type.startsWith('image/')) {
            return resolve(file); // Return original if not an image
        }

        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob((blob) => {
                    if (!blob) return resolve(file);
                    const compressedFile = new File([blob], file.name, { 
                        type: 'image/jpeg', 
                        lastModified: Date.now() 
                    });
                    resolve(compressedFile);
                }, 'image/jpeg', quality);
            };
        };
    });
}


// Reusable centered modal alert function
function showCustomAlert(message, onClose) {
    // Remove any existing modal if already open
    const existing = document.getElementById('customAlertModal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'customAlertModal';
    overlay.className = 'custom-modal-overlay';
    
    overlay.innerHTML = `
        <div class="custom-modal-box">
            <p style="margin: 0 0 5px 0; color: #1f2937; font-size: 15px; font-weight: 500; word-break: break-word;">${message}</p>
            <button class="custom-modal-btn" id="customAlertOkBtn">OK</button>
        </div>
    `;
    
    document.body.appendChild(overlay);

    const closeAlert = () => {
        overlay.remove();
        if (typeof onClose === 'function') onClose();
    };

    document.getElementById('customAlertOkBtn').addEventListener('click', closeAlert);
    
    // Optional: Close when clicking outside the modal box
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeAlert();
    });
}

// Globally override browser native alert boxes
window.alert = function(msg) {
    showCustomAlert(msg);
};

// Reusable centered prompt modal with input
function showCustomPrompt(title, defaultValue = '') {
    return new Promise((resolve) => {
        const existing = document.getElementById('customPromptModal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'customPromptModal';
        overlay.className = 'custom-modal-overlay'; // Uses the same overlay style as your alert modal
        
        overlay.innerHTML = `
            <div class="custom-modal-box">
                <p style="margin: 0 0 10px 0; color: #1f2937; font-size: 15px; font-weight: 500; text-align: left;">${title}</p>
                <input type="text" id="customPromptInput" value="${defaultValue}" style="width: 100%; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 6px; box-sizing: border-box; margin-bottom: 15px; font-size: 14px; outline: none;">
                <div style="display: flex; gap: 10px;">
                    <button id="customPromptCancelBtn" style="flex: 1; background: #e5e7eb; color: #374151; border: none; padding: 8px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 14px;">Cancel</button>
                    <button id="customPromptOkBtn" style="flex: 1; background: #4c6ef5; color: white; border: none; padding: 8px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 14px;">Save</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(overlay);

        const inputField = document.getElementById('customPromptInput');
        inputField.focus();
        inputField.setSelectionRange(inputField.value.length, inputField.value.length); // Focus text cursor at the end

        const close = (value) => {
            overlay.remove();
            resolve(value); // Returns input string or null if canceled
        };

        document.getElementById('customPromptOkBtn').addEventListener('click', () => close(inputField.value));
        document.getElementById('customPromptCancelBtn').addEventListener('click', () => close(null));
        
        inputField.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') close(inputField.value);
            if (e.key === 'Escape') close(null);
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close(null);
        });
    });
}


// --- Global Active Chats Loader ---
async function loadActiveChatsList() {
    const container = document.getElementById('activeChatsContainer');
    if (!container) return;
    container.innerHTML = '';

    try {
        const res = await fetch(`/api/chats/active?userId=${currentUserId}`);
        if (res.ok) {
            const chats = await res.json();
            if (chats.length === 0) {
                container.innerHTML = `<p style="color:#868e96; text-align:center; margin-top:20px; font-size:14px;">No active conversations. Search a handle to start chatting!</p>`;
                return;
            }
            chats.forEach(chat => {
                const displayName = chat.name || chat.username; // <--- Defined here
                console.log("Chat Partner:", chat.id, "| Sender ID:", chat.sender_id, "| Current User:", currentUserId);

                const item = document.createElement('div');
                item.classList.add('chat-item');
                
                let previewText = "Say hi 👋";
                if (chat.last_message) {
                    let rawText = chat.last_message;
                    if (chat.message_type === 'image') rawText = "📷 Photo";
                    else if (chat.message_type === 'video') rawText = "🎥 Video";

                    // Check if you sent the last message
                    if (String(chat.sender_id) === String(currentUserId)) {
                        previewText = `You: ${rawText}`;
                    } else {
                        previewText = rawText;
                    }
                }

                let timeText = "";
                if (chat.last_message_time) {
                    const d = new Date(chat.last_message_time);
                    const now = new Date();
                    timeText = d.toDateString() === now.toDateString() 
                        ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
                        : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
                }

                // Removed inline onclick to avoid parameter mismatch
                item.innerHTML = `
                    <div class="modern-chat-item">
                        <div class="avatar-status-wrapper">
                            <img src="${getAvatarUrl(chat.profile_pic_url, chat.username)}" alt="Avatar" class="chat-item-avatar">
                            <span class="status-indicator status-dot-${chat.id}"></span>
                        </div>
                        <div class="modern-chat-info">
                            <div class="chat-info-header">
                                <h4>${displayName}</h4>
                                <span class="chat-time-stamp">${timeText}</span>
                            </div>
                            <p class="chat-preview-text">${previewText}</p>
                        </div>
                        <div class="chat-item-arrow">❯</div>
                    </div>
                `;

                // Clean click handler passing all details to avoid "undefined" names
                item.addEventListener('click', () => {
                    openChatScreen(chat.id, displayName, chat.username, chat.profile_pic_url);
                });

                container.appendChild(item);
            });
        }
    } catch (err) {
        console.error("Error loading dashboard items:", err);
    }
}

// --- Global Open Chat Screen ---
async function openChatScreen(id, name, username, avatar) {
    activeChatPartnerId = id;

    closeSearchModal();
    
    const displayHeaderName = name ? name : username;
    const chatTargetNameEl = document.getElementById('chatTargetName');
    if (chatTargetNameEl) chatTargetNameEl.innerText = displayHeaderName;
    
    const chatTargetHandle = document.getElementById('chatTargetHandle');
    if (chatTargetHandle) chatTargetHandle.innerText = `@${username}`;

    const chatTargetAvatar = document.getElementById('chatTargetAvatar');
    if (chatTargetAvatar) chatTargetAvatar.src = getAvatarUrl(avatar, username);
    
    const dashboardScreen = document.getElementById('dashboardScreen');
    const chatRoomScreen = document.getElementById('chatRoomScreen');
    if (dashboardScreen) dashboardScreen.classList.remove('active');
    if (chatRoomScreen) chatRoomScreen.classList.add('active');
    
    const display = document.getElementById('messageDisplayArea');
    if (display) display.innerHTML = ''; 

    // Inside openChatScreen():
    const statusEl = document.getElementById('chatTargetStatus');
    if (statusEl) {
        const isOnline = window.currentOnlineUsersSet && window.currentOnlineUsersSet.has(String(activeChatPartnerId));
        
        if (isOnline) {
            statusEl.innerText = "Online";
            statusEl.style.color = "#10b981";
        } else {
            const storedTime = window.appLastSeenMap && window.appLastSeenMap[activeChatPartnerId];
            if (storedTime) {
                const date = new Date(storedTime);
                statusEl.innerText = `Last seen ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            } else {
                statusEl.innerText = ""; // or leave blank if no last seen time exists yet
            }
            statusEl.style.color = "#9ca3af";
        }
    }
    try {
    const res = await fetch(`/api/messages/history?userId=${currentUserId}&partnerId=${activeChatPartnerId}`);
    if (res.ok) {
        const historyMessages = await res.json();
        
        const display = document.getElementById('messageDisplayArea');
        if (display) display.innerHTML = ''; // Clear previous messages

        let lastDateKey = null;

        historyMessages.forEach(msg => {
            const msgDate = new Date(msg.created_at);
            const dateKey = msgDate.toDateString();

            // Insert date separator if day changed
            if (dateKey !== lastDateKey) {
                lastDateKey = dateKey;
                if (display) {
                    const divider = document.createElement('div');
                    divider.classList.add('date-divider');
                    divider.innerHTML = `<span>${formatDateHeading(msgDate)}</span>`;
                    display.appendChild(divider);
                }
            }

            renderSingleMessage(msg);
        });
    }

    // Trigger read receipts
    if (socket && currentUserId) {
                socket.emit('mark_messages_read', { senderId: activeChatPartnerId, receiverId: currentUserId });
            }
        } catch (err) {
            console.error("History load error:", err);
        }

        function formatDateHeading(dateObj) {
            const today = new Date();
            const yesterday = new Date(today);
            yesterday.setDate(today.getDate() - 1);

            if (dateObj.toDateString() === today.toDateString()) return 'Today';
            if (dateObj.toDateString() === yesterday.toDateString()) return 'Yesterday';

            return dateObj.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        }
    
}

//Message Delete Engine 

function deleteMessage(messageId) {
    console.log("Attempting to delete message with ID:", messageId);

    // Try finding by ID first
    let msgElement = document.getElementById(`msg-${messageId}`);
    
    // Fallback search if id formatting differs
    if (!msgElement) {
        msgElement = document.querySelector(`[data-msg-id="${messageId}"]`);
    }

    if (msgElement) {
        msgElement.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        msgElement.style.opacity = '0';
        msgElement.style.transform = 'scale(0.9)';
        setTimeout(() => msgElement.remove(), 200);
    } else {
        console.warn("Could not find message element in DOM for ID:", messageId);
    }

    // Emit to backend to delete from PostgreSQL and sync other devices via socket
    if (socket) {
        socket.emit('delete_message', { messageId });
    }

    // Close the action sheet popup
    closeMsgSheet();
}

function openMessageOptions(messageId, encodedText, isOwnMessage) {
    const text = decodeURIComponent(encodedText);
    
    let sheet = document.getElementById('msgActionSheet');
    if (!sheet) {
        sheet = document.createElement('div');
        sheet.id = 'msgActionSheet';
        sheet.className = 'msg-sheet-overlay';
        document.body.appendChild(sheet);
    }

    sheet.innerHTML = `
        <div class="msg-sheet-content">
            <button onclick="copyMessageText('${encodedText}')">📋 Copy Text</button>
            ${isOwnMessage ? `<button class="delete-btn" onclick="deleteMessage(${messageId})">🗑️ Delete Message</button>` : ''}
            <button onclick="closeMsgSheet()" class="cancel-btn">Cancel</button>
        </div>
    `;
    sheet.style.display = 'flex';
}

function copyMessageText(encodedText) {
    navigator.clipboard.writeText(decodeURIComponent(encodedText));
    closeMsgSheet();
}

function deleteMessage(messageId) {
    // Emit to your Node.js backend via WebSocket to update PostgreSQL and remove for both users
    socket.emit('delete_message', { messageId });
    closeMsgSheet();
}

function closeMsgSheet() {
    const sheet = document.getElementById('msgActionSheet');
    if (sheet) sheet.style.display = 'none';
}

// Global toggle method to handle opening the view panel safely
function openProfileModal(name, avatarUrl, joinedDateString) {
    // Populate layout data directly to avoid dynamic asynchronous API blocks if you want
    document.getElementById('modalUserName').innerText = name || "Username";
    document.getElementById('modalUserDp').src = avatarUrl || "https://placeholder.com";
    document.getElementById('modalUserJoinedDate').innerText = joinedDateString || "Unknown Date";
    
    // Switch modal layout state to flex view layer display
    document.getElementById('profileModal').style.display = 'flex';
}

function closeProfileModal(event) {
    if (event) event.stopPropagation();
    document.getElementById('profileModal').style.display = 'none';
}

// 1. The click listener attached directly to your Header name/DP
function handleHeaderProfileClick() {
    // 💡 UPDATE THIS: Check your app.js for what global variable holds the current active user ID.
    // Examples could be: activeChatUserId, currentTargetUser, selectedUser.id, etc.
    const currentActiveUserId = typeof activeChatUserId !== 'undefined' ? activeChatUserId : null;
    
    if (currentActiveUserId) {
        // Trigger the profile modal view loop using the active ID
        fetchAndOpenProfileModal(currentActiveUserId);
    } else {
        // Fallback: If no ID exists, pull the raw data currently visible on screen directly
        const visibleName = document.getElementById('chatTargetName').innerText;
        const visibleAvatar = document.getElementById('chatTargetAvatar').src;
        
        // Open the modal layout instantly using available information
        document.getElementById('modalUserName').innerText = visibleName;
        document.getElementById('modalUserDp').src = visibleAvatar;
        document.getElementById('modalUserJoinedDate').innerText = "Recently";
        document.getElementById('profileModal').style.display = 'flex';
    }
}
// 2. The core API processing routine that retrieves details from your server database
async function fetchAndOpenProfileModal(userId) {
    // Reveal the hidden overlay layout instantly in a loading state
    document.getElementById('modalUserName').innerText = "Loading...";
    document.getElementById('modalUserJoinedDate').innerText = "-";
    document.getElementById('profileModal').style.display = 'flex';

    try {
        // Fetch detailed profile info from your existing user info backend endpoints
        // 💡 UPDATE THIS URL to match your exact backend endpoint API path route structure
        const response = await fetch(`/api/users/${userId}`); 
        if (!response.ok) throw new Error('API request failed');
        
        const userData = await response.json();
        
        // Populate layout parameters (Change variable keys if your API uses different names)
        document.getElementById('modalUserName').innerText = userData.name || "User Profile";
        document.getElementById('modalUserDp').src = userData.pic || userData.avatar || "https://placeholder.com";
        
        // Convert timestamp strings into clean human-readable date presentation formatting
        if (userData.joinedDate) {
            const joinDate = new Date(userData.joinedDate).toLocaleDateString(undefined, {
                year: 'numeric', month: 'long', day: 'numeric'
            });
            document.getElementById('modalUserJoinedDate').innerText = joinDate;
        } else {
            document.getElementById('modalUserJoinedDate').innerText = "Unknown";
        }

    } catch (error) {
        console.error("Failed fetching profile details:", error);
        document.getElementById('modalUserName').innerText = "Error loading profile";
    }
}

// 3. Closes the UI layout window display frame safely
function closeProfileModal(event) {
    if (event) event.stopPropagation();
    document.getElementById('profileModal').style.display = 'none';
}


function updateUserStatusUI(userId, status) {
    // 1. Update list item dot in chat list sidebar
    const statusDot = document.querySelector(`.status-dot-${userId}`);
    if (statusDot) {
        statusDot.style.backgroundColor = status === 'online' ? '#10b981' : '#9ca3af';
    }

    
}

//Message notifications Helper Functions

let totalUnreadCount = 0;

function showToast(title, message) {
    try {
        // 2. Fallback Web Toast (creates a floating pill on screen)
        let toast = document.getElementById('appToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'appToast';
            toast.style.cssText = 'position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%); background: #1e293b; color: #fff; padding: 10px 18px; border-radius: 20px; z-index: 9999; font-size: 13px; box-shadow: 0 4px 12px rgba(0,0,0,0.4); transition: opacity 0.3s ease; pointer-events: none;';
            document.body.appendChild(toast);
        }
        
        toast.innerText = `${title}: ${message}`;
        toast.style.opacity = '1';
        
        // Auto hide after 3 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
        }, 3000);
    } catch (err) {
        console.error("Toast fallback error:", err);
    }
}

function updateUnreadBadge(count) {
    totalUnreadCount = count;
    const badge = document.getElementById('chatsNavBadge'); // Make sure this is the ID of your bottom nav badge element
    if (badge) {
        if (count > 0) {
            badge.innerText = count > 99 ? '99+' : count;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }
}


// Global map to store last seen times on the client side
window.appLastSeenMap = {};

function formatLastSeen(timestamp) {
    if (!timestamp) return 'Offline';
    const date = new Date(timestamp);
    return `Last seen ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function updateUserStatusUI(userId, status, lastSeen) {
    // 1. Update sidebar list item dot if present
    const statusDot = document.querySelector(`.status-dot-${userId}`);
    if (statusDot) {
        statusDot.style.backgroundColor = status === 'online' ? '#10b981' : '#9ca3af';
    }

    // 2. Update active chat room header if viewing this specific user
    if (typeof activeChatPartnerId !== 'undefined' && String(activeChatPartnerId) === String(userId)) {
        const chatTargetStatus = document.getElementById('chatTargetStatus');
        if (chatTargetStatus) {
            if (status === 'online') {
                chatTargetStatus.innerText = 'Online';
                chatTargetStatus.style.color = '#10b981';
            } else {
                const storedTime = lastSeen || window.appLastSeenMap[userId];
                chatTargetStatus.innerText = formatLastSeen(storedTime);
                chatTargetStatus.style.color = '#9ca3af';
            }
        }
    }
}


// Open/Close Modal Controls
function openSearchModal() {
    const modal = document.getElementById('searchModal');
    if (modal) modal.classList.add('open');
    const input = document.getElementById('contactSearchInput');
    if (input) input.focus();
}

function closeSearchModal() {
    const modal = document.getElementById('searchModal');
    if (modal) modal.classList.remove('open');
    const input = document.getElementById('contactSearchInput');
    if (input) input.value = '';
    const list = document.getElementById('searchResultsList');
    if (list) list.innerHTML = '';
}

// Live Search Input Handler with Debounce
// Live Search Input Handler with Debounce
let searchTimeout;
const searchInput = document.getElementById('contactSearchInput');

if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value.trim();
        const listContainer = document.getElementById('searchResultsList');

        if (!query) {
            listContainer.innerHTML = '';
            return;
        }

        searchTimeout = setTimeout(async () => {
            try {
                const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
                const users = await res.json();
                
                if (users.length === 0) {
                    listContainer.innerHTML = '<p style="text-align: center; color: #868e96; font-size: 13px; padding: 20px;">No users found</p>';
                    return;
                }

                const myId = Number(currentUserId || (JSON.parse(localStorage.getItem('currentUser') || '{}').id) || 0);

                listContainer.innerHTML = users.map(u => {
                    let btnHtml = '';
                    const status = u.friendship_status;
                    const actionUser = Number(u.action_user_id);

                    if (status === 'accepted') {
                        const displayName = u.name || u.username;
                        // Escape single quotes just in case a user's name has an apostrophe like O'Connor
                        const safeName = displayName.replace(/'/g, "\\'");
                        const safePic = (u.profile_pic_url || '').replace(/'/g, "\\'");
                        
                        btnHtml = `<button onclick="openChatScreen(${u.id}, '${safeName}', '${u.username}', '${safePic}')" style="background: #10b981; color: white; border: none; padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer;">💬 Chat</button>`;

                    } else if (status === 'pending') {
                        if (actionUser === myId) {
                            btnHtml = `<button onclick="handleFriendAction(${u.id}, 'remove')" style="background: #fee2e2; color: #ef4444; border: none; padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer;">Cancel</button>`;
                        } else {
                            btnHtml = `<button onclick="handleFriendAction(${u.id}, 'accept')" style="background: #dbeafe; color: #2563eb; border: none; padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer;">Accept</button>`;
                        }
                    } else {
                        btnHtml = `<button onclick="handleFriendAction(${u.id}, 'send')" style="background: #eef2ff; color: #4c6ef5; border: none; padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer;">Add</button>`;
                    }

                    return `
                        <div style="display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 12px; background: #ffffff; border: 1.5px solid #f1f3f5;">
                            <img src="${u.profile_pic_url || 'https://via.placeholder.com/40'}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; background: #e9ecef;">
                            <div style="flex: 1; min-width: 0;">
                                <div style="font-size: 14px; font-weight: 700; color: #1a1b1e;">${u.name || u.username}</div>
                                <div style="font-size: 12px; color: #868e96;">@${u.username}</div>
                            </div>
                            ${btnHtml}
                        </div>
                    `;
                }).join('');
            } catch (err) {
                console.error('Search fetch error:', err);
            }
        }, 300);
    });
}

// Global handler for friendship buttons inside search results
async function handleFriendAction(targetUserId, action) {
    try {
        const res = await fetch('/api/friendships', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetUserId, action })
        });
        const data = await res.json();
        if (data.success) {
            // Re-trigger the search input event to instantly refresh button states
            if (searchInput) searchInput.dispatchEvent(new Event('input'));
        } else {
            alert(data.error || 'Action failed');
        }
    } catch (err) {
        console.error('Friend action error:', err);
    }
}

function renderSingleMessage(msg) {
    const scrollview = document.getElementById('chatRoomScreen');
    const display = document.getElementById('messageDisplayArea');
    if (!display) return;

    // 1. Create the container element properly
    const messageElement = document.createElement('div');
    messageElement.className = `message-item ${msg.sender_id == localStorage.getItem('userId') ? 'sent' : 'received'}`;

    const box = document.createElement('div');
    box.classList.add('message', msg.sender_id == currentUserId ? 'sent' : 'received');
    box.id = `msg-${msg.id}`; // Crucial for instant deletion
    
    const isOwnMessage = msg.sender_id == currentUserId;
    let pressTimer = null;

    // 2. Handle Snaps (Images or Videos)
    if (msg.message_type === 'snap') {
        const isVideo = msg.media_url && /\.(mp4|webm|mov|m4v)$/i.test(msg.media_url);
        const icon = isVideo ? '📹' : '📷';
        const labelText = isVideo ? 'Tap to view Video Snap' : 'Tap to view Snap';

        box.innerHTML = `
            <div class="snap-badge" onclick="openSnapViewer('${msg.id}', '${msg.media_url}')" style="background: #0095f6; color: white; padding: 10px 16px; border-radius: 20px; cursor: pointer; font-weight: 600; display: inline-block;">
                ${icon} ${labelText}
            </div>
        `;
    } 
    // 3. Handle Standard Image messages
    else if (msg.message_type === 'image') {
        box.innerHTML = `<img src="${msg.content || msg.media_url}" style="max-width:100%; border-radius:8px; display: block;">`;
        
        const imgEl = box.querySelector('img');
        if (imgEl) {
            imgEl.style.cursor = 'pointer';
            imgEl.onclick = () => openMediaModal(msg.content || msg.media_url);
        }

        box.addEventListener('touchstart', () => {
            pressTimer = setTimeout(() => {
                openMessageOptions(msg.id, encodeURIComponent("Image"), isOwnMessage);
            }, 600);
        });
        box.addEventListener('touchend', () => clearTimeout(pressTimer));
        box.addEventListener('touchmove', () => clearTimeout(pressTimer));
        box.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            openMessageOptions(msg.id, encodeURIComponent("Image"), isOwnMessage);
        });
    } 
    // 4. Handle Standard Video messages
    else if (msg.message_type === 'video') {
        box.innerHTML = `<video src="${msg.content || msg.media_url}" style="max-width:100%; border-radius:8px; display: block;" controls></video>`;

        box.addEventListener('touchstart', () => {
            pressTimer = setTimeout(() => {
                openMessageOptions(msg.id, encodeURIComponent("Video"), isOwnMessage);
            }, 600);
        });
        box.addEventListener('touchend', () => clearTimeout(pressTimer));
        box.addEventListener('touchmove', () => clearTimeout(pressTimer));
        box.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            openMessageOptions(msg.id, encodeURIComponent("Video"), isOwnMessage);
        });
    } 
    // 5. Handle Text messages
    else {
        box.innerText = msg.content || '';
        box.style.cursor = 'pointer';
        const encodedText = encodeURIComponent(msg.content || '');
        
        box.addEventListener('touchstart', () => {
            pressTimer = setTimeout(() => {
                openMessageOptions(msg.id, encodedText, isOwnMessage);
            }, 600);
        });
        box.addEventListener('touchend', () => clearTimeout(pressTimer));
        box.addEventListener('touchmove', () => clearTimeout(pressTimer));
        box.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            openMessageOptions(msg.id, encodedText, isOwnMessage);
        });
    }

    // Append Timestamp & Read Status
    const time = document.createElement('span');
    time.classList.add('time-indicator');
    
    const readStatus = isOwnMessage ? (msg.is_read ? ' <span style="color: #3b82f6;">✓✓</span>' : ' <span style="color: #9ca3af;">✓</span>') : '';
    const msgDate = new Date(msg.created_at);
    time.innerHTML = `${msgDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}${readStatus}`;
    
    box.appendChild(time);
    display.appendChild(box);

    if (scrollview) {
        scrollview.scrollTop = scrollview.scrollHeight;
    }
}

document.addEventListener('click', (e) => {
    const backBtn = e.target.closest('#backToDashboard');
    if (backBtn) {
        document.getElementById('chatRoomScreen').classList.remove('active');
        document.getElementById('dashboardScreen').classList.add('active');
        activeChatPartnerId = null;
        loadActiveChatsList();
    }
});


// 1. Ensure only ONE video plays at a time across the entire app
document.addEventListener('play', (event) => {
    if (event.target.tagName === 'VIDEO') {
        document.querySelectorAll('video').forEach(video => {
            if (video !== event.target) {
                video.pause();
            }
        });
    }
}, true); // Use capture phase to catch play events immediately

// 2. Pause all videos if the user switches tabs or minimizes the window
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        document.querySelectorAll('video').forEach(video => video.pause());
    }
});

// 3. Pause videos when scrolled completely out of view
window.addEventListener('scroll', () => {
    document.querySelectorAll('video.post-video').forEach(video => {
        const rect = video.getBoundingClientRect();
        const isVisible = rect.top < window.innerHeight && rect.bottom >= 0;
        if (!isVisible && !video.paused) {
            video.pause();
        }
    });
}, { passive: true });


let groupedStories = [];
let currentUserIdx = 0;
let currentStoryIdx = 0;
let storyTimer = null;

// Replace with your actual logged-in user ID source (e.g., window.CURRENT_USER_ID or localStorage)
const currentLoggedInUserId = window.CURRENT_USER_ID || null; 

async function loadStories() {
    try {
        const res = await fetch('/api/stories', { credentials: 'include' });
        groupedStories = await res.json();
        
        const container = document.getElementById('dynamicStoriesList');
        const allListContainer = document.getElementById('allStoriesList');
        if (!container) return;

        const viewedStories = getViewedStories();

        // Fetch recent 6 user story bubbles (taking top 6, no add button)
        const topSix = (groupedStories || []).slice(0, 6);
        container.innerHTML = topSix.map((uGroup, uIdx) => renderBubbleHTML(uGroup, uIdx, viewedStories)).join('');
        
        // Updates modal list
        if (allListContainer) {
            if (!groupedStories || groupedStories.length === 0) {
                allListContainer.innerHTML = '<div style="color: #8e8e96; text-align: center; padding: 20px;">No updates available</div>';
            } else {
                allListContainer.innerHTML = groupedStories.map((uGroup, uIdx) => {
                    const allViewed = uGroup.stories.every(s => viewedStories.includes(s.id));
                    const latestStory = uGroup.stories[uGroup.stories.length - 1];
                    const timeAgo = formatTimeAgo(latestStory.created_at);
                    const ringStyle = allViewed ? 'border: 2px solid #adb5bd;' : 'background: linear-gradient(45deg, #f59e0b, #ec4899); padding: 2px;';

                    return `
                        <div data-user-idx="${uIdx}" class="update-item" style="display: flex; align-items: center; gap: 12px; padding: 10px 0; cursor: pointer; border-bottom: 1px solid #efefef;">
                            <div style="width: 56px; height: 56px; border-radius: 50%; ${ringStyle} display: flex; align-items: center; justify-content: center; pointer-events: none;">
                                <img src="${uGroup.profile_pic_url || 'https://via.placeholder.com/60'}" style="width: 50px; height: 50px; border-radius: 50%; object-fit: cover; border: 2px solid white; pointer-events: none;">
                            </div>
                            <div style="flex: 1; display: flex; flex-direction: column; pointer-events: none;">
                                <span style="font-weight: 600; font-size: 14px; color: #262626;">${uGroup.name || uGroup.username}</span>
                                <span style="font-size: 12px; color: #8e8e96; margin-top: 2px;">${timeAgo}</span>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }
    } catch (err) {
        console.error('Failed to load stories:', err);
    }
}
// Bubble HTML generator for 2x3 Grid
function renderBubbleHTML(uGroup, uIdx, viewedStories) {
    const allViewed = uGroup.stories.every(s => viewedStories.includes(s.id));
    const ringStyle = allViewed 
        ? 'border: 2px solid #adb5bd;' 
        : 'background: linear-gradient(45deg, #f59e0b, #ec4899); padding: 3px;';

    return `
        <div data-user-idx="${uIdx}" class="story-bubble-item" style="display: flex; flex-direction: column; align-items: center; cursor: pointer;">
            <div style="width: 72px; height: 72px; border-radius: 50%; ${ringStyle} display: flex; align-items: center; justify-content: center; pointer-events: none;">
                <img src="${uGroup.profile_pic_url || 'https://via.placeholder.com/70'}" style="width: 66px; height: 66px; border-radius: 50%; object-fit: cover; border: 2px solid white; pointer-events: none;">
            </div>
            <span style="font-size: 12px; color: ${allViewed ? '#8e8e96' : '#262626'}; font-weight: 500; margin-top: 6px; width: 100%; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; pointer-events: none;">${uGroup.name || uGroup.username}</span>
        </div>
    `;
}

;

// View tracking helpers
function getViewedStories() {
    try { return JSON.parse(localStorage.getItem('trebor_viewed_stories') || '[]'); } catch { return []; }
}

function markStoryAsViewed(storyId) {
    const viewed = getViewedStories();
    if (!viewed.includes(storyId)) {
        viewed.push(storyId);
        localStorage.setItem('trebor_viewed_stories', JSON.stringify(viewed));
    }
}

// Open / Close Viewer & Updates Page
function openAllStoriesPage() {
    const page = document.getElementById('allStoriesModal');
    if (page) page.style.display = 'flex';
}
function closeAllStoriesPage() {
    const page = document.getElementById('allStoriesModal');
    if (page) page.style.display = 'none';
}

function openUserStories(uIdx) {
    console.log("openUserStories called with index:", uIdx);
    currentUserIdx = uIdx;
    currentStoryIdx = 0;
    
    const modal = document.getElementById('storyViewerModal');
    if (!modal) {
        console.error("ERROR: #storyViewerModal element not found in HTML!");
        return;
    }
    console.log("Found modal, setting display to flex");
    modal.style.display = 'flex';

    const navbar = document.getElementById('bottomNav');
    if (navbar) navbar.style.display = 'none';

    renderCurrentStory();
}

function renderCurrentStory() {
    clearTimeout(storyTimer);
    
    const userGroup = groupedStories[currentUserIdx];
    if (!userGroup || !userGroup.stories || !userGroup.stories[currentStoryIdx]) {
        closeStoryViewer();
        return;
    }

    const story = userGroup.stories[currentStoryIdx];
    console.log("Loading story media URL:", story.media_url);
    
    markStoryAsViewed(story.id);

    // Update name header
    const userEl = document.getElementById('storyViewerUser');
    if (userEl) userEl.textContent = userGroup.name || userGroup.username;

    // Delete Button check for owner
    const deleteBtn = document.getElementById('storyDeleteBtn');
    if (deleteBtn) {
        deleteBtn.style.display = (story.user_id === currentLoggedInUserId) ? 'block' : 'none';
    }

    // Progress bars
    const progressContainer = document.getElementById('storyProgressBarContainer');
    if (progressContainer) {
        progressContainer.innerHTML = userGroup.stories.map((_, i) => `
            <div style="flex: 1; height: 3px; background: ${i <= currentStoryIdx ? '#ffffff' : 'rgba(255,255,255,0.4)'}; border-radius: 2px;"></div>
        `).join('');
    }

    const wrapper = document.getElementById('storyViewerMediaWrapper');
    if (!wrapper) return;

    const leftZone = wrapper.querySelector('#storyLeftZone') || createTapZone('left', prevStory);
    const rightZone = wrapper.querySelector('#storyRightZone') || createTapZone('right', nextStory);

    wrapper.innerHTML = '';
    wrapper.appendChild(leftZone);
    wrapper.appendChild(rightZone);

    const isVideo = story.media_type === 'video' || (story.media_url && story.media_url.match(/\.(mp4|mov|webm)$/i));

    if (isVideo) {
        const video = document.createElement('video');
        video.src = story.media_url;
        video.autoplay = true;
        video.playsInline = true;
        video.muted = false;
        video.style.cssText = 'max-width: 100%; max-height: 100%; object-fit: contain; pointer-events: none; z-index: 5;';
        video.play().catch(() => { video.muted = true; video.play(); });
        video.onended = () => nextStory();
        wrapper.appendChild(video);
    } else {
        const img = document.createElement('img');
        img.src = story.media_url;
        img.style.cssText = 'max-width: 100%; max-height: 100%; object-fit: contain; pointer-events: none; z-index: 5;';
        wrapper.appendChild(img);
        storyTimer = setTimeout(() => nextStory(), 5000);
    }
}


function createTapZone(side, callback) {
    const div = document.createElement('div');
    div.id = side === 'left' ? 'storyLeftZone' : 'storyRightZone';
    div.onclick = callback;
    div.style.cssText = `position: absolute; ${side}: 0; top: 0; width: ${side === 'left' ? '35%' : '65%'}; height: 100%; z-index: 10; cursor: pointer;`;
    return div;
}

function nextStory() {
    clearTimeout(storyTimer);
    const userGroup = groupedStories[currentUserIdx];
    if (currentStoryIdx < userGroup.stories.length - 1) {
        currentStoryIdx++;
        renderCurrentStory();
    } else if (currentUserIdx < groupedStories.length - 1) {
        currentUserIdx++;
        currentStoryIdx = 0;
        renderCurrentStory();
    } else {
        closeStoryViewer();
    }
}

function prevStory() {
    clearTimeout(storyTimer);
    if (currentStoryIdx > 0) {
        currentStoryIdx--;
        renderCurrentStory();
    } else if (currentUserIdx > 0) {
        currentUserIdx--;
        currentStoryIdx = groupedStories[currentUserIdx].stories.length - 1;
        renderCurrentStory();
    }
}

async function deleteCurrentStory() {
    const userGroup = groupedStories[currentUserIdx];
    const story = userGroup.stories[currentStoryIdx];
    if (!confirm('Delete this story?')) return;

    try {
        const res = await fetch(`/api/stories/${story.id}`, { method: 'DELETE' });
        if (res.ok) {
            closeStoryViewer();
            loadStories();
        } else {
            alert('Failed to delete story');
        }
    } catch (err) {
        console.error('Delete error:', err);
    }
}

function closeStoryViewer() {
    clearTimeout(storyTimer);
    const modal = document.getElementById('storyViewerModal');
    if (modal) modal.style.display = 'none';

    const navbar = document.getElementById('bottomNav');
    if (navbar) navbar.style.display = 'flex';
    
    const wrapper = document.getElementById('storyViewerMediaWrapper');
    if (wrapper) {
        const video = wrapper.querySelector('video');
        if (video) video.pause();
        wrapper.innerHTML = '';
    }
    loadStories();
}


async function handleStoryUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Optional: UI feedback while uploading
    console.log("Uploading story...");

    const formData = new FormData();
    formData.append('file', file);

    try {
        // 1. Upload the physical file to your media endpoint
        const uploadRes = await fetch('/api/uploads', {
            method: 'POST',
            body: formData
        });
        const uploadData = await uploadRes.json(); // returns { url: '/uploads/story-123.jpg' }

        // 2. Save story entry in PostgreSQL
        const storyRes = await fetch('/api/stories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: currentUserId, // Replace with your active session user ID
                media_url: uploadData.url,
                media_type: file.type.startsWith('video') ? 'video' : 'image'
            })
        });

        if (storyRes.ok) {
            // Refresh the reel immediately
            loadStories();
        }
    } catch (err) {
        console.error('Failed to upload story:', err);
    } finally {
        // Reset file input value so selecting the same file again works
        event.target.value = '';
    }
}

// Bulletproof Event Delegation for Clicks
document.addEventListener('click', (e) => {
    const bubble = e.target.closest('[data-user-idx]');
    if (bubble) {
        const uIdx = parseInt(bubble.getAttribute('data-user-idx'), 10);
        if (!isNaN(uIdx)) {
            closeAllStoriesPage();
            openUserStories(uIdx);
        }
    }
})

// Friend Requests Engine

let pendingFriendRequests = [];

async function loadFriendRequests() {
    try {
        const res = await fetch('/api/friendships/pending', {
            credentials: 'include'
        });
        
        if (!res.ok) {
            console.error("Failed to load friend requests, status:", res.status);
            return;
        }

        pendingFriendRequests = await res.json();

        const sectionWrapper = document.getElementById('friendRequestsSection');
        const container = document.getElementById('dynamicFriendRequestsList');
        const modalList = document.getElementById('allFriendRequestsList');
        const countEl = document.getElementById('friendRequestsCount');
        const RequestsDiv = document.getElementById('RequestsDiv');
        
        // Completely hide the section wrapper if no requests or wrapper missing
        if (!pendingFriendRequests || pendingFriendRequests.length === 0) {
            if (RequestsDiv) RequestsDiv.style.display = 'none';
            return;
        }

        // Exit if container doesn't exist
        if (!container) return;

        // Show section and populate counts if requests exist
        if (sectionWrapper) sectionWrapper.style.display = 'block';
        if (countEl) countEl.textContent = `${pendingFriendRequests.length} pending`;

        // Top 10 for the horizontal scrollable strip
        const topTen = pendingFriendRequests.slice(0, 10);
        container.innerHTML = topTen.map(req => renderRequestCardHTML(req)).join('');

        // Full list for the "View All" modal
        if (modalList) {
            modalList.innerHTML = pendingFriendRequests.map(req => renderRequestCardHTML(req, true)).join('');
        }
    } catch (err) {
        console.error('Error loading friend requests:', err);
    }
}


function renderRequestCardHTML(req, isFullList = false) {
    const widthStyle = isFullList 
        ? 'width: 100%; flex-direction: row; gap: 12px; align-items: center;' 
        : 'min-width: 130px; width: 130px; flex-direction: column; align-items: center; flex-shrink: 0;';
    const imgSize = isFullList ? '48px' : '56px';
    const nameAlign = isFullList ? 'text-align: left; flex: 1;' : 'text-align: center; margin-bottom: 8px; width: 100%;';

    return `
        <div class="friend-request-card" data-req-id="${req.id}" style="background: #000; border: 1px solid #dbdbdb; border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; width: 180px; min-width: 160px; height: 210px; flex-shrink: 0; position: relative; box-sizing: border-box;">
            
            <!-- Full-bleed background image -->
            <img src="${req.profile_pic_url || 'https://via.placeholder.com/140'}" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;">
            
            <!-- Dark gradient overlay for text readability -->
            <div style="position: absolute; inset: 0; background: linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 40%, rgba(0,0,0,0.7) 100%); pointer-events: none;"></div>

            <!-- Name and username at the top inside the image (like Reels) -->
            <div style="position: relative; z-index: 2; padding: 10px; display: flex; flex-direction: column; width: 100%; overflow: hidden;">
                <span style="font-weight: 600; font-size: 13px; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-shadow: 0 1px 2px rgba(0,0,0,0.8);">${req.name || req.username}</span>
            </div>

            <!-- Small button strip at the bottom -->
            <div style="position: absolute; bottom: 8px; left: 8px; right: 8px; z-index: 2; display: flex; gap: 5px;">
                <button onclick="handleFriendRequest(${req.id}, 'accept')" style="background: #0095f6; color: #fff; border: none; border-radius: 4px; padding: 5px 2px; font-size: 10px; font-weight: 600; cursor: pointer; flex: 1;">Accept</button>
                <button onclick="handleFriendRequest(${req.id}, 'reject')" style="background: rgba(255,255,255,0.2); backdrop-filter: blur(4px); color: #fff; border: none; border-radius: 4px; padding: 5px 2px; font-size: 10px; font-weight: 600; cursor: pointer; flex: 1;">Delete</button>
            </div>
        </div>`;
}

async function handleFriendRequest(requestId, action) {
    try {
        const res = await fetch(`/api/friend-requests/${requestId}/${action}`, { 
            method: 'POST',
            credentials: 'include'
        });
        if (res.ok) {
            loadFriendRequests(); // Refreshes both the horizontal strip and modal list
        } else {
            showCustomAlert('Failed to process request');
        }
    } catch (err) {
        console.error('Error handling friend request:', err);
    }
}

function openAllFriendRequestsPage() {
    const modal = document.getElementById('allFriendRequestsModal');
    if (modal) modal.style.display = 'flex';
}

function closeAllFriendRequestsPage() {
    const modal = document.getElementById('allFriendRequestsModal');
    if (modal) modal.style.display = 'none';
}


/////// REELS LOGIC /////////

async function loadTopReels() {
    try {
        const res = await fetch('/api/reels/preview', { credentials: 'include' });
        if (!res.ok) return;
        
        const reels = await res.json();
        const container = document.getElementById('dynamicTopReelsGrid');
        if (!container) return;

        if (!reels || reels.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = reels.map(reel => `
            <div onclick="window.location.href='/reels.html?reelId=${reel.id}'" style="background: #000; border-radius: 10px; overflow: hidden; cursor: pointer; position: relative; height: 230px; box-shadow: 0 2px 6px rgba(0,0,0,0.15);">
                <!-- Full card vertical video -->
                <video src="${reel.video_url}#t=0.001" muted autoplay loop playsinline style="width: 100%; height: 100%; object-fit: cover; pointer-events: none;"></video>
                
                <!-- Bottom Dark Gradient Overlay for readability -->
                <div style="position: absolute; bottom: 0; left: 0; right: 0; height: 90px; background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0) 100%); pointer-events: none;"></div>

                <!-- Username & Likes Overlay -->
                <div style="position: absolute; bottom: 10px; left: 8px; right: 8px; display: flex; align-items: center; justify-content: space-between; color: #fff; font-size: 11px; z-index: 2;">
                    <span style="font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 95px; text-shadow: 0 1px 2px rgba(0,0,0,0.9);">@${reel.name}</span>
                    <span style="font-weight: 600; text-shadow: 0 1px 2px rgba(0,0,0,0.9); flex-shrink: 0;">❤️ ${reel.likes_count || 0}</span>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error('Error loading top reels preview:', err);
    }
}


function openReelUploadModal() {
    document.getElementById('reelUploadModal').style.display = 'flex';
}

function closeReelUploadModal() {
    document.getElementById('reelUploadModal').style.display = 'none';
    document.getElementById('reelForm').reset();
}

async function submitReelUpload(event) {
    event.preventDefault();
    const fileInput = document.getElementById('reelVideoFile');
    const captionInput = document.getElementById('reelCaption');
    const submitBtn = document.getElementById('reelSubmitBtn');

    if (!fileInput.files[0]) return;

    const formData = new FormData();
    formData.append('file', fileInput.files[0]); // matches multer setup

    submitBtn.textContent = 'Uploading...';
    submitBtn.disabled = true;

    try {
        // 1. Upload physical file to your upload endpoint
        const uploadRes = await fetch('/api/uploads', {
            method: 'POST',
            credentials: 'include',
            body: formData
        });
        const uploadData = await uploadRes.json();

        if (!uploadRes.ok) throw new Error('File upload failed');

        // 2. Save reel entry to PostgreSQL database
        const reelRes = await fetch('/api/reels', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                video_url: uploadData.url,
                caption: captionInput.value
            })
        });

        if (reelRes.ok) {
            closeReelUploadModal();
            if (typeof loadReels === 'function') loadReels(); // Refresh feed if on reels page
            else window.location.href = '/reels.html'; // Redirect to reels page if on dashboard
        } else {
            alert('Failed to save reel');
        }
    } catch (err) {
        console.error('Reel upload error:', err);
        alert('Error uploading reel');
    } finally {
        submitBtn.textContent = 'Upload';
        submitBtn.disabled = false;
    }
}

function loadHomeTabData() {
    loadStories();
    loadFriendRequests();
    loadTopReels();
}

// Keep it running on initial page load too
document.addEventListener('DOMContentLoaded', () => {
    loadHomeTabData();
});

// Bittom Upload Model Control logic ////
let currentCreationMode = 'post';
let selectedFileObject = null;

function openCreateSheet() {
    document.getElementById('createSheetBackdrop').style.display = 'block';
    const sheet = document.getElementById('createBottomSheet');
    sheet.style.display = 'block';
    // Reset to menu stage when opened
    backToSheetMenu();
}

function closeCreateSheet() {
    document.getElementById('createSheetBackdrop').style.display = 'none';
    document.getElementById('createBottomSheet').style.display = 'none';
    resetCreationForm();
}

function selectCreationType(type) {
    currentCreationMode = type;
    document.getElementById('sheetMenuStage').style.display = 'none';
    document.getElementById('sheetFormStage').style.display = 'block';
    
    const titles = { post: 'New Post', reel: 'New Reel', story: 'New Story' };
    document.getElementById('formStageTitle').innerText = titles[type] || 'Create';
}

function backToSheetMenu() {
    document.getElementById('sheetFormStage').style.display = 'none';
    document.getElementById('sheetMenuStage').style.display = 'block';
    resetCreationForm();
}

function handleFilePreview(input) {
    if (input.files && input.files[0]) {
        selectedFileObject = input.files[0];
        const previewContainer = document.getElementById('mediaPreviewContainer');
        const fileUrl = URL.createObjectURL(selectedFileObject);
        const isVideo = selectedFileObject.type.startsWith('video');

        previewContainer.innerHTML = isVideo 
            ? `<video src="${fileUrl}" autoplay loop muted playsinline style="width: 100%; height: auto; object-fit: cover;"></video>`
            : `<img src="${fileUrl}" style="width: Auto; height: 100%; object-fit: cover;">`;
    }
}

function resetCreationForm() {
    selectedFileObject = null;
    document.getElementById('sheetFileInput').value = '';
    document.getElementById('sheetCaptionInput').value = '';
    document.getElementById('mediaPreviewContainer').innerHTML = `
        <div id="previewPlaceholder" style="text-align: center; color: #8e8e96; font-size: 13px;">
            <span style="font-size: 28px; display: block; margin-bottom: 4px;">📁</span>
            Tap to select file
        </div>
    `;
}

async function submitCreation() {
    // 1. Get file and caption elements based on your modal setup
    const fileInput = document.getElementById('sheetFileInput');
    const file = (typeof selectedFileObject !== 'undefined' ? selectedFileObject : null) || (fileInput ? fileInput.files[0] : null);
    
    const captionInput = document.getElementById('sheetCaptionInput');
    const caption = captionInput ? captionInput.value.trim() : '';

    const mode = typeof currentCreationMode !== 'undefined' ? currentCreationMode : (typeof activeCreationType !== 'undefined' ? activeCreationType : 'post');

    if (!file && !caption) {
        alert('Please select a file or enter text/caption.');
        return;
    }

    const cachedUser = JSON.parse(localStorage.getItem('currentUser')) || {};
    const userId = (typeof currentUserId !== 'undefined' ? currentUserId : null) || cachedUser.id;

    if (!userId) {
        alert('User session not found. Please log in again.');
        return;
    }

    try {
        let mediaUrl = null;

        // Step 1: Upload the file to /api/uploads first (if a file was selected)
        if (file) {
            const uploadFormData = new FormData();
            uploadFormData.append('file', file); // Matches your generic upload.single('file')

            const uploadRes = await fetch('/api/uploads', {
                method: 'POST',
                body: uploadFormData
            });
            const uploadData = await uploadRes.json();

            if (!uploadRes.ok || !uploadData.success) {
                alert(uploadData.error || 'File upload failed.');
                return;
            }
            mediaUrl = uploadData.url; // e.g. '/uploads/filename.ext'
        }

        // Step 2: Route the JSON payload to the correct endpoint
        let endpoint = '/api/posts';
        let payload = {};

        if (mode === 'post') {
            endpoint = '/api/posts';
            payload = { userId: userId, text: caption, image_url: mediaUrl };
        } else if (mode === 'reel') {
            endpoint = `/api/reels?userId=${userId}`; // Matches your backend query check
            payload = { video_url: mediaUrl, caption: caption };
        } else if (mode === 'story') {
            endpoint = '/api/stories';
            payload = { user_id: userId, media_url: mediaUrl, media_type: file && file.type.startsWith('video') ? 'video' : 'image' };
        }

        const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (res.ok) {
            // Close sheet and reset form inputs
            if (typeof closeCreateSheet === 'function') closeCreateSheet();
            if (fileInput) fileInput.value = '';
            if (captionInput) captionInput.value = '';

            // Refresh corresponding views
            if (mode === 'post' && typeof loadFeedPosts === 'function') loadFeedPosts();
            if (mode === 'post' && typeof loadPosts === 'function') loadPosts();
            if (mode === 'reel' && typeof loadReels === 'function') loadReels();
            if (mode === 'story' && typeof loadStories === 'function') loadStories();
        } else {
            alert(data.error || 'Failed to publish content.');
        }

    } catch (err) {
        console.error('Submission error:', err);
        alert('An error occurred during upload.');
    }
}


function handlePaidFeature(featureName) {
  // Replace with your custom modal alert or toast notification if preferred
  showCustomAlert(`${featureName} is a Paid Feature. Stay tuned for upcoming premium upgrades!`);
}

let idleTimer;
const IDLE_TIMEOUT = 10000; // 10 seconds

function resetIdleTimer() {
    const btn = document.getElementById('idleRefreshBtn');
    if (btn) btn.classList.remove('visible');
    
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        if (btn) btn.classList.add('visible');
    }, IDLE_TIMEOUT);
}

// Listen to common user activity triggers
['mousemove', 'touchstart', 'scroll', 'keydown', 'click'].forEach(event => {
    window.addEventListener(event, resetIdleTimer, { passive: true });
});

// Initialize timer on load
resetIdleTimer();

////Major Compliance Requirements

// Toggle menu visibility when clicking the three dots
document.addEventListener('click', (e) => {
    // Hide all open menus first
    if (!e.target.closest('.post-menu-container')) {
        document.querySelectorAll('.post-dropdown-menu').forEach(menu => menu.style.display = 'none');
        return;
    }

    if (e.target.classList.contains('post-menu-btn')) {
        const postId = e.target.getAttribute('data-id');
        const menu = document.getElementById(`menu-${postId}`);
        
        // Toggle current menu, hide others
        document.querySelectorAll('.post-dropdown-menu').forEach(m => {
            if (m !== menu) m.style.display = 'none';
        });
        
        menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    }
});

// Handle Report Post click
document.addEventListener('click', async (e) => {
    if (e.target.classList.contains('report-post-btn')) {
        const postId = e.target.getAttribute('data-id');
        const reason = prompt("Please select a reason for reporting this post (e.g., Spam, Harassment, Inappropriate):");
        
        if (reason) {
            const res = await fetch('/api/report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetType: 'post', targetId: postId, reason })
            });
            const data = await res.json();
            alert(data.message || "Post reported successfully.");
        }
    }

    // Handle Block User click
    if (e.target.classList.contains('block-user-btn')) {
    const targetUserId = e.target.dataset.userid;
    console.log("DEBUG: Target User ID captured from button:", targetUserId); // <--- Check browser console
    
    if (!targetUserId) {
        alert("Error: Could not find user ID to block.");
        return;
    }
    
    if (confirm("Are you sure you want to block this user? You will no longer see their posts.")) {
        fetch('/api/user/block', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ blockedId: targetUserId })
})
.then(async res => {
    const data = await res.json();
    if (!res.ok) {
        throw new Error(data.error || 'Server error blocking user');
    }
    return data;
})
.then(data => {
    console.log('Blocked successfully:', data);
    location.reload(); // Only reloads on true success
})
.catch(err => console.error('Block failed:', err));
    }
}
});


document.addEventListener('click', (e) => {
    if (e.target.classList.contains('report-btn')) {
        const contentId = e.target.dataset.id;
        const contentType = e.target.dataset.type; // 'post', 'reel', or 'story'
        
        const reason = prompt(`Why are you reporting this ${contentType}?`, "Inappropriate content");
        if (reason === null) return;

        fetch('/api/report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ contentType, contentId, reason })
        })
        .then(async res => {
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to submit report');
            return data;
        })
        .then(data => {
            alert("Thanks for letting us know. We have received your report.");
        })
        .catch(err => {
            console.error('Report failed:', err);
            alert("Could not submit report. Please try again.");
        });
    }
});

/////////!!!!!!!!!!!!!!!!!! 


const snapFileInput = document.getElementById('snapFileInput');
const friendModal = document.getElementById('friendSelectionModal');
const friendsListContainer = document.getElementById('friendsCheckboxList');
const sendSnapBtn = document.getElementById('sendSnapBtn');
const closeSnapModalBtn = document.getElementById('closeSnapModalBtn');

// 1. Check if change event fires when camera/file closes
snapFileInput.addEventListener('change', (e) => {
    console.log("Snap file input changed event fired!");
    const file = e.target.files[0];
    if (e.target.files && e.target.files[0]) {
        currentSnapFile = e.target.files[0];
        console.log("Captured file:", currentSnapFile.name);
        openFriendSelectionModal();
    }
    console.log("Captured file:", file.name, file.size);
    capturedSnapFile = file;
    closeCreateSheet();
    openFriendSelectionModal();
});


// 2. Check friend list fetch and modal display
async function openFriendSelectionModal() {
    console.log("Attempting to open friend selection modal...");
    
    // Safely grab elements right when opening to avoid null errors
    const friendModal = document.getElementById('friendSelectionModal');
    const friendsListContainer = document.getElementById('friendsCheckboxList');

    if (!friendModal || !friendsListContainer) {
        console.error("Modal HTML elements missing! Make sure the modal HTML is added to your page body.");
        return;
    }

    const userId = localStorage.getItem('userId');
    if (!userId) {
        console.error("No userId found in localStorage.");
        return;
    }

    try {
        const res = await fetch('/api/friends/list', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-User-Id': userId
            }
        });
        
        if (!res.ok) {
            console.error("Failed to fetch friends, status:", res.status);
            return;
        }

        const friends = await res.json();
        console.log("Parsed friends array length:", friends.length);
        
        friendsListContainer.innerHTML = '';
        if (!Array.isArray(friends) || friends.length === 0) {
            friendsListContainer.innerHTML = '<p style="text-align: center; color: #737373; padding: 20px;">No friends available.</p>';
        } else {
            friends.forEach(friend => {
                const label = document.createElement('label');
                label.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 10px 6px; cursor: pointer; border-bottom: 1px solid #f2f2f2; user-select: none;';
                
                label.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <img src="${friend.profile_pic || '/default-avatar.png'}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; border: 1px solid #dbdbdb;" />
                        <span style="font-weight: 500; color: #262626; font-size: 14px;">${friend.username}</span>
                    </div>
                    <input type="checkbox" value="${friend.id}" style="width: 20px; height: 20px; accent-color: #0095f6; cursor: pointer;" />
                `;
                friendsListContainer.appendChild(label);
            });
        }
        
        // Force display flex with high z-index
        friendModal.style.cssText = 'display: flex !important; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 99999; justify-content: center; align-items: center;';
        console.log("Modal successfully forced open.");
    } catch (err) {
        console.error('Error in openFriendSelectionModal:', err);
    }
}

// 4. Close modal and clear state
closeSnapModalBtn.addEventListener('click', () => {
    friendModal.style.display = 'none';
    capturedSnapFile = null;
    snapFileInput.value = '';
});

// 5. Submit snap to selected recipients
document.getElementById('sendSnapBtn').addEventListener('click', async () => {
    const userId = localStorage.getItem('userId');
    const checkboxes = document.querySelectorAll('#friendsCheckboxList input[type="checkbox"]:checked');
    const recipientIds = Array.from(checkboxes).map(cb => cb.value);

    if (recipientIds.length === 0 || !currentSnapFile) {
        alert("Select at least one friend and capture a snap.");
        return;
    }

    try {
        // Step 1: Upload media file
        const uploadFormData = new FormData();
        uploadFormData.append('file', currentSnapFile);

        const uploadRes = await fetch('/api/uploads', {
            method: 'POST',
            headers: { 'X-User-Id': userId },
            body: uploadFormData
        });

        if (!uploadRes.ok) {
            const errBody = await uploadRes.text();
            throw new Error(`Upload failed (${uploadRes.status}): ${errBody}`);
        }

        const uploadData = await uploadRes.json();
        const mediaUrl = uploadData.url;

        // Step 2: Send batch payload
        const batchRes = await fetch('/api/messages/send-snap-batch', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'X-User-Id': userId 
            },
            body: JSON.stringify({ recipientIds, mediaUrl })
        });

        if (!batchRes.ok) {
            const errBody = await batchRes.text();
            throw new Error(`Batch save failed (${batchRes.status}): ${errBody}`);
        }

        document.getElementById('friendSelectionModal').style.display = 'none';
        currentSnapFile = null;
        alert("Snaps sent successfully!");

    } catch (err) {
        console.error("Detailed error sending snaps:", err);
        alert(err.message);
    }
});


async function openSnapViewer(messageId, mediaUrl) {
    const viewer = document.createElement('div');
    viewer.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: black; z-index: 999999; display: flex; flex-direction: column; justify-content: center; align-items: center;';
    
    const isVideo = /\.(mp4|webm|mov|m4v)$/i.test(mediaUrl);
    
    const mediaElement = isVideo 
        ? `<video src="${mediaUrl}" autoplay controls style="max-width: 100%; max-height: 80vh; object-fit: contain;"></video>`
        : `<img src="${mediaUrl}" style="max-width: 100%; max-height: 80vh; object-fit: contain;" />`;

    viewer.innerHTML = `
        ${mediaElement}
        <button id="closeSnapViewer" style="margin-top: 20px; padding: 12px 24px; background: white; border: none; border-radius: 8px; font-weight: bold; font-size: 14px; cursor: pointer;">Close & Delete</button>
    `;
    document.body.appendChild(viewer);

    document.getElementById('closeSnapViewer').onclick = async () => {
        viewer.remove();
        
        // Remove element instantly from UI
        const msgBox = document.getElementById(`msg-${messageId}`);
        if (msgBox) msgBox.remove();

        // Permanent deletion from database & server
        try {
            await fetch(`/api/messages/${messageId}`, {
                method: 'DELETE',
                headers: { 'X-User-Id': localStorage.getItem('userId') }
            });
        } catch (err) {
            console.error('Error destroying snap:', err);
        }
    };
}




