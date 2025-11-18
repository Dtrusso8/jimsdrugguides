"""Fetch drug summaries from web sources and update guide JSON files.

Usage:
    python fetch_drug_summaries.py --input "../data" --guide "course-9-course9-integratedsystems-immunosup-anticancer-derm-drugguide.json"
    python fetch_drug_summaries.py --input "../data"  # Process all guides

This script:
- Reads JSON guide files
- Identifies cells that likely contain drug names
- Scrapes summaries from Wikipedia
- Updates cellData entries with summaries
- Handles rate limiting and errors gracefully
- Can run incrementally (only fetch missing summaries)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import quote, urljoin
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# Get the script's directory to resolve relative paths
SCRIPT_DIR = Path(__file__).parent.resolve()
DEFAULT_INPUT = SCRIPT_DIR.parent / "data"

# Wikipedia API base URL
WIKIPEDIA_API_BASE = "https://en.wikipedia.org/api/rest_v1/page/summary/"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch drug summaries from web sources and update guide JSON files."
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=DEFAULT_INPUT,
        help=f"Directory containing JSON guide files (default: {DEFAULT_INPUT}).",
    )
    parser.add_argument(
        "--guide",
        type=str,
        default=None,
        help="Specific guide filename to process (e.g., 'course-9-...json'). If not provided, processes all guides.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force re-fetch summaries even if they already exist.",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=1.0,
        help="Delay between requests in seconds (default: 1.0).",
    )
    return parser.parse_args(argv or sys.argv[1:])


def is_likely_drug_name(text: str) -> bool:
    """Check if text is non-empty - in a drug guide, everything is a drug or topic."""
    if not text or len(text.strip()) < 2:
        return False
    
    text = text.strip()
    
    # Skip empty or whitespace-only
    if not text or text == "&nbsp;":
        return False
    
    # In a drug guide, every non-empty cell is a drug or topic worth searching
    return True


def normalize_content_for_storage(content: str) -> str:
    """Normalize content exactly as convert_guides.py does for storage in cellData.
    
    This matches the normalization used in generate_cell_data():
    - Remove HTML tags
    - Strip whitespace
    - Handle &nbsp; as empty
    """
    if not content:
        return ""
    # Remove HTML tags (same regex as convert_guides.py)
    normalized = re.sub(r"<[^>]+>", "", content)
    # Strip whitespace
    normalized = normalized.strip()
    # Handle &nbsp; as empty
    if normalized == "&nbsp;":
        return ""
    return normalized


def normalize_drug_name(name: str) -> str:
    """Normalize drug name for Wikipedia lookup."""
    # First normalize as stored in cellData
    name = normalize_content_for_storage(name)
    if not name:
        return ""
    
    # Remove brand names in parentheses (for Wikipedia lookup only)
    name = re.sub(r"\s*\([^)]+\)", "", name)
    # Strip whitespace again after removing parentheses
    name = name.strip()
    
    # Always convert to title case for Wikipedia (article titles use title case)
    # This handles: "ANTIBACTERIALS" -> "Antibacterials", "antibacterials" -> "Antibacterials"
    if name and any(c.isalpha() for c in name):
        name = name.title()
    
    return name


def fetch_wikipedia_summary(drug_name: str, delay: float = 1.0) -> Optional[str]:
    """Fetch summary from Wikipedia API. Tries multiple variations if first attempt fails."""
    normalized = normalize_drug_name(drug_name)
    if not normalized:
        return None
    
    # Try multiple variations of the name
    variations = [normalized]
    
    # Try capitalized version (first letter uppercase)
    if normalized and normalized[0].islower():
        variations.append(normalized.capitalize())
    
    # Try title case (each word capitalized)
    if " " in normalized:
        variations.append(normalized.title())
    
    # Try singular form if plural (basic heuristic)
    if normalized.endswith("s") and len(normalized) > 3:
        singular = normalized[:-1]
        variations.append(singular)
        variations.append(singular.capitalize())
    
    # Try adding common suffixes for drug classes
    if not any(normalized.lower().endswith(x) for x in ["agent", "drug", "antibiotic", "inhibitor"]):
        variations.append(f"{normalized} agent")
        variations.append(f"{normalized.capitalize()} agent")
    
    # Remove duplicates while preserving order
    seen = set()
    unique_variations = []
    for var in variations:
        if var not in seen:
            seen.add(var)
            unique_variations.append(var)
    
    # Try each variation
    for attempt_name in unique_variations:
        # Clean up name for URL
        url_name = quote(attempt_name.replace(" ", "_"))
        url = urljoin(WIKIPEDIA_API_BASE, url_name)
        
        try:
            # Respect rate limiting
            time.sleep(delay)
            
            req = Request(url, headers={"User-Agent": "DrugGuideScraper/1.0"})
            with urlopen(req, timeout=10) as response:
                data = json.loads(response.read().decode())
                
                # Extract summary
                if "extract" in data:
                    summary = data["extract"].strip()
                    # Limit summary length
                    if len(summary) > 500:
                        summary = summary[:500] + "..."
                    if attempt_name != normalized:
                        print(f"    (found via variation: {attempt_name})")
                    return summary
                elif "title" in data and "extract_html" in data:
                    # Fallback to HTML extract
                    summary = re.sub(r"<[^>]+>", "", data["extract_html"]).strip()
                    if len(summary) > 500:
                        summary = summary[:500] + "..."
                    if attempt_name != normalized:
                        print(f"    (found via variation: {attempt_name})")
                    return summary
        except HTTPError as e:
            if e.code == 404:
                # Page not found, try next variation
                continue
            print(f"  HTTP error for '{attempt_name}': {e.code}", file=sys.stderr)
            break  # Don't try more variations on non-404 errors
        except URLError as e:
            print(f"  URL error for '{attempt_name}': {e}", file=sys.stderr)
            break
        except json.JSONDecodeError as e:
            print(f"  JSON decode error for '{attempt_name}': {e}", file=sys.stderr)
            break
        except Exception as e:
            print(f"  Unexpected error for '{attempt_name}': {e}", file=sys.stderr)
            break
    
    # None of the variations worked
    return None


def process_guide_file(guide_path: Path, force: bool = False, delay: float = 1.0) -> bool:
    """Process a single guide file."""
    print(f"\nProcessing: {guide_path.name}")
    
    try:
        with guide_path.open("r", encoding="utf-8") as fh:
            guide_data = json.load(fh)
    except (json.JSONDecodeError, IOError) as e:
        print(f"  Error reading file: {e}", file=sys.stderr)
        return False
    
    if "cellData" not in guide_data:
        print("  No cellData found. Run convert_guides.py first.")
        return False
    
    cell_data = guide_data.get("cellData", {})
    if not cell_data:
        print("  No cell data to process.")
        return False
    
    updated_count = 0
    skipped_count = 0
    error_count = 0
    
    # First pass: Build content cache from existing summaries to avoid re-searching
    # Key: normalized content, Value: summary found (or None if not found)
    content_cache = {}
    
    # Pre-populate cache with existing summaries (to avoid re-searching duplicates)
    for cell_id, cell_info in cell_data.items():
        raw_content = cell_info.get("content", "")
        content = normalize_content_for_storage(raw_content)
        existing_summary = cell_info.get("summary", "").strip()
        
        if content and existing_summary:
            # Treat "no data" as None in cache (already tried and failed)
            if existing_summary != "no data":
                content_cache[content] = existing_summary
            else:
                content_cache[content] = None
    
    # Second pass: Process cells, but only fetch summaries for unique content
    # Group cells by content to process duplicates together
    cells_by_content = {}
    for cell_id, cell_info in cell_data.items():
        raw_content = cell_info.get("content", "")
        content = normalize_content_for_storage(raw_content)
        
        if not content:
            continue
            
        if content not in cells_by_content:
            cells_by_content[content] = []
        cells_by_content[content].append((cell_id, cell_info))
    
    # Process each unique content once
    try:
        for content, cell_list in cells_by_content.items():
            # Verify first cell ID format (they should all be similar)
            first_cell_id = cell_list[0][0]
            if not re.match(r"table_\d+_row_\d+_col_\d+", first_cell_id):
                print(f"  Warning: Unexpected cell ID format: {first_cell_id}", file=sys.stderr)
            
            # Check if content looks like a drug name
            if not is_likely_drug_name(content):
                skipped_count += len(cell_list)
                continue
            
            # Check if we already have a summary in cache
            if content in content_cache:
                cached_summary = content_cache[content]
                normalized_display = normalize_drug_name(content)
                
                # Apply cached summary to all cells with this content
                for cell_id, cell_info in cell_list:
                    existing_summary = cell_info.get("summary", "").strip()
                    
                    # Skip if summary already exists and not forcing
                    if existing_summary and not force:
                        skipped_count += 1
                        continue
                    
                    if cached_summary:
                        cell_info["summary"] = cached_summary
                        cell_info["lastUpdated"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
                        if cell_info.get("content") != content:
                            cell_info["content"] = content
                        updated_count += 1
                    else:
                        # We already tried and failed, mark as "no data"
                        cell_info["summary"] = "no data"
                        cell_info["lastUpdated"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
                        if cell_info.get("content") != content:
                            cell_info["content"] = content
                        updated_count += 1
                        error_count += 1
                
                if cached_summary:
                    print(f"  Using cached summary for: {normalized_display} ({len(cell_list)} duplicate cell(s))")
                else:
                    print(f"  Skipping (already tried): {normalized_display} ({len(cell_list)} duplicate cell(s))")
                continue
            
            # Check if any cell already has a summary (and we're not forcing)
            if not force:
                has_existing = any(
                    cell_info.get("summary", "").strip() and cell_info.get("summary", "").strip() != "no data"
                    for _, cell_info in cell_list
                )
                if has_existing:
                    skipped_count += len(cell_list)
                    continue
            
            # Fetch summary once for this unique content
            normalized_content = normalize_drug_name(content)
            print(f"  Fetching summary for: {normalized_content} ({len(cell_list)} cell(s) with this content)")
            summary = fetch_wikipedia_summary(content, delay)
            
            # Cache the result (even if None) to avoid re-searching duplicates
            content_cache[content] = summary
            
            # Apply summary to all cells with this content
            for cell_id, cell_info in cell_list:
                if summary:
                    cell_info["summary"] = summary
                    cell_info["lastUpdated"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
                else:
                    cell_info["summary"] = "no data"
                    cell_info["lastUpdated"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
                    error_count += 1
                
                # Ensure content is normalized and stored correctly
                if cell_info.get("content") != content:
                    cell_info["content"] = content
                updated_count += 1
            
            if summary:
                print(f"    ✓ Found summary ({len(summary)} chars) - applied to {len(cell_list)} cell(s)")
            else:
                print(f"    ✗ No summary found (stored 'no data' for {len(cell_list)} cell(s))")
    
    except KeyboardInterrupt:
        print(f"\n\n  ⚠ Interrupted by user (Ctrl+C)")
        if updated_count > 0:
            print(f"  Saving progress ({updated_count} summaries found so far)...")
            try:
                with guide_path.open("w", encoding="utf-8") as fh:
                    json.dump(guide_data, fh, ensure_ascii=False, indent=2)
                    fh.write("\n")
                print(f"  ✓ Progress saved! {updated_count} summaries preserved.")
                print(f"  You can resume by running the script again - it will skip existing summaries.")
            except IOError as e:
                print(f"  ✗ Error saving progress: {e}", file=sys.stderr)
                print(f"  ⚠ Warning: {updated_count} summaries may be lost!", file=sys.stderr)
        else:
            print(f"  No progress to save (no summaries found yet).")
        raise  # Re-raise to exit
    
    # Save updated data
    if updated_count > 0:
        try:
            with guide_path.open("w", encoding="utf-8") as fh:
                json.dump(guide_data, fh, ensure_ascii=False, indent=2)
                fh.write("\n")
            print(f"\n  Updated {updated_count} summaries, skipped {skipped_count}, errors {error_count}")
            return True
        except IOError as e:
            print(f"  Error saving file: {e}", file=sys.stderr)
            return False
    else:
        print(f"\n  No updates needed. Skipped {skipped_count}, errors {error_count}")
        return True


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    
    input_dir: Path = args.input.resolve()
    
    if not input_dir.exists():
        print(f"Input directory not found: {input_dir}", file=sys.stderr)
        return 1
    
    # Find guide files
    if args.guide:
        guide_files = [input_dir / args.guide]
        guide_files = [f for f in guide_files if f.exists() and f.suffix == ".json"]
    else:
        # Process all JSON files except index
        guide_files = [
            f for f in input_dir.glob("*.json")
            if f.name != "guides.index.json"
        ]
    
    if not guide_files:
        print(f"No guide files found in {input_dir}", file=sys.stderr)
        return 1
    
    print(f"Found {len(guide_files)} guide file(s) to process")
    if args.force:
        print("Force mode: will re-fetch all summaries")
    print(f"Delay between requests: {args.delay}s")
    print(f"Press Ctrl+C to stop and save progress\n")
    
    success_count = 0
    try:
        for guide_file in sorted(guide_files):
            if process_guide_file(guide_file, args.force, args.delay):
                success_count += 1
    except KeyboardInterrupt:
        # Already handled in process_guide_file, but catch here too for multi-file processing
        print(f"\n{'='*60}")
        print(f"Processing stopped. Completed {success_count}/{len(guide_files)} guide(s)")
        return 1
    
    print(f"\n{'='*60}")
    print(f"Processed {success_count}/{len(guide_files)} guide(s) successfully")
    
    return 0 if success_count == len(guide_files) else 1


if __name__ == "__main__":
    exit_code = main()
    # If running directly (double-clicked), pause on error so user can see the message
    if exit_code != 0:
        input("\nPress Enter to exit...")
    raise SystemExit(exit_code)

