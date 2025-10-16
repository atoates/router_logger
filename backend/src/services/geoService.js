const axios = require('axios');
const { logger } = require('../config/database');

/**
 * Get approximate location from cell tower information using OpenCellID
 * @param {Object} cellInfo - Cell tower information (mcc, mnc, lac/tac, cell_id)
 * @returns {Object} - Location data {latitude, longitude, accuracy}
 */
async function getCellLocation(cellInfo) {
  const { mcc, mnc, lac, tac, cell_id } = cellInfo;
  
  if (!process.env.OPENCELLID_API_KEY || process.env.ENABLE_GEO_ENRICHMENT !== 'true') {
    return null;
  }

  // Use LAC or TAC (LAC for 2G/3G, TAC for LTE)
  const lacOrTac = tac || lac;
  
  if (!mcc || !mnc || !lacOrTac || !cell_id) {
    logger.debug('Incomplete cell info for geolocation');
    return null;
  }

  try {
    const url = 'https://opencellid.org/ajax/searchCell.php';
    const params = {
      mcc,
      mnc,
      lac: lacOrTac,
      cell_id,
      format: 'json',
      key: process.env.OPENCELLID_API_KEY
    };

    const response = await axios.get(url, { params, timeout: 5000 });
    
    if (response.data && response.data.lat && response.data.lon) {
      return {
        latitude: parseFloat(response.data.lat),
        longitude: parseFloat(response.data.lon),
        accuracy: response.data.range || 'unknown'
      };
    }
    
    return null;
  } catch (error) {
    logger.error('Error fetching cell location:', error.message);
    return null;
  }
}

/**
 * Alternative: UnwiredLabs API (if you prefer)
 */
async function getCellLocationUnwired(cellInfo) {
  const { mcc, mnc, lac, tac, cell_id } = cellInfo;
  
  if (!process.env.UNWIREDLABS_API_KEY) {
    return null;
  }

  const lacOrTac = tac || lac;
  
  if (!mcc || !mnc || !lacOrTac || !cell_id) {
    return null;
  }

  try {
    const url = 'https://us1.unwiredlabs.com/v2/process.php';
    const payload = {
      token: process.env.UNWIREDLABS_API_KEY,
      radio: 'lte', // or 'gsm', 'umts'
      mcc: parseInt(mcc),
      mnc: parseInt(mnc),
      cells: [{
        lac: parseInt(lacOrTac),
        cid: parseInt(cell_id)
      }],
      address: 0
    };

    const response = await axios.post(url, payload, { timeout: 5000 });
    
    if (response.data && response.data.lat && response.data.lon) {
      return {
        latitude: parseFloat(response.data.lat),
        longitude: parseFloat(response.data.lon),
        accuracy: response.data.accuracy || 'unknown'
      };
    }
    
    return null;
  } catch (error) {
    logger.error('Error fetching cell location from UnwiredLabs:', error.message);
    return null;
  }
}

module.exports = {
  getCellLocation,
  getCellLocationUnwired
};
