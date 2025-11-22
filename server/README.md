# Strudel Pattern Mixer - Backend Server

Backend API server for user authentication, pattern storage, and sharing.

## Setup

### Prerequisites

- Node.js 18+ 
- PostgreSQL database
- OAuth credentials (Google and/or GitHub)

### Installation

1. Install dependencies:
```bash
cd server
npm install
```

2. Set up environment variables:
```bash
cp ../.env.example .env
# Edit .env with your configuration
```

3. Set up database:
```bash
npx prisma generate
npx prisma migrate dev
```

4. Start development server:
```bash
npm run dev
```

## Environment Variables

See `.env.example` for all required variables:

- `DATABASE_URL` - PostgreSQL connection string
- `OAUTH_GOOGLE_CLIENT_ID` / `OAUTH_GOOGLE_CLIENT_SECRET` - Google OAuth credentials
- `OAUTH_GITHUB_CLIENT_ID` / `OAUTH_GITHUB_CLIENT_SECRET` - GitHub OAuth credentials
- `SESSION_SECRET` - Secret for session encryption
- `FRONTEND_URL` - Frontend URL for CORS and redirects
- `PORT` - Server port (default: 3001)

## Railway Deployment

1. Create a new Railway project
2. Add PostgreSQL service
3. Set environment variables in Railway dashboard
4. Connect your GitHub repository
5. Railway will automatically detect and deploy

The `railway.json` file configures the build and deployment process.

## API Endpoints

### Authentication
- `GET /api/auth/google` - Initiate Google OAuth
- `GET /api/auth/google/callback` - Google OAuth callback
- `GET /api/auth/github` - Initiate GitHub OAuth
- `GET /api/auth/github/callback` - GitHub OAuth callback
- `GET /api/auth/me` - Get current user
- `POST /api/auth/logout` - Logout

### Users
- `GET /api/users/:id` - Get user profile
- `PUT /api/users/:id` - Update user profile
- `GET /api/users/search/:query` - Search users

### Patterns
- `POST /api/patterns` - Create pattern
- `GET /api/patterns` - List patterns (with filters)
- `GET /api/patterns/:id` - Get pattern
- `PUT /api/patterns/:id` - Update pattern
- `DELETE /api/patterns/:id` - Delete pattern
- `POST /api/patterns/:id/share` - Share pattern with users
- `GET /api/patterns/:id/users` - Get users who have access

## Database Schema

See `prisma/schema.prisma` for the complete database schema.

Main models:
- `User` - User accounts with OAuth info
- `Pattern` - Saved patterns with metadata
- `PatternShare` - Pattern sharing relationships

