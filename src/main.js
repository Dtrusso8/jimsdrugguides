import {
    initializeTeacherMode,
    setTeacherModeEnabled,
    isTeacherModeEnabled,
    onTeacherModeChange,
    registerGuideContext,
    createTeacherToolbar,
} from "./teacher/index.js";
import { initializeCellData } from "./popup/cellManager.js";
import { initializePopup, openPopup } from "./popup/popup.js";

const dataBaseUrl = new URL("../data/", import.meta.url);
const guideIndexUrl = new URL("guides.index.json", dataBaseUrl);

const state = {
    guides: [],
    courses: new Map(),
    tags: new Map(),
    activeCourse: null,
    activeTag: null,
};

const courseListEl = document.getElementById("course-list");
const tagListEl = document.getElementById("tag-list");
const guideHeaderEl = document.getElementById("guide-header");
const tableContainerEl = document.getElementById("guide-table-container");
const teacherToggleEl = document.getElementById("teacher-mode-toggle");
const modalEl = document.getElementById("drug-modal");
const modalBodyEl = document.getElementById("modal-body");
const modalCloseBtn = document.getElementById("modal-close-btn");
const filterToggleEl = document.getElementById("filter-toggle");
const filtersPanelEl = document.getElementById("filters-panel");
const sidebarCollapseBtn = document.getElementById("sidebar-collapse-btn");
const sidebarExpandBtn = document.getElementById("sidebar-expand-btn");
const layoutEl = document.querySelector("main.layout");
const drugSearchEl = document.getElementById("drug-search");
const searchClearEl = document.getElementById("search-clear");
const searchResultsEl = document.getElementById("search-results");

initializeTeacherMode(false);

onTeacherModeChange(({ enabled }) => {
    if (teacherToggleEl) {
        teacherToggleEl.checked = enabled;
    }
});

