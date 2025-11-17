/**
 * Popup component for displaying and editing cell information.
 */

import { isTeacherModeEnabled, onTeacherModeChange } from "../teacher/index.js";
import { getCellData, updateCellData, deleteCellData, getAllCellData } from "./cellManager.js";

let popupElement = null;
let popupContent = null;
let currentCellId = null;
let currentCellElement = null;
let isEditMode = false;
let teacherModeUnsubscribe = null;

/**
 * Initialize the popup component.
 * @param {HTMLElement} container - Container element to append popup to
 */
export function initializePopup(container = document.body) {
    // Create popup element if it doesn't exist
    if (!popupElement) {
        popupElement = document.createElement("div");
        popupElement.id = "cell-popup";
        popupElement.className = "cell-popup hidden";
        popupElement.innerHTML = `
            <div class="cell-popup-content">
                <button class="cell-popup-close" aria-label="Close popup">&times;</button>
                <div class="cell-popup-header">
                    <h3 class="cell-popup-title"></h3>
                </div>
                <div class="cell-popup-body">
                    <div class="cell-popup-view">
                        <p class="cell-popup-summary"></p>
                    </div>
                    <div class="cell-popup-edit hidden">
                        <textarea class="cell-popup-textarea" rows="6" placeholder="Enter summary or information..."></textarea>
                        <div class="cell-popup-actions">
                            <button class="cell-popup-save">Save</button>
                            <button class="cell-popup-cancel">Cancel</button>
                            <button class="cell-popup-delete">Delete</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(popupElement);
        
        // Set up event listeners
        const closeBtn = popupElement.querySelector(".cell-popup-close");
        const saveBtn = popupElement.querySelector(".cell-popup-save");
        const cancelBtn = popupElement.querySelector(".cell-popup-cancel");
        const deleteBtn = popupElement.querySelector(".cell-popup-delete");
        
        closeBtn.addEventListener("click", closePopup);
        saveBtn.addEventListener("click", handleSave);
        cancelBtn.addEventListener("click", handleCancel);
        deleteBtn.addEventListener("click", handleDelete);
        
        popupElement.addEventListener("click", (e) => {
            if (e.target === popupElement) {
                closePopup();
            }
        });
        
        // Listen for teacher mode changes
        teacherModeUnsubscribe = onTeacherModeChange(({ enabled }) => {
            if (!enabled && isEditMode) {
                handleCancel();
            }
        });
    }
    
    popupContent = popupElement.querySelector(".cell-popup-content");
}

/**
 * Normalize content exactly as convert_guides.py does for storage in cellData.
 * This matches the normalization used in generate_cell_data():
 * - Remove HTML tags
 * - Strip whitespace
 * - Handle &nbsp; as empty
 * @param {string} content - Content to normalize
 * @returns {string} Normalized content
 */
function normalizeContentForStorage(content) {
    if (!content) return "";
    // Remove HTML tags (same regex as convert_guides.py)
    let normalized = content.replace(/<[^>]+>/g, "");
    // Strip whitespace
    normalized = normalized.trim();
    // Handle &nbsp; as empty
    if (normalized === "&nbsp;") {
        return "";
    }
    // Collapse multiple spaces to single space
    normalized = normalized.replace(/\s+/g, " ");
    return normalized;
}

/**
 * Normalize content for comparison (case-insensitive, whitespace-insensitive).
 * @param {string} content - Content to normalize
 * @returns {string} Normalized content for comparison
 */
function normalizeForComparison(content) {
    return normalizeContentForStorage(content).toLowerCase();
}

/**
 * Open popup for a specific cell.
 * @param {string} cellId - Cell identifier
 * @param {HTMLElement} cellElement - The cell DOM element
 */
export function openPopup(cellId, cellElement) {
    if (!popupElement) {
        initializePopup();
    }
    
    currentCellId = cellId;
    currentCellElement = cellElement;
    
    // Get the actual cell content from the DOM and normalize it
    const rawContent = cellElement.textContent || "";
    const actualContent = normalizeContentForStorage(rawContent) || "Cell";
    
    let cellData = getCellData(cellId);
    
    // Always verify content match - cell IDs can be wrong due to rowspan/empty rows
    // Prefer content-based matching for reliability
    const normalizedActual = normalizeForComparison(actualContent);
    const cellDataContent = cellData?.content ? normalizeForComparison(cellData.content) : "";
    
    if (!cellData || cellDataContent !== normalizedActual) {
        // Try to find matching summary by content first (more reliable than cell ID)
        const allCellData = getAllCellData();
        let matchingCellData = null;
        let matchingId = null;
        
        // First try exact match (case-sensitive, normalized)
        for (const [id, data] of Object.entries(allCellData)) {
            if (data.content) {
                const normalizedData = normalizeContentForStorage(data.content);
                if (normalizedData === actualContent) {
                    matchingCellData = data;
                    matchingId = id;
                    break;
                }
            }
        }
        
        // If no exact match, try case-insensitive match
        if (!matchingCellData) {
            for (const [id, data] of Object.entries(allCellData)) {
                if (data.content) {
                    const normalizedData = normalizeForComparison(data.content);
                    if (normalizedData === normalizedActual && normalizedActual) {
                        matchingCellData = data;
                        matchingId = id;
                        console.log(`Case-insensitive content match: ${cellId} -> ${id} for "${actualContent.substring(0, 30)}"`);
                        break;
                    }
                }
            }
        }
        
        if (matchingCellData) {
            cellData = { ...matchingCellData, content: actualContent };
            if (matchingId !== cellId) {
                console.log(`Content match: ${cellId} -> ${matchingId} for "${actualContent.substring(0, 50)}"`);
                // Update currentCellId to the correct one so saves work properly
                currentCellId = matchingId;
            }
        } else if (cellData && cellData.content) {
            // Cell ID exists but content doesn't match - log warning
            console.warn(`Cell ID mismatch for ${cellId}:`, {
                expected: actualContent,
                found: cellData.content,
            });
            // Use existing summary if available, but update content
            cellData = { 
                content: actualContent, 
                summary: cellData.summary || "",
                lastUpdated: cellData.lastUpdated || ""
            };
        } else {
            // No cellData exists, create a basic entry
            cellData = { content: actualContent, summary: "" };
        }
    }
    
    const titleEl = popupElement.querySelector(".cell-popup-title");
    const summaryEl = popupElement.querySelector(".cell-popup-summary");
    const textareaEl = popupElement.querySelector(".cell-popup-textarea");
    const viewDiv = popupElement.querySelector(".cell-popup-view");
    const editDiv = popupElement.querySelector(".cell-popup-edit");
    
    // Always use actual cell content for display (already normalized)
    const content = actualContent;
    const summary = (cellData.summary && cellData.summary !== "no data") ? cellData.summary : "";
    
    titleEl.textContent = content;
    summaryEl.textContent = summary || "No information available.";
    textareaEl.value = summary;
    
    // Check if teacher mode is enabled
    const teacherMode = isTeacherModeEnabled();
    if (teacherMode) {
        // In teacher mode, show edit mode by default
        viewDiv.classList.add("hidden");
        editDiv.classList.remove("hidden");
        isEditMode = true;
        textareaEl.focus();
    } else {
        // In student mode, show view mode
        viewDiv.classList.remove("hidden");
        editDiv.classList.add("hidden");
        isEditMode = false;
    }
    
    popupElement.classList.remove("hidden");
    
    // Prevent body scroll
    document.body.style.overflow = "hidden";
}

/**
 * Close the popup.
 */
export function closePopup() {
    if (!popupElement) return;
    
    if (isEditMode) {
        handleCancel();
    }
    
    popupElement.classList.add("hidden");
    currentCellId = null;
    currentCellElement = null;
    isEditMode = false;
    
    // Restore body scroll
    document.body.style.overflow = "";
}

/**
 * Handle save action.
 */
function handleSave() {
    if (!currentCellId || !currentCellElement) return;
    
    const textareaEl = popupElement.querySelector(".cell-popup-textarea");
    const summary = textareaEl.value.trim();
    const content = currentCellElement.textContent.trim() || "Cell";
    
    // Update or create cell data
    updateCellData(currentCellId, {
        content: content,
        summary: summary,
        lastUpdated: new Date().toISOString(),
    });
    
    // Update view mode
    const summaryEl = popupElement.querySelector(".cell-popup-summary");
    summaryEl.textContent = summary || "No information available.";
    
    // Switch back to view mode
    const viewDiv = popupElement.querySelector(".cell-popup-view");
    const editDiv = popupElement.querySelector(".cell-popup-edit");
    viewDiv.classList.remove("hidden");
    editDiv.classList.add("hidden");
    isEditMode = false;
}

/**
 * Handle cancel action.
 */
function handleCancel() {
    if (!popupElement) return;
    
    const textareaEl = popupElement.querySelector(".cell-popup-textarea");
    const cellData = getCellData(currentCellId);
    textareaEl.value = cellData?.summary || "";
    
    const viewDiv = popupElement.querySelector(".cell-popup-view");
    const editDiv = popupElement.querySelector(".cell-popup-edit");
    viewDiv.classList.remove("hidden");
    editDiv.classList.add("hidden");
    isEditMode = false;
}

/**
 * Handle delete action.
 */
function handleDelete() {
    if (!currentCellId) return;
    
    if (confirm("Are you sure you want to remove interactivity from this cell? This cannot be undone.")) {
        deleteCellData(currentCellId);
        
        // Remove click handler from cell element
        if (currentCellElement) {
            currentCellElement.classList.remove("interactive-cell");
            currentCellElement.removeAttribute("data-cell-id");
            currentCellElement.style.cursor = "default";
        }
        
        closePopup();
    }
}

/**
 * Cleanup popup resources.
 */
export function cleanupPopup() {
    if (teacherModeUnsubscribe) {
        teacherModeUnsubscribe();
        teacherModeUnsubscribe = null;
    }
    
    if (popupElement && popupElement.parentNode) {
        popupElement.parentNode.removeChild(popupElement);
    }
    
    popupElement = null;
    popupContent = null;
    currentCellId = null;
    currentCellElement = null;
}

// Close popup on Escape key
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && popupElement && !popupElement.classList.contains("hidden")) {
        closePopup();
    }
});

