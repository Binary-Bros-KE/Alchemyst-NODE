const express = require('express');
const asyncHandler = require('express-async-handler');
const Escort = require('../models/Escort');
const Masseuse = require('../models/Masseuse');
const OFModel = require('../models/OFModel');
const Spa = require('../models/Spa');

const router = express.Router();

// Model mapping
const getModelByType = (userType) => {
    console.log(`Getting model for userType: ${userType}`);
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
            console.warn(`Unknown userType: ${userType}`);
            return null;
    }
};

// Get all active profiles with filtering and pagination
router.get('/', asyncHandler(async (req, res) => {
    console.log('=== GET /profiles/ - START ===');
    console.log('Query parameters:', req.query);

    const {
        page = 1,
        limit = 20,
        county,
        userType = 'all',
        gender = 'all',
        bodyType = 'all',
        breastSize = 'all',
        location,
        area
    } = req.query;

    try {
        // Build filter object for active profiles only - FIXED: using correct field names
        const baseFilter = {
            isActive: true,
            'currentPackage.status': 'active' // FIXED: This was checking for boolean true, but it's enum 'active'
        };

        console.log('Base filter:', baseFilter);

        // Add location filters - FIXED: Using correct field names from models
        if (county) {
            baseFilter['location.county'] = new RegExp(county, 'i');
            console.log(`Added county filter: ${county}`);
        }

        if (location) {
            baseFilter['location.location'] = new RegExp(location, 'i'); // FIXED: was 'subCounty' but model has 'location'
            console.log(`Added location filter: ${location}`);
        }

        if (area) {
            baseFilter['location.area'] = new RegExp(area, 'i'); // FIXED: was 'areas' but model has 'area'
            console.log(`Added area filter: ${area}`);
        }

        // Add user type filter
        let modelsToSearch = [];
        if (userType === 'all') {
            modelsToSearch = [
                { model: Escort, type: 'escort' },
                { model: Masseuse, type: 'masseuse' },
                { model: OFModel, type: 'of-model' },
                { model: Spa, type: 'spa' }
            ];
            console.log('Searching ALL models');
        } else {
            const Model = getModelByType(userType);
            if (Model) {
                modelsToSearch.push({ model: Model, type: userType });
                console.log(`Searching only ${userType} model`);
            } else {
                console.error(`Invalid userType specified: ${userType}`);
                return res.status(400).json({
                    success: false,
                    message: 'Invalid user type'
                });
            }
        }

        let allProfiles = [];
        const skip = (page - 1) * parseInt(limit);
        console.log(`Pagination - skip: ${skip}, limit: ${limit}`);

        // Search across selected models
        for (const { model, type } of modelsToSearch) {
            console.log(`\n--- Searching ${type} model ---`);
            const modelFilter = { ...baseFilter };

            // Add model-specific filters - FIXED: Only apply to non-SPA models
            if (gender !== 'all' && type !== 'spa') {
                modelFilter.gender = new RegExp(gender, 'i');
                console.log(`Added gender filter for ${type}: ${gender}`);
            }

            if (bodyType !== 'all' && type !== 'spa') {
                modelFilter.bodyType = new RegExp(bodyType, 'i');
                console.log(`Added bodyType filter for ${type}: ${bodyType}`);
            }

            if (breastSize !== 'all' && type !== 'spa') {
                modelFilter.breastSize = new RegExp(breastSize, 'i');
                console.log(`Added breastSize filter for ${type}: ${breastSize}`);
            }

            console.log(`Final filter for ${type}:`, JSON.stringify(modelFilter, null, 2));

            const profiles = await model.find(modelFilter)
                .select('-password -email -paymentHistory -processedTransactions')
                .sort({
                    // FIXED: Using correct field path - no subscription field, using currentPackage
                    'currentPackage.packageType': -1,
                    createdAt: -1
                })
                .skip(skip)
                .limit(parseInt(limit))
                .lean();

            console.log(`Fetched ${profiles.length} profiles from ${type} model`);

            // Add userType to each profile
            const typedProfiles = profiles.map(profile => ({
                ...profile,
                userType: type
            }));

            allProfiles = [...allProfiles, ...typedProfiles];
        }

        console.log(`\nTotal profiles fetched: ${allProfiles.length}`);
        console.log('All profiles before sorting:', allProfiles);

        // Sort all profiles by package priority - FIXED: Using correct field path
        const packagePriority = { 'elite': 3, 'premium': 2, 'basic': 1, null: 0 };
        allProfiles.sort((a, b) => {
            const aPriority = packagePriority[a.currentPackage?.packageType] || 0;
            const bPriority = packagePriority[b.currentPackage?.packageType] || 0;
            console.log(`Sorting - Profile ${a._id}: ${a.currentPackage?.packageType} (priority: ${aPriority})`);
            return bPriority - aPriority;
        });

        // Increment profile views
        console.log('Incrementing profile views...');
        await Promise.all(
            allProfiles.map(profile =>
                incrementProfileViews(profile._id, profile.userType)
            )
        );

        console.log('=== GET /profiles/ - SUCCESS ===');
        res.json({
            success: true,
            profiles: allProfiles,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: allProfiles.length,
                hasMore: allProfiles.length === parseInt(limit)
            }
        });

    } catch (error) {
        console.error('=== GET /profiles/ - ERROR ===');
        console.error('Profiles fetch error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch profiles',
            error: error.message
        });
    }
}));

