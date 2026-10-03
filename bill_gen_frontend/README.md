# GST Invoice Local Web App

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
python app.py
```

Open `http://127.0.0.1:5000`.

## Deployment

For a fresh Ubuntu/Debian system:

```bash
sudo apt update
sudo apt install -y python3 python3-venv google-chrome-stable
```

If `google-chrome-stable` is not available in your apt sources, install one of these instead:

```bash
sudo apt install -y chromium-browser
```

or

```bash
sudo apt install -y chromium
```

Then start the project:

```bash
python3 -m venv .venv
source .venv/bin/activate
python app.py
```

## Output

- Preview renders only the document pages, while PDF export can append the matching invoice or receipt terms-and-conditions sheet after every document page. This is enabled by default and can be turned off in Settings.
- Final export writes only the `.pdf` file into `generated_bills/`.
- PDF generation renders to a temporary HTML file and removes it immediately, which reduces disk churn versus keeping permanent intermediates.
- `/api/generate` now also returns a `storage` object describing whether Supabase persistence succeeded, was skipped, or failed.
- When the repo-root `.env` contains Supabase keys, invoice and receipt generation attempts to persist:
  - customer master updates
  - invoice / receipt headers
  - invoice / receipt line items
  - payment tenders
  - generated PDF metadata
