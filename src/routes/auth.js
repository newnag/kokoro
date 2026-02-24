const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { generateToken, authenticate, adminOnly } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

// GET /api/auth/setup-status - Check if initial setup is needed
router.get('/setup-status', (req, res) => {
  const userCount = User.count();
  res.json({ success: true, data: { needsSetup: userCount === 0 } });
});

// POST /api/auth/register - Register new user
// Open only for first user (admin setup); after that requires admin auth
router.post('/register',
  (req, res, next) => {
    const userCount = User.count();
    if (userCount === 0) return next(); // First user: allow open
    // Subsequent users: require admin authentication
    authenticate(req, res, () => adminOnly(req, res, next));
  },
  validate('register'),
  async (req, res) => {
  try {
    const { username, password, role } = req.body;

    // Check if this is the first user (make them admin)
    const userCount = User.count();
    const isFirstUser = userCount === 0;

    // First user is always admin; admin can specify role
    const finalRole = isFirstUser ? 'admin' : (role || 'user');

    // Check if username exists
    const existingUser = User.findByUsername(username);
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        error: 'Username already exists' 
      });
    }

    const user = await User.create({ username, password, role: finalRole });
    const token = generateToken(user);

    res.status(201).json({
      success: true,
      message: isFirstUser ? 'Admin account created' : 'User registered successfully',
      data: {
        user: {
          id: user.id,
          username: user.username,
          role: user.role
        },
        token
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/auth/login - Login user
router.post('/login', validate('login'), async (req, res) => {
  try {
    const { username, password } = req.body;

    // Find user
    const user = User.findByUsername(username);
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid username or password' 
      });
    }

    // Validate password
    const isValidPassword = await User.validatePassword(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid username or password' 
      });
    }

    // Generate token
    const token = generateToken(user);

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          role: user.role
        },
        token
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/auth/me - Get current user
router.get('/me', authenticate, (req, res) => {
  try {
    const user = User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/auth/password - Change password
router.put('/password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Current password and new password are required'
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'New password must be at least 8 characters'
      });
    }

    // Verify current password
    const user = User.findByUsername(req.user.username);
    const isValid = await User.validatePassword(currentPassword, user.password);
    
    if (!isValid) {
      return res.status(401).json({
        success: false,
        error: 'Current password is incorrect'
      });
    }

    await User.updatePassword(req.user.id, newPassword);

    res.json({
      success: true,
      message: 'Password updated successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/auth/users - List all users (admin only)
router.get('/users', authenticate, adminOnly, (req, res) => {
  try {
    const users = User.findAll();
    res.json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/auth/users/:id - Delete user (admin only)
router.delete('/users/:id', authenticate, adminOnly, (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    
    // Prevent self-deletion
    if (userId === req.user.id) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete your own account'
      });
    }

    const user = User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    User.delete(userId);
    res.json({ success: true, message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
