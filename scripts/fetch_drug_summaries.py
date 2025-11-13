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


def normalize_drug_name(name: str) -> str:
    """Normalize drug name for Wikipedia lookup."""
    # Remove brand names in parentheses
    name = re.sub(r"\s*\([^)]+\)", "", name)
    # Remove HTML tags
    name = re.sub(r"<[^>]+>", "", name)
    # Strip whitespace
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
    
    # Track content we've already searched to avoid duplicates (from merged cells)
    # Key: normalized content, Value: summary found (or None if not found)
    content_cache = {}
    
    # Process each cell
    try:
        for cell_id, cell_info in cell_data.items():
            content = cell_info.get("content", "").strip()
            existing_summary = cell_info.get("summary", "").strip()
            
            # Skip if summary already exists and not forcing
            # Also skip if it's marked as "no data" (we already tried and failed)
            if existing_summary and not force:
                skipped_count += 1
                # Add to cache so we don't search duplicates
                # Treat "no data" as None in cache (already tried and failed)
                content_cache[content] = existing_summary if existing_summary != "no data" else None
                continue
            
            # Check if content looks like a drug name
            if not is_likely_drug_name(content):
                skipped_count += 1
                continue
            
            # Check if we've already searched this exact content (duplicate from merged cell)
            if content in content_cache:
                # Use the cached summary
                cached_summary = content_cache[content]
                normalized_display = normalize_drug_name(content)
                if cached_summary:
                    cell_info["summary"] = cached_summary
                    cell_info["lastUpdated"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
                    updated_count += 1
                    print(f"  Using cached summary for: {normalized_display} (duplicate cell)")
                else:
                    # We already tried and failed, skip it
                    error_count += 1
                    print(f"  Skipping (already tried): {normalized_display}")
                continue
            
            # Normalize content for display and lookup
            normalized_content = normalize_drug_name(content)
            print(f"  Fetching summary for: {normalized_content}")
            summary = fetch_wikipedia_summary(content, delay)
            
            # Cache the result (even if None) to avoid re-searching duplicates
            content_cache[content] = summary
            
            if summary:
                cell_info["summary"] = summary
                cell_info["lastUpdated"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
                updated_count += 1
                print(f"    ✓ Found summary ({len(summary)} chars)")
            else:
                # Store "no data" so we don't search again on next run
                cell_info["summary"] = "no data"
                cell_info["lastUpdated"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
                updated_count += 1  # Count as updated so it gets saved
                error_count += 1
                print(f"    ✗ No summary found (stored 'no data')")
    
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

