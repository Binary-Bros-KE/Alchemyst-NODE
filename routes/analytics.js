const express = require('express');
const asyncHandler = require('express-async-handler');
const Escort = require('../models/Escort');
const Masseuse = require('../models/Masseuse');
const OFModel = require('../models/OFModel');
const Spa = require('../models/Spa');

const router = express.Router();

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

// Track user interactions
router.post('/interaction', asyncHandler(async (req, res) => {
  const { profileId, interactionType } = req.body;

  if (!profileId || !interactionType) {
    return res.status(400).json({
      success: false,
      message: 'Profile ID and interaction type are required'
    });
  }

  const validInteractions = ['phone_copy', 'call', 'whatsapp', 'profile_view', 'message'];
  
  if (!validInteractions.includes(interactionType)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid interaction type'
    });
  }

  try {
    // Search across all models to find the profile
    const models = [
      { model: Escort, type: 'escort' },
      { model: Masseuse, type: 'masseuse' },
      { model: OFModel, type: 'of-model' },
      { model: Spa, type: 'spa' }
    ];

    let userType = null;
    let profileFound = false;

    for (const { model, type } of models) {
      const profile = await model.findById(profileId);
      if (profile) {
        userType = type;
        
        // Update analytics
        await model.findByIdAndUpdate(profileId, {
          $inc: { 
            'analytics.interactions': 1,
            [`analytics.${interactionType}s`]: 1
          },
          $push: {
            'analytics.interactionHistory': {
              type: interactionType,
              timestamp: new Date()
            }
          }
        });

        profileFound = true;
        break;
      }
    }

    if (!profileFound) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    res.json({
      success: true,
      message: 'Interaction tracked successfully'
    });

  } catch (error) {
    console.error('Interaction tracking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to track interaction'
    });
  }
}));

// Get profile analytics (for profile owners)
router.get('/profile/:profileId', asyncHandler(async (req, res) => {
  const { profileId } = req.params;
  // In production, add authentication to ensure users can only access their own analytics

  try {
    const models = [
      { model: Escort, type: 'escort' },
      { model: Masseuse, type: 'masseuse' },
      { model: OFModel, type: 'of-model' },
      { model: Spa, type: 'spa' }
    ];

    let analytics = null;

    for (const { model } of models) {
      const profile = await model.findById(profileId).select('analytics username');
      if (profile) {
        analytics = profile.analytics;
        break;
      }
    }

    if (!analytics) {
      return res.status(404).json({
        success: false,
        message: 'Analytics not found'
      });
    }

    res.json({
      success: true,
      data: analytics
    });

  } catch (error) {
    console.error('Analytics fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics'
    });
  }
}));

module.exports = router;