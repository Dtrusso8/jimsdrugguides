const teacherState = {
    enabled: false,
    currentGuide: null,
};

const changeListeners = new Set();
const guideListeners = new Set();
const actionListeners = new Map();

function emitStateChange() {
    const snapshot = getTeacherState();
    changeListeners.forEach((listener) => {
        try {
            listener(snapshot);
        } catch (error) {
            console.error("[TeacherMode] Listener failed during state change.", error);
        }
    });
}

function emitGuideContext() {
    const context = teacherState.currentGuide ? { ...teacherState.currentGuide } : null;
    guideListeners.forEach((listener) => {
        try {
            listener(context);
        } catch (error) {
            console.error("[TeacherMode] Listener failed during guide context update.", error);
        }
    });
}

export function initializeTeacherMode(initiallyEnabled = false) {
    teacherState.enabled = Boolean(initiallyEnabled);
    emitStateChange();
}

export function setTeacherModeEnabled(enabled) {
    const next = Boolean(enabled);
    if (teacherState.enabled === next) {
        return;
    }

    teacherState.enabled = next;
    emitStateChange();
}

export function isTeacherModeEnabled() {
    return teacherState.enabled;
}

export function onTeacherModeChange(listener) {
    changeListeners.add(listener);
    return () => changeListeners.delete(listener);
}

export function registerGuideContext(context) {
    if (context == null) {
        teacherState.currentGuide = null;
    } else {
        teacherState.currentGuide = {
            slug: context.slug ?? null,
            title: context.title ?? null,
            course: context.course ?? null,
            tags: Array.isArray(context.tags) ? [...context.tags] : [],
            sourceFile: context.sourceFile ?? null,
        };
    }
    emitGuideContext();
}

export function onGuideContextChange(listener) {
    guideListeners.add(listener);
    return () => guideListeners.delete(listener);
}

export function getTeacherState() {
    return {
        enabled: teacherState.enabled,
        currentGuide: teacherState.currentGuide
            ? { ...teacherState.currentGuide, tags: [...teacherState.currentGuide.tags] }
            : null,
    };
}

export function onTeacherAction(action, handler) {
    if (!actionListeners.has(action)) {
        actionListeners.set(action, new Set());
    }
    const bucket = actionListeners.get(action);
    bucket.add(handler);
    return () => bucket.delete(handler);
}

export function requestTeacherAction(action, payload = {}) {
    const listeners = actionListeners.get(action);
    if (!listeners || listeners.size === 0) {
        console.info("[TeacherMode] Action requested:", action, payload);
        return;
    }
    listeners.forEach((listener) => {
        try {
            listener(payload);
        } catch (error) {
            console.error(`[TeacherMode] Listener for action "${action}" failed.`, error);
        }
    });
}

