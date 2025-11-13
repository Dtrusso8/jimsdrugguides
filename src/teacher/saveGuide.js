/**
 * Save guide functionality for teacher mode.
 */

import { getCurrentGuideData } from "../popup/cellManager.js";
import { getTeacherState } from "./teacherState.js";

/**
 * Download guide data as JSON file.
 */
export function saveGuideToFile() {
    const guideData = getCurrentGuideData();
    const teacherState = getTeacherState();
    
    if (!guideData) {
        alert("No guide data available to save. Please load a guide first.");
        return;
    }
    
    if (!teacherState.currentGuide) {
        alert("No guide context available. Please load a guide first.");
        return;
    }
    
    // Create a clean copy of the guide data with updated cellData
    const dataToSave = {
        title: guideData.title,
        course: guideData.course,
        courseSlug: guideData.courseSlug,
        tags: guideData.tags || [],
        tables: guideData.tables || [],
        cellData: guideData.cellData || {},
    };
    
    // Convert to JSON string
    const jsonString = JSON.stringify(dataToSave, null, 2);
    
    // Create blob and download
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    
    // Generate filename from guide slug or title
    const guideSlug = teacherState.currentGuide.slug || 
                      guideData.courseSlug || 
                      "guide";
    const filename = `${guideSlug}.json`;
    a.download = filename;
    
    // Trigger download
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    // Clean up
    URL.revokeObjectURL(url);
    
    console.log("Guide saved:", filename);
}

