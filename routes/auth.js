const express = require('express');
const asyncHandler = require('express-async-handler');
const Escort = require('../models/Escort');
const Masseuse = require('../models/Masseuse');
const OFModel = require('../models/OFModel');
const Spa = require('../models/Spa');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const router = express.Router();

// Define valid user types
const VALID_USER_TYPES = ['escort', 'masseuse', 'of-model', 'spa'];

// Model mapping
const getModelByType = (userType) => {
  switch (userType) {
    case 'escort':
      return Escort;
    case 'masseuse':
      return Masseuse;
    case 'of-model':
      return OFModel;
    case 'spa':
      return Spa;
    default:
      return null;
  }
};

// Generate JWT token
const generateToken = (userId, userType) => {
  return jwt.sign(
    {
      userId: userId,
      userType: userType
    },
    process.env.JWT_SECRET || 'your-fallback-secret-key',
    { expiresIn: '30d' }
  );
};

// Register endpoint
router.post('/register', asyncHandler(async (req, res) => {
  const { username, email, password, userType } = req.body;

  // Basic validation
  if (!username || !email || !password || !userType) {
    return res.status(400).json({
      success: false,
      message: 'All fields are required: username, email, password, userType'
    });
  }

  // Validate userType
  if (!VALID_USER_TYPES.includes(userType)) {
    return res.status(400).json({
      success: false,
      message: `Invalid user type. Must be one of: ${VALID_USER_TYPES.join(', ')}`
    });
  }

  // Check if user already exists in any collection
  const existingUsers = await Promise.all([
    Escort.findOne({ $or: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }] }),
    Masseuse.findOne({ $or: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }] }),
    OFModel.findOne({ $or: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }] }),
    Spa.findOne({ $or: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }] })
  ]);

  const userExists = existingUsers.some(user => user !== null);
  if (userExists) {
    return res.status(409).json({
      success: false,
      message: 'User with this email or username already exists. Please Login.'
    });
  }

  // Hash password
  const saltRounds = 12;
  const hashedPassword = await bcrypt.hash(password, saltRounds);

  // Get the appropriate model
  const Model = getModelByType(userType);
  if (!Model) {
    return res.status(400).json({
      success: false,
      message: 'Invalid user type'
    });
  }

  // Create new user
  const newUser = new Model({
    username: username.toLowerCase(),
    email: email.toLowerCase(),
    password: hashedPassword,
    userType,
  });

  await newUser.save();

  // Generate JWT token
  const token = generateToken(newUser._id, userType);

  // Prepare response data
  const userData = {
    id: newUser._id,
    username: newUser.username,
    email: newUser.email,
    userType: userType,
    isActive: newUser.isActive,
    createdAt: newUser.createdAt
  };

  // Add verification status based on model structure
  if (userType === 'escort' || userType === 'masseuse' || userType === 'spa') {
    userData.isVerified = newUser.verification?.isVerified || false;
  } else if (userType === 'of-model') {
    userData.isVerified = newUser.verification?.isVerified || false;
  }

  res.status(201).json({
    success: true,
    message: `${userType.charAt(0).toUpperCase() + userType.slice(1)} registered successfully`,
    token: token,
    data: userData
  });
}));

// Login endpoint
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Email and password are required'
    });
  }

  // Find user in all collections
  const users = await Promise.all([
    Escort.findOne({ email: email.toLowerCase() }),
    Masseuse.findOne({ email: email.toLowerCase() }),
    OFModel.findOne({ email: email.toLowerCase() }),
    Spa.findOne({ email: email.toLowerCase() })
  ]);

  // Find the first non-null user
  let user = null;
  let userType = null;

  for (let i = 0; i < users.length; i++) {
    if (users[i]) {
      user = users[i];
      userType = VALID_USER_TYPES[i];
      break;
    }
  }

  if (!user) {
    return res.status(401).json({
      success: false,
      message: 'Invalid email or password'
    });
  }

  if (user.isDeactivated) {
    return res.status(401).json({
      success: false,
      message: 'Account is deactivated. Please contact support.'
    });
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    return res.status(401).json({
      success: false,
      message: 'Invalid email or password'
    });
  }

  // Generate JWT token
  const token = generateToken(user._id, userType);

  // Prepare user data
  const userData = {
    id: user._id,
    username: user.username,
    email: user.email,
    userType: userType,
    isActive: user.isActive,
    createdAt: user.createdAt,
    profile: user.profile || user.business || {}
  };

  // Add verification status
  if (userType === 'escort' || userType === 'masseuse' || userType === 'spa') {
    userData.isVerified = user.verification?.isVerified || false;
  } else if (userType === 'of-model') {
    userData.isVerified = user.verification?.isVerified || false;
  }

  // Add type-specific data
  if (userType === 'spa') {
    userData.business = user.business || {};
  }

  res.json({
    success: true,
    message: 'Login successful',
    token: token,
    data: userData
  });
}));

module.exports = router;