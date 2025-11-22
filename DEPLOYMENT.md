# Deployment Guide

## Railway Deployment

### Prerequisites

1. Railway account (sign up at https://railway.app)
2. GitHub repository connected to Railway
3. OAuth app credentials (Google and/or GitHub)

### Step 1: Create OAuth Applications

#### Google OAuth
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable Google+ API
4. Create OAuth 2.0 credentials
5. Add authorized redirect URI: `https://your-backend-url.railway.app/api/auth/google/callback`

#### GitHub OAuth
1. Go to GitHub Settings > Developer settings > OAuth Apps
2. Create new OAuth App
3. Set Authorization callback URL: `https://your-backend-url.railway.app/api/auth/github/callback`

### Step 2: Deploy to Railway

1. **Create New Project**
   - Go to Railway dashboard
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Select your repository

2. **Add PostgreSQL Service**
   - Click "New" > "Database" > "Add PostgreSQL"
   - Railway will automatically create a PostgreSQL instance
   - Note the connection string (will be in `DATABASE_URL` env var)

3. **Configure Environment Variables**
   - Go to your service settings
   - Add the following environment variables:
     ```
     DATABASE_URL=<automatically set by Railway PostgreSQL>
     OAUTH_GOOGLE_CLIENT_ID=<your-google-client-id>
     OAUTH_GOOGLE_CLIENT_SECRET=<your-google-client-secret>
     OAUTH_GOOGLE_CALLBACK_URL=https://your-backend-url.railway.app/api/auth/google/callback
     OAUTH_GITHUB_CLIENT_ID=<your-github-client-id>
     OAUTH_GITHUB_CLIENT_SECRET=<your-github-client-secret>
     OAUTH_GITHUB_CALLBACK_URL=https://your-backend-url.railway.app/api/auth/github/callback
     SESSION_SECRET=<generate-a-random-secret-string>
     FRONTEND_URL=https://your-frontend-url.com
     NODE_ENV=production
     PORT=3001
     ```

4. **Deploy**
   - Railway will automatically detect the `railway.json` configuration
   - The build process will:
     - Install dependencies
     - Generate Prisma client
     - Run database migrations
     - Start the server

### Step 3: Update Frontend Configuration

Update your frontend `.env` or build configuration to point to the Railway backend:

```env
VITE_API_URL=https://your-backend-url.railway.app/api
```

### Step 4: Deploy Frontend

The frontend can be deployed to:
- Vercel
- Netlify
- Railway (separate service)
- Any static hosting

Make sure to set the `VITE_API_URL` environment variable in your frontend deployment.

## Local Development

1. **Backend**
   ```bash
   cd server
   npm install
   cp ../.env.example .env
   # Edit .env with your local database and OAuth credentials
   npx prisma migrate dev
   npm run dev
   ```

2. **Frontend**
   ```bash
   npm install
   npm run dev
   ```

The Vite dev server is configured to proxy `/api` requests to `http://localhost:3001`.

## Database Migrations

When deploying to production:
- Railway automatically runs `prisma migrate deploy` on startup
- For local development, use `prisma migrate dev`

## Troubleshooting

### Database Connection Issues
- Verify `DATABASE_URL` is correctly set
- Check Railway PostgreSQL service is running
- Ensure connection string format is correct

### OAuth Redirect Issues
- Verify callback URLs match exactly in OAuth app settings
- Check `FRONTEND_URL` is set correctly
- Ensure HTTPS is used in production

### CORS Issues
- Verify `FRONTEND_URL` matches your actual frontend domain
- Check backend CORS configuration allows your frontend origin