// FIXED: Two separate routes for location - one with county only, one with county and location
router.get('/location/:county', asyncHandler(async (req, res) => {
    console.log('=== GET /profiles/location/:county - START ===');
    console.log('Params:', req.params);
    console.log('Query:', req.query);

    const { county } = req.params;
    const { area, page = 1, limit = 20, userType = 'all' } = req.query;

    try {
        // FIXED: Using correct field names and structure
        const filter = {
            isActive: true,
            'currentPackage.status': 'active',
            'location.county': new RegExp(county, 'i')
        };

        console.log('Base location filter:', filter);

        if (area && area !== 'all') {
            filter['location.area'] = new RegExp(area, 'i');
            console.log(`Added area filter: ${area}`);
        }

        let modelsToSearch = [];
        if (userType === 'all') {
            modelsToSearch = [
                { model: Escort, type: 'escort' },
                { model: Masseuse, type: 'masseuse' },
                { model: OFModel, type: 'of-model' },
                { model: Spa, type: 'spa' }
            ];
            console.log('Searching ALL models for location');
        } else {
            const Model = getModelByType(userType);
            if (Model) {
                modelsToSearch.push({ model: Model, type: userType });
                console.log(`Searching only ${userType} model for location`);
            }
        }

        const skip = (page - 1) * parseInt(limit);
        let allProfiles = [];
        let totalCount = 0;

        console.log(`Pagination - skip: ${skip}, limit: ${limit}`);

        for (const { model, type } of modelsToSearch) {
            console.log(`\n--- Searching ${type} model for location ---`);
            console.log(`Filter for ${type}:`, JSON.stringify(filter, null, 2));

            const count = await model.countDocuments(filter);
            console.log(`Total ${type} profiles matching filter: ${count}`);
            totalCount += count;

            const profiles = await model.find(filter)
                .select('-password -email -paymentHistory -processedTransactions')
                .sort({
                    'currentPackage.packageType': -1,
                    createdAt: -1
                })
                .skip(skip)
                .limit(parseInt(limit))
                .lean();

            console.log(`Fetched ${profiles.length} profiles from ${type} model`);

            const typedProfiles = profiles.map(profile => ({
                ...profile,
                userType: type
            }));

            allProfiles = [...allProfiles, ...typedProfiles];
        }

        console.log(`Total profiles fetched: ${allProfiles.length}, Total matching: ${totalCount}`);

        // Sort by package priority - FIXED: Using correct field path
        const packagePriority = { 'elite': 3, 'premium': 2, 'basic': 1, null: 0 };
        allProfiles.sort((a, b) => {
            const aPriority = packagePriority[a.currentPackage?.packageType] || 0;
            const bPriority = packagePriority[b.currentPackage?.packageType] || 0;
            return bPriority - aPriority;
        });

        // Increment views
        console.log('Incrementing profile views for location search...');
        await Promise.all(
            allProfiles.map(profile =>
                incrementProfileViews(profile._id, profile.userType)
            )
        );

        console.log('=== GET /profiles/location/:county - SUCCESS ===');
        res.json({
            success: true,
            data: {
                profiles: allProfiles,
                location: {
                    county,
                    area: area && area !== 'all' ? area : null
                },
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: totalCount,
                    hasMore: (skip + allProfiles.length) < totalCount
                }
            }
        });

    } catch (error) {
        console.error('=== GET /profiles/location/:county - ERROR ===');
        console.error('Location profiles fetch error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch location profiles',
            error: error.message
        });
    }
}));

