# Cap Preview Tool — Setup Guide

A complete walkthrough to get your preview tool live, without ever opening a Terminal or command prompt. Total time: about 25 minutes start to finish.

---

## What you'll end up with

A live URL like `https://cap-preview-yourname.vercel.app` that you can open on any device, send to anyone, or embed on your Wix site. It will:

1. Let a customer upload up to 3 logos (front + optional left/right sides)
2. Let them pick any cap colour with a hue wheel
3. Let them choose 0–3 sewn side stripes
4. Generate a real Nano Banana Pro render of their custom cap
5. Let them download the result or regenerate

---

## What you need before starting

- **A computer with a web browser**
- **A free GitHub account** (sign up at <https://github.com>)
- **A free Vercel account** — sign up at <https://vercel.com> using "Continue with GitHub" so they're linked
- **A Freepik API key** — get one at <https://www.freepik.com/api>. Add a payment method and set a low spending cap (e.g. $5) while testing. Each Nano Banana Pro 2K render costs roughly $0.10–$0.20.
- **The `cap-preview` folder** — that's the zipped project you have. Unzip it somewhere obvious like your Desktop.

---

## Step 1 — Put the project on GitHub (5 min)

GitHub is where your code lives. Vercel reads from there to deploy your site.

1. Open <https://github.com> and log in.
2. Click the **+** in the top right corner → **New repository**.
3. Give it a name like `cap-preview`. Leave everything else default. Click **Create repository**.
4. On the next page, you'll see a near-empty repo. Click the **uploading an existing file** link (it's small, about a third down the page).
5. Open your unzipped `cap-preview` folder on your computer in another window.
6. **Select every file and folder inside `cap-preview`** (not the `cap-preview` folder itself — its contents). Drag them all into the GitHub upload area in your browser.
   - Make sure you can see: `app/`, `package.json`, `next.config.js`, `tailwind.config.js`, `postcss.config.js`, `.gitignore`. The `app/` folder should contain `page.jsx`, `layout.jsx`, `globals.css`, and an `api/` subfolder.
7. Wait for the green checkmarks next to each file (a few seconds).
8. Scroll down and click the green **Commit changes** button.

Your code is now on GitHub. ✓

---

## Step 2 — Deploy to Vercel (5 min)

1. Open <https://vercel.com/new> in a new tab.
2. You'll see a list of your GitHub repositories. Find `cap-preview` and click **Import**.
   - If you don't see it, click **Adjust GitHub App Permissions** and grant Vercel access to that repo.
3. On the configuration page, **don't change anything** — Vercel auto-detects Next.js. Just click **Deploy**.
4. Wait 1–2 minutes while Vercel builds and deploys.
5. When it's done you'll see a celebratory page with your live URL — something like `https://cap-preview-xxx.vercel.app`. Click it.

The site loads. The UI works. But hitting **Generate** will fail — that's expected, we haven't connected Freepik yet. Two more steps.

---

## Step 3 — Connect Vercel Blob storage (3 min)

This is where customer logos get uploaded so Nano Banana can read them.

1. From your Vercel project dashboard, click the **Storage** tab.
2. Click **Create Database** → choose **Blob**.
3. Give it any name (e.g. `cap-logos`). Click **Create**.
4. On the next screen, click **Connect Project** and select your `cap-preview` project.
   - This automatically adds the `BLOB_READ_WRITE_TOKEN` environment variable for you. You don't have to copy anything.

---

## Step 4 — Add your Freepik API key (2 min)

1. In your Vercel project dashboard, click the **Settings** tab.
2. In the left sidebar click **Environment Variables**.
3. Click **Add New**.
4. **Key:** `FREEPIK_API_KEY`
5. **Value:** paste your Freepik API key
6. Leave **Environment** at default (all three checkboxes ticked).
7. Click **Save**.

---

## Step 5 — Redeploy so the new settings take effect (1 min)

