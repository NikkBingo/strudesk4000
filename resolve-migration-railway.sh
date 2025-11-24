#!/bin/bash

# Script to resolve failed migration on Railway
# This script connects to Railway shell and runs the migration resolve command

echo "🚂 Connecting to Railway shell..."
echo "📋 Once connected, run these commands:"
echo ""
echo "   cd server"
echo "   npx prisma migrate resolve --applied 20241124_add_email_auth_fields"
echo "   npx prisma migrate deploy"
echo ""
echo "Press Ctrl+D or type 'exit' when done."
echo ""

railway shell

