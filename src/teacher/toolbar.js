import { isTeacherModeEnabled, onTeacherModeChange, requestTeacherAction, getTeacherState } from "./teacherState.js";

function handleToolbarClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) {
        return;
    }

    const action = button.dataset.action;
    const context = getTeacherState().currentGuide;
    requestTeacherAction(action, { guide: context });
}

export function createTeacherToolbar() {
    const toolbar = document.createElement("div");
    toolbar.id = "teacher-toolbar";
    toolbar.className = "teacher-toolbar";
    toolbar.innerHTML = `
        <button type="button" data-action="reorder">Reorder Rows</button>
        <button type="button" data-action="annotate">Add Annotation</button>
        <button type="button" data-action="link">Attach Link</button>
    `;

    toolbar.addEventListener("click", handleToolbarClick);

    const syncToolbar = ({ enabled }) => {
        toolbar.classList.toggle("active", enabled);
    };

    syncToolbar({ enabled: isTeacherModeEnabled() });
    const unsubscribe = onTeacherModeChange(syncToolbar);

    toolbar.addEventListener(
        "DOMNodeRemoved",
        () => {
            unsubscribe();
        },
        { once: true }
    );

    return toolbar;
}

