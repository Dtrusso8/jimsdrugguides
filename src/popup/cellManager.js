/**
 * Manages cell interactivity and data binding for drug guide tables.
 */

let cellDataCache = null;
let currentGuideData = null;

/**
 * Initialize cell data from guide JSON data.
 * @param {Object} guideData - The guide JSON data object
 */
export function initializeCellData(guideData) {
    currentGuideData = guideData;
    cellDataCache = guideData?.cellData || {};
}

/**
 * Get cell data for a specific cell identifier.
 * @param {string} cellId - Cell identifier (e.g., "table_0_row_1_col_2")
 * @returns {Object|null} Cell data object or null if not found
 */
export function getCellData(cellId) {
    if (!cellDataCache) return null;
    return cellDataCache[cellId] || null;
}

/**
 * Update cell data for a specific cell.
 * @param {string} cellId - Cell identifier
 * @param {Object} data - Cell data to update
 */
export function updateCellData(cellId, data) {
    if (!cellDataCache) {
        cellDataCache = {};
    }
    
    if (!cellDataCache[cellId]) {
        cellDataCache[cellId] = { content: data.content || "", summary: "" };
    }
    
    cellDataCache[cellId] = { ...cellDataCache[cellId], ...data };
    
    // Update the current guide data if available
    if (currentGuideData) {
        if (!currentGuideData.cellData) {
            currentGuideData.cellData = {};
        }
        currentGuideData.cellData[cellId] = cellDataCache[cellId];
    }
}

/**
 * Delete cell data for a specific cell.
 * @param {string} cellId - Cell identifier
 */
export function deleteCellData(cellId) {
    if (cellDataCache && cellDataCache[cellId]) {
        delete cellDataCache[cellId];
    }
    
    if (currentGuideData?.cellData && currentGuideData.cellData[cellId]) {
        delete currentGuideData.cellData[cellId];
    }
}

/**
 * Get all cell data for export.
 * @returns {Object} All cell data
 */
export function getAllCellData() {
    return cellDataCache || {};
}

/**
 * Get the current guide data with updated cellData.
 * @returns {Object|null} Current guide data or null
 */
export function getCurrentGuideData() {
    if (!currentGuideData) return null;
    
    return {
        ...currentGuideData,
        cellData: cellDataCache || {},
    };
}

/**
 * Clear cell data cache.
 */
export function clearCellData() {
    cellDataCache = null;
    currentGuideData = null;
}