1. Click the **Deployments** tab.
2. Find the most recent deployment at the top → click the **⋯** menu on the right → **Redeploy**.
3. Click **Redeploy** in the popup. Wait ~1 minute.

Your app is now fully live and connected. Open your Vercel URL again and try a real generation.

---

## Step 6 — Embed on your Wix site (5 min)

1. In Wix Editor, navigate to the page where you want the tool.
2. Click **Add → Embed Code → Embed HTML**.
3. Paste this into the embed box (replacing the URL with yours):

```html
<iframe src="https://cap-preview-xxx.vercel.app"
        width="100%" height="1500" frameborder="0"
        style="border: none; max-width: 100%;">
</iframe>
```

4. Resize the Wix element on the page to fit. Publish.

Done. Customers can use the tool directly from your Wix site.

---

## When you make changes later

If you want to tweak the prompt, change a colour, edit the copy, etc.:

1. Edit the file directly on GitHub.com (click the file → pencil icon → make your edit → **Commit changes**).
2. Vercel automatically redeploys within 1–2 minutes. Refresh your live URL.

That's the whole loop. You never need a command line.

---

## What to expect on your first real generation

Hit Generate after uploading a test logo. Realistic flow:

- **0–2 sec:** uploading your logos to Vercel Blob
- **2–35 sec:** Nano Banana Pro is rendering (the polling loop checks every second)
- **35 sec–done:** image appears on screen, downloadable

If something goes wrong, the alert will tell you exactly what failed. The most likely first-run issue is your Freepik account needing a verified payment method — check your spending limit and that the API key is active.

---

## Costs at a glance

| Item                                 | Cost                                |
|--------------------------------------|-------------------------------------|
| Vercel hosting                       | Free for low/medium traffic         |
| Vercel Blob storage                  | Free up to 1GB (you'll use ~MBs)    |
| Freepik Nano Banana Pro 2K render    | ~$0.10–$0.20 per render             |
| **Customer with 1 generation**       | **~$0.15**                          |
| **Customer with 3 attempts**         | **~$0.45**                          |

Set a Freepik monthly spending cap to keep this bounded. At 100 customer sessions/month with 2 generations average: ~$30. At 500: ~$150.

---

## Files in this project (rundown)

If you ever need to find and edit something:

**`app/page.jsx`** — the entire customer-facing UI. Contains:
- The `PROMPT` template at the top — edit this to change what gets sent to the AI
- The `SIDES` array — the three logo upload slots
- The `QUICK_COLORS` array — the 12 quick-pick colour chips
- The `STRIPE_OPTIONS` array — `[0, 1, 2, 3]` for the dropdown
- The `buildPrompt()` function — assembles the full prompt from customer choices

**`app/api/generate/route.js`** — the backend that talks to Freepik. Contains:
- The Vercel Blob upload step
- The Nano Banana Pro POST request
- The polling loop that waits for the render

**`app/layout.jsx`** — wraps every page, loads the Google Fonts.

**`app/globals.css`** — base styles, the grain texture, focus rings.

**`package.json`** — list of dependencies. Don't edit unless you know what you're doing.

**`next.config.js`, `tailwind.config.js`, `postcss.config.js`** — framework configs, leave alone.

---

## Honest caveats

- **First generation may surface a small Freepik issue.** I built this against their official Nano Banana Pro docs, but APIs change. If you see a "Freepik returned 400" error, paste the message back to me and I'll patch the request body.
- **Nano Banana Pro can refuse some content.** Google's safety filters occasionally reject prompts they think contain real brands or famous IP. If a customer's logo gets rejected, the error tells you. Easy fix is to retry.
- **Renders aren't 100% perfect.** Even with a strong prompt, expect ~10–15% of renders to need a regenerate. The "Generate Again" button is there for that.
- **Mobile iframes can be tricky on Wix.** If the embed looks cramped on phones, set a separate height for the mobile breakpoint in Wix.
