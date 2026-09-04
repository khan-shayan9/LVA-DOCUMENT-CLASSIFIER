step-by-step guide to deploying your project live on **Render.com** (100% Free).

---

### Phase 1: Push Your Project to GitHub

Open your terminal in your project root (`DOC-CLASS-CP-main - light theme`) and run:

```bash
git init
git add .
git commit -m "Deploy AI Document Classification System"
git branch -M main
git remote add origin https://github.com/<YOUR_USERNAME>/<YOUR_REPOSITORY_NAME>.git
git push -u origin main
```
*(Your `.env` file is protected by `.gitignore` and will not be uploaded).*

---

### Phase 2: Create the Web Service on Render

1. Go to **[render.com](https://render.com)** and sign in with your GitHub account.
2. In the top right corner of the dashboard, click **New +** $\rightarrow$ **Web Service**.
3. Select **"Build and deploy from a Git repository"** and click **Next**.
4. Choose your GitHub repository from the list and click **Connect**.

---

### Phase 3: Configure Settings

Fill in the following fields on the setup page:

| Setting Field | What to Enter / Select |
| :--- | :--- |
| **Name** | `ai-doc-classifier` *(or any name you like)* |
| **Region** | *Oregon (US West)* — matches your Zilliz/Milvus cluster region (`us-west1`), keeping search latency low |
| **Branch** | `main` |
| **Root Directory** | `backend` *(Important: tells Render your code is in `/backend`)* |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Instance Type** | **Free** ($0 / month) |

---

### Phase 4: Add Environment Variables

Scroll down to the **Environment Variables** section on Render, click **Add Environment Variable**, and add each key-value pair from your local `backend/.env` file:

| Key | Value (from your `backend/.env`) |
| :--- | :--- |
| `NODE_ENV` | `production` |
| `ENABLE_EXTRACTION_PREVIEW` | `false` *(security: this endpoint returns any uploaded file's text with no ownership check — keep it off in production)* |
| `USE_CONTEXT_EMBEDDING` | `false` |
| `R2_ACCOUNT_ID` | *Your Cloudflare Account ID* |
| `R2_ACCESS_KEY_ID` | *Your R2 Access Key* |
| `R2_SECRET_ACCESS_KEY` | *Your R2 Secret Key* |
| `R2_BUCKET_NAME` | *Your R2 Bucket Name* |
| `R2_ENDPOINT` | *Your R2 Endpoint URL* |
| `MILVUS_ADDRESS` | *Your Zilliz / Milvus Cluster URL* |
| `MILVUS_TOKEN` | *Your Zilliz API Token* |
| `CLOUDFLARE_ACCOUNT_ID` | *Your Cloudflare Account ID* |
| `CLOUDFLARE_API_TOKEN` | *Your Cloudflare API Token* |

*(Note: Do **not** set `PORT` — Render provides its own port automatically.)*

*(Optional: `CORS_ORIGIN` — leave unset. It only matters if some other site needs to call this API directly; the bundled frontend is served from the same origin and doesn't need it.)*

---

### Phase 5: Deploy & Test Your Live Link!

1. Click **Create Web Service** at the bottom of the page.
2. Render will download your code, run `npm install`, and launch the server.
3. Once the logs show `Status: Running ✓`, look at the top left of the page for your **Live URL**:
   $$\text{e.g., } \mathbf{\text{https://ai-doc-classifier.onrender.com}}$$
4. Click the link! You can now open your app from any laptop, tablet, or phone, drag and drop test documents, and run live classifications anywhere in the world!

---

> [!TIP]
> **Viva Demo Tip (Free Tier Cold Starts):**  
> On Render's free tier, if no one visits the site for 15 minutes, the server goes into "sleep mode" to save energy. When you open it before your demo, give it ~30 seconds on the first load to wake up. Once awake, it runs at full speed!