function slugify(value = "") {
    return value
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function dedupeTags(tags) {
    const seen = new Set();
    return tags.filter((tag) => {
        const key = tag.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function normalizeGuide(rawGuide) {
    const courseName = (rawGuide.course ?? "Unspecified Course").trim();
    const courseSlug = (rawGuide.courseSlug && String(rawGuide.courseSlug).trim()) || slugify(courseName);
    const tags = Array.isArray(rawGuide.tags)
        ? dedupeTags(
              rawGuide.tags
                  .map((tag) => String(tag).trim())
                  .filter(Boolean)
          )
        : [];

    return {
        ...rawGuide,
        course: courseName || "Unspecified Course",
        courseSlug,
        tags,
    };
}

function renderTagsMarkup(tags) {
    if (!Array.isArray(tags) || tags.length === 0) {
        return '<span class="meta-tag meta-tag--empty">None</span>';
    }

    return tags
        .slice()
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
        .map((tag) => `<span class="meta-tag">${tag}</span>`)
        .join("");
}

async function loadGuideIndex() {
    try {
        console.log("Loading guide index from:", guideIndexUrl.href);
        const response = await fetch(guideIndexUrl, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`Failed to fetch guide index: ${response.statusText}`);
        }
        const data = await response.json();
        console.log("Loaded index data:", data);
        const guides = Array.isArray(data.guides) ? data.guides : [];
        console.log("Found guides:", guides.length);
        state.guides = guides.map(normalizeGuide);
        console.log("Normalized guides:", state.guides);
        buildFilters();
        if (state.guides.length === 0) {
            guideHeaderEl.innerHTML = "<h2>No guides found. Run the conversion script to generate guide data.</h2>";
        }
    } catch (error) {
        console.error("Error loading guide index:", error);
        guideHeaderEl.innerHTML = "<h2>Unable to load guides. Please check the data files.</h2>";
    }
}

function buildFilters() {
    console.log("Building filters from guides:", state.guides);
    state.courses.clear();
    state.tags.clear();

    state.guides.forEach((guide) => {
        const courseKey = guide.courseSlug || guide.course || "uncategorized";
        console.log("Processing guide:", guide.title, "course:", guide.course, "courseSlug:", guide.courseSlug, "courseKey:", courseKey);
        if (!state.courses.has(courseKey)) {
            state.courses.set(courseKey, {
                label: guide.course ?? "Unspecified Course",
                guides: [],
            });
            console.log("Created new course entry:", courseKey, guide.course);
        }
        state.courses.get(courseKey).guides.push(guide);

        guide.tags.forEach((tag) => {
            if (!state.tags.has(tag)) {
                state.tags.set(tag, []);
            }
            state.tags.get(tag).push(guide);
        });
    });

    const courseKeys = renderCourseFilters();
    const tagKeys = renderTagFilters();
    console.log("Course keys:", courseKeys, "Courses map:", Array.from(state.courses.entries()));

    const hasSelection = Boolean(state.activeCourse || state.activeTag);

    if (state.activeCourse && state.courses.has(state.activeCourse)) {
        console.log("Rendering guides for active course:", state.activeCourse);
        renderGuideList(state.courses.get(state.activeCourse).guides);
    } else if (state.activeTag && state.tags.has(state.activeTag)) {
        console.log("Rendering guides for active tag:", state.activeTag);
        renderGuideList(state.tags.get(state.activeTag));
    } else {
        if (hasSelection) {
            state.activeCourse = null;
            state.activeTag = null;
        }
        if (courseKeys.length > 0) {
            state.activeCourse = courseKeys[0];
            state.activeTag = null;
            console.log("Auto-selecting first course:", state.activeCourse, "with guides:", state.courses.get(state.activeCourse)?.guides.length);
            renderGuideList(state.courses.get(state.activeCourse).guides);
        } else if (tagKeys.length > 0) {
            state.activeCourse = null;
            state.activeTag = tagKeys[0];
            console.log("Auto-selecting first tag:", state.activeTag);
            renderGuideList(state.tags.get(state.activeTag));
        } else {
            console.log("No courses or tags found");
            guideHeaderEl.innerHTML = "<h2>No guides found. Run the conversion script to generate guide data.</h2>";
            tableContainerEl.innerHTML = "";
            registerGuideContext(null);
        }
    }

    highlightActiveFilters();
}

function renderCourseFilters() {
    courseListEl.innerHTML = "";
    const sortedCourses = [...state.courses.entries()].sort((a, b) =>
        a[1].label.localeCompare(b[1].label, undefined, { numeric: true })
    );

    sortedCourses.forEach(([key, entry]) => {
        const button = document.createElement("button");
        button.textContent = entry.label;
        button.dataset.filterKey = key;
        button.dataset.filterType = "course";
        button.addEventListener("click", () => {
            state.activeCourse = key;
            state.activeTag = null;
            highlightActiveFilters();
            renderGuideList(entry.guides);
            collapseFiltersOnMobile();
        });
        courseListEl.appendChild(button);
    });

    return sortedCourses.map(([key]) => key);
}

function renderTagFilters() {
    tagListEl.innerHTML = "";
    const sortedTags = [...state.tags.entries()].sort((a, b) =>
        a[0].localeCompare(b[0], undefined, { sensitivity: "base" })
    );

    sortedTags.forEach(([tag, guides]) => {
        const button = document.createElement("button");
        button.textContent = tag;
        button.dataset.filterKey = tag;
        button.dataset.filterType = "tag";
        button.addEventListener("click", () => {
            state.activeTag = tag;
            state.activeCourse = null;
            highlightActiveFilters();
            renderGuideList(guides);
            collapseFiltersOnMobile();
        });
        tagListEl.appendChild(button);
    });

    return sortedTags.map(([tag]) => tag);
}

function highlightActiveFilters() {
    [...courseListEl.children].forEach((child) => {
        child.classList.toggle("active", child.dataset.filterKey === state.activeCourse);
    });
    [...tagListEl.children].forEach((child) => {
        child.classList.toggle("active", child.dataset.filterKey === state.activeTag);
    });
}

async function renderGuideList(guides) {
    if (!guides || guides.length === 0) {
        guideHeaderEl.innerHTML = "<h2>No guides available for this selection.</h2>";
        tableContainerEl.innerHTML = "";
        registerGuideContext(null);
        return;
    }

    const guidesToRender = [...guides].sort((a, b) =>
        (a.title ?? "Untitled").localeCompare(b.title ?? "Untitled", undefined, { numeric: true })
    );

    if (guidesToRender.length === 1) {
        const guide = guidesToRender[0];
        guideHeaderEl.innerHTML = `<h2>${guide.title ?? "Untitled Guide"}</h2>`;
        await loadGuideContent(guide);
        return;
    }

    guideHeaderEl.innerHTML = "<h2>Select a guide:</h2>";
    const list = document.createElement("ul");
    list.className = "selection-list";
    registerGuideContext(null);

    guidesToRender.forEach((guide) => {
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.textContent = guide.title ?? "Untitled Guide";
        button.addEventListener("click", () => loadGuideContent(guide));
        li.appendChild(button);
        list.appendChild(li);
    });

    tableContainerEl.innerHTML = "";
    tableContainerEl.appendChild(list);
}

async function loadGuideContent(guide) {
    try {
        console.log("Loading guide content:", guide);
        const fragmentUrl = guide.fragment ? new URL(guide.fragment, dataBaseUrl) : null;
        console.log("Fragment URL:", fragmentUrl?.href);
        console.log("Data base URL:", dataBaseUrl.href);
        if (fragmentUrl) {
            console.log("Fetching fragment from:", fragmentUrl.href);
            const response = await fetch(fragmentUrl, { cache: "no-store" });
            console.log("Response status:", response.status, response.statusText);
            if (!response.ok) {
                throw new Error(`Failed to load guide fragment: ${response.status} ${response.statusText}`);
            }
            const markup = await response.text();
            console.log("Loaded fragment, length:", markup.length);
            renderGuideFragment(guide, markup);
            return;
        }

        if (guide.dataFile) {
            const dataUrl = new URL(guide.dataFile, dataBaseUrl);
            const response = await fetch(dataUrl, { cache: "no-store" });
            if (!response.ok) {
                throw new Error(`Failed to load guide data: ${response.statusText}`);
            }
            const data = await response.json();
            renderLegacyGuide(guide, data);
            return;
        }

        throw new Error("Guide fragment path missing.");
    } catch (error) {
        console.error(error);
        tableContainerEl.innerHTML = "<p class=\"error\">Unable to load guide details.</p>";
        registerGuideContext(null);
    }
}

async function renderGuideFragment(guide, markup) {
    tableContainerEl.innerHTML = "";
    const docTitle = guide.title || "Untitled Guide";
    guideHeaderEl.innerHTML = `<h2>${docTitle}</h2>`;
    const metadata = document.createElement("div");
    metadata.className = "guide-metadata";
    const sourceLabel = guide.sourceFile
        ? guide.sourceFile.split(/[\\/]/).pop()
        : guide.title;
    const courseName = guide.course ?? "Unspecified";
    const resolvedTags = guide.tags ?? [];

    metadata.innerHTML = `
        <p><strong>Course:</strong> ${guide.course ?? "Unspecified"}</p>
        <p class="guide-tags"><strong>Tags:</strong> ${renderTagsMarkup(guide.tags)}</p>
        <p class="guide-source">Source: ${sourceLabel ?? "Unknown source"}</p>
    `;

    const toolbar = createTeacherToolbar();

    tableContainerEl.appendChild(metadata);
    tableContainerEl.appendChild(toolbar);

    // Load guide data to get cellData
    let guideData = null;
    if (guide.dataFile) {
        try {
            const dataUrl = new URL(guide.dataFile, dataBaseUrl);
            const response = await fetch(dataUrl, { cache: "no-store" });
            if (response.ok) {
                guideData = await response.json();
                initializeCellData(guideData);
            }
        } catch (error) {
            console.warn("Could not load guide data for cellData:", error);
        }
    }

    // Initialize popup if not already done
    initializePopup();

    const fragmentWrapper = document.createElement("div");
    fragmentWrapper.className = "guide-fragment-wrapper";
    fragmentWrapper.innerHTML = markup;
    tableContainerEl.appendChild(fragmentWrapper);

    enhanceFragment(fragmentWrapper, guideData);
    registerGuideContext({
        slug: guide.slug ?? null,
        title: docTitle,
        course: guide.course ?? null,
        tags: guide.tags ?? [],
        sourceFile: guide.sourceFile ?? null,
    });
}

/**
 * Normalize content exactly as convert_guides.py does for storage in cellData.
 * This matches the normalization used in generate_cell_data():
 * - Remove HTML tags
 * - Strip whitespace
 * - Handle &nbsp; as empty
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
    return normalized;
}

function enhanceFragment(container, guideData = null) {
    let tableIndex = 1; // Start at 1 to match cellData generation
    container.querySelectorAll("table").forEach((table) => {
        table.classList.add("guide-table");
        // Use data-table-index from HTML (1-based) or fallback to our counter (also 1-based)
        const tableDataIndex = table.dataset.tableIndex ? parseInt(table.dataset.tableIndex) : tableIndex;
        
        // HTML doesn't have thead/tbody - just tr elements
        // First tr with th elements is header (row 0), rest with td are data rows
        const allRows = table.querySelectorAll("tr");
        
        // Track header rows to determine data row indices
        let headerRowCount = 0;
        allRows.forEach((row) => {
            if (row.querySelector("th") !== null) {
                headerRowCount++;
            }
        });
        
        allRows.forEach((row, rowIndex) => {
            // Check if this is a header row (has th elements)
            const hasTh = row.querySelector("th") !== null;
            
            if (hasTh) {
                // Header row (row 0)
                row.querySelectorAll("th").forEach((cell, colIndex) => {
                    const cellText = normalizeContentForStorage(cell.textContent || "");
                    if (cellText) {
                        const cellId = `table_${tableDataIndex}_row_0_col_${colIndex}`;
                        makeCellInteractive(cell, cellId, guideData);
                    }
                });
            } else {
                // Data row
                // In generate_cell_data: 
                //   - Headers are row 0 (from table["headers"])
                //   - Data rows: enumerate(table["rows"], start=1) means first row in array gets index 1
                // In HTML:
                //   - If first row has th: rowIndex 0 = header (row 0), rowIndex 1 = first data row (row 1)
                //   - If no headers: rowIndex 0 = first data row (row 1)
                // So: actualRowIndex = rowIndex (if headers exist) or rowIndex + 1 (if no headers)
                // Actually, if we count headers separately, data rows start at rowIndex = headerRowCount
                // But since headers are row 0, first data row should be row 1
                // So: if rowIndex >= headerRowCount, actualRowIndex = rowIndex - headerRowCount + 1
                // But simpler: if we iterate and skip headers, first data row is row 1
                // Let's count: if headerRowCount > 0, first data row is at rowIndex = headerRowCount, should be row 1
                // So: actualRowIndex = rowIndex - headerRowCount + 1
                // But wait, if headerRowCount = 1, first data row is at rowIndex 1, should be row 1
                // So: actualRowIndex = rowIndex - headerRowCount + 1 = 1 - 1 + 1 = 1 ✓
                const actualRowIndex = headerRowCount > 0 ? rowIndex - headerRowCount + 1 : rowIndex + 1;
                row.querySelectorAll("td").forEach((cell, colIndex) => {
                    const cellText = normalizeContentForStorage(cell.textContent || "");
                    if (cellText) {
                        const cellId = `table_${tableDataIndex}_row_${actualRowIndex}_col_${colIndex}`;
                        makeCellInteractive(cell, cellId, guideData);
                    }
                });
            }
        });
        
        tableIndex++;
    });

    container.querySelectorAll(".drug-tag").forEach((tag) => {
        tag.addEventListener("click", (event) => {
            const payload = event.currentTarget.dataset;
            openDrugModal({
                name: payload.drugName,
                description: payload.description,
            });
        });
    });
}

function transformDrugNames(htmlString) {
    return htmlString;
}

function renderLegacyGuide(guide, data) {
    tableContainerEl.innerHTML = "";
    const docTitle = data.title || guide.title || "Untitled Guide";
    guideHeaderEl.innerHTML = `<h2>${docTitle}</h2>`;

    const metadata = document.createElement("div");
    metadata.className = "guide-metadata";
    const sourceLabel = guide.sourceFile
        ? guide.sourceFile.split(/[\\/]/).pop()
        : guide.title;
    const courseName = data.course ?? guide.course ?? "Unspecified";
    const resolvedTags = data.tags && Array.isArray(data.tags) && data.tags.length > 0
        ? dedupeTags(data.tags.map((tag) => String(tag).trim()).filter(Boolean))
        : guide.tags ?? [];

    metadata.innerHTML = `
        <p><strong>Course:</strong> ${courseName}</p>
        <p class="guide-tags"><strong>Tags:</strong> ${renderTagsMarkup(resolvedTags)}</p>
        <p class="guide-source">Source: ${sourceLabel ?? "Unknown source"}</p>
    `;

    const toolbar = createTeacherToolbar();

    tableContainerEl.appendChild(metadata);
    tableContainerEl.appendChild(toolbar);

    // Initialize cell data and popup
    initializeCellData(data);
    initializePopup();

    const tables = Array.isArray(data.tables) && data.tables.length > 0
        ? data.tables
        : [
              {
                  headers: data.headers ?? [],
                  rows: data.rows ?? [],
              },
          ];

    if (!tables.length || (tables.length === 1 && tables[0].headers.length === 0 && tables[0].rows.length === 0)) {
        const emptyState = document.createElement("p");
        emptyState.textContent = "No table data available for this guide.";
        tableContainerEl.appendChild(emptyState);
        return;
    }

    tables.forEach((tableData, index) => {
        const tableBlock = document.createElement("article");
        tableBlock.className = "guide-table-block";

        const tableTitle = document.createElement("h3");
        const displayTitle = tableData.title || tableData.headers?.[0] || `Table ${index + 1}`;
        tableTitle.textContent = displayTitle;
        tableBlock.appendChild(tableTitle);

        // Use 1-based table index to match cellData generation
        const tableIndex = index + 1;
        const tableElement = buildTableElement(tableData, tableIndex, data);
        tableBlock.appendChild(tableElement);
        tableContainerEl.appendChild(tableBlock);
    });

    registerGuideContext({
        slug: guide.slug ?? null,
        title: docTitle,
        course: courseName,
        tags: resolvedTags,
        sourceFile: guide.sourceFile ?? null,
    });
}

function buildTableElement(tableData, tableIndex = 0, guideData = null) {
    const template = document.getElementById("guide-table-template");
    const table = template.content.firstElementChild.cloneNode(true);
    const thead = table.querySelector("thead");
    const tbody = table.querySelector("tbody");

    if (tableData.headers && tableData.headers.length > 0) {
        const headerRow = document.createElement("tr");
        tableData.headers.forEach((header, colIndex) => {
            const th = document.createElement("th");
            th.innerHTML = transformDrugNames(header);
            const cellText = normalizeContentForStorage(th.textContent || "");
            if (cellText) {
                const cellId = `table_${tableIndex}_row_0_col_${colIndex}`;
                makeCellInteractive(th, cellId, guideData);
            }
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
    }

    if (tableData.rows && tableData.rows.length > 0) {
        tableData.rows.forEach((row, rowIndex) => {
            const tr = document.createElement("tr");
            const actualRowIndex = rowIndex + 1; // Rows start at 1 (0 is header)
            row.forEach((cell, colIndex) => {
                const td = document.createElement("td");
                td.innerHTML = transformDrugNames(typeof cell === "string" ? cell : "");
                const cellText = normalizeContentForStorage(td.textContent || "");
                if (cellText) {
                    const cellId = `table_${tableIndex}_row_${actualRowIndex}_col_${colIndex}`;
                    makeCellInteractive(td, cellId, guideData);
                }
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
    } else {
        const emptyRow = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = tableData.headers?.length ?? 1;
        td.textContent = "No data available.";
        emptyRow.appendChild(td);
        tbody.appendChild(emptyRow);
    }

    return table;
}

function makeCellInteractive(cellElement, cellId, guideData = null) {
    // Make all non-empty cells interactive
    const cellText = cellElement.textContent.trim();
    if (cellText && cellText !== "&nbsp;") {
        cellElement.classList.add("interactive-cell");
        cellElement.setAttribute("data-cell-id", cellId);
        cellElement.addEventListener("click", (e) => {
            e.stopPropagation();
            openPopup(cellId, cellElement);
        });
    }
}

function openDrugModal({ name, description }) {
    modalBodyEl.innerHTML = `
        <h3>${name}</h3>
        <p>${description ?? "No additional information."}</p>
    `;
    modalEl.classList.remove("hidden");
}

function closeModal() {
    modalEl.classList.add("hidden");
}

if (teacherToggleEl) {
    teacherToggleEl.addEventListener("change", (event) => {
        setTeacherModeEnabled(event.target.checked);
    });
}

const filterMediaQuery = window.matchMedia("(max-width: 768px)");

if (filterToggleEl && filtersPanelEl) {
    filterToggleEl.addEventListener("click", () => {
        const expanded = filterToggleEl.getAttribute("aria-expanded") === "true";
        setFiltersExpanded(!expanded);
    });

    if (typeof filterMediaQuery.addEventListener === "function") {
        filterMediaQuery.addEventListener("change", () => {
            syncFilterPanelToViewport();
        });
    } else if (typeof filterMediaQuery.addListener === "function") {
        filterMediaQuery.addListener(syncFilterPanelToViewport);
    }

    syncFilterPanelToViewport();
}

function setFiltersExpanded(expanded) {
    if (!filterToggleEl || !filtersPanelEl) return;
    filterToggleEl.setAttribute("aria-expanded", String(expanded));
    filtersPanelEl.classList.toggle("filters-open", expanded);
}

function collapseFiltersOnMobile() {
    if (!filterToggleEl) return;
    if (filterMediaQuery.matches) {
        setFiltersExpanded(false);
    }
}

function syncFilterPanelToViewport() {
    if (!filterToggleEl || !filtersPanelEl) return;
    if (filterMediaQuery.matches) {
        setFiltersExpanded(false);
        filtersPanelEl.setAttribute("data-mobile", "true");
    } else {
        setFiltersExpanded(true);
        filtersPanelEl.setAttribute("data-mobile", "false");
    }
}

modalEl.addEventListener("click", (event) => {
    if (event.target === modalEl) {
        closeModal();
    }
});

modalCloseBtn.addEventListener("click", closeModal);

window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modalEl.classList.contains("hidden")) {
        closeModal();
    }
});

// Sidebar collapse/expand functionality
if (sidebarCollapseBtn && layoutEl) {
    sidebarCollapseBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log("Collapse button clicked");
        layoutEl.classList.add("sidebar-collapsed");
    });
} else {
    console.warn("Collapse button or layout element not found", { sidebarCollapseBtn, layoutEl });
}

if (sidebarExpandBtn && layoutEl) {
    sidebarExpandBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log("Expand button clicked");
        layoutEl.classList.remove("sidebar-collapsed");
    });
} else {
    console.warn("Expand button or layout element not found", { sidebarExpandBtn, layoutEl });
}

// Search functionality
let searchTimeout = null;
let allGuidesDataCache = new Map(); // Cache guide data for search

/**
 * Parse cell ID to extract table, row, and column indices.
 * @param {string} cellId - Cell ID in format "table_X_row_Y_col_Z"
 * @returns {Object|null} Object with table, row, col indices or null
 */
function parseCellId(cellId) {
    const match = cellId.match(/table_(\d+)_row_(\d+)_col_(\d+)/);
    if (!match) return null;
    return {
        table: parseInt(match[1], 10),
        row: parseInt(match[2], 10),
        col: parseInt(match[3], 10),
    };
}

/**
 * Search for drugs across all guides.
 * @param {string} query - Search query
 * @returns {Promise<Array>} Array of search results
 */
async function searchDrugs(query) {
    if (!query || query.trim().length < 2) {
        return [];
    }
    
    const searchTerm = query.trim().toLowerCase();
    const results = [];
    
    // Load all guide data if not cached
    for (const guide of state.guides) {
        if (!guide.dataFile) continue;
        
        let guideData = allGuidesDataCache.get(guide.slug);
        if (!guideData) {
            try {
                const dataUrl = new URL(guide.dataFile, dataBaseUrl);
                const response = await fetch(dataUrl, { cache: "no-store" });
                if (response.ok) {
                    guideData = await response.json();
                    allGuidesDataCache.set(guide.slug, guideData);
                } else {
                    continue;
                }
            } catch (error) {
                console.warn(`Could not load guide data for search: ${guide.slug}`, error);
                continue;
            }
        }
        
        // Search in cellData
        const cellData = guideData.cellData || {};
        for (const [cellId, cellInfo] of Object.entries(cellData)) {
            const content = cellInfo?.content || "";
            const normalizedContent = content.toLowerCase();
            
            // Check if search term matches content
            if (normalizedContent.includes(searchTerm)) {
                const cellLocation = parseCellId(cellId);
                if (cellLocation) {
                    results.push({
                        guide: guide,
                        cellId: cellId,
                        content: content,
                        summary: (cellInfo.summary && cellInfo.summary !== "no data") ? cellInfo.summary : "",
                        location: cellLocation,
                    });
                }
            }
        }
    }
    
    // Sort results: exact matches first, then by guide name, then by content
    results.sort((a, b) => {
        const aExact = a.content.toLowerCase() === searchTerm;
        const bExact = b.content.toLowerCase() === searchTerm;
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        
        const guideCompare = a.guide.title.localeCompare(b.guide.title);
        if (guideCompare !== 0) return guideCompare;
        
        return a.content.localeCompare(b.content);
    });
    
    return results;
}

/**
 * Display search results.
 * @param {Array} results - Array of search results
 */
function displaySearchResults(results) {
    if (results.length === 0) {
        searchResultsEl.innerHTML = '<div class="search-results-empty">No drugs found matching your search.</div>';
        searchResultsEl.classList.remove("hidden");
        return;
    }
    
    // Group results by drug name (content)
    const groupedResults = new Map();
    for (const result of results) {
        const key = result.content.toLowerCase();
        if (!groupedResults.has(key)) {
            groupedResults.set(key, []);
        }
        groupedResults.get(key).push(result);
    }
    
    let html = '<div class="search-results-header">';
    html += `<h3>Found ${results.length} result(s) for "${drugSearchEl.value}"</h3>`;
    html += '</div>';
    html += '<div class="search-results-list">';
    
    for (const [drugName, drugResults] of groupedResults.entries()) {
        const firstResult = drugResults[0];
        const summary = firstResult.summary || "No summary available.";
        
        html += '<div class="search-result-card">';
        html += `<h4 class="search-result-drug-name">${firstResult.content}</h4>`;
        html += `<div class="search-result-summary">${summary}</div>`;
        html += '<div class="search-result-locations">';
        html += '<strong>Found in:</strong>';
        html += '<ul class="search-result-locations-list">';
        
        for (const result of drugResults) {
            html += '<li class="search-result-location-item">';
            html += `<button type="button" class="search-result-link" data-guide-slug="${result.guide.slug}" data-cell-id="${result.cellId}">`;
            html += `${result.guide.title} `;
            html += `<span class="search-result-location">(Table ${result.location.table}, Row ${result.location.row}, Col ${result.location.col})</span>`;
            html += '</button>';
            html += '</li>';
        }
        
        html += '</ul>';
        html += '</div>';
        html += '</div>';
    }
    
    html += '</div>';
    searchResultsEl.innerHTML = html;
    searchResultsEl.classList.remove("hidden");
    
    // Add click handlers for navigation
    searchResultsEl.querySelectorAll(".search-result-link").forEach((button) => {
        button.addEventListener("click", async (e) => {
            const guideSlug = button.dataset.guideSlug;
            const cellId = button.dataset.cellId;
            await navigateToCell(guideSlug, cellId);
        });
    });
}

/**
 * Navigate to a specific cell in a guide.
 * @param {string} guideSlug - Guide slug
 * @param {string} cellId - Cell ID
 */
async function navigateToCell(guideSlug, cellId) {
    // Find the guide
    const guide = state.guides.find((g) => g.slug === guideSlug);
    if (!guide) {
        console.error(`Guide not found: ${guideSlug}`);
        return;
    }
    
    // Close search results to get out of the way
    searchResultsEl.classList.add("hidden");
    
    // Load the guide
    await loadGuideContent(guide);
    
    // Wait for DOM to update and find the cell (retry with increasing delays)
    const findAndNavigateToCell = (attempt = 0) => {
        const maxAttempts = 10;
        const delay = Math.min(100 * (attempt + 1), 500); // 100ms, 200ms, 300ms, etc., max 500ms
        
        setTimeout(() => {
            // Search in the guide table container first, then fallback to entire document
            const container = tableContainerEl || document;
            const cellElement = container.querySelector(`[data-cell-id="${cellId}"]`);
            if (cellElement) {
                // Scroll to cell
                cellElement.scrollIntoView({ behavior: "smooth", block: "center" });
                
                // Small additional delay to ensure scroll completes
                setTimeout(() => {
                    // Highlight the cell temporarily
                    cellElement.classList.add("search-highlight");
                    setTimeout(() => {
                        cellElement.classList.remove("search-highlight");
                    }, 2000);
                    
                    // Open popup for the cell
                    openPopup(cellId, cellElement);
                }, 300);
            } else if (attempt < maxAttempts) {
                // Retry if cell not found yet
                findAndNavigateToCell(attempt + 1);
            } else {
                console.warn(`Cell not found after ${maxAttempts} attempts: ${cellId}`);
                // Try to find by content as fallback
                const location = parseCellId(cellId);
                if (location) {
                    console.log(`Attempting to find cell at Table ${location.table}, Row ${location.row}, Col ${location.col}`);
                }
            }
        }, delay);
    };
    
    // Start looking for the cell
    findAndNavigateToCell();
}

/**
 * Handle search input.
 */
function handleSearch() {
    const query = drugSearchEl.value.trim();
    
    // Show/hide clear button
    if (query.length > 0) {
        searchClearEl.classList.remove("hidden");
    } else {
        searchClearEl.classList.add("hidden");
        searchResultsEl.classList.add("hidden");
        searchResultsEl.innerHTML = "";
        return;
    }
    
    // Debounce search
    if (searchTimeout) {
        clearTimeout(searchTimeout);
    }
    
    searchTimeout = setTimeout(async () => {
        const results = await searchDrugs(query);
        displaySearchResults(results);
    }, 300);
}

/**
 * Clear search.
 */
function clearSearch() {
    drugSearchEl.value = "";
    searchClearEl.classList.add("hidden");
    searchResultsEl.classList.add("hidden");
    searchResultsEl.innerHTML = "";
}

// Set up search event listeners
if (drugSearchEl) {
    drugSearchEl.addEventListener("input", handleSearch);
    drugSearchEl.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            clearSearch();
        }
    });
}

if (searchClearEl) {
    searchClearEl.addEventListener("click", clearSearch);
}

loadGuideIndex();

