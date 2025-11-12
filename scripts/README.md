# Guide Conversion Script

## Setup

```bash
python -m venv .venv
. .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r scripts/requirements.txt
```

## Usage

```bash
python scripts/convert_guides.py --source "Drug Guides" --output data
```

The script scans the source directory for course folders. Each course folder
should contain Word guides and an optional `tags.txt` file that lists one tag per
line. Every guide in the course inherits that tag list. The converter emits the
following for each guide:

- A JSON payload that includes the tables, course metadata, and tags.
- An HTML fragment that preserves the original table styling.
- An updated `data/guides.index.json` manifest.

## Notes

- Place new guides inside the appropriate course folder under the source
  directory.
- Add course-wide tags to `tags.txt` (one tag per line) within that course
  folder. Tags are deduplicated and sorted automatically.
- Output filenames are derived from both the course folder name and the guide
  filename to avoid collisions.
- Existing JSON/HTML files with the same slug are overwritten when the script
  runs.
- Re-run the script whenever Word documents, course folders, or tags change.