// FIXED: Separate route for county + location combination
router.get('/location/:county/:location', asyncHandler(async (req, res) => {
    console.log('=== GET /profiles/location/:county/:location - START ===');
    console.log('Params:', req.params);
    console.log('Query:', req.query);

    const { county, location } = req.params;
    const { area, page = 1, limit = 20, userType = 'all' } = req.query;

    try {
        // FIXED: Using correct field names and structure
        const filter = {
            isActive: true,
            'currentPackage.status': 'active',
            'location.county': new RegExp(county, 'i'),
            'location.location': new RegExp(location, 'i') // FIXED: was 'subCounty'
        };

        console.log('Base location filter:', filter);

        if (area && area !== 'all') {
            filter['location.area'] = new RegExp(area, 'i');
            console.log(`Added area filter: ${area}`);
        }

        let modelsToSearch = [];
        if (userType === 'all') {
            modelsToSearch = [
                { model: Escort, type: 'escort' },
                { model: Masseuse, type: 'masseuse' },
                { model: OFModel, type: 'of-model' },
                { model: Spa, type: 'spa' }
            ];
            console.log('Searching ALL models for location');
        } else {
            const Model = getModelByType(userType);
            if (Model) {
                modelsToSearch.push({ model: Model, type: userType });
                console.log(`Searching only ${userType} model for location`);
            }
        }

        const skip = (page - 1) * parseInt(limit);
        let allProfiles = [];
        let totalCount = 0;

        console.log(`Pagination - skip: ${skip}, limit: ${limit}`);

        for (const { model, type } of modelsToSearch) {
            console.log(`\n--- Searching ${type} model for location ---`);
            console.log(`Filter for ${type}:`, JSON.stringify(filter, null, 2));

            const count = await model.countDocuments(filter);
            console.log(`Total ${type} profiles matching filter: ${count}`);
            totalCount += count;

            const profiles = await model.find(filter)
                .select('-password -email -paymentHistory -processedTransactions')
                .sort({
                    'currentPackage.packageType': -1,
                    createdAt: -1
                })
                .skip(skip)
                .limit(parseInt(limit))
                .lean();

            console.log(`Fetched ${profiles.length} profiles from ${type} model`);

            const typedProfiles = profiles.map(profile => ({
                ...profile,
                userType: type
            }));

            allProfiles = [...allProfiles, ...typedProfiles];
        }

        console.log(`Total profiles fetched: ${allProfiles.length}, Total matching: ${totalCount}`);

        // Sort by package priority - FIXED: Using correct field path
        const packagePriority = { 'elite': 3, 'premium': 2, 'basic': 1, null: 0 };
        allProfiles.sort((a, b) => {
            const aPriority = packagePriority[a.currentPackage?.packageType] || 0;
            const bPriority = packagePriority[b.currentPackage?.packageType] || 0;
            return bPriority - aPriority;
        });

        // Increment views
        console.log('Incrementing profile views for location search...');
        await Promise.all(
            allProfiles.map(profile =>
                incrementProfileViews(profile._id, profile.userType)
            )
        );

        console.log('=== GET /profiles/location/:county/:location - SUCCESS ===');
        res.json({
            success: true,
            data: {
                profiles: allProfiles,
                location: {
                    county,
                    location,
                    area: area && area !== 'all' ? area : null
                },
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: totalCount,
                    hasMore: (skip + allProfiles.length) < totalCount
                }
            }
        });

    } catch (error) {
        console.error('=== GET /profiles/location/:county/:location - ERROR ===');
        console.error('Location profiles fetch error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch location profiles',
            error: error.message
        });
    }
}));

// Get single profile by ID - FIXED VERSION
router.get('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    console.log(`=== GET /profiles/${id} - START ===`);

    try {
        // Search across all models
        const models = [
            { model: Escort, type: 'escort' },
            { model: Masseuse, type: 'masseuse' },
            { model: OFModel, type: 'of-model' },
            { model: Spa, type: 'spa' }
        ];

        let profile = null;
        let userType = null;

        console.log('Searching for profile across all models...');

        for (const { model, type } of models) {
            console.log(`Checking ${type} model...`);
            const foundProfile = await model.findById(id)
                .select('-password -paymentHistory -processedTransactions')
                .lean();

            if (foundProfile) {
                console.log(`Profile found in ${type} model`);
                profile = foundProfile;
                userType = type;
                break;
            }
        }

        if (!profile) {
            console.log('Profile not found in any model');
            return res.status(404).json({
                success: false,
                message: 'Profile not found'
            });
        }

        // Check if profile is active and has active package
        if (!profile.isActive || profile.currentPackage?.status !== 'active') {
            console.log('Profile is not active or does not have active package');
            return res.status(404).json({
                success: false,
                message: 'Profile not available'
            });
        }

        profile.userType = userType;

        // Increment profile views
        console.log('Incrementing profile views for single profile...');
        await incrementProfileViews(id, userType);

        console.log(`=== GET /profiles/${id} - SUCCESS ===`);
        res.json({
            success: true,
            data: profile
        });

    } catch (error) {
        console.error(`=== GET /profiles/${id} - ERROR ===`);
        console.error('Profile fetch error:', error);

        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid profile ID'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Failed to fetch profile',
            error: error.message
        });
    }
}));

// Helper function to increment profile views - FIXED VERSION
const incrementProfileViews = async (profileId, userType) => {
    try {
        console.log(`Incrementing views for ${userType} profile: ${profileId}`);
        const Model = getModelByType(userType);
        if (Model) {
            const result = await Model.findByIdAndUpdate(profileId, {
                $inc: { 'analytics.views': 1 },
                $set: { 'analytics.lastViewed': new Date() }
            }, { new: false }); // Don't return the updated document for performance

            if (!result) {
                console.warn(`Profile ${profileId} not found when incrementing views`);
            } else {
                console.log(`Successfully incremented views for profile ${profileId}`);
            }
        } else {
            console.error(`No model found for userType: ${userType}`);
        }
    } catch (error) {
        console.error('Error incrementing profile views:', error);
    }
};

module.exports = router;