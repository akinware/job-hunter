# Job Hunter

One search across several free job boards, with optional CV matching that runs entirely in the visitor's browser. No accounts, no database, no AI needed.

```
public/index.html   the website (search page, CV matching)
api/search.js       serverless function: asks each job board, merges and de-duplicates results
package.json
```

## Job sources

| Source | Covers | Key needed | Rules |
|---|---|---|---|
| [Arbeitnow](https://www.arbeitnow.com) | Germany + remote | No | Link back to the listing |
| [Himalayas](https://himalayas.app) | Remote jobs worldwide | No | Show "Jobs from Himalayas" with a link (done in the footer) |
| [Adzuna](https://developer.adzuna.com) | Most of Europe, US, UK, Canada… | Free key | Show Adzuna attribution (done in the footer) |

The site works without Adzuna, but Adzuna adds by far the most listings, so set it up (step 3).

Results are cached for 30 minutes on Vercel's edge, which keeps you well inside the free sources' limits.

## Put it online (about 10 minutes, free)

1. **GitHub:** create a free account at github.com → **New repository** → name it `job-hunter` → **Create**. On the new repo page click **uploading an existing file** and drag in the *contents* of this folder (`api`, `public`, `package.json`, `README.md`). Commit.
2. **Vercel:** sign in at vercel.com with your GitHub account → **Add New… → Project** → import `job-hunter` → leave every setting as it is → **Deploy**. You get a live address like `job-hunter-xyz.vercel.app`.
3. **Adzuna (recommended):** register at developer.adzuna.com (free) and copy your *App ID* and *App Key*. In Vercel open the project → **Settings → Environment Variables** and add `ADZUNA_APP_ID` and `ADZUNA_APP_KEY`. Then **Deployments → ⋯ → Redeploy**.
4. **Your own domain:** Vercel project → **Settings → Domains** → add your domain and set the DNS records Vercel shows you at your domain registrar.

Every time you change a file on GitHub, Vercel redeploys automatically.

## Try it

`https://your-site/?q=ux+designer&where=Berlin&country=de` opens a search directly, so search links can be shared.

API: `GET /api/search?q=<keywords>&where=<city>&country=<de|gb|us|…>&remote=1`
returns `{ jobs: [{title, company, location, remote, url, posted, salary, snippet, tags, source}], sources: [{name, ok, count}] }`.

## Ideas for the next version

- More sources: Jooble or Careerjet (free keys), company career pages on Greenhouse, Lever and Ashby (public JSON APIs per company).
- Saved searches and email alerts (needs a small database such as Supabase).
- AI features (CV feedback, cover letters) through the Claude API.
