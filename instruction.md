# Deploying TeleMoon on EthioDeploy.com

To host this application on [EthioDeploy.com](https://ethiodeploy.com) (or similar PaaS providers), follow these steps:

## 1. Prepare Your Repository
Push the `TeleMoon` source code to a GitHub, GitLab, or Bitbucket repository. You can do this by initializing a git repository in this folder if you haven't already:
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

## 2. Create a New App on EthioDeploy
1. Log in to your EthioDeploy dashboard.
2. Create a new Node.js application or "Web Service".
3. Connect the repository you created in step 1.

## 3. Configure the Build and Start Commands
EthioDeploy needs to know how to install dependencies, build the frontend, and run the server. Use the following configuration:

- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm start`

*(This works because the root `package.json` contains workspaces, so `npm run build` will build the frontend into `web/dist`, and the `npm start` will run the Express server which automatically serves `web/dist`!)*

## 4. Setup Environment Variables
You need to add the environment variables from your `.env` file into the EthioDeploy dashboard (usually under a "Settings", "Environment Variables", or "Config Vars" tab).

Add the following keys and their corresponding values from your `.env` file:
- `TG_API_ID`
- `TG_API_HASH`
- `TG_SESSION` (or `TG_BOT_TOKEN` if using a bot)
- `JWT_SECRET` (generate a secure, random string for this)
- `CHUNK_MB` (Optional. Set to ~500 or 1000 depending on the server's disk space)

**Note on PORT:** 
EthioDeploy will likely provide a `PORT` environment variable dynamically. If they do, do not hardcode `PORT=8080` in your variables. If they don't provide it automatically, you can set it as they require.

## 5. Persistent Storage (Database & Temp Files)
TeleMoon uses SQLite to store file metadata and a temporary directory to handle chunking during uploads. 
- You **must** attach a persistent storage volume to your app on EthioDeploy so you don't lose your database when the app restarts.
- Once the volume is attached (e.g., mounted at `/app/data`), add a new environment variable:
  - `DATA_DIR=/app/data` (Change `/app/data` to whatever mount path EthioDeploy provides).

## 6. Deploy!
Save your configuration and deploy the app. Once it finishes building, EthioDeploy will give you a public URL where you can access your TeleMoon frontend.
