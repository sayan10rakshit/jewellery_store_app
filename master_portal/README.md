# Rakshit & Co. Johuree Master Portal

## Run locally

```bash
python3 app.py
```

Open `http://127.0.0.1:5051`.

## What it does

- reads business data from Supabase through the REST API
- falls back to sample data if the database is empty or unreachable
- links directly into the existing billing workspace at `http://127.0.0.1:5000`

## Notes

- this app uses only Python standard library modules
- it expects Supabase keys in the repo-root `.env`
