import {
    initializeTeacherMode,
    setTeacherModeEnabled,
    isTeacherModeEnabled,
    onTeacherModeChange,
    registerGuideContext,
    createTeacherToolbar,
} from "./teacher/index.js";

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

function renderGuideFragment(guide, markup) {
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

    const fragmentWrapper = document.createElement("div");
    fragmentWrapper.className = "guide-fragment-wrapper";
    fragmentWrapper.innerHTML = markup;
    tableContainerEl.appendChild(fragmentWrapper);

    enhanceFragment(fragmentWrapper);
    registerGuideContext({
        slug: guide.slug ?? null,
        title: docTitle,
        course: guide.course ?? null,
        tags: guide.tags ?? [],
        sourceFile: guide.sourceFile ?? null,
    });
}

function enhanceFragment(container) {
    container.querySelectorAll("table").forEach((table) => {
        table.classList.add("guide-table");
        table.querySelectorAll("th, td").forEach((cell) => {
            cell.innerHTML = transformDrugNames(cell.innerHTML);
        });
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

        const tableElement = buildTableElement(tableData);
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

function buildTableElement(tableData) {
    const template = document.getElementById("guide-table-template");
    const table = template.content.firstElementChild.cloneNode(true);
    const thead = table.querySelector("thead");
    const tbody = table.querySelector("tbody");

    if (tableData.headers && tableData.headers.length > 0) {
        const headerRow = document.createElement("tr");
        tableData.headers.forEach((header) => {
            const th = document.createElement("th");
            th.innerHTML = transformDrugNames(header);
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
    }

    if (tableData.rows && tableData.rows.length > 0) {
        tableData.rows.forEach((row) => {
            const tr = document.createElement("tr");
            row.forEach((cell) => {
                const td = document.createElement("td");
                td.innerHTML = transformDrugNames(typeof cell === "string" ? cell : "");
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

loadGuideIndex();

